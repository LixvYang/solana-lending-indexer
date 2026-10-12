/** INPUT: finalized getBlock、程序地址。 OUTPUT: getTransaction 形状的调用交易。 POSITION: EP6 区块过滤。 SYNC: 同步 folder.md。 */
import { RpcError, type RpcBlock, type RawTransaction } from './rpc';
export interface BlockRpc { getBlock(slot: number): Promise<RpcBlock | null> }
export async function fetchProgramTxs(rpc: BlockRpc, slot: number, programId: string): Promise<RawTransaction[]> {
  let block: RpcBlock | null;
  try { block = await rpc.getBlock(slot); }
  catch (error) {
    // -32007 是 skipped slot；-32009 是节点缺历史，绝不能静默推进游标。
    if (error instanceof RpcError && error.code === -32007) return [];
    throw error;
  }
  if (!block) throw new Error(`block unavailable at slot ${slot}`);
  return block.transactions.filter(tx => {
    const message = tx.transaction?.message as { accountKeys?: string[]; instructions?: unknown[] } | undefined;
    if (!Array.isArray(message?.accountKeys) || !Array.isArray(message?.instructions)) {
      // 形状不认识(比如未来的交易版本)：与本程序无关就跳过，可能相关就报错，绝不静默漏掉。
      if (JSON.stringify(tx).includes(programId)) throw new Error(`cannot parse tx version ${tx.version} touching ${programId}`);
      return false;
    }
    const keys = [...tx.transaction.message.accountKeys, ...(tx.meta?.loadedAddresses?.writable ?? []),
      ...(tx.meta?.loadedAddresses?.readonly ?? [])];
    const instructions = [...tx.transaction.message.instructions, ...(tx.meta?.innerInstructions ?? []).flatMap(inner => inner.instructions)];
    return instructions.some(ix => keys[ix.programIdIndex] === programId);
  }).map(tx => ({ ...tx, slot, blockTime: block.blockTime, version: tx.version ?? 'legacy' }));
}
