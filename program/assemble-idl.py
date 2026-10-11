#!/usr/bin/env python3
"""把 `cargo test ... __anchor_private_print_idl` 的日志拼成完整的 Anchor IDL。

用法: assemble-idl.py <idl-build.log> <输出.json>
anchor CLI 内部做的就是这件事;我们不装 anchor 0.30.1 CLI,所以自己拼。
"""
import json, re, sys

blocks = []  # (名字, 解析后的 JSON)
cur, buf = None, []
for line in open(sys.argv[1]).read().split("\n"):
    m = re.match(r"-+ IDL begin (\w+) -+", line)
    if m:
        cur, buf = m.group(1), []
    elif re.match(r"-+ IDL end", line):
        text = "\n".join(buf).strip()
        blocks.append((cur, json.loads(text)))
        cur = None
    elif cur:
        buf.append(line)

idl = next(b for n, b in blocks if n == "program")
idl["address"] = next(b for n, b in blocks if n == "address")
idl["errors"] = next(b for n, b in blocks if n == "errors")
def short(x):
    """anchor CLI 会去掉 `marginfi::events::` 这类路径前缀,只留类型名。"""
    if isinstance(x, dict):
        return {k: (v.split("::")[-1] if k == "name" and isinstance(v, str) else short(v)) for k, v in x.items()}
    if isinstance(x, list):
        return [short(i) for i in x]
    return x

events = {e["name"]: e for e in idl.get("events", [])}
types = {t["name"]: t for t in idl.get("types", [])}
for name, b in blocks:
    if name == "event":
        e = short(b["event"])
        events[e["name"]] = e
        for t in short(b.get("types", [])):
            types[t["name"]] = t
idl["events"] = list(events.values())
idl["types"] = list(types.values())
idl = short(idl)
# idl-build 取的是源码里第一个 declare_id(cfg 分支里的 mainnet 地址),换成我们实际部署的地址
if len(sys.argv) > 3:
    idl["address"] = json.load(open(sys.argv[3]))["marginfi"]
json.dump(idl, open(sys.argv[2], "w"), indent=2)
print(f"instructions={len(idl['instructions'])} accounts={len(idl['accounts'])} events={len(idl['events'])} types={len(idl['types'])} errors={len(idl['errors'])}")
