import { useEffect, useState, type ReactNode } from 'react';
import type { Adapter } from '@solana/wallet-adapter-base';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import '@solana/wallet-adapter-react-ui/styles.css';

// ConnectionProvider 只是 wallet-adapter 要求有的；我们不用它发请求(交易走自己的 /api/send)，所以给个占位地址。
const PLACEHOLDER = 'https://api.devnet.solana.com';

export function Providers({ children }: { children: ReactNode }) {
  // wallets 留空：Phantom、Solflare 等通过 Wallet Standard 自动出现。
  // 开发模式下 ?testwallet=<种子> 会多出一个本地测试钱包，用来在没有浏览器扩展的环境里走完整个签名流程。
  // 它是动态 import 的，并且只在 import.meta.env.DEV 下才会走到，所以生产构建里没有这段代码(见 pnpm build 后 grep 验证)。
  const seed = import.meta.env.DEV ? new URLSearchParams(location.search).get('testwallet') : null;
  const [wallets, setWallets] = useState<Adapter[] | null>(seed ? null : []);
  useEffect(() => {
    if (!seed) return;
    import('./test-wallet').then(({ TestWalletAdapter }) => {
      // 让开发用的测试钱包自动连接(wallet-adapter 靠 localStorage 记住上次选的钱包)。
      try { localStorage.setItem('walletName', JSON.stringify('Test Wallet')); } catch { /* 隐私模式下不可用，手动选择即可 */ }
      setWallets([new TestWalletAdapter(seed)]);
    });
  }, [seed]);
  if (wallets === null) return null;
  return (
    <ConnectionProvider endpoint={PLACEHOLDER}>
      <WalletProvider wallets={wallets} autoConnect={Boolean(wallets.length)}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
