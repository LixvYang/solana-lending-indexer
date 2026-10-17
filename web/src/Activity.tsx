import { useState } from 'react';
import type { ActivityItem, PoolView } from '@contract';
import { api } from './api';
import { fmtTime, fmtToken, short } from './format';
import { TokenIcon } from './tokens';

export function Activity({ first, next, pool, onOpen }: { first: ActivityItem[]; next: string | null; pool: PoolView; onOpen: (signature: string) => void }) {
  const [more, setMore] = useState<ActivityItem[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const decimals = Object.fromEntries(pool.banks.map((b) => [b.address, b.decimals]));
  const seen = new Set<string>();
  const rows = [...first, ...more].filter((i) => { const k = `${i.signature}:${i.ix_index}`; return seen.has(k) ? false : (seen.add(k), true); });
  const before = cursor === undefined ? next : cursor;
  const load = async () => { if (!before) return; const page = await api.activity(before); setMore((m) => [...m, ...page.items]); setCursor(page.next_before); };
  return (
    <div className="card">
      <h2>链上活动<small>点任意一行，用“X 光”看它的原始字节 → 解码 → 数据库行</small></h2>
      <div className="tablewrap"><table>
        <thead><tr><th>时间</th><th>指令</th><th>账户</th><th>代币</th><th className="n">数量</th><th>结果</th></tr></thead>
        <tbody>{rows.map((i) => (
          <tr key={`${i.signature}:${i.ix_index}`} className="pick" tabIndex={0} onClick={() => onOpen(i.signature)} onKeyDown={(e) => e.key === 'Enter' && onOpen(i.signature)}>
            <td className="muted">{fmtTime(i.block_time)}<div className="mono">slot {i.slot}</div></td>
            <td><span className="mono">{i.instruction}</span></td>
            <td>{i.account_label ?? short(i.account)}</td>
            <td>{i.bank_label ? <span className="amt"><TokenIcon symbol={i.bank_label} size={18} />{i.bank_label}</span> : short(i.bank)}</td>
            <td className="n">{i.amount != null && i.bank ? fmtToken(i.amount, decimals[i.bank] ?? 0) : <span className="muted">—</span>}</td>
            <td><span className={`chip ${i.ok ? 'ok' : 'bad'}`}>{i.ok ? '成功' : '失败'}</span></td>
          </tr>))}</tbody>
      </table></div>
      {before && <p><button className="theme" onClick={load}>加载更多</button></p>}
    </div>
  );
}
