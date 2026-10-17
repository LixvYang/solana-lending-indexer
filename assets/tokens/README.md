# 测试币元数据

链上 Metaplex 元数据(`scripts/token-metadata.ts` 写入)里的 `uri` 指向本目录的 JSON,钱包按 JSON 里的 `image` 显示图标。
图标与前端 `web/src/tokens.tsx` 的内联 SVG 是同一份设计:从运行中的前端导出 SVG,再渲染成 512×512 透明背景 PNG。
JSON 里的 `name`、`symbol` 也是链上写入的值(名称不超过 32 字节、符号不超过 10 字节)。

改了图标或说明:更新这里的文件并推送;改了名称/符号还要重跑 `scripts/token-metadata.ts`(幂等,只在不一致时更新)。
