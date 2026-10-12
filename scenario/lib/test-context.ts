import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import anchor, { type Idl } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import { createActors, deriveKeypair } from './actors';
import type { Context } from './context';

export function offlineContext(): Context {
  const actors = createActors();
  const admin = deriveKeypair('offline-test/admin');
  const provider = new anchor.AnchorProvider(new Connection('http://127.0.0.1:8899', {
    fetch: async () => { throw new Error('离线构造不得访问 RPC'); },
  }), new anchor.Wallet(admin), {});
  const idl = JSON.parse(readFileSync(resolve('src/decoder/idl/marginfi.idl.json'), 'utf8')) as Idl;
  const program = new anchor.Program(idl, provider);
  return { provider, program, actors, admin, step: 0, timestamp: 'test', outputPath: '',
    globalFeeWallet: admin.publicKey,
    feeState: PublicKey.findProgramAddressSync([Buffer.from('feestate')], program.programId)[0],
    feeds: { tUSDC: deriveKeypair('offline-test/feed-usdc').publicKey,
      tSOL: deriveKeypair('offline-test/feed-sol').publicKey },
    record: { startedAt: 'test', runId: '', status: 'running', steps: [], events: [], transactions: {},
      addresses: { group: '', banks: {}, feeds: {}, mints: {}, marginfiAccounts: {}, actors: {} } },
  };
}

