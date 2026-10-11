import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import anchor from '@coral-xyz/anchor';
import { ComputeBudgetProgram, Connection, Keypair, TransactionInstruction,
  TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { parseEvents, writeJson, type Receipt } from './record';
import type { Context } from './context';

const { AnchorProvider, Wallet, utils } = anchor;

export async function connect() {
  const endpoint = process.env.RPC_URL;
  const walletPath = process.env.ANCHOR_WALLET?.replace(/^~\//, `${homedir()}/`);
  if (!endpoint || !walletPath) throw new Error('--execute 需要 RPC_URL 和 ANCHOR_WALLET');
  const connection = new Connection(endpoint, 'confirmed');
  // Helius URL 的域名不能证明集群；genesis hash 可阻止误把测试币脚本跑到主网。
  if (await connection.getGenesisHash() !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG')
    throw new Error('RPC 不是 Solana devnet，停止执行');
  const bytes = JSON.parse(readFileSync(walletPath, 'utf8'));
  if (!Array.isArray(bytes) || bytes.length !== 64 || bytes.some(b => !Number.isInteger(b) || b < 0 || b > 255))
    throw new Error('ANCHOR_WALLET 不是 64 字节 Solana 密钥文件');
  const admin = Keypair.fromSecretKey(Uint8Array.from(bytes));
  return { admin, provider: new AnchorProvider(connection, new Wallet(admin), { commitment: 'confirmed' }) };
}

export async function transactionInfo(ctx: Context, signature: string, finalized = false) {
  const connection = ctx.provider.connection;
  for (let attempt = 0; attempt < 10; attempt++) {
    const tx = await connection.getTransaction(signature, {
      commitment: finalized ? 'finalized' : 'confirmed', maxSupportedTransactionVersion: 0,
    });
    if (tx) return tx;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(`RPC 尚未返回交易 ${signature}；签名已保存在 run 文件中`);
}

export async function send(ctx: Context, label: string, instructions: TransactionInstruction[], signers: Keypair[] = [],
  crank = false) {
  if (!instructions.length) throw new Error(`${label} 没有指令`);
  const connection = ctx.provider.connection;
  const latest = await connection.getLatestBlockhash('confirmed');
  // crank 的 secp 指令引用绝对索引，ComputeBudget 必须最后追加。
  const budget = ComputeBudgetProgram.setComputeUnitLimit({ units: crank ? 600_000 : 400_000 });
  const ordered = crank ? [...instructions, budget] : [budget, ...instructions];
  const unique = [...new Map([ctx.admin, ...signers].map(k => [k.publicKey.toBase58(), k])).values()];
  const tx = new VersionedTransaction(new TransactionMessage({
    payerKey: ctx.admin.publicKey, recentBlockhash: latest.blockhash, instructions: ordered,
  }).compileToV0Message());
  tx.sign(unique);
  const bytes = tx.serialize();
  if (bytes.length > 1232) throw new Error(`${label} 交易 ${bytes.length} 字节，超过 1232；未发送`);
  // 发送前就保存本地已签名的签名；RPC 超时不能证明交易没落链。
  const signature = utils.bytes.bs58.encode(tx.signatures[0]);
  const receipt: Receipt = { step: ctx.step, label, signatures: [signature], slot: null, status: 'signed' };
  ctx.record.steps.push(receipt);
  writeJson(ctx.outputPath, ctx.record);
  await connection.sendRawTransaction(bytes, { skipPreflight: false, maxRetries: 3 });
  receipt.status = 'submitted';
  writeJson(ctx.outputPath, ctx.record);
  console.log(`${ctx.step}. ${label}: ${signature}`);
  const result = await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
  if (result.value.err) {
    receipt.status = 'failed'; receipt.error = JSON.stringify(result.value.err);
    writeJson(ctx.outputPath, ctx.record);
    throw new Error(`${label} 链上失败：${receipt.error}`);
  }
  const info = await transactionInfo(ctx, signature);
  if (!info.meta || info.meta.err || !info.meta.logMessages) throw new Error(`${label} 交易元数据不可用`);
  receipt.slot = info.slot; receipt.status = 'confirmed';
  ctx.record.transactions[signature] = info;
  ctx.record.events.push(...parseEvents(ctx.program, signature, info.meta.logMessages));
  writeJson(ctx.outputPath, ctx.record);
  return signature;
}

export async function finalizeRecord(ctx: Context) {
  for (const receipt of ctx.record.steps) {
    for (const signature of receipt.signatures) {
      const result = await ctx.provider.connection.confirmTransaction(signature, 'finalized');
      if (result.value.err) throw new Error(`finalized 交易失败：${signature}`);
      const tx = await transactionInfo(ctx, signature, true);
      receipt.slot = tx.slot;
      ctx.record.transactions[signature] = tx;
    }
    receipt.status = 'finalized';
    writeJson(ctx.outputPath, ctx.record);
  }
}
