/**
 * 录制前预检:一条命令回答"现在能不能开始录"。每一项给出 ✓ / ✗(必须修) / ⚠(最好处理)。
 *
 *   pnpm exec tsx scripts/check-ready.ts
 *
 * 只做读取,不发交易、不改数据。需要 .env 里有 RPC_URL 与 ANCHOR_WALLET。
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { pgDb } from "../src/store/db";
import { marginfiIdl } from "../src/decoder/idl";
import { decodePullFeed } from "../src/decoder/switchboard";

const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
let failed = 0, warned = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const bad = (m: string) => { failed++; console.log(`  ✗ ${m}`); };
const warn = (m: string) => { warned++; console.log(`  ⚠ ${m}`); };
const section = (t: string) => console.log(`\n${t}`);
const safe = async <T>(f: () => Promise<T>): Promise<T | null> => { try { return await f(); } catch (e) { bad(String(e instanceof Error ? e.message : e).replace(/api-key=[^\s&"']+/g, "api-key=***")); return null; } };

(async () => {
  section("环境");
  const rpc = process.env.RPC_URL, walletPath = process.env.ANCHOR_WALLET;
  if (!rpc) { bad("缺少 RPC_URL(.env)"); return; }
  if (!walletPath) { bad("缺少 ANCHOR_WALLET(.env)"); return; }
  const connection = new Connection(rpc, "confirmed");
  const genesis = await safe(() => connection.getGenesisHash());
  if (genesis) genesis === DEVNET_GENESIS ? ok("RPC 是 devnet") : bad(`RPC 不是 devnet(创世哈希 ${genesis})`);
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf8"))));
  const lamports = await safe(() => connection.getBalance(admin.publicKey));
  if (lamports != null) lamports >= 1e9 ? ok(`管理员钱包 ${admin.publicKey.toBase58().slice(0, 6)}… 余额 ${(lamports / 1e9).toFixed(2)} SOL`) : warn(`管理员钱包余额只有 ${(lamports / 1e9).toFixed(3)} SOL,重跑剧本约需 0.3 SOL`);

  section("链上");
  const program = await safe(() => connection.getAccountInfo(new PublicKey(marginfiIdl.address)));
  program?.executable ? ok(`marginfi 已部署 ${marginfiIdl.address.slice(0, 8)}…`) : bad("marginfi 程序未部署或不可执行");
  let mocks: string | null = null;
  try { mocks = JSON.parse(readFileSync("program/out/program-ids.json", "utf8")).mocks; } catch { /* 没有构建产物也能录解码相关的集 */ }
  if (mocks) {
    const info = await safe(() => connection.getAccountInfo(new PublicKey(mocks!)));
    info?.executable ? ok("mocks(价格写入)程序已部署") : bad("mocks 程序未部署");
  } else warn("没有 program/out/program-ids.json(没构建过),无法检查价格程序;只录解码集不受影响");

  section("数据库");
  const db = pgDb();
  try {
    const count = async (t: string) => Number((await db.query(`SELECT count(*) AS n FROM ${t}`)).rows[0].n);
    const raw = await safe(() => count("raw_tx")), labels = await safe(() => count("labels"));
    raw ? ok(`raw_tx ${raw} 行`) : bad("raw_tx 为空:先 ingest --backfill");
    labels ? ok(`labels ${labels} 行`) : bad("labels 为空:先 load-labels");
    const feeds = (await safe(() => db.query("SELECT address, data FROM account_states WHERE type = 'switchboardPullFeed' ORDER BY slot DESC"))) ?? { rows: [] };
    if (!feeds.rows.length) warn("没有价格账户快照:先 ingest(会顺带快照价格账户)");
  } finally { await db.close(); }

  section("价格新鲜度(借款/清算需要价格在 240 秒内更新过)");
  if (mocks) {
    for (const token of ["tUSDC", "tSOL"]) {
      const { deriveKeypair } = await import("../scenario/lib/actors");
      const feed = deriveKeypair(`feed/${token}`).publicKey;
      const info = await safe(() => connection.getAccountInfo(feed));
      if (!info) { bad(`${token} 价格账户不存在`); continue; }
      const { last_update_timestamp, price } = decodePullFeed(info.data);
      const age = Math.floor(Date.now() / 1000) - Number(last_update_timestamp);
      age < 180 ? ok(`${token} = $${price.number} ,${age} 秒前更新`) : warn(`${token} = $${price.number} ,已 ${age} 秒没更新:录借款/钱包交互前先启动价格维护进程(scripts/price-keeper.ts)`);
    }
  }

  section("服务");
  for (const [name, url] of [["API", "http://localhost:8787/api/health"], ["水龙头", "http://localhost:8788/health"]] as const) {
    try { (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok ? ok(`${name}在运行`) : warn(`${name}响应异常`); }
    catch { name === "API" ? warn("API 没在运行:pnpm exec tsx scripts/serve-api.ts") : warn("水龙头没在运行(只有录钱包交互那集才需要)"); }
  }

  console.log(`\n${failed ? `✗ ${failed} 项必须修复` : "✓ 可以开始录制"}${warned ? `,${warned} 项提醒` : ""}`);
  process.exitCode = failed ? 1 : 0;
})();
