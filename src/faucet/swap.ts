/** INPUT: 专用钱包、RPC、汇率配置。 OUTPUT: 兑换报价(兑换台已签名的交易)与受限转发。 POSITION: 兑换台,只提供代币、不垫付 SOL。 SYNC: folder.md。 */
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { ApiError } from '../api/errors';
import { guardTransaction, submitSigned } from '../api/send';
import { tokenBalance } from '../api/wallet';
import { objectBody, publicKey } from '../api/wallet-input';
import type { WalletRpc, WaitClock } from '../api/wallet-rpc';
import { realClock } from '../api/wallet-rpc';
import type { SendResponse, SwapQuoteResponse, SwapRatesView, SwapToken } from '../api/types';
import { nativeAmount } from './config';

const LAMPORTS_PER_SOL = 1_000_000_000n;
export interface SwapToken_ { label: SwapToken; mint: PublicKey; decimals: number; /** 1 SOL 换多少原生单位 */ perSolNative: bigint }
export interface SwapConfig { tokens: SwapToken_[]; minLamports: bigint; maxLamports: bigint }

// #region ep8-swap-math
/** 换出多少:整数运算、向下取整,永远不会多给。例如 0.1 SOL × (50 tUSDC = 50_000_000 原生单位/SOL) = 5_000_000。 */
export const swapOut = (lamports: bigint, perSolNative: bigint): bigint => lamports * perSolNative / LAMPORTS_PER_SOL;
// #endregion

const ui = (native: bigint, decimals: number) => {
  const base = 10n ** BigInt(decimals), fraction = (native % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${native / base}${fraction ? `.${fraction}` : ''}`;
};

export function createSwap(payer: Keypair, rpc: WalletRpc, config: SwapConfig, clock: WaitClock = realClock) {
  const programs = new Set([ComputeBudgetProgram.programId, SystemProgram.programId, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID].map(p => p.toBase58()));
  return {
    rates(): SwapRatesView {
      return { rates: Object.fromEntries(config.tokens.map(t => [t.label, ui(t.perSolNative, t.decimals)])) as SwapRatesView['rates'],
        min_sol: ui(config.minLamports, 9), max_sol: ui(config.maxLamports, 9) };
    },

    async quote(input: unknown): Promise<SwapQuoteResponse> {
      const body = objectBody(input), wallet = publicKey(body.wallet);
      const token = config.tokens.find(t => t.label === body.token);
      if (!token) throw new ApiError(400, 'unknown token');
      let lamports: bigint;
      try { lamports = nativeAmount(String(body.sol), 9); } catch { throw new ApiError(400, 'invalid sol amount'); }
      if (lamports < config.minLamports || lamports > config.maxLamports) throw new ApiError(400, `sol amount must be between ${ui(config.minLamports, 9)} and ${ui(config.maxLamports, 9)}`);
      const out = swapOut(lamports, token.perSolNative);
      if (out < 1n) throw new ApiError(400, 'amount too small');
      if (await tokenBalance(rpc, token.mint, payer.publicKey) < out) throw new ApiError(503, '兑换台的测试代币不足，请联系维护者补充。');

      const userAta = getAssociatedTokenAddressSync(token.mint, wallet), deskAta = getAssociatedTokenAddressSync(token.mint, payer.publicKey);
      // #region ep8-swap-tx
      // 一笔交易里两件事:用户转 SOL 给兑换台 + 兑换台转代币给用户。付手续费和 ATA 租金的是用户(payerKey = wallet)，
      // 兑换台只是"转出代币"的授权签名者，不垫付任何 SOL。兑换台的签名覆盖整条消息，用户改动任何内容都会让它失效。
      const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        createAssociatedTokenAccountIdempotentInstruction(wallet, userAta, wallet, token.mint),
        SystemProgram.transfer({ fromPubkey: wallet, toPubkey: payer.publicKey, lamports }),
        createTransferInstruction(deskAta, userAta, payer.publicKey, out)];
      const block = await rpc.getLatestBlockhash('confirmed');
      const tx = new VersionedTransaction(new TransactionMessage({ payerKey: wallet, recentBlockhash: block.blockhash, instructions }).compileToV0Message());
      tx.sign([payer]);
      // #endregion
      return { transaction: Buffer.from(tx.serialize()).toString('base64'), last_valid_block_height: block.lastValidBlockHeight, token: token.label,
        sol_lamports: String(lamports), out_amount: String(out), out_decimals: token.decimals,
        summary: `用 ${ui(lamports, 9)} SOL 兑换 ${ui(out, token.decimals)} ${token.label}` };
    },

    /** 只转发"兑换台自己签过名、且只含 计算预算/系统/代币/ATA 程序"的交易。 */
    async submit(input: unknown): Promise<SendResponse> {
      const { bytes, signature } = guardTransaction(input,
        (used, signers) => signers.includes(payer.publicKey.toBase58()) && used.every(p => programs.has(p)), 'not a swap transaction');
      return submitSigned(bytes, signature, rpc, clock);
    },
  };
}
export type Swap = ReturnType<typeof createSwap>;
