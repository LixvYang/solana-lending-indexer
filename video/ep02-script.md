# EP2 Solana 数据地图(目标 10–12 分钟)

**一句话结论**:状态在账户里,不在交易里;只信 finalized。

| 时间 | 画面 | 旁白要点 | 操作 |
|---|---|---|---|
| 0:00 | 速查图 | 本集的地图;后面每一步解析的都是这张图的某一块 | |
| 1:00 | 层级表 | slot、block、transaction、instruction、inner instruction、log、event、account | 逐行讲,每行一句"能回答什么问题" |
| 3:00 | Explorer 打开 Bob 的借款交易 | **用一笔真实交易逐层拆**:2 个签名、14 个账户、2 条指令 | 打开 `4FRUHaLG…` |
| 4:30 | 原始 JSON(`fixtures/m1-transactions.json`) | 指令 data 是 base58;marginfi 那条 21 个字符 = 16 字节 | 高亮 `data` |
| 5:30 | `innerInstructions` | 借款内部又调用了一次代币转账,`stackHeight = 2`,不在 message 里 | 滚到 meta |
| 6:30 | `logMessages` | 两行 `Program data:` = 两个事件:先计息、再借款 | 高亮两行 |
| 8:00 | commitment 表 | processed/confirmed/finalized;我们只信 finalized | |
| 9:00 | 两条取数据的路 | 按签名回填 vs 按区块实时;两者 `meta.rewards` 不同 | |
| 10:00 | 五个坑 | v1 交易、失败交易、日志截断、base58/base64、discriminator | 对着速查图 |
| 11:00 | 片尾 | 下一集:认识 marginfi,造出可重复的链上数据 | |
