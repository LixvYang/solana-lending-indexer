# store/migrations

按文件名排序应用；每个 SQL 文件及其迁移记录一起提交。

| 文件 | 角色 | 功能 |
|---|---|---|
| 001_raw_tx.sql | 事实 schema | 原始交易及 blocks 游标 |
| 002_decoded.sql | 派生 schema | 解码版本、指令/事件/账户快照、查询索引 |

SYNC: 更改 schema 时同步此表、EP6 与 D-012。
