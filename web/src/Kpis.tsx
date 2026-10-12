import type { PoolView } from '@contract';
import { fmtPct, fmtUsd } from './format';

export function Kpis({ pool }: { pool: PoolView }) {
  const u = pool.totals.utilization ?? 0;
  // 仪表：填充随严重程度变色(accent → warning → critical)；未填充的轨道是同色阶的浅一档。
  const level = u > 0.95 ? 'crit' : u > 0.8 ? 'warn' : '';
  return (
    <div className="grid kpis">
      <div className="card"><div className="label">总存款</div><div className="hero">{fmtUsd(pool.totals.deposits_usd)}</div></div>
      <div className="card"><div className="label">总借款</div><div className="stat">{fmtUsd(pool.totals.borrows_usd)}</div></div>
      <div className="card">
        <div className="label">整体利用率</div><div className="stat">{fmtPct(pool.totals.utilization)}</div>
        <div className={`meter ${level}`} role="img" aria-label={`利用率 ${fmtPct(u)}`}><i style={{ width: `${Math.min(100, u * 100)}%` }} /></div>
      </div>
    </div>
  );
}
