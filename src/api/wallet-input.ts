/** INPUT: 不可信请求。 OUTPUT: 公钥、u64 与动作验证。 POSITION: M7 输入边界。 SYNC: folder.md。 */
import { PublicKey } from '@solana/web3.js';
import { ApiError } from './errors';
import type { BuildRequest } from './types';
export function publicKey(value: unknown): PublicKey {
  try { if (typeof value !== 'string') throw Error(); return new PublicKey(value); }
  catch { throw new ApiError(400, 'invalid public key'); }
}
export function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'invalid JSON object');
  return value as Record<string, unknown>;
}
export function buildInput(value: unknown): BuildRequest {
  const v = objectBody(value);
  if (!['deposit', 'withdraw', 'borrow', 'repay'].includes(String(v.action)) || (v.all !== undefined && typeof v.all !== 'boolean')) throw new ApiError(400, 'invalid action/all');
  publicKey(v.wallet); publicKey(v.bank);
  if (v.all === true && v.action !== 'repay' && v.action !== 'withdraw') throw new ApiError(400, 'all requires repay or withdraw');
  if (typeof v.amount !== 'string') throw new ApiError(400, 'amount must be a decimal string');
  if (v.all !== true && (!/^\d+$/.test(v.amount) || v.amount.length > 20 || BigInt(v.amount) < 1n || BigInt(v.amount) > (1n << 64n) - 1n)) throw new ApiError(400, 'amount must be a positive u64');
  return v as unknown as BuildRequest;
}
export function formatAmount(amount: bigint, decimals: number): string {
  const digits = amount.toString().padStart(decimals + 1, '0');
  const whole = decimals ? digits.slice(0, -decimals) : digits;
  const fraction = decimals ? digits.slice(-decimals).replace(/0+$/, '') : '';
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? `.${fraction}` : '');
}
