# scripts

开发与视频演示的命令行入口。是否访问网络由各脚本职责决定。

| 文件 | 角色 | 功能 |
|---|---|---|
| decode-tx.ts | 离线演示 | 从固定 fixture 按签名打印解码 JSON，不调用 RPC |
| fetch-fixtures.ts | 数据采集 | 从 RPC 下载原始交易，本次任务未运行 |
| transfer-sol.ts | 链上操作 | SOL 转账工具，本次任务未运行 |

| decode-account.ts | 离线演示 | 从固定账户 fixture 打印字段、原始定点字节与 decimal |
| print-layout.ts | 离线演示 | 计算 IDL C 布局，显示 offset/align/padding |
| fetch-accounts.ts | 数据采集 | 下载账户原始字节，本次任务未运行 |

SYNC: 增删脚本或改变职责时更新此表与文件头部。
