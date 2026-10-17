import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import type { AccountView, BankView, WalletView } from '@contract';
import { fmtToken, fmtUsd, short } from '../format';
import { StatusBadge } from '../Accounts';
import { TokenIcon, TokenName } from '../tokens';
import { GetTokens } from './GetTokens';
import { ActionForm, type WalletPreset } from './ActionForm';
export type { WalletPreset } from './ActionForm';

/** 我的钱包 + 对借贷池的操作。左边是"我有什么"(钱包资产、池子里的头寸),右边是"我要做什么"。 */
export function WalletPanel({ banks, accounts, onTransaction, onOpenTx, onGoSwap, wallet, preset }: {
  banks: BankView[]; accounts: AccountView[]; onTransaction: () => void; onOpenTx: (signature: string) => void; onGoSwap: () => void; wallet: WalletView | null; preset: WalletPreset | null;
}) {
  const { publicKey, connected } = useWallet();
  const address = publicKey?.toBase58() ?? null;
  const mine = accounts.find((a) => a.authority === address) ?? null;

  if (!connected) return (
    <div className="card empty-state">
      <div className="faucet-icons" aria-hidden>{banks.map((b) => <TokenIcon key={b.address} symbol={b.label} size={36} />)}</div>
      <h2>连接钱包,开始存借</h2>
      <p className="muted">切换到 <b>devnet</b> 后即可对这个借贷池存款、借款、还款、取款;首次存款会自动为你创建 marginfi 账户。<br />
        需要少量 devnet SOL 付手续费(<a href="https://faucet.solana.com" target="_blank" rel="noreferrer">faucet.solana.com</a>),测试代币连接后可免费领取。</p>
      <WalletMultiButton />
    </div>
  );

  const w = wallet, bankOf = (mint: string) => banks.find((b) => b.mint === mint);
  const sol = w ? Number(w.sol_lamports) / 1e9 : null;
  const active = mine?.balances.filter((b) => b.deposit !== '0' || b.borrow !== '0') ?? [];
  return (
    <div className="grid wallet-grid">
      <div className="stack">
        <div className="card">
          <h2>钱包资产<small className="mono">{short(address, 5)}</small></h2>
          <ul className="asset-list">
            <li><TokenName symbol="SOL" size={28} sub="付手续费" /><span className="n"><b>{sol == null ? '—' : sol.toFixed(4)}</b></span></li>
            {w?.tokens.map((t) => { const b = bankOf(t.mint), ui = Number(t.amount) / 10 ** t.decimals;
              return <li key={t.mint}><TokenName symbol={t.label} size={28} /><span className="n"><b>{fmtToken(t.amount, t.decimals, 4)}</b>
                <span className="muted">{b?.price != null ? fmtUsd(ui * b.price) : ''}</span></span></li>; })}
          </ul>
          {sol != null && sol < 0.01 && <p className="notice bad">SOL 不足以付手续费,请到 <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">faucet.solana.com</a> 领取。</p>}
          {w?.faucet_url && address && <GetTokens address={address} faucetUrl={w.faucet_url} tokens={w.tokens} onDone={onTransaction} onGoSwap={onGoSwap} />}
        </div>
        <div className="card">
          <h2>我的头寸{mine && <small className="mono">{short(mine.address)}</small>}</h2>
          {mine && active.length ? (<>
            <div className="health-row">
              <div><div className="label">维持健康度</div><div className="stat">{fmtUsd(mine.health.maint)}</div></div>
              <StatusBadge status={mine.status} />
            </div>
            <ul className="asset-list">{active.map((p) => { const b = banks.find((x) => x.address === p.bank);
              return <li key={p.bank}><TokenName symbol={p.label} size={28} sub={p.borrow !== '0' ? '负债' : '存款'} />
                <span className="n"><b className={p.borrow !== '0' ? 'bad-text' : ''}>{p.borrow !== '0' ? '−' : ''}{fmtToken(p.borrow !== '0' ? p.borrow : p.deposit, b?.decimals ?? 0, 4)}</b>
                  <span className="muted">{fmtUsd(p.borrow !== '0' ? p.borrow_usd : p.deposit_usd)}</span></span></li>; })}</ul>
          </>) : <p className="muted">还没有头寸。首次存款时会自动创建账户。</p>}
        </div>
      </div>
      <ActionForm banks={banks} mine={mine} wallet={w ?? null} preset={preset} onTransaction={onTransaction} onOpenTx={onOpenTx} />
    </div>
  );
}
