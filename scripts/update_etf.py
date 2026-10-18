"""抓取台股 ETF 的前十大持股、產業比重與資產分佈，寫入 data/etf.json。

資料來源：Yahoo股市 ETF「持股分析」頁（tw.stock.yahoo.com/quote/<代號>.TW/holding）
備援：yfinance funds_data.top_holdings
股票名稱對應代號：FinMind TaiwanStockInfo（上市 .TW／上櫃 .TWO）
要追蹤哪些 ETF 由 data/etf_config.json 設定。任一檔抓取失敗時保留上次成功的資料並標示為舊資料。
"""
from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import re
import sys
import time

import requests
from bs4 import BeautifulSoup

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.6",
}
PCT = re.compile(r"^-?\d+(?:\.\d+)?%$")
RANK = re.compile(r"^\d+\.$")
DATE = re.compile(r"(\d{4})/(\d{2})/(\d{2})")
SKIP = {"行業類別", "比重", "資料載入中...", "資料載入中"}


def log(*a):
    print("[etf]", *a, file=sys.stderr, flush=True)


def name_to_ticker():
    headers = {"Authorization": f"Bearer {os.environ['FINMIND_TOKEN']}"} if os.environ.get("FINMIND_TOKEN") else {}
    try:
        r = requests.get("https://api.finmindtrade.com/api/v4/data", params={"dataset": "TaiwanStockInfo"}, headers=headers, timeout=60)
        r.raise_for_status()
    except Exception as e:  # noqa: BLE001
        log(f"代號對照表取得失敗：{e}")
        return {}
    m = {}
    for row in r.json().get("data", []):
        sid, nm = str(row.get("stock_id", "")), str(row.get("stock_name", "")).strip()
        if re.fullmatch(r"\d{4}", sid) and nm:
            m.setdefault(nm, sid + (".TWO" if row.get("type") == "tpex" else ".TW"))
    return m


def tokens_of(html: str):
    soup = BeautifulSoup(html, "html.parser")
    for s in soup(["script", "style", "noscript"]):
        s.decompose()
    return [t.strip() for t in soup.get_text("\n").split("\n") if t.strip()]


def find(toks, title, start=0):
    return next((i for i in range(start, len(toks)) if title in toks[i]), None)


def section_date(toks, i):
    if i is None:
        return None
    m = DATE.search(" ".join(toks[i:i + 4]))
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None


def pairs(toks, i, stops, limit):
    """從 i 之後收集（名稱, 百分比）配對，遇到停止詞或達上限即結束。"""
    out = []
    if i is None:
        return out
    for k in range(i + 1, min(len(toks), i + 200)):
        t = toks[k]
        if any(s in t for s in stops):
            break
        if PCT.match(t):
            prev = toks[k - 1]
            if not RANK.match(prev) and not PCT.match(prev) and prev not in SKIP and "資料時間" not in prev:
                out.append((re.sub(r"^其餘行業\s*-\s*", "", prev), float(t[:-1])))
                if len(out) >= limit:
                    break
    return out


def from_yahoo_tw(code):
    url = f"https://tw.stock.yahoo.com/quote/{code}.TW/holding"
    r = requests.get(url, headers=UA, timeout=30)
    r.raise_for_status()
    toks = tokens_of(r.text)
    i_ind = find(toks, "行業比重")
    i_asset = find(toks, "資產分佈")
    i_top = find(toks, "前十大持股")
    holdings = pairs(toks, i_top, ["我的自選股", "網友也在看", "行業比重"], 10)
    if len(holdings) < 3:
        raise ValueError("頁面中找不到前十大持股")
    return {
        "source": "Yahoo股市",
        "holdings_date": section_date(toks, i_top),
        "industry_date": section_date(toks, i_ind),
        "holdings": holdings,
        "industries": pairs(toks, i_ind, ["持股明細", "資產分佈", "前十大持股"], 15),
        "assets": dict(pairs(toks, i_asset, ["前十大持股", "我的自選股"], 6)),
    }


def from_yfinance(code):
    import yfinance as yf

    th = yf.Ticker(f"{code}.TW").funds_data.top_holdings
    if th is None or th.empty:
        raise ValueError("yfinance 無持股資料")
    holdings = []
    for sym, row in th.head(10).iterrows():
        w = float(row.get("Holding Percent", 0)) * 100
        holdings.append((str(row.get("Name") or sym), round(w, 2), str(sym)))
    return {"source": "Yahoo Finance", "holdings_date": None, "industry_date": None, "holdings": holdings, "industries": [], "assets": {}}


def main():
    cfg = json.loads((DATA / "etf_config.json").read_text(encoding="utf-8"))["etfs"]
    prev_path = DATA / "etf.json"
    prev = {e["code"]: e for e in json.loads(prev_path.read_text(encoding="utf-8")).get("etfs", [])} if prev_path.exists() else {}
    names = name_to_ticker()
    now = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).strftime("%Y-%m-%d %H:%M")
    out = []
    for e in cfg:
        code = e["code"]
        res = None
        for fn in (from_yahoo_tw, from_yfinance):
            try:
                res = fn(code)
                break
            except Exception as err:  # noqa: BLE001
                log(f"{code} {fn.__name__} 失敗：{err}")
            time.sleep(1)
        if res:
            hs = []
            for h in res["holdings"]:
                name, w = h[0], h[1]
                ticker = h[2] if len(h) > 2 and re.match(r"^\d{4}\.TWO?$", h[2]) else names.get(name)
                hs.append({"name": name, "ticker": ticker, "weight": w})
            out.append({**e, "ok": True, "stale": False, "fetched": now, "source": res["source"],
                        "holdings_date": res["holdings_date"], "industry_date": res["industry_date"], "holdings": hs,
                        "industries": [{"name": n, "weight": w} for n, w in res["industries"]], "assets": res["assets"]})
            log(f"{code} 完成，{len(hs)} 檔持股")
        elif code in prev and prev[code].get("holdings"):
            out.append({**prev[code], **e, "stale": True})
            log(f"{code} 本次失敗，保留上次資料")
        else:
            out.append({**e, "ok": False, "holdings": [], "industries": [], "assets": {}})
        time.sleep(1.5)
    prev_path.write_text(json.dumps({"updated": now, "etfs": out}, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
