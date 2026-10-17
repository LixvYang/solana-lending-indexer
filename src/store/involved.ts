/** INPUT: instructions.accounts、最新 Bank 快照。 OUTPUT: 协议账户及价格账户地址(Pyth 由 feed id 换算)。 POSITION: EP6 快照地址选择，排除 mint/vault/signer。 SYNC: 同步 folder.md。 */
import type { Db } from './db';
import { oracleAccountOf } from '../oracle/pyth';
export async function involvedAccounts(db: Db): Promise<string[]> {
  const roles = new Set(['bank', 'asset_bank', 'liab_bank', 'group', 'marginfi_group', 'marginfi_account',
    'liquidator_marginfi_account', 'liquidatee_marginfi_account']);
  // 失败初始化可能从未创建账户；其指令保留为事实，但不能污染快照集合。
  const rows = (await db.query(`SELECT i.accounts FROM instructions i
    JOIN raw_tx r ON r.signature = i.signature WHERE r.err IS NULL OR r.err = 'null'::jsonb`)).rows;
  return [...new Set(rows.flatMap(row => Object.entries(row.accounts as Record<string, string>)
    .filter(([role]) => roles.has(role)).map(([, address]) => address)))].sort();
}

/** 每个地址先取最新状态，再挑可解码 Bank；避免旧 oracle 配置污染当前采集。 */
export async function involvedOracles(db: Db): Promise<string[]> {
  const rows = (await db.query(`SELECT * FROM (SELECT DISTINCT ON (address) address,type,data
    FROM account_states ORDER BY address,slot DESC) latest WHERE type='Bank'`)).rows;
  return [...new Set(rows.flatMap(row => {
    // Pyth 银行的 oracle_keys[0] 是 feed id,不是账户;统一换算成要读的价格账户。
    const config = (row.data as { config?: { oracle_setup: unknown; oracle_keys: string[] } }).config;
    const account = config?.oracle_keys ? oracleAccountOf(config) : null;
    return account ? [account] : [];
  }))].sort();
}
