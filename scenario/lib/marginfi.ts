import anchor from '@coral-xyz/anchor';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram, type AccountMeta } from '@solana/web3.js';
import { bankConfig, fixed } from './bank-config';
import type { Person, Token } from './actors';
import type { Context } from './context';

const { BN } = anchor;

export function pda(ctx: Context, seed: string, bank?: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from(seed), ...(bank ? [bank.toBuffer()] : [])],
    ctx.program.programId)[0];
}
export function vaults(ctx: Context, token: Token) {
  const bank = ctx.actors.banks[token].publicKey;
  // 来源: program/.upstream/tests/utils/pdas.ts。
  return { liquidityVaultAuthority: pda(ctx, 'liquidity_vault_auth', bank),
    liquidityVault: pda(ctx, 'liquidity_vault', bank), insuranceVault: pda(ctx, 'insurance_vault', bank),
    insuranceVaultAuthority: pda(ctx, 'insurance_vault_auth', bank), feeVault: pda(ctx, 'fee_vault', bank),
    feeVaultAuthority: pda(ctx, 'fee_vault_auth', bank) };
}
export function tokenAccount(ctx: Context, person: Person, token: Token) {
  return getAssociatedTokenAddressSync(ctx.actors.mints[token].publicKey, ctx.actors[person].publicKey);
}
export function observation(ctx: Context, ordered: Token[]): AccountMeta[] {
  return ordered.flatMap(token => {
    const feed = ctx.feeds[token];
    if (!feed) throw new Error(`缺少 ${token} feed`);
    return [ctx.actors.banks[token].publicKey, feed].map(pubkey => ({ pubkey, isSigner: false, isWritable: false }));
  });
}

export function initFeeState(ctx: Context) {
  return ctx.program.methods.initGlobalFeeState(ctx.admin.publicKey, ctx.admin.publicKey, 0, fixed(0), fixed(0))
    .accountsStrict({ payer: ctx.admin.publicKey, feeState: ctx.feeState,
      rent: SYSVAR_RENT_PUBKEY, systemProgram: SystemProgram.programId }).instruction();
}
export function initGroup(ctx: Context) {
  return ctx.program.methods.marginfiGroupInitialize().accountsStrict({
    marginfiGroup: ctx.actors.group.publicKey, admin: ctx.admin.publicKey,
    feeState: ctx.feeState, systemProgram: SystemProgram.programId }).instruction();
}

// #region ep3-add-bank
// 来源: IDL lending_pool_add_bank / lending_pool_configure_bank_oracle；add_bank 不含 oracle 参数。
// 必须拆成添加与配置两步，accountsStrict 避免 Anchor 自动取不存在的 bank 来推导账户。
export async function addBank(ctx: Context, token: Token) {
  return ctx.program.methods.lendingPoolAddBank(bankConfig(token)).accountsStrict({
    marginfiGroup: ctx.actors.group.publicKey, admin: ctx.admin.publicKey, feePayer: ctx.admin.publicKey,
    feeState: ctx.feeState, globalFeeWallet: ctx.globalFeeWallet, bankMint: ctx.actors.mints[token].publicKey,
    bank: ctx.actors.banks[token].publicKey, ...vaults(ctx, token), rent: SYSVAR_RENT_PUBKEY,
    tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  }).instruction();
}
export function configureOracle(ctx: Context, token: Token) {
  const feed = ctx.feeds[token];
  if (!feed) throw new Error(`缺少 ${token} feed`);
  return ctx.program.methods.lendingPoolConfigureBankOracle(4, feed).accountsStrict({
    group: ctx.actors.group.publicKey, admin: ctx.admin.publicKey, bank: ctx.actors.banks[token].publicKey,
  }).remainingAccounts([{ pubkey: feed, isSigner: false, isWritable: false }]).instruction();
}
// #endregion

export function initAccount(ctx: Context, person: Person) {
  return ctx.program.methods.marginfiAccountInitialize().accountsStrict({
    marginfiGroup: ctx.actors.group.publicKey, marginfiAccount: ctx.actors.marginfiAccounts[person].publicKey,
    authority: ctx.actors[person].publicKey, feePayer: ctx.admin.publicKey, systemProgram: SystemProgram.programId,
  }).instruction();
}

export function lending(ctx: Context, action: 'deposit' | 'borrow' | 'withdraw' | 'repay',
  person: Person, token: Token, amount: bigint, ordered: Token[] = [], close = false) {
  const v = vaults(ctx, token);
  const common = { marginfiGroup: ctx.actors.group.publicKey,
    marginfiAccount: ctx.actors.marginfiAccounts[person].publicKey, signer: ctx.actors[person].publicKey,
    bank: ctx.actors.banks[token].publicKey, bankLiquidityVault: v.liquidityVault, tokenProgram: TOKEN_PROGRAM_ID };
  // 来源: IDL lending_account_*；数量为 mint 原生单位，不是 UI 数量或 shares。
  const quantity = new BN(amount.toString());
  if (action === 'deposit' || action === 'repay') {
    const builder = action === 'deposit' ? ctx.program.methods.lendingAccountDeposit(quantity)
      : ctx.program.methods.lendingAccountRepay(quantity, close);
    return builder.accountsStrict({ ...common, signerTokenAccount: tokenAccount(ctx, person, token) }).instruction();
  }
  const builder = action === 'borrow' ? ctx.program.methods.lendingAccountBorrow(quantity)
    : ctx.program.methods.lendingAccountWithdraw(quantity, close);
  return builder.accountsStrict({ ...common, destinationTokenAccount: tokenAccount(ctx, person, token),
    bankLiquidityVaultAuthority: v.liquidityVaultAuthority }).remainingAccounts(observation(ctx, ordered)).instruction();
}

export function liquidate(ctx: Context) {
  const v = vaults(ctx, 'tUSDC');
  // 来源: tests/utils/user-instructions.ts 与 instructions/marginfi_account/liquidate.rs。
  // Carol 先有 USDC 后增加 SOL；Bob 先 SOL 后 USDC。含将被新建的 Carol SOL 槽位。
  const remaining = [ctx.feeds.tSOL!, ctx.feeds.tUSDC!].map(pubkey => ({ pubkey, isSigner: false, isWritable: false }));
  return ctx.program.methods.lendingAccountLiquidate(new BN('10000000000')).accountsStrict({
    group: ctx.actors.group.publicKey, assetBank: ctx.actors.banks.tSOL.publicKey,
    liabBank: ctx.actors.banks.tUSDC.publicKey, liquidatorMarginfiAccount: ctx.actors.marginfiAccounts.carol.publicKey,
    signer: ctx.actors.carol.publicKey, liquidateeMarginfiAccount: ctx.actors.marginfiAccounts.bob.publicKey,
    bankLiquidityVaultAuthority: v.liquidityVaultAuthority, bankLiquidityVault: v.liquidityVault,
    bankInsuranceVault: v.insuranceVault, tokenProgram: TOKEN_PROGRAM_ID,
  }).remainingAccounts([...remaining, ...observation(ctx, ['tUSDC', 'tSOL']),
    ...observation(ctx, ['tSOL', 'tUSDC'])]).instruction();
}
export function accrue(ctx: Context, token: Token) {
  return ctx.program.methods.lendingPoolAccrueBankInterest().accountsStrict({
    marginfiGroup: ctx.actors.group.publicKey, bank: ctx.actors.banks[token].publicKey }).instruction();
}
