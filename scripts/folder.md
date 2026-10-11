# scripts

开发与视频演示的命令行入口。是否访问网络由各脚本职责决定。

| 文件 | 角色 | 功能 |
|---|---|---|
| decode-tx.ts | 离线演示 | 从固定 fixture 按签名打印解码 JSON，不调用 RPC |
| fetch-fixtures.ts | 数据采集 | 从 RPC 下载原始交易，本次任务未运行 |
| transfer-sol.ts | 链上操作 | SOL 转账工具，本次任务未运行 |

SYNC: 增删脚本或改变职责时更新此表与文件头部。
