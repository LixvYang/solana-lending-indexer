/**
 * INPUT: Pyth Solana Receiver 的 PriceUpdateV2 账户字节(134 字节，含 discriminator)。
 * OUTPUT: decodePriceUpdate:feed id、精确价格/置信区间、发布时间、校验级别。
 * POSITION: EP7 预言机纯解码(与 switchboard.ts 并列)。SYNC: 同步 folder.md。
 */
import { createHash } from 'node:crypto';
import { encodeBase58 } from '../core/base58';
import { decimal } from '../core/rational';

export const DISCRIMINATOR = createHash('sha256').update('account:PriceUpdateV2').digest().subarray(0, 8);
/** 账户按 Partial(2 字节)预留空间,Full 只占 1 字节,所以尾部可能多出 1 字节。 */
export const ACCOUNT_SIZE = 134;

// #region ep7-pyth-layout
/**
 * Borsh 顺序(pyth_solana_receiver_sdk::price_update::PriceUpdateV2):
 *   discriminator 8 | write_authority 32 | verification_level 1 或 2 | price_message | posted_slot u64
 *   price_message = feed_id 32 | price i64 | conf u64 | exponent i32 | publish_time i64 | prev_publish_time i64 | ema_price i64 | ema_conf u64
 * verification_level 是枚举:0 = Partial { num_signatures: u8 }(2 字节),1 = Full(1 字节)。
 * 因为它变长,后面所有字段的偏移都取决于这一个字节——不能写死偏移表。
 * marginfi 只接受 Full(constants.rs MIN_PYTH_PUSH_VERIFICATION_LEVEL)。
 */
export function decodePriceUpdate(data: Uint8Array) {
  const bytes = Buffer.from(data);
  if (bytes.length !== ACCOUNT_SIZE) throw new Error(`PriceUpdateV2 length must equal ${ACCOUNT_SIZE}`);
  if (!bytes.subarray(0, 8).equals(DISCRIMINATOR)) throw new Error('invalid PriceUpdateV2 discriminator');
  const tag = bytes[40];
  if (tag > 1) throw new Error('invalid verification level');
  let o = tag === 0 ? 42 : 41;
  const feed_id = bytes.subarray(o, o + 32).toString('hex'); o += 32;
  const price = bytes.readBigInt64LE(o), conf = bytes.readBigUInt64LE(o + 8), exponent = bytes.readInt32LE(o + 16);
  const publish_time = bytes.readBigInt64LE(o + 20), ema_price = bytes.readBigInt64LE(o + 36), ema_conf = bytes.readBigUInt64LE(o + 44);
  const posted_slot = bytes.readBigUInt64LE(o + 52);
  // 价格 = price × 10^exponent。exponent 为负(SOL/USD 是 -8),用分母表示,不经过浮点。
  const scaled = (n: bigint) => {
    const numerator = exponent < 0 ? n : n * 10n ** BigInt(exponent), denominator = exponent < 0 ? 10n ** BigInt(-exponent) : 1n;
    return { numerator, denominator, decimal: decimal({ numerator, denominator }, Math.max(0, -exponent)), number: Number(numerator) / Number(denominator) };
  };
  return { write_authority: encodeBase58(bytes.subarray(8, 40)), verification: tag === 1 ? 'Full' as const : 'Partial' as const,
    num_signatures: tag === 0 ? bytes[41] : null, feed_id, price: scaled(price), conf: scaled(conf), ema_price: scaled(ema_price), ema_conf: scaled(ema_conf),
    exponent, publish_time, posted_slot };
}
// #endregion
export type PriceUpdate = ReturnType<typeof decodePriceUpdate>;
