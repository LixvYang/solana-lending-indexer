# solana-lending-indexer

用 marginfi(mrgn-0.1.0)当样本,演示 Solana 链上数据如何一步步变成数据库里的行,以及怎么把它展示出来。配套 B 站合集视频。

> 状态:搭建中。进度见 [docs/progress.md](docs/progress.md),目标见 [docs/00-goals.md](docs/00-goals.md)。

## 快速开始

M4 存储与 finalized 取块已实现；当前可启动数据库、查看 M1 剧本计划，以及离线解码本地交易/账户 fixture:

```bash
docker compose up -d
pnpm scenario
pnpm exec tsx scripts/decode-tx.ts 4FRUHaLGRdvAcV88XtTgCUGE76oAE1tKFqL5dEodxsmJhUgshUnEnkxKXEdn3q2r2XFRPTMihAfgsUQpuMhQivjt
pnpm exec node --import tsx scripts/print-layout.ts Bank
pnpm exec node --import tsx scripts/decode-account.ts F99hSfDM9ymMiMshg38uKWRpXtmZ7rSKVX5F1aHkjWTb
pnpm typecheck
pnpm test
```

剧本说明见 [scenario/README.md](scenario/README.md)。默认不访问网络、不读取钱包，`--execute` 才执行 devnet 剧本。`decode-tx.ts` 只读本地 fixture，输出指令名称、参数、账户角色和调用位置；实现与验证边界见 [EP4](docs/chapters/ep04-instructions.md)。

如果沙箱禁止 tsx 的本地 IPC 管道，可用 `pnpm exec node --import tsx scripts/decode-tx.ts <签名>`；本次验证使用这一启动方式。

M3 已实现日志事件、IDL 计算的 zero_copy 账户布局、精确 I80F48 和事件/状态对账；两个新增 CLI 只读本地 IDL/fixture。32 笔 fixture 实际有 25 条事件（任务文件写 24），七份账户与 Anchor 独立对照通过；shares 不变量与数量分子精确相等，事件净流量仍有利息/清算精度/取整差。实测与未验证边界见 [EP5](docs/chapters/ep05-events-and-accounts.md) 和 [D-011](docs/decisions.md)。

M4 提供 `pnpm migrate`、`pnpm ingest --backfill`、`pnpm ingest --tail --once --from <slot>` 和 `pnpm reindex`。采集命令需要 `RPC_URL`，数据库默认连接 `localhost:5433`；`reindex` 从 raw_tx 和保留原始字节的账户快照重建，不调用 RPC。所有新数据库测试使用进程内 PGlite，真实 Postgres / Helius 尚未实测；运行方式与事务边界见 [EP6](docs/chapters/ep06-storage.md) 和 [D-012](docs/decisions.md#d-012-m4-存储与-finalized-采集2026-10-12)。

代码变化时同步本 README、相关 `folder.md` 与文件头部的 INPUT / OUTPUT / POSITION 注释。

## 章节

| 集 | 主题 | 文档 |
|---|---|---|
| EP1 | 成品演示 | [docs/chapters/ep01-demo.md](docs/chapters/ep01-demo.md) |
| EP2 | Solana 数据地图 | [docs/chapters/ep02-data-map.md](docs/chapters/ep02-data-map.md) |
| EP3 | 看懂借贷协议,造出链上数据 | [docs/chapters/ep03-protocol-and-scenario.md](docs/chapters/ep03-protocol-and-scenario.md) |
| EP4 | 解析指令 | [docs/chapters/ep04-instructions.md](docs/chapters/ep04-instructions.md) |
| EP5 | 解析事件与账户状态 | [docs/chapters/ep05-events-and-accounts.md](docs/chapters/ep05-events-and-accounts.md) |
| EP6 | 存储设计 | [docs/chapters/ep06-storage.md](docs/chapters/ep06-storage.md) |
| EP7 | 前端与总结 | [docs/chapters/ep07-frontend.md](docs/chapters/ep07-frontend.md) |

## 局限

不是生产级:只入库 finalized 数据,不处理链重组。M2 按固定 IDL 解码指令；未知 discriminator 保留为 `unknown`，损坏指令返回 `decodeError`。真实 fixture 只覆盖 11 类指令，其他类型尚未逐类用真实交易验证。

## 许可

上游 marginfi-v2 为 Apache-2.0。本项目许可证待定。
