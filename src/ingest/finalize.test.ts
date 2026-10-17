/** INPUT: PGlite 与假 RPC。 OUTPUT: 乐观入库与终局清扫的断言。 POSITION: EP6 离线测试。 SYNC: folder.md。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fixture from '../../fixtures/m1-transactions.json';
import { marginfiIdl } from '../decoder/idl';
import { pgliteDb } from '../store/db';
import { decodePending } from '../store/decode';
import { migrate } from '../store/migrate';
import { insertRawTx } from '../store/raw';
import { DROP_AFTER_SLOTS, finalizeSweep } from './finalize';
import { Rpc, type RawTransaction } from './rpc';
import { parseIngestArgs } from '../../scripts/ingest-options';

const txs = Object.values(fixture.transactions) as RawTransaction[];
// 取 fixture 里含 marginfi 指令的交易,改签名当成不同交易,这样能验证级联删除解码行
const marginfiTx = txs.find(t => t.transaction.message.instructions.some(i => t.transaction.message.accountKeys[i.programIdIndex] === marginfiIdl.address))!;
const clone = (signature: string, slot: number) => { const t = structuredClone(marginfiTx); t.transaction.signatures[0] = signature; t.slot = slot; return t; };
const sweepRpc = (finalizedSlot: number, statuses: Record<string, { slot: number; confirmationStatus?: string; err: unknown } | null>) => ({
  getFinalizedSlot: async () => finalizedSlot,
  getSignatureStatuses: async (sigs: string[]) => sigs.map(s => statuses[s] ?? null),
});

test('乐观入库的行 finalized=false;迁移前的行(默认值)与显式 true 都是 true', async () => {
  const db = pgliteDb();
  try {
    await migrate(db);
    await insertRawTx(db, clone('optimistic', 100), false);
    await insertRawTx(db, clone('settled', 101));
    const rows = Object.fromEntries((await db.query('SELECT signature, finalized FROM raw_tx')).rows.map(r => [r.signature, r.finalized]));
    assert.deepEqual(rows, { optimistic: false, settled: true });
  } finally { await db.close(); }
});

test('清扫:finalized → 标记终局;confirmed 与观察期内查不到 → 继续等;分叉被丢弃(超过观察期仍查不到)→ 删除并级联删除解码行', async () => {
  const db = pgliteDb();
  try {
    await migrate(db);
    for (const [sig, slot] of [['fin', 1000], ['conf', 1001], ['dead', 1003]] as const) await insertRawTx(db, clone(sig, slot), false);
    await decodePending(db, marginfiIdl);
    assert.ok(Number((await db.query("SELECT count(*) AS n FROM instructions WHERE signature = 'dead'")).rows[0].n) > 0, '被删的交易确实有解码行');
    // finalized slot 刚好过了 dead 的观察期(观察期内不删的情形见下一个测试)
    const finalizedSlot = 1003 + DROP_AFTER_SLOTS;
    const result = await finalizeSweep(db, sweepRpc(finalizedSlot, {
      fin: { slot: 1000, confirmationStatus: 'finalized', err: null },
      conf: { slot: 1001, confirmationStatus: 'confirmed', err: null },
      // dead:查不到
    }));
    assert.deepEqual(result, { finalized: 1, dropped: 1, pending: 1 });
    assert.deepEqual((await db.query('SELECT signature, finalized FROM raw_tx ORDER BY signature')).rows.map(r => [r.signature, r.finalized]),
      [['conf', false], ['fin', true]]);
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM instructions WHERE signature = 'dead'")).rows[0].n), 0, '解码出的指令随外键级联删除');
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM events WHERE signature = 'dead'")).rows[0].n), 0, '事件同样级联删除');
  } finally { await db.close(); }
});

test('清扫:观察期内查不到的不删(负载均衡的 RPC 节点可能落后,误删比晚删糟糕)', async () => {
  const db = pgliteDb();
  try {
    await migrate(db);
    await insertRawTx(db, clone('recent', 5000), false);
    const result = await finalizeSweep(db, sweepRpc(5000 + DROP_AFTER_SLOTS - 1, {}));
    assert.deepEqual(result, { finalized: 0, dropped: 0, pending: 1 });
    assert.equal(Number((await db.query('SELECT count(*) AS n FROM raw_tx')).rows[0].n), 1);
    // 过了观察期才删
    assert.deepEqual(await finalizeSweep(db, sweepRpc(5000 + DROP_AFTER_SLOTS, {})), { finalized: 0, dropped: 1, pending: 0 });
  } finally { await db.close(); }
});

test('清扫:没有待确认的行时不发任何 RPC 请求', async () => {
  const db = pgliteDb();
  try {
    await migrate(db);
    await insertRawTx(db, clone('already', 1));
    let calls = 0;
    const rpc = { getFinalizedSlot: async () => { calls++; return 1; }, getSignatureStatuses: async () => { calls++; return []; } };
    assert.deepEqual(await finalizeSweep(db, rpc), { finalized: 0, dropped: 0, pending: 0 });
    assert.equal(calls, 0);
  } finally { await db.close(); }
});

test('Rpc 的 commitment 选项:默认 finalized,可设 confirmed;判断终局的 getFinalizedSlot 永远是 finalized', async () => {
  const seen: { method: string; commitment?: string }[] = [];
  const fake = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    seen.push({ method: body.method, commitment: JSON.stringify(body.params).match(/"commitment":"(\w+)"/)?.[1] });
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: body.method === 'getSignatureStatuses' ? { value: [] } : 1 }));
  }) as unknown as typeof fetch;
  const confirmed = new Rpc('http://x', { commitment: 'confirmed', fetch: fake }), defaults = new Rpc('http://x', { fetch: fake });
  await confirmed.getSlot(); await confirmed.getSignaturesForAddress('p'); await confirmed.getTransaction('s'); await confirmed.getMultipleAccounts(['a']);
  await confirmed.getFinalizedSlot(); await defaults.getSlot();
  assert.deepEqual(seen.map(s => s.commitment), ['confirmed', 'confirmed', 'confirmed', 'confirmed', 'finalized', 'finalized']);
});

test('命令行:--commitment confirmed 只允许用于 --follow;回填和扫区间只认 finalized', () => {
  assert.deepEqual(parseIngestArgs(['--follow', '--commitment', 'confirmed']), { mode: 'follow', once: false, commitment: 'confirmed' });
  assert.deepEqual(parseIngestArgs(['--follow', '--commitment', 'finalized']), { mode: 'follow', once: false, commitment: 'finalized' });
  for (const args of [['--backfill', '--commitment', 'confirmed'], ['--tail', '--commitment', 'confirmed'], ['--follow', '--commitment', 'processed'], ['--follow', '--commitment']])
    assert.throws(() => parseIngestArgs(args), /用法|commitment/);
});
