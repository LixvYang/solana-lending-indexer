/** INPUT: 指令原始字节与固定 IDL。 OUTPUT: ByteSpan[]，顶层参数逐字段范围。 POSITION: EP7 X 光字节分段。 SYNC: 同步 folder.md。 */
import { Reader } from '../core/reader';
import { decodeType } from '../decoder/borsh';
import { marginfiIdl, type Idl } from '../decoder/idl';
import { toJson } from '../store/json';
import type { ByteSpan } from './types';
export function rawSpans(bytes: Buffer): ByteSpan[] {
  const length = Math.min(8, bytes.length);
  return [{ offset: 0, length, label: 'discriminator', hex: bytes.subarray(0, length).toString('hex'), value: null },
    ...(bytes.length > length ? [{ offset: length, length: bytes.length - length, label: 'raw payload', hex: bytes.subarray(length).toString('hex'), value: null }] : [])];
}
// #region ep7-spans
export function byteSpans(data: Uint8Array, idl: Idl = marginfiIdl): ByteSpan[] {
  const bytes = Buffer.from(data);
  if (bytes.length < 8)
    throw new Error('need 8 discriminator bytes');
  const entry = idl.instructions.find(i => Buffer.from(i.discriminator).equals(bytes.subarray(0, 8)));
  if (!entry)
    return rawSpans(bytes);
  const spans: ByteSpan[] = [{ offset: 0, length: 8, label: 'discriminator', hex: bytes.subarray(0, 8).toString('hex'), value: entry.name }];
  const reader = new Reader(bytes.subarray(8));
  for (const field of entry.args) {
    const offset = bytes.length - reader.remaining;
    const value = JSON.parse(toJson(decodeType(field.type, reader, idl)));
    const length = bytes.length - reader.remaining - offset;
    spans.push({ offset, length, label: field.name, hex: bytes.subarray(offset, offset + length).toString('hex'), value });
  }
  if (reader.remaining)
    throw new Error(`trailing instruction bytes: ${reader.remaining}`);
  let end = 0;
  for (const span of spans) {
    if (span.offset !== end)
      throw new Error('non-contiguous spans');
    end += span.length;
  }
  if (end !== bytes.length)
    throw new Error('incomplete spans');
  return spans;
}
// #endregion
