/**
 * 钱包交互的端到端验收:用一个全新的、一次性的钱包,通过真实的 HTTP 接口(API 与水龙头)走完整个流程。
 * 钱包在这里就是一个 Keypair——和 Phantom 做的事一样:拿到服务端构建的交易,签名,交还。
 *
 *   pnpm exec tsx scripts/e2e-wallet.ts
 *
 * 前提:API(8787)、水龙头(8788)、价格维护进程都在运行;.env 里有 RPC_URL 和 ANCHOR_WALLET。
 * 管理员钱包只用来给新钱包转一点 SOL(付手续费和账户租金),因为水龙头只发测试代币。
 * 花费:约 0.06 SOL。
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, VersionedTransaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { decodeAccount } from "../src/decoder/account";
import { marginfiIdl } from "../src/decoder/idl";
import type { BuildResponse, PoolView, SendResponse, WalletView } from "../src/api/types";

const API = process.env.API_URL ?? "http://localhost:8787";
const FAUCET = process.env.FAUCET_URL ?? "http://localhost:8788/faucet";
const rpc = process.env.RPC_URL!;
// 给每个 RPC 请求 20 秒超时:免费 RPC 限流时请求可能一直挂着,脚本不能跟着卡死。
const connection = new Connection(rpc, { commitment: "confirmed", fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }) });

async function http<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json() as T & { error?: unknown };
  if (!response.ok) throw new Error(`${url} → ${response.status} ${JSON.stringify(json.error ?? json)}`);
  return json;
}

(async () => {
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.ANCHOR_WALLET!, "utf8"))));
  const wallet = Keypair.generate(); // 一次性，不落盘
  const address = wallet.publicKey.toBase58();
  console.log(`新钱包 ${address}`);

  const pool = await http<PoolView>(`${API}/api/pool`);
  const bank = (label: string) => pool.banks.find((b) => b.label === label)!;
  const tUSDC = bank("tUSDC"), tSOL = bank("tSOL");

  console.log("1. 管理员转 0.06 SOL(付手续费与账户租金)");
  await sendAndConfirmTransaction(connection, new Transaction().add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: wallet.publicKey, lamports: 0.06 * LAMPORTS_PER_SOL })), [admin]);

  console.log("2. 水龙头领测试币");
  const granted = await http<{ granted: { label: string; amount: string }[] }>(FAUCET, { wallet: address });
  console.log("   到账:", granted.granted.map((g) => `${g.amount} ${g.label}`).join("、"));
  for (let i = 0; i < 20; i++) {
    const w = await http<WalletView>(`${API}/api/wallet/${address}`);
    if (w.tokens.every((t) => BigInt(t.amount) > 0n)) { console.log("   钱包余额:", w.tokens.map((t) => `${t.label}=${t.amount}`).join(" ")); break; }
    await new Promise((r) => setTimeout(r, 1500));
  }

  const step = async (title: string, request: { action: string; bank: string; amount: string; all?: boolean }) => {
    console.log(`\n${title}`);
    const built = await http<BuildResponse>(`${API}/api/build`, { ...request, wallet: address });
    console.log(`   摘要: ${built.summary}${built.creates_account ? "(同时创建 marginfi 账户)" : ""}`);
    if (!built.simulation.ok) throw new Error(`模拟失败: ${built.simulation.error?.name} ${built.simulation.error?.message}\n${built.simulation.logs.slice(-6).join("\n")}`);
    console.log(`   模拟通过,${built.simulation.units_consumed} 计算单元`);
    const tx = VersionedTransaction.deserialize(Buffer.from(built.transaction, "base64"));
    tx.sign([wallet]); // 钱包只补上自己的签名;服务端可能已带上一次性账户的签名
    const sent = await http<SendResponse>(`${API}/api/send`, { transaction: Buffer.from(tx.serialize()).toString("base64") });
    if (sent.status !== "confirmed") throw new Error(`发送失败: ${sent.status} ${JSON.stringify(sent.error)}`);
    console.log(`   ✓ 已确认 slot ${sent.slot} ${sent.signature.slice(0, 16)}…`);
    return built.marginfi_account;
  };
  const show = async (account: string) => {
    const info = await connection.getAccountInfo(new PublicKey(account), "confirmed");
    const decoded = decodeAccount(info!.data, marginfiIdl);
    const balances = ((decoded as unknown as { data: { lending_account: { balances: { active: boolean; bank_pk: string; asset_shares: { decimal: string }; liability_shares: { decimal: string } }[] } } }).data.lending_account.balances)
      .filter((b) => b.active).map((b) => `${b.bank_pk === tUSDC.address ? "tUSDC" : "tSOL"}: 存份额 ${b.asset_shares.decimal.slice(0, 14)} 借份额 ${b.liability_shares.decimal.slice(0, 14)}`);
    console.log(`   链上账户(最新): ${balances.join(" | ") || "无活跃头寸"}`);
  };

  // 注意 marginfi 的语义:同一个 bank 的头寸要么是存款要么是负债。
  // 在已有 tUSDC 存款的情况下"借 tUSDC",只是把自己的存款取出来,并不产生负债。要产生负债,必须用另一种代币做抵押。
  const account = await step("3. 首次存款 10 tSOL 作抵押(自动创建账户)", { action: "deposit", bank: tSOL.address, amount: "10000000000" });
  await show(account);
  await step("4. 借 200 tUSDC(产生真正的负债)", { action: "borrow", bank: tUSDC.address, amount: "200000000" });
  await show(account);
  await step("5. 还清 tUSDC(repay_all,含利息)", { action: "repay", bank: tUSDC.address, amount: "0", all: true });
  await show(account);
  await step("6. 存 100 tUSDC(账户已存在,不应再创建)", { action: "deposit", bank: tUSDC.address, amount: "100000000" });
  await show(account);
  await step("7. 取出全部 tUSDC(withdraw_all)", { action: "withdraw", bank: tUSDC.address, amount: "0", all: true });
  await show(account);
  await step("8. 取出全部 tSOL(withdraw_all)", { action: "withdraw", bank: tSOL.address, amount: "0", all: true });
  await show(account);
  console.log("\n✓ 端到端通过。新钱包的 marginfi 账户:", account);
  // sendAndConfirmTransaction 会开 WebSocket 订阅,不主动退出的话进程会一直挂着。
  process.exit(0);
})().catch((error) => { console.error("\n✗", String(error?.message ?? error).replace(/api-key=[^\s&"']+/g, "api-key=***")); process.exit(1); });
