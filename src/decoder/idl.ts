/**
 * INPUT: 仓库固定的 Anchor 0.30 JSON IDL。
 * OUTPUT: 指令/事件/账户所需的 IDL 类型与 marginfiIdl。
 * POSITION: 参数、事件和账户布局的唯一来源。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import json from './idl/marginfi.idl.json';

export type IdlType = 'bool' | 'pubkey' | 'string' | 'bytes'
  | 'f32' | 'f64'
  | 'u8' | 'u16' | 'u32' | 'u64' | 'u128' | 'i8' | 'i16' | 'i32' | 'i64' | 'i128'
  | { option: IdlType } | { vec: IdlType } | { array: [IdlType, number] }
  | { defined: { name: string } };
export interface IdlField { name: string; type: IdlType }
export type IdlFields = IdlField[] | IdlType[];
export type IdlAccount = { name: string; accounts?: undefined } | { name: string; accounts: IdlAccount[] };
export interface IdlInstruction {
  name: string;
  discriminator: number[];
  accounts: IdlAccount[];
  args: IdlField[];
}
export interface IdlTypeDefinition {
  name: string;
  serialization?: string;
  repr?: { kind: string; align?: number };
  type: { kind: 'struct'; fields?: IdlFields }
    | { kind: 'enum'; variants: { name: string; fields?: IdlFields }[] };
}
export interface Idl {
  address: string;
  instructions: IdlInstruction[];
  types?: IdlTypeDefinition[];
  events?: { name: string; discriminator: number[] }[];
  accounts?: { name: string; discriminator: number[] }[];
}
// 同一 IDL 的指令/事件走 Borsh，zero_copy 账户单独计算 C 布局。
export const marginfiIdl = json as unknown as Idl;
