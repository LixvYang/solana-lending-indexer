# oracle

价格账户的地址与写入规则,构建器、索引器、管理脚本共用。不做网络请求。

| 文件 | 角色 | 功能 |
|---|---|---|
| mock-write.ts | mock | mocks 程序 write 指令、只刷新时间戳、公开派生的价格账户密钥 |
| pyth.ts | Pyth | 赞助价格账户 PDA、feed id ↔ oracle_keys、按银行求价格账户 |
| pyth.test.ts | 测试 | PDA 与真实地址一致、真实 pSOL 银行换算、Switchboard/空配置 |

SYNC: 增删文件或改变职责时更新此表与文件头部。
