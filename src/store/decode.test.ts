/** INPUT: fixtures/PGlite。 OUTPUT: 幂等、重放、版本、独立基准断言。 POSITION: EP6 集成测试。 SYNC: 同步 folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../../fixtures/m1-transactions.json';
import { run } from '../decoder/test-utils';
import { marginfiIdl } from '../decoder/idl';
import { pgliteDb, type Db } from './db';
import { migrate } from './migrate';
import { insertRawTx } from './raw';
import { decodePending, rebuildDecoded } from './decode';
import type { RawTransaction } from '../ingest/rpc';
import { DECODER_VERSION } from '../decoder/version';
const transactions = Object.values(fixture.transactions) as RawTransaction[];
async function dump(db: Db) {
  return { instructions: (await db.query('SELECT * FROM instructions ORDER BY signature, ix_index, inner_index')).rows,
    events: (await db.query('SELECT * FROM events ORDER BY signature, log_index')).rows };
}
test('32 raw transactions twice, decode twice, rebuild and old-version-only upgrade are identical', async () => {
  const db = pgliteDb();
  try {
    await migrate(db);
    for (const tx of transactions) assert.equal(await insertRawTx(db, tx), true);
    for (const tx of transactions) assert.equal(await insertRawTx(db, tx), false);
    assert.equal((await db.query('SELECT * FROM raw_tx')).rowCount, 32);
    assert.equal(await decodePending(db, marginfiIdl), 32);
    const expected = await dump(db);
    assert.equal(expected.instructions.length, 18); assert.equal(expected.events.length, 25);
    assert.equal(await decodePending(db, marginfiIdl), 0);
    assert.deepEqual(await dump(db), expected);
    await db.query("INSERT INTO events SELECT signature, 99999, ix_index, slot, block_time, 'stale', data, truncated FROM events LIMIT 1");
    await rebuildDecoded(db, marginfiIdl);
    assert.deepEqual(await dump(db), expected);
    // 模拟版本升级后：部分行已被新版本 worker 解码，只重做剩下旧版本。
    await db.query('UPDATE raw_tx SET decoded_version = $1 WHERE signature = $2', [DECODER_VERSION - 1, transactions[0].transaction.signatures[0]]);
    assert.equal(await decodePending(db, marginfiIdl), 1);
    assert.deepEqual(await dump(db), expected);
    await db.query('DELETE FROM raw_tx');
    for (const tx of transactions) await insertRawTx(db, tx);
    await decodePending(db, marginfiIdl);
    assert.deepEqual(await dump(db), expected);
  } finally { await db.close(); }
});
test('stored instruction counts and event names agree with independent scenario steps/events', async () => {
  const db = pgliteDb();
  try {
    await migrate(db); for (const tx of transactions) await insertRawTx(db, tx);
    await decodePending(db, marginfiIdl);
    const expected: Record<string, number> = { marginfi_group_initialize: 1, lending_pool_add_bank: 2,
      lending_pool_configure_bank_oracle: 2, marginfi_account_initialize: 3, lending_account_deposit: 3,
      lending_account_borrow: 1, lending_account_repay: 1, lending_account_withdraw: 1,
      lending_account_liquidate: 1, lending_pool_accrue_bank_interest: 2, init_global_fee_state: 1 };
    const rows = (await db.query('SELECT name, count(*) AS count FROM instructions GROUP BY name')).rows;
    assert.deepEqual(Object.fromEntries(rows.map(row => [row.name, Number(row.count)])), expected);
    for (const step of run.steps) {
      if (/deposit|borrow|repay|withdraw|liquidate|accrue/.test(step.label)) {
        assert.equal((await db.query('SELECT * FROM instructions WHERE signature = $1', [step.signatures[0]])).rowCount, 1, step.label);
      }
    }
    const events = (await db.query('SELECT signature, name FROM events ORDER BY slot, log_index')).rows;
    assert.deepEqual(events, run.events.map(event => ({ signature: event.signature, name: event.name })));
  } finally { await db.close(); }
});
test('failed transactions keep instructions/err but have no events; unknown bytes are retained', async () => {
  const db = pgliteDb();
  try {
    await migrate(db);
    const source = transactions.find(tx => tx.meta?.logMessages?.some(log => log.startsWith('Program data: ')))!;
    const tx = structuredClone(source); tx.meta!.err = { InstructionError: [0, 'Custom'] };
    await insertRawTx(db, tx); await decodePending(db, marginfiIdl);
    assert.deepEqual((await db.query('SELECT err FROM raw_tx')).rows[0].err, tx.meta!.err);
    assert.ok((await db.query('SELECT * FROM instructions')).rowCount > 0);
    assert.equal((await db.query('SELECT * FROM events')).rowCount, 0);
  } finally { await db.close(); }
});
test('decoder transaction crash leaves no partial derived rows or version markers', async () => {
  const db = pgliteDb();
  try {
    await migrate(db); for (const raw of transactions) await insertRawTx(db, raw);
    const broken: Db = { query: db.query, transaction: fn => db.transaction(tx => fn({ ...tx, query: async (sql, params) => {
      if (sql.startsWith('INSERT INTO events')) throw Error('decode crash'); return tx.query(sql, params);
    } })) };
    await assert.rejects(decodePending(broken, marginfiIdl), /decode crash/);
    assert.deepEqual(await dump(db), { instructions: [], events: [] });
    assert.equal((await db.query('SELECT * FROM raw_tx WHERE decoded_version IS NOT NULL')).rowCount, 0);
    await decodePending(db, marginfiIdl); assert.equal((await dump(db)).events.length, 25);
  } finally { await db.close(); }
});
test('upgrading stale rows removes obsolete instructions/events while current rows stay untouched', async () => {
  const db = pgliteDb();
  try {
    await migrate(db); for (const raw of transactions) await insertRawTx(db, raw); await decodePending(db, marginfiIdl);
    const old = (await db.query('SELECT signature FROM instructions ORDER BY signature LIMIT 1')).rows[0].signature;
    await db.query('UPDATE raw_tx SET decoded_version = $1 WHERE signature = $2', [DECODER_VERSION - 1, old]);
    await db.query("INSERT INTO instructions SELECT signature, 99999, -1, slot, block_time, stack_height, 'obsolete', args, accounts, remaining, decode_error FROM instructions WHERE signature = $1 LIMIT 1", [old]);
    await db.query("INSERT INTO events SELECT signature, 99999, ix_index, slot, block_time, 'obsolete', data, truncated FROM events WHERE signature = $1 LIMIT 1", [old]);
    await db.query("UPDATE instructions SET name = 'current-sentinel' WHERE signature <> $1", [old]);
    const unchanged = (await db.query('SELECT * FROM instructions WHERE signature <> $1 ORDER BY signature, ix_index, inner_index', [old])).rows;
    assert.equal(await decodePending(db, marginfiIdl), 1);
    assert.equal((await db.query('SELECT decoded_version FROM raw_tx WHERE signature = $1', [old])).rows[0].decoded_version, DECODER_VERSION);
    assert.equal((await db.query("SELECT * FROM instructions WHERE name = 'obsolete'")).rowCount, 0);
    assert.equal((await db.query("SELECT * FROM events WHERE name = 'obsolete'")).rowCount, 0);
    assert.deepEqual((await db.query('SELECT * FROM instructions WHERE signature <> $1 ORDER BY signature, ix_index, inner_index', [old])).rows, unchanged);
  } finally { await db.close(); }
});
test('unknown and malformed instruction payloads are kept as raw data in JSONB', async () => {
  const db = pgliteDb();
  try {
    await migrate(db);
    for (const [i, data] of ['11111111', 'invalid0'].entries()) {
      const raw: RawTransaction = { slot: i, blockTime: null, transaction: { signatures: ['unknown-' + i], message: {
        accountKeys: [marginfiIdl.address], instructions: [{ programIdIndex: 0, accounts: [], data }] } }, meta: { err: null } };
      await insertRawTx(db, raw);
    }
    await decodePending(db, marginfiIdl);
    const rows = (await db.query('SELECT * FROM instructions ORDER BY signature')).rows;
    assert.equal(rows[0].name, 'unknown'); assert.equal(rows[0].decode_error, null);
    assert.equal((rows[0].args as Record<string, unknown>).data, 'AAAAAAAAAAA=');
    assert.equal((rows[1].args as Record<string, unknown>).rawData, 'invalid0');
    assert.match(rows[1].decode_error as string, /base58/);
  } finally { await db.close(); }
});
