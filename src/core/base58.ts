/**
 * INPUT: 原始字节或 base58 字符串。
 * OUTPUT: encodeBase58 / decodeBase58，无第三方依赖。
 * POSITION: RPC 指令与公钥的字节边界。
 * SYNC: 修改时同步本头部与 folder.md。
 */
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function encodeBase58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let encoded = '';
  while (value > 0n) {
    encoded = alphabet[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  // 前导零不在整数值中，必须独立保存，每个零字节对应一个 '1'。
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = '1' + encoded;
  }
  return encoded;
}

export function decodeBase58(encoded: string): Buffer {
  let value = 0n;
  for (const character of encoded) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error(`invalid base58 character: ${character}`);
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.push(Number(value & 255n));
    value >>= 8n;
  }
  let zeroes = 0;
  while (encoded[zeroes] === '1') zeroes++;
  return Buffer.from([...new Array<number>(zeroes).fill(0), ...bytes.reverse()]);
}
