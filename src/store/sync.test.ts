/** INPUT: fixtures/PGlite/假 RPC。 OUTPUT: CLI 共用编排与失败/关闭账户断言。 POSITION: EP6 集成测试。 SYNC: 同步 folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import transactions from '../../fixtures/m1-transactions.json';
import accounts from '../../fixtures/m1-accounts.json';
import { marginfiIdl } from '../decoder/idl';
import { decodeTransaction } from '../decoder/transaction';
import { pgliteDb } from './db';
import { migrate } from './migrate';
import { insertRawTx } from './raw';
import { involvedAccounts } from './involved';
import { syncStored } from './sync';
import type { RawTransaction } from '../ingest/rpc';
test('CLI shared sync decodes then snapshots only successful protocol roles; reports closed accounts', async t => {
  const db = pgliteDb(), reports: string[] = [];
  t.mock.method(console, 'error', (message: string) => { reports.push(message); });
  try {
    await migrate(db);
    for (const tx of Object.values(transactions.transactions)) await insertRawTx(db, tx as RawTransaction);
    const source = Object.values(transactions.transactions).find(tx => decodeTransaction(tx, marginfiIdl).some(ix => ix.name === 'marginfi_account_initialize'))!;
    const failed = structuredClone(source) as RawTransaction;
    failed.transaction.signatures = ['failed-initialize']; failed.meta!.err = { failed: true };
    const ix = failed.transaction.message.instructions.find(ix => failed.transaction.message.accountKeys[ix.programIdIndex] === marginfiIdl.address)!;
    const definition = marginfiIdl.instructions.find(ix => ix.name === 'marginfi_account_initialize')!;
    const accountIndex = definition.accounts.findIndex(a => a.name === 'marginfi_account');
    failed.transaction.message.accountKeys[ix.accounts[accountIndex]] = 'never-created';
    await insertRawTx(db, failed);
    const known = accounts.accounts as Record<string, { owner: string; lamports: number; data: string }>;
    const closed = Object.keys(known).find(address => address !== 'never-created' && known[address].data.length > 3000)!;
    const rpc = { getMultipleAccounts: async (addresses: string[]) => {
      assert.ok(!addresses.includes('never-created'));
      return { context: { slot: 42 }, value: addresses.map(address => address === closed ? null : { ...known[address], data: [known[address].data, 'base64'] as [string, 'base64'] }) };
    } };
    const result = await syncStored(db, rpc, marginfiIdl);
    assert.equal(result.decoded, 33); assert.equal(result.snapshots, 5);
    const addresses = await involvedAccounts(db);
    assert.equal(addresses.length, 6); assert.ok(!addresses.includes('never-created'));
    assert.equal((await db.query('SELECT * FROM account_states')).rowCount, 5);
    assert.ok(reports.some(message => message.includes(closed)));
    const again = await syncStored(db, rpc, marginfiIdl);
    assert.equal(again.decoded, 0); assert.equal((await db.query('SELECT * FROM account_states')).rowCount, 5);
  } finally { await db.close(); }
});
