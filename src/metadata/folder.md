# metadata

测试币的 Metaplex 链上元数据(钱包显示名称与图标)。手写 Borsh,不引入 SDK。不做网络请求。

| 文件 | 角色 | 功能 |
|---|---|---|
| metaplex.ts | 编码 | 元数据 PDA、CreateMetadataAccountV3 / UpdateMetadataAccountV2 指令、账户解码 |
| metaplex.test.ts | 测试 | 指令字节与账户顺序、长度上限、\0 补齐解码 |

SYNC: 增删文件或改变职责时更新此表与文件头部。
