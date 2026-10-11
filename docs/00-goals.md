# 目标

## 一句话

用一个真实的借贷协议(marginfi mrgn-0.1.0)当样本,完整演示 Solana 链上数据从"原始字节"到"数据库 + 可视化"的全过程,并配套 B 站合集视频。

## 要交付的东西

1. **可复现的仓库**:一键启动数据库、重放剧本、跑 indexer、打开前端。
2. **7 集视频合集**(见下表),每集对应一个模块与一份文档。
3. **速查图**:Solana 数据地图(account / tx / instruction / inner instruction / log / event),放置顶评论。

## 真实目的

不追求播放量。目标是让仓库与视频成为"能把真实借贷协议从链上拆到数据库"的可信证明。因此优先级是:可复现 > 代码清晰 > 视频节奏。

## 范围

做:
- 部署 marginfi mrgn-0.1.0 到 devnet,用 mock 价格(不依赖 Switchboard 手动设价)。
- 确定性剧本:A 存款、B 抵押并借款、价格下跌、C 清算。
- 解码指令、事件、inner instruction、账户状态(zero_copy 布局)。
- Postgres 存储,幂等入库,实时 + 回填。
- 前端:池子总览、利率曲线、账户健康度、活动流、"X 光"面板(原始 base64 → 解码 JSON → 数据库行)。

不做:
- 生产级可靠性(链重组只做到"只入库 finalized")。
- 覆盖 marginfi 全部 36 个指令,只覆盖剧本涉及的几类,其余记为 `unknown`。
- 主网部署。

## 验收标准

- **对账通过**:剧本结束后,由事件累加得到的各账户余额,与账户快照一致(`scenario/expected.json`)。
- **清库重跑结果一致**:同一剧本两次重放,数据库内容相同。
- **离线可测**:解码器仅凭 `fixtures/` 即可通过测试,不依赖 RPC。

## 合集结构

| 集 | 主题 | 对应模块 |
|---|---|---|
| EP1 | 成品演示 | 全部(展示结果) |
| EP2 | Solana 数据地图 | 概念 |
| EP3 | 看懂借贷协议,造出链上数据 | `program/` `scenario/` |
| EP4 | 解析指令 | `src/decoder/instruction.ts` |
| EP5 | 解析事件与账户状态 | `src/decoder/event.ts` `account.ts` |
| EP6 | 存储设计 | `src/ingest` `src/store` |
| EP7 | 前端与总结 | `src/api` `web/` |

拍摄顺序:先拍 EP2–EP7,最后拍 EP1。
