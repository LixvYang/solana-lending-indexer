/**
 * INPUT: getTransaction encoding=json 的原始结果与 IDL。
 * OUTPUT: decodeTransaction，带交易签名和调用位置的 marginfi 指令。
 * POSITION: 顶层/inner 指令的展开边界，不连接 RPC。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import { decodeInstruction, type DecodedInstruction, type RpcInstruction } from './instruction';
import type { Idl } from './idl';

export interface RpcTransaction {
  transaction: { signatures: string[]; message: { accountKeys: string[]; instructions: RpcInstruction[] } };
  meta?: {
    loadedAddresses?: { writable: string[]; readonly: string[] };
    innerInstructions?: { index: number; instructions: RpcInstruction[] }[] | null;
  } | null;
}
export type TransactionInstruction = DecodedInstruction & {
  signature: string;
  ixIndex: number;
  innerIndex: number | null;
  stackHeight: number | null;
};

// #region ep4-flatten
export function decodeTransaction(rpcTx: RpcTransaction, idl: Idl): TransactionInstruction[] {
  const { message, signatures } = rpcTx.transaction;
  // v0 的地址表下标接在静态账户之后：先可写，再只读，不能按地址重排或去重。
  const accountKeys = [...message.accountKeys, ...(rpcTx.meta?.loadedAddresses?.writable ?? []),
    ...(rpcTx.meta?.loadedAddresses?.readonly ?? [])];
  const result: TransactionInstruction[] = [];
  const append = (ix: RpcInstruction, ixIndex: number, innerIndex: number | null) => {
    if (accountKeys[ix.programIdIndex] !== idl.address) return;
    result.push({ ...decodeInstruction(ix, accountKeys, idl), signature: signatures[0],
      ixIndex, innerIndex, stackHeight: ix.stackHeight ?? null });
  };
  message.instructions.forEach((ix, ixIndex) => {
    append(ix, ixIndex, null);
    for (const inner of rpcTx.meta?.innerInstructions ?? []) {
      if (inner.index === ixIndex) inner.instructions.forEach((cpi, innerIndex) => append(cpi, ixIndex, innerIndex));
    }
  });
  return result;
}
// #endregion
