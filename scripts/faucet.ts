/** INPUT: FAUCET_KEYPAIR/RPC_URL/FAUCET_PORT、Db 池子。 OUTPUT: 独立水龙头 8788。 POSITION: EP8 仅持有专用钱包。 SYNC: folder.md。 */
import 'dotenv/config';
import { pgDb } from '../src/store/db';
import { getPool } from '../src/api/queries';
import { portNumber } from '../src/api/server';
import { faucetGrants, dailyLimit } from '../src/faucet/config';
import { createFaucet } from '../src/faucet/service';
import { createFaucetServer } from '../src/faucet/server';
import { createSwap } from '../src/faucet/swap';
import { nativeAmount } from '../src/faucet/config';
import { PublicKey } from '@solana/web3.js';
import { readKeypair, cliRpc } from './admin-runtime';
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') { console.log('用法: faucet (FAUCET_PORT 默认 8788)'); return; }
  if (args.length) throw Error('invalid arguments');
  // 从不读取 ANCHOR_WALLET；这个钱包没有 group admin/mint authority 权限。
  const payer = readKeypair(process.env.FAUCET_KEYPAIR), rpc = cliRpc(), db = pgDb();
  let grants, banks;
  try { banks = (await getPool(db)).banks; grants = faucetGrants(banks); } finally { await db.close(); }
  // SOL → 测试币的固定汇率(UI 单位/SOL)。默认 1 SOL = 1 tSOL = 50 tUSDC,与池子里 tSOL = $50 一致;这是 mock 汇率,不是市场价。
  const rate = (label: 'tSOL' | 'tUSDC') => {
    const bank = banks.find(b => b.label === label)!;
    return { label, mint: new PublicKey(bank.mint), decimals: bank.decimals,
      perSolNative: nativeAmount(process.env[`SWAP_${label.toUpperCase()}_PER_SOL`] ?? (label === 'tSOL' ? '1' : '50'), bank.decimals) };
  };
  const swap = createSwap(payer, rpc, { tokens: [rate('tSOL'), rate('tUSDC')],
    minLamports: nativeAmount(process.env.SWAP_MIN_SOL ?? '0.001', 9), maxLamports: nativeAmount(process.env.SWAP_MAX_SOL ?? '1', 9) });
  const server = createFaucetServer(createFaucet(payer, rpc, grants, dailyLimit(process.env.FAUCET_DAILY_MAX)), swap);
  server.on('error', () => { console.error('faucet server failed'); process.exitCode = 1; });
  server.listen(portNumber(process.env.FAUCET_PORT ?? '8788'), '127.0.0.1', () => console.log('faucet listening'));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close());
}
void main().catch(() => { console.error('faucet startup failed; check configuration'); process.exitCode = 1; });
