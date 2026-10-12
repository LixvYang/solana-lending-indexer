/** INPUT: 用户槽位、动作与池子 banks。 OUTPUT: 操作后的 bank/feed 观察顺序。 POSITION: EP8 风险引擎账户排列。 SYNC: folder.md。 */
import { PublicKey, type AccountMeta } from '@solana/web3.js';
import type { Position } from '../state';
import type { WalletAction } from '../types';
import type { BuildBank } from './state';
import { ApiError } from '../errors';
// #region ep8-remaining
export function remainingBanks(balances: Position[], action: WalletAction, target: string, all: boolean): string[] {
  const slots = balances.map(b => b.active ? b.bank_pk : null);
  // find_or_create 用第一个 inactive，不能把新 bank 简单 append 到 active 列表末尾。
  if (action === 'borrow' && !slots.includes(target)) {
    const index = slots.indexOf(null);
    if (index < 0) throw new ApiError(400, 'balance slots full');
    slots[index] = target;
  }
  // mrgn-0.1.0 withdraw_all 在健康检查前 close balance；部分取款保留槽位。
  if (action === 'withdraw' && all) return slots.filter((b): b is string => b !== null && b !== target);
  return slots.filter((b): b is string => b !== null);
}
export function observation(addresses: string[], banks: Record<string, BuildBank>, group: string): AccountMeta[] {
  return addresses.flatMap(address => {
    const bank = banks[address];
    if (!bank || bank.group !== group) throw new ApiError(400, 'active bank outside pool');
    return [address, bank.config.oracle_keys[0]].map(key => ({ pubkey: new PublicKey(key), isSigner: false, isWritable: false }));
  });
}
// #endregion
