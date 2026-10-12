/**
 * INPUT: Switchboard PullFeedAccountData 3208 字节（含 discriminator）。
 * OUTPUT: decodePullFeed、与 scenario 共用的唯一偏移表；18 位精确价格与显示 number。
 * POSITION: EP7 预言机纯解码。SYNC: 同步 folder.md。
 */
import { Reader } from '../core/reader';
import { encodeBase58 } from '../core/base58';
import { decimal } from '../core/rational';
export const FEED_SIZE = 3208;
// switchboard-on-demand 0.1.14 repr(C)，真实未 crank fixture 校验；所有偏移含 8 字节 discriminator。
export const OFFSET = { authority: 2056, queue: 2088, feedHash: 2120, minResponses: 2176, name: 2180,
  sampleSize: 2215, result: 2264, maxStaleness: 2392 } as const;
export const DISCRIMINATOR = Buffer.from([196, 27, 108, 196, 10, 215, 219, 40]);
export function decodePullFeed(data: Uint8Array) {
  const bytes = Buffer.from(data);
  if (bytes.length !== FEED_SIZE)
    throw new Error(`PullFeed length must equal ${FEED_SIZE}`);
  if (!bytes.subarray(0, 8).equals(DISCRIMINATOR))
    throw new Error('invalid PullFeed discriminator');
  const fixed = (offset: number) => {
    const numerator = new Reader(bytes.subarray(offset, offset + 16)).i128(), denominator = 10n ** 18n;
    return { numerator, denominator, decimal: decimal({ numerator, denominator }, 18), number: Number(numerator) / Number(denominator) };
  };
  const key = (offset: number) => encodeBase58(bytes.subarray(offset, offset + 32));
  return { price: fixed(OFFSET.result), std_dev: fixed(OFFSET.result + 16),
    last_update_timestamp: bytes.readBigInt64LE(OFFSET.sampleSize + 1),
    slot: bytes.readBigUInt64LE(OFFSET.result + 6 * 16 + 8), sample_size: bytes[OFFSET.sampleSize],
    queue: key(OFFSET.queue), authority: key(OFFSET.authority),
    feed_hash: bytes.subarray(OFFSET.feedHash, OFFSET.feedHash + 32).toString('hex') };
}
