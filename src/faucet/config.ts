/** INPUT: 环境变量、池子 BankView。 OUTPUT: 精确水龙头数量/配置。 POSITION: EP8 测试币配置。 SYNC: folder.md。 */
import { PublicKey } from '@solana/web3.js';
import type { BankView } from '../api/types';
export interface Grant { label: string; mint: PublicKey; amount: bigint }
export function nativeAmount(value: string, decimals: number): bigint {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw Error('invalid amount');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw Error('too many decimals');
  const amount = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  if (amount < 1n || amount > (1n << 64n) - 1n) throw Error('invalid u64 amount');
  return amount;
}
export function faucetGrants(banks: BankView[], env: NodeJS.ProcessEnv = process.env): Grant[] {
  return (['tUSDC', 'tSOL'] as const).map(label => {
    const bank = banks.find(b => b.label === label);
    if (!bank) throw Error('faucet bank unavailable');
    return { label, mint: new PublicKey(bank.mint), amount: nativeAmount(env[label === 'tUSDC' ? 'FAUCET_TUSDC_AMOUNT' : 'FAUCET_TSOL_AMOUNT'] ?? (label === 'tUSDC' ? '1000' : '10'), bank.decimals) };
  });
}
export function dailyLimit(value: string | undefined): number {
  if (value === undefined) return 2000;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw Error('invalid daily limit');
  return Number(value);
}
