/**
 * 仅开发预览用：没有 API 时 `?mock` 会接管 fetch，返回符合 src/api/types.ts 契约的假数据。
 * 数值取自真实剧本的结束状态；`?mock=liquidation` 改成"清算前一刻的 Bob"，用来看可清算状态的样子。
 * 不属于产品代码，生产构建不会引入它(只在 import.meta.env.DEV 下动态加载)。
 */
import type { AccountView, ActivityItem, BankView, PoolView, RateCurveView, RatePoint } from '@contract';
import run from '../../fixtures/m1-run.json';
import xray from './mock-xray.json';

const a = run.addresses;
const curve = { optimal_utilization: 0.5, plateau_rate: 0.6, max_rate: 3, fee_rate: 0.06, fee_fixed_apr: 0.04 };
const rates = (u: number): RatePoint => {
  const base = u <= curve.optimal_utilization ? (u / curve.optimal_utilization) * curve.plateau_rate
    : ((u - curve.optimal_utilization) / (1 - curve.optimal_utilization)) * (curve.max_rate - curve.plateau_rate) + curve.plateau_rate;
  return { utilization: u, lending_apr: base * u, borrowing_apr: base * (1 + curve.fee_rate) + curve.fee_fixed_apr };
};

export function installMock() {
  const liquidation = new URLSearchParams(location.search).get('mock') === 'liquidation';
  const bank = (address: string, label: string, mint: string, decimals: number, price: number, dep: string, bor: string, depUsd: number, borUsd: number): BankView => {
    const u = depUsd ? borUsd / depUsd : 0;
    return { address, mint, label, decimals, price, price_updated_at: new Date().toISOString(), oracle_feed: null, total_deposits: dep, total_borrows: bor,
      total_deposits_usd: depUsd, total_borrows_usd: borUsd, utilization: u, lending_apr: rates(u).lending_apr, borrowing_apr: rates(u).borrowing_apr,
      weights: label === 'tSOL' ? { asset_init: 0.8, asset_maint: 0.9, liability_init: 1.1, liability_maint: 1.05 } : { asset_init: 1, asset_maint: 1, liability_init: 1.1, liability_maint: 1.05 },
      curve, asset_share_value: '1.000000155398776513', liability_share_value: '1.000000445109712643', last_accrual_at: new Date().toISOString() };
  };
  const banks = [
    bank(a.banks.tUSDC, 'tUSDC', a.mints.tUSDC, 6, 1, liquidation ? '16000000000' : '14512501895', liquidation ? '5000001696' : '0', liquidation ? 16000 : 14512.5, liquidation ? 5000 : 0),
    bank(a.banks.tSOL, 'tSOL', a.mints.tSOL, 9, 50, '100000000000', '0', 5000, 0),
  ];
  const pool: PoolView = { program: '8fQDybohNdR4rNcPFs6FYpHscMRLechbyBiCqjihdgv9', group: a.group, as_of_slot: '509953400', banks,
    totals: { deposits_usd: banks.reduce((s, b) => s + (b.total_deposits_usd ?? 0), 0), borrows_usd: banks.reduce((s, b) => s + (b.total_borrows_usd ?? 0), 0),
      utilization: liquidation ? 5000 / 21000 : 0 } };
  const balance = (b: BankView, deposit: string, borrow: string, du: number, bu: number) => ({ bank: b.address, label: b.label, deposit, borrow, deposit_usd: du, borrow_usd: bu });
  const accounts: AccountView[] = [
    { address: a.marginfiAccounts.alice, label: 'alice', authority: a.actors.alice, balances: [balance(banks[0], '9000001546', '0', 9000, 0)],
      health: { init: 9000, maint: 9000, assets_usd: 9000, liabilities_usd: 0 }, status: 'no_debt' },
    liquidation
      ? { address: a.marginfiAccounts.bob, label: 'bob', authority: a.actors.bob, balances: [balance(banks[1], '100000000000', '0', 5000, 0), balance(banks[0], '0', '5000001696', 0, 5000)],
          health: { init: -1000.0, maint: -750.0018, assets_usd: 4500, liabilities_usd: 5250.0018 }, status: 'liquidatable' }
      : { address: a.marginfiAccounts.bob, label: 'bob', authority: a.actors.bob, balances: [balance(banks[1], '90000000000', '0', 4500, 0)],
          health: { init: 3600, maint: 4050, assets_usd: 4050, liabilities_usd: 0 }, status: 'no_debt' },
    { address: a.marginfiAccounts.carol, label: 'carol', authority: a.actors.carol, balances: [balance(banks[0], '5512500348', '0', 5512.5, 0), balance(banks[1], '10000000000', '0', 500, 0)],
      health: { init: 5912.5, maint: 5962.5, assets_usd: 5962.5, liabilities_usd: 0 }, status: 'no_debt' },
  ];
  const nameOf = (l: string) => l.startsWith('bob borrow') ? 'lending_account_borrow' : l.includes('deposit') ? 'lending_account_deposit' : l.includes('liquidate') ? 'lending_account_liquidate'
    : l.includes('withdraw') ? 'lending_account_withdraw' : l.includes('repay') ? 'lending_account_repay' : l.startsWith('accrue') ? 'lending_pool_accrue_bank_interest'
    : l.startsWith('add bank') ? 'lending_pool_add_bank' : l.startsWith('create marginfi') ? 'marginfi_account_initialize' : l === 'create group' ? 'marginfi_group_initialize' : null;
  const items: ActivityItem[] = run.steps.filter((s) => nameOf(s.label)).reverse().map((s) => {
    const tok = s.label.includes('tSOL') ? 'tSOL' : s.label.includes('tUSDC') ? 'tUSDC' : null;
    const who = ['alice', 'bob', 'carol'].find((p) => s.label.includes(p)) ?? null;
    const amt = /(\d[\d,]*) (tUSDC|tSOL)/.exec(s.label);
    return { signature: s.signatures[0], slot: String(s.slot), block_time: new Date(1791733900000 + Number(s.slot) % 1000 * 400).toISOString(), ix_index: 1,
      instruction: nameOf(s.label)!, event: null, account: who ? (a.marginfiAccounts as Record<string, string>)[who] : null, account_label: who, bank: tok ? (a.banks as Record<string, string>)[tok] : null,
      bank_label: tok, amount: amt ? String(BigInt(amt[1].replace(/,/g, '')) * 10n ** BigInt(amt[2] === 'tSOL' ? 9 : 6)) : null, ok: true };
  });

  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (!url.pathname.startsWith('/api/')) return real(input, init);
    if (url.pathname === '/api/pool') return ok(pool);
    if (url.pathname === '/api/accounts') return ok(accounts);
    if (url.pathname === '/api/activity') return ok({ items, next_before: null });
    if (url.pathname === '/api/rate-curve') {
      const b = banks.find((x) => x.address === url.searchParams.get('bank')) ?? banks[0];
      const body: RateCurveView = { bank: b.address, label: b.label, points: Array.from({ length: 101 }, (_, i) => rates(i / 100)), current: rates(b.utilization) };
      return ok(body);
    }
    const sig = url.pathname.split('/').pop()!;
    const x = (xray as Record<string, unknown>)[sig] ?? Object.values(xray)[0];
    return ok(x);
  };
}
