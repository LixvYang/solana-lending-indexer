import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import anchor, { type Idl } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { createActors, people, tokens } from './actors';
import { connect } from './rpc';
import type { Context } from './context';
import { writeJson, type RunRecord } from './record';
import { fetchAccount } from './state';

export async function createContext(runId: string): Promise<Context> {
  const root = resolve('.');
  const ids = JSON.parse(readFileSync(join(root, 'program/out/program-ids.json'), 'utf8'));
  const idl = JSON.parse(readFileSync(join(root, 'src/decoder/idl/marginfi.idl.json'), 'utf8')) as Idl;
  if (ids.mode !== 'devnet' || idl.address !== ids.marginfi || idl.metadata.version !== '0.1.0')
    throw new Error('需要 devnet 构建的 mrgn-0.1.0，且 IDL 与 program-ids 必须一致');
  const { provider, admin } = await connect();
  const program = new anchor.Program(idl, provider);
  const actors = createActors(runId);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const keys = <T extends string>(names: readonly T[], objects: Record<T, { publicKey: PublicKey }>) =>
    Object.fromEntries(names.map(name => [name, objects[name].publicKey.toBase58()]));
  const record: RunRecord = {
    startedAt: new Date().toISOString(), runId, status: 'running', steps: [], events: [], transactions: {},
    addresses: { group: actors.group.publicKey.toBase58(), banks: keys(tokens, actors.banks), feeds: {},
      mints: keys(tokens, actors.mints), marginfiAccounts: keys(people, actors.marginfiAccounts), actors: keys(people, actors) },
  };
  const ctx: Context = { provider, admin, program, actors, record, feeds: {}, timestamp, step: 0,
    outputPath: join(root, `scenario/out/run-${timestamp}.json`),
    feeState: PublicKey.findProgramAddressSync([Buffer.from('feestate')], program.programId)[0],
    globalFeeWallet: admin.publicKey };
  writeJson(ctx.outputPath, record);
  return ctx;
}

export async function preflight(ctx: Context) {
  const connection = ctx.provider.connection;
  const deployed = await connection.getAccountInfo(ctx.program.programId);
  if (!deployed?.executable) throw new Error('marginfi 尚未部署为可执行程序');
  const addresses = [ctx.actors.group, ...Object.values(ctx.actors.banks), ...Object.values(ctx.actors.marginfiAccounts)];
  for (const key of addresses) {
    if (await connection.getAccountInfo(key.publicKey))
      throw new Error(`剧本账户已存在：${key.publicKey}；用新的 --run-id 重放，不在旧 group 重复存借`);
  }
  let fee = 0;
  if (await connection.getAccountInfo(ctx.feeState)) {
    const state = await fetchAccount(ctx, 'feeState', ctx.feeState);
    ctx.globalFeeWallet = state.globalFeeWallet;
    fee = state.bankInitFlatSolFee * 2;
  }
  const balance = await connection.getBalance(ctx.admin.publicKey);
  if (balance < 300_000_000 + fee) throw new Error(`admin SOL 不足：需至少估算预算 0.30 SOL + 两个 bank 费用 ${fee / 1e9} SOL`);
}
