/** INPUT: 公开 feed signer、RPC、当前链上价格。 OUTPUT: 保持价格的 write 指令。 POSITION: EP8 keeper 无环境密钥读取。 SYNC: folder.md。 */
import type { Connection, PublicKey } from '@solana/web3.js';
import { tokens, type Token } from '../../scenario/lib/actors';
import { resultRegion, writeIx, feedKeypair } from '../../scenario/lib/mock-feed';
import { decodePullFeed, OFFSET } from '../decoder/switchboard';
export type PriceRpc = Pick<Connection, 'getAccountInfo' | 'getSlot' | 'getBlockTime'>;
export async function priceInstruction(rpc: PriceRpc, program: PublicKey, token: Token, newPrice?: bigint) {
  const signer = feedKeypair(token), info = await rpc.getAccountInfo(signer.publicKey, 'confirmed');
  if (!info || !info.owner.equals(program)) throw Error('invalid mock feed owner');
  const current = decodePullFeed(info.data);
  if (!current.sample_size && newPrice === undefined) throw Error('uninitialized price');
  const slot = await rpc.getSlot('confirmed'), timestamp = await rpc.getBlockTime(slot);
  if (timestamp === null) throw Error('chain time unavailable');
  const price = newPrice ?? current.price.numerator;
  if (price <= 0n) throw Error('invalid price');
  return { signer, instruction: writeIx(program, signer.publicKey, OFFSET.sampleSize, resultRegion(price, timestamp, slot)) };
}
export async function refreshPrices(rpc: PriceRpc, program: PublicKey, send: (value: Awaited<ReturnType<typeof priceInstruction>>) => Promise<void>) {
  for (const token of tokens) await send(await priceInstruction(rpc, program, token));
}
