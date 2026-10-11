import assert from 'node:assert/strict';
import { test } from 'node:test';
import anchor from '@coral-xyz/anchor';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { offlineContext } from './test-context';
import { jsonValue, parseEvents } from './record';

test('EventParser 解析真实 IDL 的 deposit，忽略其它程序的相同 Program data', () => {
  const ctx = offlineContext();
  const event = ctx.program.idl.events!.find(event => event.name === 'lendingAccountDepositEvent')!;
  const quantity = Buffer.alloc(8); quantity.writeBigUInt64LE(10_000_000_000n);
  const bytes = Buffer.concat([Buffer.from(event.discriminator), Buffer.from([1]), ctx.actors.alice.publicKey.toBuffer(),
    ctx.actors.marginfiAccounts.alice.publicKey.toBuffer(), ctx.actors.alice.publicKey.toBuffer(),
    ctx.actors.group.publicKey.toBuffer(), ctx.actors.banks.tUSDC.publicKey.toBuffer(),
    ctx.actors.mints.tUSDC.publicKey.toBuffer(), quantity]);
  const programId = ctx.program.programId.toBase58();
  const events = parseEvents(ctx.program, 'offline-sample', [
    `Program ${programId} invoke [1]`, `Program ${TOKEN_PROGRAM_ID} invoke [2]`,
    `Program data: ${bytes.toString('base64')}`, `Program ${TOKEN_PROGRAM_ID} success`,
    `Program data: ${bytes.toString('base64')}`, `Program ${programId} success`,
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'LendingAccountDepositEvent');
  assert.equal(events[0].data.amount, '10000000000');
  assert.equal(events[0].data.header.marginfiAccount, ctx.actors.marginfiAccounts.alice.publicKey.toBase58());
});

test('JSON 保留 u64 的十进制精度并序列化公钥', () => {
  const ctx = offlineContext();
  assert.deepEqual(jsonValue({ amount: new anchor.BN('18446744073709551615'), bank: ctx.actors.banks.tSOL.publicKey }),
    { amount: '18446744073709551615', bank: ctx.actors.banks.tSOL.publicKey.toBase58() });
});
