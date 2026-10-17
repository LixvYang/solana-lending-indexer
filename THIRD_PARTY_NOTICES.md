# 第三方声明

本项目自身的代码与文档以 [MIT 许可证](LICENSE) 发布。以下内容来自第三方,按其原许可证使用:

| 内容 | 来源 | 许可证 |
|---|---|---|
| `src/decoder/idl/marginfi.idl.json`(由上游源码构建生成的 IDL) | [marginfi-v2](https://github.com/mrgnlabs/marginfi-v2) `mrgn-0.1.0` | Apache-2.0,全文见 [third_party/marginfi-v2/LICENSE](third_party/marginfi-v2/LICENSE) |

上游 marginfi 源码**不入库**:`program/build.sh` 构建时在本机拉取固定版本并打补丁(程序地址、mock 价格程序地址,见 `program/README.md` 与 docs/decisions.md D-002、D-009),构建产物与密钥不入库。

`fixtures/` 里是 Solana devnet 上的公开链上数据(交易、账户字节),用于离线测试。
