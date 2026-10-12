/** INPUT: 固定 IDL、公开账户与数量。 OUTPUT: Anchor init/lending 指令。 POSITION: M7 无管理员构造器。 SYNC: folder.md。 */
import anchor, { type Idl } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, type AccountMeta } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import idl from '../../decoder/idl/marginfi.idl.json';
import type { WalletAction } from '../types';
// 空 provider：这里只调用 accountsStrict().instruction()，绝不加载钱包或隐式访问 RPC。
const program = new anchor.Program(idl as Idl, {} as anchor.Provider);
const pda = (seed: string, bank: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from(seed), bank.toBuffer()], program.programId)[0];
export const initInstruction = (group: PublicKey, account: PublicKey, wallet: PublicKey) => program.methods.marginfiAccountInitialize().accountsStrict({
  marginfiGroup: group, marginfiAccount: account, authority: wallet, feePayer: wallet, systemProgram: SystemProgram.programId,
}).instruction();
export function lendingInstruction(action: WalletAction, group: PublicKey, account: PublicKey, wallet: PublicKey, bank: PublicKey,
  ata: PublicKey, amount: bigint, all: boolean, remaining: AccountMeta[]) {
  const common = { marginfiGroup: group, marginfiAccount: account, signer: wallet, bank,
    bankLiquidityVault: pda('liquidity_vault', bank), tokenProgram: TOKEN_PROGRAM_ID };
  const n = new anchor.BN(amount.toString());
  if (action === 'deposit' || action === 'repay') {
    const builder = action === 'deposit' ? program.methods.lendingAccountDeposit(n) : program.methods.lendingAccountRepay(n, all);
    return builder.accountsStrict({ ...common, signerTokenAccount: ata }).instruction();
  }
  const builder = action === 'borrow' ? program.methods.lendingAccountBorrow(n) : program.methods.lendingAccountWithdraw(n, all);
  return builder.accountsStrict({ ...common, destinationTokenAccount: ata, bankLiquidityVaultAuthority: pda('liquidity_vault_auth', bank) })
    .remainingAccounts(remaining).instruction();
}
