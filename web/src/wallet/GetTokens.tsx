import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import type { FaucetResponse, SwapRatesView, SwapToken, WalletTokenView } from '@contract';
import { fmtToken, toNative } from '../format';
import { b64, chain, deskBase, explorer, swap } from './chain';

/**
 * 获取测试币的两种方式:
 *  - 水龙头:免费,有限流;
 *  - 用 SOL 兑换:固定汇率的原子兑换(一笔交易里 转 SOL 给兑换台 + 兑换台转代币给你)。
 * 测试币是自己发行的,没有真实的 AMM 池子,所以汇率是固定的 mock,不是市场价。
 */
export function GetTokens({ address, faucetUrl, tokens, solLamports }: { address: string; faucetUrl: string; tokens: WalletTokenView[]; solLamports: bigint }) {
  const { signTransaction } = useWallet();
  const base = deskBase(faucetUrl);
  const [rates, setRates] = useState<SwapRatesView | null>(null);
  const [token, setToken] = useState<SwapToken>('tUSDC');
  const [sol, setSol] = useState('0.1');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string; link?: string } | null>(null);
  useEffect(() => { swap.rates(base).then(setRates).catch(() => setRates(null)); }, [base]);

  const decimals = (label: string) => tokens.find((t) => t.label === label)?.decimals ?? 0;
  const lamports = toNative(sol, 9);
  const perSol = rates ? toNative(rates.rates[token], decimals(token)) : null;
  // 向下取整,和服务端一致:不会显示比实际多的数量。
  const out = lamports && perSol ? (BigInt(lamports) * BigInt(perSol) / 1_000_000_000n).toString() : null;
  const tooMuch = lamports != null && BigInt(lamports) + 10_000_000n > solLamports; // 留 0.01 SOL 付手续费和账户租金

  const claim = async () => {
    setBusy('领取中…'); setNote(null);
    try {
      const r: FaucetResponse = await chain.faucet(faucetUrl, address);
      setNote({ ok: true, text: `已到账:${r.granted.map((g) => `${fmtToken(g.amount, decimals(g.label))} ${g.label}`).join('、')}` });
    } catch (e) { setNote({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  };

  const exchange = async () => {
    if (!signTransaction) return;
    setBusy('向兑换台报价…'); setNote(null);
    try {
      const quote = await swap.quote(base, { wallet: address, token, sol });
      setBusy('请在钱包里确认…');
      const signed = await signTransaction(VersionedTransaction.deserialize(b64.decode(quote.transaction)));
      setBusy('发送并等待确认…');
      const sent = await swap.send(base, b64.encode(signed.serialize()));
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
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
            或用 SOL 兑换(固定汇率:1 SOL = {rates.rates.tSOL} tSOL = {rates.rates.tUSDC} tUSDC,是 mock 汇率,不是市场价)</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input inputMode="decimal" value={sol} onChange={(e) => setSol(e.target.value)} style={{ width: 80 }} aria-label="SOL 数量" /> SOL →
            <select value={token} onChange={(e) => setToken(e.target.value as SwapToken)}><option value="tUSDC">tUSDC</option><option value="tSOL">tSOL</option></select>
            <span className="muted">{out ? `≈ ${fmtToken(out, decimals(token))}` : ''}</span>
            <button className="theme" onClick={exchange} disabled={Boolean(busy) || !out || out === '0' || tooMuch}>兑换</button>
          </div>
          {sol && !lamports && <div className="err">数量格式不对。</div>}
          {tooMuch && lamports && <div className="muted" style={{ fontSize: 12 }}>SOL 余额不够(需留 0.01 SOL 付手续费)。</div>}
        </div>)}
      {busy && <div className="muted">{busy}</div>}
      {note && <div className={note.ok ? 'ok' : 'err'} style={{ marginTop: 6 }}>{note.text}{note.link && <> <a href={note.link} target="_blank" rel="noreferrer">在 Explorer 查看</a></>}</div>}
    </div>
  );
}
