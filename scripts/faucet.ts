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
  // 兑换台:SOL / tSOL / tUSDC 任意两两互换,汇率由统一的 USD 单价推导(三者自洽)。
  // 默认 SOL = $50、tSOL = $50、tUSDC = $1,与池子里 tSOL = $50 一致;这是 mock 汇率,不是市场价。
  const price = (name: string, fallback: string) => nativeAmount(process.env[name] ?? fallback, 6); // USD × 1e6
  const token = (label: 'tSOL' | 'tUSDC', usd: bigint) => {
    const bank = banks.find(b => b.label === label)!;
    return { symbol: label, decimals: bank.decimals, mint: new PublicKey(bank.mint), usdMicro: usd };
  };
  const swap = createSwap(payer, rpc, {
    assets: [{ symbol: 'SOL', decimals: 9, usdMicro: price('SWAP_SOL_USD', '50') }, token('tSOL', price('SWAP_TSOL_USD', '50')), token('tUSDC', price('SWAP_TUSDC_USD', '1'))],
    minUsdMicro: price('SWAP_MIN_USD', '0.05'), maxUsdMicro: price('SWAP_MAX_USD', '100') });
  const server = createFaucetServer(createFaucet(payer, rpc, grants, dailyLimit(process.env.FAUCET_DAILY_MAX)), swap);
  server.on('error', () => { console.error('faucet server failed'); process.exitCode = 1; });
  server.listen(portNumber(process.env.FAUCET_PORT ?? '8788'), '127.0.0.1', () => console.log('faucet listening'));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close());
}
void main().catch(() => { console.error('faucet startup failed; check configuration'); process.exitCode = 1; });
