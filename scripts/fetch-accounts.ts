/**
 * 取剧本涉及的账户原始字节(getAccountInfo, base64)存成 fixtures，供账户解码器离线测试。
 *
 *   pnpm exec tsx scripts/fetch-accounts.ts fixtures/m1-run.json fixtures/m1-accounts.json
 *
 * 前提：剧本跑完后没有人再动过这些账户，否则原始字节会和 m1-run.json 里的快照对不上。
 * 脚本会用 Anchor 解码后核对 bank 的 last_update 与快照一致，不一致就报错。
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { BorshCoder, type Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";

const [runPath, outPath] = process.argv.slice(2);
if (!runPath || !outPath) throw new Error("用法: fetch-accounts.ts <run.json> <输出.json>");
const rpc = process.env.RPC_URL;
if (!rpc) throw new Error("需要 RPC_URL");

const run = JSON.parse(readFileSync(runPath, "utf8"));
const idl = JSON.parse(readFileSync("src/decoder/idl/marginfi.idl.json", "utf8")) as Idl;
const program = new PublicKey(idl.address);
const feeState = PublicKey.findProgramAddressSync([Buffer.from("feestate")], program)[0].toBase58();
const a = run.addresses;
const names: Record<string, string> = {
  [a.group]: "marginfiGroup", [feeState]: "feeState",
  ...Object.fromEntries(Object.values(a.banks).map((k) => [k as string, "bank"])),
  ...Object.fromEntries(Object.values(a.marginfiAccounts).map((k) => [k as string, "marginfiAccount"])),
};

(async () => {
  const connection = new Connection(rpc, "finalized");
  const coder = new BorshCoder(idl);
  const accounts: Record<string, unknown> = {};
  for (const [address, type] of Object.entries(names)) {
    const info = await connection.getAccountInfo(new PublicKey(address), "finalized");
    if (!info) throw new Error(`${address} (${type}) 不存在`);
    if (!info.owner.equals(program)) throw new Error(`${address} owner 不是 marginfi`);
    if (type === "bank") {
      const decoded = coder.accounts.decode("Bank", info.data);
      const snapshot = run.snapshots.banks[address];
      if (String(decoded.last_update) !== String(snapshot.lastUpdate))
        throw new Error(`${address} last_update 与快照不一致：链上状态在剧本之后被改动过`);
    }
    accounts[address] = { type, owner: info.owner.toBase58(), lamports: info.lamports, dataLength: info.data.length,
      data: info.data.toString("base64") };
  }
  writeFileSync(outPath, JSON.stringify({ source: "getAccountInfo finalized, base64", accounts }, null, 1));
  console.log(`写入 ${Object.keys(accounts).length} 个账户 → ${outPath}`);
})().catch((e) => { console.error(String(e).replace(/api-key=[^\s&"']+/g, "api-key=***")); process.exit(1); });
