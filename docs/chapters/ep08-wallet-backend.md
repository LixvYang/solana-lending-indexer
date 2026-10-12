# EP8 钱包后端（M7a，离线验收）

钱包 API 的契约固定在 `src/api/types.ts`。`POST /api/build` 构建 v0，钱包签名付费后把 base64 发给 `POST /api/send`；`GET /api/wallet/:pubkey` 读取 SOL、SPL ATA 与当前池子 marginfi 账户。API 不读管理员钱包，不补用户签名。

## 构建与转发

- Bank 必须属于 `getPool(db).group`。用户账户按每个地址最新状态的 authority/group 选择；有多个时取 slot 最大者，同 slot 按地址稳定排序。
- 首次只能存款，交易含 ATA 幂等创建、compute budget、marginfi init 与 deposit。新账户 keypair 只部分签名，用户签名仍为空；不保存密钥。
- 借款/取款按操作后余额槽位排列 bank/feed 对。新 bank 占第一个 inactive，`withdraw_all` 关闭槽位。教学区域：`src/api/builder/remaining.ts#ep8-remaining`、`index.ts#ep8-first-deposit`。
- 新鲜度读取当前链上 feed；age 必须不超过 `oracle_max_age / 2`，0 使用 240 秒。超过/缺失返回 409 `PriceStale`。未来时间戳也拒绝。当前 demo 是普通 SPL Token，不支持 Token-2022/staked asset 特殊 remaining。
- `src/api/builder/index.ts#ep8-simulate` 使用 sigVerify=false/replaceRecentBlockhash=true；模拟失败仍返回交易和中文错误，RPC 本身失败为固定 500。
- `src/api/send.ts#ep8-send-guard` 验证签名、marginfi 程序和大小；只支持无 ALT 的 v0。每 2 秒重播同一份字节，最多 60 秒，重复提交先查历史签名状态。timeout 不代表交易一定没有落链；原签名可能稍后成功，勿直接重复构建。
- 只保留公开 runtime 执行框架日志；任意 Program log/data 输出省略，避免配置/密钥泄漏。未知链上错误不回显原文。

## 独立工具

正常路径会联网或发交易，以下命令本次均未运行；`--help` 与非法参数已离线运行。用 `node --import tsx` 避开沙箱下 tsx CLI 的 IPC 管道限制。

| 工具 | 配置与行为 |
|---|---|
| `scripts/serve-api.ts` | DATABASE_URL、PORT(8787)，RPC_URL 可选；缺 RPC 时钱包路由 503，只读路由可用；FAUCET_URL 返回给前端 |
| `scripts/faucet-setup.ts [--top-up]` | ANCHOR_WALLET + FAUCET_KEYPAIR + RPC_URL；新文件用 wx/0600 写入。默认转 2 SOL、铸造 2,000,000 tUSDC/20,000 tSOL；可用 FAUCET_SETUP_SOL/TUSDC/TSOL 覆盖。文件存在时默认不再补币，失败后用 --top-up 重试 |
| `scripts/faucet.ts` | 只读 FAUCET_KEYPAIR，不读 ANCHOR_WALLET；从 Db 的 tUSDC/tSOL 标签定位 mint；默认 8788，只转账，无铸币 |
| `scripts/price-keeper.ts [--interval 秒]` | 独立读取 ANCHOR_WALLET；默认 60 秒；从链上读取精确价格和时间，使用公开 feedKeypair 写时间/slot，成功重置失败计数，连续 5 次失败退出 1 |
| `scripts/set-price.ts <tUSDC\|tSOL> <价格>` | 最多 18 位小数的精确正数；keeper 下轮保持新价格 |

水龙头 `POST /faucet` body 是 `{ "wallet": "公钥" }`，默认每次转 1,000 tUSDC + 10 tSOL(FAUCET_TUSDC_AMOUNT / FAUCET_TSOL_AMOUNT，用 UI 数量配置)。同钱包 10 分钟、同 socket IP 滚动一小时 5 次、UTC 每日 FAUCET_DAILY_MAX(默认 2000)次。状态在内存，重启清零；先同步预留，失败也计数，避免并发/确认超时放大。429 返回 `next_allowed_at`，代币余额不足 503；一笔原子交易创建两个 ATA 并转账。代理部署需另外配置可信代理，当前不信任 X-Forwarded-For。

## 验证边界

fixture 借款前状态由结束账户原始字节去掉 Bob 的 tUSDC 槽位得到。borrow 的全部固定账户角色(group/account/signer/bank/vault/authority/token program/ATA)及 remaining 与原交易完全一致；payer、compute budget、ATA 创建属于外围指令，不属于该比较的账户列表。

离线测试不能证明真实 devnet 模拟/钱包兼容/转账/keeper 写入成功。没有运行数据库服务、HTTP socket、前端联调、长时间进程或负载测试。账户发现依赖 finalized indexer 快照：刚建账户还没入库时，再次 build 可能生成另一账户；快照没有关闭墓碑，混合 slot 状态和 stale bank config 可能影响构建，最终仍须以模拟/链上检查为准。keeper 与改价并发时可能发生读旧值后覆盖新值，演示改价建议先停 keeper，再改价后重启。
