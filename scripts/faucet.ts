/** INPUT: FAUCET_KEYPAIR/RPC_URL/FAUCET_PORT、Db 池子。 OUTPUT: 独立水龙头 8788。 POSITION: EP8 仅持有专用钱包。 SYNC: folder.md。 */
import 'dotenv/config';
import { pgDb } from '../src/store/db';
import { getPool } from '../src/api/queries';
import { portNumber } from '../src/api/server';
import { faucetGrants, dailyLimit } from '../src/faucet/config';
import { createFaucet } from '../src/faucet/service';
import { createFaucetServer } from '../src/faucet/server';
import { readKeypair, cliRpc } from './admin-runtime';
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') { console.log('用法: faucet (FAUCET_PORT 默认 8788)'); return; }
  if (args.length) throw Error('invalid arguments');
  // 从不读取 ANCHOR_WALLET；这个钱包没有 group admin/mint authority 权限。
  const payer = readKeypair(process.env.FAUCET_KEYPAIR), rpc = cliRpc(), db = pgDb();
  let grants;
  try { grants = faucetGrants((await getPool(db)).banks); } finally { await db.close(); }
  const server = createFaucetServer(createFaucet(payer, rpc, grants, dailyLimit(process.env.FAUCET_DAILY_MAX)));
  server.on('error', () => { console.error('faucet server failed'); process.exitCode = 1; });
  server.listen(portNumber(process.env.FAUCET_PORT ?? '8788'), '127.0.0.1', () => console.log('faucet listening'));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close());
}
void main().catch(() => { console.error('faucet startup failed; check configuration'); process.exitCode = 1; });
