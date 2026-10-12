/** INPUT: PGlite、假 RPC、会抛错 Db 包装。 OUTPUT: slot 原子性及崩溃恢复断言。 POSITION: EP6 测试。 SYNC: 同步 folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../../fixtures/m1-transactions.json';
import { marginfiIdl } from '../decoder/idl';
import { pgliteDb, type Db } from '../store/db';
import { migrate } from '../store/migrate';
import { tailOnce } from './tail';
import type { RawTransaction } from './rpc';
const source = Object.values(fixture.transactions).find(tx => tx.transaction.message.accountKeys.includes(marginfiIdl.address))!;
function transaction(signature: string) { const tx = structuredClone(source) as RawTransaction; tx.transaction.signatures = [signature]; return tx; }
test('mid-slot write crash rolls back rows and cursor; restart has no gaps or duplicates', async () => {
  const db = pgliteDb();
  try {
    await migrate(db);
    const rpc = { getSlot: async () => 12, getBlock: async (slot: number) => ({ blockTime: slot,
      transactions: slot === 11 ? [transaction('a'), transaction('b')] : [transaction('c')] }) };
    let writes = 0;
    const broken: Db = { query: db.query, transaction: fn => db.transaction(tx => fn({ ...tx, query: async (sql, params) => {
      if (sql.startsWith('INSERT INTO raw_tx') && ++writes === 2) throw Error('crash mid-slot');
      return tx.query(sql, params);
    } })) };
    await assert.rejects(tailOnce(broken, rpc, marginfiIdl.address, 11), /crash/);
    assert.equal((await db.query('SELECT * FROM raw_tx')).rowCount, 0);
    assert.equal((await db.query('SELECT * FROM ingest_cursor')).rowCount, 0);
    await tailOnce(db, rpc, marginfiIdl.address, 11);
    assert.deepEqual((await db.query('SELECT signature FROM raw_tx ORDER BY signature')).rows, [{ signature: 'a' }, { signature: 'b' }, { signature: 'c' }]);
    assert.equal((await db.query('SELECT slot FROM ingest_cursor')).rows[0].slot, '12');
    await tailOnce(db, rpc, marginfiIdl.address);
    assert.equal((await db.query('SELECT * FROM raw_tx')).rowCount, 3);
    assert.equal((await db.query('SELECT slot FROM ingest_cursor')).rows[0].slot, '12');
  } finally { await db.close(); }
});
test('cursor update failure rolls back the transaction insert', async () => {
  const db = pgliteDb();
  try {
    await migrate(db); await db.query("INSERT INTO ingest_cursor VALUES ('blocks', 10)");
    const broken: Db = { query: db.query, transaction: fn => db.transaction(tx => fn({ ...tx, query: async (sql, params) => {
      if (sql.startsWith('UPDATE ingest_cursor')) throw Error('cursor crash'); return tx.query(sql, params);
    } })) };
    const rpc = { getSlot: async () => 11, getBlock: async () => ({ blockTime: 1, transactions: [transaction('a')] }) };
    await assert.rejects(tailOnce(broken, rpc, marginfiIdl.address), /cursor crash/);
    assert.equal((await db.query('SELECT * FROM raw_tx')).rowCount, 0);
    assert.equal((await db.query('SELECT slot FROM ingest_cursor')).rows[0].slot, '10');
    await tailOnce(db, rpc, marginfiIdl.address);
    assert.equal((await db.query('SELECT * FROM raw_tx')).rowCount, 1);
  } finally { await db.close(); }
});
import { RpcError } from './rpc';
test('empty and skipped slots commit progress; unavailable slot stops after prior committed slot', async () => {
  const db = pgliteDb();
  try {
    await migrate(db);
    const rpc = { getSlot: async () => 13, getBlock: async (slot: number) => {
      if (slot === 12) throw new RpcError(-32007, 'skipped');
      if (slot === 13) throw new RpcError(-32009, 'missing history');
      return { blockTime: null, transactions: [] };
    } };
    await assert.rejects(tailOnce(db, rpc, marginfiIdl.address, 11), /history/);
    assert.equal((await db.query('SELECT slot FROM ingest_cursor')).rows[0].slot, '12');
    assert.equal((await db.query('SELECT * FROM raw_tx')).rowCount, 0);
  } finally { await db.close(); }
});
