/** INPUT: 精确假 feed、假时钟与刷新错误。 OUTPUT: keeper 指令/恢复/五次退出。 POSITION: EP8 离线验证。 SYNC: folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { feedInfo, mockOwner } from '../api/wallet-test-utils';
import { priceInstruction, refreshPrices, type PriceRpc } from './price';
import { keeperLoop, intervalMs } from './loop';
import { OFFSET, decodePullFeed } from '../decoder/switchboard';
import { feedKeypair } from '../../scenario/lib/mock-feed';
const rpc: PriceRpc = { getAccountInfo: async () => feedInfo(1700000000, 50123456789012345678n), getSlot: async () => 333,
  getBlockTime: async () => 1700000060 };
test('keeper reads exact i128 price and rewrites timestamp/slot through shared resultRegion/writeIx', async () => {
  const value = await priceInstruction(rpc, mockOwner, 'tSOL'), ix = value.instruction;
  assert.ok(value.signer.publicKey.equals(feedKeypair('tSOL').publicKey)); assert.equal(ix.keys[0].isSigner, true);
  assert.equal(ix.data.readBigUInt64LE(8), BigInt(OFFSET.sampleSize)); assert.equal(ix.data.readUInt32LE(16), 177);
  const bytes = feedInfo().data; ix.data.subarray(20).copy(bytes, OFFSET.sampleSize);
  const decoded = decodePullFeed(bytes); assert.equal(decoded.price.numerator, 50123456789012345678n);
  assert.equal(decoded.last_update_timestamp, 1700000060n); assert.equal(decoded.slot, 333n);
  const changed = await priceInstruction(rpc, mockOwner, 'tUSDC', 1234567890123456789n);
  changed.instruction.data.subarray(20).copy(bytes, OFFSET.sampleSize); assert.equal(decodePullFeed(bytes).price.numerator, 1234567890123456789n);
  const seen: string[] = []; await refreshPrices(rpc, mockOwner, async v => { seen.push(v.signer.publicKey.toBase58()); });
  assert.deepEqual(seen, [feedKeypair('tUSDC').publicKey.toBase58(), feedKeypair('tSOL').publicKey.toBase58()]);
  await assert.rejects(priceInstruction({ ...rpc, getBlockTime: async () => null }, mockOwner, 'tSOL'), /time unavailable/);
  await assert.rejects(priceInstruction({ ...rpc, getAccountInfo: async () => null }, mockOwner, 'tSOL'), /owner/);
});
test('keeper survives transient RPC failure, resets consecutive counter, exits only after five; safe logs', async () => {
  let calls = 0, waits = 0; const logs: string[] = [];
  const recovered = await keeperLoop(async () => { calls++; await priceInstruction({ ...rpc, getAccountInfo: async () => {
    if (calls === 1) throw Error('RPC_URL api-key=secret private key'); return feedInfo();
  } }, mockOwner, 'tSOL'); }, async ms => { assert.equal(ms, 60000); waits++; }, 60000, () => calls >= 3, msg => logs.push(msg));
  assert.equal(recovered, 0); assert.equal(calls, 3); assert.equal(waits, 2);
  assert.ok(!/RPC_URL|api-key|secret|private/.test(logs.join()));
  calls = 0; waits = 0;
  const failed = await keeperLoop(async () => { calls++; if (calls !== 5) throw Error('failure'); }, async () => { waits++; }, 60000, () => false, msg => logs.push(msg));
  assert.equal(failed, 1); assert.equal(calls, 10); assert.equal(waits, 9); // 4失败、1成功、再5失败。
  assert.equal(intervalMs([]), 60000); assert.equal(intervalMs(['--interval', '5']), 5000);
  for (const args of [['--interval', '0'], ['--interval', '1.5'], ['--bad']]) assert.throws(() => intervalMs(args));
});
