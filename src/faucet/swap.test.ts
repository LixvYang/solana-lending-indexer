/** INPUT: 假 RPC、随机密钥。 OUTPUT: 兑换台的金额、交易结构、签名归属与转发守卫断言。 POSITION: 离线测试。 SYNC: folder.md。 */
import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { test } from 'node:test';
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createTransferInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { fakeClock, fakeRpc, tokenInfo } from '../api/wallet-test-utils';
import { createSwap, swapOut } from './swap';
import { faucetRoute } from './server';

const desk = Keypair.generate(), user = Keypair.generate();
const tSOL = Keypair.generate().publicKey, tUSDC = Keypair.generate().publicKey;
const config = { minLamports: 1_000_000n, maxLamports: 1_000_000_000n, tokens: [
  { label: 'tSOL' as const, mint: tSOL, decimals: 9, perSolNative: 1_000_000_000n },       // 1 SOL = 1 tSOL
  { label: 'tUSDC' as const, mint: tUSDC, decimals: 6, perSolNative: 50_000_000n }] };      // 1 SOL = 50 tUSDC
const stocked = (amount = 10n ** 15n) => fakeRpc({ getAccountInfo: (async (key: PublicKey) => {
  for (const mint of [tSOL, tUSDC]) if (key.equals(getAssociatedTokenAddressSync(mint, desk.publicKey))) return tokenInfo(mint, desk.publicKey, amount);
  return null; }) as never });
const swapWith = (rpc = stocked()) => createSwap(desk, rpc, config, fakeClock());
const signatureOk = (tx: VersionedTransaction, index: number) => verify(null, tx.message.serialize(),
  createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), tx.message.staticAccountKeys[index].toBuffer()]), format: 'der', type: 'spki' }), tx.signatures[index]);

test('换出数量:整数运算、向下取整,永远不会多给', () => {
  assert.equal(swapOut(100_000_000n, 50_000_000n), 5_000_000n);      // 0.1 SOL → 5 tUSDC
  assert.equal(swapOut(1_000_000_000n, 1_000_000_000n), 1_000_000_000n); // 1 SOL → 1 tSOL
  assert.equal(swapOut(1n, 50_000_000n), 0n);                          // 1 lamport 换不到 1 个最小单位:向下取整为 0,不会多给
  assert.equal(swapOut(19n, 50_000_000n), 0n);
  assert.equal(swapOut(20n, 50_000_000n), 1n);
});

test('报价:一笔交易里"用户转 SOL"与"兑换台转代币"，手续费由用户付，兑换台已签名、用户未签', async () => {
  const quote = await swapWith().quote({ wallet: user.publicKey.toBase58(), token: 'tUSDC', sol: '0.1' });
  assert.equal(quote.out_amount, '5000000'); assert.equal(quote.sol_lamports, '100000000');
  assert.equal(quote.summary, '用 0.1 SOL 兑换 5 tUSDC');
  const tx = VersionedTransaction.deserialize(Buffer.from(quote.transaction, 'base64'));
  const keys = tx.message.staticAccountKeys;
  assert.ok(keys[0].equals(user.publicKey), '手续费付款人是用户,兑换台不垫付 SOL');
  const deskIndex = keys.findIndex(k => k.equals(desk.publicKey));
  assert.ok(deskIndex > 0 && deskIndex < tx.message.header.numRequiredSignatures, '兑换台是签名者');
  assert.ok(signatureOk(tx, deskIndex), '兑换台的签名有效');
  assert.ok(tx.signatures[0].every(b => b === 0), '用户的签名还没有，等钱包签');
  // 指令结构:SOL 从用户转给兑换台;代币从兑换台的 ATA 转到用户的 ATA,数量一致
  const ixs = tx.message.compiledInstructions;
  const transfer = ixs.find(ix => keys[ix.programIdIndex].equals(SystemProgram.programId))!;
  assert.equal(Buffer.from(transfer.data).readBigUInt64LE(4), 100_000_000n);
  assert.ok(keys[transfer.accountKeyIndexes[0]].equals(user.publicKey) && keys[transfer.accountKeyIndexes[1]].equals(desk.publicKey));
  const token = ixs.find(ix => keys[ix.programIdIndex].equals(TOKEN_PROGRAM_ID))!;
  assert.equal(Buffer.from(token.data).readBigUInt64LE(1), 5_000_000n);
  assert.ok(keys[token.accountKeyIndexes[0]].equals(getAssociatedTokenAddressSync(tUSDC, desk.publicKey)));
  assert.ok(keys[token.accountKeyIndexes[1]].equals(getAssociatedTokenAddressSync(tUSDC, user.publicKey)));
});

test('报价的边界:太小、太大、未知代币、非法数量、兑换台余额不足', async () => {
  const swap = swapWith(), wallet = user.publicKey.toBase58();
  for (const [token, sol] of [['tUSDC', '0.0001'], ['tUSDC', '2'], ['tUSDC', '0'], ['tUSDC', 'abc'], ['tUSDC', '-1'], ['DOGE', '0.1']])
    await assert.rejects(swap.quote({ wallet, token, sol }), (e: { status?: number }) => e.status === 400, `${token} ${sol}`);
  await assert.rejects(swap.quote({ wallet: 'not-a-key', token: 'tSOL', sol: '0.1' }), (e: { status?: number }) => e.status === 400);
  await assert.rejects(swapWith(stocked(1n)).quote({ wallet, token: 'tUSDC', sol: '0.1' }), (e: { status?: number }) => e.status === 503);
  const rates = swap.rates();
  assert.deepEqual(rates, { rates: { tSOL: '1', tUSDC: '50' }, min_sol: '0.001', max_sol: '1' });
});

test('转发守卫:用户签完的兑换交易放行;不是兑换台签的、或含别的程序的拒绝', async () => {
  const swap = swapWith(), wallet = user.publicKey.toBase58();
  const quote = await swap.quote({ wallet, token: 'tSOL', sol: '0.01' });
  const signed = VersionedTransaction.deserialize(Buffer.from(quote.transaction, 'base64'));
  signed.sign([user]);
  const ok = await swap.submit({ transaction: Buffer.from(signed.serialize()).toString('base64') });
  assert.equal(ok.status, 'confirmed');
  // 用户没签 → 签名不全
  await assert.rejects(swap.submit({ transaction: quote.transaction }), (e: { status?: number }) => e.status === 400);
  // 别人自己造的交易(没有兑换台签名)
  const other = Keypair.generate();
  const forged = new VersionedTransaction(new TransactionMessage({ payerKey: other.publicKey, recentBlockhash: PublicKey.default.toBase58(),
    instructions: [SystemProgram.transfer({ fromPubkey: other.publicKey, toPubkey: other.publicKey, lamports: 1 })] }).compileToV0Message());
  forged.sign([other]);
  await assert.rejects(swap.submit({ transaction: Buffer.from(forged.serialize()).toString('base64') }), /not a swap transaction/);
  // 兑换台签了名,但混进了不在白名单里的程序(这里用 marginfi 地址冒充一个任意程序)
  const withOtherProgram = new VersionedTransaction(new TransactionMessage({ payerKey: user.publicKey, recentBlockhash: PublicKey.default.toBase58(),
    instructions: [createTransferInstruction(getAssociatedTokenAddressSync(tSOL, desk.publicKey), getAssociatedTokenAddressSync(tSOL, user.publicKey), desk.publicKey, 1n),
      { programId: Keypair.generate().publicKey, keys: [], data: Buffer.alloc(0) }] }).compileToV0Message());
  withOtherProgram.sign([user, desk]);
  await assert.rejects(swap.submit({ transaction: Buffer.from(withOtherProgram.serialize()).toString('base64') }), /not a swap transaction/);
});

test('HTTP 路由:只有配置了兑换台才有 /swap/*,否则 404', async () => {
  const noGrant = async () => { throw new Error('unused'); };
  assert.equal((await faucetRoute('GET', '/swap/rates', undefined, '1.1.1.1', noGrant as never)).status, 404);
  const route = await faucetRoute('GET', '/swap/rates', undefined, '1.1.1.1', noGrant as never, swapWith());
  assert.equal(route.status, 200); assert.equal(JSON.parse(route.body).rates.tUSDC, '50');
  assert.equal((await faucetRoute('POST', '/swap/quote', { wallet: user.publicKey.toBase58(), token: 'tSOL', sol: '5' }, '1.1.1.1', noGrant as never, swapWith())).status, 400);
});
