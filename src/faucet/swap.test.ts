/** INPUT: 假 RPC、随机密钥。 OUTPUT: 兑换台的金额、六个方向的交易结构、签名归属与转发守卫断言。 POSITION: 离线测试。 SYNC: folder.md。 */
import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { test } from 'node:test';
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createTransferInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { fakeClock, fakeRpc, tokenInfo } from '../api/wallet-test-utils';
import { createSwap, notionalMicro, swapOut, type SwapAssetConfig, type SwapConfig } from './swap';
import { faucetRoute } from './server';
import type { SwapAsset } from '../api/types';

const desk = Keypair.generate(), user = Keypair.generate();
const mint = { tSOL: Keypair.generate().publicKey, tUSDC: Keypair.generate().publicKey };
const SOL: SwapAssetConfig = { symbol: 'SOL', decimals: 9, usdMicro: 50_000_000n };       // $50
const tSOL: SwapAssetConfig = { symbol: 'tSOL', decimals: 9, mint: mint.tSOL, usdMicro: 50_000_000n };   // $50
const tUSDC: SwapAssetConfig = { symbol: 'tUSDC', decimals: 6, mint: mint.tUSDC, usdMicro: 1_000_000n }; // $1
const by = { SOL, tSOL, tUSDC } as const;
const config: SwapConfig = { assets: [SOL, tSOL, tUSDC], minUsdMicro: 50_000n, maxUsdMicro: 100_000_000n }; // $0.05 ~ $100
const stocked = (tokenAmount = 10n ** 15n, lamports = 5_000_000_000) => fakeRpc({
  getBalance: (async () => lamports) as never,
  getAccountInfo: (async (key: PublicKey) => {
    for (const m of [mint.tSOL, mint.tUSDC]) if (key.equals(getAssociatedTokenAddressSync(m, desk.publicKey))) return tokenInfo(m, desk.publicKey, tokenAmount);
    return null; }) as never });
const swapWith = (rpc = stocked()) => createSwap(desk, rpc, config, fakeClock());
const sigOk = (tx: VersionedTransaction, index: number) => verify(null, tx.message.serialize(),
  createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), tx.message.staticAccountKeys[index].toBuffer()]), format: 'der', type: 'spki' }), tx.signatures[index]);
const status = (e: unknown) => (e as { status?: number }).status;

test('换出数量:统一的 USD 单价、整数运算、向下取整,不会多给,绕一圈不会变多(没有套利环)', () => {
  assert.equal(swapOut(1_000_000_000n, SOL, tUSDC), 50_000_000n);     // 1 SOL → 50 tUSDC
  assert.equal(swapOut(50_000_000n, tUSDC, SOL), 1_000_000_000n);     // 50 tUSDC → 1 SOL
  assert.equal(swapOut(1_000_000_000n, SOL, tSOL), 1_000_000_000n);   // SOL ↔ tSOL 1:1
  assert.equal(swapOut(2_000_000_000n, tSOL, tUSDC), 100_000_000n);   // 2 tSOL → 100 tUSDC
  assert.equal(swapOut(1n, tUSDC, SOL), 20n);                         // 0.000001 tUSDC = $0.000001 → 0.00000002 SOL = 20 lamports
  assert.equal(swapOut(19n, SOL, tUSDC), 0n);                         // 太小:向下取整为 0
  // 绕一圈:SOL → tUSDC → tSOL → SOL,任何起点数量都不会拿回更多
  for (const start of [1_000_000_000n, 123_456_789n, 7n, 999_999_999_999n]) {
    const back = swapOut(swapOut(swapOut(start, SOL, tUSDC), tUSDC, tSOL), tSOL, SOL);
    assert.ok(back <= start, `${start} → ${back}`);
  }
  assert.equal(notionalMicro(1_000_000_000n, SOL), 50_000_000n);      // 1 SOL = $50
  assert.equal(notionalMicro(100_000_000n, tUSDC), 100_000_000n);     // 100 tUSDC = $100
});

// 六个方向:每个方向交易里都是"用户给出 from + 兑换台给出 to",手续费由用户付,兑换台已签、用户未签
const PAIRS: [SwapAsset, SwapAsset, string][] = [['SOL', 'tSOL', '0.5'], ['SOL', 'tUSDC', '0.5'], ['tSOL', 'SOL', '0.5'], ['tSOL', 'tUSDC', '0.5'], ['tUSDC', 'SOL', '25'], ['tUSDC', 'tSOL', '25']];
for (const [from, to, amount] of PAIRS) {
  test(`报价 ${from} → ${to}:两条腿的方向、数量、付款人、签名归属`, async () => {
    const quote = await swapWith().quote({ wallet: user.publicKey.toBase58(), from, to, amount });
    const a = by[from], b = by[to];
    const amountIn = BigInt(quote.in_amount), out = BigInt(quote.out_amount);
    assert.equal(out, swapOut(amountIn, a, b)); assert.equal(quote.in_decimals, a.decimals); assert.equal(quote.out_decimals, b.decimals);
    const tx = VersionedTransaction.deserialize(Buffer.from(quote.transaction, 'base64')), keys = tx.message.staticAccountKeys;
    assert.ok(keys[0].equals(user.publicKey), '手续费付款人是用户');
    const deskIndex = keys.findIndex(k => k.equals(desk.publicKey));
    assert.ok(deskIndex > 0 && deskIndex < tx.message.header.numRequiredSignatures && sigOk(tx, deskIndex), '兑换台是签名者且签名有效');
    assert.ok(tx.signatures[0].every(x => x === 0), '用户的签名还没有');
    const ixs = tx.message.compiledInstructions;
    const sol = ixs.filter(ix => keys[ix.programIdIndex].equals(SystemProgram.programId));
    const spl = ixs.filter(ix => keys[ix.programIdIndex].equals(TOKEN_PROGRAM_ID));
    // 用户给出 from
    if (a.mint) {
      const leg = spl[0]; assert.equal(Buffer.from(leg.data).readBigUInt64LE(1), amountIn);
      assert.ok(keys[leg.accountKeyIndexes[0]].equals(getAssociatedTokenAddressSync(a.mint, user.publicKey)));
      assert.ok(keys[leg.accountKeyIndexes[1]].equals(getAssociatedTokenAddressSync(a.mint, desk.publicKey)));
      assert.ok(keys[leg.accountKeyIndexes[2]].equals(user.publicKey), '授权人是用户');
    } else {
      const leg = sol[0]; assert.equal(Buffer.from(leg.data).readBigUInt64LE(4), amountIn);
      assert.ok(keys[leg.accountKeyIndexes[0]].equals(user.publicKey) && keys[leg.accountKeyIndexes[1]].equals(desk.publicKey));
    }
    // 兑换台给出 to
    if (b.mint) {
      const leg = spl[spl.length - 1]; assert.equal(Buffer.from(leg.data).readBigUInt64LE(1), out);
      assert.ok(keys[leg.accountKeyIndexes[0]].equals(getAssociatedTokenAddressSync(b.mint, desk.publicKey)));
      assert.ok(keys[leg.accountKeyIndexes[1]].equals(getAssociatedTokenAddressSync(b.mint, user.publicKey)));
      assert.ok(keys[leg.accountKeyIndexes[2]].equals(desk.publicKey), '授权人是兑换台');
    } else {
      const leg = sol[sol.length - 1]; assert.equal(Buffer.from(leg.data).readBigUInt64LE(4), out);
      assert.ok(keys[leg.accountKeyIndexes[0]].equals(desk.publicKey) && keys[leg.accountKeyIndexes[1]].equals(user.publicKey));
    }
  });
}

test('报价的边界:同一资产、未知资产、太小、太大、非法数量、兑换台余额不足(代币与 SOL)', async () => {
  const swap = swapWith(), wallet = user.publicKey.toBase58();
  for (const [from, to, amount] of [['SOL', 'SOL', '0.1'], ['SOL', 'DOGE', '0.1'], ['DOGE', 'SOL', '0.1'], ['SOL', 'tUSDC', '0.0001'], ['SOL', 'tUSDC', '3'],
    ['tUSDC', 'SOL', '0.01'], ['tUSDC', 'SOL', '101'], ['SOL', 'tUSDC', '0'], ['SOL', 'tUSDC', 'abc'], ['SOL', 'tUSDC', '-1']])
    await assert.rejects(swap.quote({ wallet, from, to, amount }), (e: unknown) => status(e) === 400, `${from}→${to} ${amount}`);
  await assert.rejects(swap.quote({ wallet: 'not-a-key', from: 'SOL', to: 'tSOL', amount: '0.1' }), (e: unknown) => status(e) === 400);
  await assert.rejects(swapWith(stocked(1n)).quote({ wallet, from: 'SOL', to: 'tUSDC', amount: '0.5' }), (e: unknown) => status(e) === 503);    // 代币不足
  // SOL 不足:要付出 0.5 SOL,兑换台有 0.52 SOL,但必须保留 0.05(付 ATA 租金等),可用只有 0.47 → 拒绝;
  // 有 0.56 SOL 时可用 0.51 → 放行。正好卡在"保留金额"这条规则上,去掉保留就会放行前一种。
  await assert.rejects(swapWith(stocked(10n ** 15n, 520_000_000)).quote({ wallet, from: 'tUSDC', to: 'SOL', amount: '25' }), (e: unknown) => status(e) === 503);
  assert.equal((await swapWith(stocked(10n ** 15n, 560_000_000)).quote({ wallet, from: 'tUSDC', to: 'SOL', amount: '25' })).out_amount, '500000000');
  assert.deepEqual(swap.rates(), { assets: [{ symbol: 'SOL', decimals: 9, usd: '50' }, { symbol: 'tSOL', decimals: 9, usd: '50' }, { symbol: 'tUSDC', decimals: 6, usd: '1' }], min_usd: '0.05', max_usd: '100' });
});

test('转发守卫:用户签完的兑换交易(含 SOL 收款方向)放行;不是兑换台签的、或含别的程序的拒绝', async () => {
  const swap = swapWith(), wallet = user.publicKey.toBase58();
  for (const [from, to, amount] of [['SOL', 'tSOL', '0.1'], ['tUSDC', 'SOL', '10']] as const) {
    const quote = await swap.quote({ wallet, from, to, amount });
    const signed = VersionedTransaction.deserialize(Buffer.from(quote.transaction, 'base64')); signed.sign([user]);
    assert.equal((await swap.submit({ transaction: Buffer.from(signed.serialize()).toString('base64') })).status, 'confirmed');
    await assert.rejects(swap.submit({ transaction: quote.transaction }), (e: unknown) => status(e) === 400); // 用户没签
  }
  const other = Keypair.generate();
  const forged = new VersionedTransaction(new TransactionMessage({ payerKey: other.publicKey, recentBlockhash: PublicKey.default.toBase58(),
    instructions: [SystemProgram.transfer({ fromPubkey: other.publicKey, toPubkey: other.publicKey, lamports: 1 })] }).compileToV0Message());
  forged.sign([other]);
  await assert.rejects(swap.submit({ transaction: Buffer.from(forged.serialize()).toString('base64') }), /not a swap transaction/);
  const withOtherProgram = new VersionedTransaction(new TransactionMessage({ payerKey: user.publicKey, recentBlockhash: PublicKey.default.toBase58(),
    instructions: [createTransferInstruction(getAssociatedTokenAddressSync(mint.tSOL, desk.publicKey), getAssociatedTokenAddressSync(mint.tSOL, user.publicKey), desk.publicKey, 1n),
      { programId: Keypair.generate().publicKey, keys: [], data: Buffer.alloc(0) }] }).compileToV0Message());
  withOtherProgram.sign([user, desk]);
  await assert.rejects(swap.submit({ transaction: Buffer.from(withOtherProgram.serialize()).toString('base64') }), /not a swap transaction/);
});

test('HTTP 路由:只有配置了兑换台才有 /swap/*,否则 404', async () => {
  const noGrant = async () => { throw new Error('unused'); };
  assert.equal((await faucetRoute('GET', '/swap/rates', undefined, '1.1.1.1', noGrant as never)).status, 404);
  const route = await faucetRoute('GET', '/swap/rates', undefined, '1.1.1.1', noGrant as never, swapWith());
  assert.equal(route.status, 200); assert.equal(JSON.parse(route.body).assets.length, 3);
  assert.equal((await faucetRoute('POST', '/swap/quote', { wallet: user.publicKey.toBase58(), from: 'SOL', to: 'tSOL', amount: '5' }, '1.1.1.1', noGrant as never, swapWith())).status, 400);
});
