import { tokens } from '../lib/actors';
import type { Context } from '../lib/context';
import { accrue } from '../lib/marginfi';
import { send } from '../lib/rpc';

export async function step(ctx: Context): Promise<void> {
  for (const token of tokens) await send(ctx, `accrue interest ${token}`, [await accrue(ctx, token)]);
}
