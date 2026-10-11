import type { Context } from '../lib/context';
import { lending } from '../lib/marginfi';
import { send } from '../lib/rpc';
import { crank } from '../lib/switchboard';

export async function step(ctx: Context): Promise<void> {
  const ix = await lending(ctx, 'borrow', 'bob', 'tUSDC', 5_000_000_000n, ['tSOL', 'tUSDC']);
  await crank(ctx, 'tSOL', 100);
  await crank(ctx, 'tUSDC', 1);
  await send(ctx, 'bob borrow 5000 tUSDC', [ix], [ctx.actors.bob]);
}
