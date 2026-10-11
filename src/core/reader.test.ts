/**
 * INPUT: Reader 与手写小端字节。
 * OUTPUT: 整数、长度前缀和越界的离线断言。
 * POSITION: 字节读取器回归测试。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Reader } from './reader';

test('小端整数按位宽读取，符号使用二补码，全部返回 bigint', () => {
  const bytes = Buffer.from('ff341278563412ffffffffffffffff0000000000000080ffffffffffffffffffffffffffffffff00000000000000000000000000000080', 'hex');
  const r = new Reader(bytes);
  assert.equal(r.u8(), 255n); assert.equal(r.u16(), 0x1234n); assert.equal(r.u32(), 0x12345678n);
  assert.equal(r.u64(), (1n << 64n) - 1n); assert.equal(r.i64(), -(1n << 63n));
  assert.equal(r.u128(), (1n << 128n) - 1n); assert.equal(r.i128(), -(1n << 127n));
  assert.equal(r.remaining, 0); assert.throws(() => r.u8(), /offset|字节/);
});

test('bool、pubkey、字节与 UTF-8 长度前缀，拒绝非法标签和长度', () => {
  const r = new Reader(Buffer.concat([Buffer.from([0, 1]), Buffer.alloc(32), Buffer.from([3, 0, 0, 0]), Buffer.from('中')]));
  assert.equal(r.bool(), false); assert.equal(r.bool(), true);
  assert.equal(r.pubkey(), '11111111111111111111111111111111'); assert.equal(r.string(), '中');
  assert.deepEqual(new Reader(Buffer.from([1, 2])).bytes(2), Buffer.from([1, 2]));
  assert.throws(() => new Reader(Buffer.from([2])).bool(), /bool/);
  assert.throws(() => new Reader(Buffer.from([255, 255, 255, 255])).string(), /offset|字节/);
  assert.throws(() => new Reader(Buffer.alloc(1)).bytes(-1), /length|长度/);
});
