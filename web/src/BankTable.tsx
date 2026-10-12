import type { PoolView } from '@contract';
import { fmtPct, fmtToken, fmtUsd, short } from './format';

export function BankTable({ pool, selected, onSelect }: { pool: PoolView; selected: string | null; onSelect: (bank: string) => void }) {
  return (
    <div className="card">
      <h2>借贷池<small>group {short(pool.group)} · 状态快照 slot {pool.as_of_slot ?? '—'}</small></h2>
      <div className="tablewrap"><table>
        <thead><tr>
          <th>代币</th><th className="n">价格</th><th className="n">存款</th><th className="n">借款</th>
          <th className="n">利用率</th><th className="n">存款 APR</th><th className="n">借款 APR</th><th className="n">抵押权重 init / maint</th>
        </tr></thead>
        <tbody>
          {pool.banks.map((b) => (
            <tr key={b.address} className={`pick ${selected === b.address ? 'sel' : ''}`} onClick={() => onSelect(b.address)}
                tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onSelect(b.address)} aria-selected={selected === b.address}>
              <td><b>{b.label}</b><div className="muted mono">{short(b.address)}</div></td>
              <td className="n">{fmtUsd(b.price)}</td>
              <td className="n">{fmtToken(b.total_deposits, b.decimals)}<div className="muted">{fmtUsd(b.total_deposits_usd)}</div></td>
              <td className="n">{fmtToken(b.total_borrows, b.decimals)}<div className="muted">{fmtUsd(b.total_borrows_usd)}</div></td>
              <td className="n">{fmtPct(b.utilization)}</td>
              <td className="n">{fmtPct(b.lending_apr)}</td>
              <td className="n">{fmtPct(b.borrowing_apr)}</td>
              <td className="n">{b.weights.asset_init} / {b.weights.asset_maint}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}
