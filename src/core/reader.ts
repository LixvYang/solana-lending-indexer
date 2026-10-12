/**
 * INPUT: Uint8Array、小端 Borsh 字节。
 * OUTPUT: Reader，整数为 bigint，pubkey 为 base58。
 * POSITION: 解码器共用的顺序字节读取器。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import { encodeBase58 } from './base58';

// #region ep4-reader
export class Reader {
  private offset = 0;
  private readonly data: Buffer;
  constructor(data: Uint8Array) { this.data = Buffer.from(data); }
  get remaining(): number { return this.data.length - this.offset; }

  bytes(length: number): Buffer {
    if (!Number.isSafeInteger(length) || length < 0) throw new Error(`invalid byte length: ${length}`);
    if (length > this.remaining) {
      throw new Error(`offset ${this.offset}: need ${length} bytes, only ${this.remaining} remain`);
    }
    const value = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  integer(width: number, signed = false): bigint {
    const bytes = this.bytes(width);
    let value = 0n;
    // Borsh 整数低位在前；有符号整数最高位为 1 时减去 2^位宽。
    for (let i = bytes.length - 1; i >= 0; i--) value = (value << 8n) | BigInt(bytes[i]);
    const bits = BigInt(width * 8);
    return signed && (value & (1n << (bits - 1n))) !== 0n ? value - (1n << bits) : value;
  }
  u8(): bigint { return this.integer(1); }
  u16(): bigint { return this.integer(2); }
  u32(): bigint { return this.integer(4); }
  u64(): bigint { return this.integer(8); }
  i64(): bigint { return this.integer(8, true); }
  u128(): bigint { return this.integer(16); }
  i128(): bigint { return this.integer(16, true); }
  bool(): boolean {
    const tag = this.u8();
    if (tag > 1n) throw new Error(`invalid bool tag: ${tag}`);
    return tag === 1n;
  }
  pubkey(): string { return encodeBase58(this.bytes(32)); }
  string(): string { return this.bytes(Number(this.u32())).toString('utf8'); }
}
// #endregion
