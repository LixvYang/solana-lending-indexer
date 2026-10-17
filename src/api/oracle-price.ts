/** INPUT: account_states 里的价格账户行(Switchboard 布局或 Pyth)。 OUTPUT: 统一的 FeedData 与健康度用的带偏差价格。 POSITION: EP7 价格读取。 SYNC: 同步 folder.md。 */
import type { OracleSource } from './types';

type Num = { decimal: string; number: number };
export interface FeedData {
  source: OracleSource;
  price: Num;
  last_update_timestamp: string;
  /** 程序会不会接受这个价格:Switchboard 要有样本,Pyth 要是 Full 校验级别。 */
  valid: boolean;
  conf: number;
  /** 时间加权价与其置信区间;Switchboard 没有 EMA,等于实时价。 */
  ema: number;
  ema_conf: number;
}

const SWITCHBOARD = 'Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2';

export function feedFromRow(type: string, owner: string, data: Record<string, unknown>): FeedData | null {
  if (type === 'switchboardPullFeed') {
    const d = data as { price: Num; std_dev: Num; last_update_timestamp: unknown; sample_size: number };
    // 布局是 Switchboard 的,但 owner 不是 Switchboard 程序,就是我们的 mock(D-009)。
    return { source: owner === SWITCHBOARD ? 'switchboard' : 'mock', price: d.price, last_update_timestamp: String(d.last_update_timestamp),
      valid: d.sample_size > 0, conf: d.std_dev.number, ema: d.price.number, ema_conf: d.std_dev.number };
  }
  if (type === 'pythPriceUpdate') {
    const d = data as { price: Num; conf: Num; ema_price: Num; ema_conf: Num; publish_time: unknown; verification: string };
    return { source: 'pyth', price: d.price, last_update_timestamp: String(d.publish_time), valid: d.verification === 'Full',
      conf: d.conf.number, ema: d.ema_price.number, ema_conf: d.ema_conf.number };
  }
  return null;
}

// #region ep7-price-bias
export interface PriceBand { low: number; high: number }
/**
 * 健康度用的不是一个价格,而是一个区间(mrgn-0.1.0 state/price.rs、marginfi_account.rs):
 * - 开仓(init)用时间加权价,维持(maint)用实时价;
 * - 资产按区间下沿算、负债按上沿算,对用户永远是保守的一侧;
 * - 区间半宽 = Pyth conf × 2.12 或 Switchboard std_dev × 1.96,最多不超过价格的 5%。
 * 我们的 mock 价格 std_dev 为 0,区间退化成一个点。
 */
export function riskPrice(feed: FeedData, mode: 'init' | 'maint'): PriceBand {
  const price = mode === 'init' ? feed.ema : feed.price.number, conf = mode === 'init' ? feed.ema_conf : feed.conf;
  const half = Math.min(conf * (feed.source === 'pyth' ? 2.12 : 1.96), price * 0.05);
  return { low: price - half, high: price + half };
}
// #endregion
