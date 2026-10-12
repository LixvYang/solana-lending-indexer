/** INPUT: instructions.accounts、最新 Bank 快照。 OUTPUT: 协议账户及 oracle 地址。 POSITION: EP6 快照地址选择，排除 mint/vault/signer。 SYNC: 同步 folder.md。 */
import type { Db } from './db';
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
    const data = row.data as { config?: { oracle_keys?: string[] } };
    const key = data.config?.oracle_keys?.[0];
    return key && key !== '11111111111111111111111111111111' ? [key] : [];
  }))].sort();
}
