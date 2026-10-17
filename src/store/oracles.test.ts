/** INPUT: PGlite、fixture、假 RPC。 OUTPUT: owner / 快照 / 标签 / 重建断言。 POSITION: EP7 离线集成测试。 SYNC: 同步 folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import run from '../../fixtures/m1-run.json';
import accounts from '../../fixtures/m1-accounts.json';
import { pgliteDb } from './db';
import { migrate } from './migrate';
import { snapshotAccounts, snapshotOracles, oracleOwners } from './accounts';
import { involvedOracles } from './involved';
import { loadLabels } from './labels';
import { rebuildDecoded } from './decode';
import { marginfiIdl } from '../decoder/idl';
import { OFFSET } from '../decoder/switchboard';
import { resultRegion } from '../../scenario/lib/mock-feed';
test('oracle snapshots validate all owners, keep raw/context slot, survive rebuild; labels upsert',async()=>{
 const db=pgliteDb(); try {
  await migrate(db); await migrate(db); await loadLabels(db,run.addresses); await loadLabels(db,run.addresses);
  assert.equal((await db.query('SELECT * FROM labels')).rowCount,10);
  assert.equal((await db.query('SELECT label FROM labels WHERE address=$1',[run.addresses.mints.tSOL])).rows[0].label,'tSOL');
  await loadLabels(db,{...run.addresses,actors:{alice:'new-address'}});
  assert.equal((await db.query('SELECT label FROM labels WHERE address=$1',['new-address'])).rows[0].label,'alice');
  const values=Object.values(accounts.accounts).map(a=>({...a,data:[a.data,'base64'] as [string,'base64']}));
  await snapshotAccounts(db,{getMultipleAccounts:async()=>({context:{slot:10},value:values})},Object.keys(accounts.accounts));
  const addresses=await involvedOracles(db); assert.deepEqual(addresses.sort(),Object.values(run.addresses.feeds).sort());
  const bytes=readFileSync('fixtures/switchboard-pullfeed-uncranked.bin');resultRegion(100,1700000000,10).copy(bytes,OFFSET.sampleSize);
  const rpc={getMultipleAccounts:async()=>({context:{slot:20},value:addresses.map(()=>({owner:'foreign',lamports:1,data:[bytes.toString('base64'),'base64'] as [string,'base64']}))})};
  await assert.rejects(snapshotOracles(db,rpc,addresses,new Set(['allowed'])),/owner.*foreign/);
  assert.equal((await db.query("SELECT * FROM account_states WHERE type='switchboardPullFeed'")).rowCount,0);
  await snapshotOracles(db,rpc,addresses,new Set(['foreign']));await snapshotOracles(db,rpc,addresses,new Set(['foreign']));
  const rows=(await db.query("SELECT * FROM account_states WHERE type='switchboardPullFeed' ORDER BY address")).rows;
  assert.equal(rows.length,2);assert.ok(rows.every(r=>r.slot==='20' && (r.data as any).price.decimal==='100'));
  await rebuildDecoded(db,marginfiIdl);
  assert.deepEqual((await db.query("SELECT * FROM account_states WHERE type='switchboardPullFeed' ORDER BY address")).rows,rows);
  assert.deepEqual([...oracleOwners(' one, two ,one ', '/nonexistent')],['one','two']);
  assert.deepEqual([...oracleOwners(undefined,'/nonexistent')],['Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2','rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ']);
 } finally {await db.close();}
});
