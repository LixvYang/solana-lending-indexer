/** INPUT: 合成 mint/权限与按程序方式补齐的元数据账户。 OUTPUT: 指令字节布局、账户顺序、长度上限与解码断言。 POSITION: 离线测试。 SYNC: folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey } from '@solana/web3.js';
import { createMetadataIx, decodeMetadata, metadataPda, TOKEN_METADATA, updateMetadataIx } from './metaplex';

const mint = Keypair.generate().publicKey, admin = Keypair.generate().publicKey;
const info = { name: '测试 USDC', symbol: 'tUSDC', uri: 'https://example.com/t.json' };
const str = (s: string) => { const b = Buffer.from(s); const n = Buffer.alloc(4); n.writeUInt32LE(b.length); return Buffer.concat([n, b]); };

test('CreateMetadataAccountV3:判别字节 33、DataV2(UTF-8 字符串带 u32 长度)、三个 None、is_mutable、collection_details None', () => {
  const ix = createMetadataIx(mint, admin, info);
  assert.ok(ix.programId.equals(TOKEN_METADATA));
  assert.deepEqual(ix.data, Buffer.concat([Buffer.from([33]), str(info.name), str(info.symbol), str(info.uri), Buffer.from([0, 0, 0, 0, 0, 1, 0])]));
  assert.equal(Buffer.from(info.name).length, 11); // 中文按 UTF-8 计字节,每个汉字 3 字节
  assert.deepEqual(ix.keys.map(k => [k.pubkey.toBase58(), k.isSigner, k.isWritable]).slice(0, 5), [
    [metadataPda(mint).toBase58(), false, true], [mint.toBase58(), false, false],
    [admin.toBase58(), true, false], [admin.toBase58(), true, true], [admin.toBase58(), true, false]]);
});

test('UpdateMetadataAccountV2:判别字节 15、Some(DataV2),其余三个可选参数都是 None;只需 update authority 签名', () => {
  const ix = updateMetadataIx(mint, admin, info);
  assert.deepEqual(ix.data, Buffer.concat([Buffer.from([15, 1]), str(info.name), str(info.symbol), str(info.uri), Buffer.from([0, 0, 0, 0, 0, 0, 0, 0])]));
  assert.deepEqual(ix.keys.map(k => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), [[metadataPda(mint).toBase58(), false, true], [admin.toBase58(), true, false]]);
});

test('超出程序上限的字段在本地就拒绝:名称 32 字节、符号 10 字节、URI 200 字节', () => {
  assert.throws(() => createMetadataIx(mint, admin, { ...info, name: '一二三四五六七八九十十一' }), /name/); // 33 字节
  assert.throws(() => createMetadataIx(mint, admin, { ...info, symbol: 'ABCDEFGHIJK' }), /symbol/);
  assert.throws(() => updateMetadataIx(mint, admin, { ...info, uri: `https://x/${'a'.repeat(200)}` }), /uri/);
});

test('解码元数据账户:字符串在账户里按固定长度用 \\0 补齐,读出时去掉补齐', () => {
  const padded = (s: string, n: number) => { const b = Buffer.alloc(n); Buffer.from(s).copy(b); const l = Buffer.alloc(4); l.writeUInt32LE(n); return Buffer.concat([l, b]); };
  const account = Buffer.concat([Buffer.from([4]), admin.toBuffer(), mint.toBuffer(), padded(info.name, 32), padded(info.symbol, 10), padded(info.uri, 200), Buffer.alloc(100)]);
  assert.deepEqual(decodeMetadata(account), { updateAuthority: admin.toBase58(), mint: mint.toBase58(), ...info });
  assert.throws(() => decodeMetadata(Buffer.alloc(400)), /MetadataV1/);
  assert.ok(PublicKey.isOnCurve(metadataPda(mint).toBytes()) === false); // PDA 不在曲线上
});
