/** INPUT: 新脚本子进程、空配置。 OUTPUT: help/非法参数离线执行。 POSITION: M7 CLI 入口验收。 SYNC: folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('wallet tools help/invalid args do not require network or load administrator key files', () => {
  for (const script of ['faucet', 'faucet-setup', 'price-keeper', 'set-price']) {
    for (const arg of ['--help', '--invalid']) {
      const result = spawnSync(process.execPath, ['--import', 'tsx', `scripts/${script}.ts`, arg], { encoding: 'utf8',
        env: { ...process.env, DOTENV_CONFIG_PATH: '/nonexistent-m7-env', RPC_URL: '', ANCHOR_WALLET: '/nonexistent-secret', FAUCET_KEYPAIR: '/nonexistent-faucet' } });
      assert.equal(result.status, arg === '--help' ? 0 : 1, result.stderr);
      if (arg === '--help') assert.match(result.stdout, /用法/);
      assert.ok(!/RPC_URL|api-key|nonexistent-secret|nonexistent-faucet/.test(result.stdout + result.stderr));
    }
  }
});
