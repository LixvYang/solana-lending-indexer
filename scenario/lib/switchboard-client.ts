import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import type { Context } from './context';

export const SWITCHBOARD_PROGRAM = 'Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2';
export const SWITCHBOARD_QUEUE = 'EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7';

async function load(ctx: Context) {
  const localRequire = createRequire(resolve('package.json'));
  const sb = localRequire('@switchboard-xyz/on-demand') as typeof import('@switchboard-xyz/on-demand');
  // 从 SDK 自己的依赖树加载 Anchor/web3；边界只接受地址字符串、secretKey 字节和指令字节。
  const externalRequire = createRequire(localRequire.resolve('@switchboard-xyz/on-demand'));
  const anchor = externalRequire('@coral-xyz/anchor-31') as typeof import('@coral-xyz/anchor');
  const wallet = new anchor.Wallet(anchor.web3.Keypair.fromSecretKey(Uint8Array.from(ctx.admin.secretKey)));
  const connection = new anchor.web3.Connection(ctx.provider.connection.rpcEndpoint, 'confirmed');
  const program = await sb.AnchorUtils.loadProgramFromConnection(connection, wallet,
    new anchor.web3.PublicKey(SWITCHBOARD_PROGRAM));
  const queue = new sb.Queue(program, new anchor.web3.PublicKey(SWITCHBOARD_QUEUE));
  return { sb, program, queue, wallet };
}

const clients = new WeakMap<Context, ReturnType<typeof load>>();
export function switchboardClient(ctx: Context) {
  let client = clients.get(ctx);
  if (!client) { client = load(ctx); clients.set(ctx, client); }
  return client;
}

export function rebuildInstruction(ix: {
  programId: { toBase58(): string }; keys: { pubkey: { toBase58(): string }; isSigner: boolean; isWritable: boolean }[];
  data: Uint8Array;
}) {
  return new TransactionInstruction({ programId: new PublicKey(ix.programId.toBase58()),
    keys: ix.keys.map(key => ({ ...key, pubkey: new PublicKey(key.pubkey.toBase58()) })), data: Buffer.from(ix.data) });
}
