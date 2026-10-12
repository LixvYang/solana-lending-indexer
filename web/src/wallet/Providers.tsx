import { useMemo, type ReactNode } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import '@solana/wallet-adapter-react-ui/styles.css';
import { TestWalletAdapter } from './test-wallet';

// ConnectionProvider 只是 wallet-adapter 要求有的；我们不用它发请求(交易走自己的 /api/send)，所以给个占位地址。
const PLACEHOLDER = 'https://api.devnet.solana.com';

export function Providers({ children }: { children: ReactNode }) {
  // wallets 留空：Phantom、Solflare 等通过 Wallet Standard 自动出现。
  // 开发模式下 ?testwallet=<种子> 会多出一个本地测试钱包，用来在没有浏览器扩展的环境里走完整个签名流程。
  const wallets = useMemo(() => {
    const seed = import.meta.env.DEV ? new URLSearchParams(location.search).get('testwallet') : null;
    if (!seed) return [];
    // 让开发用的测试钱包自动连接(wallet-adapter 靠 localStorage 记住上次选的钱包)。
    try { localStorage.setItem('walletName', JSON.stringify('Test Wallet')); } catch { /* 隐私模式下不可用，手动选择即可 */ }
    return [new TestWalletAdapter(seed)];
  }, []);
  return (
    <ConnectionProvider endpoint={PLACEHOLDER}>
      <WalletProvider wallets={wallets} autoConnect={Boolean(wallets.length)}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
