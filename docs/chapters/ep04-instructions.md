# EP4 解析指令

## 本集要回答的问题

一笔交易里的一条指令,怎么还原成"谁调用了什么、传了什么参数、每个账户扮演什么角色"?

## 三个概念

**1. 指令数据 = 8 字节 discriminator + 参数。** 指令在 RPC 里的 `data` 是 base58 字符串,还原成字节后:

- 前 8 字节是**入口的身份证**:`sha256("global:<入口名>")` 的前 8 个字节(入口名用 snake_case,比如 `lending_account_borrow`)。
- 后面是参数,按 IDL 里声明的顺序,用 **Borsh** 编码:整数是小端,`bool` 一个字节,`option` 先有一个 0/1 标签,`vec` 和 `string` 先有 4 字节长度,`enum` 先有 1 字节的变体下标。

**2. 账户不在数据里,在账户列表里。** 指令的 `accounts` 只是下标,指向整笔交易的账户表。IDL 按顺序给每个位置起了名字(`bank`、`signer`……),下标对上名字,你才知道哪个地址扮演什么角色。多出 IDL 声明数量的账户叫 `remaining`——marginfi 用它传价格账户和 bank,供健康度检查。

**3. v0 交易的账户表要拼起来。** 完整账户表 = 静态账户 + 地址表里的可写账户 + 地址表里的只读账户,**顺序不能乱**。

## 代码走读

### discriminator

指令名怎么变成 8 字节:

<!-- snippet: src/decoder/discriminator.ts#ep4-discriminator -->
```ts
export function instructionDiscriminator(name: string): Buffer {
  // Anchor 哈希 Rust 的 snake_case 入口名；8 字节不是参数的一部分。
  const snakeCase = name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return createHash('sha256').update(`global:${snakeCase}`).digest().subarray(0, 8);
}

export function verifyDiscriminators(idl: Idl): void {
  for (const instruction of idl.instructions) {
    if (!instructionDiscriminator(instruction.name).equals(Buffer.from(instruction.discriminator))) {
      throw new Error(`IDL discriminator mismatch: ${instruction.name}`);
    }
  }
}
```
<!-- /snippet -->

我们拿它去和 IDL 里写好的 discriminator 对比,**36 个入口全部一致**。

### 字节读取器

整个解码器的地基——一个只会"从当前位置往后读 N 个字节"的小类:

<!-- snippet: src/core/reader.ts#ep4-reader -->
```ts
export class Reader {
  private offset = 0;
  private readonly data: Buffer;
  constructor(data: Uint8Array) { this.data = Buffer.from(data); }
  get remaining(): number { return this.data.length - this.offset; }

  bytes(length: number): Buffer {
    if (!Number.isSafeInteger(length) || length < 0) throw new Error(`invalid byte length: ${length}`);
    if (length > this.remaining) {
      throw new Error(`offset ${this.offset}: need ${length} bytes, only ${this.remaining} remain`);
    }
    const value = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  integer(width: number, signed = false): bigint {
    const bytes = this.bytes(width);
    let value = 0n;
    // Borsh 整数低位在前；有符号整数最高位为 1 时减去 2^位宽。
    for (let i = bytes.length - 1; i >= 0; i--) value = (value << 8n) | BigInt(bytes[i]);
    const bits = BigInt(width * 8);
    return signed && (value & (1n << (bits - 1n))) !== 0n ? value - (1n << bits) : value;
  }
  u8(): bigint { return this.integer(1); }
  u16(): bigint { return this.integer(2); }
  u32(): bigint { return this.integer(4); }
  u64(): bigint { return this.integer(8); }
  i64(): bigint { return this.integer(8, true); }
  u128(): bigint { return this.integer(16); }
  i128(): bigint { return this.integer(16, true); }
  bool(): boolean {
    const tag = this.u8();
    if (tag > 1n) throw new Error(`invalid bool tag: ${tag}`);
    return tag === 1n;
  }
  pubkey(): string { return encodeBase58(this.bytes(32)); }
  string(): string { return this.bytes(Number(this.u32())).toString('utf8'); }
}
```
<!-- /snippet -->

### 按 IDL 解码参数

不是每个指令写一个解码函数,而是**让 IDL 驱动**:遇到什么类型就读什么。

<!-- snippet: src/decoder/borsh.ts#ep4-decode-args -->
```ts
export function decodeType(type: IdlType, reader: Reader, idl: Idl): unknown {
  if (typeof type === 'string') {
    if (/^[ui](8|16|32|64|128)$/.test(type)) {
      return reader.integer(Number(type.slice(1)) / 8, type[0] === 'i');
    }
    switch (type) {
      case 'f32': return reader.bytes(4).readFloatLE();
      case 'f64': return reader.bytes(8).readDoubleLE();
      case 'bool': return reader.bool();
      case 'pubkey': return reader.pubkey();
      case 'string': return reader.string();
      case 'bytes': return [...reader.bytes(Number(reader.u32()))];
      default: throw new Error(`unsupported IDL type: ${type}`);
    }
  }
  if ('option' in type) {
    // option 的首字节为 0(None) 或 1(Some)，后者紧接内部类型。
    const tag = reader.u8();
    if (tag > 1n) throw new Error(`invalid option tag: ${tag}`);
    return tag === 0n ? null : decodeType(type.option, reader, idl);
  }
  if ('vec' in type || 'array' in type) {
    const [element, count] = 'vec' in type
      ? [type.vec, Number(reader.u32())] : type.array;
    const values: unknown[] = [];
    for (let i = 0; i < count; i++) values.push(decodeType(element, reader, idl));
    return values;
  }
  const definition = idl.types?.find(entry => entry.name === type.defined.name);
  if (!definition) throw new Error(`undefined IDL type: ${type.defined.name}`);
  if (definition.type.kind === 'struct') {
    const result = decodeFields(definition.type.fields, reader, idl);
    // WrappedI80F48 的 value 是原始 u8[16]，EP4 不解释它的定点小数含义。
    if (definition.name === 'WrappedI80F48' && Array.isArray(result.value)) {
      result.value = result.value.map(byte => Number(byte));
    }
    return result;
  }
  const tag = Number(reader.u8());
  const variant = definition.type.variants[tag];
  if (!variant) throw new Error(`invalid enum tag ${tag}: ${definition.name}`);
  return { [variant.name]: decodeFields(variant.fields, reader, idl) };
}
```
<!-- /snippet -->

### 账户角色

IDL 的账户可能是嵌套分组的。分组只用来组织名字,**不占位置**:

<!-- snippet: src/decoder/instruction.ts#ep4-account-names -->
```ts
export function accountNames(accounts: IdlAccount[]): string[] {
  // IDL 分组只组织名称，不占账户槽位；RPC accounts 下标按叶子声明顺序排列。
  return accounts.flatMap(account => account.accounts ? accountNames(account.accounts)
    : [account.name]);
}
function addressAt(keys: string[], index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= keys.length) {
    throw new Error(`account index out of bounds: ${index} (table length ${keys.length})`);
  }
  return keys[index];
}
```
<!-- /snippet -->

### 展开一笔交易

顶层指令和 inner instruction 都要处理,并记下位置(`ixIndex`、`innerIndex`):

<!-- snippet: src/decoder/transaction.ts#ep4-flatten -->
```ts
export function decodeTransaction(rpcTx: RpcTransaction, idl: Idl): TransactionInstruction[] {
  const { message, signatures } = rpcTx.transaction;
  // v0 的地址表下标接在静态账户之后：先可写，再只读，不能按地址重排或去重。
  const accountKeys = [...message.accountKeys, ...(rpcTx.meta?.loadedAddresses?.writable ?? []),
    ...(rpcTx.meta?.loadedAddresses?.readonly ?? [])];
  const result: TransactionInstruction[] = [];
  const append = (ix: RpcInstruction, ixIndex: number, innerIndex: number | null) => {
    if (accountKeys[ix.programIdIndex] !== idl.address) return;
    result.push({ ...decodeInstruction(ix, accountKeys, idl), signature: signatures[0],
      ixIndex, innerIndex, stackHeight: ix.stackHeight ?? null });
  };
  message.instructions.forEach((ix, ixIndex) => {
    append(ix, ixIndex, null);
    for (const inner of rpcTx.meta?.innerInstructions ?? []) {
      if (inner.index === ixIndex) inner.instructions.forEach((cpi, innerIndex) => append(cpi, ixIndex, innerIndex));
    }
  });
  return result;
}
```
<!-- /snippet -->

## 跑一遍

```bash
pnpm exec tsx scripts/decode-tx.ts 4FRUHaLGRdvAcV88XtTgCUGE76oAE1tKFqL5dEodxsmJhUgshUnEnkxKXEdn3q2r2XFRPTMihAfgsUQpuMhQivjt
```

输出(节选):

```json
{
  "name": "lending_account_borrow",
  "args": { "amount": "5000000000" },
  "accounts": { "marginfi_group": "GHVn8k…", "marginfi_account": "J3qhTb…", "signer": "…", "bank": "F99hSf…", … },
  "remaining": ["…", "…", "…", "…"],
  "ixIndex": 1, "innerIndex": null, "stackHeight": 1
}
```

`5000000000` 是 tUSDC 的**原生单位**(6 位小数),也就是 5000 个 tUSDC。

## 它是怎么被验证的

解码器是手写的,凭什么相信它?

1. **和 Anchor 的官方 coder 对照。** 32 笔真实交易里的 18 条 marginfi 指令,名称和参数逐条一致。(Anchor 只出现在测试里,解码器本身不依赖它。)
2. **往返测试。** 对 IDL 里 23 个带参数的指令,每个生成 20 组随机参数,用 Anchor **编码**,再用我们**解码**,逐字段比对。
3. **突变验证。** 故意把 option 标签取反、把枚举下标偏移,测试必须失败。
4. **每个步骤的预期指令是手写的**,并对照独立的事件记录核对,而不是复制解码器的输出。

## 常见坑

- **未知 discriminator 不要丢。** 程序升级后会出现不认识的指令,返回 `unknown` 加原始数据,别抛错。
- **数据被截断或账户越界,只让这一条指令失败**,同一笔交易里的其他指令照常解码。
- **`innerIndex` 是原始下标**,不是过滤掉别的程序之后重新编号的。
- **别把"计息事件"当成一条独立指令。** 存款、借款内部会顺手计息并发出事件,但链上并没有一条单独的计息指令。
- **账户名保持 IDL 的 snake_case。** 这样和 Rust 源码、IDL、以后的数据库列名一致。

## 下一集

EP5:指令告诉我们"调用了什么",但**结果**在哪里?解析事件,再解析账户状态。
