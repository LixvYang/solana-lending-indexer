# EP8 钱包交互:让外部用户操作借贷池(可选集)

## 本集要回答的问题

怎么让连着钱包的用户对借贷池存款、取款、借款、还款,同时**不给服务端任何不该有的权力**?

## 架构

```
 浏览器 + 钱包(Phantom 等)
      │  ① POST /api/build   {动作, 钱包地址, 代币, 数量}
      │  ←  未签名的交易 + 模拟结果(成功/失败的人话)
      │  ② 钱包签名(用户确认)
      │  ③ POST /api/send    {已签名的交易}
      ▼
   API ──► RPC(Helius 密钥只在服务端)
   
 水龙头(独立进程,专用钱包)      价格维护进程(独立,管理员钱包)
```

交易**由服务端构建、钱包签名、服务端转发**。这样做有三个理由:浏览器里不需要塞进 Anchor;RPC 的 API key 不会暴露给浏览器;发送之前能先**模拟**,把链上错误翻译成人话,用户不会白花手续费。

## 谁能签什么

这是整集最重要的一张表。

| 密钥 | 在哪 | 签什么 | 能做什么坏事 |
|---|---|---|---|
| **用户钱包** | 用户自己的钱包 | 自己的交易,并付手续费 | 只能动自己的资产 |
| **一次性 marginfi 账户密钥** | 构建接口里临时生成,不落盘 | 只签"创建这个账户" | 无 |
| **公开的价格账户密钥** | 由固定字符串派生,**公开** | 写价格(演示用 mock) | 任何人本来就能写,所以不构成新风险 |
| **水龙头专用钱包** | 只在水龙头进程里 | 转账测试币 | 最多转走水龙头里有的那点测试币 |
| **管理员钱包**(group admin、mint authority) | **只在命令行工具里**(`faucet-setup`、`price-keeper`) | 铸币、写价格 | **绝不进任何常驻的、对外的服务** |

API 进程里没有管理员密钥。转发接口还会拒绝:交易里没有 marginfi 指令的、手续费付款人没有签名的、含地址表的、超过 1232 字节的、签名无法通过 Ed25519 验证的——它不是一个"任意交易中继"。

## 三个 marginfi 的特殊点

**1. 账户不是 PDA。** 在 mrgn-0.1.0 里,用户的 marginfi 账户是一个**随机生成的 keypair**,创建它必须由它自己签名。所以首次存款的交易里同时包含"创建账户"和"存款",账户密钥只用来签这一次,然后丢掉。

<!-- snippet: src/api/builder/index.ts#ep8-first-deposit -->
```ts
// 账户不是 PDA；唯一一次性 keypair 只签自己的创建，不为用户付费，也不落盘。
const fresh = user ? null : Keypair.generate(), account = user ? new PublicKey(user.address) : fresh!.publicKey;
if (fresh) instructions.push(await initInstruction(group, account, wallet));
const amount = request.all ? 0n : BigInt(request.amount);
instructions.push(await lendingInstruction(request.action, group, account, wallet, target, ata, amount, request.all === true, metas));
const latest = await services.rpc.getLatestBlockhash('confirmed');
const tx = new VersionedTransaction(new TransactionMessage({ payerKey: wallet, recentBlockhash: latest.blockhash, instructions }).compileToV0Message());
if (fresh) tx.sign([fresh]);
```
<!-- /snippet -->

**2. 借款和取款要传"操作之后所有头寸的 bank + 价格账户"(remaining accounts),顺序必须和余额槽位一致。** 风险引擎按槽位顺序读它们。新开的头寸占用**第一个空闲槽位**,而不是追加到末尾:

<!-- snippet: src/api/builder/remaining.ts#ep8-remaining -->
```ts
export function remainingBanks(balances: Position[], action: WalletAction, target: string, all: boolean): string[] {
  const slots = balances.map(b => b.active ? b.bank_pk : null);
  // find_or_create 用第一个 inactive，不能把新 bank 简单 append 到 active 列表末尾。
  if (action === 'borrow' && !slots.includes(target)) {
    const index = slots.indexOf(null);
    if (index < 0) throw new ApiError(400, 'balance slots full');
    slots[index] = target;
  }
  // mrgn-0.1.0 withdraw_all 在健康检查前 close balance；部分取款保留槽位。
  if (action === 'withdraw' && all) return slots.filter((b): b is string => b !== null && b !== target);
  return slots.filter((b): b is string => b !== null);
}
export function observation(addresses: string[], banks: Record<string, BuildBank>, group: string): AccountMeta[] {
  return addresses.flatMap(address => {
    const bank = banks[address];
    if (!bank || bank.group !== group) throw new ApiError(400, 'active bank outside pool');
    return [address, bank.config.oracle_keys[0]].map(key => ({ pubkey: new PublicKey(key), isSigner: false, isWritable: false }));
  });
}
```
<!-- /snippet -->

怎么确认排对了?用 EP2 里那笔真实的借款交易当金标准:账户列表和 remaining 的顺序**与链上真实交易完全一致**。

**3. 同一个 bank 的头寸要么是存款、要么是负债。** 如果你在 tUSDC 里有存款,再"借 tUSDC",程序会**先把你自己的存款取出来**,扣完才开始产生负债。这不是 bug,但非常容易让人困惑——我们自己写测试剧本时就踩过:存了 500 tUSDC 再借 200 tUSDC,结果存款变成了 300,借款还是 0,后面"还款"报"没有待偿还的借款"。想借出来,请用**另一种**代币做抵押。界面里会提示这一点。

## 发送之前先模拟

<!-- snippet: src/api/builder/index.ts#ep8-simulate -->
```ts
const simulated = (await services.rpc.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' })).value;
const simulation = { ok: simulated.err === null, error: simulated.err === null ? null : programError(simulated.err),
  logs: publicLogs(simulated.logs), units_consumed: simulated.unitsConsumed ?? null };
```
<!-- /snippet -->

模拟失败**仍然返回交易**,只是 `simulation.ok = false`,由前端决定能不能签名。常见的链上错误被翻译成人话,例如借款后健康度不足(`RiskEngineInitRejected`):"借款后健康度不足,请减少借款数量或先增加抵押"。

## 转发的安全守卫

<!-- snippet: src/api/send.ts#ep8-send-guard -->
```ts
export function guardTransaction(input: unknown): { bytes: Buffer; signature: string } {
  const value = objectBody(input).transaction;
  if (typeof value !== 'string' || !value.length || value.length > 1644 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new ApiError(400, 'invalid transaction encoding/size');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > 1232) throw new ApiError(400, 'transaction exceeds 1232 bytes');
  let tx: VersionedTransaction;
  try { tx = VersionedTransaction.deserialize(bytes); }
  catch { throw new ApiError(400, 'invalid transaction'); }
  if (tx.version !== 0 || tx.message.addressTableLookups.length) throw new ApiError(400, 'only v0 transactions without lookup tables are supported');
  const message = tx.message, count = message.header.numRequiredSignatures;
  if (!count || !message.isAccountSigner(0) || tx.signatures.length !== count) throw new ApiError(400, 'fee payer must be a signer');
  if (!message.compiledInstructions.some(ix => message.staticAccountKeys[ix.programIdIndex]?.toBase58() === marginfiIdl.address)) throw new ApiError(400, 'missing marginfi instruction');
  // 非零字节不是签名证据；验证所有 required signatures，尤其是 payer 的 Ed25519 签名。
  // 服务端绝不补签或承担费用；ALT 拒绝，避免未解析的地址绕过程序检查。
  const data = message.serialize();
  for (let i = 0; i < count; i++) {
    const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), message.staticAccountKeys[i].toBuffer()]), format: 'der', type: 'spki' });
    if (!verify(null, data, key, tx.signatures[i])) throw new ApiError(400, 'missing or invalid signature');
  }
  if (!Buffer.from(tx.serialize()).equals(bytes)) throw new ApiError(400, 'noncanonical transaction');
  return { bytes, signature: encodeBase58(tx.signatures[0]) };
}
```
<!-- /snippet -->

## 价格维护进程

marginfi 要求价格在 `oracle_max_age`(我们配的是 240 秒)内更新过。**没有人更新,借款和取款就会失败。** 真实的 Switchboard 靠 oracle 持续推送;我们用的是 mock 价格(EP3),所以需要一个进程每 60 秒把价格账户的时间戳和 slot 重写一次,**价格本身保持不变**。

构建接口还会提前检查:价格距今超过 `oracle_max_age` 的**一半**就拒绝并提示"价格维护进程没有运行"——而不是让用户签了名才失败。

> 这个进程用管理员钱包付手续费,所以它是命令行工具,不是 API 的一部分。改价用 `scripts/set-price.ts`。

## 水龙头

用户需要测试代币才能玩。水龙头是**独立进程**,只持有一个专用钱包,**只转账、不铸币**:管理员用 `faucet-setup` 一次性把足量的测试币铸造到水龙头钱包里,之后水龙头只是从里面转给用户。

<!-- snippet: src/faucet/limit.ts#ep8-faucet-limit -->
```ts
export function reserve(state: LimitState, wallet: string, ip: string, now: number, dailyMax = 2000):
  { ok: true; state: LimitState; next: number } | { ok: false; next: number } {
  const day = new Date(now).toISOString().slice(0, 10), count = state.day === day ? state.count : 0;
  const ips = Object.fromEntries(Object.entries(state.ips).map(([key, times]) => [key, times.filter(t => t > now - 3600_000)]).filter(([, times]) => times.length));
  const wallets = Object.fromEntries(Object.entries(state.wallets).filter(([, time]) => time + 600_000 > now));
  const hits = ips[ip] ?? [], deadlines = [now];
  if (wallets[wallet] !== undefined) deadlines.push(wallets[wallet] + 600_000);
  if (hits.length >= 5) deadlines.push(hits[hits.length - 5] + 3600_000);
  if (count >= dailyMax) deadlines.push(Date.parse(`${day}T00:00:00Z`) + 86400_000);
  const next = Math.max(...deadlines);
  if (next > now) return { ok: false, next };
  const updated = [...hits, now];
  const nextAfterGrant = Math.max(now + 600_000, updated.length >= 5 ? updated[updated.length - 5] + 3600_000 : now,
    count + 1 >= dailyMax ? Date.parse(`${day}T00:00:00Z`) + 86400_000 : now);
  return { ok: true, state: { wallets: { ...wallets, [wallet]: now }, ips: { ...ips, [ip]: updated }, day, count: count + 1 }, next: nextAfterGrant };
}
```
<!-- /snippet -->

限流:同一个钱包 10 分钟一次;同一个 IP 每小时 5 次;每天全局有上限。限流状态在内存里,**重启会清零**。

## 跑一遍

```bash
pnpm exec tsx scripts/faucet-setup.ts          # 一次性:创建水龙头钱包并充值(需管理员钱包)
pnpm exec tsx scripts/price-keeper.ts          # 终端 1:价格维护
pnpm exec tsx scripts/serve-api.ts             # 终端 2:API(需要 RPC_URL;POOL_GROUP 指定池子)
pnpm exec tsx scripts/faucet.ts                # 终端 3:水龙头
pnpm exec tsx scripts/ingest.ts --follow       # 终端 4:实时跟随链上新交易
(cd web && pnpm dev)                           # 终端 5:前端 http://localhost:5173
```

不想点界面,可以用端到端脚本——它用一个全新的钱包通过真实的 HTTP 接口走完整个流程:

```bash
pnpm exec tsx scripts/e2e-wallet.ts
```

在真实 devnet 上的一次运行:

| 步骤 | 结果 | 计算单元 |
|---|---|---:|
| 领测试币 | 1,000 tUSDC + 10 tSOL 到账 | — |
| 首次存款 10 tSOL(自动创建账户) | ✓ | 27,328 |
| 借 200 tUSDC | ✓ 借份额 199,999,910 | 51,503 |
| 还清(`repay_all`) | ✓ 借份额归零 | 35,811 |
| 再存 100 tUSDC(账户已存在,不再创建) | ✓ | 22,579 |
| 取出全部 tUSDC | ✓ | 36,733 |
| 取出全部 tSOL | ✓ | 22,424 |

最后钱包里 tSOL 回到 10,tUSDC 是 999.999997——借了 200 又还清,**差的 0.000003 就是利息**。

没有 Phantom 的环境怎么测?前端有一个**只在开发模式可用**的测试钱包:`http://localhost:5173/?testwallet=任意种子`,密钥由种子派生、只在内存里。用它在界面上走了一遍同样的流程。生产构建里没有这段代码(构建后 `grep` 验证过)。

## 真实联调中发现的问题

离线测试 130 多项全部通过之后,接上真实 devnet 和真实浏览器,又暴露了这些问题:

1. **索引器有延迟,会让用户重复创建账户。** 最初的构建器只看数据库里的账户快照。用户刚存完款、索引器还没追上时,下一次存款会被当成"首次",**再创建一个账户**;快照里的余额槽位过期还会让 remaining 顺序排错。现在**用户账户的内容永远从链上读最新**,地址先查数据库,查不到就按 `group + authority` 过滤链上账户。
2. **数据库里有多个池子。** 每次重跑剧本都会新建一个 group,实时跟随会把它们全部入库,API 就不知道"当前池子"是哪个(此前的行为是返回 `null`,因为它不猜)。现在用环境变量 `POOL_GROUP` 指定;池子、账户、活动流都只看这个 group。
3. **跨域被浏览器拦下。** 页面用 `127.0.0.1` 打开时,水龙头(另一个端口)的请求被拦——放行名单写死了 `localhost`。`/api` 走同源代理,所以只有水龙头暴露了问题。现在按请求的 `Origin` 匹配白名单。
4. **`oracle_max_age = 0` 的默认值。** 最初的实现在 0 时默认取 240 秒。核对上游源码:对 `SwitchboardPull`,0 就是 0,没有默认值。编造默认值会掩盖配置错误,已去掉。
5. **脚本跑完不退出。** `sendAndConfirmTransaction` 会开 WebSocket 订阅,脚本成功后不主动退出,进程会一直挂着。

## 局限

- **仅 devnet、仅测试币。** 水龙头的限流在内存里,没有真正的防刷;没有信任代理时只看 socket IP,不信 `X-Forwarded-For`。
- **只支持普通 SPL Token。** 不支持 Token-2022 和 staked asset 这类特殊的 remaining accounts。
- **价格维护进程和改价可能互相覆盖。** 它们并发时,可能读到旧价格后覆盖新值。演示改价请先停维护进程,改完再启动。
- **转发超时不等于交易没上链。** 原签名可能稍后成功,不要直接重复构建。
- **价格是 mock。** Switchboard oracle 离线,见 EP3。

## 回顾

整个系列从"一笔链上交易长什么样",一直走到"让别人也能往里发交易"。能放心做最后这一步,靠的是前面七集打下的东西:**解码器能把任何一笔交易还原成人话**,所以我们发出去的交易,也能被同一套流水线解析、对账、展示。
