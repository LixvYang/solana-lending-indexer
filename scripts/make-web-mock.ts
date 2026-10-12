/**
 * 为前端开发预览生成一笔真实交易的 X 光数据(web/src/mock-xray.json)。
 * 只用 fixtures 和已有解码器，不连网络、不连数据库。真正的数据来自 /api/tx/:signature。
 */
import { writeFileSync } from 'node:fs';
import fixture from '../fixtures/m1-transactions.json';
import run from '../fixtures/m1-run.json';
import { decodeTransaction } from '../src/decoder/transaction';
import { decodeEvents } from '../src/decoder/event';
import { decodeBase58 } from '../src/core/base58';
import { marginfiIdl } from '../src/decoder/idl';
import type { RawTransaction } from '../src/ingest/rpc';

const out: Record<string, unknown> = {};
for (const label of ['bob borrow 5000 tUSDC', 'carol liquidate bob 10 tSOL']) {
  const signature = run.steps.find((s) => s.label === label)!.signatures[0];
  const tx = (fixture.transactions as Record<string, RawTransaction>)[signature];
  const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)));
  const instructions = decodeTransaction(tx, marginfiIdl).map((d) => {
    const raw = tx.transaction.message.instructions[d.ixIndex];
    const data = decodeBase58(raw.data);
    const args = 'args' in d ? json(d.args) as Record<string, string> : {};
    // 8 字节 discriminator + 每个顶层参数一段(这里两条指令都只有一个 u64 参数)
    const spans = [{ offset: 0, length: 8, label: 'discriminator', hex: data.subarray(0, 8).toString('hex'), value: d.name },
      ...Object.entries(args).map(([k, v], i) => ({ offset: 8 + i * 8, length: 8, label: k, hex: data.subarray(8 + i * 8, 16 + i * 8).toString('hex'), value: v }))];
    return { ix_index: d.ixIndex, inner_index: null, program: marginfiIdl.address, name: d.name, data_base58: raw.data, data_hex: data.toString('hex'),
      spans, args, accounts: 'accounts' in d ? d.accounts : {}, remaining: 'remaining' in d ? d.remaining : [], decode_error: null };
  });
  const events = decodeEvents(tx, marginfiIdl).events.map((e) => ({ log_index: e.logIndex, ix_index: e.ixIndex, name: e.name,
    base64: '(日志里的 base64 原文，由真实 API 提供)', data: json(e.data) }));
  out[signature] = { signature, slot: String(tx.slot), block_time: new Date(tx.blockTime! * 1000).toISOString(), err: null,
    logs: tx.meta!.logMessages, instructions, events,
    rows: { instructions: instructions.map((i) => ({ signature, ix_index: i.ix_index, inner_index: -1, name: i.name, args: i.args })),
      events: events.map((e) => ({ signature, log_index: e.log_index, ix_index: e.ix_index, name: e.name })) } };
}
writeFileSync('web/src/mock-xray.json', JSON.stringify(out));
console.log('xray mock:', Object.keys(out).length, '笔');
