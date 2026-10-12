# solana-lending-indexer

用 marginfi(mrgn-0.1.0)当样本,演示 **Solana 链上数据如何一步步变成数据库里的行,再变成网页上的数字**。配套 B 站合集视频(7 集)。

> 状态:**主线 M0–M5 已完成并在真实 devnet 上验收**(见 [docs/progress.md](docs/progress.md))。视频与分镜([video/](video/))待录制。

## 你会得到什么

- 一个**真实部署在 devnet 的借贷池**,和一段可重复的借贷剧本(存款、借款、改价、清算、还款)。
- 一条**手写的解析流水线**:指令(Borsh)、事件(日志)、账户状态(`zero_copy` 布局 + I80F48 定点数),全部带测试,并用 Anchor 官方 coder 交叉校验。
- **幂等、可回填、可重放**的 Postgres 存储:清库重跑,解码表的 md5 完全一致。
- 一个**只读 API 和前端**,其中的"X 光"能并排看到一笔交易的原始字节、解码结果、数据库行。

## ⚠️ 先说清楚:价格是"布局一致的 mock"

devnet 上 Switchboard 的 oracle 目前整体离线(实测:191 个 oracle 账户的心跳全部超时),无法给自建的测试币喂价。所以价格由我们写入一个**与真实 Switchboard 价格账户字节布局完全一致**的账户,marginfi 走的仍是读取 Switchboard 价格的那条代码路径。**除价格来源外,其余全部是真实的链上行为。** 详见 [EP3](docs/chapters/ep03-protocol-and-scenario.md) 与 [D-008 / D-009](docs/decisions.md)。

## 章节

| 集 | 主题 | 文档 | 分镜 | 代码检查点 |
|---|---|---|---|---|
| EP1 | 成品演示 | [ep01](docs/chapters/ep01-demo.md) | [script](video/ep01-script.md) | `ep7-end`(展示最终成果) |
| EP2 | Solana 数据地图 | [ep02](docs/chapters/ep02-data-map.md)、[速查图](docs/cheatsheet.md) | [script](video/ep02-script.md) | —(概念,无代码) |
| EP3 | 看懂借贷协议,造出链上数据 | [ep03](docs/chapters/ep03-protocol-and-scenario.md) | [script](video/ep03-script.md) | `ep3-end` |
| EP4 | 解析指令 | [ep04](docs/chapters/ep04-instructions.md) | [script](video/ep04-script.md) | `ep4-end` |
| EP5 | 解析事件与账户状态 | [ep05](docs/chapters/ep05-events-and-accounts.md) | [script](video/ep05-script.md) | `ep5-end` |
| EP6 | 存储设计 | [ep06](docs/chapters/ep06-storage.md) | [script](video/ep06-script.md) | `ep6-end` |
| EP7 | 前端与总结 | [ep07](docs/chapters/ep07-frontend.md) | [script](video/ep07-script.md) | `ep7-end` |

从 EP3 起每一集一个 git tag,`git checkout ep4-end` 就是第 4 集结束时的代码。历史是线性的:各集的提交按顺序排列,没有重写。

## 快速开始

需要 Node 24、pnpm、Docker、Solana CLI 2.1.20。

**只看解码(不需要网络、数据库、钱包):**

```bash
pnpm install
pnpm typecheck && pnpm test      # 全部离线,约 20 秒;数据库用进程内的 PGlite
pnpm exec tsx scripts/decode-tx.ts 4FRUHaLGRdvAcV88XtTgCUGE76oAE1tKFqL5dEodxsmJhUgshUnEnkxKXEdn3q2r2XFRPTMihAfgsUQpuMhQivjt
```

**完整跑一遍(需要 devnet RPC 与有 SOL 的钱包):**

```bash
cp .env.example .env                       # 填 RPC_URL、ANCHOR_WALLET
docker compose up -d                       # Postgres,端口 5433
./program/build.sh                         # 构建 marginfi 与 mocks
pnpm scenario                              # 只打印计划;加 --execute 才在 devnet 发交易(约 0.3 SOL)
pnpm exec tsx scripts/migrate.ts
pnpm exec tsx scripts/ingest.ts --backfill
pnpm exec tsx scripts/load-labels.ts
pnpm exec tsx scripts/verify-db.ts         # 读回对账 + 解码表 md5
pnpm exec tsx scripts/serve-api.ts &
(cd web && pnpm install && pnpm dev)       # http://localhost:5173
```

更多命令见 [AGENTS.md](AGENTS.md)。

## 局限

- **价格是 mock**(见上)。
- **只入库 finalized**,不处理链重组。
- **账户状态只有快照**,没有逐笔历史状态。
- **只解码剧本涉及的指令**,其余原样存为 `unknown`。
- **`tail` 追不动历史**(逐 slot 一次请求),追赶请用 `--backfill`。
- **前端只读**,没有钱包连接。
- 文档里的数字对应第一次运行(见 [D-014](docs/decisions.md));之后为验收重跑过几次,现在重新回填会得到更多行。
- 没有压测,没有长时间运行测试,没有在别的协议上验证过"换 IDL 即可"。

## 目录

```
docs/        读者文档(chapters/)、目标/进度/决策记录
video/       分镜脚本
program/     marginfi 固定版本的构建与部署脚本(上游源码不入库)
scenario/    确定性剧本
fixtures/    真实运行的原始数据(解码器的金标准)
src/         core(字节工具)、decoder、ingest、store、api
web/         前端(Vite + React)
scripts/     CLI 与文档片段展开(snapshot-docs)
```

## 许可

上游 marginfi-v2 为 Apache-2.0。本项目许可证待定。
