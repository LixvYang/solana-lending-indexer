/**
 * INPUT: 手写解码的 snake_case 借贷/清算事件。
 * OUTPUT: 每账户/池子的整数净流量、清算估计与 f64 误差界。
 * POSITION: EP5 事件账本；不冒充账户状态，不在 close_balance 时抹掉净流量。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import { add, subtract, multiply, rational, fromF64, f64Error, type Rational } from '../core/rational';
import type { DecodedEvent } from './event';
export interface Flow {
  ordinary: Rational; grossCredit: Rational; liquidation: Rational; f64Bound: Rational;
  closed: boolean; inferredLiquidation: boolean;
}
export type Ledger = Map<string, { deposit: Flow; borrow: Flow }>;
export const flowKey = (account: string, bank: string) => `${account}/${bank}`;
export function emptyFlow(): Flow {
  return { ordinary: rational(0n), grossCredit: rational(0n), liquidation: rational(0n), f64Bound: rational(0n), closed: false, inferredLiquidation: false };
}
export function eventBalances(events: DecodedEvent[], issues: string[]): Ledger {
  const ledger: Ledger = new Map();
  const get = (account: string, bank: string) => {
    const key = flowKey(account, bank);
    if (!ledger.has(key)) ledger.set(key, { deposit: emptyFlow(), borrow: emptyFlow() });
    return ledger.get(key)!;
  };
  for (const event of events) {
    if (typeof event.data === 'string' || 'decodeError' in event) {
      issues.push(`undecoded event ${event.name} at ${event.signature}/${event.logIndex}`); continue;
    }
    const data = event.data;
    try {
      const header = data.header as { marginfi_account: string };
      if (event.name === 'LendingAccountLiquidateEvent') {
        const pre = data.pre_balances as Record<string, number>, post = data.post_balances as Record<string, number>;
        const delta = (field: string) => subtract(fromF64(post[field]), fromF64(pre[field]));
        const bound = (field: string) => add(f64Error(post[field]), f64Error(pre[field]));
        const apply = (flow: Flow, amount: Rational, error: Rational) => {
          flow.liquidation = add(flow.liquidation, amount);
          if (amount.numerator > 0n) flow.grossCredit = add(flow.grossCredit, amount);
          flow.f64Bound = add(flow.f64Bound, error);
        };
        const victimAsset = get(data.liquidatee_marginfi_account as string, data.asset_bank as string).deposit;
        const victimDebt = get(data.liquidatee_marginfi_account as string, data.liability_bank as string).borrow;
        const actorAsset = get(header.marginfi_account, data.asset_bank as string).deposit;
        const actorDebt = get(header.marginfi_account, data.liability_bank as string);
        apply(victimAsset, delta('liquidatee_asset_balance'), bound('liquidatee_asset_balance'));
        apply(victimDebt, delta('liquidatee_liability_balance'), bound('liquidatee_liability_balance'));
        apply(actorAsset, delta('liquidator_asset_balance'), bound('liquidator_asset_balance'));
        const borrowed = delta('liquidator_liability_balance');
        apply(actorDebt.borrow, borrowed, bound('liquidator_liability_balance'));
        // 0.975/0.95 = 39/38；事件未报告清算人负债池的存款，必须推算其消耗。
        // 这是名义折扣的估计，上游定点计算/份额转换误差另列不确定性。
        apply(actorDebt.deposit, add(multiply(delta('liquidatee_liability_balance'), rational(39n, 38n)), borrowed),
          add(multiply(bound('liquidatee_liability_balance'), rational(39n, 38n)), bound('liquidator_liability_balance')));
        actorDebt.deposit.inferredLiquidation = true;
      } else if (/^LendingAccount(Deposit|Withdraw|Borrow|Repay)Event$/.test(event.name)) {
        if (typeof data.amount !== 'bigint' || data.amount < 0n) throw new Error('amount must be u64 bigint');
        const balance = get(header.marginfi_account, data.bank as string);
        const positive = /Deposit|Borrow/.test(event.name);
        const flow = /Deposit|Withdraw/.test(event.name) ? balance.deposit : balance.borrow;
        flow.ordinary = add(flow.ordinary, rational(positive ? data.amount : -data.amount));
        if (positive) flow.grossCredit = add(flow.grossCredit, rational(data.amount));
        flow.closed ||= data.close_balance === true;
      }
    } catch (error) { issues.push(`invalid event ${event.name}: ${String(error)}`); }
  }
  return ledger;
}
