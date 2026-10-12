/** INPUT: PGlite/分页 RPC 替身。 OUTPUT: 到头回填、已有签名跳过、失败事实保留。 POSITION: EP6 测试。 SYNC: 同步 folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../../fixtures/m1-transactions.json';
import { pgliteDb } from '../store/db';
import { migrate } from '../store/migrate';
import { insertRawTx } from '../store/raw';
import { backfill } from './signatures';
import type { RawTransaction } from './rpc';
test('backfill walks through known signatures to end, fetches only new, and keeps failed tx', async () => {
  const db = pgliteDb(), source = Object.values(fixture.transactions)[0] as RawTransaction;
  const old = structuredClone(source), failed = structuredClone(source); old.transaction.signatures = ['old'];
  failed.transaction.signatures = ['failed']; failed.meta!.err = { failed: true };
  try {
    await migrate(db); await insertRawTx(db, old);
    const fetched: string[] = [], before: (string | undefined)[] = [];
    const rpc = { getSignaturesForAddress: async (_program: string, cursor?: string) => {
      before.push(cursor); return cursor === undefined ? [{ signature: 'old', err: null }] : cursor === 'old' ? [{ signature: 'failed', err: failed.meta!.err }] : [];
    }, getTransaction: async (signature: string) => { fetched.push(signature); return failed; } };
    assert.equal(await backfill(db, rpc, 'program'), 1);
    assert.deepEqual(before, [undefined, 'old', 'failed']); assert.deepEqual(fetched, ['failed']);
    assert.equal(await backfill(db, rpc, 'program'), 0);
    assert.equal((await db.query('SELECT * FROM raw_tx')).rowCount, 2);
    assert.deepEqual((await db.query("SELECT err FROM raw_tx WHERE signature = 'failed'")).rows[0].err, failed.meta!.err);
  } finally { await db.close(); }
});
test('unavailable getTransaction is an error so backfill can retry later', async () => {
  const db = pgliteDb();
  try { await migrate(db); await assert.rejects(backfill(db, { getSignaturesForAddress: async () => [{ signature: 'missing', err: null }], getTransaction: async () => null }, 'program'), /unavailable/); }
  finally { await db.close(); }
});

// 跟随模式：每轮只需要一次 getSignaturesForAddress，遇到已知签名就停，不翻整个历史。
test('stopAtKnown：一页里出现已入库的签名，处理完本页就停，不再请求更旧的分页', async () => {
  const db = pgliteDb(), source = Object.values(fixture.transactions)[0] as RawTransaction;
  const known = structuredClone(source), fresh = structuredClone(source);
  known.transaction.signatures = ['known']; fresh.transaction.signatures = ['fresh'];
  try {
    await migrate(db); await insertRawTx(db, known);
    const requested: (string | undefined)[] = [], fetched: string[] = [];
    const rpc = {
      getSignaturesForAddress: async (_p: string, cursor?: string) => {
        requested.push(cursor);
        // 新 → 旧：第一页 [fresh, known]，若继续翻页会有第二页(不应被请求)
        return cursor === undefined ? [{ signature: 'fresh', err: null }, { signature: 'known', err: null }] : [{ signature: 'older', err: null }];
      },
      getTransaction: async (signature: string) => { fetched.push(signature); return fresh; },
    };
    assert.equal(await backfill(db, rpc, 'program', { stopAtKnown: true }), 1);
    assert.deepEqual(requested, [undefined]); assert.deepEqual(fetched, ['fresh']);
    // 不带这个选项的回填仍然翻完全部分页(不假设入库连续)
    requested.length = 0;
    await assert.rejects(backfill(db, rpc, 'program'), /.*/); // 第二页的 'older' 会被取回并因签名不一致而报错——证明确实继续翻了页
    assert.ok(requested.length > 1);
  } finally { await db.close(); }
});
