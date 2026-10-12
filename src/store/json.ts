/**
 * INPUT: 解码结果，包含 bigint。
 * OUTPUT: toJson / fromJson，按 IDL 往返整数，JSONB 保持可查询的字段形状。
 * POSITION: EP6 JSON 金额边界，不自动把普通字符串当作 bigint。SYNC: 同步 folder.md。
 */
import type { Idl, IdlFields, IdlType } from '../decoder/idl';
export function toJson(value: unknown): string {
  return JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item);
}
function fields(value: Record<string, unknown>, definitions: IdlFields = [], idl: Idl): Record<string, unknown> {
  const restored = { ...value };
  definitions.forEach((field, index) => {
    const named = typeof field === 'object' && 'name' in field;
    const key = named ? field.name : String(index);
    if (key in value) restored[key] = fromJson(value[key], named ? field.type : field as IdlType, idl);
  });
  return restored;
}
export function fromJson(value: unknown, type: IdlType | string, idl: Idl): unknown {
  if (typeof type === 'object') {
    if ('defined' in type) return fromJson(value, type.defined.name, idl);
    if ('option' in type) return value === null ? null : fromJson(value, type.option, idl);
    const element = 'vec' in type ? type.vec : type.array[0];
    return (value as unknown[]).map(item => fromJson(item, element, idl));
  }
  if (/^[ui](8|16|32|64|128)$/.test(type)) return BigInt(value as string);
  // 此类型的 u8[16] 是原始字节，EP4/EP5 都特意保持 number[]。
  if (type === 'WrappedI80F48') return value;
  const definition = idl.types?.find(entry => entry.name === type);
  if (!definition) return value;
  const object = value as Record<string, unknown>;
  if (definition.type.kind === 'struct') return fields(object, definition.type.fields, idl);
  const variant = definition.type.variants.find(entry => entry.name in object);
  if (!variant) throw new Error(`unknown stored enum: ${type}`);
  return { [variant.name]: fields(object[variant.name] as Record<string, unknown>, variant.fields, idl) };
}
