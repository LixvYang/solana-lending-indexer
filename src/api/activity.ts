/** INPUT: Db 顶层 instructions、events、raw_tx、labels。 OUTPUT: getActivity 稳定分页。 POSITION: EP7 活动流，只读。 SYNC: 同步 folder.md。 */
import type { Db } from '../store/db';
import type { ActivityPage } from './types';
import { ApiError } from './errors';
import { iso } from './state';
const mainEvents: Record<string, string> = {
  marginfi_group_initialize: 'MarginfiGroupCreateEvent', marginfi_account_initialize: 'MarginfiAccountCreateEvent',
  lending_pool_add_bank: 'LendingPoolBankCreateEvent', lending_pool_configure_bank: 'LendingPoolBankConfigureEvent',
  lending_pool_configure_bank_oracle: 'LendingPoolBankConfigureOracleEvent', lending_pool_accrue_bank_interest: 'LendingPoolBankAccrueInterestEvent',
  lending_account_deposit: 'LendingAccountDepositEvent', lending_account_borrow: 'LendingAccountBorrowEvent',
  lending_account_withdraw: 'LendingAccountWithdrawEvent', lending_account_repay: 'LendingAccountRepayEvent',
  lending_account_liquidate: 'LendingAccountLiquidateEvent', lending_account_handle_bankruptcy: 'LendingAccountHandleBankruptcyEvent',
};
export function activityOptions({ limit = 20, before }: {
  limit?: number;
  before?: string;
} = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new ApiError(400, 'limit must be an integer between 1 and 100');
  const match = before === undefined ? null : /^(\d+):(\d+):([1-9A-HJ-NP-Za-km-z]{1,88})$/.exec(before);
  if (before !== undefined && (!match || BigInt(match[1]) > 9223372036854775807n || BigInt(match[2]) > 2147483647n))
    throw new ApiError(400, 'invalid activity cursor');
  return { limit, cursor: match ? [match[1], Number(match[2]), match[3]] : null };
}
export async function getActivity(db: Db, options: {
  limit?: number;
  before?: string;
} = {}): Promise<ActivityPage> {
  const { limit, cursor } = activityOptions(options);
  const rows = (await db.query(`SELECT i.*,r.err FROM instructions i JOIN raw_tx r USING(signature)
  WHERE i.inner_index=-1 ${cursor ? 'AND (i.slot,i.ix_index,i.signature COLLATE "C") < ($2::bigint,$3::int,$4::text COLLATE "C")' : ''}
  ORDER BY i.slot DESC,i.ix_index DESC,i.signature COLLATE "C" DESC LIMIT $1`, [limit + 1, ...(cursor ?? [])])).rows;
  const page = rows.slice(0, limit), signatures = [...new Set(page.map(r => r.signature))];
  const events = signatures.length ? (await db.query('SELECT * FROM events WHERE signature=ANY($1::text[]) ORDER BY log_index DESC', [signatures])).rows : [];
  const labels = Object.fromEntries((await db.query('SELECT address,label FROM labels')).rows.map(r => [String(r.address), String(r.label)]));
  const items = page.map(row => {
    // 一条顶层指令可能有多条计息/业务事件，按明确名称匹配主事件，不拿第一条计息冒充借款。
    const event = events.find(e => e.signature === row.signature && e.ix_index === row.ix_index && e.name === mainEvents[String(row.name)]);
    const data = event?.data as {
      header?: {
        marginfi_account?: string;
      };
      bank?: string;
      /** 清算事件没有 bank 字段，被清算的资产所在的 bank 叫 asset_bank。 */
      asset_bank?: string;
      amount?: string;
    } | undefined;
    const account = data?.header?.marginfi_account ?? null, bank = data?.bank ?? data?.asset_bank ?? null;
    return { signature: String(row.signature), slot: String(row.slot), block_time: iso(row.block_time), ix_index: Number(row.ix_index),
      instruction: String(row.name), event: event ? String(event.name) : null, account, account_label: account ? labels[account] ?? null : null,
      bank, bank_label: bank ? labels[bank] ?? null : null, amount: typeof data?.amount === 'string' ? data.amount : null, ok: row.err == null };
  });
  const last = items.at(-1);
  return { items, next_before: rows.length > limit && last ? `${last.slot}:${last.ix_index}:${last.signature}` : null };
}
