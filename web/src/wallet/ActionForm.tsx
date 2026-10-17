import { useEffect, useMemo, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import type { AccountView, BankView, BuildResponse, SendResponse, WalletAction, WalletView } from '@contract';
import { fmtPct, fmtToken, fmtUsd, toNative } from '../format';
import { TokenPicker } from '../swap/TokenPicker';
import { b64, chain, explorer } from './chain';

const ACTIONS: { id: WalletAction; label: string; allLabel?: string }[] = [
  { id: 'deposit', label: '存款' }, { id: 'borrow', label: '借款' },
  { id: 'repay', label: '还款', allLabel: '还清全部' }, { id: 'withdraw', label: '取款', allLabel: '取出全部' },
];

/** 从别的 tab 跳过来时预选的操作与代币;nonce 让"同一个预设再点一次"也能生效。 */
export interface WalletPreset { action: WalletAction; bank: string; nonce: number }

/** 对借贷池的操作:选动作、选资产、填数量 → 服务端构建并模拟 → 钱包签名 → 服务端转发。 */
export function ActionForm({ banks, mine, wallet, preset, onTransaction, onOpenTx }: {
  banks: BankView[]; mine: AccountView | null; wallet: WalletView | null; preset: WalletPreset | null; onTransaction: () => void; onOpenTx: (signature: string) => void;
}) {
  const { publicKey, signTransaction } = useWallet();
  const address = publicKey?.toBase58() ?? null;
  const [action, setAction] = useState<WalletAction>('deposit');
  const [bankAddress, setBankAddress] = useState<string>(banks[0]?.address ?? '');
  const [amount, setAmount] = useState('');
  const [all, setAll] = useState(false);
  const [built, setBuilt] = useState<BuildResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<SendResponse | null>(null);

  useEffect(() => { if (preset) { setAction(preset.action); setBankAddress(preset.bank); setAll(false); } }, [preset]);
  const bank = useMemo(() => banks.find((b) => b.address === bankAddress) ?? banks[0], [banks, bankAddress]);
  useEffect(() => { setBuilt(null); setSent(null); setError(null); }, [action, bankAddress, amount, all, address]);

  // 每个动作"最多能填多少":存款看钱包余额,取款看存款,还款看负债;借款由健康度决定,交给模拟去判断。
  const position = mine?.balances.find((b) => b.bank === bank?.address);
  const held = wallet ? wallet.tokens.find((t) => t.mint === bank?.mint)?.amount ?? '0' : null; // 还没读到钱包时不显示,免得先闪一个 0
  const cap = action === 'deposit' ? held : action === 'withdraw' ? position?.deposit ?? '0' : action === 'repay' ? position?.borrow ?? '0' : null;
  const native = bank && !all ? toNative(amount, bank.decimals) : null;
  const canBuild = Boolean(address && bank && (all || (native && native !== '0')));
  const def = ACTIONS.find((a) => a.id === action)!;
  const options = banks.map((b) => ({ symbol: b.label, balance: fmtToken(wallet?.tokens.find((t) => t.mint === b.mint)?.amount ?? '0', b.decimals, 4),
    note: `存 ${fmtPct(b.lending_apr, 1)} · 借 ${fmtPct(b.borrowing_apr, 1)}` }));

  const preview = async () => {
    if (!address || !bank) return;
    setBusy('构建并模拟交易…'); setError(null); setSent(null);
    try { setBuilt(await chain.build({ action, wallet: address, bank: bank.address, amount: native ?? '0', all })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setBuilt(null); }
    finally { setBusy(null); }
  };
  const signAndSend = async () => {
    if (!built || !signTransaction) return;
    setBusy('请在钱包里确认…'); setError(null);
    try {
      const signed = await signTransaction(VersionedTransaction.deserialize(b64.decode(built.transaction)));
      setBusy('发送并等待确认…');
      const result = await chain.send(b64.encode(signed.serialize()));
      setSent(result);
      if (result.status === 'confirmed') { onTransaction(); setAmount(''); } // 一确认就加速刷新,让页面尽快反映出来
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  return (
    <div className="card">
      <div className="seg wide" role="tablist">{ACTIONS.map((a) => (
        <button key={a.id} role="tab" aria-selected={action === a.id} className={action === a.id ? 'on' : ''} onClick={() => { setAction(a.id); setAll(false); }}>{a.label}</button>))}</div>
      <div className="swap-box">
        <div className="swap-row"><span className="label">{def.label}数量</span>
          {cap !== null && bank && <span className="muted">{action === 'deposit' ? '钱包' : action === 'withdraw' ? '已存' : '欠款'} {fmtToken(cap, bank.decimals, 4)}
            {cap !== '0' && <button className="pill" type="button" onClick={() => { setAll(false); setAmount(fmtToken(cap, bank.decimals, bank.decimals).replace(/,/g, '')); }}>最大</button>}</span>}</div>
        <div className="swap-row">
          <input className="amount" inputMode="decimal" placeholder={all ? '全部' : '0'} value={all ? '' : amount} disabled={all} onChange={(e) => setAmount(e.target.value)} aria-label="数量" />
          {bank && <TokenPicker value={bank.label} options={options} onChange={(s) => setBankAddress(banks.find((b) => b.label === s)!.address)} label="资产" />}</div>
        <div className="swap-row muted"><span>{native && bank?.price != null ? fmtUsd(Number(native) / 10 ** bank.decimals * bank.price) : ' '}</span>
          <span>{action === 'borrow' ? `借款 APR ${fmtPct(bank?.borrowing_apr ?? null, 2)}` : action === 'deposit' ? `存款 APR ${fmtPct(bank?.lending_apr ?? null, 2)}` : ''}</span></div>
      </div>
      {def.allLabel && <label className="field-row check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> {def.allLabel}(含利息,由程序精确结算)</label>}
      {action === 'borrow' && position && position.deposit !== '0' && (
        <p className="hint">你在 {bank?.label} 里有存款。marginfi 里同一个代币的头寸要么是存款要么是负债,借款会先扣你的存款。想借出来,请用另一种代币做抵押。</p>)}
      {!all && amount && !native && <p className="notice bad">数量格式不对,或小数位超过 {bank?.decimals} 位。</p>}
      {!built && <button className="btn primary block lg" onClick={preview} disabled={!canBuild || Boolean(busy)}>{busy ?? (canBuild ? `预览${def.label}` : '输入数量')}</button>}
      {built && (
        <div className="preview">
          <div><b>{built.summary}</b>{built.creates_account && <span className="muted">(同时创建你的 marginfi 账户)</span>}</div>
          {built.simulation.ok
            ? <div className="ok">✓ 模拟通过{built.simulation.units_consumed ? `,约 ${built.simulation.units_consumed.toLocaleString()} 计算单元` : ''}</div>
            : <div className="bad-text">✗ 模拟失败:{built.simulation.error?.message ?? '未知错误'}{built.simulation.error?.code != null && <span className="muted"> ({built.simulation.error.name} #{built.simulation.error.code})</span>}</div>}
          <div className="row-actions">
            <button className="btn primary" onClick={signAndSend} disabled={!built.simulation.ok || Boolean(busy)}>{busy ?? '签名并发送'}</button>
            <button className="btn" onClick={() => setBuilt(null)} disabled={Boolean(busy)}>修改</button>
          </div>
        </div>)}
      {error && <div className="notice bad">{error}</div>}
      {sent && (
        <div className={`notice ${sent.status === 'confirmed' ? 'ok' : 'bad'}`}>
          {sent.status === 'confirmed' ? '✓ 已确认' : sent.status === 'timeout' ? '⏱ 确认超时(交易可能仍会上链)' : `✗ 失败:${sent.error?.message ?? ''}`}
          {' · '}<a href={explorer(sent.signature)} target="_blank" rel="noreferrer">Explorer</a>
          {sent.status === 'confirmed' && <> · <button className="linkish" onClick={() => onOpenTx(sent.signature)}>用 X 光看这笔交易</button>
            <div className="muted">索引器在 confirmed 后几秒内入库;X 光若提示找不到,稍等再点。</div></>}
        </div>)}
    </div>
  );
}
