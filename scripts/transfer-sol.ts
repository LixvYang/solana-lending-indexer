/**
 * 用一个私钥给指定地址转 devnet SOL。
 *
 *   SENDER_PRIVATE_KEY=<私钥> pnpm transfer-sol --to <地址> --amount 10
 *   pnpm transfer-sol --to <地址> --amount 10        # 不带私钥则隐藏输入
 *   pnpm transfer-sol --rpc <RPC 地址> --to <地址> --amount 10
 *
 * RPC 地址优先级:--rpc > 环境变量 RPC_URL(.env) > 公共 devnet 节点(容易 429 限流)。
 *
 * 私钥格式:base58 字符串(钱包导出的那种),或 JSON 字节数组(solana-keygen 文件内容)。
 * 不推荐用 --key 传私钥:命令行参数会进 shell 历史和进程列表。
 *
 * 安全:发送前会核对 RPC 的创世哈希必须是 devnet,防止误用主网 RPC 转走真钱。
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { utils } from "@coral-xyz/anchor";
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction,
} from "@solana/web3.js";

const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const DEFAULT_RPC = "https://api.devnet.solana.com";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** 把 "1.5" 解析成 lamports;用整数运算,避免浮点误差。 */
function parseSol(text: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,9}))?$/.exec(text.trim());
  if (!m) throw new Error(`金额格式错误:${text}(需要像 10 或 0.5,最多 9 位小数)`);
  return BigInt(m[1]) * BigInt(LAMPORTS_PER_SOL) + BigInt((m[2] ?? "").padEnd(9, "0"));
}

function keypairFromSecret(secret: string): Keypair {
  const text = secret.trim();
  const bytes = text.startsWith("[")
    ? Uint8Array.from(JSON.parse(text) as number[])
    : utils.bytes.bs58.decode(text);
  if (bytes.length !== 64) throw new Error(`私钥长度应为 64 字节,实际 ${bytes.length}`);
  return Keypair.fromSecretKey(bytes);
}

/** 终端隐藏输入:不回显,避免私钥留在屏幕和滚动历史里。 */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = (rl as unknown as { _writeToOutput: (s: string) => void });
    write._writeToOutput = () => {};
    process.stdout.write(question);
    rl.question("", (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
  });
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
  rl.close();
  return answer.trim().toLowerCase() === "y";
}

async function main() {
  let secret = arg("key");
  if (secret) console.warn("⚠ 通过 --key 传私钥会留在 shell 历史里,建议用环境变量 SENDER_PRIVATE_KEY 或隐藏输入。");
  secret ??= process.env.SENDER_PRIVATE_KEY || await promptHidden("发送方私钥(输入不回显): ");
  const sender = keypairFromSecret(secret);

  const toText = arg("to") ?? (process.env.ANCHOR_WALLET
    ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.ANCHOR_WALLET, "utf8")))).publicKey.toBase58()
    : undefined);
  if (!toText) throw new Error("缺少 --to <接收地址>(或设置 ANCHOR_WALLET 以默认转给部署钱包)");
  const to = new PublicKey(toText);

  const lamports = parseSol(arg("amount") ?? (() => { throw new Error("缺少 --amount <SOL 数量>"); })());

  const connection = new Connection(arg("rpc") ?? process.env.RPC_URL ?? DEFAULT_RPC, "confirmed");
  const genesis = await connection.getGenesisHash();
  if (genesis !== DEVNET_GENESIS_HASH) {
    throw new Error(`RPC 不是 devnet(创世哈希 ${genesis}),已拒绝发送。`);
  }

  const balance = BigInt(await connection.getBalance(sender.publicKey));
  const fee = 5000n; // 单签名转账的基础手续费
  console.log(`网络   devnet`);
  console.log(`发送方 ${sender.publicKey.toBase58()}  余额 ${Number(balance) / LAMPORTS_PER_SOL} SOL`);
  console.log(`接收方 ${to.toBase58()}`);
  console.log(`金额   ${Number(lamports) / LAMPORTS_PER_SOL} SOL`);
  if (balance < lamports + fee) throw new Error("余额不足(需要金额 + 手续费)");

  if (!process.argv.includes("--yes") && !(await confirm("确认发送? (y/N) "))) {
    console.log("已取消");
    return;
  }

  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: sender.publicKey, toPubkey: to, lamports }),
  );
  const signature = await sendAndConfirmTransaction(connection, tx, [sender]);
  console.log(`✓ 已确认 ${signature}`);
  console.log(`  https://explorer.solana.com/tx/${signature}?cluster=devnet`);
}

main().catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
