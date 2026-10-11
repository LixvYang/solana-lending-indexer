import type { AnchorProvider, Program } from '@coral-xyz/anchor';
import { Keypair, PublicKey } from '@solana/web3.js';
import type { Actors } from './actors';
import type { RunRecord } from './record';

export interface Context {
  provider: AnchorProvider; program: Program; admin: Keypair; actors: Actors;
  feeds: Partial<Record<'tUSDC' | 'tSOL', PublicKey>>;
  feeState: PublicKey; globalFeeWallet: PublicKey;
  record: RunRecord; outputPath: string; timestamp: string; step: number;
}
export type Step = (ctx: Context) => Promise<void>;
