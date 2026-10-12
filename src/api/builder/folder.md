# src/api/builder

以池子快照定位 bank/用户；用 Anchor 构造 v0、一次性部分签名与模拟。没有管理员密钥。

| 文件 | 角色 | 功能 |
|---|---|---|
| index.ts | 构建服务 | 首次存款、当前 feed 新鲜度、v0 与模拟 |
| instructions.ts | 指令 | IDL accountsStrict 与 vault PDA |
| remaining.ts | 纯函数 | 模拟操作后的余额槽位与 bank/feed 顺序 |
| state.ts | 状态 | 从最新账户原始字节选择 wallet/group |
| builder.test.ts | 测试 | 真实 borrow 金标准、部分签名、指令往返、新鲜度、错误与 authority 变更 |

SYNC: 修改实现时同步本表、文件头部、README 与 EP8 文档。
