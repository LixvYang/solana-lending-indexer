/** INPUT: Db、finalized 账户 RPC、IDL。 OUTPUT: syncStored 解码/快照计数。 POSITION: EP6 CLI 共用可离线验收编排。 SYNC: 同步 folder.md。 */
import type { Db } from './db';
import type { Idl } from '../decoder/idl';
import { decodePending } from './decode';
import { snapshotAccounts, type AccountRpc } from './accounts';
import { involvedAccounts } from './involved';
export async function syncStored(db: Db, rpc: AccountRpc, idl: Idl) {
  const decoded = await decodePending(db, idl);
  const snapshots = await snapshotAccounts(db, rpc, await involvedAccounts(db), idl, true);
  return { decoded, snapshots };
}
