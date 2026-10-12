/**
 * 从数据库读回事件与最新账户状态做对账，并输出解码表的校验和。
 *
 *   DATABASE_URL=… pnpm exec tsx scripts/verify-db.ts
 *
 * 校验和用于"清库重跑结果一致"：对 instructions / events 按主键排序后整体取 md5，
 * `reindex` 前后两次的值必须相同。account_states 随链上当前状态变化，不参与校验和。
 */
import { createHash } from 'node:crypto';
import { runStoreCommand, reportError } from './store-command';
import { marginfiIdl } from '../src/decoder/idl';
import { reconcile } from '../src/decoder/reconcile';
import type { DecodedAccount } from '../src/decoder/account';
import type { DecodedEvent } from '../src/decoder/event';
import { fromJson } from '../src/store/json';

void runStoreCommand(async (db) => {
  const count = async (table: string) => (await db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n;
  const checksum = async (sql: string) => createHash('md5')
    .update(JSON.stringify((await db.query(sql)).rows)).digest('hex');
  console.log(`raw_tx=${await count('raw_tx')} instructions=${await count('instructions')} `
    + `events=${await count('events')} account_states=${await count('account_states')}`);
  console.log(`成功交易 err IS NULL: ${(await db.query('SELECT count(*) AS n FROM raw_tx WHERE err IS NULL')).rows[0].n}`
    + `，JSONB null: ${(await db.query("SELECT count(*) AS n FROM raw_tx WHERE jsonb_typeof(err) = 'null'")).rows[0].n}`);
  console.log('指令分布:', JSON.stringify((await db.query('SELECT name, count(*) AS n FROM instructions GROUP BY name ORDER BY name')).rows
    .map((r) => `${r.name}×${r.n}`)));
  console.log('instructions md5', await checksum('SELECT * FROM instructions ORDER BY signature, ix_index, inner_index'));
  console.log('events md5      ', await checksum('SELECT * FROM events ORDER BY signature, log_index'));

  const states = (await db.query(`SELECT DISTINCT ON (address) address, type, data FROM account_states
    ORDER BY address, slot DESC`)).rows;
  const accounts = Object.fromEntries(states.map((row) => [row.address as string,
    { name: row.type as string, data: fromJson(row.data, row.type as string, marginfiIdl) }])) as Record<string, DecodedAccount>;
  const events = (await db.query('SELECT signature, name, data, log_index AS "logIndex", ix_index AS "ixIndex" FROM events ORDER BY slot, log_index')).rows
    .map((row) => ({ ...row, data: fromJson(row.data, row.name as string, marginfiIdl) })) as DecodedEvent[];
  const result = reconcile(events, accounts);
  console.log(`对账 issues=${JSON.stringify(result.issues)}`);
  for (const bank of result.banks) {
    console.log(`bank ${bank.bank.slice(0, 6)}… asset_shares 之和==总量: ${bank.assetShares === bank.totalAssetShares}，`
      + `liability: ${bank.liabilityShares === bank.totalLiabilityShares}`);
  }
}).catch(reportError);
