# EP7 前端与总结

状态：M5a 后端已实现并离线验证；前端独立开发，本次不验收前端。

## 本章要回答的一个问题

怎样把数据库中的协议状态变成池子视图，并展示同一笔交易的原始字节、解码结果和数据库行？

## 后端数据来源

API 只读 `raw_tx`、`instructions`、`events`、`account_states`、`labels`，不连接 RPC。
`ingest` 的 `syncStored` 在协议账户快照后，读取最新 Bank 的 `oracle_keys[0]` 并采集 PullFeed。
预言机 owner 必须在 `ORACLE_OWNERS`（逗号分隔）的集合内；未设置时使用仓库根目录下
`program/out/program-ids.json` 的 mocks 及 Switchboard devnet 程序；文件缺失时只用后者。
拒绝 owner/布局错误的整批价格，缺失账户报告并跳过。每批保留 `context.slot` 和原始 base64；重建时也能重解价格。

价格是 D-009 的 Switchboard **布局 mock**，不是当前真实 Switchboard oracle 的报价。
`sample_size=0` 的未 crank 账户仍可解出 0，但视图将它视作价格缺失。API 显示最近已存价格与更新时间，未判断其当前新鲜度。
标签是链下元数据：mint 符号优先用于池子标题，账户昵称来自 labels；缺标签时缩写地址，不由链上数据猜名称。

## 数量、利率与健康度

两个 I80F48 的原始位数相乘，分母是 `2^96`。原生数量字符串向下取整；利用率先算精确比值，再转 number，
USD/健康度保留原生数量分数到显示边界。账户有无债务也按精确分子判断，避免微量债务被取整隐藏。
利率由两段线性曲线计算：存款 `base × utilization`，借款 `base × (1 + fee_rate) + fee_fixed_apr`。
费用包含保险费、group 费、启用时的 group 缓存 program 费；一次性 origination fee 不进入 APR。
缺少 group 快照时拒绝组装，不猜费用为零。有限利用率在显示中饱和到 0..1；NaN/Infinity 拒绝。

{{ snippet src/api/math.ts#ep7-rates }}

健康度按 init / maint 权重计算。清算事件的 f64 余额是原生单位，先除以 `10^decimals`；
当前 fixture 的 pre/post maint 与程序报告值差小于 `1e-6`，不是浮点逐位重演。
有实际余额且缺 bank/价格时健康度为 null；缺 bank 的账户视图报错，避免漏掉仓位。
无负债仍是 `no_debt`；有负债且缺价格只能沿用契约的 `liquidatable` 作为保守显示，**不证明可清算**。

{{ snippet src/api/math.ts#ep7-health }}

## 活动流与 X 光

活动流一条顶层 marginfi 指令一行，按 slot / ix_index / signature（C 排序）降序。
默认 limit=20，范围 1..100；使用最后一行三元组为游标。主事件按指令名精确映射，计息事件不冒充 borrow/deposit。
失败指令仍显示 `ok=false`，没有已发生的业务事件；清算没有 u64 `amount`，返回 null。
事件只有顶层 ix_index，没有 inner_index；同一顶层调用重复 emit 相同主事件时取最后一条，不承诺区分嵌套来源。

{{ snippet src/api/spans.ts#ep7-spans }}

X 光列出全部原始 top/inner 指令：marginfi 从数据库解码行取字段，外部程序保留原文并显示 unknown。
已知参数由 IDL/Borsh 逐个切分，unknown/损坏指令保留完整原始字节分段；非法 base58 保留原文和错误。
事件 base64 直接取原始日志对应 log_index；rows 保留两张表原始行，不作字段类型猜测。

{{ snippet src/api/xray.ts#ep7-xray }}

## 运行与验证

以下服务命令供本地人工运行；本次没有连接真实数据库或监听端口：

```bash
pnpm migrate
pnpm exec node --import tsx scripts/load-labels.ts
pnpm exec node --import tsx scripts/serve-api.ts
pnpm typecheck
pnpm test
```

`serve-api` 默认绑定 `127.0.0.1:8787`，用 PORT 改端口；数据库通过 DATABASE_URL 配置。
启动 API 不自动迁移、不采集快照、不连 RPC。CORS 固定允许 `http://localhost:5173`。
GET 路由：`/api/pool`、`/api/accounts`、`/api/rate-curve?bank=<address>`、
`/api/activity?limit=20&before=<cursor>`、`/api/tx/<signature>`、`/api/health`。
health 探测数据库；未知路径/资源 404，参数错误 400，内部错误 500 固定消息，不返回或记录连接 URL。

离线测试使用 PGlite、本地 fixture 和假账户 RPC；HTTP 测试直接调用 route / handle，不使用 socket。
临时源代码突变与最终检查证据见 `docs/progress.md`；设计取舍、契约异议和未验收范围见 D-013。

## 验证边界

快照只是各地址最后一次采样，`as_of_slot` 是最大 slot，不证明所有账户同一时刻，更不等于逐笔历史。
并发写库时多次 SELECT 可能看到不同提交；没有增加跨请求快照隔离或实时更新推送。
没有新鲜度策略、关闭墓碑、主网验证、真实 PostgreSQL/API socket/浏览器联调或吞吐测试。
