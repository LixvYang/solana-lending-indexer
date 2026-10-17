/** INPUT: 专用钱包、RPC、资产与 USD 单价配置。 OUTPUT: 兑换报价(兑换台已签名的交易)与受限转发。 POSITION: 兑换台,只提供资产、不垫付 SOL 手续费。 SYNC: folder.md。 */
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { ApiError } from '../api/errors';
import { guardTransaction, submitSigned } from '../api/send';
import { tokenBalance } from '../api/wallet';
import { objectBody, publicKey } from '../api/wallet-input';
import type { WalletRpc, WaitClock } from '../api/wallet-rpc';
import { realClock } from '../api/wallet-rpc';
import type { SendResponse, SwapAsset, SwapQuoteResponse, SwapRatesView } from '../api/types';
import { nativeAmount } from './config';

export interface SwapAssetConfig {
  symbol: SwapAsset;
  decimals: number;
  /** SOL 没有 mint(原生资产);代币有。 */
  mint?: PublicKey;
  /** 单价,USD × 1e6(整数),例如 $50 = 50_000_000n。 */
  usdMicro: bigint;
}
export interface SwapConfig { assets: SwapAssetConfig[]; minUsdMicro: bigint; maxUsdMicro: bigint; /** 兑换台至少保留的 SOL(付 ATA 租金等)。 */ keepLamports?: bigint }

// #region ep8-swap-math
/**
 * 卖出 amountIn(原生单位)能换到多少:整数运算、向下取整,永远不会多给。
 *   换出 = 卖出 × 单价(卖出) × 10^小数位(换出) / (单价(换出) × 10^小数位(卖出))
 * 例:1 SOL($50) → tUSDC($1):1e9 × 50e6 × 1e6 / (1e6 × 1e9) = 50e6,即 50 tUSDC。
 * 因为所有汇率都来自同一张 USD 单价表,SOL→tSOL→tUSDC→SOL 绕一圈只会因取整而略少,不会凭空变多(没有套利环)。
 */
export const swapOut = (amountIn: bigint, from: SwapAssetConfig, to: SwapAssetConfig): bigint =>
  amountIn * from.usdMicro * 10n ** BigInt(to.decimals) / (to.usdMicro * 10n ** BigInt(from.decimals));
/** 这笔卖出的价值(USD × 1e6),用来做上下限。 */
export const notionalMicro = (amountIn: bigint, from: SwapAssetConfig): bigint => amountIn * from.usdMicro / 10n ** BigInt(from.decimals);
// #endregion

const ui = (native: bigint, decimals: number) => {
  const base = 10n ** BigInt(decimals), fraction = (native % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${native / base}${fraction ? `.${fraction}` : ''}`;
};

export function createSwap(desk: Keypair, rpc: WalletRpc, config: SwapConfig, clock: WaitClock = realClock) {
  const allowed = new Set([ComputeBudgetProgram.programId, SystemProgram.programId, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID].map(p => p.toBase58()));
  const keep = config.keepLamports ?? 50_000_000n; // 兑换台至少留 0.05 SOL
  const asset = (symbol: unknown) => {
    const found = config.assets.find(a => a.symbol === symbol);
    if (!found) throw new ApiError(400, 'unknown asset');
    return found;
  };
  /** 兑换台持有多少该资产(SOL 看余额,代币看 ATA)。 */
  const deskHolds = async (a: SwapAssetConfig) => a.mint ? tokenBalance(rpc, a.mint, desk.publicKey) : BigInt(await rpc.getBalance(desk.publicKey, 'confirmed')) - keep;

  return {
    rates(): SwapRatesView {
      return { assets: config.assets.map(a => ({ symbol: a.symbol, decimals: a.decimals, usd: ui(a.usdMicro, 6) })),
        min_usd: ui(config.minUsdMicro, 6), max_usd: ui(config.maxUsdMicro, 6) };
    },

    async quote(input: unknown): Promise<SwapQuoteResponse> {
      const body = objectBody(input), wallet = publicKey(body.wallet), from = asset(body.from), to = asset(body.to);
      if (from.symbol === to.symbol) throw new ApiError(400, 'cannot swap an asset for itself');
      let amountIn: bigint;
      try { amountIn = nativeAmount(String(body.amount), from.decimals); } catch { throw new ApiError(400, 'invalid amount'); }
      const value = notionalMicro(amountIn, from);
      if (value < config.minUsdMicro || value > config.maxUsdMicro) throw new ApiError(400, `swap value must be between $${ui(config.minUsdMicro, 6)} and $${ui(config.maxUsdMicro, 6)}`);
      const out = swapOut(amountIn, from, to);
      if (out < 1n) throw new ApiError(400, 'amount too small');
      if (await deskHolds(to) < out) throw new ApiError(503, `兑换台的 ${to.symbol} 不足，请换小一点的数量或稍后再试。`);

      // #region ep8-swap-tx
      // 一笔交易里两件事:用户把 from 转给兑换台 + 兑换台把 to 转给用户。付手续费和 ATA 租金的是用户(payerKey = wallet)，
      // 兑换台只是"转出资产"的授权签名者，不垫付手续费。兑换台的签名覆盖整条消息，用户改动任何内容都会让它失效。
      const instructions: TransactionInstruction[] = [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 })];
      if (from.mint) instructions.push(createTransferInstruction(getAssociatedTokenAddressSync(from.mint, wallet), getAssociatedTokenAddressSync(from.mint, desk.publicKey), wallet, amountIn));
      else instructions.push(SystemProgram.transfer({ fromPubkey: wallet, toPubkey: desk.publicKey, lamports: amountIn }));
      if (to.mint) {
        const userAta = getAssociatedTokenAddressSync(to.mint, wallet);
        instructions.push(createAssociatedTokenAccountIdempotentInstruction(wallet, userAta, wallet, to.mint),
          createTransferInstruction(getAssociatedTokenAddressSync(to.mint, desk.publicKey), userAta, desk.publicKey, out));
      } else instructions.push(SystemProgram.transfer({ fromPubkey: desk.publicKey, toPubkey: wallet, lamports: out }));
      const block = await rpc.getLatestBlockhash('confirmed');
      const tx = new VersionedTransaction(new TransactionMessage({ payerKey: wallet, recentBlockhash: block.blockhash, instructions }).compileToV0Message());
      tx.sign([desk]);
      // #endregion
      return { transaction: Buffer.from(tx.serialize()).toString('base64'), last_valid_block_height: block.lastValidBlockHeight,
        from: from.symbol, to: to.symbol, in_amount: String(amountIn), in_decimals: from.decimals, out_amount: String(out), out_decimals: to.decimals,
        summary: `用 ${ui(amountIn, from.decimals)} ${from.symbol} 兑换 ${ui(out, to.decimals)} ${to.symbol}` };
    },

    /** 只转发"兑换台自己签过名、且只含 计算预算/系统/代币/ATA 程序"的交易。 */
    async submit(input: unknown): Promise<SendResponse> {
      const { bytes, signature } = guardTransaction(input,
        (used, signers) => signers.includes(desk.publicKey.toBase58()) && used.every(p => allowed.has(p)), 'not a swap transaction');
      return submitSigned(bytes, signature, rpc, clock);
    },
  };
}
export type Swap = ReturnType<typeof createSwap>;
