import assert from 'node:assert/strict';
import { test } from 'node:test';
import anchor from '@coral-xyz/anchor';
import { ComputeBudgetProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { initFeeState, initGroup, initAccount, addBank, configureOracle, lending, liquidate, accrue } from './marginfi';
import { offlineContext } from './test-context';
import { fixedBits } from './state';

test('真实 mrgn-0.1.0 IDL 能离线构造所有剧本指令，业务交易均小于 1232 字节', async () => {
  const ctx = offlineContext();
  const coder = new anchor.BorshInstructionCoder(ctx.program.idl);
  const instructions = await Promise.all([
    initFeeState(ctx), initGroup(ctx), initAccount(ctx, 'bob'), addBank(ctx, 'tUSDC'), addBank(ctx, 'tSOL'),
    configureOracle(ctx, 'tUSDC'), lending(ctx, 'deposit', 'alice', 'tUSDC', 10_000_000_000n),
    lending(ctx, 'deposit', 'bob', 'tSOL', 100_000_000_000n),
    lending(ctx, 'borrow', 'bob', 'tUSDC', 5_000_000_000n, ['tSOL', 'tUSDC']),
    lending(ctx, 'repay', 'bob', 'tUSDC', 0n, [], true),
    lending(ctx, 'withdraw', 'alice', 'tUSDC', 1_000_000_000n, ['tUSDC']), liquidate(ctx), accrue(ctx, 'tUSDC'),
  ]);
  for (const ix of instructions) {
    assert.ok(ix.programId.equals(ctx.program.programId));
    assert.ok(coder.decode(ix.data));
    const message = new TransactionMessage({ payerKey: ctx.admin.publicKey,
      recentBlockhash: '11111111111111111111111111111111', instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ix],
    }).compileToV0Message();
    assert.ok(new VersionedTransaction(message).serialize().length <= 1232);
  }
  const decoded = coder.decode(instructions[4].data)!;
  assert.equal((decoded.data as any).bankConfig.oracleMaxAge, 240);
  const assetConfig = (decoded.data as any).bankConfig;
  const debtConfig = (coder.decode(instructions[3].data)!.data as any).bankConfig;
  const initial = 100n * 100n * fixedBits(assetConfig.assetWeightInit)
    - 5000n * fixedBits(debtConfig.liabilityWeightInit);
  const maintenance = 100n * 50n * fixedBits(assetConfig.assetWeightMaint)
    - 5000n * fixedBits(debtConfig.liabilityWeightMaint);
  assert.ok(initial > 0n, '初始价格应允许借款');
  assert.ok(maintenance < 0n, '降价后应触发清算');
  assert.equal((coder.decode(instructions[5].data)!.data as any).setup, 4);
  assert.equal((coder.decode(instructions[9].data)!.data as any).repayAll, true);
});

test('借款和清算的 observation 严格匹配新增余额槽位顺序', async () => {
  const ctx = offlineContext();
  const coder = new anchor.BorshInstructionCoder(ctx.program.idl);
  const usdc = ctx.actors.banks.tUSDC.publicKey.toBase58(), sol = ctx.actors.banks.tSOL.publicKey.toBase58();
  const usdcFeed = ctx.feeds.tUSDC!.toBase58(), solFeed = ctx.feeds.tSOL!.toBase58();
  const borrow = await lending(ctx, 'borrow', 'bob', 'tUSDC', 5_000_000_000n, ['tSOL', 'tUSDC']);
  assert.deepEqual(borrow.keys.slice(-4).map(key => key.pubkey.toBase58()), [sol, solFeed, usdc, usdcFeed]);
  const liquidation = await liquidate(ctx);
  assert.deepEqual(liquidation.keys.slice(-10).map(key => key.pubkey.toBase58()),
    [solFeed, usdcFeed, usdc, usdcFeed, sol, solFeed, sol, solFeed, usdc, usdcFeed]);
  assert.equal((coder.decode(liquidation.data)!.data as any).assetAmount.toString(), '10000000000');
});
