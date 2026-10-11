import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accumulateExpected } from './expected';
import type { RecordedEvent } from './lib/record';

const event = (name: string, account: string, bank: string, amount: string,
  closeBalance = false): RecordedEvent => ({ signature: 'sample', name,
  data: { header: { marginfiAccount: account }, bank, amount, closeBalance } });

test('存取借还按原生数量累加，closeBalance 消掉 repay_all 舍入尾差', () => {
  const result = accumulateExpected([
    event('LendingAccountDepositEvent', 'alice', 'usdc', '10000000000'),
    event('LendingAccountWithdrawEvent', 'alice', 'usdc', '1000000000'),
    event('LendingAccountBorrowEvent', 'bob', 'usdc', '5000000000'),
    event('LendingAccountRepayEvent', 'bob', 'usdc', '1000000000'),
    event('LendingAccountRepayEvent', 'bob', 'usdc', '4000000010', true),
    event('MarginfiAccountCreateEvent', 'bob', 'usdc', '0'),
  ]);
  assert.deepEqual(result.accounts.alice.usdc, { netDeposit: '9000000000', netBorrow: '0' });
  assert.deepEqual(result.accounts.bob.usdc, { netDeposit: '0', netBorrow: '0' });
});

test('整数不经 Number，支持超过 2^53 的数量；错误数量明确报错', () => {
  const result = accumulateExpected([event('LendingAccountDepositEvent', 'alice', 'sol', '9007199254740993')]);
  assert.equal(result.accounts.alice.sol.netDeposit, '9007199254740993');
  assert.throws(() => accumulateExpected([event('LendingAccountDepositEvent', 'alice', 'sol', '-1')]), /amount/);
});

test('清算扣抵押、减债、给 Carol 抵押，同时扣 Carol 的存款和保险费', () => {
  const liquidation: RecordedEvent = { signature: 'liq', name: 'LendingAccountLiquidateEvent', data: {
    header: { marginfiAccount: 'carol' }, liquidateeMarginfiAccount: 'bob',
    assetBank: 'sol', liabilityBank: 'usdc',
    preBalances: { liquidateeAssetBalance: 100e9, liquidateeLiabilityBalance: 5000e6,
      liquidatorAssetBalance: 0, liquidatorLiabilityBalance: 0 },
    postBalances: { liquidateeAssetBalance: 90e9, liquidateeLiabilityBalance: 4525e6,
      liquidatorAssetBalance: 10e9, liquidatorLiabilityBalance: 0 },
  } };
  const result = accumulateExpected([
    event('LendingAccountDepositEvent', 'bob', 'sol', '100000000000'),
    event('LendingAccountBorrowEvent', 'bob', 'usdc', '5000000000'),
    event('LendingAccountDepositEvent', 'carol', 'usdc', '6000000000'), liquidation,
  ]);
  assert.equal(result.accounts.bob.sol.netDeposit, '90000000000');
  assert.equal(result.accounts.bob.usdc.netBorrow, '4525000000');
  assert.equal(result.accounts.carol.sol.netDeposit, '10000000000');
  assert.equal(result.accounts.carol.usdc.netDeposit, '5512500000');
  assert.ok(result.notes.some(note => /利息/.test(note)));
  assert.ok(result.notes.some(note => /f64/.test(note)));
});
