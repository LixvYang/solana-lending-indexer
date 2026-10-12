/** INPUT: Db 原始快照、钱包与 group。 OUTPUT: 最新账户字节解码。 POSITION: M7 槽位事实来源。 SYNC: folder.md。 */
import { PublicKey } from '@solana/web3.js';
import type { Db } from '../../store/db';
import { layout } from '../../decoder/layout';
import type { WalletRpc } from '../wallet-rpc';
import { decodeAccount } from '../../decoder/account';
import { marginfiIdl } from '../../decoder/idl';
import type { UserData, BankData } from '../state';
import { ApiError } from '../errors';
export type BuildBank = BankData & { config: BankData['config'] & { oracle_max_age: bigint } };
export async function walletAccount(db: Db, wallet: string, group: string) {
  // 先按地址取最新，再按 authority/group 筛选，避免权限变更后选到旧历史。
  const rows = (await db.query("SELECT DISTINCT ON (address) * FROM account_states ORDER BY address, slot DESC")).rows;
  const matches = rows.filter(r => r.type === 'MarginfiAccount' && (r.data as UserData).authority === wallet && (r.data as UserData).group === group)
    .sort((a, b) => BigInt(String(a.slot)) > BigInt(String(b.slot)) ? -1 : BigInt(String(a.slot)) < BigInt(String(b.slot)) ? 1 : String(a.address).localeCompare(String(b.address)));
  if (!matches.length) return null;
  const row = matches[0], raw = (row.data as { raw_data?: string }).raw_data;
  if (row.owner !== marginfiIdl.address || !raw) throw new ApiError(503, 'account snapshot unavailable');
  const decoded = decodeAccount(Buffer.from(raw, 'base64'), marginfiIdl);
  if (decoded.name !== 'MarginfiAccount' || !('data' in decoded)) throw new ApiError(503, 'account snapshot invalid');
  const data = decoded.data as unknown as UserData;
  if (data.authority !== wallet || data.group !== group) throw new ApiError(503, 'account snapshot inconsistent');
  return { address: String(row.address), data };
}

const program = new PublicKey(marginfiIdl.address);

/** 按 group + authority 在链上找用户的 marginfi 账户地址(账户不是 PDA，只能过滤查找)。多个时取地址最小的，保证确定性。 */
async function discoverOnChain(rpc: WalletRpc, wallet: string, group: string): Promise<string | null> {
  const shape = layout('MarginfiAccount', marginfiIdl);
  const at = (name: string) => 8 + shape.fields!.find(f => f.name === name)!.offset; // 8 = discriminator
  const found = await rpc.getProgramAccounts(program, { commitment: 'confirmed', dataSlice: { offset: 0, length: 0 }, filters: [
    { dataSize: 8 + shape.size }, { memcmp: { offset: at('group'), bytes: group } }, { memcmp: { offset: at('authority'), bytes: wallet } }] });
  return found.length ? found.map(f => f.pubkey.toBase58()).sort()[0] : null;
}

/**
 * 用户账户，内容取自链上最新。地址先看数据库(省一次 getProgramAccounts)，没有再按 group + authority 找。
 * 链上读不到(已关闭或还没创建)就当作没有账户。
 */
export async function chainWalletAccount(db: Db, rpc: WalletRpc, wallet: string, group: string) {
  const address = (await walletAccount(db, wallet, group))?.address ?? await discoverOnChain(rpc, wallet, group);
  if (!address) return null;
  const info = await rpc.getAccountInfo(new PublicKey(address), 'confirmed');
  if (!info) return null;
  if (!info.owner.equals(program)) throw new ApiError(503, 'account owner is not marginfi');
  const decoded = decodeAccount(info.data, marginfiIdl);
  if (decoded.name !== 'MarginfiAccount' || !('data' in decoded)) throw new ApiError(503, 'account on chain is not a MarginfiAccount');
  const data = decoded.data as unknown as UserData;
  if (data.authority !== wallet || data.group !== group) throw new ApiError(503, 'account on chain does not match wallet/group');
  return { address, data };
}
