import type { BuildRequest, BuildResponse, FaucetResponse, SendResponse, WalletView } from '@contract';

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const e = (body as { error?: string | { message?: string } }).error;
    throw new Error(typeof e === 'string' ? e : e?.message ?? `${url} → ${response.status}`);
  }
  return body as T;
}
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

// 浏览器里没有 Anchor，也没有 RPC 密钥：交易由服务端构建，钱包签名，服务端转发。
export const chain = {
  wallet: (pubkey: string) => call<WalletView>(`/api/wallet/${pubkey}`),
  build: (request: BuildRequest) => call<BuildResponse>('/api/build', post(request)),
  send: (transaction: string) => call<SendResponse>('/api/send', post({ transaction })),
  faucet: (url: string, wallet: string) => call<FaucetResponse>(`${url}/faucet`, post({ wallet })),
};

export const explorer = (signature: string) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;

export const b64 = {
  decode: (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
  encode: (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)),
};
