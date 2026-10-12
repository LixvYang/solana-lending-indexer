/** INPUT: Db、RPC、公开钱包地址。 OUTPUT: WalletView。 POSITION: M7 钱包只读服务。 SYNC: folder.md。 */
import { getAssociatedTokenAddressSync, unpackAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import type { Db } from '../store/db';
import type { WalletView } from './types';
import type { WalletServices } from './wallet-rpc';
import { getPool } from './queries';
import { walletAccount } from './builder/state';
import { publicKey } from './wallet-input';
export async function tokenBalance(rpc: Pick<WalletServices['rpc'], 'getAccountInfo'>, mint: PublicKey, wallet: PublicKey): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(mint, wallet), info = await rpc.getAccountInfo(ata, 'confirmed');
  if (!info) return 0n;
  const account = unpackAccount(ata, info, TOKEN_PROGRAM_ID);
  if (!account.mint.equals(mint) || !account.owner.equals(wallet)) throw new Error('invalid token account');
  return account.amount;
}
export async function getWallet(db: Db, services: WalletServices, input: unknown): Promise<WalletView> {
  const wallet = publicKey(input), pool = await getPool(db);
  const lamports = await services.rpc.getBalance(wallet, 'confirmed');
  if (!Number.isSafeInteger(lamports) || lamports < 0) throw new Error('unsafe balance');
  const tokens = await Promise.all(pool.banks.map(async b => ({ bank: b.address, mint: b.mint, label: b.label,
    decimals: b.decimals, amount: String(await tokenBalance(services.rpc, new PublicKey(b.mint), wallet)) })));
  const user = pool.group ? await walletAccount(db, wallet.toBase58(), pool.group) : null;
  return { wallet: wallet.toBase58(), sol_lamports: String(lamports), tokens, marginfi_account: user?.address ?? null, faucet_url: services.faucetUrl ?? null };
}
