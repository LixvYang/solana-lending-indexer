# Solana 数据地图(速查)

> 一页纸版本。完整讲解见 [EP2](chapters/ep02-data-map.md)。

```
 slot ──► block ──► transaction ──► instruction ──► inner instruction (CPI)
                        │                │
                        │                └─ 账户列表 + 数据(base58)
                        ▼
                      meta ──► logMessages ──► Program data: <base64>  = Anchor 事件
                        │
                        └─► innerInstructions / err / fee / preBalances / postBalances
 account ── 链上状态:(lamports, owner 程序, data 字节)
```

| 想知道 | 看哪里 | RPC |
|---|---|---|
| 链走到哪了 | slot | `getSlot` |
| 这个 slot 出块了吗 | block / 被跳过 | `getBlocks`、`getBlock` |
| 这笔交易成功了吗 | `meta.err`(空 = 成功) | `getTransaction` |
| 调用了什么、传了什么 | `message.instructions[*].data`(base58) | `getTransaction` |
| 程序内部又调用了谁 | `meta.innerInstructions` | `getTransaction` |
| 发生了什么(结构化) | 日志里的 `Program data:`(base64) | `getTransaction` |
| 现在是什么(状态) | account.data | `getAccountInfo`、`getMultipleAccounts` |
| 某个程序的全部历史 | 按签名列出 | `getSignaturesForAddress` |

## 三条经验

1. **状态在账户里,不在交易里。** 想知道余额,读账户;想知道发生了什么,读交易。
2. **一条指令可以发出多个事件,一个事件也可能来自 CPI。** 不要假设一一对应。
3. **只信 finalized。** processed 和 confirmed 都可能回滚。

## 五个坑

- 交易版本 v1 已经出现,`getBlock` 要设 `maxSupportedTransactionVersion: 1`。
- 失败的交易也上链,但里面的事件不算数。
- 日志可能被截断(`Log truncated`)。
- 指令数据是 base58,事件是 base64。
- Anchor 指令名和事件名靠 **discriminator**(`sha256("global:<名字>")` 或 `sha256("event:<名字>")` 的前 8 字节)识别。
