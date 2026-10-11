import type { Context } from '../lib/context';
import { lending, liquidate } from '../lib/marginfi';
import { send } from '../lib/rpc';
import { crank } from '../lib/switchboard';

export async function step(ctx: Context): Promise<void> {
  await send(ctx, 'carol deposit 6000 tUSDC', [await lending(ctx, 'deposit', 'carol', 'tUSDC', 6_000_000_000n)],
    [ctx.actors.carol]);
  // mrgn-0.1.0 会拒绝一次清算越过维持线；10 tSOL 改善健康度但仍低于维持线，步骤 12 再还清。
  const ix = await liquidate(ctx);
  await crank(ctx, 'tSOL', 50);
  await crank(ctx, 'tUSDC', 1);
  await send(ctx, 'carol liquidate bob 10 tSOL', [ix], [ctx.actors.carol]);
}
