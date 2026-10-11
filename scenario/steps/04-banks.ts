import { tokens } from '../lib/actors';
import type { Context } from '../lib/context';
import { addBank, configureOracle } from '../lib/marginfi';
import { send } from '../lib/rpc';

export async function step(ctx: Context): Promise<void> {
  for (const token of tokens) {
    await send(ctx, `add bank ${token}`, [await addBank(ctx, token)], [ctx.actors.banks[token]]);
    await send(ctx, `configure oracle ${token}`, [await configureOracle(ctx, token)]);
  }
}
