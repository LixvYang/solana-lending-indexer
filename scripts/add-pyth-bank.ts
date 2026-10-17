/**
 * INPUT: ANCHOR_WALLET(group admin、测试币 mint authority)、RPC_URL、可选 FAUCET_KEYPAIR、--run-id。
 * OUTPUT: pSOL 测试币、挂在剧本 group 上的 pSOL 银行(价格走 Pyth devnet SOL/USD)、给水龙头/兑换台的 pSOL、链下标签。
 * POSITION: 管理员 CLI,幂等:已存在的步骤会核对后跳过。SYNC: folder.md。
 *
 *   pnpm exec tsx scripts/add-pyth-bank.ts            # 线上池子(剧本第一次运行建的 group)
 *   pnpm exec tsx scripts/add-pyth-bank.ts --run-id r4
 */
import 'dotenv/config';
import { MINT_SIZE, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createInitializeMint2Instruction,
  createMintToInstruction, getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';
import { PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram } from '@solana/web3.js';
import { deriveKeypair } from '../scenario/lib/actors';
import { bankConfig } from '../scenario/lib/bank-config';
import { pda } from '../scenario/lib/marginfi';
import { send } from '../scenario/lib/rpc';
import { createContext } from '../scenario/lib/runtime';
import { fetchAccount } from '../scenario/lib/state';
import { FEED_IDS, feedIdAsKey, pythPushAccount } from '../src/oracle/pyth';
import { readKeypair } from './admin-runtime';
import { pgDb } from '../src/store/db';
import { loadLabels } from '../src/store/labels';

/** Pyth 在 devnet 的赞助更新约 1–2 分钟一次(D-018 实测),所以最大价格年龄要比 mock 的 240 秒更宽。 */
export const PYTH_MAX_AGE = 300;
const DECIMALS = 9;

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--help') { console.log('用法: add-pyth-bank [--run-id X]  (需要 ANCHOR_WALLET,仅 devnet)'); return; }
  const runId = args[0] === '--run-id' ? args[1] ?? '' : '';
  const ctx = await createContext(runId), connection = ctx.provider.connection;
  const mint = deriveKeypair('mint/pSOL'), bank = deriveKeypair(runId ? `bank/pSOL/${runId}` : 'bank/pSOL');
  const group = ctx.actors.group.publicKey, feed = pythPushAccount(FEED_IDS['SOL/USD']);
  console.log(`group ${group.toBase58()}\nmint  ${mint.publicKey.toBase58()}\nbank  ${bank.publicKey.toBase58()}\nfeed  ${feed.toBase58()} (Pyth SOL/USD, shard 0)`);
  if (!await connection.getAccountInfo(group)) throw new Error('group 不存在:先跑剧本');

  // 1. 测试币。与 tSOL 一样 9 位小数,mint authority 是管理员。
  if (!await connection.getAccountInfo(mint.publicKey)) {
    const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    await send(ctx, 'create mint pSOL', [SystemProgram.createAccount({ fromPubkey: ctx.admin.publicKey, newAccountPubkey: mint.publicKey,
      lamports: rent, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }), createInitializeMint2Instruction(mint.publicKey, DECIMALS, ctx.admin.publicKey, null)], [mint]);
  } else {
    const existing = await getMint(connection, mint.publicKey);
    if (existing.decimals !== DECIMALS || !existing.mintAuthority?.equals(ctx.admin.publicKey)) throw new Error('pSOL mint 已存在但精度或 authority 不对');
  }

  // 2. 银行。风险参数照搬 tSOL,只把最大价格年龄放宽到 Pyth 的更新节奏。
  if (!await connection.getAccountInfo(bank.publicKey)) {
    const fee = await fetchAccount(ctx, 'feeState', ctx.feeState);
    const b = bank.publicKey;
    await send(ctx, 'add bank pSOL', [await ctx.program.methods.lendingPoolAddBank({ ...bankConfig('tSOL'), oracleMaxAge: PYTH_MAX_AGE }).accountsStrict({
      marginfiGroup: group, admin: ctx.admin.publicKey, feePayer: ctx.admin.publicKey, feeState: ctx.feeState, globalFeeWallet: fee.globalFeeWallet,
      bankMint: mint.publicKey, bank: b, liquidityVaultAuthority: pda(ctx, 'liquidity_vault_auth', b), liquidityVault: pda(ctx, 'liquidity_vault', b),
      insuranceVaultAuthority: pda(ctx, 'insurance_vault_auth', b), insuranceVault: pda(ctx, 'insurance_vault', b),
      feeVaultAuthority: pda(ctx, 'fee_vault_auth', b), feeVault: pda(ctx, 'fee_vault', b),
      rent: SYSVAR_RENT_PUBKEY, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).instruction()], [bank]);
  }

  // #region ep8-pyth-configure
  // 3. 绑定 Pyth:setup = 3(PythPushOracle),"oracle" 参数传的是 feed id(32 字节当 Pubkey),
  //    remaining account 传真正的价格账户,程序用它核对 feed id 是否一致(price.rs check_ai_and_feed_id)。
  const current = await fetchAccount(ctx, 'bank', bank.publicKey);
  if (!(current.config.oracleKeys[0] as PublicKey).equals(feedIdAsKey(FEED_IDS['SOL/USD']))) {
    await send(ctx, 'configure oracle pSOL (Pyth)', [await ctx.program.methods.lendingPoolConfigureBankOracle(3, feedIdAsKey(FEED_IDS['SOL/USD']))
      .accountsStrict({ group, admin: ctx.admin.publicKey, bank: bank.publicKey })
      .remainingAccounts([{ pubkey: feed, isSigner: false, isWritable: false }]).instruction()]);
  }
  // #endregion

  // 4. 给水龙头/兑换台的专用钱包铸一些 pSOL(它只能转、不能铸)。
  if (process.env.FAUCET_KEYPAIR) {
    const desk = readKeypair(process.env.FAUCET_KEYPAIR).publicKey, ata = getAssociatedTokenAddressSync(mint.publicKey, desk);
    const amount = BigInt(process.env.FAUCET_SETUP_PSOL ?? '20000') * 10n ** BigInt(DECIMALS);
    const held = await connection.getTokenAccountBalance(ata).then(r => BigInt(r.value.amount)).catch(() => 0n);
    if (held < amount / 2n) await send(ctx, 'mint pSOL to faucet', [createAssociatedTokenAccountIdempotentInstruction(ctx.admin.publicKey, ata, desk, mint.publicKey),
      createMintToInstruction(mint.publicKey, ata, ctx.admin.publicKey, amount - held)]);
  }
  // 5. 链下标签:API、水龙头、兑换台按代币符号找银行。数据库连不上只提示,不影响链上结果。
  const db = pgDb();
  try { await loadLabels(db, { mints: { pSOL: mint.publicKey.toBase58() }, banks: { pSOL: bank.publicKey.toBase58() }, marginfiAccounts: {}, actors: {} }); }
  catch { console.error('标签未写入(数据库不可用),之后可重跑本脚本'); } finally { await db.close(); }
  console.log('完成。下一步: scripts/verify-pyth-bank.ts 在 devnet 上验证借款,然后 ingest 入库。');
}
void main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
