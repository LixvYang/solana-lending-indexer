# EP1 成品演示:把一个链上借贷池拆进数据库

## 本集要回答的问题

一笔链上的借款交易,最后怎么变成数据库里的一行、网页上的一个数字?

## 你会看到什么

打开一个页面,上面是一个真实部署在 Solana devnet 上的借贷池(marginfi mrgn-0.1.0):

- **池子总览**:每种代币的存款、借款、利用率、存款与借款利率。
- **利率曲线**:当前利用率落在曲线的哪个位置。
- **账户健康度**:谁快被清算了。健康度的算法和程序自己算的结果能对上到小数点后六位。
- **链上活动**:每一笔存款、借款、还款、清算。
- **X 光**:点任意一笔交易,并排看到它的三种形态——链上的原始字节、解码后的字段、写进数据库的那一行。

后面六集,就是把这个页面从下往上一层层拆开。

## 整体结构

```
 Solana devnet 上的 marginfi 程序
        │  getBlock / getSignaturesForAddress / getTransaction / getMultipleAccounts
        ▼
 ┌───────────────┐   ① 先存原始: raw_tx(唯一事实来源)
 │    ingest     │   ② 游标与原始数据同事务提交 → 幂等、崩溃可恢复
 └───────┬───────┘
         ▼
 ┌───────────────┐   指令: 手写 Borsh 解码(EP4)
 │    decode     │   事件 + 账户状态: 手写 zero_copy 解码(EP5)
 └───────┬───────┘   纯函数,可以对 raw_tx 重放 → 清库重跑结果一致(EP6)
         ▼
     PostgreSQL ──► 只读 API ──► 前端(含 X 光)(EP7)
```

三条贯穿全程的设计原则:

1. **先存原始,再解码。** 解码器写错了,改了重放就行,不用重新拉链上数据。
2. **幂等。** 同一批数据入库两次、中途崩溃后重跑,结果和一次跑完完全一样。
3. **池子指标以账户状态为准,事件只做活动流。** EP5 会用真实数据证明为什么。

## 先说清楚一件事:价格是"布局一致的 mock"

借贷需要价格。剧本要能把价格打低来演示清算,真实行情做不到;而且 Switchboard 已于 2026-09 整体关停(D-018),devnet 上的 oracle 不会再恢复。所以价格由我们自己写入一个账户,这个账户的字节布局与真实的 Switchboard 价格账户完全一致,marginfi 走的仍是读取 Switchboard 价格的那条代码路径。

**除了价格来源,其余全部是真实的链上程序行为**:真实的 marginfi 程序、真实的交易、真实的清算。详见 EP3。

## 自己跑一遍

需要 Node 24、pnpm、Docker、Solana CLI 2.1.20,以及一个 devnet RPC(例如 Helius 免费套餐)和一个有 devnet SOL 的钱包。

```bash
cp .env.example .env            # 填 RPC_URL、ANCHOR_WALLET
pnpm install
docker compose up -d            # Postgres,端口 5433

# 链上部分(EP3):构建、部署、跑剧本
./program/build.sh
pnpm scenario                   # 只打印计划;加 --execute 才会真的发交易

# 链下部分(EP4–EP7)
pnpm exec tsx scripts/migrate.ts
pnpm exec tsx scripts/ingest.ts --backfill
pnpm exec tsx scripts/load-labels.ts
pnpm exec tsx scripts/serve-api.ts &
(cd web && pnpm install && pnpm dev)   # 打开 http://localhost:5173
```

不想碰链也可以只看解码:`fixtures/` 里有一次真实运行的原始数据,所有解码器测试(`pnpm test`)都离线跑,不需要网络和数据库。

## 合集路线

| 集 | 主题 | 一句话 |
|---|---|---|
| EP1 | 成品演示 | 本集 |
| EP2 | Solana 数据地图 | 链上到底有哪些数据,各从哪里取 |
| EP3 | 看懂借贷协议,造出链上数据 | 数据模型与可重复的剧本 |
| EP4 | 解析指令 | 一笔交易 → "谁调用了什么" |
| EP5 | 解析事件与账户状态 | "发生了什么" vs "现在是什么" |
| EP6 | 存储设计 | 幂等、可回填、可重放 |
| EP7 | 前端与总结 | 把一切摆在眼前 |

只想了解皮毛的话,看 EP1 和 EP2 就够了,配套有一页速查图 [cheatsheet.md](../cheatsheet.md)。

## 下一集

EP2:先把 Solana 链上的数据地图画清楚——后面每一步解析的都是这张地图上的某一块。
