import { useEffect, useMemo, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import type { FaucetResponse, SwapAsset, SwapRatesView, WalletTokenView } from '@contract';
import { fmtToken, toNative } from '../format';
import { b64, chain, deskBase, explorer, swap } from './chain';

const ASSETS: SwapAsset[] = ['SOL', 'tSOL', 'tUSDC'];
const KEEP_SOL = 10_000_000n; // 卖出 SOL 时留 0.01 SOL 付手续费和账户租金

/**
 * 获取测试币的两种方式:
 *  - 水龙头:免费,有限流;
 *  - 兑换:SOL / tSOL / tUSDC 任意两两互换。固定汇率的原子兑换(一笔交易里 你给出 + 兑换台给出)。
 * 测试币是自己发行的,没有真实的 AMM 池子,所以汇率由统一的 USD 单价推导,是 mock,不是市场价。
 */
export function GetTokens({ address, faucetUrl, tokens, solLamports, onDone }: { address: string; faucetUrl: string; tokens: WalletTokenView[]; solLamports: bigint; onDone: () => void }) {
  const { signTransaction } = useWallet();
  const base = deskBase(faucetUrl);
  const [rates, setRates] = useState<SwapRatesView | null>(null);
  const [from, setFrom] = useState<SwapAsset>('SOL');
  const [to, setTo] = useState<SwapAsset>('tUSDC');
  const [amount, setAmount] = useState('0.1');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string; link?: string } | null>(null);
  useEffect(() => { swap.rates(base).then(setRates).catch(() => setRates(null)); }, [base]);

  const meta = useMemo(() => Object.fromEntries((rates?.assets ?? []).map((a) => [a.symbol, { decimals: a.decimals, usdMicro: BigInt(toNative(a.usd, 6) ?? '0') }])) as Record<SwapAsset, { decimals: number; usdMicro: bigint }>, [rates]);
  const balance = (a: SwapAsset): bigint => a === 'SOL' ? solLamports : BigInt(tokens.find((t) => t.label === a)?.amount ?? '0');
  const decimals = (a: SwapAsset) => meta[a]?.decimals ?? (a === 'tUSDC' ? 6 : 9);

  // 和服务端同一个公式(整数、向下取整):显示的预估永远不会比实际到手多。
  const nativeIn = rates ? toNative(amount, decimals(from)) : null;
  const out = nativeIn && rates ? BigInt(nativeIn) * meta[from].usdMicro * 10n ** BigInt(decimals(to)) / (meta[to].usdMicro * 10n ** BigInt(decimals(from))) : null;
  const valueMicro = nativeIn && rates ? BigInt(nativeIn) * meta[from].usdMicro / 10n ** BigInt(decimals(from)) : null;
  const spendable = from === 'SOL' ? (solLamports > KEEP_SOL ? solLamports - KEEP_SOL : 0n) : balance(from);
  const minMicro = BigInt(toNative(rates?.min_usd ?? '0', 6) ?? '0'), maxMicro = BigInt(toNative(rates?.max_usd ?? '0', 6) ?? '0');
  const problem = !rates || !amount ? null
    : !nativeIn ? '数量格式不对。'
    : BigInt(nativeIn) === 0n ? null
    : BigInt(nativeIn) > spendable ? (from === 'SOL' ? `SOL 余额不够(需留 0.01 SOL 付手续费)。` : `${from} 余额不够。`)
    : valueMicro! < minMicro ? `单笔至少 $${rates.min_usd}。` : valueMicro! > maxMicro ? `单笔最多 $${rates.max_usd}。` : null;
  const canExchange = Boolean(!busy && rates && nativeIn && BigInt(nativeIn) > 0n && out && out > 0n && !problem);
  const rate = rates ? Number(meta[from].usdMicro) / Number(meta[to].usdMicro) : null;

  const pickFrom = (v: SwapAsset) => { if (v === to) setTo(from); setFrom(v); };
  const pickTo = (v: SwapAsset) => { if (v === from) setFrom(to); setTo(v); };
  const flip = () => { setFrom(to); setTo(from); };
  const useMax = () => setAmount(fmtToken(spendable.toString(), decimals(from), decimals(from)).replace(/,/g, ''));

  const claim = async () => {
    setBusy('领取中…'); setNote(null);
    try {
      const r: FaucetResponse = await chain.faucet(faucetUrl, address);
      onDone();
      setNote({ ok: true, text: `已到账:${r.granted.map((g) => `${fmtToken(g.amount, decimals(g.label as SwapAsset))} ${g.label}`).join('、')}` });
    } catch (e) { setNote({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  };

  const exchange = async () => {
    if (!signTransaction) return;
    setBusy('向兑换台报价…'); setNote(null);
    try {
      const quote = await swap.quote(base, { wallet: address, from, to, amount });
      setBusy('请在钱包里确认…');
      const signed = await signTransaction(VersionedTransaction.deserialize(b64.decode(quote.transaction)));
      setBusy('发送并等待确认…');
      const sent = await swap.send(base, b64.encode(signed.serialize()));
      if (sent.status === 'confirmed') onDone();
      setNote(sent.status === 'confirmed'
        ? { ok: true, text: `✓ 兑换成功:${quote.summary}`, link: explorer(sent.signature) }
        : { ok: false, text: sent.status === 'timeout' ? '确认超时(交易可能仍会上链)' : `失败:${sent.error?.message ?? ''}`, link: explorer(sent.signature) });
    } catch (e) { setNote({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  };

  return (
    <div className="gettokens">
      <div className="label" style={{ marginTop: 12 }}>获取测试币</div>
      <p style={{ margin: '6px 0' }}><button className="theme" onClick={claim} disabled={Boolean(busy)}>水龙头(免费)</button>
        <span className="muted" style={{ fontSize: 12 }}> 每次 1,000 tUSDC + 10 tSOL,每 10 分钟一次</span></p>
      {rates && (
        <div className="swapbox">
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>兑换:SOL、tSOL、tUSDC 任意互换(固定汇率,是 mock,不是市场价)</div>
          <div className="swaprow">
            <span className="muted">卖出</span>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="卖出数量" />
            <select value={from} onChange={(e) => pickFrom(e.target.value as SwapAsset)} aria-label="卖出资产">{ASSETS.map((a) => <option key={a}>{a}</option>)}</select>
            <button className="linkish" onClick={useMax} type="button">最大</button>
          </div>
          <div className="muted" style={{ fontSize: 12, margin: '2px 0 0 36px' }}>余额 {fmtToken(balance(from).toString(), decimals(from))} {from}</div>
          <div style={{ textAlign: 'center', margin: '2px 0' }}><button className="flip" onClick={flip} type="button" aria-label="互换方向" title="互换方向">⇅</button></div>
          <div className="swaprow">
            <span className="muted">买入</span>
            <span className="out">{out != null && out > 0n ? `≈ ${fmtToken(out.toString(), decimals(to))}` : '—'}</span>
            <select value={to} onChange={(e) => pickTo(e.target.value as SwapAsset)} aria-label="买入资产">{ASSETS.map((a) => <option key={a}>{a}</option>)}</select>
          </div>
          {rate != null && <div className="muted" style={{ fontSize: 12, margin: '6px 0' }}>1 {from} ≈ {Number(rate.toPrecision(6))} {to}</div>}
          {problem && <div className="err" style={{ margin: '6px 0' }}>{problem}</div>}
          <button className="theme" onClick={exchange} disabled={!canExchange}>兑换</button>
        </div>)}
      {busy && <div className="muted">{busy}</div>}
      {note && <div className={note.ok ? 'ok' : 'err'} style={{ marginTop: 6 }}>{note.text}{note.link && <> <a href={note.link} target="_blank" rel="noreferrer">在 Explorer 查看</a></>}</div>}
    </div>
  );
}
