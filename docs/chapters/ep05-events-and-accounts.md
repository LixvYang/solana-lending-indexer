# EP5 解析事件与账户状态

## 本集要回答的问题

事件告诉我们"发生了什么",账户状态告诉我们"现在是什么"。**池子的存款、借款、利用率,为什么要以状态为准,而不是把事件加起来?**

## 三个概念

**1. 事件在日志里,要看调用栈。** Anchor 的 `emit!` 把事件写成一行日志 `Program data: <base64>`。解码:base64 → 前 8 字节是事件的 discriminator(`sha256("event:<名字>")` 前 8 字节)→ 其余按 Borsh 解。

但一笔交易的日志里可能夹着**别的程序**的 `Program data:`。归属不能靠猜,要看 `invoke [n]` / `success` / `failed` 维护一个调用栈,**只有栈顶是 marginfi 的时候出现的才算它的**。失败的交易会整体回滚,即使日志里有事件也不能算数。

**2. 账户不是 Borsh,是 `zero_copy`。** 事件是紧凑的 Borsh;但 marginfi 的 `Bank`、`MarginfiAccount`、`MarginfiGroup` 是 **`repr(C)` 的 `zero_copy` 结构**:字段按固定偏移和**对齐**摆放,字段之间有 padding。

- `pubkey`:32 字节,对齐 1
- `u64`:8 字节,对齐 8
- `WrappedI80F48`:16 字节,但因为 `repr(align = 8)`,按 **8** 对齐(而不是 i128 通常的 16)

所以偏移不能靠加加减减口算,要**由 IDL 算出来**,再用真实账户的字节长度验证:`Bank` 1856 字节、`MarginfiAccount` 2304、`MarginfiGroup` 1056、`FeeState` 256,各加 8 字节 discriminator,正好等于链上账户的长度。

**3. 定点数。** 份额和份额价值是 `WrappedI80F48`:一个 128 位有符号整数,**低 48 位是小数**,存成 16 字节小端。

```
真实值 = 有符号整数 / 2^48
数量   = 份额的整数 × 份额价值的整数 / 2^96
```

## 代码走读

### 事件:从日志里找回来

<!-- snippet: src/decoder/event.ts#ep5-log-stack -->
```ts
const stack: string[] = [];
let ixIndex = -1;
for (const [logIndex, log] of logs.entries()) {
  if (log === 'Log truncated') break;
  const invoke = /^Program (\S+) invoke \[(\d+)\]$/.exec(log);
  if (invoke) {
    const depth = Number(invoke[2]);
    if (depth === 1) ixIndex++;
    stack.length = depth - 1; stack.push(invoke[1]);
    continue;
  }
  const exit = /^Program (\S+) (?:success|failed:.*)$/.exec(log);
  if (exit) {
    if (stack.at(-1) === exit[1]) stack.pop();
    continue;
  }
  if (stack.at(-1) !== idl.address || !log.startsWith('Program data: ')) continue;
  result.events.push({ signature: rpcTx.transaction.signatures[0], ixIndex, logIndex,
    ...decodeData(log.slice('Program data: '.length), idl) });
}
```
<!-- /snippet -->

<!-- snippet: src/decoder/event.ts#ep5-event-parse -->
```ts
function decodeData(encoded: string, idl: Idl) {
  let name = 'unknown';
  try {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('invalid base64');
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length < 8) throw new Error('need 8 event discriminator bytes');
    const discriminator = bytes.subarray(0, 8).toString('hex');
    const entry = idl.events?.find(e => Buffer.from(e.discriminator).equals(bytes.subarray(0, 8)));
    if (!entry) return { name, data: encoded, discriminator };
    name = entry.name;
    const reader = new Reader(bytes.subarray(8));
    const data = decodeType({ defined: { name } }, reader, idl) as Record<string, unknown>;
    if (reader.remaining) throw new Error(`trailing event bytes: ${reader.remaining}`);
    return { name, data };
  } catch (error) {
    return { name, data: encoded, decodeError: error instanceof Error ? error.message : String(error) };
  }
}
```
<!-- /snippet -->

### 账户:布局由 IDL 算出

<!-- snippet: src/decoder/layout.ts#ep5-layout -->
```ts
export function layout(type: IdlType | string, idl: Idl): Layout {
  if (typeof type === 'object') {
    if ('array' in type) {
      const element = layout(type.array[0], idl);
      return { size: element.size * type.array[1], align: element.align };
    }
    if ('defined' in type) return layout(type.defined.name, idl);
    throw new Error('zero_copy requires a fixed size type');
  }
  if (type === 'pubkey') return { size: 32, align: 1 };
  if (type === 'bool') return { size: 1, align: 1 };
  if (/^[uif](8|16|32|64|128)$/.test(type)) {
    const size = Number(type.slice(1)) / 8;
    return { size, align: size };
  }
  const definition = idl.types?.find(entry => entry.name === type);
  if (!definition) throw new Error(`undefined fixed layout type: ${type}`);
  if (definition.type.kind === 'enum') {
    if (definition.type.variants.some(v => v.fields?.length)) throw new Error(`enum with fields is not a fixed layout: ${type}`);
    // 此固定版本的无字段枚举按 u8；账户 fixture 与 Anchor 字段对照验证。
    return { size: 1, align: 1 };
  }
  if (definition.repr?.kind !== 'c') throw new Error(`not repr(C): ${type}`);
  let end = 0, align = definition.repr.align ?? 1;
  // #region ep5-padding
  const fields = (definition.type.fields ?? []).map((field, index) => {
    const named = typeof field === 'object' && 'name' in field;
    const fieldType = named ? field.type : field as IdlType;
    const child = layout(fieldType, idl), previousEnd = end;
    // 字段必须从自身对齐的倍数开始；显式 _pad 字段之外仍可能有隐式空隙。
    const offset = alignUp(end, child.align);
    end = offset + child.size; align = Math.max(align, child.align);
    return { ...child, name: named ? field.name : String(index), type: fieldType,
      offset, previousEnd, padding: offset - previousEnd };
  });
  // 尾部也补齐，保证数组中下一个结构体仍符合对齐。
  return { size: alignUp(end, align), align, fields, tailPadding: alignUp(end, align) - end };
```
<!-- /snippet -->

padding 就是这样出现的——下一个字段要对齐到它自己的倍数,中间的空隙就是 padding:

<!-- snippet: src/decoder/layout.ts#ep5-padding -->
```ts
const fields = (definition.type.fields ?? []).map((field, index) => {
  const named = typeof field === 'object' && 'name' in field;
  const fieldType = named ? field.type : field as IdlType;
  const child = layout(fieldType, idl), previousEnd = end;
  // 字段必须从自身对齐的倍数开始；显式 _pad 字段之外仍可能有隐式空隙。
  const offset = alignUp(end, child.align);
  end = offset + child.size; align = Math.max(align, child.align);
  return { ...child, name: named ? field.name : String(index), type: fieldType,
    offset, previousEnd, padding: offset - previousEnd };
});
// 尾部也补齐，保证数组中下一个结构体仍符合对齐。
return { size: alignUp(end, align), align, fields, tailPadding: alignUp(end, align) - end };
```
<!-- /snippet -->

想亲眼看一遍偏移表:

```bash
pnpm exec tsx scripts/print-layout.ts Bank
```

### 定点数:全程不碰 Number

<!-- snippet: src/core/fixed.ts#ep5-fixed -->
```ts
export function toRational(bytes: Uint8Array) {
  if (bytes.length !== 16) throw new Error(`I80F48 needs 16 bytes, got ${bytes.length}`);
  return { numerator: new Reader(bytes).i128(), denominator: 2n ** 48n };
}
export function toDecimal(bytes: Uint8Array): string {
  const { numerator, denominator } = toRational(bytes);
  const absolute = numerator < 0n ? -numerator : numerator;
  // 1 / 2^48 = 5^48 / 10^48，小数最多 48 位，整个过程没有浮点舍入。
  const fraction = ((absolute % denominator) * 5n ** 48n).toString().padStart(48, '0').replace(/0+$/, '');
  return `${numerator < 0n ? '-' : ''}${absolute / denominator}${fraction ? `.${fraction}` : ''}`;
}
```
<!-- /snippet -->

## JS 里为什么不能直接用 Number

`Number` 只有 53 位尾数,而 I80F48 需要 128 位。常见的做法是用 `BigNumber` / `decimal.js`。我们对比过另一个真实前端(mrgn 的 `fluxor-ui-v4`)的转换函数,跑了它的代码,有两点值得知道:

- **默认精度只有 20 位有效数字。** 真实 bank 的份额价值精确值是 `1.000000155398776513493430684320628643035888671875`,`decimal.js` 默认精度下得到 `1.0000001553987765135`。显示够用,做精确对账就不够了。
- **负数少加了 1。** 二补码取负数的绝对值要"按位取反再加 1",它只取反不加 1,于是 `-1.5` 变成 `-1.4999999999999964`,最小的负数 `-2⁻⁴⁸` 变成 `0`。误差只有 3.6e-15,对页面显示没影响。

我们用原生 `bigint` 做整数运算,**服务端算出精确的原生数量,以十进制字符串发给前端**,前端只负责格式化。

## 对账:事件和状态是不是讲同一个故事

这是本集的结论。三层检查:

**1. 精确不变量。** 每个 bank 里,三个用户账户的份额之和,按原始位数**等于**这个 bank 记录的总份额。与利息无关。四个差全部是 0。

**2. 与 Anchor 的快照完全相等。** 由原始字节算出的每个账户在每个 bank 的"份额 × 份额价值",与剧本运行时 Anchor 算出的有理数**逐位相等**。

**3. 事件净流量 vs 状态数量。** 把存款、取款、借款、还款事件累加成净额,和状态里的数量比较,**两者并不相等**:

| 账户 / 池子 | 状态 − 事件净流量(原生单位) |
|---|---:|
| Alice / tUSDC 存款 | +1546.589 |
| Carol / tUSDC 存款 | +348.539 |
| Bob / tUSDC 借款 | +2176.000 |
| 其余 | 0 |

差值来自三个地方:**利息**(事件里没有逐账户的利息)、**清算事件里的数量是程序用 f64 发出来的**(本身有精度损失)、`repay_all` 的**向上取整**。

怎么确认这些差就是利息?用三个互不依赖的量:

| 量 | 来源 | 数值 |
|---|---|---:|
| 存款人所得 | 账户状态 | 1895.128 |
| 协议费 + 保险费 | 程序发出的 7 条计息事件里的 `fees_collected`、`insurance_collected` | 280.121 |
| 借款人多付 | 账户状态 | 2176.000 |

**1895.128 + 280.121 = 2175.249,与 2176.000 只差 0.751 个原生单位**,不到 1,正是 `repay_all` 向上取整小于 1 的量级。

**结论:池子指标以账户状态为准;事件用来做活动流。** 事件加起来对不上状态,不是解码器错了,而是事件本来就不携带全部信息。

## 它是怎么被验证的

- 32 笔真实交易里的 25 条事件,与运行时 Anchor `EventParser` 的结果逐条、逐字段一致。
- 7 个真实账户的所有字段,与 Anchor 账户 coder 逐字段一致。
- **突变验证**:偏移 +8、定点数经过 `Number`、失败交易仍产出事件、清算比例改成 1、事件不看调用栈、符号丢失——测试都必须失败。

## 常见坑

- **一个事件不等于一条指令。** 一笔借款发出两个事件(先计息、再借款);另一方面,CPI 里别的程序的 `Program data:` 也不能误当成 marginfi 的。
- **事件里的 f64 不是精确值。** 例如清算事件里的 `5512499999.999999`——这不是我们算错了,是程序发出来就是这样。
- **39/38 是名义清算折扣比。** 清算事件没有报告清算人在负债 bank 的存款消耗,我们按名义比例推算,没有逐位还原上游的定点截断。
- **账户解码只收字节,不核对 owner。** 谁调用谁负责检查——EP6 里的快照代码就这样做。
- **`delta` 是秒数。** 计息事件里的 `delta` 是距上次计息经过的秒数,不是利息。

## 下一集

EP6:原始交易怎么存、游标怎么推进,才能做到"同一批数据入库两次、中途崩溃后重跑,结果完全一样"?
