import type { Context } from '../lib/context';
import { createOrUpdateFeed } from '../lib/price';

export async function step(ctx: Context): Promise<void> {
  await createOrUpdateFeed(ctx, 'tUSDC', 1);
  await createOrUpdateFeed(ctx, 'tSOL', 100);
}
