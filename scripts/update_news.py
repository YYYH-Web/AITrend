"""從 Google News RSS 抓取 AI／AIDC 相關新聞，依主題分類後寫入 data/news.json。

若設定 ANTHROPIC_API_KEY，會另外請 Claude 將英文標題整理為繁體中文標題與一句摘要，並挑出頭條。
"""
from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import re
import sys
import urllib.parse

import feedparser

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "news.json"

QUERIES = [
    ("aidc", "AI data center gigawatt"),
    ("aidc", "hyperscaler capex"),
    ("aidc", "AI 資料中心"),
    ("demand", "OpenAI OR Anthropic revenue"),
    ("demand", "neocloud GPU cloud funding"),
    ("products", "HBM4 OR Rubin GPU OR CoWoS"),
    ("products", "data center liquid cooling OR 800V HVDC OR co-packaged optics"),
    ("apps", "robotaxi OR humanoid robot"),
    ("apps", "enterprise AI adoption agents"),
]


def rss_url(q: str) -> str:
    zh = re.search(r"[\u4e00-\u9fff]", q)
    params = {"q": f"{q} when:7d", "hl": "zh-TW" if zh else "en-US", "gl": "TW" if zh else "US", "ceid": "TW:zh-Hant" if zh else "US:en"}
    return "https://news.google.com/rss/search?" + urllib.parse.urlencode(params)


def collect(limit_per_query=8):
    items, seen = [], set()
    for tag, q in QUERIES:
        feed = feedparser.parse(rss_url(q))
        for e in feed.entries[:limit_per_query]:
            title = re.sub(r"\s+-\s+[^-]+$", "", e.get("title", "")).strip()
            key = re.sub(r"\W+", "", title.lower())[:60]
            if not title or key in seen:
                continue
            seen.add(key)
            published = e.get("published_parsed")
            date = dt.date(*published[:3]).isoformat() if published else dt.date.today().isoformat()
            source = (e.get("source") or {}).get("title") or ""
            items.append({"title": title, "summary": "", "tag": tag, "source": source, "date": date, "url": e.get("link")})
    items.sort(key=lambda x: x["date"], reverse=True)
    return items[:40]


def enrich_with_claude(items):
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key or not items:
        return items
    try:
        import anthropic
    except ImportError:
        return items
    client = anthropic.Anthropic(api_key=key)
    payload = [{"i": i, "title": it["title"], "source": it["source"], "tag": it["tag"]} for i, it in enumerate(items)]
    prompt = (
        "以下是 AI 與 AI 資料中心相關新聞標題。請為每則提供繁體中文標題（公司名、產品型號保留英文）與一句不超過 40 字的中文重點，"
        "內容只能根據標題本身，不可推測或捏造數字。另外挑出對 AI 基礎設施投資最重要的一則作為頭條。"
        "只回傳 JSON：{\"lead\": i, \"items\": [{\"i\": 0, \"title\": \"...\", \"summary\": \"...\"}]}，不要其他文字。\n\n"
        + json.dumps(payload, ensure_ascii=False)
    )
    try:
        msg = client.messages.create(model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5-5"), max_tokens=6000,
                                     messages=[{"role": "user", "content": prompt}])
        text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
        data = json.loads(re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M))
        for row in data.get("items", []):
            i = row.get("i")
            if isinstance(i, int) and 0 <= i < len(items):
                items[i]["title_original"] = items[i]["title"]
                items[i]["title"] = row.get("title") or items[i]["title"]
                items[i]["summary"] = row.get("summary") or ""
        lead = data.get("lead")
        if isinstance(lead, int) and 0 <= lead < len(items):
            items[lead]["lead"] = True
    except Exception as e:  # noqa: BLE001
        print(f"[news] Claude 摘要略過：{e}", file=sys.stderr)
    return items


def main():
    items = collect()
    if not items:
        print("[news] 沒有抓到新聞，保留原檔", file=sys.stderr)
        return
    items = enrich_with_claude(items)
    now = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).strftime("%Y-%m-%d %H:%M")
    OUT.write_text(json.dumps({"updated": now, "source_note": "Google News RSS", "items": items}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[news] 寫入 {len(items)} 則", file=sys.stderr)


if __name__ == "__main__":
    main()
