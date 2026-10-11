/**
 * INPUT: WrappedI80F48 的 16 字节小端二补码。
 * OUTPUT: 精确十进制字符串与 bigint 有理数。
 * POSITION: EP5 金额边界，禁止经过 Number。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import { Reader } from './reader';

// #region ep5-fixed
export function toRational(bytes: Uint8Array) {
  if (bytes.length !== 16) throw new Error(`I80F48 needs 16 bytes, got ${bytes.length}`);
  return { numerator: new Reader(bytes).i128(), denominator: 2n ** 48n };
}
export function toDecimal(bytes: Uint8Array): string {
  const { numerator, denominator } = toRational(bytes);
  const absolute = numerator < 0n ? -numerator : numerator;
  // 1 / 2^48 = 5^48 / 10^48，小数最多 48 位，整个过程没有浮点舍入。
  const fraction = ((absolute % denominator) * 5n ** 48n).toString().padStart(48, '0').replace(/0+$/, '');
  return `${numerator < 0n ? '-' : ''}${absolute / denominator}${fraction ? `.${fraction}` : ''}`;
}
// #endregion
