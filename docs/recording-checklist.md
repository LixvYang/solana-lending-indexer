# 录制清单

> 开拍前把这一页从上到下走一遍。`pnpm exec tsx scripts/check-ready.ts` 会自动检查其中大部分。

## 一次性准备

- [ ] `.env` 里有 `RPC_URL`(Helius devnet)和 `ANCHOR_WALLET`(管理员钱包);管理员钱包有至少 1 SOL(重跑剧本约 0.3 SOL)。
- [ ] `docker compose up -d`,`pnpm exec tsx scripts/migrate.ts`。
- [ ] 数据库里有数据:`pnpm exec tsx scripts/ingest.ts --backfill`,再 `pnpm exec tsx scripts/load-labels.ts`。
- [ ] `pnpm exec tsx scripts/check-ready.ts` 全部 ✓。

## 每次录制前

```bash
pnpm exec tsx scripts/check-ready.ts          # 看有没有 ✗
POOL_GROUP=<group 地址> pnpm exec tsx scripts/serve-api.ts   # 终端 1:API(8787)。数据库里有多个池子时必须设
(cd web && pnpm dev)                          # 终端 2:前端(5173)
pnpm exec tsx scripts/ingest.ts --follow      # 终端 3:实时跟随链上新交易(录钱包交互那集需要)
pnpm exec tsx scripts/price-keeper.ts         # 终端 4:价格维护(录钱包交互那集需要)
pnpm exec tsx scripts/faucet.ts               # 终端 5:水龙头(录钱包交互那集需要)
```

## 各集的特别准备

| 集 | 需要什么 | 注意 |
|---|---|---|
| EP2 | 浏览器打开 Explorer 的那笔借款交易 | 签名 `4FRUHaLG…`(第一次运行) |
| EP3 | 预录好 `build.sh` 和剧本执行 | 等待型内容不要现场录 |
| EP4–EP5 | 只需离线 fixtures,`pnpm test` 能跑即可 | 突变验证要现场改代码,提前备好 `git stash` |
| EP6 | Postgres 在运行 | `verify-db` 前后两次 md5 要相同 |
| EP7 | API + 前端 | 价格维护进程不是必须(只读) |
| EP8 | **价格维护进程 + 水龙头 + `ingest --follow`**;API 要设 `POOL_GROUP` | 见 `ep08-script.md` |
| EP1 | 全部 | **最后拍** |

## 每集都要说的诚实声明

价格是"布局一致的 mock"(devnet 上 Switchboard oracle 离线)。

## 录完之后

- [ ] 关闭水龙头进程;**不要**把 `.env`、水龙头钱包密钥文件出镜。
- [ ] 视频简介里放仓库链接和对应集的 tag(`git checkout ep4-end`)。
- [ ] 置顶评论放 `docs/cheatsheet.md` 的速查图。
