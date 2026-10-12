/** INPUT: PGlite、本地 SQL。 OUTPUT: 重复迁移与回滚断言。 POSITION: EP6 离线测试。 SYNC: 同步 folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pgliteDb } from './db';
import { migrate } from './migrate';
test('migrations run once and create every table and query index', async () => {
  const db = pgliteDb();
  try {
    await migrate(db); await migrate(db);
    assert.equal((await db.query('SELECT * FROM schema_migrations')).rowCount, 3);
    const tables = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).rows.map(r => r.tablename);
    for (const name of ['raw_tx', 'ingest_cursor', 'instructions', 'events', 'account_states', 'labels']) assert.ok(tables.includes(name));
    const indexes = (await db.query("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'")).rows.map(r => r.indexname);
    for (const name of ['instructions_name_idx', 'events_name_idx', 'events_slot_idx', 'events_account_idx']) assert.ok(indexes.includes(name));
  } finally { await db.close(); }
});
test('one failing SQL file rolls back its DDL and migration record', async () => {
  const db = pgliteDb(), directory = await mkdtemp(join(tmpdir(), 'm4-migrations-'));
  try {
    await writeFile(join(directory, '001_bad.sql'), 'CREATE TABLE accidental(n int); SELECT missing_column;');
    await assert.rejects(migrate(db, directory), /missing_column/);
    assert.equal((await db.query("SELECT to_regclass('accidental') AS name")).rows[0].name, null);
    assert.equal((await db.query('SELECT * FROM schema_migrations')).rowCount, 0);
  } finally { await db.close(); await rm(directory, { recursive: true }); }
});
