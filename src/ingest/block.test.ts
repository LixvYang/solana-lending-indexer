/** INPUT: fixture 构造区块、合成 CPI/v0。 OUTPUT: 过滤与 getTransaction 等形断言。 POSITION: EP6 离线测试。 SYNC: 同步 folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../../fixtures/m1-transactions.json';
import { marginfiIdl } from '../decoder/idl';
import { fetchProgramTxs } from './block';
import { RpcError, type RawTransaction, type RpcBlock } from './rpc';
const program = marginfiIdl.address;
test('getBlock normalization preserves fixture transaction/meta and supplies slot/time/version', async () => {
  const txs = Object.values(fixture.transactions) as RawTransaction[];
  for (const source of txs) {
    const { slot, blockTime, ...entry } = source;
    const result = await fetchProgramTxs({ getBlock: async () => ({ blockTime, transactions: [entry] }) }, slot, program);
    if (result.length) assert.deepEqual(result[0], source);
  }
});
test('filters unrelated transactions, keeps inner-only and loadedAddresses v0 calls', async () => {
  const base = { transaction: { signatures: ['unrelated'], message: { accountKeys: ['foreign'], instructions: [] } }, meta: { err: null } };
  const inner = structuredClone(base) as RpcBlock['transactions'][number]; inner.transaction.signatures = ['inner'];
  inner.transaction.message.accountKeys.push(program);
  inner.meta!.innerInstructions = [{ index: 0, instructions: [{ programIdIndex: 1, accounts: [], data: '' }] }];
  const v0 = structuredClone(base) as RpcBlock['transactions'][number]; v0.transaction.signatures = ['v0']; v0.version = 0;
  v0.meta!.loadedAddresses = { writable: ['other'], readonly: [program] };
  v0.transaction.message.instructions.push({ programIdIndex: 2, accounts: [], data: '' });
  const result = await fetchProgramTxs({ getBlock: async () => ({ blockTime: 123, transactions: [base, inner, v0] }) }, 42, program);
  assert.deepEqual(result.map(tx => tx.transaction.signatures[0]), ['inner', 'v0']);
  assert.equal(result[0].slot, 42); assert.equal(result[0].blockTime, 123);
  assert.equal(result[0].version, 'legacy'); assert.equal(result[1].version, 0);
  assert.deepEqual(result[1].meta, v0.meta);
});
test('only known skipped slots are empty; unavailable history and null block do not advance', async () => {
  assert.deepEqual(await fetchProgramTxs({ getBlock: async () => { throw new RpcError(-32007, 'Slot skipped'); } }, 1, program), []);
  await assert.rejects(fetchProgramTxs({ getBlock: async () => { throw new RpcError(-32009, 'missing in long-term storage'); } }, 1, program), /storage/);
  await assert.rejects(fetchProgramTxs({ getBlock: async () => null }, 1, program), /unavailable/);
});

// 真实 devnet 区块(slot 509953364，裁剪后 11 笔)：含清算交易和 5 笔 v1 交易。
// 这是 v1 问题的回归测试：旧实现用 maxSupportedTransactionVersion=0，整块会报错。
import realBlock from '../../fixtures/m1-block-509953364.json';
test('真实区块：只留下清算交易，且与 getTransaction 的结果在 transaction/meta 上完全一致，v1 交易不影响', async () => {
  const block = realBlock.block as unknown as RpcBlock;
  assert.equal(block.transactions.filter(t => t.version === 1).length, 5);
  const result = await fetchProgramTxs({ getBlock: async () => block }, realBlock.slot, program);
  assert.equal(result.length, 1);
  const viaSignature = (fixture.transactions as Record<string, RawTransaction>)[result[0].transaction.signatures[0]];
  assert.deepEqual(result[0].transaction, viaSignature.transaction);
  // 已知的唯一差异(真实数据实测)：getBlock(rewards:false)的 meta.rewards 是 null，getTransaction 的是 []。
  // 解码器不读 rewards，所以同一笔交易无论经哪条路入库，解码结果相同；但 raw_tx 的 JSON 并非逐字节相同。
  const rewardsOf = (tx: RawTransaction) => (tx.meta as unknown as { rewards: unknown }).rewards;
  assert.equal(rewardsOf(result[0]), null);
  assert.deepEqual(rewardsOf(viaSignature), []);
  assert.deepEqual({ ...result[0].meta, rewards: undefined }, { ...viaSignature.meta, rewards: undefined });
  assert.equal(result[0].slot, viaSignature.slot);
  assert.equal(result[0].blockTime, viaSignature.blockTime);
});
test('形状不认识的交易：与程序无关则跳过，提到该程序则报错而不是静默漏掉', async () => {
  const strange = { version: 2, transaction: { signatures: ['x'], message: { somethingNew: [] } }, meta: null } as unknown as RpcBlock['transactions'][number];
  assert.deepEqual(await fetchProgramTxs({ getBlock: async () => ({ blockTime: 1, transactions: [strange] }) }, 1, program), []);
  const relevant = structuredClone(strange) as unknown as { transaction: { message: Record<string, unknown> } };
  relevant.transaction.message.somethingNew = [program];
  await assert.rejects(fetchProgramTxs({ getBlock: async () => ({ blockTime: 1, transactions: [relevant as unknown as RpcBlock['transactions'][number]] }) }, 1, program), /cannot parse tx version 2/);
});
