import { useCallback, useEffect, useState } from 'react';
import type { ClientConfig, WalletAction, WalletView } from '@contract';
import { chain } from './wallet/chain';
import { api } from './api';
import { usePoll } from './hooks';
import { Kpis } from './Kpis';
import { Markets } from './Markets';
import { SwapPage } from './swap/SwapPage';
import { BankDetail } from './BankDetail';
import { RateCurve } from './RateCurve';
import { Accounts } from './Accounts';
import { Activity } from './Activity';
import { Xray } from './Xray';
import { TabBar, TabPanel, useTab, type TabDef } from './Tabs';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { WalletPanel, type WalletPreset } from './wallet/WalletPanel';
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
  const [tab, go] = useTab();
  const { connected, publicKey } = useWallet();
  const address = publicKey?.toBase58() ?? null;
  const [bank, setBank] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  const [preset, setPreset] = useState<WalletPreset | null>(null);
  // 用户刚发完交易时加速轮询 45 秒(1.5 秒一次),这样页面几秒内就能反映出来;平时 5 秒一次。
  const [fast, setFast] = useState(false);
  const boost = useCallback(() => { setFast(true); window.setTimeout(() => setFast(false), 45_000); }, []);
  const every = fast ? 1500 : 5000;
  // 三份数据都在后台轮询(不管在哪个 tab):tab 上的计数与"可清算"提醒要实时,切 tab 也不必等加载。
  const pool = usePoll(api.pool, [every], every);
  const accounts = usePoll(api.accounts, [every], every);
  const activity = usePoll(() => api.activity(), [every], every);
  const selected = pool.data?.banks.find((b) => b.address === bank) ?? pool.data?.banks[0] ?? null;
  const curve = usePoll(() => (selected ? api.rateCurve(selected.address) : Promise.resolve(null)), [selected?.address]);
  const close = useCallback(() => setTx(null), []);
  const config = usePoll<ClientConfig>(api.config, [], 60_000).data;
  // 钱包余额只在这里轮询一次,"我来操作"和"兑换"共用(每次都要走 RPC,不要两个 tab 各拉一份)。
  const wallet = usePoll<WalletView | null>(() => (address ? chain.wallet(address) : Promise.resolve(null)), [address, fast], fast ? 1500 : 6000).data;
  const actOn = useCallback((bank: string, action: WalletAction) => { setPreset({ action, bank, nonce: Date.now() }); go('wallet'); }, [go]);
  const act = useCallback((action: WalletAction) => { if (selected) actOn(selected.address, action); }, [selected, actOn]);
  const goSwap = useCallback(() => go('swap'), [go]);
  const error = pool.error ?? accounts.error ?? activity.error;

  const risky = accounts.data?.filter((a) => a.status === 'liquidatable').length ?? 0;
  const tabs: TabDef[] = [
    { id: 'pool', label: '借贷池' },
    { id: 'wallet', label: '我来操作', badge: connected ? <span className="live-dot" title="钱包已连接" /> : undefined },
    { id: 'swap', label: '兑换' },
    { id: 'accounts', label: '账户', badge: accounts.data && (risky
      ? <span className="count crit" title={`${risky} 个账户可被清算`}>{risky} 可清算</span>
      : <span className="count">{accounts.data.length}</span>) },
    { id: 'activity', label: '链上活动' },
  ];

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
      <TabBar tabs={tabs} active={tab} onChange={go} />
      {error && <div className="err">无法读取数据：{error}。请确认 API 已启动（pnpm exec tsx scripts/serve-api.ts）。</div>}
      {!pool.data && !error && <div className="muted">加载中…</div>}
      {pool.data && (
        <>
          <TabPanel id="pool" active={tab}>
            <Kpis pool={pool.data} />
            <div style={{ marginBottom: 16 }}><Markets pool={pool.data} selected={selected?.address ?? null} onSelect={setBank} onAct={actOn} /></div>
            <div className="grid curve">
              <div className="card"><h2>利率曲线<small>{curve.data?.label ?? ''} · 点上表的行切换资产</small></h2>{curve.data ? <RateCurve curve={curve.data} /> : <div className="muted">加载中…</div>}</div>
              {selected && <BankDetail bank={selected} onAct={act} />}
            </div>
          </TabPanel>
          <TabPanel id="accounts" active={tab}>
            {accounts.data ? <Accounts accounts={accounts.data} pool={pool.data} /> : <div className="muted">加载中…</div>}
          </TabPanel>
          <TabPanel id="activity" active={tab}>
            {activity.data ? <Activity first={activity.data.items} next={activity.data.next_before} pool={pool.data} onOpen={setTx} /> : <div className="muted">加载中…</div>}
          </TabPanel>
          <TabPanel id="wallet" active={tab}>
            <WalletPanel banks={pool.data.banks} accounts={accounts.data ?? []} onTransaction={boost} onOpenTx={setTx} onGoSwap={goSwap} wallet={wallet} preset={preset} />
          </TabPanel>
          <TabPanel id="swap" active={tab}>
            <SwapPage faucetUrl={config?.faucet_url ?? null} onDone={boost} wallet={wallet} />
          </TabPanel>
        </>
      )}
      {tx && <Xray signature={tx} onClose={close} />}
    </div>
  );
}
