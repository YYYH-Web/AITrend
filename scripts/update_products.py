"""每週檢查 AIDC 產品規格是否有新世代或規格變更，更新 data/products.json。

需要 GitHub Secret：ANTHROPIC_API_KEY。透過 Claude API 的 web_search 工具查證最新公開資訊，
只接受結構正確的 JSON；任何類別解析失敗即保留原內容，不會覆寫。
"""
from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
PATH = ROOT / "data" / "products.json"
MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5-5")

SYSTEM = (
    "你是 AI 資料中心硬體研究員。你會收到一個產品類別的現有規格表（JSON）。"
    "請用網路搜尋查證，找出：1) 已正式發表但表中沒有的新產品或新世代；2) 表中規格或時程有官方更新者。"
    "只採用廠商官方公告或主流科技媒體可查證的資訊，不確定就不要改。以繁體中文撰寫，產品名與單位保留英文。"
    "只回傳 JSON，格式：{\"changed\": true/false, \"summary\": \"類別一句話現況\", \"items\": [[...每列欄位...]], "
    "\"changes\": [\"變更說明\"]}。items 必須沿用相同欄位數與順序，保留仍然正確的既有列。沒有變更時 changed 為 false 且不需 items。"
)


def ask(client, cat):
    msg = client.messages.create(
        model=MODEL,
        max_tokens=4000,
        system=SYSTEM,
        tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": 6}],
        messages=[{"role": "user", "content": f"今天是 {dt.date.today().isoformat()}。類別：{cat['name']}\n欄位：{json.dumps(cat['columns'], ensure_ascii=False)}\n現有資料：{json.dumps(cat['items'], ensure_ascii=False)}"}],
    )
    text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()
    m = re.search(r"\{.*\}", text, flags=re.S)
    return json.loads(m.group(0)) if m else None


def valid(cat, res):
    if not isinstance(res, dict) or not res.get("changed"):
        return False
    items = res.get("items")
    n = len(cat["columns"])
    return isinstance(items, list) and len(items) >= max(1, len(cat["items"]) // 2) and all(isinstance(r, list) and len(r) == n for r in items)


def main():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("[products] 未設定 ANTHROPIC_API_KEY，略過自動更新", file=sys.stderr)
        return
    import anthropic

    client = anthropic.Anthropic()
    data = json.loads(PATH.read_text(encoding="utf-8"))
    today = dt.date.today().isoformat()
    for cat in data["categories"]:
        try:
            res = ask(client, cat)
        except Exception as e:  # noqa: BLE001
            print(f"[products] {cat['name']} 失敗：{e}", file=sys.stderr)
            continue
        if valid(cat, res):
            cat["items"] = [[str(c) for c in r] for r in res["items"]]
            if res.get("summary"):
                cat["summary"] = res["summary"]
            for c in res.get("changes", [])[:10]:
                data["changelog"].append({"date": today, "category": cat["name"], "text": str(c)})
            print(f"[products] {cat['name']} 已更新", file=sys.stderr)
        else:
            print(f"[products] {cat['name']} 無變更", file=sys.stderr)
    data["last_checked"] = today
    data["updated"] = today
    data["changelog"] = data["changelog"][-100:]
    PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
