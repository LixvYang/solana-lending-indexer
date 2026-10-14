import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { usePoll } from './hooks';
import { Kpis } from './Kpis';
import { BankTable } from './BankTable';
import { RateCurve } from './RateCurve';
import { Accounts } from './Accounts';
import { Activity } from './Activity';
import { Xray } from './Xray';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { WalletPanel } from './wallet/WalletPanel';
import { short } from './format';

type Theme = 'auto' | 'light' | 'dark';
const NEXT: Record<Theme, Theme> = { auto: 'light', light: 'dark', dark: 'auto' };

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => { try { return (localStorage.getItem('theme') as Theme) || 'auto'; } catch { return 'auto'; } });
  useEffect(() => {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch { /* 隐私模式下可能不可用，页面照常工作 */ }
  }, [theme]);
  return [theme, () => setTheme(NEXT[theme])] as const;
}

export function App() {
  const [theme, cycle] = useTheme();
  const [bank, setBank] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  const pool = usePoll(api.pool, []);
  const accounts = usePoll(api.accounts, []);
  const activity = usePoll(() => api.activity(), []);
  const selected = bank ?? pool.data?.banks[0]?.address ?? null;
  const curve = usePoll(() => (selected ? api.rateCurve(selected) : Promise.resolve(null)), [selected]);
  const close = useCallback(() => setTx(null), []);
  const error = pool.error ?? accounts.error ?? activity.error;

  return (
    <div className="wrap">
      <div className="top">
        <div><h1>借贷池 X 光</h1>
          <div className="sub">marginfi mrgn-0.1.0 · devnet{pool.data ? <> · 程序 <span className="mono">{short(pool.data.program, 6)}</span></> : null}
            {pool.updatedAt && <span className="muted"> · 更新于 {pool.updatedAt.toLocaleTimeString('zh-CN', { hour12: false })}</span>}</div></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <WalletMultiButton />
          <button className="theme" onClick={cycle} aria-label="切换主题">主题：{theme === 'auto' ? '跟随系统' : theme === 'light' ? '浅色' : '深色'}</button>
        </div>
      </div>
      {error && <div className="err">无法读取数据：{error}。请确认 API 已启动（pnpm exec tsx scripts/serve-api.ts）。</div>}
      {pool.data && (
        <div>
          <Kpis pool={pool.data} />
          <div style={{ marginBottom: 16 }}><WalletPanel banks={pool.data.banks} accounts={accounts.data ?? []} /></div>
          <div style={{ marginBottom: 16 }}><BankTable pool={pool.data} selected={selected} onSelect={setBank} /></div>
          <div className="grid two">
            <div className="card"><h2>利率曲线<small>{curve.data?.label ?? ''}</small></h2>{curve.data ? <RateCurve curve={curve.data} /> : <div className="muted">加载中…</div>}</div>
            {accounts.data && <Accounts accounts={accounts.data} pool={pool.data} />}
          </div>
          {activity.data && <Activity first={activity.data.items} next={activity.data.next_before} pool={pool.data} onOpen={setTx} />}
        </div>
      )}
      {tx && <Xray signature={tx} onClose={close} />}
    </div>
  );
}
