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
