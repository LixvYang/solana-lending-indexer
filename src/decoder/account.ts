/**
 * INPUT: 含 discriminator 的原始账户字节与固定 IDL。
 * OUTPUT: snake_case 账户字段、定点原始字节/decimal 或保留原文的错误。
 * POSITION: EP5 zero_copy 纯解码；调用者另行检查账户 owner。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import { Reader } from '../core/reader';
import { toDecimal } from '../core/fixed';
import { decodeType } from './borsh';
import { layout } from './layout';
import type { Idl, IdlType } from './idl';
export type DecodedAccount = { name: string; data: Record<string, unknown> }
  | { name: string; rawData: string; discriminator: string; decodeError?: string };
export interface Fixed { value: number[]; decimal: string }

function decodeAt(type: IdlType | string, bytes: Buffer, idl: Idl): unknown {
  if (typeof type === 'object') {
    if ('defined' in type) return decodeAt(type.defined.name, bytes, idl);
    if ('array' in type) {
      const [element, count] = type.array, stride = layout(element, idl).size;
      return Array.from({ length: count }, (_, i) => decodeAt(element, bytes.subarray(i * stride, (i + 1) * stride), idl));
    }
    throw new Error('not a fixed account field');
  }
  if (type === 'WrappedI80F48') return { value: [...bytes], decimal: toDecimal(bytes) };
  const definition = idl.types?.find(entry => entry.name === type);
  if (!definition) return decodeType(type as IdlType, new Reader(bytes), idl);
  if (definition.type.kind === 'enum') return decodeType({ defined: { name: type } }, new Reader(bytes), idl);
  return Object.fromEntries(layout(type, idl).fields!.map(field => [field.name,
    decodeAt(field.type, bytes.subarray(field.offset, field.offset + field.size), idl)]));
}

export function decodeAccount(data: Uint8Array, idl: Idl): DecodedAccount {
  const bytes = Buffer.from(data), rawData = bytes.toString('base64');
  const discriminator = bytes.subarray(0, 8).toString('hex');
  const supported = ['Bank', 'MarginfiGroup', 'MarginfiAccount', 'FeeState'];
  const entry = idl.accounts?.find(a => supported.includes(a.name) && Buffer.from(a.discriminator).equals(bytes.subarray(0, 8)));
  if (bytes.length < 8) return { name: 'unknown', rawData, discriminator, decodeError: 'need 8 discriminator bytes' };
  if (!entry) return { name: 'unknown', rawData, discriminator };
  try {
    const expected = 8 + layout(entry.name, idl).size;
    if (bytes.length !== expected) throw new Error(`account length must equal ${expected}, got ${bytes.length}`);
    return { name: entry.name, data: decodeAt(entry.name, bytes.subarray(8), idl) as Record<string, unknown> };
  } catch (error) {
    return { name: entry.name, rawData, discriminator, decodeError: error instanceof Error ? error.message : String(error) };
  }
}
