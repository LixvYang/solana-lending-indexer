/**
 * INPUT: 已解码事件和按地址索引的账户，调用者提供完整结束快照。
 * OUTPUT: shares 逐位不变量、2^96 数量、流量差值分类与无法解释的问题。
 * POSITION: EP5 对账纯函数；分类是基于方向的推断，精确结论以状态为准。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import { toRational } from '../core/fixed';
import { rational, add, subtract, multiply, compare, type Rational } from '../core/rational';
import type { DecodedAccount, Fixed } from './account';
import type { DecodedEvent } from './event';
import { eventBalances, emptyFlow, flowKey, type Flow } from './event-balances';
interface Balance { active: boolean; bank_pk: string; asset_shares: Fixed; liability_shares: Fixed }
interface Bank {
  group: string; asset_share_value: Fixed; liability_share_value: Fixed;
  total_asset_shares: Fixed; total_liability_shares: Fixed;
}
const bits = (value: Fixed) => toRational(Uint8Array.from(value.value)).numerator;
export interface Difference {
  state: Rational; ordinary: Rational; liquidation: Rational; eventNet: Rational; difference: Rational;
  f64Bound: Rational; interestUpperBound: Rational; categories: ('interest' | 'f64_precision' | 'other')[];
  notes: string[];
}
function difference(state: Rational, flow: Flow, shareValue: bigint, side: 'deposit' | 'borrow'): Difference {
  const eventNet = add(flow.ordinary, flow.liquidation), delta = subtract(state, eventNet);
  const categories: Difference['categories'] = [], notes: string[] = [];
  const absolute = { ...delta, numerator: delta.numerator < 0n ? -delta.numerator : delta.numerator };
  // 假设从零开始且 share_value 从 1 单调增加：每笔入账能赚的利息不超过最终增幅。
  const interestUpperBound = multiply(flow.grossCredit, rational(shareValue > 1n << 48n ? shareValue - (1n << 48n) : 0n, 1n << 48n));
  const upperBound = add(add(interestUpperBound, flow.f64Bound), rational(flow.closed ? 1n : 0n));
  if (delta.numerator && flow.f64Bound.numerator) categories.push('f64_precision');
  if (compare(absolute, flow.f64Bound) > 0 && delta.numerator > 0n && shareValue > 1n << 48n && compare(delta, upperBound) <= 0) {
    categories.push('interest'); notes.push('正差且 share_value > 1，符合利息；没有中间账户快照，不能精确拆分每笔利息');
  } else if (compare(absolute, flow.f64Bound) > 0) {
    categories.push('other'); notes.push('unexplained: 差值方向或量级超出 f64 界、入账 × share_value 增幅及关闭取整界');
  }
  if (flow.closed) {
    categories.push('other'); notes.push(side === 'borrow' ? 'repay_all: ceil 向上取整小于 1 原生单位，余额关闭后仍保留负净流量' : 'withdraw_all: 关闭取整/dust 未由当前 fixture 验证');
  }
  if (flow.inferredLiquidation) notes.push('清算人存款用名义折扣 39/38 推算；未精确复现上游 I80F48 截断与份额转换');
  return { state, ordinary: flow.ordinary, liquidation: flow.liquidation, eventNet, difference: delta,
    f64Bound: flow.f64Bound, interestUpperBound, categories, notes };
}

// #region ep5-reconcile
export function reconcile(events: DecodedEvent[], accounts: Record<string, DecodedAccount>) {
  const issues: string[] = [], ledger = eventBalances(events, issues);
  const banks: { bank: string; assetShares: bigint; totalAssetShares: bigint; liabilityShares: bigint; totalLiabilityShares: bigint }[] = [];
  const balances: { account: string; bank: string; deposit: Difference; borrow: Difference }[] = [];
  const users: { address: string; group: string; balances: Balance[] }[] = [];
  const bankData = new Map<string, Bank>();
  for (const [address, account] of Object.entries(accounts)) {
    if (!('data' in account)) { issues.push(`undecoded account ${address}`); continue; }
    if (account.name === 'Bank') bankData.set(address, account.data as unknown as Bank);
    if (account.name === 'MarginfiAccount') users.push({ address, group: account.data.group as string,
      balances: (account.data.lending_account as { balances: Balance[] }).balances });
  }
  if (!bankData.size || !users.length) issues.push('missing bank/account snapshots');
  for (const user of users) for (const b of user.balances) {
    if ((b.active || bits(b.asset_shares) || bits(b.liability_shares)) && !bankData.has(b.bank_pk)) issues.push(`missing bank ${b.bank_pk}`);
    if (!b.active && (bits(b.asset_shares) || bits(b.liability_shares))) issues.push(`inactive nonzero shares ${user.address}/${b.bank_pk}`);
  }
  for (const [bankAddress, bank] of bankData) {
    let assetShares = 0n, liabilityShares = 0n;
    for (const user of users.filter(u => u.group === bank.group)) {
      const matching = user.balances.filter(b => b.bank_pk === bankAddress);
      if (matching.length > 1) issues.push(`duplicate bank balance ${user.address}/${bankAddress}`);
      const asset = matching.reduce((n, b) => n + bits(b.asset_shares), 0n);
      const liability = matching.reduce((n, b) => n + bits(b.liability_shares), 0n);
      assetShares += asset; liabilityShares += liability;
      // 两个 I80F48 相乘不经浮点；此处保留未约分的分母，直接对照 Anchor snapshot。
      const quantity = (shares: bigint, value: Fixed) => ({ numerator: shares * bits(value), denominator: 2n ** 96n });
      const flow = ledger.get(flowKey(user.address, bankAddress)) ?? { deposit: emptyFlow(), borrow: emptyFlow() };
      const deposit = difference(quantity(asset, bank.asset_share_value), flow.deposit, bits(bank.asset_share_value), 'deposit');
      const borrow = difference(quantity(liability, bank.liability_share_value), flow.borrow, bits(bank.liability_share_value), 'borrow');
      for (const d of [deposit, borrow]) if (d.notes.some(n => n.startsWith('unexplained'))) issues.push(`unexplained difference ${user.address}/${bankAddress}`);
      balances.push({ account: user.address, bank: bankAddress, deposit, borrow });
    }
    const totalAssetShares = bits(bank.total_asset_shares), totalLiabilityShares = bits(bank.total_liability_shares);
    if (assetShares !== totalAssetShares || liabilityShares !== totalLiabilityShares) issues.push(`shares mismatch ${bankAddress}`);
    banks.push({ bank: bankAddress, assetShares, totalAssetShares, liabilityShares, totalLiabilityShares });
  }
  for (const key of ledger.keys()) if (!balances.some(b => flowKey(b.account, b.bank) === key)) issues.push(`missing account/bank for event ${key}`);
  return { banks, balances, issues };
}
// #endregion
