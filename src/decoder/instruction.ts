/**
 * INPUT: RPC compiled instruction、完整账户表与 IDL。
 * OUTPUT: decodeInstruction，成功/unknown/decodeError，保留失败原文。
 * POSITION: 单指令的纯解码入口，错误不跨指令传播。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import { decodeBase58 } from '../core/base58';
import { Reader } from '../core/reader';
import { decodeFields } from './borsh';
import type { Idl, IdlAccount } from './idl';

export interface RpcInstruction {
  programIdIndex: number;
  accounts: number[];
  data: string;
  stackHeight?: number | null;
}
export type DecodedInstruction =
  | { name: string; args: Record<string, unknown>; accounts: Record<string, string>; remaining: string[] }
  | { name: 'unknown'; discriminator: string; data: string }
  | { name: string; decodeError: string; data: string; rawData?: string; dataEncoding?: 'base58' };

// #region ep4-account-names
function accountNames(accounts: IdlAccount[]): string[] {
  // IDL 分组只组织名称，不占账户槽位；RPC accounts 下标按叶子声明顺序排列。
  return accounts.flatMap(account => account.accounts ? accountNames(account.accounts)
    : [account.name]);
}
function addressAt(keys: string[], index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= keys.length) {
    throw new Error(`account index out of bounds: ${index} (table length ${keys.length})`);
  }
  return keys[index];
}
// #endregion

export function decodeInstruction(ix: RpcInstruction, accountKeys: string[], idl: Idl): DecodedInstruction {
  let bytes: Buffer;
  try { bytes = decodeBase58(ix.data); } catch (error) {
    // 非法 base58 没有可恢复的字节；单独标明编码，保留 RPC 原文。
    return { name: 'unknown', decodeError: String(error), data: ix.data, rawData: ix.data, dataEncoding: 'base58' };
  }
  const data = bytes.toString('base64');
  if (bytes.length < 8) return { name: 'unknown', decodeError: `need 8 discriminator bytes, got ${bytes.length}`, data };
  const discriminator = bytes.subarray(0, 8).toString('hex');
  const instruction = idl.instructions.find(entry => Buffer.from(entry.discriminator).equals(bytes.subarray(0, 8)));
  if (!instruction) return { name: 'unknown', discriminator, data };
  try {
    addressAt(accountKeys, ix.programIdIndex);
    const args = decodeFields(instruction.args, new Reader(bytes.subarray(8)), idl);
    const names = accountNames(instruction.accounts);
    if (ix.accounts.length < names.length) {
      throw new Error(`need ${names.length} accounts, got ${ix.accounts.length}`);
    }
    if (new Set(names).size !== names.length) throw new Error('duplicate IDL account names after flattening');
    const addresses = ix.accounts.map(index => addressAt(accountKeys, index));
    return { name: instruction.name, args,
      accounts: Object.fromEntries(names.map((name, index) => [name, addresses[index]])),
      remaining: addresses.slice(names.length) };
  } catch (error) {
    return { name: instruction.name, decodeError: error instanceof Error ? error.message : String(error), data };
  }
}
