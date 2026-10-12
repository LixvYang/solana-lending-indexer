/** INPUT: Db、假/真实 RPC、BuildRequest。 OUTPUT: v0 部分签名交易与模拟。 POSITION: M7 构建服务，无管理员密钥。 SYNC: folder.md。 */
import { Keypair, PublicKey, ComputeBudgetProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import type { Db } from '../../store/db';
import { decodePullFeed } from '../../decoder/switchboard';
import { oracleOwners } from '../../store/accounts';
import { getPool } from '../queries';
import { readState } from '../state';
import type { BuildResponse } from '../types';
import type { WalletServices } from '../wallet-rpc';
import { ApiError } from '../errors';
import { buildInput, formatAmount } from '../wallet-input';
import { programError, publicLogs } from '../program-error';
import { chainWalletAccount, walletAccount, type BuildBank } from './state';
import { remainingBanks, observation } from './remaining';
import { initInstruction, lendingInstruction } from './instructions';
export class PriceStale extends ApiError {
  readonly view = { code: null, name: 'PriceStale', message: '价格维护进程没有运行，请等待价格更新。' };
  constructor() { super(409, '价格维护进程没有运行，请等待价格更新。'); }
}
export async function buildTransaction(db: Db, services: WalletServices, input: unknown): Promise<BuildResponse> {
  const request = buildInput(input), pool = await getPool(db), state = await readState(db);
  const bank = state.banks[request.bank] as BuildBank | undefined, view = pool.banks.find(b => b.address === request.bank);
  if (!pool.group || !bank || !view || bank.group !== pool.group) throw new ApiError(400, 'bank outside pool');
  const wallet = new PublicKey(request.wallet), group = new PublicKey(pool.group), target = new PublicKey(request.bank);
  const user = services.readUserFromChain ? await chainWalletAccount(db, services.rpc, request.wallet, pool.group)
    : await walletAccount(db, request.wallet, pool.group);
  if (!user && request.action !== 'deposit') throw new ApiError(400, 'deposit first to create account');
  const remaining = request.action === 'borrow' || request.action === 'withdraw'
    ? remainingBanks(user!.data.lending_account.balances, request.action, request.bank, request.all === true) : [];
  const banks = state.banks as Record<string, BuildBank>;
  const metas = observation(remaining, banks, pool.group);
  if (request.action === 'borrow' || request.action === 'withdraw') {
    // 读取当前链上 feed，DB 中 keeper 尚未采样的旧价格不能作为新鲜度证据。
    for (const address of new Set([...remaining, request.bank])) {
      const b = banks[address], feed = await services.rpc.getAccountInfo(new PublicKey(b.config.oracle_keys[0]), 'confirmed');
      if (!feed || !(services.oracleOwners ?? oracleOwners()).has(feed.owner.toBase58())) throw new PriceStale();
      const price = decodePullFeed(feed.data), maxAge = b.config.oracle_max_age; // 不编造默认值：上游对 SwitchboardPull 的 0 就是 0(只有旧的 SwitchboardV2/Pyth 才有默认)，0 会让价格永远算过期
      const now = BigInt(Math.floor((services.clock?.now() ?? Date.now()) / 1000));
      if (!price.sample_size || price.last_update_timestamp > now || (now - price.last_update_timestamp) * 2n > maxAge) throw new PriceStale();
    }
  }
  const ata = getAssociatedTokenAddressSync(new PublicKey(bank.mint), wallet);
  const instructions = [createAssociatedTokenAccountIdempotentInstruction(wallet, ata, wallet, new PublicKey(bank.mint)),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })];
  // #region ep8-first-deposit
  // 账户不是 PDA；唯一一次性 keypair 只签自己的创建，不为用户付费，也不落盘。
  const fresh = user ? null : Keypair.generate(), account = user ? new PublicKey(user.address) : fresh!.publicKey;
  if (fresh) instructions.push(await initInstruction(group, account, wallet));
  const amount = request.all ? 0n : BigInt(request.amount);
  instructions.push(await lendingInstruction(request.action, group, account, wallet, target, ata, amount, request.all === true, metas));
  const latest = await services.rpc.getLatestBlockhash('confirmed');
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: wallet, recentBlockhash: latest.blockhash, instructions }).compileToV0Message());
  if (fresh) tx.sign([fresh]);
  // #endregion
  if (tx.serialize().length > 1232) throw new ApiError(400, 'transaction exceeds 1232 bytes');
  // #region ep8-simulate
  const simulated = (await services.rpc.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' })).value;
  const simulation = { ok: simulated.err === null, error: simulated.err === null ? null : programError(simulated.err),
    logs: publicLogs(simulated.logs), units_consumed: simulated.unitsConsumed ?? null };
  // #endregion
  const verbs = { deposit: '存入', withdraw: '取出', borrow: '借出', repay: '偿还' };
  return { transaction: Buffer.from(tx.serialize()).toString('base64'), last_valid_block_height: latest.lastValidBlockHeight,
    creates_account: !!fresh, marginfi_account: account.toBase58(), simulation,
    summary: `${verbs[request.action]} ${request.all ? '全部' : formatAmount(amount, view.decimals)} ${view.label}` };
}
