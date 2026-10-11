/**
 * INPUT: IDL 类型、Reader 与类型定义。
 * OUTPUT: decodeType / decodeFields，整数为 bigint，f32/f64 为 number，定点数保持字节。
 * POSITION: 由 IDL 驱动的纯 Borsh 指令参数/事件解析。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import { Reader } from '../core/reader';
import type { Idl, IdlFields, IdlType } from './idl';

export function decodeFields(fields: IdlFields = [], reader: Reader, idl: Idl): Record<string, unknown> {
  // 元组没有字段名，沿用 Anchor 的 '0'、'1' 等键，方便交叉校验。
  return Object.fromEntries(fields.map((field, index) =>
    typeof field === 'object' && 'name' in field
      ? [field.name, decodeType(field.type, reader, idl)]
      : [String(index), decodeType(field as IdlType, reader, idl)]));
}

// #region ep4-decode-args
export function decodeType(type: IdlType, reader: Reader, idl: Idl): unknown {
  if (typeof type === 'string') {
    if (/^[ui](8|16|32|64|128)$/.test(type)) {
      return reader.integer(Number(type.slice(1)) / 8, type[0] === 'i');
    }
    switch (type) {
      case 'f32': return reader.bytes(4).readFloatLE();
      case 'f64': return reader.bytes(8).readDoubleLE();
      case 'bool': return reader.bool();
      case 'pubkey': return reader.pubkey();
      case 'string': return reader.string();
      case 'bytes': return [...reader.bytes(Number(reader.u32()))];
      default: throw new Error(`unsupported IDL type: ${type}`);
    }
  }
  if ('option' in type) {
    // option 的首字节为 0(None) 或 1(Some)，后者紧接内部类型。
    const tag = reader.u8();
    if (tag > 1n) throw new Error(`invalid option tag: ${tag}`);
    return tag === 0n ? null : decodeType(type.option, reader, idl);
  }
  if ('vec' in type || 'array' in type) {
    const [element, count] = 'vec' in type
      ? [type.vec, Number(reader.u32())] : type.array;
    const values: unknown[] = [];
    for (let i = 0; i < count; i++) values.push(decodeType(element, reader, idl));
    return values;
  }
  // #endregion
  const definition = idl.types?.find(entry => entry.name === type.defined.name);
  if (!definition) throw new Error(`undefined IDL type: ${type.defined.name}`);
  if (definition.type.kind === 'struct') {
    const result = decodeFields(definition.type.fields, reader, idl);
    // WrappedI80F48 的 value 是原始 u8[16]，EP4 不解释它的定点小数含义。
    if (definition.name === 'WrappedI80F48' && Array.isArray(result.value)) {
      result.value = result.value.map(byte => Number(byte));
    }
    return result;
  }
  const tag = Number(reader.u8());
  const variant = definition.type.variants[tag];
  if (!variant) throw new Error(`invalid enum tag ${tag}: ${definition.name}`);
  return { [variant.name]: decodeFields(variant.fields, reader, idl) };
}
