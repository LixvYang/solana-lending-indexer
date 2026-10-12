# src/api

EP7 只读数据库视图、精确原生数量与 HTTP 路由。不连接 RPC，不写库。
契约 `types.ts` 保持不变；价格来自已入库的 PullFeed，标签来自链下 labels。

| 文件 | 角色 | 功能 |
|---|---|---|
| types.ts | 契约 | 与前端共享的 JSON 类型（本任务不修改） |
| math.ts | 纯函数 | shares 精确乘法/取整、APR、USD 与 init/maint 健康度 |
| state.ts | 读取 | 最新状态、IDL bigint 恢复、标签与时间边界 |
| bank.ts | 池子 | 权重、group 费用缓存、价格与 USD 汇总 |
| queries.ts | 入口 | 池子、利率曲线与账户；导出活动/X 光查询 |
| activity.ts | 活动 | 主事件匹配、slot/ix/signature 稳定分页 |
| spans.ts | 教学 | IDL 顶层参数字节范围、bigint 字符串 |
| xray.ts | X 光 | 原始 top/inner 指令、base64 日志和数据库原始行 |
| errors.ts | HTTP | 可公开的固定错误与状态码 |
| server.ts | HTTP | 六个 GET 路由、CORS、输入验证、固定 500 报错 |
| test-utils.ts | 测试辅助 | PGlite 加载本地 fixtures 与合成价格 |
| math.test.ts | 测试 | 清算健康金标准、手算利率与超安全整数数量 |
| queries.test.ts | 测试 | Anchor 快照数量、缺价格、微量债务与 group 费用开关 |
| activity.test.ts | 测试 | 18 行独立分布、主事件、失败交易和游标平局 |
| xray.test.ts | 测试 | 原始字节/解码/数据库对照、变量参数和合成 v0 inner |
| server.test.ts | 测试 | 无 socket 的路由/handle、CORS、参数、脱敏和端口 |

SYNC: 修改实现时同步本表、文件头部、README 与 EP7。
