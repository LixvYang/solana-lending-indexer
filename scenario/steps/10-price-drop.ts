import type { Context } from '../lib/context';
import { changePrice } from '../lib/switchboard';

export async function step(ctx: Context): Promise<void> {
  await changePrice(ctx, 'tSOL', 50);
}
