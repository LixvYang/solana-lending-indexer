import type { BankView, WalletAction } from '@contract';
import { fmtPct, fmtTime, fmtUsd, fmtWeight, short } from './format';
import { SourceChip, TokenIcon, tokenMeta } from './tokens';

const SOURCE = { pyth: 'Pyth 实时行情', mock: 'Switchboard 布局的 mock,价格由我们写入', switchboard: 'Switchboard' } as const;

/** 选中资产的说明与参数:利率曲线旁边放"这条曲线由哪些参数决定",以及决定健康度的权重与价格来源。 */
export function BankDetail({ bank, onAct }: { bank: BankView; onAct: (action: WalletAction) => void }) {
  const row = (k: string, v: React.ReactNode, hint?: string) => <tr title={hint}><td className="muted">{k}</td><td className="n">{v}</td></tr>;
  const c = bank.curve, meta = tokenMeta(bank.label);
  return (
    <div className="card">
      <div className="asset-head">
        <TokenIcon symbol={bank.label} size={44} />
        <div><div className="asset-title">{bank.label} <SourceChip source={bank.oracle_source} /></div><div className="muted">{meta.name}</div></div>
        <div className="asset-price"><div className="stat">{fmtUsd(bank.price)}</div>
          <div className="muted">{bank.price_updated_at ? `更新于 ${fmtTime(bank.price_updated_at)}` : '没有价格快照'}</div></div>
      </div>
      <p className="asset-desc">{meta.description}</p>
      <div className="duo">
        <div><div className="label">存款 APR</div><div className="stat good-text">{fmtPct(bank.lending_apr, 2)}</div></div>
        <div><div className="label">借款 APR</div><div className="stat">{fmtPct(bank.borrowing_apr, 2)}</div></div>
      </div>
      <table className="params"><tbody>
        {row('抵押权重 开仓 / 维持', `${fmtWeight(bank.weights.asset_init)} / ${fmtWeight(bank.weights.asset_maint)}`, '存款计入健康度时乘的系数')}
        {row('负债权重 开仓 / 维持', `${fmtWeight(bank.weights.liability_init)} / ${fmtWeight(bank.weights.liability_maint)}`, '借款计入健康度时乘的系数')}
        {row('最优利用率', fmtPct(c.optimal_utilization, 0))}
        {row('拐点利率 / 最高利率', `${fmtPct(c.plateau_rate, 0)} / ${fmtPct(c.max_rate, 0)}`)}
        {row('协议费 比例 / 固定', `${fmtPct(c.fee_rate)} / ${fmtPct(c.fee_fixed_apr)}`)}
        {row('价格账户', bank.oracle_feed ? <span className="mono" title={SOURCE[bank.oracle_source ?? 'mock']}>{short(bank.oracle_feed)}</span> : '—')}
        {row('上次计息', fmtTime(bank.last_accrual_at))}
      </tbody></table>
      <div className="row-actions">
        <button className="btn primary" onClick={() => onAct('deposit')}>存入 {bank.label}</button>
        <button className="btn" onClick={() => onAct('borrow')}>借出 {bank.label}</button>
      </div>
    </div>
  );
}
