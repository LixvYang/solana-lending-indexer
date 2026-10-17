import type { AccountView, ActivityPage, ClientConfig, PoolView, RateCurveView, XrayView } from '@contract';

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error ?? `${path} → ${response.status}`);
  return body as T;
}

export const api = {
  pool: () => get<PoolView>('/api/pool'),
  config: () => get<ClientConfig>('/api/config'),
  rateCurve: (bank: string) => get<RateCurveView>(`/api/rate-curve?bank=${encodeURIComponent(bank)}`),
  accounts: () => get<AccountView[]>('/api/accounts'),
  activity: (before?: string) => get<ActivityPage>(`/api/activity?limit=20${before ? `&before=${encodeURIComponent(before)}` : ''}`),
  xray: (signature: string) => get<XrayView>(`/api/tx/${signature}`),
};
