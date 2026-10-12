/** INPUT: 内存限流状态、钱包/IP/时间。 OUTPUT: 新状态或下次可用时间。 POSITION: EP8 纯限流函数。 SYNC: folder.md。 */
export interface LimitState { wallets: Record<string, number>; ips: Record<string, number[]>; day: string; count: number }
export const emptyLimits = (): LimitState => ({ wallets: {}, ips: {}, day: '', count: 0 });
// #region ep8-faucet-limit
export function reserve(state: LimitState, wallet: string, ip: string, now: number, dailyMax = 2000):
  { ok: true; state: LimitState; next: number } | { ok: false; next: number } {
  const day = new Date(now).toISOString().slice(0, 10), count = state.day === day ? state.count : 0;
  const ips = Object.fromEntries(Object.entries(state.ips).map(([key, times]) => [key, times.filter(t => t > now - 3600_000)]).filter(([, times]) => times.length));
  const wallets = Object.fromEntries(Object.entries(state.wallets).filter(([, time]) => time + 600_000 > now));
  const hits = ips[ip] ?? [], deadlines = [now];
  if (wallets[wallet] !== undefined) deadlines.push(wallets[wallet] + 600_000);
  if (hits.length >= 5) deadlines.push(hits[hits.length - 5] + 3600_000);
  if (count >= dailyMax) deadlines.push(Date.parse(`${day}T00:00:00Z`) + 86400_000);
  const next = Math.max(...deadlines);
  if (next > now) return { ok: false, next };
  const updated = [...hits, now];
  const nextAfterGrant = Math.max(now + 600_000, updated.length >= 5 ? updated[updated.length - 5] + 3600_000 : now,
    count + 1 >= dailyMax ? Date.parse(`${day}T00:00:00Z`) + 86400_000 : now);
  return { ok: true, state: { wallets: { ...wallets, [wallet]: now }, ips: { ...ips, [ip]: updated }, day, count: count + 1 }, next: nextAfterGrant };
}
// #endregion
