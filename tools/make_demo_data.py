"""產生示意用 market.json / financials.json（僅供首次預覽版面，部署後由 update_market.py 覆蓋）。"""
import json, random, math, datetime as dt, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
wl = json.load(open(ROOT/'data/watchlist.json', encoding='utf-8'))
random.seed(7)
def cur(t):
    if t.endswith('.TW') or t.endswith('.TWO'): return 'TWD'
    if t.endswith('.KS'): return 'KRW'
    if t.endswith('.PA'): return 'EUR'
    return 'USD'
quotes, fins = {}, {}
qlabels = ['2024Q3','2024Q4','2025Q1','2025Q2','2025Q3','2025Q4','2026Q1','2026Q2']
qends = ['2024-09-30','2024-12-31','2025-03-31','2025-06-30','2025-09-30','2025-12-31','2026-03-31','2026-06-30']
for it in wl['items']:
    t = it['ticker']; c = cur(t)
    base = {'USD': random.uniform(40, 600), 'TWD': random.uniform(80, 1500), 'KRW': random.uniform(50000, 300000), 'EUR': random.uniform(150, 280)}[c]
    p = base; spark = []
    for w in range(52):
        p *= math.exp(random.gauss(0.006, 0.05)); spark.append(round(p, 2))
    last = spark[-1]; prev = last / (1 + random.gauss(0, 0.02))
    def r(n): return round((spark[-1] / spark[-1-n] - 1) * 100, 1)
    quotes[t] = {'name': it['name'], 'category': it['category'], 'currency': c, 'price': round(last, 2),
                 'change_pct': round((last/prev-1)*100, 2), 'ret_1m': r(4), 'ret_3m': r(13), 'ret_ytd': r(41), 'ret_1y': r(51),
                 'market_cap': None, 'pe': round(random.uniform(15, 60), 1), 'spark': spark}
    scale = {'USD': 1e9, 'TWD': 1e10, 'KRW': 1e12, 'EUR': 1e9}[c]
    rev = random.uniform(2, 60) * scale; rows = []
    for i in range(8):
        rev *= math.exp(random.gauss(0.05, 0.05)); gm = random.uniform(0.2, 0.7); om = gm - random.uniform(0.05, 0.2)
        ni = rev * om * 0.82
        rows.append({'period': qlabels[i], 'end': qends[i], 'revenue': round(rev), 'gross_profit': round(rev*gm),
                     'operating_income': round(rev*om), 'net_income': round(ni), 'eps': round(ni/(scale*random.uniform(1.8,2.2))*10, 2)})
    fins[t] = {'name': it['name'], 'currency': c, 'source': 'demo', 'quarters': rows}
json.dump({'updated': '2026-10-17', 'demo': True, 'quotes': quotes}, open(ROOT/'data/market.json', 'w', encoding='utf-8'), ensure_ascii=False)
json.dump({'updated': '2026-10-17', 'demo': True, 'items': fins}, open(ROOT/'data/financials.json', 'w', encoding='utf-8'), ensure_ascii=False)
print('ok', len(quotes))
