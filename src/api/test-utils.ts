/** INPUT: 本地 fixtures、PGlite、mock resultRegion。 OUTPUT: seedApi。 POSITION: 仅 EP7 测试数据，无网络。 SYNC: 同步 folder.md。 */
import { readFileSync } from 'node:fs';
import txs from '../../fixtures/m1-transactions.json';
import accounts from '../../fixtures/m1-accounts.json';
import run from '../../fixtures/m1-run.json';
import { pgliteDb } from '../store/db';
import { migrate } from '../store/migrate';
import { insertRawTx } from '../store/raw';
import { decodePending } from '../store/decode';
import { loadLabels } from '../store/labels';
import { snapshotAccounts, snapshotOracles } from '../store/accounts';
import { marginfiIdl } from '../decoder/idl';
import { OFFSET } from '../decoder/switchboard';
import { resultRegion } from '../../scenario/lib/mock-feed';
import type { RawTransaction } from '../ingest/rpc';
export async function seedApi() {
 const db=pgliteDb();
 try {
  await migrate(db); await loadLabels(db,run.addresses);
  for(const raw of Object.values(txs.transactions)) await insertRawTx(db,raw as RawTransaction);
  await decodePending(db,marginfiIdl);
  await snapshotAccounts(db,{getMultipleAccounts:async addresses=>({context:{slot:100},value:addresses.map(address=>{
    const a=(accounts.accounts as Record<string,{owner:string;lamports:number;data:string}>)[address];return {...a,data:[a.data,'base64']};
  })})},Object.keys(accounts.accounts));
  await snapshotOracles(db,{getMultipleAccounts:async addresses=>({context:{slot:101},value:addresses.map(address=>{
    const bytes=readFileSync('fixtures/switchboard-pullfeed-uncranked.bin');resultRegion(address===run.addresses.feeds.tSOL?50:1,1700000000,99).copy(bytes,OFFSET.sampleSize);
    return {owner:'mock',lamports:1,data:[bytes.toString('base64'),'base64']};
  })})},Object.values(run.addresses.feeds),new Set(['mock']));
  return db;
 } catch(error) {await db.close();throw error;}
}
