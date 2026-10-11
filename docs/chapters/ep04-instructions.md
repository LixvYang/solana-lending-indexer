# EP4 解析指令

状态：M2 代码与离线验收完成（2026-10-12）；视频分镜与录制尚未完成。

## 本章要回答的一个问题

一笔交易里的指令，如何还原成“谁调用了什么、传了什么参数、每个账户扮演什么角色”？

## 概念

1. RPC `encoding: "json"` 的指令 `data` 是 base58。还原字节后，前 8 字节是 `sha256("global:<snake_case 入口名>")` 的前缀；其后才是参数。
2. Borsh 按 IDL 字段顺序读取小端字节；option 有 0/1 标签，vec 和 string 有 u32 长度，enum 有 u8 变体下标。`WrappedI80F48.value` 保留 16 个原始字节，本章不换算小数。
3. `accounts` 存的是账户表下标。v0 完整表为静态账户 + loaded writable + loaded readonly；IDL 的叶子账户顺序给出角色，多出的地址进入 `remaining`。

本地核实依据：固定 IDL、32 笔 RPC fixture 和已安装的 Anchor coder。记录见 `docs/decisions.md` D-010。

## 代码走读

{{ snippet src/decoder/discriminator.ts#ep4-discriminator }}

{{ snippet src/core/reader.ts#ep4-reader }}

{{ snippet src/decoder/borsh.ts#ep4-decode-args }}

{{ snippet src/decoder/instruction.ts#ep4-account-names }}

{{ snippet src/decoder/transaction.ts#ep4-flatten }}

## 运行与验证

```bash
pnpm exec tsx scripts/decode-tx.ts 4FRUHaLGRdvAcV88XtTgCUGE76oAE1tKFqL5dEodxsmJhUgshUnEnkxKXEdn3q2r2XFRPTMihAfgsUQpuMhQivjt
pnpm typecheck
pnpm test
```

脚本只读取本地 fixture，成功启动后输出 `lending_account_borrow`，`args.amount` 为字符串 `"5000000000"`（tUSDC 原生单位）。账户角色含 `marginfi_account`、`bank`、`signer`；每条结果带 signature、ixIndex、innerIndex 和 stackHeight。签名不在 fixture 时非零退出，不从 RPC 补取。

本次沙箱拒绝 tsx CLI 创建本地 IPC 管道，直接运行 `pnpm exec tsx ...` 在脚本执行前报 `listen EPERM`，未验证该启动方式成功。以下不创建该管道的替代命令已运行成功，CLI 测试也使用同一 Node loader：

```bash
pnpm exec node --import tsx scripts/decode-tx.ts 4FRUHaLGRdvAcV88XtTgCUGE76oAE1tKFqL5dEodxsmJhUgshUnEnkxKXEdn3q2r2XFRPTMihAfgsUQpuMhQivjt
```

数值参数为 bigint，CLI 转成十进制字符串；bytes 与 `WrappedI80F48.value` 保持字节数组。指令名、参数名及结构体/枚举字段保留原始 IDL 拼写，账户角色使用 camelCase。

测试覆盖全部 36 个 discriminator；32 笔 fixture 的 18 条 marginfi 指令（11 类）与 Anchor 的名称/参数一致；逐步骤金标准对照独立事件记录；抽查 borrow/liquidate 的账户角色与 remaining 顺序。非空地址表、marginfi CPI、元组和 fixture 未用到的基础 Borsh 类型用合成数据验证。

## 常见坑

- 未知 discriminator 返回 `unknown`、16 位十六进制 discriminator 和原始 base64，不丢弃数据。
- 已识别指令的参数截断或账户越界返回指令名、decodeError 与原始 base64，后续指令仍能解码。不足 8 字节时无法识别名称，返回 `unknown` 与 decodeError。
- 非法 base58 无法恢复字节，返回 decodeError，保留 RPC 原文 `rawData` / `data`，并标明 `dataEncoding: 'base58'`。
- innerIndex 是所在 inner 列表的原始下标，不是过滤其他程序之后重新编号；缺失 stackHeight 保留为 null。
- deposit 等指令会内部发出计息事件，不能据此虚构一条独立的 accrue 指令。

## 验证边界与下一章

本次没有联网、发送交易、部署或运行数据库。非空地址表和 marginfi CPI 未与新的真实链上样本核对；fixture 未出现的 25 类指令只核对了 discriminator，没有逐类真实参数验证。事件、账户状态、定点数换算和余额对账属于 EP5/M3，本次未实现或验收。
