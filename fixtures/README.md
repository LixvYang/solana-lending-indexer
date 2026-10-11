# fixtures

解码器离线测试用的金标准数据，均来自真实 devnet 运行(2026-10-11)。

| 文件 | 内容 |
|---|---|
| `m1-run.json` | 剧本一次完整运行：32 笔已 finalized 的交易(getTransaction 原始结果)、Anchor `EventParser` 解出的事件(解码器的对照基准)、账户快照、各地址 |
| `m1-expected.json` | 由事件累加得出的每账户每 bank 净存款/净借款(mint 原生数量) |
| `switchboard-pullfeed-uncranked.bin` | 链上真实的 Switchboard `PullFeedAccountData`(3208 字节，从未 crank)，用于校验 mock 价格账户的布局偏移 |

价格账户由 mocks 程序拥有(devnet 的 Switchboard oracle 离线，见 docs/decisions.md D-008)；程序地址与账户在重新部署后会变化，这份数据只对应当次部署。
