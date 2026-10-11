/**
 * INPUT: IEEE754 已知向量与 bigint 分数。
 * OUTPUT: 二进制浮点精确保留、算术和显示边界断言。
 * POSITION: 对账有理数测试。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rational, add, subtract, multiply, fromF64, decimal, compare, f64Error } from './rational';
test('f64 转有理数保留实际二进制值，含次正规数和负数', () => {
  assert.deepEqual(fromF64(0.1), { numerator: 3602879701896397n, denominator: 36028797018963968n });
  assert.deepEqual(fromF64(-1.25), { numerator: -5n, denominator: 4n });
  assert.deepEqual(fromF64(Number.MIN_VALUE), { numerator: 1n, denominator: 1n << 1074n });
  assert.equal(compare(subtract(fromF64(5000001696.077838), fromF64(4525001696.077837)),
    rational(475000000n * (1n << 20n) + 1n, 1n << 20n)), 0);
  assert.equal(compare(f64Error(5000001696.077838), rational(1n, 1n << 21n)), 0);
  assert.throws(() => fromF64(Infinity), /finite/);
});
test('有理数运算与显示没有 Number 舍入，显示末尾截断', () => {
  assert.deepEqual(add(rational(1n, 3n), rational(1n, 6n)), rational(1n, 2n));
  assert.deepEqual(multiply(rational(-5n, 3n), rational(3n, 10n)), rational(-1n, 2n));
  assert.equal(decimal(rational(-1n, 3n), 5), '-0.33333');
  assert.equal(decimal(rational(1n, 2n)), '0.5');
  assert.throws(() => rational(1n, 0n), /denominator/);
});
