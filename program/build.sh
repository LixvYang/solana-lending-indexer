#!/usr/bin/env bash
# 构建 marginfi(mrgn-0.1.0)与 mocks 程序,产物放 program/out/。
# 为什么要补丁 program id:上游的 id 我们没有私钥,无法部署到同一地址。
# 为什么不带 cluster feature:此时 PYTH_ID 指向 mocks 程序且忽略价格时间,见 docs/decisions.md D-003。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
UPSTREAM_REPO="${UPSTREAM_REPO:-https://github.com/mrgnlabs/marginfi-v2}"
UPSTREAM_TAG="${UPSTREAM_TAG:-mrgn-0.1.0}"
SOLANA_BIN="${SOLANA_BIN:-$HOME/.local/share/solana/install/releases/2.1.20/solana-release/bin}"
export PATH="$SOLANA_BIN:$PATH"

SRC="$ROOT/.upstream"
OUT="$ROOT/out"
mkdir -p "$OUT/keys"

# 1. 拉取上游固定版本
if [ ! -d "$SRC/.git" ]; then
  git clone --no-checkout "$UPSTREAM_REPO" "$SRC"
fi
git -C "$SRC" checkout -q -f "$UPSTREAM_TAG"
git -C "$SRC" clean -fdq programs

# 2. 生成自己的 program keypair(已存在则复用,保证地址稳定)
for name in marginfi mocks; do
  [ -f "$OUT/keys/$name.json" ] || solana-keygen new --no-bip39-passphrase -s -o "$OUT/keys/$name.json" >/dev/null
done
MARGINFI_ID="$(solana-keygen pubkey "$OUT/keys/marginfi.json")"
MOCKS_ID="$(solana-keygen pubkey "$OUT/keys/mocks.json")"

# 3. 补丁:上游 localnet 地址 -> 我们自己的地址(仅限 programs/ 源码)
OLD_MARGINFI="2jGhuVUuy3umdzByFx8sNWUAaf5vaeuDm78RDPEnhrMr"
OLD_MOCKS="5XaaR94jBubdbrRrNW7DtRvZeWvLhSHkEGU3jHTEXV3C"
grep -rl -e "$OLD_MARGINFI" -e "$OLD_MOCKS" "$SRC/programs" --include='*.rs' | while read -r f; do
  perl -pi -e "s/$OLD_MARGINFI/$MARGINFI_ID/g; s/$OLD_MOCKS/$MOCKS_ID/g" "$f"
done

# 4. 构建(不带 cluster feature)
for pkg in marginfi mocks; do
  cargo build-sbf --manifest-path "$SRC/programs/$pkg/Cargo.toml" --no-default-features --sbf-out-dir "$OUT"
done

echo "marginfi: $MARGINFI_ID"
echo "mocks:    $MOCKS_ID"
printf '{"marginfi":"%s","mocks":"%s"}\n' "$MARGINFI_ID" "$MOCKS_ID" > "$OUT/program-ids.json"
