# decoder

M2/M3：原始指令、日志、账户字节 → 按 IDL 还原字段与调用位置，并精确对账。
所有解码函数离线运行；Anchor coder 只用于测试。

| 文件 | 角色 | 功能 |
|---|---|---|
| idl/marginfi.idl.json | 布局 | 固定协议地址、36 个指令、参数和账户声明 |
| idl.ts | 类型 | 加载 IDL，定义指令/事件/账户类型、discriminator 与 repr |
| discriminator.ts | 身份 | 手算 global discriminator 并核对 IDL |
| borsh.ts | 参数 | 由 IDL 递归解码字段、容器、结构体、枚举和 f32/f64 |
| instruction.ts | 解码 | 单条 compiled instruction、账户角色、unknown 与错误隔离 |
| transaction.ts | 展开 | 完整 v0 账户表、顶层/inner 指令及位置 |
| discriminator.test.ts | 测试 | 36 个 discriminator 与哈希交叉校验 |
| borsh.test.ts | 测试 | 数值、容器、元组和定点数字节 |
| instruction.test.ts | 测试 | unknown、截断、越界、分组账户、v0、CPI |
| transaction.test.ts | 测试 | 真实 fixture 与 Anchor 对照、步骤金标准、账户角色 |
| cli.test.ts | 测试 | 离线 CLI JSON 输出、参数错误与当前目录独立性 |
| test-utils.ts | 测试辅助 | 只供测试加载/查找本地 fixture |

| roundtrip.test.ts | 测试 | 全部带参数指令的 Anchor 编码往返 |
| event.ts | 事件 | marginfi 栈顶日志、顶层归属、unknown/失败/截断 |
| event.test.ts | 测试 | 25 事件独立记录对照与合成调用栈 |
| layout.ts | 布局 | IDL repr(C) 成员/数组对齐、padding 与结构大小 |
| layout.test.ts | 测试 | fixture 长度与合成隐式 padding/stride |
| account.ts | 账户 | 四类 zero_copy 严格长度、snake_case 与精确定点数 |
| account.test.ts | 测试 | 七账户 Anchor 逐字段对照、长度与坏 bool/enum |
| event-balances.ts | 流量 | u64 净流量、清算 f64 有理数、误差界与 39/38 推算 |
| reconcile.ts | 对账 | shares 不变量、2^96 数量、差值分类/方向/量级界 |
| reconcile.test.ts | 测试 | Anchor snapshot 精确分子、固定差值与异常输入 |
| m3-test-utils.ts | 测试辅助 | Anchor 标准化与本地账户 fixture 加载 |
| m3-cli.test.ts | 测试 | 账户/布局 CLI 输出、参数边界、cwd 独立 |

| version.ts | 重放版本 | DECODER_VERSION=1；布局变化时递增，旧 raw_tx 重做 |

SYNC: 增删文件或改变职责时更新此表与文件头部。
