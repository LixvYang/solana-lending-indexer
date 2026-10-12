/** INPUT: 真实 fixture 交易与一笔失败交易的合成副本。 OUTPUT: err 列 SQL NULL / 非 NULL 断言。 POSITION: EP6 离线测试。 SYNC: 同步 folder.md。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fixture from '../../fixtures/m1-transactions.json';
import { pgliteDb } from './db';
import { migrate } from './migrate';
import { insertRawTx } from './raw';
import type { RawTransaction } from '../ingest/rpc';

test('成功交易 err 是 SQL NULL，失败交易 err 非 NULL(不是 JSONB null)', async () => {
  const db = pgliteDb();
  await migrate(db);
  const ok = (fixture.transactions as Record<string, unknown>)[fixture.signatures[0]] as RawTransaction;
  const failed = structuredClone(ok);
  failed.transaction.signatures[0] = 'failedSignatureForTest';
  failed.meta = { ...failed.meta, err: { InstructionError: [1, { Custom: 6001 }] } } as RawTransaction['meta'];
  await insertRawTx(db, ok);
  await insertRawTx(db, failed);
  const rows = (await db.query('SELECT signature, err IS NULL AS no_err FROM raw_tx')).rows;
  const noErr = Object.fromEntries(rows.map(r => [r.signature as string, r.no_err]));
  assert.deepEqual(noErr, { [ok.transaction.signatures[0]]: true, failedSignatureForTest: false });
  assert.equal((await db.query('SELECT count(*) AS n FROM raw_tx WHERE jsonb_typeof(err) = \'null\'')).rows[0].n, '0');
});
