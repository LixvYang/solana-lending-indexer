import type { Context } from '../lib/context';
import { lending } from '../lib/marginfi';
import { send } from '../lib/rpc';

export async function step(ctx: Context): Promise<void> {
  await send(ctx, 'bob deposit 100 tSOL', [await lending(ctx, 'deposit', 'bob', 'tSOL', 100_000_000_000n)],
    [ctx.actors.bob]);
}
