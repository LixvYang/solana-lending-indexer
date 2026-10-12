/**
 * INPUT: finalized 账户 RPC、Db、固定 IDL。
 * OUTPUT: snapshotAccounts、可由原始字节重建的账户 JSONB。
 * POSITION: EP6 当前状态采集；RPC 不提供历史状态，历史需逐笔快照，此处不做。SYNC: 同步 folder.md。
 */
import { marginfiIdl, type Idl } from '../decoder/idl';
import { decodeAccount } from '../decoder/account';
import type { AccountResponse } from '../ingest/rpc';
import type { Db } from './db';
import { toJson } from './json';
export interface AccountRpc { getMultipleAccounts(addresses: string[]): Promise<AccountResponse> }
export function accountData(raw_data: string, idl: Idl) {
  const decoded = decodeAccount(Buffer.from(raw_data, 'base64'), idl);
  return { type: decoded.name, data: { ...('data' in decoded ? decoded.data : decoded), raw_data } };
}
// #region ep6-owner-check
export async function snapshotAccounts(db: Db, rpc: AccountRpc, addresses: string[], idl = marginfiIdl, skipMissing = false): Promise<number> {
  const unique = [...new Set(addresses)];
  let count = 0;
  // getMultipleAccounts 每次最多 100 个；每批使用自己的 context.slot，不假装不同批次同时采样。
  for (let start = 0; start < unique.length; start += 100) {
    const batch = unique.slice(start, start + 100), response = await rpc.getMultipleAccounts(batch);
    if (response.value.length !== batch.length) throw new Error('account response length mismatch');
    const states = batch.flatMap((address, i) => {
      const account = response.value[i];
      if (!account) {
        if (!skipMissing) throw new Error(`missing account ${address}`);
        // 历史账户可已关闭；CLI 报告缺失但不拿旧快照冒充当前状态。
        console.error(`missing account ${address} at finalized slot ${response.context.slot}; snapshot skipped`);
        return [];
      }
      if (account.owner !== idl.address) throw new Error(`owner mismatch ${address}: ${account.owner}`);
      if (account.data[1] !== 'base64') throw new Error(`unexpected account encoding ${address}`);
      return [{ address, account, ...accountData(account.data[0], idl) }];
    });
    await db.transaction(async tx => {
      for (const state of states) await tx.query(`INSERT INTO account_states(address, slot, type, owner, lamports, data)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb) ON CONFLICT (address, slot) DO NOTHING`,
      [state.address, response.context.slot, state.type, state.account.owner, state.account.lamports, toJson(state.data)]);
    });
    count += states.length;
  }
  return count;
}
// #endregion
