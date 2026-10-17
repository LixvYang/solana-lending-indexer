/** INPUT: mint、名称/符号/URI、权限地址。 OUTPUT: Metaplex 元数据 PDA、创建/更新指令、元数据账户解码。 POSITION: 测试币链上元数据(钱包显示名称与图标),手写 Borsh,不引入 SDK。SYNC: folder.md。 */
import { PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram, TransactionInstruction } from '@solana/web3.js';

export const TOKEN_METADATA = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
/** 账户里字符串按固定长度用 \0 补齐(mpl-token-metadata MAX_NAME_LENGTH / MAX_SYMBOL_LENGTH / MAX_URI_LENGTH)。 */
export const MAX = { name: 32, symbol: 10, uri: 200 } as const;
export interface TokenInfo { name: string; symbol: string; uri: string }

export const metadataPda = (mint: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from('metadata'), TOKEN_METADATA.toBuffer(), mint.toBuffer()], TOKEN_METADATA)[0];

const str = (s: string) => { const b = Buffer.from(s, 'utf8'), n = Buffer.alloc(4); n.writeUInt32LE(b.length); return Buffer.concat([n, b]); };

// #region ep8-metadata-encode
/**
 * DataV2 的 Borsh:name, symbol, uri(各为 u32 长度 + UTF-8),seller_fee_basis_points u16,
 * 再是 creators / collection / uses 三个 Option(都是 None = 一个 0 字节)。
 */
function dataV2(info: TokenInfo): Buffer {
  for (const k of ['name', 'symbol', 'uri'] as const)
    if (Buffer.byteLength(info[k]) > MAX[k]) throw new Error(`${k} 超过 ${MAX[k]} 字节`);
  return Buffer.concat([str(info.name), str(info.symbol), str(info.uri), Buffer.from([0, 0]), Buffer.from([0, 0, 0])]);
}

/** 指令 33 = CreateMetadataAccountV3:DataV2 + is_mutable(true,以后还能改)+ collection_details None。只有 mint authority 能为这个 mint 建元数据。 */
export function createMetadataIx(mint: PublicKey, authority: PublicKey, info: TokenInfo): TransactionInstruction {
  return new TransactionInstruction({ programId: TOKEN_METADATA, data: Buffer.concat([Buffer.from([33]), dataV2(info), Buffer.from([1, 0])]), keys: [
    { pubkey: metadataPda(mint), isSigner: false, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: authority, isSigner: true, isWritable: false }, { pubkey: authority, isSigner: true, isWritable: true }, // mint authority、payer
    { pubkey: authority, isSigner: true, isWritable: false }, // update authority
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }] });
}

/** 指令 15 = UpdateMetadataAccountV2:Some(DataV2),其余(新 update authority、primary_sale_happened、is_mutable)都不改 = None。 */
export function updateMetadataIx(mint: PublicKey, authority: PublicKey, info: TokenInfo): TransactionInstruction {
  return new TransactionInstruction({ programId: TOKEN_METADATA, data: Buffer.concat([Buffer.from([15, 1]), dataV2(info), Buffer.from([0, 0, 0])]), keys: [
    { pubkey: metadataPda(mint), isSigner: false, isWritable: true }, { pubkey: authority, isSigner: true, isWritable: false }] });
}
// #endregion

/** 元数据账户:key u8 | update_authority 32 | mint 32 | name | symbol | uri(带 \0 补齐的 Borsh 字符串)| … */
export function decodeMetadata(data: Uint8Array): TokenInfo & { updateAuthority: string; mint: string } {
  const b = Buffer.from(data);
  if (b[0] !== 4) throw new Error('not a MetadataV1 account');
  let o = 65;
  const read = () => { const n = b.readUInt32LE(o); const s = b.subarray(o + 4, o + 4 + n).toString('utf8').replace(/\0+$/, ''); o += 4 + n; return s; };
  const name = read(), symbol = read(), uri = read();
  return { updateAuthority: new PublicKey(b.subarray(1, 33)).toBase58(), mint: new PublicKey(b.subarray(33, 65)).toBase58(), name, symbol, uri };
}
