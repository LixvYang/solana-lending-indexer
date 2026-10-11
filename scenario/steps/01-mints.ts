import { getMint, MINT_SIZE, TOKEN_PROGRAM_ID, createInitializeMint2Instruction,
  createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction } from '@solana/spl-token';
import { SystemProgram } from '@solana/web3.js';
import { people, tokens } from '../lib/actors';
import type { Context } from '../lib/context';
import { tokenAccount } from '../lib/marginfi';
import { send } from '../lib/rpc';

export async function step(ctx: Context): Promise<void> {
  const connection = ctx.provider.connection;
  for (const person of people) {
    const balance = await connection.getBalance(ctx.actors[person].publicKey);
    if (balance < 20_000_000) await send(ctx, `fund ${person}`, [SystemProgram.transfer({
      fromPubkey: ctx.admin.publicKey, toPubkey: ctx.actors[person].publicKey, lamports: 20_000_000 - balance })]);
  }
  for (const token of tokens) {
    const mint = ctx.actors.mints[token];
    const decimals = token === 'tUSDC' ? 6 : 9;
    if (!await connection.getAccountInfo(mint.publicKey)) {
      const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
      await send(ctx, `create mint ${token}`, [SystemProgram.createAccount({ fromPubkey: ctx.admin.publicKey,
        newAccountPubkey: mint.publicKey, lamports: rent, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
      createInitializeMint2Instruction(mint.publicKey, decimals, ctx.admin.publicKey, null)], [mint]);
    } else {
      const existing = await getMint(connection, mint.publicKey);
      if (existing.decimals !== decimals || !existing.mintAuthority?.equals(ctx.admin.publicKey))
        throw new Error(`${token} mint 已存在，但精度或 mint authority 不匹配`);
    }
    for (const person of people) {
      const ata = tokenAccount(ctx, person, token);
      // Bob 留额外 USDC 支付剩余本金及利息；Carol 的清算资本来自存款，不是钱包直接划转。
      const amount = token === 'tUSDC' ? { alice: 12_000n, bob: 2_000n, carol: 7_000n }[person] * 1_000_000n
        : { alice: 1n, bob: 100n, carol: 1n }[person] * 1_000_000_000n;
      await send(ctx, `mint ${token} to ${person}`, [createAssociatedTokenAccountIdempotentInstruction(
        ctx.admin.publicKey, ata, ctx.actors[person].publicKey, mint.publicKey),
      createMintToInstruction(mint.publicKey, ata, ctx.admin.publicKey, amount)]);
    }
  }
}
