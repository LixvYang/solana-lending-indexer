import { useEffect, useMemo, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import type { AccountView, BankView, BuildResponse, SendResponse, WalletAction, WalletView } from '@contract';
import { usePoll } from '../hooks';
import { fmtToken, fmtUsd, short, toNative } from '../format';
import { StatusBadge } from '../Accounts';
import { b64, chain, explorer } from './chain';
import { GetTokens } from './GetTokens';

const ACTIONS: { id: WalletAction; label: string; allLabel?: string }[] = [
  { id: 'deposit', label: '存款' },
  { id: 'withdraw', label: '取款', allLabel: '取出全部' },
  { id: 'borrow', label: '借款' },
  { id: 'repay', label: '还款', allLabel: '还清全部' },
];

/** 从别的 tab 跳过来时预选的操作与代币;nonce 让"同一个预设再点一次"也能生效。 */
export interface WalletPreset { action: WalletAction; bank: string; nonce: number }

/** 我的钱包 + 对借贷池的操作。交易由服务端构建、钱包签名、服务端转发。 */
export function WalletPanel({ banks, accounts, onTransaction, onOpenTx, fast, preset }: {
  banks: BankView[]; accounts: AccountView[]; onTransaction: () => void; onOpenTx: (signature: string) => void; fast: boolean; preset: WalletPreset | null;
}) {
  const { publicKey, signTransaction, connected } = useWallet();
  const address = publicKey?.toBase58() ?? null;
  const info = usePoll<WalletView | null>(() => (address ? chain.wallet(address) : Promise.resolve(null)), [address, fast], fast ? 1500 : 6000);
  const mine = accounts.find((a) => a.authority === address) ?? null;

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

  const native = bank && !all ? toNative(amount, bank.decimals) : null;
  const canBuild = Boolean(connected && bank && (all || (native && native !== '0')));
  const actionDef = ACTIONS.find((a) => a.id === action)!;

  const preview = async () => {
    if (!address || !bank) return;
    setBusy('构建交易…'); setError(null); setSent(null);
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
      if (result.status === 'confirmed') onTransaction(); // 交易一确认就加速刷新,让页面尽快反映出来
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  if (!connected) return (
    <div className="card"><h2>我来操作<small>仅限 devnet 测试币</small></h2>
      <p className="label">点右上角“连接钱包”,切换到 <b>devnet</b>,就可以对这个借贷池存款、借款、还款、取款。首次存款会自动为你创建 marginfi 账户。</p>
      <p className="muted" style={{ fontSize: 12 }}>需要少量 devnet SOL 付手续费(<a href="https://faucet.solana.com" target="_blank" rel="noreferrer">faucet.solana.com</a>),测试代币在连接后从水龙头领取。</p></div>
  );

  const w = info.data;
  const sol = w ? Number(w.sol_lamports) / 1e9 : null;
  return (
    <div className="card">
      <h2>我来操作<small>{short(address, 5)} · 仅限 devnet 测试币</small></h2>
      <div className="grid wtwo">
        <div>
          <div className="label">我的钱包</div>
          <table><tbody>
            <tr><td>SOL</td><td className="n">{sol == null ? '—' : sol.toFixed(4)}</td></tr>
            {w?.tokens.map((t) => <tr key={t.mint}><td>{t.label}</td><td className="n">{fmtToken(t.amount, t.decimals)}</td></tr>)}
          </tbody></table>
          {sol != null && sol < 0.01 && <p className="err">SOL 不足以付手续费,请到 <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">faucet.solana.com</a> 领取。</p>}
          {w?.faucet_url && address && <GetTokens address={address} faucetUrl={w.faucet_url} tokens={w.tokens} solLamports={BigInt(w.sol_lamports)} onDone={onTransaction} />}
          <div className="label" style={{ marginTop: 12 }}>我在池子里的账户</div>
          {mine ? (
            <div>
              <div className="muted mono">{short(mine.address)}</div>
              {mine.balances.filter((b) => b.deposit !== '0' || b.borrow !== '0').map((b) => (
                <div key={b.bank}>{b.label}:存 {fmtToken(b.deposit, banks.find((x) => x.address === b.bank)?.decimals ?? 0)}
                  {b.borrow !== '0' && <>,借 {fmtToken(b.borrow, banks.find((x) => x.address === b.bank)?.decimals ?? 0)}</>}</div>))}
              <div>维持健康度 {fmtUsd(mine.health.maint)} <StatusBadge status={mine.status} /></div>
            </div>
          ) : <div className="muted">还没有。首次存款时会自动创建。</div>}
        </div>
        <div>
          <div className="seg" role="tablist">{ACTIONS.map((a) => (
            <button key={a.id} role="tab" aria-selected={action === a.id} className={action === a.id ? 'on' : ''} onClick={() => { setAction(a.id); setAll(false); }}>{a.label}</button>))}</div>
          <label className="field-row">代币
            <select value={bank?.address} onChange={(e) => setBankAddress(e.target.value)}>{banks.map((b) => <option key={b.address} value={b.address}>{b.label}</option>)}</select></label>
          <label className="field-row">数量
            <input inputMode="decimal" placeholder="0.0" value={all ? '' : amount} disabled={all} onChange={(e) => setAmount(e.target.value)} /></label>
          {actionDef.allLabel && <label className="field-row check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> {actionDef.allLabel}(含利息,由程序精确结算)</label>}
          {action === 'borrow' && mine?.balances.some((b) => b.bank === bank?.address && b.deposit !== '0') && (
            <p className="muted" style={{ fontSize: 12 }}>提示:你在 {bank?.label} 里有存款。marginfi 中同一个代币的头寸要么是存款要么是负债,借款会先从你的存款里扣,扣完才产生负债。想借出来,请用另一种代币做抵押。</p>)}
          {!all && amount && !native && <p className="err">数量格式不对,或小数位超过 {bank?.decimals} 位。</p>}
          <p><button className="theme" onClick={preview} disabled={!canBuild || Boolean(busy)}>预览</button></p>

          {built && (
            <div className="preview">
              <div><b>{built.summary}</b>{built.creates_account && <span className="muted">(同时创建你的 marginfi 账户)</span>}</div>
              {built.simulation.ok
                ? <div className="ok">✓ 模拟通过{built.simulation.units_consumed ? `,约 ${built.simulation.units_consumed.toLocaleString()} 计算单元` : ''}</div>
                : <div className="err">✗ 模拟失败:{built.simulation.error?.message ?? '未知错误'}{built.simulation.error?.code != null && <span className="muted"> ({built.simulation.error.name} #{built.simulation.error.code})</span>}</div>}
              <p><button className="theme" onClick={signAndSend} disabled={!built.simulation.ok || Boolean(busy)}>签名并发送</button></p>
            </div>)}
          {busy && <div className="muted">{busy}</div>}
          {error && <div className="err">{error}</div>}
          {sent && (
            <div className={sent.status === 'confirmed' ? 'ok' : 'err'}>
              {sent.status === 'confirmed' ? '✓ 已确认' : sent.status === 'timeout' ? '⏱ 确认超时(交易可能仍会上链)' : `✗ 失败:${sent.error?.message ?? ''}`}
              {' '}<a href={explorer(sent.signature)} target="_blank" rel="noreferrer">在 Explorer 查看</a>
              {sent.status === 'confirmed' && <> · <button className="linkish" onClick={() => onOpenTx(sent.signature)}>用 X 光看这笔交易</button>
                <div className="muted">索引器在 confirmed 后几秒内入库;X 光若提示找不到,稍等再点。</div></>}
            </div>)}
        </div>
      </div>
    </div>
  );
}
