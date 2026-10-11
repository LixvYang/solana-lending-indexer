import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveKeypair, createActors } from './actors';

test('sha256 标签派生的公钥固定，不依赖钱包或时钟', () => {
  const keys = {
    alice: 'J8H3S29MjSzXvp1Jm4JhnPwJnqY4yCsfaMX3cTuvwJh3',
    bob: 'Abh88w383B3EhJYpSoxNV55qL5dG3czNGyQx7hcUPj9S',
    carol: 'Dzv4jmLwyyo3B9S7jYgAyBWQtFsfQVYysAZTv9B4QPVb',
    'mint/tUSDC': '4CDNTDo9Us1YiB1a4mDUHAmKtpbNJwJsvDqk32V8xKg6',
    'mint/tSOL': '2mjxAijRHGKd5U3imWCQAaKs31KKE2KtzjBdXbU6CacE',
    group: 'GHVn8kr8ffkk6qynGKKbZ8PAgCM8xGFR9Gnhen3xig35',
  };
  for (const [label, key] of Object.entries(keys)) {
    assert.equal(deriveKeypair(label).publicKey.toBase58(), key);
    assert.equal(deriveKeypair(label).publicKey.toBase58(), key);
  }
  assert.equal(new Set(Object.values(keys)).size, 6);
});

test('run-id 只隔离 group、bank、借贷账户，参与者和 mint 保持固定', () => {
  const a = createActors();
  const b = createActors('take-2');
  assert.ok(a.alice.publicKey.equals(b.alice.publicKey));
  assert.ok(a.mints.tSOL.publicKey.equals(b.mints.tSOL.publicKey));
  assert.ok(!a.group.publicKey.equals(b.group.publicKey));
  assert.ok(!a.banks.tUSDC.publicKey.equals(b.banks.tUSDC.publicKey));
  assert.ok(!a.marginfiAccounts.bob.publicKey.equals(b.marginfiAccounts.bob.publicKey));
});
