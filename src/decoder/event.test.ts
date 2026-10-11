/**
 * INPUT: RPC logs、Anchor EventParser 记录与合成调用栈。
 * OUTPUT: 25 个事件、顶层归属、失败/未知/截断的断言。
 * POSITION: EP5 事件离线验收。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeEvents } from './event';
import { marginfiIdl } from './idl';
import { decodeTransaction, type RpcTransaction } from './transaction';
import { run, signatures, transactions } from './test-utils';
import { normalize } from './m3-test-utils';

const allowed: Record<string, string[]> = {
  MarginfiGroupCreateEvent: ['marginfi_group_initialize'], LendingPoolBankCreateEvent: ['lending_pool_add_bank'],
  LendingPoolBankConfigureOracleEvent: ['lending_pool_configure_bank_oracle'], MarginfiAccountCreateEvent: ['marginfi_account_initialize'],
  LendingAccountDepositEvent: ['lending_account_deposit'], LendingAccountBorrowEvent: ['lending_account_borrow'],
  LendingAccountWithdrawEvent: ['lending_account_withdraw'], LendingAccountRepayEvent: ['lending_account_repay'],
  LendingAccountLiquidateEvent: ['lending_account_liquidate'],
  LendingPoolBankAccrueInterestEvent: ['lending_pool_accrue_bank_interest', 'lending_account_deposit', 'lending_account_borrow',
    'lending_account_withdraw', 'lending_account_repay', 'lending_account_liquidate'],
};
test('32 笔 fixture 的 25 个事件与运行时 EventParser 逐条一致，归属正确', () => {
  const all = signatures.flatMap(signature => {
    const tx = transactions[signature], before = structuredClone(tx);
    const result = decodeEvents(tx, marginfiIdl);
    assert.equal(result.truncated, false); assert.deepEqual(tx, before);
    for (const e of result.events) {
      const ix = decodeTransaction(tx, marginfiIdl).find(i => i.ixIndex === e.ixIndex && i.innerIndex === null);
      assert.ok(ix && allowed[e.name]?.includes(ix.name), `${e.name}: ${ix?.name}`);
      assert.match(tx.meta!.logMessages![e.logIndex], /^Program data: /);
    }
    return result.events.map(({ signature, name, data }) => ({ signature, name, data: normalize(data, true) }));
  });
  assert.equal(all.length, 25);
  assert.deepEqual(all, run.events.map(e => ({ ...e, data: normalize(e.data) })));
});
const program = marginfiIdl.address, other = '11111111111111111111111111111111';
function tx(logs: string[], err: unknown = null): RpcTransaction {
  return { transaction: { signatures: ['synthetic'], message: { accountKeys: [], instructions: [] } }, meta: { logMessages: logs, err } };
}
const unknown = `Program data: ${Buffer.alloc(9, 255).toString('base64')}`;
test('调用栈隔离其他程序 data，支持 marginfi CPI 与 success/failed 出栈', () => {
  const result = decodeEvents(tx([`Program ${other} invoke [1]`, unknown, `Program ${program} invoke [2]`, unknown,
    `Program ${other} invoke [3]`, unknown, `Program ${other} failed: custom program error`, unknown,
    `Program ${program} success`, unknown, `Program ${other} success`,
    `Program ${program} invoke [1]`, unknown, `Program ${program} success`]), marginfiIdl);
  assert.deepEqual(result.events.map(e => [e.name, e.ixIndex, e.logIndex]), [['unknown', 0, 3], ['unknown', 0, 7], ['unknown', 1, 12]]);
  assert.equal(result.events[0].data, Buffer.alloc(9, 255).toString('base64'));
});
test('失败交易不产出事件；截断元数据即使没有事件也保留', () => {
  assert.deepEqual(decodeEvents(tx([`Program ${program} invoke [1]`, unknown], { InstructionError: [0, 'Custom'] }), marginfiIdl).events, []);
  const logs = [`Program ${program} invoke [1]`, unknown, 'Log truncated', unknown];
  const result = decodeEvents(tx(logs), marginfiIdl);
  assert.equal(result.truncated, true); assert.equal(result.events.length, 1);
  assert.equal(decodeEvents(tx(['Log truncated']), marginfiIdl).truncated, true);
  assert.deepEqual(decodeEvents(tx([]), marginfiIdl), { events: [], truncated: false });
});
test('损坏 base64、不足 discriminator 和已知事件短 payload 被隔离', () => {
  const discriminator = Buffer.from(marginfiIdl.events![0].discriminator).toString('base64');
  const result = decodeEvents(tx([`Program ${program} invoke [1]`, 'Program data: !!!', 'Program data: AA==', `Program data: ${discriminator}`]), marginfiIdl);
  assert.equal(result.events.length, 3);
  assert.ok(result.events.every(e => 'decodeError' in e));
});

test('普通 Program log 文本中的 Log truncated 不是运行时截断标记', () => {
  const result = decodeEvents(tx([`Program ${program} invoke [1]`, 'Program log: Log truncated', unknown]), marginfiIdl);
  assert.equal(result.truncated, false); assert.equal(result.events.length, 1);
});
