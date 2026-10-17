"""更新追蹤清單的行情與近八季財報。

資料來源
- 行情：Yahoo Finance（yfinance）
- 財報：美股 SEC EDGAR（免金鑰）；台股 FinMind（公開資訊觀測站資料）；其餘市場 yfinance
輸出
- data/market.json、data/financials.json、data/csv/<代號>.csv、data/watchlist.json（若由網頁傳入新清單）

環境變數
- WATCHLIST：網頁傳入的清單（JSON 陣列 [{ticker,name,category}] 或逗號分隔代號），可留空
- SEC_USER_AGENT：SEC 要求的聯絡資訊，例如「AI Trends Tracker you@example.com」
- FINMIND_TOKEN：選填，提高 FinMind 呼叫額度
"""
from __future__ import annotations

import csv
import datetime as dt
import json
import math
import os
import pathlib
import sys
import time
from collections import defaultdict

import pandas as pd
import requests
import yfinance as yf

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
NOW = dt.datetime.now(dt.timezone(dt.timedelta(hours=8)))


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def num(v):
    try:
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return None


def currency_of(t: str) -> str:
    if t.endswith((".TW", ".TWO")):
        return "TWD"
    if t.endswith((".KS", ".KQ")):
        return "KRW"
    if t.endswith((".PA", ".DE", ".AS", ".MI")):
        return "EUR"
    if t.endswith(".T"):
        return "JPY"
    return "USD"


def qlabel(end: dt.date) -> str:
    return f"{end.year}Q{(end.month - 1) // 3 + 1}"


# ---------------------------------------------------------------- watchlist
def load_watchlist():
    path = DATA / "watchlist.json"
    base = json.loads(path.read_text(encoding="utf-8"))
    raw = (os.environ.get("WATCHLIST") or "").strip()
    if not raw:
        return base, False
    try:
        items = json.loads(raw)
        items = [{"ticker": str(x["ticker"]).upper(), "name": x.get("name") or x["ticker"], "category": x.get("category") or "自訂"} for x in items if x.get("ticker")]
    except (json.JSONDecodeError, TypeError, KeyError):
        known = {x["ticker"]: x for x in base["items"]}
        items = [known.get(t.strip().upper(), {"ticker": t.strip().upper(), "name": t.strip().upper(), "category": "自訂"}) for t in raw.split(",") if t.strip()]
    if not items:
        return base, False
    base["items"] = items
    return base, True


# ---------------------------------------------------------------- quotes
def fetch_quotes(items):
    tickers = [x["ticker"] for x in items]
    out = {}
    hist = yf.download(tickers, period="13mo", interval="1d", group_by="ticker", auto_adjust=True, threads=True, progress=False)
    year_start = pd.Timestamp(NOW.year, 1, 1)
    for it in items:
        t = it["ticker"]
        try:
            df = hist[t] if isinstance(hist.columns, pd.MultiIndex) else hist
            close = df["Close"].dropna()
            if close.empty:
                raise ValueError("no data")
            idx = close.index.tz_localize(None) if close.index.tz is not None else close.index
            close.index = idx
            last, prev = float(close.iloc[-1]), float(close.iloc[-2]) if len(close) > 1 else float(close.iloc[-1])

            def ret(days):
                ref = close[close.index <= close.index[-1] - pd.Timedelta(days=days)]
                return round((last / float(ref.iloc[-1]) - 1) * 100, 1) if len(ref) else None

            ytd_ref = close[close.index < year_start]
            weekly = close.resample("W-FRI").last().dropna().tail(52)
            info = {}
            try:
                info = yf.Ticker(t).info or {}
            except Exception:  # noqa: BLE001
                pass
            out[t] = {
                "name": it.get("name") or info.get("shortName") or t,
                "category": it.get("category", "自訂"),
                "currency": info.get("currency") or currency_of(t),
                "price": round(last, 2),
                "change_pct": round((last / prev - 1) * 100, 2) if prev else None,
                "ret_1m": ret(30), "ret_3m": ret(91),
                "ret_ytd": round((last / float(ytd_ref.iloc[-1]) - 1) * 100, 1) if len(ytd_ref) else None,
                "ret_1y": ret(365),
                "market_cap": num(info.get("marketCap")),
                "pe": round(num(info.get("trailingPE")), 1) if num(info.get("trailingPE")) else None,
                "spark": [round(float(v), 2) for v in weekly.tolist()],
            }
        except Exception as e:  # noqa: BLE001
            log(f"[quote] {t} 失敗：{e}")
    return out


# ---------------------------------------------------------------- SEC EDGAR（美股）
SEC_UA = {"User-Agent": os.environ.get("SEC_USER_AGENT") or "AI Trends Tracker research@example.com"}
SEC_TAGS = {
    "revenue": ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet"],
    "gross_profit": ["GrossProfit"],
    "operating_income": ["OperatingIncomeLoss"],
    "net_income": ["NetIncomeLoss"],
    "eps": ["EarningsPerShareDiluted"],
}
_cik_map = None


def cik_of(ticker):
    global _cik_map
    if _cik_map is None:
        r = requests.get("https://www.sec.gov/files/company_tickers.json", headers=SEC_UA, timeout=30)
        r.raise_for_status()
        _cik_map = {v["ticker"].upper(): int(v["cik_str"]) for v in r.json().values()}
    return _cik_map.get(ticker.upper().replace(".", "-"))


def sec_quarters(facts, tags, unit):
    """把 10-Q／10-K 的期間數值整理成單季數值；累計數（YTD、全年）以相減推得單季。"""
    result = {}
    for tag in tags:
        units = facts.get("facts", {}).get("us-gaap", {}).get(tag, {}).get("units", {})
        entries = units.get(unit)
        if not entries:
            continue
        spans = {}
        for e in entries:
            if e.get("form") not in ("10-Q", "10-K", "10-Q/A", "10-K/A") or "start" not in e:
                continue
            spans[(e["start"], e["end"])] = e["val"]  # 後申報者覆蓋
        by_start = defaultdict(list)
        for (s, en), v in spans.items():
            by_start[s].append((en, v))
        q = {}
        for s, lst in by_start.items():
            lst.sort()
            sd = dt.date.fromisoformat(s)
            prev_end, prev_val = None, None
            for en, v in lst:
                ed = dt.date.fromisoformat(en)
                days = (ed - sd).days
                if 80 <= days <= 100:
                    q.setdefault(en, v)
                elif prev_end is not None and 80 <= (ed - prev_end).days <= 100 and days > 100:
                    q.setdefault(en, v - prev_val)
                if days <= 380:
                    prev_end, prev_val = ed, v
        for en, v in q.items():
            result.setdefault(en, v)  # 先出現的標籤優先，其餘補缺
    return result


def fin_sec(ticker):
    cik = cik_of(ticker)
    if not cik:
        return None
    r = requests.get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json", headers=SEC_UA, timeout=60)
    r.raise_for_status()
    facts = r.json()
    series = {k: sec_quarters(facts, tags, "USD/shares" if k == "eps" else "USD") for k, tags in SEC_TAGS.items()}
    ends = sorted(series["revenue"].keys() or series["net_income"].keys())[-8:]
    if len(ends) < 4:
        return None
    rows = []
    for en in ends:
        ed = dt.date.fromisoformat(en)
        rows.append({"period": qlabel(ed), "end": en, **{k: num(series[k].get(en)) for k in SEC_TAGS}})
    return {"currency": "USD", "source": "sec", "quarters": rows}


# ---------------------------------------------------------------- FinMind（台股）
FINMIND_TYPES = {"Revenue": "revenue", "GrossProfit": "gross_profit", "OperatingIncome": "operating_income",
                 "EquityAttributableToOwnersOfParent": "net_income", "IncomeAfterTaxes": "net_income_alt", "EPS": "eps"}


def fin_finmind(ticker):
    code = ticker.split(".")[0]
    headers = {}
    if os.environ.get("FINMIND_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['FINMIND_TOKEN']}"
    params = {"dataset": "TaiwanStockFinancialStatements", "data_id": code, "start_date": (NOW.date() - dt.timedelta(days=365 * 3)).isoformat()}
    r = requests.get("https://api.finmindtrade.com/api/v4/data", params=params, headers=headers, timeout=60)
    r.raise_for_status()
    data = r.json().get("data", [])
    by_date = defaultdict(dict)
    for row in data:
        k = FINMIND_TYPES.get(row.get("type"))
        if k:
            by_date[row["date"]][k] = num(row.get("value"))
    ends = sorted(by_date)[-8:]
    if len(ends) < 4:
        return None
    rows = []
    for en in ends:
        d = by_date[en]
        rows.append({"period": qlabel(dt.date.fromisoformat(en)), "end": en, "revenue": d.get("revenue"), "gross_profit": d.get("gross_profit"),
                     "operating_income": d.get("operating_income"), "net_income": d.get("net_income", d.get("net_income_alt")), "eps": d.get("eps")})
    return {"currency": "TWD", "source": "finmind", "quarters": rows}


# ---------------------------------------------------------------- yfinance（其他市場／備援）
YF_ROWS = {"revenue": ["Total Revenue", "Operating Revenue"], "gross_profit": ["Gross Profit"], "operating_income": ["Operating Income"],
           "net_income": ["Net Income", "Net Income Common Stockholders"], "eps": ["Diluted EPS", "Basic EPS"]}


def fin_yahoo(ticker):
    df = yf.Ticker(ticker).quarterly_income_stmt
    if df is None or df.empty:
        return None
    cols = sorted(df.columns)[-8:]
    rows = []
    for c in cols:
        rec = {"period": qlabel(c.date()), "end": c.date().isoformat()}
        for k, names in YF_ROWS.items():
            rec[k] = next((num(df.at[n, c]) for n in names if n in df.index and num(df.at[n, c]) is not None), None)
        rows.append(rec)
    return {"currency": currency_of(ticker), "source": "yahoo", "quarters": rows}


def fetch_financials(items):
    out = {}
    for it in items:
        t = it["ticker"]
        res = None
        try:
            if t.endswith((".TW", ".TWO")):
                res = fin_finmind(t)
            elif "." not in t:
                res = fin_sec(t)
                time.sleep(0.15)  # SEC 限每秒 10 次
        except Exception as e:  # noqa: BLE001
            log(f"[fin] {t} 主要來源失敗：{e}")
        if not res:
            try:
                res = fin_yahoo(t)
            except Exception as e:  # noqa: BLE001
                log(f"[fin] {t} yfinance 失敗：{e}")
        if res:
            res["name"] = it.get("name") or t
            out[t] = res
            write_csv(t, res)
    return out


def write_csv(t, res):
    (DATA / "csv").mkdir(exist_ok=True)
    path = DATA / "csv" / f"{''.join(ch if ch.isalnum() else '_' for ch in t)}.csv"
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["Period", "PeriodEnd", "Currency", "Revenue", "GrossProfit", "OperatingIncome", "NetIncome", "EPS"])
        for q in res["quarters"]:
            w.writerow([q["period"], q["end"], res["currency"], q.get("revenue"), q.get("gross_profit"), q.get("operating_income"), q.get("net_income"), q.get("eps")])


def main():
    wl, changed = load_watchlist()
    items = wl["items"]
    log(f"追蹤 {len(items)} 檔")
    stamp = NOW.strftime("%Y-%m-%d %H:%M")
    quotes = fetch_quotes(items)
    fins = fetch_financials(items)
    (DATA / "market.json").write_text(json.dumps({"updated": stamp, "demo": False, "quotes": quotes}, ensure_ascii=False), encoding="utf-8")
    (DATA / "financials.json").write_text(json.dumps({"updated": stamp, "demo": False, "items": fins}, ensure_ascii=False), encoding="utf-8")
    if changed:
        cats = wl.get("categories", [])
        for it in items:
            if it["category"] not in cats:
                cats.append(it["category"])
        wl["categories"] = cats
        (DATA / "watchlist.json").write_text(json.dumps(wl, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"完成：行情 {len(quotes)} 檔、財報 {len(fins)} 檔")


if __name__ == "__main__":
    main()
