/** 原生单位(十进制字符串)→ 代币数量。用 BigInt 做，不经过 Number，避免 u64 超出安全整数后丢精度。 */
export function fmtToken(native: string | null, decimals: number, maxFraction = 4): string {
  if (native == null) return '—';
  const negative = native.startsWith('-');
  const value = BigInt(negative ? native.slice(1) : native);
  const base = 10n ** BigInt(decimals);
  const whole = (value / base).toLocaleString('en-US');
  const fraction = (value % base).toString().padStart(decimals, '0').slice(0, maxFraction).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const usdCompact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
export const fmtUsd = (value: number | null) => (value == null ? '—' : Math.abs(value) >= 1e6 ? usdCompact.format(value) : usd.format(value));
export const fmtPct = (value: number | null, digits = 1) => (value == null ? '—' : `${(value * 100).toFixed(digits)}%`);
export const short = (address: string | null, n = 4) => (address ? `${address.slice(0, n)}…${address.slice(-n)}` : '—');
export const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—');
// 权重在链上是 I80F48 定点数，0.8 存成 0.79999…；显示时取 3 位小数，别把定点数的舍入噪声摆给读者。
export const fmtWeight = (w: number) => String(Number(w.toFixed(3)));
