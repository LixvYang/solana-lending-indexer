/**
 * INPUT: 手写 I80F48 位模式。
 * OUTPUT: 精确十进制、符号与有理数断言。
 * POSITION: EP5 定点数测试。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toDecimal, toRational } from './fixed';

function bytes(bits: bigint) {
  let value = BigInt.asUintN(128, bits);
  return Uint8Array.from({ length: 16 }, () => { const b = Number(value & 255n); value >>= 8n; return b; });
}
test('I80F48 不经 Number，精确保留符号、小数与 128 位边界', () => {
  const scale = 1n << 48n;
  for (const [bits, expected] of [
    [0n, '0'], [scale, '1'], [-scale * 3n / 2n, '-1.5'],
    [1n, '0.000000000000003552713678800500929355621337890625'],
    [-1n, '-0.000000000000003552713678800500929355621337890625'],
    [(1n << 100n) + 1n, '4503599627370496.000000000000003552713678800500929355621337890625'],
    [-(1n << 127n), '-604462909807314587353088'],
    [(1n << 127n) - 1n, '604462909807314587353087.999999999999996447286321199499070644378662109375'],
  ] as const) {
    assert.equal(toDecimal(bytes(bits)), expected);
    assert.deepEqual(toRational(bytes(bits)), { numerator: bits, denominator: scale });
  }
  assert.throws(() => toRational(Buffer.alloc(15)), /16/);
});
