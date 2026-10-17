import type { BankView, WalletAction } from '@contract';
import { fmtPct, fmtTime, fmtUsd, fmtWeight, short } from './format';

/** 选中代币的参数卡:利率曲线旁边放"这条曲线由哪些参数决定",以及决定健康度的权重与价格来源。 */
export function BankDetail({ bank, onAct }: { bank: BankView; onAct: (action: WalletAction) => void }) {
  const row = (k: string, v: React.ReactNode) => <tr><td className="muted">{k}</td><td className="n">{v}</td></tr>;
  const c = bank.curve;
  return (
    <div className="card">
      <h2>{bank.label} 参数<small className="mono">{short(bank.address)}</small></h2>
      <div className="label">价格</div>
      <div className="stat">{fmtUsd(bank.price)}</div>
      <div className="muted" style={{ fontSize: 12 }}>
        {bank.price_updated_at ? `更新于 ${fmtTime(bank.price_updated_at)}` : '没有价格快照'}
        {bank.oracle_feed && <> · 价格账户 <span className="mono">{short(bank.oracle_feed)}</span>(Switchboard 布局的 mock)</>}
      </div>
      <table style={{ marginTop: 12 }}><tbody>
        {row('抵押权重 开仓 / 维持', `${fmtWeight(bank.weights.asset_init)} / ${fmtWeight(bank.weights.asset_maint)}`)}
        {row('负债权重 开仓 / 维持', `${fmtWeight(bank.weights.liability_init)} / ${fmtWeight(bank.weights.liability_maint)}`)}
        {row('最优利用率', fmtPct(c.optimal_utilization, 0))}
        {row('拐点利率 / 最高利率', `${fmtPct(c.plateau_rate, 0)} / ${fmtPct(c.max_rate, 0)}`)}
        {row('协议费 比例 / 固定', `${fmtPct(c.fee_rate)} / ${fmtPct(c.fee_fixed_apr)}`)}
        {row('上次计息', fmtTime(bank.last_accrual_at))}
      </tbody></table>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="theme" onClick={() => onAct('deposit')}>存入 {bank.label}</button>
        <button className="theme" onClick={() => onAct('borrow')}>借出 {bank.label}</button>
      </div>
    </div>
  );
}
