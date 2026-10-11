/**
 * INPUT: 仓库固定的 Anchor 0.30 JSON IDL。
 * OUTPUT: 解码所需的 IDL 类型与 marginfiIdl。
 * POSITION: 参数布局和账户顺序的唯一来源。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import json from './idl/marginfi.idl.json';

export type IdlType = 'bool' | 'pubkey' | 'string' | 'bytes'
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
  type: { kind: 'struct'; fields?: IdlFields }
    | { kind: 'enum'; variants: { name: string; fields?: IdlFields }[] };
}
export interface Idl {
  address: string;
  instructions: IdlInstruction[];
  types?: IdlTypeDefinition[];
}
// IDL 还含账户/事件的 f64 等布局；M2 只消费指令可达的类型，不解码事件。
export const marginfiIdl = json as unknown as Idl;
