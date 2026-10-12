/** INPUT: PGlite 与 Pool 替身。 OUTPUT: bigint/事务适配断言。 POSITION: EP6 离线测试。 SYNC: 同步 folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { pgliteDb, pgDb } from './db';

test('Db normalizes BIGINT without changing JSON strings, and rolls back', async () => {
  const db = pgliteDb();
  try {
    assert.deepEqual((await db.query("SELECT 9223372036854775807::bigint AS n, '{\"n\":\"123\"}'::jsonb AS j")).rows,
      [{ n: '9223372036854775807', j: { n: '123' } }]);
    assert.deepEqual((await db.query('SELECT 123::bigint AS n, NULL::bigint AS empty')).rows, [{ n: '123', empty: null }]);
    await db.query('CREATE TABLE numbers(n bigint)');
    await assert.rejects(db.transaction(async tx => { await tx.query('INSERT INTO numbers VALUES (1)'); throw Error('crash'); }), /crash/);
    assert.equal((await db.query('SELECT * FROM numbers')).rowCount, 0);
    const fake = { query: async () => ({ rows: [{ n: 9223372036854775807n }], rowCount: 1 }) } as unknown as Pool;
    assert.deepEqual((await pgDb(fake).query('SELECT n')).rows, [{ n: '9223372036854775807' }]);
    const defaultPg = { query: async () => ({ rows: [{ n: '9223372036854775807' }], rowCount: 1 }) } as unknown as Pool;
    assert.deepEqual((await pgDb(defaultPg).query('SELECT n')).rows, [{ n: '9223372036854775807' }]);
  } finally { await db.close(); }
});
test('pg transaction uses one acquired client, rolls back, and always releases it', async () => {
  const calls: string[] = [];
  const client = { query: async (sql: string) => { calls.push(sql); return { rows: [{ n: 123 }], fields: [{ name: 'n', dataTypeID: 20 }], rowCount: 1 }; }, release: () => calls.push('release') };
  const pool = { totalCount: 1, query: async () => { throw Error('must use acquired client'); }, connect: async () => client } as unknown as Pool;
  const db = pgDb(pool);
  await db.transaction(async tx => { assert.deepEqual((await tx.query('SELECT n')).rows, [{ n: '123' }]); });
  assert.deepEqual(calls, ['BEGIN', 'SELECT n', 'COMMIT', 'release']); calls.length = 0;
  await assert.rejects(db.transaction(async tx => { await tx.query('WRITE'); throw Error('crash'); }), /crash/);
  assert.deepEqual(calls, ['BEGIN', 'WRITE', 'ROLLBACK', 'release']);
});

// 真实 Postgres 才暴露的差异：pg 对无参数的多语句 SQL(迁移文件)返回结果数组而不是单个结果。
test('pg 多语句 SQL 返回数组时取最后一条结果', async () => {
  const pool = { query: async () => [{ rows: [], rowCount: null }, { rows: [{ n: 7n }], rowCount: 1 }] } as unknown as Pool;
  assert.deepEqual((await pgDb(pool).query('CREATE TABLE a(); SELECT 7 AS n')).rows, [{ n: '7' }]);
});
