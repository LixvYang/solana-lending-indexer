# scenario/lib

确定性剧本的账户、协议指令、记录与价格工具；执行是否联网由 scenario 入口决定。
mock-feed 使用 src/decoder/switchboard.ts 的唯一 PullFeed 偏移表。本次仅运行离线测试。

| 文件 | 角色 | 功能 |
|---|---|---|
| actors.ts / actors.test.ts | 账户 | 固定字符串派生账户与代币标识 |
| bank-config.ts | 配置 | 统一剧本银行风险与利率参数 |
| context.ts / test-context.ts | 上下文 | 剧本资源类型与离线测试上下文 |
| marginfi.ts / marginfi.test.ts | 指令 | 固定协议指令构造与参数验证 |
| mock-feed.ts / mock-feed.test.ts | mock 价格 | 复用 decoder 唯一偏移，构造 resultRegion 并由 mocks 写入 |
| price.ts | 价格入口 | 剧本价格提供者选择 |
| record.ts / record.test.ts | 记录 | 地址、签名、事件与 JSON 输出 |
| rpc.ts / rpc.test.ts | 发送 | 剧本交易确认与重试，测试用离线替身 |
| runtime.ts | 初始化 | 装配运行资源 |
| state.ts | 状态 | 结束快照与确定性数据 |
| switchboard-client.ts | 价格客户端 | Switchboard 队列与客户端边界 |
| switchboard.ts / switchboard.test.ts | feed | 真实 feed 创建/crank 流程，测试替换外部调用 |

SYNC: 改变 helper 职责时同步本表、文件头部与 scenario/README.md。
