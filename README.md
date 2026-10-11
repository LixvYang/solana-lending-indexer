# solana-lending-indexer

用 marginfi(mrgn-0.1.0)当样本,演示 Solana 链上数据如何一步步变成数据库里的行,以及怎么把它展示出来。配套 B 站合集视频。

> 状态:搭建中。进度见 [docs/progress.md](docs/progress.md),目标见 [docs/00-goals.md](docs/00-goals.md)。

## 快速开始

尚未可用。当前只能启动数据库:

```bash
docker compose up -d
```

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

不是生产级:只入库 finalized 数据,不处理链重组;只解码剧本涉及的指令,其余原样存为 `unknown`。

## 许可

上游 marginfi-v2 为 Apache-2.0。本项目许可证待定。
