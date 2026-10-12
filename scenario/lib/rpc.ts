import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import anchor from '@coral-xyz/anchor';
import { ComputeBudgetProgram, Connection, Keypair, TransactionExpiredBlockheightExceededError, TransactionInstruction,
  TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { parseEvents, writeJson, type Receipt } from './record';
import type { Context } from './context';

const { AnchorProvider, Wallet, utils } = anchor;

export async function connect() {
  const endpoint = process.env.RPC_URL;
  const walletPath = process.env.ANCHOR_WALLET?.replace(/^~\//, `${homedir()}/`);
  if (!endpoint || !walletPath) throw new Error('--execute 需要 RPC_URL 和 ANCHOR_WALLET');
  // 免费/共享 RPC 偶发连接超时(fetch failed / ConnectTimeoutError)；没有重试时一次抖动就会让整个剧本半途而废。
  // 只重试"请求没发出去/没收到响应"的网络错误，不重试 HTTP 状态错误。发送交易是幂等的(同一签名重复提交无副作用)。
  const retryingFetch: typeof fetch = async (input, init) => {
    for (let attempt = 1; ; attempt++) {
      try { return await fetch(input, init); }
      catch (error) {
        if (attempt >= 5) throw error;
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      }
    }
  };
  const connection = new Connection(endpoint, { commitment: 'confirmed', fetch: retryingFetch });
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

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 等待确认，同时每 2 秒重播同一笔已签名交易。
 * 为什么：devnet 上交易经常发出去就被丢弃(RPC 没转发、领导者没打包)，只发一次的话要一直等到
 * blockhash 过期才知道。同一个签名重复提交无副作用，所以可以放心重播。
 */
async function confirmWithRebroadcast(connection: Connection, bytes: Uint8Array, signature: string,
  latest: { blockhash: string; lastValidBlockHeight: number }) {
  let done = false;
  const rebroadcast = (async () => {
    while (!done) {
      await sleep(2000);
      if (!done) await connection.sendRawTransaction(bytes, { skipPreflight: true }).catch(() => undefined);
    }
  })();
  try { return await connection.confirmTransaction({ signature, ...latest }, 'confirmed'); }
  finally { done = true; await rebroadcast; }
}

export async function send(ctx: Context, label: string, instructions: TransactionInstruction[], signers: Keypair[] = [],
  crank = false) {
  if (!instructions.length) throw new Error(`${label} 没有指令`);
  const connection = ctx.provider.connection;
  // crank 的 secp 指令引用绝对索引，ComputeBudget 必须最后追加。
  const budget = ComputeBudgetProgram.setComputeUnitLimit({ units: crank ? 600_000 : 400_000 });
  const ordered = crank ? [...instructions, budget] : [budget, ...instructions];
  const unique = [...new Map([ctx.admin, ...signers].map(k => [k.publicKey.toBase58(), k])).values()];
  const receipt: Receipt = { step: ctx.step, label, signatures: [], slot: null, status: 'signed' };
  ctx.record.steps.push(receipt);
  let signature = '', result: Awaited<ReturnType<Connection['confirmTransaction']>> | undefined;
  for (let attempt = 1; ; attempt++) {
    const latest = await connection.getLatestBlockhash('confirmed');
    const tx = new VersionedTransaction(new TransactionMessage({
      payerKey: ctx.admin.publicKey, recentBlockhash: latest.blockhash, instructions: ordered,
    }).compileToV0Message());
    tx.sign(unique);
    const bytes = tx.serialize();
    if (bytes.length > 1232) throw new Error(`${label} 交易 ${bytes.length} 字节，超过 1232；未发送`);
    // 发送前就保存本地已签名的签名；RPC 超时不能证明交易没落链。
    signature = utils.bytes.bs58.encode(tx.signatures[0]);
    receipt.signatures = [signature]; receipt.status = 'signed';
    writeJson(ctx.outputPath, ctx.record);
    await connection.sendRawTransaction(bytes, { skipPreflight: false, maxRetries: 3 });
    receipt.status = 'submitted';
    writeJson(ctx.outputPath, ctx.record);
    console.log(`${ctx.step}. ${label}: ${signature}${attempt > 1 ? `（第 ${attempt} 次尝试）` : ''}`);
    try { result = await confirmWithRebroadcast(connection, bytes, signature, latest); break; }
    catch (error) {
      if (!(error instanceof TransactionExpiredBlockheightExceededError) || attempt >= 3) throw error;
      // blockhash 已过期，这个签名不可能再上链；但过期前最后一刻可能已经落了，先查一次再重建。
      const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
      if (status && !status.err && status.confirmationStatus) { result = { context: { slot: status.slot }, value: { err: null } }; break; }
      (receipt.dropped ??= []).push(signature);
    }
  }
  if (result!.value.err) {
    receipt.status = 'failed'; receipt.error = JSON.stringify(result!.value.err);
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
