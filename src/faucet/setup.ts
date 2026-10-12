/** INPUT: 管理员/专用钱包公开地址、mint 与补充数量。 OUTPUT: SOL 转账与 mint-to 指令。 POSITION: 仅一次性 setup 工具使用。 SYNC: folder.md。 */
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction } from '@solana/spl-token';
import type { Grant } from './config';
export function setupInstructions(admin: PublicKey, faucet: PublicKey, lamports: bigint, grants: Grant[]) {
  return [SystemProgram.transfer({ fromPubkey: admin, toPubkey: faucet, lamports }), ...grants.flatMap(g => {
    const ata = getAssociatedTokenAddressSync(g.mint, faucet);
    return [createAssociatedTokenAccountIdempotentInstruction(admin, ata, faucet, g.mint), createMintToInstruction(g.mint, ata, admin, g.amount)];
  })];
}
