# EP2 Solana 数据地图

## 本集要回答的问题

Solana 链上有哪些数据?它们各自从哪里取、能回答什么问题?

## 一张表看清楚

| 层级 | 是什么 | 从哪取 | 能回答什么 |
|---|---|---|---|
| **slot** | 约 400ms 一个的时间槽;有的 slot 没有出块(被跳过) | `getSlot`、`getBlocks` | "链现在走到哪了" |
| **block** | 一个 slot 里被确认的全部交易 | `getBlock` | "这个 slot 里发生了什么" |
| **transaction** | 一次原子操作:要么全成功要么全失败;带签名;最多约 1232 字节 | `getTransaction` | "谁签了什么、花了多少手续费、成没成功" |
| **instruction** | 交易里的一条调用:`程序 + 账户列表 + 一段字节` | 在交易的 `message.instructions` 里 | "调用了哪个程序的哪个入口、传了什么" |
| **inner instruction** | 程序在执行中再调用别的程序(CPI)产生的指令 | `meta.innerInstructions` | "借款时底层发生了一次代币转账" |
| **log** | 程序运行时打印的文本 | `meta.logMessages` | 调试;**以及 Anchor 事件** |
| **event** | Anchor 程序用 `emit!` 写进日志的结构化数据(`Program data: <base64>`) | 解析日志 | "发生了什么":一笔存款、一次清算 |
| **account** | 链上存状态的地方:一段字节 + 余额 + 所有者(owner)程序 | `getAccountInfo`、`getMultipleAccounts` | "现在是什么":池子里有多少钱 |

最重要的一句话:**程序本身不存状态,状态存在账户里;交易是"动作",账户是"结果"**。

## 用一笔真实的借款交易逐层拆

下面这笔是 Bob 借出 5000 tUSDC(devnet slot 509953286,签名 `4FRUHaLG…`)。

**交易层。** 版本 0,需要 2 个签名(付手续费的账户 + Bob),账户表里有 14 个地址,包含 2 条指令,手续费 10000 lamports,消耗 45,882 个计算单元。

**指令层。** 2 条:

| # | 程序 | 账户数 | 数据 |
|---|---|---|---|
| 0 | ComputeBudget | 0 | 5 字节(6 个 base58 字符):设置计算单元上限 |
| 1 | marginfi | 12 | 21 个 base58 字符 = 16 字节:8 字节 discriminator + 一个 u64 的借款数量 |

注意:指令的 `data` 在 RPC 里是 **base58** 字符串。

**inner instruction 层。** 第 1 条指令内部又调用了一次 SPL Token(转出 5000 tUSDC 给 Bob),这条不在 `message` 里,只在 `meta.innerInstructions` 里,`stackHeight = 2`。

**日志层。** 去掉计算单元统计后:

```
Program ComputeBudget… invoke [1]
Program ComputeBudget… success
Program 8fQDyb… invoke [1]
Program log: Instruction: LendingAccountBorrow
Program data: aHW7nG+aaroA4xki…        ← 事件 1(base64):先计一次利息
Program Tokenkeg… invoke [2]            ← CPI,调用深度 2
Program Tokenkeg… success
Program data: 32BRCpxjGjsBjpxM…        ← 事件 2(base64):这次借款本身
Program 8fQDyb… success
```

两行 `Program data:` 就是两条 Anchor 事件。**一笔借款指令发出了两个事件**——一个"计息",一个"借款"。这就是为什么后面不能"一个事件对应一条指令"。

**账户层。** 这笔交易改变了 bank、Bob 的 marginfi 账户和代币账户。要知道"现在池子里有多少钱",要去读这些账户,而不是去数交易。

## commitment:你信哪个版本的链

| 级别 | 含义 |
|---|---|
| processed | 节点刚看到,可能被回滚 |
| confirmed | 绝大多数验证者投票通过,极少回滚 |
| finalized | 已不可逆 |

本项目只信 **finalized**:代价是慢几十秒,换来不用处理链重组。这是写在 README "局限"里的取舍。

> **后续增补**(第 8 集代码定稿 `ep8-end` 之后才加的,只在 `main` 上,各集 tag 里没有):后来为了让钱包操作后页面几秒内就更新,实时跟随(`ingest --follow`)改成先按 **confirmed** 入库,再由"终局清扫"确认或删除被丢弃分叉上的交易;回填和扫区间仍只认 finalized。见 EP8「页面多快能反映出你刚发的交易」与 D-017。

## 取数据的两条路

- **按签名**:`getSignaturesForAddress(程序地址)` 列出所有碰过这个程序的交易,再逐个 `getTransaction`。只拉相关交易,**适合回填历史**。
- **按区块**:逐个 slot `getBlock`,在里面筛出调用了目标程序的交易。能看到"一个 slot 里有什么",**适合实时跟随或扫一小段**。但追赶历史很慢:devnet 一天约 20 万个 slot,每个一次请求。

两条路拿到的交易内容基本相同——除了 `meta.rewards`:`getBlock`(`rewards:false`)是 `null`,`getTransaction` 是 `[]`。解码不读它,但原始 JSON 并非逐字节相同。

## 常见坑

- **交易版本不止 legacy 和 v0。** devnet 的区块里已经有 v1 交易,`getBlock` 若声明只支持版本 0,**整块都会报错**,indexer 会卡死在那个 slot。要把支持的版本上限设到 1。
- **失败的交易也上链。** 它们收了手续费,`meta.err` 非空,必须当作事实保存,但不能把里面的事件当成真的发生过。
- **日志会被截断。** 一笔交易日志太长时,Solana 会截断并加一行 `Log truncated`,截断后的事件就丢了。
- **交易里不只有目标程序的指令。** 设置计算单元、代币转账这些别的程序的指令也在里面,解码时只认自己的程序。
- **base58 与 base64。** 指令数据是 base58,日志里的事件是 base64,账户数据通常用 base64 取。别混。

## 下一集

EP3:认识我们要拆的这个协议——marginfi 的数据模型,以及怎么在 devnet 上造出一段可重复的借贷行为。
