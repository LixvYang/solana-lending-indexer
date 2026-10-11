/**
 * 把剧本运行记录里的交易，按 RPC 原始 JSON(encoding: "json")重新拉一遍存成 fixtures。
 *
 *   pnpm exec tsx scripts/fetch-fixtures.ts fixtures/m1-run.json fixtures/m1-transactions.json
 *
 * 为什么不直接用 m1-run.json 里的交易：那是 web3.js 反序列化后再 JSON 化的结果(data 是字节对象、
 * 字段名也不同)，而 indexer 实际会从 RPC 拿到的是下面这种线上格式，解码器必须吃这种。
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";

const [runPath, outPath] = process.argv.slice(2);
if (!runPath || !outPath) throw new Error("用法: fetch-fixtures.ts <run.json> <输出.json>");
const rpc = process.env.RPC_URL;
if (!rpc) throw new Error("需要 RPC_URL");

const run = JSON.parse(readFileSync(runPath, "utf8"));
const signatures: string[] = run.steps.flatMap((step: { signatures: string[] }) => step.signatures);

// 公共/免费 RPC 偶发连接失败(fetch failed)，重试几次再放弃。
async function getTransaction(signature: string, attempt = 1): Promise<unknown> {
  try { return await getTransactionOnce(signature); } catch (error) {
    if (attempt >= 5) throw error;
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    return getTransaction(signature, attempt + 1);
  }
}

async function getTransactionOnce(signature: string) {
  const response = await fetch(rpc!, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction",
      params: [signature, { encoding: "json", commitment: "finalized", maxSupportedTransactionVersion: 0 }] }),
  });
  const body = await response.json() as { result?: unknown; error?: unknown };
  if (!body.result) throw new Error(`${signature} 取不到: ${JSON.stringify(body.error)}`);
  return body.result;
}

(async () => {
  const transactions: Record<string, unknown> = {};
  for (const signature of signatures) transactions[signature] = await getTransaction(signature);
  writeFileSync(outPath, JSON.stringify({ source: "getTransaction encoding=json", signatures, transactions }, null, 1));
  console.log(`写入 ${signatures.length} 笔交易 → ${outPath}`);
})().catch((error) => { console.error(String(error).replace(/api-key=[^\s&"']+/g, "api-key=***")); process.exit(1); });
