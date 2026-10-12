/** INPUT: Db 最新账户行与 labels。 OUTPUT: 视图组装用的强类型状态。 POSITION: EP7 数据读取边界。 SYNC: 同步 folder.md。 */
import type { Db, Row } from '../store/db';
import { fromJson } from '../store/json';
import { marginfiIdl } from '../decoder/idl';
import type { Fixed } from '../decoder/account';
export interface BankData {
  mint: string;
  mint_decimals: bigint;
  group: string;
  last_update: bigint;
  asset_share_value: Fixed;
  liability_share_value: Fixed;
  total_asset_shares: Fixed;
  total_liability_shares: Fixed;
  config: {
    asset_weight_init: Fixed;
    asset_weight_maint: Fixed;
    liability_weight_init: Fixed;
    liability_weight_maint: Fixed;
    oracle_keys: string[];
    interest_rate_config: Record<string, Fixed>;
  };
}
export interface GroupData {
  group_flags: bigint;
  fee_state_cache: {
    program_fee_rate: Fixed;
    program_fee_fixed: Fixed;
  };
}
export interface Position {
  active: boolean;
  bank_pk: string;
  asset_shares: Fixed;
  liability_shares: Fixed;
}
export interface UserData {
  authority: string;
  group: string;
  lending_account: {
    balances: Position[];
  };
}
export interface FeedData {
  price: {
    decimal: string;
    number: number;
  };
  last_update_timestamp: string;
  sample_size: number;
}
export interface State {
  rows: Row[];
  labels: Record<string, string>;
  banks: Record<string, BankData>;
  groups: Record<string, GroupData>;
  feeds: Record<string, FeedData>;
  users: Record<string, UserData>;
}
export async function readState(db: Db): Promise<State> {
  const rows = (await db.query('SELECT DISTINCT ON (address) * FROM account_states ORDER BY address, slot DESC')).rows;
  const labels = Object.fromEntries((await db.query('SELECT address,label FROM labels')).rows.map(r => [String(r.address), String(r.label)]));
  const state: State = { rows, labels, banks: {}, groups: {}, feeds: {}, users: {} };
  for (const row of rows) {
    const address = String(row.address), type = String(row.type), data = row.data as Record<string, unknown>;
    if ('decodeError' in data || 'rawData' in data)
      continue;
    if (type === 'Bank')
      state.banks[address] = fromJson(data, type, marginfiIdl) as BankData;
    if (type === 'MarginfiGroup')
      state.groups[address] = fromJson(data, type, marginfiIdl) as GroupData;
    if (type === 'MarginfiAccount')
      state.users[address] = fromJson(data, type, marginfiIdl) as UserData;
    if (type === 'switchboardPullFeed')
      state.feeds[address] = data as unknown as FeedData;
  }
  return state;
}
export const shortAddress = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;
export const label = (labels: Record<string, string>, address: string) => labels[address] ?? shortAddress(address);
export const iso = (timestamp: unknown): string | null => timestamp == null ? null : new Date(timestamp as string | number | Date).toISOString();
export const unixIso = (seconds: bigint | string): string => new Date(Number(seconds) * 1000).toISOString();
