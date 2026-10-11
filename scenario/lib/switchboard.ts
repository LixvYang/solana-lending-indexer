import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CrossbarClient, OracleJob } from '@switchboard-xyz/common';
import { LegacyCrossbarClient } from '@switchboard-xyz/common-legacy';
import { Keypair, PublicKey } from '@solana/web3.js';
import type { Token } from './actors';
import type { Context } from './context';
import { send } from './rpc';
import { writeJson } from './record';
import { SWITCHBOARD_PROGRAM, SWITCHBOARD_QUEUE, switchboardClient, rebuildInstruction } from './switchboard-client';

// 旧域名 crossbar.switchboard.xyz 已解析不到(2026-10-11 实测),SDK 默认值仍指向它,
// 所以 store 和 crank 都显式传入同一个 Crossbar 地址;可用 CROSSBAR_URL 覆盖。
const CROSSBAR_URL = process.env.CROSSBAR_URL ?? 'https://crossbar.switchboardlabs.xyz';

export async function storePrice(price: number): Promise<Buffer> {
  if (!Number.isFinite(price) || price <= 0) throw new Error(`无效价格：${price}`);
  // 来源: usdx-solana/scripts/src/switchboard-feeds.ts；v2 存的定义在 crank 的 v1 fetch 路径会 400。
  const crossbar = new LegacyCrossbarClient(CROSSBAR_URL);
  const jobs = [OracleJob.create({ tasks: [{ valueTask: { value: price } }] })];
  const stored = await crossbar.store(SWITCHBOARD_QUEUE, jobs);
  const hash = String(stored.feedHash ?? '').replace(/^0x/, '');
  if (!/^[a-fA-F0-9]{64}$/.test(hash)) throw new Error('Crossbar v1 没返回 32 字节 feedHash');
  const verified = await crossbar.fetch(hash);
  if (!verified.jobs?.length) throw new Error(`Crossbar v1 无法取回任务定义：${hash}`);
  return Buffer.from(hash, 'hex');
}

async function feedData(ctx: Context, address: PublicKey) {
  const account = await ctx.provider.connection.getAccountInfo(address, 'confirmed');
  if (!account || account.owner.toBase58() !== SWITCHBOARD_PROGRAM)
    throw new Error(`feed 不存在或 owner 不是 devnet On-Demand：${address.toBase58()}`);
  const { sb, program } = await switchboardClient(ctx);
  const data = await new sb.PullFeed(program, address.toBase58()).loadData();
  if (data.queue.toBase58() !== SWITCHBOARD_QUEUE) throw new Error('feed 使用了错误的队列');
  return data;
}

// #region ep3-feed
export async function createOrUpdateFeed(ctx: Context, token: Token, price: number) {
  const manifestPath = resolve('scenario/out/feeds.json');
  const manifest: Partial<Record<Token, string>> = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  const hash = await storePrice(price);
  const { sb, program, queue } = await switchboardClient(ctx);
  let address: PublicKey;
  if (manifest[token]) {
    address = new PublicKey(manifest[token]!);
    const data = await feedData(ctx, address);
    if (data.authority.toBase58() !== ctx.admin.publicKey.toBase58()) throw new Error(`${token} feed authority 不是 admin`);
    ctx.feeds[token] = address;
    if (!Buffer.from(data.feedHash).equals(hash)) await repointFeedHash(ctx, token, hash);
  } else {
    // 按任务指定的 PullFeed.generate 创建；SDK feed 随机，只有公钥落盘，密钥不落盘。
    const [feed, externalKeypair] = sb.PullFeed.generate(program);
    address = new PublicKey(externalKeypair.publicKey.toBase58());
    ctx.feeds[token] = address;
    ctx.record.addresses.feeds[token] = address.toBase58();
    writeJson(ctx.outputPath, ctx.record);
    const ix = await feed.initIx({ name: `M1 ${token}`, queue: queue.pubkey, feedHash: hash,
      maxVariance: 1, minResponses: 1, minSampleSize: 1, maxStaleness: 150 });
    await send(ctx, `create feed ${token}`, [rebuildInstruction(ix)],
      [Keypair.fromSecretKey(Uint8Array.from(externalKeypair.secretKey))]);
    manifest[token] = address.toBase58();
    writeJson(manifestPath, manifest);
  }
  ctx.record.addresses.feeds[token] = address.toBase58();
  writeJson(ctx.outputPath, ctx.record);
  await crank(ctx, token, price);
}
// #endregion

async function onChainGateways(ctx: Context): Promise<string[]> {
  const { sb, program, queue } = await switchboardClient(ctx);
  const data = await queue.loadData();
  const keys = data.oracleKeys.slice(0, data.oracleKeysLen);
  const oracles = await sb.Oracle.loadMany(program, keys);
  const urls = oracles.map((o: { gatewayUri: Uint8Array } | null) => o && Buffer.from(o.gatewayUri).toString().replace(/\0+$/, ''))
    .filter((u: string | null): u is string => !!u);
  if (!urls.length) throw new Error('链上队列没有登记任何 gateway');
  return [...new Set(urls)];
}

// #region ep3-crank
export async function crank(ctx: Context, token: Token, expectedPrice?: number) {
  const address = ctx.feeds[token];
  if (!address) throw new Error(`缺少 ${token} feed`);
  await feedData(ctx, address);
  const { sb, program, wallet } = await switchboardClient(ctx);
  const feed = new sb.PullFeed(program, address.toBase58());
  // 第一个返回值是数组。单签名给独立 crank 交易留足字节，教学环境接受单 oracle 样本。
  // Crossbar 的 /gateways?network=devnet 现在返回空数组(2026-10-11 实测)，SDK 因此报
  // "No gateways available"；改为直接读链上队列里 oracle 登记的 gateway 地址，逐个尝试。
  const errors: string[] = [];
  let result: Awaited<ReturnType<typeof feed.fetchUpdateIx>> | undefined;
  for (const gateway of await onChainGateways(ctx)) {
    // 这个 SDK 版本的 fetchUpdateIx 没有 gateway 参数，只能让 CrossbarClient 返回我们选的 gateway。
    const crossbarClient = new CrossbarClient(CROSSBAR_URL);
    crossbarClient.fetchGateways = async () => [gateway];
    try {
      result = await feed.fetchUpdateIx({ payer: wallet.publicKey, numSignatures: 1, crossbarClient });
      if (result[0]?.length && result[2]) break;
    } catch (error) { errors.push(`${gateway}: ${String(error).slice(0, 120)}`); }
  }
  if (!result) throw new Error(`${token} 所有链上 gateway 都失败：${errors.join(' | ')}`);
  const [ixs, responses, successes, , failures] = result;
  if (!ixs?.length || !successes) throw new Error(`${token} crank 无成功响应：${failures.join('; ')}`);
  await send(ctx, `crank ${token}`, ixs.map(rebuildInstruction), [], true);
  const data = await feedData(ctx, address);
  const price = Number(data.result.value.toString()) / 1e18;
  const age = Math.floor(Date.now() / 1000) - Number(data.lastUpdateTimestamp.toString());
  if (data.result.slot.isZero() || !Number.isFinite(price) || price <= 0 || age > 240 || age < -30)
    throw new Error(`${token} crank 后价格无效或过期：price=${price}, age=${age}`);
  if (expectedPrice !== undefined && Math.abs(price - expectedPrice) > 1e-6)
    throw new Error(`${token} crank 后价格 ${price} 不等于计划价格 ${expectedPrice}`);
  console.log(`  ${token}: $${price}, sampleSize=${data.sampleSize}, responses=${responses.length}`);
}
// #endregion

// #region ep3-reprice
export async function repointFeedHash(ctx: Context, token: Token, hash: Buffer) {
  // 改价路径尚未在链上验证。复用账户地址，Bank 不变；store → setConfigs → crank。
  const address = ctx.feeds[token];
  if (!address) throw new Error(`缺少 ${token} feed`);
  const { sb, program } = await switchboardClient(ctx);
  const ix = await new sb.PullFeed(program, address.toBase58()).setConfigsIx({ feedHash: hash });
  await send(ctx, `repoint feed ${token}`, [rebuildInstruction(ix)]);
  const data = await feedData(ctx, address);
  if (!Buffer.from(data.feedHash).equals(hash)) throw new Error(`${token} 重指向后 feedHash 不一致`);
}
export async function changePrice(ctx: Context, token: Token, price: number) {
  const hash = await storePrice(price);
  await repointFeedHash(ctx, token, hash);
  await crank(ctx, token, price);
}
// #endregion
