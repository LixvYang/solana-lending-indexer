import type { Context } from '../lib/context';
import { lending } from '../lib/marginfi';
import { send } from '../lib/rpc';
import { hasDebt } from '../lib/state';
import { crank } from '../lib/price';

export async function step(ctx: Context): Promise<void> {
  const withdraw = await lending(ctx, 'withdraw', 'alice', 'tUSDC', 1_000_000_000n, ['tUSDC']);
  await crank(ctx, 'tUSDC', 1);
  await send(ctx, 'alice withdraw 1000 tUSDC', [withdraw], [ctx.actors.alice]);
  if (await hasDebt(ctx, 'bob')) {
    // repay_all 由程序在本笔交易计息后算准确数量，避免客户端估算留下利息尾债。
    await send(ctx, 'bob repay all tUSDC', [await lending(ctx, 'repay', 'bob', 'tUSDC', 0n, [], true)], [ctx.actors.bob]);
  }
  if (await hasDebt(ctx, 'bob')) throw new Error('收尾后 Bob 仍有负债，剧本未完成');
}
