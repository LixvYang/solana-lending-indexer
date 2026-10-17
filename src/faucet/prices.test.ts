/** INPUT: 真实 Pyth fixture、Switchboard 布局 fixture、假 RPC。 OUTPUT: 兑换台定价、过期/校验级别/未知布局的拒绝断言。 POSITION: 离线测试。 SYNC: folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Keypair, PublicKey } from '@solana/web3.js';
import { OFFSET } from '../decoder/switchboard';
import { resultRegion } from '../../scenario/lib/mock-feed';
import { MAX_PYTH_AGE_SECONDS, oraclePrices, usdMicroOf } from './prices';

const pyth = readFileSync('fixtures/pyth-price-update-sol-usd.bin'), published = 1792221354n;
const pull = (price: number | null) => {
  const bytes = readFileSync('fixtures/switchboard-pullfeed-uncranked.bin');
  if (price !== null) resultRegion(price, 1700000000, 1).copy(bytes, OFFSET.sampleSize);
  return bytes;
};
const status = (e: unknown) => (e as { status?: number }).status;

test('Pyth:价格 × 1e6 向下取整;超过最大年龄或不是 Full 就拒绝报价', () => {
  assert.deepEqual(usdMicroOf(pyth, 'rec5…', published + 10n), { usdMicro: 104_708_908n, source: 'pyth' }); // $104.70890852
  assert.deepEqual(usdMicroOf(pyth, 'rec5…', published + MAX_PYTH_AGE_SECONDS).usdMicro, 104_708_908n);
  assert.throws(() => usdMicroOf(pyth, 'rec5…', published + MAX_PYTH_AGE_SECONDS + 1n), (e: unknown) => status(e) === 503);
  const partial = Buffer.concat([pyth.subarray(0, 40), Buffer.from([0, 5]), pyth.subarray(41, 133)]);
  assert.throws(() => usdMicroOf(partial, 'rec5…', published), (e: unknown) => status(e) === 503);
});

test('Switchboard 布局:mock 与真 Switchboard 按 owner 区分;从未有价格的拒绝;mock 价格不看年龄', () => {
  assert.deepEqual(usdMicroOf(pull(50), 'mocks', 9_999_999_999n), { usdMicro: 50_000_000n, source: 'mock' });
  assert.equal(usdMicroOf(pull(1), 'Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2', 0n).source, 'switchboard');
  assert.throws(() => usdMicroOf(pull(null), 'mocks', 0n), (e: unknown) => status(e) === 503);
  assert.throws(() => usdMicroOf(Buffer.alloc(134), 'mocks', 0n), (e: unknown) => status(e) === 503);
});

test('oraclePrices:按资产找到价格账户读链上当前值;没配置或账户不存在时 503', async () => {
  const sol = Keypair.generate().publicKey, tUSDC = Keypair.generate().publicKey;
  const rpc = { getAccountInfo: async (key: PublicKey) => key.equals(sol) ? { data: pyth, owner: new PublicKey('rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ') }
    : key.equals(tUSDC) ? { data: pull(1), owner: Keypair.generate().publicKey } : null } as never;
  const read = oraclePrices(rpc, { SOL: sol, tUSDC, pSOL: Keypair.generate().publicKey }, () => Number(published) * 1000);
  assert.deepEqual(await read({ symbol: 'SOL', decimals: 9 }), { usdMicro: 104_708_908n, source: 'pyth' });
  assert.deepEqual(await read({ symbol: 'tUSDC', decimals: 6 }), { usdMicro: 1_000_000n, source: 'mock' });
  await assert.rejects(read({ symbol: 'pSOL', decimals: 9 }), (e: unknown) => status(e) === 503);  // 账户不存在
  await assert.rejects(read({ symbol: 'tSOL', decimals: 9 }), (e: unknown) => status(e) === 503);  // 没配置
});
