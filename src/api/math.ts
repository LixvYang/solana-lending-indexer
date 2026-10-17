/**
 * INPUT: I80F48 原始字节、利率曲线、原生余额与价格。
 * OUTPUT: 精确份额数量 / 显示用 APR、USD、健康度。
 * POSITION: EP7 纯数学；只有 USD/APR 边界转 Number。SYNC: 同步 folder.md。
 */
import { toRational } from '../core/fixed';
import { fromF64, type Rational } from '../core/rational';
import type { Fixed } from '../decoder/account';
import type { BankWeights, InterestCurve } from './types';
export const fixedRational = (value: Fixed) => toRational(Uint8Array.from(value.value));
export const displayNumber = (value: Rational) => Number(value.numerator) / Number(value.denominator);
export function shareQuantity(shares: Fixed, value: Fixed): Rational { return { numerator: fixedRational(shares).numerator * fixedRational(value).numerator, denominator: 2n ** 96n }; }
export function floor(value: Rational): bigint {
  const quotient = value.numerator / value.denominator;
  return quotient - (value.numerator < 0n && value.numerator % value.denominator !== 0n ? 1n : 0n);
}
export const nativeAmount = (shares: Fixed, value: Fixed) => floor(shareQuantity(shares, value));
export function utilization(value: number): number {
  if (!Number.isFinite(value))
    throw new Error('utilization must be finite');
  // 契约只允许 0..1：饱和显示；上游对 >1 会外推，API 不声称重演该异常状态。
  return Math.min(1, Math.max(0, value));
}
// #region ep7-rates
export function curveRate(value: number, curve: InterestCurve): number {
  const u = utilization(value), o = curve.optimal_utilization;
  if (!(o > 0 && o < 1))
    throw new Error('optimal utilization must be between 0 and 1');
  return u <= o ? u / o * curve.plateau_rate
    : curve.plateau_rate + (u - o) / (1 - o) * (curve.max_rate - curve.plateau_rate);
}
export function rates(value: number, curve: InterestCurve) {
  const u = utilization(value), base = curveRate(u, curve);
  // marginfi_group.rs:320-334：insurance + group + enabled program 费用分别求和；原始配置的求和在 bank.ts。
  return { lending_apr: base * u, borrowing_apr: base * (1 + curve.fee_rate) + curve.fee_fixed_apr };
}
// #endregion
export interface HealthBank {
  decimals: number;
  weights: BankWeights;
}
export interface HealthBalance {
  bank: string;
  deposit: Rational | number | bigint;
  borrow: Rational | number | bigint;
}
export const quantity = (value: HealthBalance['deposit']): Rational => typeof value === 'number' ? fromF64(value)
  : typeof value === 'bigint' ? { numerator: value, denominator: 1n } : value;
export function usd(value: HealthBalance['deposit'], decimals: number, price: number | null): number | null {
  if (price === null)
    return null;
  const q = quantity(value);
  return displayNumber({ numerator: q.numerator, denominator: q.denominator * 10n ** BigInt(decimals) }) * price;
}
// #region ep7-health
/** prices:纯数字表示没有置信区间;区间时资产用 low、负债用 high(见 oracle-price.ts riskPrice)。 */
export function health(balances: HealthBalance[], banks: Record<string, HealthBank>, prices: Record<string, number | { low: number; high: number } | null>, mode: 'init' | 'maint'): number | null {
  let result = 0;
  for (const balance of balances) {
    if (!quantity(balance.deposit).numerator && !quantity(balance.borrow).numerator)
      continue;
    const bank = banks[balance.bank], price = prices[balance.bank];
    if (!bank || price == null)
      return null;
    const low = typeof price === 'number' ? price : price.low, high = typeof price === 'number' ? price : price.high;
    if (!Number.isFinite(low) || !Number.isFinite(high))
      return null;
    result += usd(balance.deposit, bank.decimals, low)! * bank.weights[`asset_${mode}`]
      - usd(balance.borrow, bank.decimals, high)! * bank.weights[`liability_${mode}`];
  }
  return result;
}
// #endregion
