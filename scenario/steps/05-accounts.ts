import { people } from '../lib/actors';
import type { Context } from '../lib/context';
import { initAccount } from '../lib/marginfi';
import { send } from '../lib/rpc';

export async function step(ctx: Context): Promise<void> {
  for (const person of people) await send(ctx, `create marginfi account ${person}`,
    [await initAccount(ctx, person)], [ctx.actors[person], ctx.actors.marginfiAccounts[person]]);
}
