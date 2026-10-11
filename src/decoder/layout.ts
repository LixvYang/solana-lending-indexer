/**
 * INPUT: 固定 IDL 的 repr(C) 类型。
 * OUTPUT: 每字段 offset/size/align/padding 与结构尾部补齐。
 * POSITION: EP5 zero_copy 布局计算，不使用 Borsh 长度。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import type { Idl, IdlType } from './idl';
export interface Layout {
  size: number; align: number; tailPadding?: number;
  fields?: (Layout & { name: string; type: IdlType; offset: number; previousEnd: number; padding: number })[];
}
const alignUp = (offset: number, align: number) => Math.ceil(offset / align) * align;

// #region ep5-layout
export function layout(type: IdlType | string, idl: Idl): Layout {
  if (typeof type === 'object') {
    if ('array' in type) {
      const element = layout(type.array[0], idl);
      return { size: element.size * type.array[1], align: element.align };
    }
    if ('defined' in type) return layout(type.defined.name, idl);
    throw new Error('zero_copy requires a fixed size type');
  }
  if (type === 'pubkey') return { size: 32, align: 1 };
  if (type === 'bool') return { size: 1, align: 1 };
  if (/^[uif](8|16|32|64|128)$/.test(type)) {
    const size = Number(type.slice(1)) / 8;
    return { size, align: size };
  }
  const definition = idl.types?.find(entry => entry.name === type);
  if (!definition) throw new Error(`undefined fixed layout type: ${type}`);
  if (definition.type.kind === 'enum') {
    if (definition.type.variants.some(v => v.fields?.length)) throw new Error(`enum with fields is not a fixed layout: ${type}`);
    // 此固定版本的无字段枚举按 u8；账户 fixture 与 Anchor 字段对照验证。
    return { size: 1, align: 1 };
  }
  if (definition.repr?.kind !== 'c') throw new Error(`not repr(C): ${type}`);
  let end = 0, align = definition.repr.align ?? 1;
  // #region ep5-padding
  const fields = (definition.type.fields ?? []).map((field, index) => {
    const named = typeof field === 'object' && 'name' in field;
    const fieldType = named ? field.type : field as IdlType;
    const child = layout(fieldType, idl), previousEnd = end;
    // 字段必须从自身对齐的倍数开始；显式 _pad 字段之外仍可能有隐式空隙。
    const offset = alignUp(end, child.align);
    end = offset + child.size; align = Math.max(align, child.align);
    return { ...child, name: named ? field.name : String(index), type: fieldType,
      offset, previousEnd, padding: offset - previousEnd };
  });
  // 尾部也补齐，保证数组中下一个结构体仍符合对齐。
  return { size: alignUp(end, align), align, fields, tailPadding: alignUp(end, align) - end };
  // #endregion
}
// #endregion
