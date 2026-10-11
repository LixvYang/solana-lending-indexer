/**
 * INPUT: bigint 分数、日志中已是 f64 的数。
 * OUTPUT: 精确有理数算术、binary64 值/半 ULP 误差界、截断显示。
 * POSITION: EP5 对账计算，不用 Number 计算金额差值。
 * SYNC: 修改时同步本头部与 folder.md。
 */
export interface Rational { numerator: bigint; denominator: bigint }
export function rational(numerator: bigint, denominator = 1n): Rational {
  if (denominator <= 0n) throw new Error('denominator must be positive');
  let a = numerator < 0n ? -numerator : numerator, b = denominator;
  while (b) [a, b] = [b, a % b];
  return { numerator: numerator / a, denominator: denominator / a };
}
export const add = (a: Rational, b: Rational) => rational(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator);
export const subtract = (a: Rational, b: Rational) => add(a, { ...b, numerator: -b.numerator });
export const multiply = (a: Rational, b: Rational) => rational(a.numerator * b.numerator, a.denominator * b.denominator);
export function compare(a: Rational, b: Rational): number {
  const difference = a.numerator * b.denominator - b.numerator * a.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
const power = (n: bigint, exponent: number) => exponent < 0 ? rational(n, 1n << BigInt(-exponent)) : rational(n << BigInt(exponent));
function floatBits(value: number) {
  if (!Number.isFinite(value)) throw new Error('f64 must be finite');
  const bytes = Buffer.alloc(8); bytes.writeDoubleLE(value);
  const bits = bytes.readBigUInt64LE(), exponent = Number((bits >> 52n) & 2047n);
  const mantissa = (bits & ((1n << 52n) - 1n)) + (exponent ? 1n << 52n : 0n);
  return { mantissa: bits >> 63n ? -mantissa : mantissa, shift: (exponent || 1) - 1023 - 52 };
}
export function fromF64(value: number): Rational {
  const { mantissa, shift } = floatBits(value);
  return power(mantissa, shift);
}
// 上游 I80F48 -> f64 的舍入最多半个 ULP；非零定点数至少 2^-48，不会下溢为零。
export function f64Error(value: number): Rational { return value === 0 ? rational(0n) : power(1n, floatBits(value).shift - 1); }
export function decimal(value: Rational, digits = 48): string {
  const n = value.numerator < 0n ? -value.numerator : value.numerator;
  const tail = (n % value.denominator * 10n ** BigInt(digits) / value.denominator).toString().padStart(digits, '0').replace(/0+$/, '');
  return `${value.numerator < 0n ? '-' : ''}${n / value.denominator}${tail ? `.${tail}` : ''}`;
}
