/**
 * INPUT: finalized 账户 RPC、Db、固定 IDL。
 * OUTPUT: snapshotAccounts / snapshotOracles、原始字节与 owner 白名单。
 * POSITION: EP6 当前状态采集；RPC 不提供历史状态，历史需逐笔快照，此处不做。SYNC: 同步 folder.md。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodePullFeed, DISCRIMINATOR } from '../decoder/switchboard';
import { decodePriceUpdate, DISCRIMINATOR as PYTH_DISCRIMINATOR } from '../decoder/pyth';
import { PYTH_RECEIVER } from '../oracle/pyth';
import { marginfiIdl, type Idl } from '../decoder/idl';
import { decodeAccount } from '../decoder/account';
import type { AccountResponse } from '../ingest/rpc';
import type { Db } from './db';
import { toJson } from './json';
export interface AccountRpc { getMultipleAccounts(addresses: string[]): Promise<AccountResponse> }
/** 价格账户按 discriminator 分辨:Switchboard PullFeed(含我们布局一致的 mock)或 Pyth PriceUpdateV2。 */
function oracleData(bytes: Buffer, raw_data: string) {
  if (bytes.subarray(0, 8).equals(DISCRIMINATOR)) return { type: 'switchboardPullFeed', data: { ...decodePullFeed(bytes), raw_data } };
  if (bytes.subarray(0, 8).equals(PYTH_DISCRIMINATOR)) return { type: 'pythPriceUpdate', data: { ...decodePriceUpdate(bytes), raw_data } };
  return null;
}
export function accountData(raw_data: string, idl: Idl) {
  const bytes = Buffer.from(raw_data, 'base64'), oracle = oracleData(bytes, raw_data);
  if (oracle) return oracle;
  const decoded = decodeAccount(bytes, idl);
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

export function oracleOwners(config = process.env.ORACLE_OWNERS, idsPath = resolve('program/out/program-ids.json')): Set<string> {
  if (config !== undefined) return new Set(config.split(',').map(s => s.trim()).filter(Boolean));
  const owners = new Set(['Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2', PYTH_RECEIVER.toBase58()]);
  try {
    const ids = JSON.parse(readFileSync(idsPath, 'utf8'));
    if (typeof ids.mocks !== 'string' || !ids.mocks) throw new Error('missing mocks program id');
    owners.add(ids.mocks);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return owners;
}
/** owner 或布局错误拒绝整批，不把外部账户内容当价格。缺失账户报告后保留历史快照。 */
export async function snapshotOracles(db: Db, rpc: AccountRpc, addresses: string[], owners = oracleOwners()): Promise<number> {
  const unique = [...new Set(addresses)];
  let count = 0;
  for (let start = 0; start < unique.length; start += 100) {
    const batch = unique.slice(start, start + 100), response = await rpc.getMultipleAccounts(batch);
    if (response.value.length !== batch.length) throw new Error('oracle response length mismatch');
    const states = batch.flatMap((address, i) => {
      const account = response.value[i];
      if (!account) { console.error(`missing oracle ${address}; snapshot skipped`); return []; }
      if (!owners.has(account.owner)) throw new Error(`oracle owner mismatch ${address}: ${account.owner}`);
      if (account.data[1] !== 'base64') throw new Error(`unexpected oracle encoding ${address}`);
      const raw_data = account.data[0], oracle = oracleData(Buffer.from(raw_data, 'base64'), raw_data);
      if (!oracle) throw new Error(`unknown oracle layout ${address}`);
      return [{ address, account, ...oracle }];
    });
    await db.transaction(async tx => {
      for (const state of states) await tx.query(`INSERT INTO account_states(address,slot,type,owner,lamports,data)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(address,slot) DO NOTHING`,
      [state.address, response.context.slot, state.type, state.account.owner, state.account.lamports, toJson(state.data)]);
    });
    count += states.length;
  }
  return count;
}
