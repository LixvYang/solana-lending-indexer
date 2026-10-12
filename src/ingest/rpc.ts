/** INPUT: JSON-RPC 原始形状。 OUTPUT: RPC 数据类型。 POSITION: EP6 只读边界。 SYNC: 同步 folder.md。 */
import type { RpcTransaction } from '../decoder/transaction';
export type RawTransaction = RpcTransaction & { slot: number; blockTime: number | null; version?: number | 'legacy' };
// 支持到交易版本 1：devnet 区块里已经出现 v1 交易(2026-10-12 实测 slot 509953364 有 5 笔)，
// 用 0 会让整个 getBlock 报错，indexer 就卡死在这个 slot。v1 的 JSON 形状与 v0 相同
// (accountKeys / instructions)，只是把 addressTableLookups 换成 transactionConfig。
export const MAX_TX_VERSION = 1;
export interface RpcAccount { owner: string; lamports: number | string; data: [string, 'base64'] }
export interface AccountResponse { context: { slot: number }; value: (RpcAccount | null)[] }
export interface RpcBlock { blockTime: number | null; transactions: Omit<RawTransaction, 'slot' | 'blockTime'>[] }
export interface SignatureInfo { signature: string; err: unknown }
export class RpcError extends Error {
  constructor(public readonly code: number, message: string) { super(message); this.name = 'RpcError'; }
}
interface Options { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; retries?: number; delayMs?: number; timeoutMs?: number }
export class Rpc {
  private id = 0;
  constructor(private readonly url: string, private readonly options: Options = {}) {}
  private redact(message: string): string {
    const key = new URL(this.url).searchParams.get('api-key');
    let clean = message.replace(/([?&]api-key=)[^&\s"']*/gi, '$1[REDACTED]');
    if (key) for (const form of [key, encodeURIComponent(key), encodeURI(key)]) clean = clean.split(form).join('[REDACTED]');
    return clean;
  }
  private async request<T>(method: string, params: unknown[]): Promise<T> {
    const retries = this.options.retries ?? 3;
    for (let attempt = 0; ; attempt++) {
      let retry = false;
      try {
        retry = true;
        const response = await (this.options.fetch ?? fetch)(this.url, { method: 'POST',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }),
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 15000) });
        retry = response.status === 429 || response.status >= 500;
        if (!response.ok) throw Error(`HTTP ${response.status} ${await response.text()}`);
        const body = await response.json() as { result?: T; error?: { code: number; message: string } };
        if (body.error) {
          retry = [-32004, -32005].includes(body.error.code);
          throw new RpcError(body.error.code, body.error.message);
        }
        if (!('result' in body)) throw Error('missing result in JSON-RPC response');
        return body.result as T;
      } catch (error) {
        if (!retry || attempt >= retries) {
          const message = this.redact(`${method}: ${error instanceof Error ? error.message : String(error)}`);
          if (error instanceof RpcError) throw new RpcError(error.code, message);
          throw new Error(message);
        }
        await (this.options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))((this.options.delayMs ?? 250) * 2 ** attempt);
      }
    }
  }
  getSlot() { return this.request<number>('getSlot', [{ commitment: 'finalized' }]); }
  getBlocks(start: number, end: number) { return this.request<number[]>('getBlocks', [start, end, { commitment: 'finalized' }]); }
  getBlock(slot: number) { return this.request<RpcBlock | null>('getBlock', [slot, { commitment: 'finalized', encoding: 'json',
    transactionDetails: 'full', rewards: false, maxSupportedTransactionVersion: MAX_TX_VERSION }]); }
  getSignaturesForAddress(address: string, before?: string) {
    return this.request<SignatureInfo[]>('getSignaturesForAddress', [address, { commitment: 'finalized', limit: 1000, ...(before ? { before } : {}) }]);
  }
  getTransaction(signature: string) { return this.request<RawTransaction | null>('getTransaction', [signature,
    { commitment: 'finalized', encoding: 'json', maxSupportedTransactionVersion: MAX_TX_VERSION }]); }
  getMultipleAccounts(addresses: string[]) { return this.request<AccountResponse>('getMultipleAccounts', [addresses, { commitment: 'finalized', encoding: 'base64' }]); }
}
