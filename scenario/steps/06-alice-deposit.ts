import type { Context } from '../lib/context';
import { lending } from '../lib/marginfi';
import { send } from '../lib/rpc';

export async function step(ctx: Context): Promise<void> {
  await send(ctx, 'alice deposit 10000 tUSDC', [await lending(ctx, 'deposit', 'alice', 'tUSDC', 10_000_000_000n)],
    [ctx.actors.alice]);
}
