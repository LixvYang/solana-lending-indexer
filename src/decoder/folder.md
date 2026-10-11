# decoder

M2 指令解码：原始 RPC JSON → 按 IDL 还原名称、参数、账户角色与调用位置。
所有解码函数离线运行；Anchor coder 只用于测试。

| 文件 | 角色 | 功能 |
|---|---|---|
| idl/marginfi.idl.json | 布局 | 固定协议地址、36 个指令、参数和账户声明 |
| idl.ts | 类型 | 加载 IDL，定义指令可达的类型字段 |
| discriminator.ts | 身份 | 手算 global discriminator 并核对 IDL |
| borsh.ts | 参数 | 由 IDL 递归解码字段、容器、结构体和枚举 |
| instruction.ts | 解码 | 单条 compiled instruction、账户角色、unknown 与错误隔离 |
| transaction.ts | 展开 | 完整 v0 账户表、顶层/inner 指令及位置 |
| discriminator.test.ts | 测试 | 36 个 discriminator 与哈希交叉校验 |
| borsh.test.ts | 测试 | 数值、容器、元组和定点数字节 |
| instruction.test.ts | 测试 | unknown、截断、越界、分组账户、v0、CPI |
| transaction.test.ts | 测试 | 真实 fixture 与 Anchor 对照、步骤金标准、账户角色 |
| cli.test.ts | 测试 | 离线 CLI JSON 输出、参数错误与当前目录独立性 |
| test-utils.ts | 测试辅助 | 只供测试加载/查找本地 fixture |

SYNC: 增删文件或改变职责时更新此表与文件头部。
