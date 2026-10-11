/**
 * INPUT: 真实 RPC fixtures、步骤/事件记录与测试专用 Anchor coder。
 * OUTPUT: 参数交叉校验、步骤金标准和账户角色断言。
 * POSITION: M2 真实交易的离线验收。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import anchor from '@coral-xyz/anchor';
import rawIdl from './idl/marginfi.idl.json';
import { decodeBase58 } from '../core/base58';
import { marginfiIdl } from './idl';
import { decodeTransaction } from './transaction';
import { run, signatures, transactions, transactionFor } from './test-utils';

function normalize(value: unknown): unknown {
  if (anchor.BN.isBN(value) || typeof value === 'bigint' || typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && 'toBase58' in value) return (value as { toBase58(): string }).toBase58();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, normalize(v)]));
  return value;
}

test('32 笔原始 RPC fixture 的每条 marginfi 指令与 Anchor name/args 一致', () => {
  const coder = new anchor.BorshCoder(rawIdl as anchor.Idl);
  assert.equal(signatures.length, 32);
  let checked = 0;
  for (const signature of signatures) {
    const tx = transactions[signature], before = structuredClone(tx);
    const decoded = decodeTransaction(tx, marginfiIdl);
    const keys = [...tx.transaction.message.accountKeys, ...(tx.meta?.loadedAddresses?.writable ?? []),
      ...(tx.meta?.loadedAddresses?.readonly ?? [])];
    const raw = [...tx.transaction.message.instructions,
      ...(tx.meta?.innerInstructions ?? []).flatMap(group => group.instructions)]
      .filter(ix => keys[ix.programIdIndex] === marginfiIdl.address);
    assert.equal(decoded.length, raw.length, signature);
    for (const entry of decoded) {
      const ix = entry.innerIndex === null ? tx.transaction.message.instructions[entry.ixIndex]
        : tx.meta!.innerInstructions!.find(group => group.index === entry.ixIndex)!.instructions[entry.innerIndex];
      const expected = coder.instruction.decode(decodeBase58(ix.data));
      assert.ok(expected); assert.ok('args' in entry, JSON.stringify(normalize(entry)));
      assert.equal(entry.name, expected.name);
      assert.deepEqual(normalize(entry.args), normalize(expected.data), `${signature}: ${entry.name}`);
      assert.equal(entry.signature, signature); checked++;
    }
    assert.deepEqual(tx, before, '解码不得改变原始交易');
  }
  assert.equal(checked, 18);
});

// 依据步骤语义与 m1-run.json 的事件手写。借贷函数内发出的计息事件不是独立指令。
const golden: Record<string, string[]> = {
  'mint tUSDC to alice': [], 'mint tUSDC to bob': [], 'mint tUSDC to carol': [],
  'mint tSOL to alice': [], 'mint tSOL to bob': [], 'mint tSOL to carol': [],
  'write mock feed tUSDC = $1': [], 'write mock feed tSOL = $100': [], 'write mock feed tSOL = $50': [],
  'init global fee state': ['init_global_fee_state'],
  'create group': ['marginfi_group_initialize'],
  'add bank tUSDC': ['lending_pool_add_bank'], 'add bank tSOL': ['lending_pool_add_bank'],
  'configure oracle tUSDC': ['lending_pool_configure_bank_oracle'],
  'configure oracle tSOL': ['lending_pool_configure_bank_oracle'],
  'create marginfi account alice': ['marginfi_account_initialize'],
  'create marginfi account bob': ['marginfi_account_initialize'],
  'create marginfi account carol': ['marginfi_account_initialize'],
  'alice deposit 10000 tUSDC': ['lending_account_deposit'], 'bob deposit 100 tSOL': ['lending_account_deposit'],
  'bob borrow 5000 tUSDC': ['lending_account_borrow'],
  'accrue interest tUSDC': ['lending_pool_accrue_bank_interest'], 'accrue interest tSOL': ['lending_pool_accrue_bank_interest'],
  'carol deposit 6000 tUSDC': ['lending_account_deposit'],
  'carol liquidate bob 10 tSOL': ['lending_account_liquidate'],
  'alice withdraw 1000 tUSDC': ['lending_account_withdraw'], 'bob repay all tUSDC': ['lending_account_repay'],
};
const eventFor: Record<string, string> = {
  marginfi_group_initialize: 'MarginfiGroupCreateEvent', lending_pool_add_bank: 'LendingPoolBankCreateEvent',
  lending_pool_configure_bank_oracle: 'LendingPoolBankConfigureOracleEvent',
  marginfi_account_initialize: 'MarginfiAccountCreateEvent', lending_account_deposit: 'LendingAccountDepositEvent',
  lending_account_borrow: 'LendingAccountBorrowEvent', lending_pool_accrue_bank_interest: 'LendingPoolBankAccrueInterestEvent',
  lending_account_liquidate: 'LendingAccountLiquidateEvent', lending_account_withdraw: 'LendingAccountWithdrawEvent',
  lending_account_repay: 'LendingAccountRepayEvent',
};
test('每个剧本步骤的手写指令金标准与独立事件记录一致', () => {
  assert.deepEqual(new Set(Object.keys(golden)), new Set(run.steps.map(step => step.label)));
  for (const step of run.steps) {
    const expected = golden[step.label];
    assert.deepEqual(step.signatures.flatMap(signature => decodeTransaction(transactions[signature], marginfiIdl).map(ix => ix.name)), expected, step.label);
    const events = run.events.filter(event => step.signatures.includes(event.signature)).map(event => event.name);
    for (const name of expected) if (eventFor[name]) assert.ok(events.includes(eventFor[name]), step.label);
    if (expected.length === 0) assert.deepEqual(events, [], step.label);
  }
});

test('borrow / liquidate 的账户角色和 remaining 精确对应运行地址', () => {
  const a = run.addresses;
  const [borrow] = decodeTransaction(transactionFor('bob borrow 5000 tUSDC'), marginfiIdl);
  assert.ok('accounts' in borrow && 'args' in borrow);
  assert.equal(borrow.accounts.marginfi_group, a.group);
  assert.equal(borrow.accounts.marginfi_account, a.marginfiAccounts.bob);
  assert.equal(borrow.accounts.bank, a.banks.tUSDC); assert.equal(borrow.accounts.signer, a.actors.bob);
  assert.equal(borrow.args.amount, 5_000_000_000n);
  assert.deepEqual(borrow.remaining, [a.banks.tSOL, a.feeds.tSOL, a.banks.tUSDC, a.feeds.tUSDC]);
  const [liquidate] = decodeTransaction(transactionFor('carol liquidate bob 10 tSOL'), marginfiIdl);
  assert.ok('accounts' in liquidate && 'args' in liquidate);
  assert.equal(liquidate.accounts.group, a.group);
  assert.equal(liquidate.accounts.liquidator_marginfi_account, a.marginfiAccounts.carol);
  assert.equal(liquidate.accounts.liquidatee_marginfi_account, a.marginfiAccounts.bob);
  assert.equal(liquidate.accounts.asset_bank, a.banks.tSOL); assert.equal(liquidate.accounts.liab_bank, a.banks.tUSDC);
  assert.equal(liquidate.accounts.signer, a.actors.carol); assert.equal(liquidate.args.asset_amount, 10_000_000_000n);
  assert.equal(liquidate.remaining.length, 10);
  assert.deepEqual(liquidate.remaining, [a.feeds.tSOL, a.feeds.tUSDC, a.banks.tUSDC, a.feeds.tUSDC,
    a.banks.tSOL, a.feeds.tSOL, a.banks.tSOL, a.feeds.tSOL, a.banks.tUSDC, a.feeds.tUSDC]);
});
