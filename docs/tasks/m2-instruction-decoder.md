# 任务 M2:指令解码器(src/decoder/instruction.ts)

交给 codex 实现。先读 `AGENTS.md`、`docs/00-goals.md`、`docs/decisions.md`、`docs/chapters/ep04-instructions.md`。

## 目标

把一笔交易里属于 marginfi 的指令,还原成"谁调用了什么、传了什么参数、每个账户扮演什么角色"。这是 EP4 的核心,也是整个合集最想让观众看清**字节是怎么被切开的**的部分,所以**手写**,不要在 `src/` 里依赖 Anchor 的 coder。

## 输入

`fixtures/m1-transactions.json`:32 笔真实 devnet 交易,格式是 RPC 原始 JSON(`getTransaction`,`encoding: "json"`):

- `transaction.message.accountKeys`(静态账户)、`instructions[]`(`programIdIndex`、`accounts`(下标数组)、`data`(**base58 字符串**))
- `meta.innerInstructions[]`:`{ index, instructions: [{ programIdIndex, accounts, data, stackHeight }] }`
- `meta.loadedAddresses`:`{ writable, readonly }`。v0 交易的完整账户表 = `accountKeys` + `loadedAddresses.writable` + `loadedAddresses.readonly`(顺序不能错)。fixture 里这两个是空的,**但代码必须处理非空**,用合成数据测试。
- IDL:`src/decoder/idl/marginfi.idl.json`(Anchor 0.30 格式,36 个指令)。程序地址取 IDL 的 `address`。

解码器要吃的就是这种线上格式,不要先转成 web3.js 的对象。

## 要实现

文件(每个一个概念,单文件尽量不超过约 150 行,注释讲"这几个字节是什么、为什么"):

| 文件 | 内容 |
|---|---|
| `src/core/base58.ts` | 手写 base58 编码/解码(不新增依赖) |
| `src/core/reader.ts` | 字节读取器:u8/u16/u32/u64/i64/u128/i128(返回 bigint)、bool、pubkey(32 字节转 base58)、bytes、string(u32 长度前缀) |
| `src/decoder/discriminator.ts` | `sha256("global:<snake_case 指令名>")` 前 8 字节;以及用 IDL 里写好的 `discriminator` 交叉校验 |
| `src/decoder/idl.ts` | IDL 的类型定义(只写用到的字段)与加载 |
| `src/decoder/borsh.ts` | **由 IDL 驱动**的参数解码:bool、u8–u128、i8–i128、pubkey、string、bytes、option、vec、array、defined(struct / enum,含元组形态)。先看 IDL 里实际出现了哪些类型再实现,不要凭记忆 |
| `src/decoder/instruction.ts` | 单条指令解码:`decodeInstruction(ix, accountKeys, idl)` → `{ name, args, accounts: { <IDL 账户名>: 地址 }, remaining: 地址[] }`。IDL 账户可能嵌套分组,要展平并保持顺序;超出 IDL 声明数量的账户放 `remaining` |
| `src/decoder/transaction.ts` | `decodeTransaction(rpcTx, idl)` → 该交易里所有 marginfi 指令的列表,每条带 `signature`、`ixIndex`、`innerIndex`(顶层为 `null`)、`stackHeight`;**顶层与 inner instruction 都要处理**;非 marginfi 的指令跳过 |
| `scripts/decode-tx.ts` | 命令行:`pnpm exec tsx scripts/decode-tx.ts <签名>` 从 `fixtures/m1-transactions.json` 取交易并打印解码结果(JSON,bigint 转字符串)。视频演示用 |

输出要求:
- 数值用 `bigint`,序列化给人看时转字符串;pubkey 一律 base58 字符串;`WrappedI80F48`(`{ value: [16 个 u8] }`)原样保留字节,**不要**转成小数(那是 EP5 的话题)。
- **未知 discriminator 不抛错**:返回 `{ name: 'unknown', discriminator: <16 位十六进制>, data: <原始 base64> }`。
- **数据不够/越界**:不抛错,返回 `{ name: <已识别的指令名>, decodeError: '<原因>' }`,并保留原始数据。写入失败不能让整笔交易的解码中断。
- 不依赖网络,所有函数是纯函数。

## 测试(`node:test`,放在对应文件旁,`pnpm test` 自动发现)

用 `fixtures/m1-transactions.json`,**离线**:

1. IDL 里全部 36 个指令的 `discriminator` 与我们自己算的 `sha256("global:<name>")` 前 8 字节一致。
2. **与 Anchor 交叉校验**(只在测试里用 `@coral-xyz/anchor` 的 `BorshCoder`):fixture 里每一条 marginfi 指令,我们解出的 `name` 与参数,和 `BorshCoder.instruction.decode` 的结果一致(把 BN 转成 bigint/字符串后再比较)。
3. 金标准:对 fixture 里每个步骤(见 `fixtures/m1-run.json` 的 `steps[].label`),手写期望的指令名列表并断言,覆盖 deposit / borrow / repay / withdraw / liquidate / accrue / 创建 group、bank、账户。期望值要对照 `m1-run.json` 的事件核对,**不要**复制解码器的输出当期望。
4. 账户角色:抽查 borrow 与 liquidate 各一条,断言 `marginfiAccount`、`bank`、`signer` 等具体账户名对应的地址与 `m1-run.json` 的 `addresses` 一致;liquidate 的 `remaining` 数量与顺序要有断言。
5. 合成数据:v0 交易 `loadedAddresses` 非空时账户表拼接顺序正确(手造一个最小交易);未知 discriminator;data 被截断。
6. inner instruction:构造一个 marginfi 指令出现在 `innerInstructions` 里的合成交易,断言 `innerIndex` 与 `stackHeight`。

## 代码要求

- 教学片段用 `// #region ep4-xxx` / `// #endregion`(至少:`ep4-discriminator`、`ep4-reader`、`ep4-decode-args`、`ep4-account-names`、`ep4-flatten`)。
- 不新增依赖,不联网。`pnpm typecheck` 与 `pnpm test` 必须通过。
- 完成后更新 `docs/progress.md` 的 M2 一行,并如实写出**没有被验证的部分**。
- 不要提交 git。
