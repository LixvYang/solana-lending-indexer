# 任务 M7a:钱包交互的后端(交易构建 / 转发 / 水龙头 / 价格维护)

交给 codex 实现。先读 `AGENTS.md`、`docs/decisions.md`(D-008、D-009、D-012、D-013、D-014)、`docs/chapters/ep03-protocol-and-scenario.md`、`src/api/types.ts` 末尾的"钱包交互(M7)"契约(**不要修改**;有异议在汇报里写),并读 `scenario/lib/marginfi.ts`、`scenario/lib/mock-feed.ts`、`scenario/lib/actors.ts`(**已在真实 devnet 验证过的**指令构造、价格账户写入、确定性密钥)。

## 目标

让一个连接了 devnet 钱包的外部用户能对借贷池做 **存款 / 取款 / 借款 / 还款**。前端正由我同时开发,依赖 `src/api/types.ts` 的契约。

## 安全边界(必须遵守,在代码注释里写明理由)

1. **服务端从不持有管理员密钥**(group admin、mint authority、部署钱包)。服务端会用到的签名密钥只有:① 为新 marginfi 账户一次性生成的 keypair;② 公开的、由固定字符串确定性派生的价格账户密钥(`mock-feed.ts` 的 `feedKeypair`);③ 水龙头专用钱包(只在水龙头进程里)。
2. **构建接口永远只返回未签名/部分签名的交易**,由用户钱包签名付费。
3. **转发接口只转发已含用户签名的交易**,并拒绝:交易里没有任何 marginfi 程序指令、手续费付款人不是交易里的签名者、超过 1232 字节。不要把它做成任意交易的中继。
4. 任何响应、日志、错误里都不得出现 `RPC_URL`(含 `api-key`)、私钥内容。

## 要实现

### A. 交易构建 `src/api/builder/`

`POST /api/build`,请求/响应见契约 `BuildRequest` / `BuildResponse`。用 `@coral-xyz/anchor` 的 `Program`(IDL 是 `src/decoder/idl/marginfi.idl.json`,地址取其 `address`)和 `@solana/spl-token` 构造指令(依赖已装好,不要新增)。

- **找池子与账户**:池子(group)取 `getPool(db).group`;bank 地址必须属于这个池子,否则 400。用户的 marginfi 账户:在 `account_states` 里按 `authority = wallet` 且 `group = 池子` 查最新状态;没有则视为"首次"。
- **首次存款**:没有 marginfi 账户时,`deposit` 的交易**同时**包含 `marginfi_account_initialize`:账户是一个新的 `Keypair`(0.1.0 里 marginfi 账户不是 PDA,必须是签名者),**用它对交易部分签名**,`creates_account = true`。其余动作在没有账户时返回 400。
- **指令**:`lending_account_deposit` / `lending_account_withdraw` / `lending_account_borrow` / `lending_account_repay`。`all = true`:repay 用 `repay_all`、withdraw 用 `withdraw_all`(见 IDL 参数 `repay_all` / `withdraw_all`,以 IDL 为准,不要凭记忆)。
- **用户的代币账户(ATA)**:交易最前面加 `createAssociatedTokenAccountIdempotent`(付款人是 wallet),保证存在。
- **remaining accounts(最容易错)**:`borrow` 和 `withdraw` 需要把"操作之后所有 active 余额的 `[bank, 价格账户]` 对"按**余额槽位顺序**传入。规则:解码用户账户状态(`decodeAccount`),取 `lending_account.balances` 里 `active` 的槽位;新建余额(这次要借的、之前没有的 bank)占用**第一个 inactive 槽位**——先模拟出操作后的槽位顺序,再据此排列。价格账户取 bank 的 `config.oracle_keys[0]`。**金标准**:`fixtures/m1-run.json` 里 bob 的 borrow 交易(`bob borrow 5000 tUSDC`)的 remaining 顺序是 `[tSOL bank, tSOL feed, tUSDC bank, tUSDC feed]`——请用 fixture 的**借款前状态**(见下)构造并断言一致。`deposit` / `repay` 不需要 remaining。
- **价格新鲜度**:`borrow` / `withdraw` 要求价格账户的 `last_update_timestamp` 距今不超过 **bank 的 `oracle_max_age`(为 0 时用 240)的一半**,否则返回 409,`error.name = 'PriceStale'`,message 提示"价格维护进程没有运行"。
- **模拟**:构造完成后调用 `simulateTransaction`(`sigVerify: false`, `replaceRecentBlockhash: true`)得到 `simulation`。把失败翻译成 `ProgramErrorView`:`InstructionError` 里的 `Custom` 码按 IDL `errors[]`(`code`、`name`、`msg`)查表;查不到时 `name = 'Unknown'`。对常见错误(健康度不足 `RiskEngineInitRejected`、额度、价格过期 `StaleOracle` 等)给一句中文 `message`(表驱动,放在单独文件)。模拟失败**仍然返回 200 和交易**,只是 `simulation.ok = false`,由前端决定是否允许签名。
- **摘要** `summary`:如"存入 1,000 tUSDC",数量用 `bigint` 精确格式化,不经过 `Number`。
- **版本**:v0 交易,`computeUnitLimit` 400_000,`recentBlockhash` 用 `confirmed`,返回 `last_valid_block_height`。
- RPC 通过注入的接口访问(`getLatestBlockhash`、`simulateTransaction`、`getAccountInfo`、`getBalance`…),便于测试用假实现。

### B. 转发 `POST /api/send`

反序列化 → 做上面的安全检查 → `sendRawTransaction` → 轮询确认(`confirmed`,最多 60 秒,期间每 2 秒重播)→ 返回 `SendResponse`。失败时把链上错误同样翻译成 `ProgramErrorView`。**幂等**:同一笔交易重复提交不应出错。

### C. 钱包信息 `GET /api/wallet/:pubkey`

返回 `WalletView`:SOL 余额、池子里每个 bank 对应 mint 的代币余额(没有 ATA 则为 "0")、该钱包的 marginfi 账户(没有则 null)、`faucet_url`(取环境变量 `FAUCET_URL`,没设为 null)。非法公钥 400。

### D. 路由与服务器

在现有 `src/api/server.ts` 里加上这三个路由(POST 需要读取请求体,限制 64KB,非 JSON 400)。CORS 需允许 POST 与 `content-type`。`scripts/serve-api.ts` 需要 `RPC_URL`(构建/转发/钱包信息要用);**没有配置时这些路由返回 503** 而不是崩溃,原有只读路由照常工作。

### E. 水龙头 `scripts/faucet.ts` + `src/faucet/`

独立进程,默认端口 8788,**只持有一个专用钱包**(`FAUCET_KEYPAIR` 指向的密钥文件)。
- `POST /faucet`,body `{ "wallet": "<pubkey>" }` → 从水龙头钱包的代币账户**转账**(不是铸币,水龙头没有 mint authority)给用户:默认 1,000 tUSDC + 10 tSOL(数量从环境变量读,有默认值);用户的 ATA 不存在时由水龙头创建并付租金。
- **限流**(纯函数,单独测试):同一钱包 10 分钟一次;同一 IP 每小时最多 5 次;全局每天总量上限(默认 2000 次)。超限返回 429 和 `next_allowed_at`。限流状态在内存里即可,注释写明重启会清零。
- 返回契约的 `FaucetResponse`。水龙头钱包的 tUSDC / tSOL 余额不足时返回 503 并说明。
- `scripts/faucet-setup.ts`:一次性准备——若 `FAUCET_KEYPAIR` 文件不存在则生成;**用管理员钱包(`ANCHOR_WALLET`)**给它转 SOL、并**铸造**足量的 tUSDC / tSOL 到它的 ATA(管理员是 mint authority)。支持 `--top-up` 补充。需要联网,**只写代码和可离线部分的测试**,不要运行。

### F. 价格维护 `scripts/price-keeper.ts`

每 60 秒(`--interval`)对每个代币:读取链上价格账户**当前的价格**,用当前链上时间重写时间戳和 slot(保持价格不变),让 marginfi 的过期检查通过。复用 `scenario/lib/mock-feed.ts` 的 `resultRegion` / `writeIx` / `feedKeypair`(不要复制)。付款人是 `ANCHOR_WALLET`(管理员,只在这个进程里)。`scripts/set-price.ts <代币> <价格>` 改价(之后 keeper 会保持新价格)。**keeper 不能因为一次 RPC 失败就退出**:失败就记录并等待下次;连续失败 5 次才非零退出。

## 测试(`node:test`,离线;数据库用 PGlite;RPC 用假实现)

1. **remaining 顺序金标准**:用 `fixtures/m1-accounts.json` 的账户字节构造"借款前"状态(把 bob 的账户改成只有 tSOL 存款:可以在测试里把 `balances` 里 tUSDC 那一槽置为 inactive 并清零份额),断言 `borrow` 的 remaining 为 `[tSOL bank, tSOL feed, tUSDC bank, tUSDC feed]`,且账户列表与 fixture 交易里 borrow 指令的账户一致(除付款人/ATA 可不同,你要写清楚比较哪些)。再测"新 bank 占第一个 inactive 槽位"的排序。
2. **首次存款**:没有账户时交易含 init + deposit,新账户已部分签名,`creates_account = true`;已有账户时不含 init。
3. **指令数据**:deposit / borrow / repay(含 `all`)/ withdraw 的 discriminator 与参数用 `src/decoder` 的 `decodeInstruction` 解回来,与请求一致(往返)。
4. **价格新鲜度**:价格过旧 → 409 `PriceStale`;新鲜 → 通过。
5. **模拟错误翻译**:`Custom: <code>` → IDL 里对应的名字和中文提示;未知码 → `Unknown`。
6. **转发的安全检查**:无 marginfi 指令、付款人没签名、超大交易都被拒绝;响应与日志里没有 `api-key` / `RPC_URL`。
7. **HTTP**:不用真实 socket(沙箱可能禁止),沿用现有 `server.ts` 的纯函数/最小替身测试方式;覆盖 POST 的 200 / 400 / 404 / 413 / 503、CORS 预检。
8. **水龙头**:限流三种情形(同钱包、同 IP、全局)、数量与 ATA 创建逻辑(假 RPC)、余额不足 503、非法公钥 400。
9. **keeper**:读到价格 → 生成的 `write` 指令字节中价格不变而时间戳更新;RPC 失败后继续而不退出;连续 5 次失败才退出。
10. **突变验证**:本地临时改坏至少三处并确认测试失败再还原——例如 remaining 顺序反了、首次存款漏掉 init、`PriceStale` 判断去掉、转发不检查 marginfi 指令。汇报里写明。

## 代码要求

- 教学片段用 `// #region ep8-xxx`(至少:`ep8-remaining`、`ep8-first-deposit`、`ep8-simulate`、`ep8-send-guard`、`ep8-faucet-limit`)。
- 单文件尽量不超过约 150 行,按职责拆分;注释讲原因。不新增依赖,不联网,不发送交易。
- `pnpm typecheck` 与 `pnpm test` 必须通过。
- 在 `docs/progress.md` 新增 M7a 一行,`docs/decisions.md` 追加 D-015(设计取舍与**没有验证**的部分:真实 devnet 的模拟结果、真实水龙头转账、真实 keeper 写入)。
- 不要提交 git。
