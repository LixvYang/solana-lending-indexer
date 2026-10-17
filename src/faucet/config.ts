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
const GRANTS = { tUSDC: ['FAUCET_TUSDC_AMOUNT', '1000'], tSOL: ['FAUCET_TSOL_AMOUNT', '10'], pSOL: ['FAUCET_PSOL_AMOUNT', '10'] } as const;
/** tUSDC、tSOL 必须有;pSOL(Pyth 定价)是后加的银行,池子里有才发。 */
export function faucetGrants(banks: BankView[], env: NodeJS.ProcessEnv = process.env): Grant[] {
  return (Object.keys(GRANTS) as (keyof typeof GRANTS)[]).flatMap(label => {
    const bank = banks.find(b => b.label === label);
    if (!bank) { if (label === 'pSOL') return []; throw Error('faucet bank unavailable'); }
    const [name, fallback] = GRANTS[label];
    return [{ label, mint: new PublicKey(bank.mint), amount: nativeAmount(env[name] ?? fallback, bank.decimals) }];
  });
}
export function dailyLimit(value: string | undefined): number {
  if (value === undefined) return 2000;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw Error('invalid daily limit');
  return Number(value);
}
