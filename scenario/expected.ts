import type { RecordedEvent } from './lib/record';

const scale = 1_000_000n;
type Balance = { netDeposit: bigint; netBorrow: bigint };

function amount(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error(`无效 event amount：${value}`);
  return BigInt(value) * scale;
}

function fractional(value: unknown): bigint {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER)
    throw new Error(`无效 liquidation f64：${value}`);
  // 清算事件是 f64 原生数量；保留六位小数，不能声称恢复了 I80F48 全精度。
  return BigInt(value.toFixed(6).replace('.', ''));
}

function format(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const fraction = (absolute % scale).toString().padStart(6, '0').replace(/0+$/, '');
  return `${sign}${absolute / scale}${fraction ? `.${fraction}` : ''}`;
}

export function accumulateExpected(events: RecordedEvent[]) {
  const accounts: Record<string, Record<string, Balance>> = Object.create(null);
  const get = (account: string, bank: string) => {
    if (!account || !bank) throw new Error('事件缺少账户或 bank');
    accounts[account] ??= Object.create(null);
    return accounts[account][bank] ??= { netDeposit: 0n, netBorrow: 0n };
  };
  for (const { name, data } of events) {
    if (name === 'LendingAccountLiquidateEvent') {
      const pre = data.preBalances, post = data.postBalances;
      const bobAsset = get(data.liquidateeMarginfiAccount, data.assetBank);
      const bobDebt = get(data.liquidateeMarginfiAccount, data.liabilityBank);
      const carolAsset = get(data.header.marginfiAccount, data.assetBank);
      const carolDebt = get(data.header.marginfiAccount, data.liabilityBank);
      bobAsset.netDeposit += fractional(post.liquidateeAssetBalance) - fractional(pre.liquidateeAssetBalance);
      const paid = fractional(pre.liquidateeLiabilityBalance) - fractional(post.liquidateeLiabilityBalance);
      bobDebt.netBorrow -= paid;
      carolAsset.netDeposit += fractional(post.liquidatorAssetBalance) - fractional(pre.liquidatorAssetBalance);
      const borrowed = fractional(post.liquidatorLiabilityBalance) - fractional(pre.liquidatorLiabilityBalance);
      carolDebt.netBorrow += borrowed;
      // 来源: instructions/marginfi_account/liquidate.rs；折扣 .975 / .95 = 39 / 38。
      // 事件没报 liquidator 的存款余额，要加回保险费；不是把 Bob 减债额直接扣给 Carol。
      carolDebt.netDeposit -= paid * 39n / 38n - borrowed;
    } else if (/^LendingAccount(Deposit|Withdraw|Borrow|Repay)Event$/.test(name)) {
      const balance = get(data.header.marginfiAccount, data.bank);
      const quantity = amount(data.amount);
      if (name === 'LendingAccountDepositEvent') balance.netDeposit += quantity;
      if (name === 'LendingAccountBorrowEvent') balance.netBorrow += quantity;
      if (name === 'LendingAccountWithdrawEvent')
        balance.netDeposit = data.closeBalance ? 0n : balance.netDeposit - quantity;
      if (name === 'LendingAccountRepayEvent')
        balance.netBorrow = data.closeBalance ? 0n : balance.netBorrow - quantity;
    }
  }
  return {
    unit: 'mint 原生数量（不是 shares；除以 10^decimals 得到代币数量）',
    accounts: Object.fromEntries(Object.entries(accounts).map(([account, banks]) => [account,
      Object.fromEntries(Object.entries(banks).map(([bank, b]) => [bank,
        { netDeposit: format(b.netDeposit), netBorrow: format(b.netBorrow) }]))])),
    notes: [
      '这里只累加事件净流量；利息、开仓费不完整地出现在余额事件中，不能直接当作账户快照。',
      '清算 f64 丢失定点精度；Carol 存款消耗按 mrgn-0.1.0 的 2.5% 清算费和 2.5% 保险费推算。',
      '精确对账仍需 bank share value 和账户 snapshots；run 文件另存 Anchor 解码的结束快照。',
    ],
  };
}
