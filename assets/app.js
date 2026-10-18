/* AI 趨勢研究追蹤 — 前端主程式（無框架、無建置步驟） */
(() => {
  'use strict';

  const FILES = ['news', 'demand', 'aidc', 'products', 'applications', 'market', 'financials', 'watchlist', 'etf'];
  const D = {};
  const charts = new Map();
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const TAGS = { demand: 'AI 需求', aidc: 'AIDC', products: '產品規格', supply: '供應鏈', apps: '應用場域' };
  const PAGES = ['home', 'demand', 'aidc', 'products', 'supply', 'apps'];

  /* ---------- 安全的本機儲存 ---------- */
  const store = {
    get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
  };

  /* ---------- 載入資料 ---------- */
  const relFetch = async (f) => {
    const r = await fetch(`data/${f}.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    return r.json();
  };
  const ghFetch = (gh) => async (f) => {
    const url = `https://api.github.com/repos/${gh.owner}/${gh.repo}/contents/data/${f}.json?ref=${encodeURIComponent(gh.branch || 'main')}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${gh.token}`, Accept: 'application/vnd.github.raw+json' }, cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    return r.json();
  };
  async function loadAll(fetcher = relFetch) {
    if (fetcher === relFetch && window.__INLINE__) { FILES.forEach((f) => { D[f] = window.__INLINE__[f]; }); return; }
    await Promise.all(FILES.map(async (f) => {
      try { D[f] = await fetcher(f); }
      catch { if (!D[f] && window.__INLINE__ && window.__INLINE__[f]) D[f] = window.__INLINE__[f]; }
    }));
  }

  /* ---------- 格式 ---------- */
  const sign = (v) => (v > 0 ? '+' : '');
  const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
  const pct = (v, d = 1) => (v == null || isNaN(v) ? '—' : `<span class="num ${cls(v)}">${sign(v)}${Number(v).toFixed(d)}%</span>`);
  const fmtPrice = (v, cur) => {
    if (v == null) return '—';
    const d = cur === 'KRW' ? 0 : 2;
    return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  const fmtBig = (v, cur) => {
    if (v == null || isNaN(v)) return '—';
    const a = Math.abs(v);
    if (cur === 'TWD') return a >= 1e12 ? `${(v / 1e12).toFixed(2)} 兆` : `${(v / 1e8).toFixed(1)} 億`;
    if (cur === 'KRW') return a >= 1e12 ? `${(v / 1e12).toFixed(2)} 兆` : `${(v / 1e8).toFixed(0)} 億`;
    return a >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : `${(v / 1e6).toFixed(0)}M`;
  };
  const curSym = { USD: 'US$', TWD: 'NT$', KRW: '₩', EUR: '€' };

  /* ---------- 主題與圖表色彩 ---------- */
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function applyTheme() {
    const t = store.get('theme');
    if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
  }
  function isDark() {
    const t = document.documentElement.getAttribute('data-theme');
    return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function chartDefaults() {
    if (!window.Chart) return;
    Chart.defaults.font.family = css('--font-cjk');
    Chart.defaults.font.size = 12;
    Chart.defaults.color = css('--muted');
    Chart.defaults.borderColor = css('--line');
    Chart.defaults.plugins.legend.labels.boxWidth = 12;
    Chart.defaults.plugins.legend.labels.boxHeight = 12;
    Chart.defaults.maintainAspectRatio = false;
  }
  const palette = () => [css('--chart-1'), css('--chart-2'), css('--chart-3'), css('--chart-4')];
  function makeChart(id, cfg) {
    const el = document.getElementById(id);
    if (!el || !window.Chart) { if (el) el.closest('.chart-box')?.insertAdjacentHTML('beforeend', '<p class="note">圖表元件未載入。</p>'); return; }
    if (charts.has(id)) charts.get(id).destroy();
    charts.set(id, new Chart(el, cfg));
  }
  function destroyCharts(prefix) { for (const [k, c] of charts) if (!prefix || k.startsWith(prefix)) { c.destroy(); charts.delete(k); } }

  /* ---------- 共用片段 ---------- */
  const head = (title, desc, date) => `
    <div class="page-head">
      <div><h1>${esc(title)}</h1>${desc ? `<p>${esc(desc)}</p>` : ''}</div>
      ${date ? `<span class="stamp">資料日期 ${esc(date)}</span>` : ''}
    </div>`;
  const kpiRail = (kpis = []) => `<div class="kpis">${kpis.map((k) => `
      <div class="kpi"><div class="kpi-label">${esc(k.label)}</div><div class="kpi-value">${esc(k.value)}</div><div class="kpi-note">${esc(k.note)}</div></div>`).join('')}</div>`;
  const table = (cols, rows, opts = {}) => `
    <div class="table-wrap"><table>
      <thead><tr>${cols.map((c, i) => `<th class="${(opts.right || []).includes(i) ? 'r' : ''}">${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${(opts.right || []).includes(i) ? 'r' : ''}${i === 0 ? ' nowrap' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  const statusBadge = (s) => {
    const c = /營運/.test(s) ? 'status-on' : /興建|擴建/.test(s) ? 'status-build' : '';
    return `<span class="status ${c}">${esc(s)}</span>`;
  };

  /* ---------- 追蹤清單 ---------- */
  function getWatchlist() {
    const saved = store.get('watchlist_v1');
    if (Array.isArray(saved) && saved.length) return saved;
    return (D.watchlist?.items || []).map((x) => ({ ...x }));
  }
  const saveWatchlist = (wl) => store.set('watchlist_v1', wl);
  const quoteOf = (t) => D.market?.quotes?.[t];

  /* ---------- 頂部行情列 ---------- */
  function renderTicker() {
    const wl = getWatchlist();
    const demo = D.market?.demo;
    const items = wl.slice(0, 18).map((w) => {
      const q = quoteOf(w.ticker);
      if (!q) return '';
      return `<button class="tk" type="button" data-fin="${esc(w.ticker)}"><b>${esc(w.name)}</b><span class="num">${fmtPrice(q.price, q.currency)}</span>${pct(q.change_pct, 2)}</button>`;
    }).join('');
    $('#ticker').innerHTML = `<div class="ticker-inner">${demo ? '<span class="ticker-demo">示意行情</span>' : ''}${items}</div>`;
  }

  /* ---------- 首頁 ---------- */
  let homeFilter = 'all';
  function renderHome() {
    const el = $('#page-home');
    const items = [...(D.news?.items || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const lead = items.find((x) => x.lead) || items[0];
    const rest = items.filter((x) => x !== lead);
    const seconds = rest.slice(0, 3);
    const list = rest.slice(3);
    const link = (it, inner, c) => it.url ? `<a class="${c}" href="${esc(it.url)}" target="_blank" rel="noopener">${inner}</a>` : `<div class="${c}">${inner}</div>`;
    const meta = (it) => `<div class="meta"><span class="tag" data-tag="${esc(it.tag)}">${esc(TAGS[it.tag] || '綜合')}</span><span>${esc(it.source)}</span><span class="num">${esc((it.date || '').slice(5).replace('-', '/'))}</span></div>`;

    const aidc = D.aidc || {}; const dem = D.demand || {};
    const q = aidc.quarterly_capex;
    const quotes = Object.entries(D.market?.quotes || {}).map(([t, v]) => ({ t, ...v })).filter((x) => x.change_pct != null);
    quotes.sort((a, b) => b.change_pct - a.change_pct);
    const movers = [...quotes.slice(0, 3), ...quotes.slice(-3).reverse()];

    el.innerHTML = `
      <div class="home">
        <div>
          ${lead ? link(lead, `${meta(lead)}<h2>${esc(lead.title)}</h2><p>${esc(lead.summary)}</p>`, 'lead') : ''}
          <div class="seconds">${seconds.map((it) => link(it, `${meta(it)}<h3>${esc(it.title)}</h3>`, 'second')).join('')}</div>
          <div class="hl-title"><h2>最新消息</h2>
            <div class="filters" role="group" aria-label="篩選消息">
              ${[['all', '全部'], ['demand', 'AI 需求'], ['aidc', 'AIDC'], ['products', '產品規格'], ['apps', '應用場域']].map(([k, v]) => `<button class="chip" type="button" data-hf="${k}" aria-pressed="${homeFilter === k}">${v}</button>`).join('')}
            </div>
          </div>
          <ul class="hl-list">${list.filter((it) => homeFilter === 'all' || it.tag === homeFilter).map((it) => `
            <li class="hl-item"><span class="hl-date">${esc((it.date || '').slice(5).replace('-', '/'))}</span>
              <div>${it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>` : `<span class="t">${esc(it.title)}</span>`}
                ${it.summary ? `<p>${esc(it.summary)}</p>` : ''}
                <div class="meta"><a class="tag" data-tag="${esc(it.tag)}" href="#${esc(it.tag)}">${esc(TAGS[it.tag] || '綜合')}</a><span>${esc(it.source)}</span></div>
              </div></li>`).join('') || '<li class="hl-item"><span></span><span class="muted">這個分類目前沒有其他消息。</span></li>'}
          </ul>
        </div>
        <aside class="rail" aria-label="關鍵指標">
          <h2>關鍵指標</h2>
          ${aidc.kpis?.[0] ? `<div class="rail-item"><div class="kpi-label">${esc(aidc.kpis[0].label)}</div><div class="kpi-value">${esc(aidc.kpis[0].value)}</div><div class="kpi-note">${esc(aidc.kpis[0].note)}</div></div>` : ''}
          ${q ? `<div class="rail-item"><div class="kpi-label">單季資本支出（十億美元）</div><div class="chart-box"><canvas id="home-capex"></canvas></div><a class="jump" href="#aidc">看投資計畫與財報</a></div>` : ''}
          ${dem.kpis?.[0] ? `<div class="rail-item"><div class="kpi-label">${esc(dem.kpis[0].label)}</div><div class="kpi-value">${esc(dem.kpis[0].value)}</div><div class="kpi-note">${esc(dem.kpis[0].note)}</div></div>` : ''}
          ${movers.length ? `<div class="rail-item"><div class="kpi-label">追蹤清單今日漲跌${D.market?.demo ? '（示意）' : ''}</div>
            <div class="movers">${movers.map((m) => `<span>${esc(m.name)}</span>${pct(m.change_pct, 2)}`).join('')}</div>
            <a class="jump" href="#supply">看完整追蹤清單</a></div>` : ''}
        </aside>
      </div>`;

    $$('[data-hf]', el).forEach((b) => b.addEventListener('click', () => { homeFilter = b.dataset.hf; renderHome(); }));
    if (q) {
      const onNavy = css('--on-navy-muted');
      makeChart('home-capex', {
        type: 'bar',
        data: { labels: q.series.map((s) => s.name), datasets: [{ data: q.series.map((s) => s.values[s.values.length - 1]), backgroundColor: css('--amber'), borderRadius: 2, maxBarThickness: 34 }] },
        options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `$${c.raw}B（${q.labels[q.labels.length - 1]}）` } } },
          scales: { x: { ticks: { color: onNavy }, grid: { display: false } }, y: { ticks: { color: onNavy }, grid: { color: 'rgba(255,255,255,.08)' } } } }
      });
    }
  }

  /* ---------- AI 需求 ---------- */
  function renderDemand() {
    const d = D.demand; const el = $('#page-demand');
    if (!d) { el.innerHTML = head('AI 需求與發展', '資料尚未載入。'); return; }
    el.innerHTML = `
      ${head('AI 需求與發展', '從 AI 公司營收、估值、募資與算力供應商動態，量化 AI 需求的規模與成長速度。', d.updated)}
      ${kpiRail(d.kpis)}
      <div class="grid-2 stack-gap">
        <div class="block"><h2>主要 AI 公司年化營收</h2><p class="sub">單位：${esc(d.runrate.unit)}</p>
          <div class="chart-box"><canvas id="dem-runrate"></canvas></div><p class="note">${esc(d.runrate.note)}</p></div>
        <div class="block"><h2>需求訊號</h2><p class="sub">來自 CSP 財報與研究機構的第一手說法</p>
          ${table(['來源', '內容', '時間'], d.signals.map((s) => [esc(s.who), esc(s.text), `<span class="num">${esc(s.date)}</span>`]))}</div>
      </div>
      <div class="block"><h2>AI 服務公司</h2><p class="sub">營收以公司揭露或主流媒體報導為準，並註明時間點</p>
        ${table(['公司', '主要產品', '營收', '估值', '備註'], d.companies.map((c) => [`<b>${esc(c.name)}</b>`, esc(c.product), esc(c.revenue), esc(c.valuation), esc(c.note)]))}</div>
      <div class="block"><h2>算力供應商（Neocloud／GPU 雲）</h2><p class="sub">股價與財報請見「供應鏈與股價」</p>
        ${table(['公司', '定位', '最新動態'], d.neoclouds.map((c) => [`<b>${esc(c.name)}</b>`, esc(c.role), esc(c.note)]))}</div>`;
    const pal = palette();
    makeChart('dem-runrate', {
      type: 'line',
      data: { labels: d.runrate.labels, datasets: d.runrate.series.map((s, i) => ({ label: s.name, data: s.values, borderColor: pal[i === 0 ? 1 : 0], backgroundColor: pal[i === 0 ? 1 : 0], tension: .25, spanGaps: true, pointRadius: 4, borderWidth: 2.5 })) },
      options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}：$${c.raw}B` } } }, scales: { y: { beginAtZero: true, ticks: { callback: (v) => `$${v}B` } }, x: { grid: { display: false } } } }
    });
  }

  /* ---------- AIDC ---------- */
  let regionFilter = '全部';
  function renderAidc() {
    const a = D.aidc; const el = $('#page-aidc');
    if (!a) { el.innerHTML = head('AIDC 建置與投資', '資料尚未載入。'); return; }
    const regions = ['全部', ...new Set(a.projects.map((p) => p.region))];
    const projs = a.projects.filter((p) => regionFilter === '全部' || p.region === regionFilter);
    const mwKnown = projs.reduce((s, p) => s + (p.mw || 0), 0);
    el.innerHTML = `
      ${head('AIDC 建置與投資', '追蹤各大 CSP 與 AI 公司的資本支出、財報表現，以及全球在建與規劃中的 AI 資料中心。', a.updated)}
      ${kpiRail(a.kpis)}
      <div class="grid-2 stack-gap">
        <div class="block"><h2>2026 資本支出指引變化</h2><p class="sub">單位：${esc(a.guidance.unit)}</p>
          ${table(['公司', ...a.guidance.columns, '說明'], [
            ...a.guidance.rows.map((r) => [`<b>${esc(r.name)}</b>`, ...r.values.map((v, i) => `<span class="num"${i === r.values.length - 1 ? ' style="font-weight:700"' : ''}>${esc(v)}</span>`), esc(r.note)]),
            ['<b>合計</b>', ...a.guidance.total.map((v) => `<span class="num" style="font-weight:700">${esc(v)}</span>`), '']
          ], { right: [1, 2, 3] })}</div>
        <div class="block"><h2>單季資本支出</h2><p class="sub">單位：${esc(a.quarterly_capex.unit)}</p>
          <div class="chart-box"><canvas id="aidc-capex"></canvas></div><p class="note">${esc(a.quarterly_capex.note)}</p></div>
      </div>
      <div class="block"><h2>CSP 財報重點</h2><p class="sub">${esc(a.results.period)}；完整近八季財報可在「供應鏈與股價」點選公司查看並下載</p>
        ${table(['公司', '營收', '年增', 'EPS', '雲端與 AI'], a.results.rows.map((r) => [`<b>${esc(r.name)}</b>`, `<span class="num">${esc(r.revenue)}</span>`, `<span class="num">${esc(r.growth)}</span>`, `<span class="num">${esc(r.eps)}</span>`, esc(r.cloud)]), { right: [1, 2, 3] })}
        <p class="note">${a.results.notes.map(esc).join('<br>')}</p></div>
      <div class="block"><h2>全球 AIDC 專案</h2>
        <p class="sub">共 ${projs.length} 案，已揭露容量合計約 <span class="num" style="font-size:15px">${mwKnown.toLocaleString()}</span> MW（未揭露者不計入）</p>
        <div class="filters stack-gap" role="group" aria-label="依地區篩選">${regions.map((r) => `<button class="chip" type="button" data-rf="${esc(r)}" aria-pressed="${regionFilter === r}">${esc(r)}</button>`).join('')}</div>
        ${table(['專案', '業主', '地點', '容量', '狀態', '說明'], projs.map((p) => [`<b>${esc(p.name)}</b>`, esc(p.owner), esc(p.location), p.mw ? `<span class="num">${p.mw.toLocaleString()} MW</span>` : '<span class="muted">未揭露</span>', statusBadge(p.status), esc(p.note)]), { right: [3] })}
        <p class="note">地圖檢視將於自架伺服器版本加入（需載入地圖圖磚）。</p></div>
      <div class="block"><h2>風險觀察</h2>
        ${table(['議題', '說明'], a.risks.map((r) => [`<b>${esc(r.title)}</b>`, esc(r.text)]))}</div>`;
    $$('[data-rf]', el).forEach((b) => b.addEventListener('click', () => { regionFilter = b.dataset.rf; renderAidc(); }));
    const pal = palette(); const q = a.quarterly_capex;
    makeChart('aidc-capex', {
      type: 'bar',
      data: { labels: q.labels, datasets: q.series.map((s, i) => ({ label: s.name, data: s.values, backgroundColor: pal[i], borderRadius: 2 })) },
      options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}：$${c.raw}B` } } }, scales: { y: { beginAtZero: true, ticks: { callback: (v) => `$${v}B` } }, x: { grid: { display: false } } } }
    });
  }

  /* ---------- 產品與規格 ---------- */
  function renderProducts() {
    const p = D.products; const el = $('#page-products');
    if (!p) { el.innerHTML = head('AIDC 產品與規格', '資料尚未載入。'); return; }
    el.innerHTML = `
      ${head('AIDC 產品與規格', 'AI 資料中心硬體堆疊：晶片、伺服器、記憶體、電力、散熱、網路。規格每週自動檢查更新。', p.updated)}
      <div class="demo-flag" style="background:transparent;border:1px solid var(--line);color:var(--muted)">最後自動檢查：<span class="num" style="font-size:14px">${esc(p.last_checked)}</span>。${esc(p.auto_update_note)}</div>
      <div class="subnav" role="navigation" aria-label="產品類別">${p.categories.map((c) => `<a class="chip" href="#products" data-jump="cat-${esc(c.id)}">${esc(c.name)}</a>`).join('')}</div>
      ${p.categories.map((c) => `
        <div class="block" id="cat-${esc(c.id)}"><h2>${esc(c.name)}</h2>
          <p class="cat-summary">${esc(c.summary)}</p>
          ${c.chart ? `<div class="grid-2 stack-gap"><div>${table(c.columns, c.items.map((r) => r.map((v, i) => (i === 0 ? `<b>${esc(v)}</b>` : esc(v)))))}</div>
              <div><div class="chart-box"><canvas id="prod-${esc(c.id)}"></canvas></div><p class="note">${esc(c.chart.note)}</p></div></div>`
            : table(c.columns, c.items.map((r) => r.map((v, i) => (i === 0 ? `<b>${esc(v)}</b>` : esc(v)))))}
        </div>`).join('')}
      <div class="block"><h2>規格變更紀錄</h2>
        <ul class="changelog">${(p.changelog || []).slice().reverse().map((c) => `<li><span class="num">${esc(c.date)}</span><span>${esc(c.category)}</span><span>${esc(c.text)}</span></li>`).join('')}</ul></div>`;
    $$('[data-jump]', el).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); document.getElementById(a.dataset.jump)?.scrollIntoView({ behavior: 'smooth' }); }));
    p.categories.filter((c) => c.chart).forEach((c) => {
      makeChart(`prod-${c.id}`, {
        type: 'bar',
        data: { labels: c.chart.labels, datasets: [{ label: c.chart.title, data: c.chart.values, backgroundColor: c.chart.values.map((_, i) => (i === c.chart.values.length - 1 ? css('--amber') : css('--chart-1'))), borderRadius: 2 }] },
        options: { plugins: { legend: { display: false }, title: { display: true, text: `${c.chart.title}（${c.chart.unit}）`, align: 'start', color: css('--ink'), font: { weight: '500', size: 13 } } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true } } }
      });
    });
  }

  /* ---------- 供應鏈與股價 ---------- */
  function spark(vals, up) {
    if (!vals || vals.length < 2) return '';
    const min = Math.min(...vals), max = Math.max(...vals), w = 96, h = 28;
    const pts = vals.map((v, i) => `${(i / (vals.length - 1) * w).toFixed(1)},${(h - 2 - (v - min) / (max - min || 1) * (h - 4)).toFixed(1)}`).join(' ');
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(${up ? '--up' : '--down'})" stroke-width="1.6"/></svg>`;
  }

  /* ---------- 台股 ETF 持股 ---------- */
  let etfSel = null;
  function etfBlock(wl) {
    const E = D.etf;
    if (!E || !E.etfs || !E.etfs.length) return '';
    const etfs = E.etfs;
    if (!etfSel || !etfs.some((x) => x.code === etfSel)) etfSel = (etfs.find((x) => x.ok) || etfs[0]).code;
    const e = etfs.find((x) => x.code === etfSel);
    const wset = new Set(wl.map((w) => w.ticker));
    const hs = e.holdings || [];
    const maxW = Math.max(1, ...hs.map((h) => h.weight || 0));
    const top10 = hs.reduce((sum, h) => sum + (h.weight || 0), 0);
    const mark = (h) => (h.ticker && wset.has(h.ticker)
      ? '<span class="aidc-mark">追蹤中</span>'
      : h.ticker ? `<button class="rm" type="button" data-etf-add="${esc(h.ticker)}" data-etf-name="${esc(h.name)}">加入追蹤</button>` : '');

    // 重疊持股：出現在兩檔以上 ETF，或已在追蹤清單中的公司
    const map = new Map();
    etfs.forEach((x) => (x.holdings || []).forEach((h) => {
      const key = h.ticker || h.name;
      if (!map.has(key)) map.set(key, { name: h.name, ticker: h.ticker, w: {} });
      map.get(key).w[x.code] = h.weight;
    }));
    const overlap = [...map.values()]
      .filter((r) => Object.keys(r.w).length >= 2 || (r.ticker && wset.has(r.ticker)))
      .sort((a, b) => Object.keys(b.w).length - Object.keys(a.w).length || Object.values(b.w).reduce((p, c) => p + c, 0) - Object.values(a.w).reduce((p, c) => p + c, 0))
      .slice(0, 20);

    return `
      <div class="block" id="etf-block"><h2>台股主要 ETF 持股配置</h2>
        <p class="sub">每次更新時自動抓取各 ETF 前十大持股與產業比重${E.updated ? `；最後更新 ${esc(E.updated)}` : ''}</p>
        <div class="filters stack-gap" role="group" aria-label="選擇 ETF">${etfs.map((x) => `<button class="chip" type="button" data-etf="${esc(x.code)}" aria-pressed="${x.code === etfSel}">${esc(x.code)} ${esc(x.name)}</button>`).join('')}</div>
        ${!e.ok ? `<div class="pending-box">${esc(e.code)} ${esc(e.name)} 尚無持股資料，下次更新時會自動抓取。</div>` : `
        ${e.stale ? '<div class="demo-flag">本次更新未取得最新資料，以下為上次成功抓取的內容。</div>' : ''}
        <div class="grid-2">
          <div class="table-wrap"><table>
            <thead><tr><th>排名</th><th>公司</th><th class="r">權重</th><th></th><th></th></tr></thead>
            <tbody>${hs.map((h, i) => `<tr>
              <td class="num">${i + 1}</td>
              <td class="nowrap"><b style="font-weight:500">${esc(h.name)}</b>${h.ticker ? `<small class="muted" style="display:block;font-size:12px">${esc(h.ticker)}</small>` : ''}</td>
              <td class="r"><span class="num">${Number(h.weight).toFixed(2)}%</span></td>
              <td style="width:32%"><div class="wbar"><span style="width:${(h.weight / maxW * 100).toFixed(1)}%"></span></div></td>
              <td class="nowrap">${mark(h)}</td></tr>`).join('')}</tbody></table></div>
          <div>
            <dl class="etf-meta">
              <div><dt>類型</dt><dd>${esc(e.type || '—')}</dd></div>
              <div><dt>發行投信</dt><dd>${esc(e.issuer || '—')}</dd></div>
              <div><dt>前十大合計</dt><dd class="num">${top10.toFixed(1)}%</dd></div>
              <div><dt>股票部位</dt><dd class="num">${e.assets && e.assets['股票'] != null ? `${Number(e.assets['股票']).toFixed(1)}%` : '—'}</dd></div>
            </dl>
            ${(e.industries || []).length ? `<h3 class="mini-h">產業比重</h3>${e.industries.slice(0, 8).map((d) => `
              <div class="ind-row"><span>${esc(d.name)}</span><div class="wbar"><span style="width:${Math.min(100, d.weight).toFixed(1)}%"></span></div><span class="num">${Number(d.weight).toFixed(1)}%</span></div>`).join('')}` : ''}
            <p class="note">持股資料日期 ${esc(e.holdings_date || '—')}；產業資料日期 ${esc(e.industry_date || '—')}；來源 ${esc(e.source || '—')}。ETF 持股依投信揭露頻率更新，主動式 ETF 異動較頻繁。</p>
          </div>
        </div>`}
        ${overlap.length ? `<h3 class="mini-h" style="margin-top:20px">重疊持股對照</h3>
          <p class="sub">出現在兩檔以上 ETF 前十大，或已在追蹤清單中的公司（數字為該 ETF 權重）</p>
          <div class="table-wrap"><table>
            <thead><tr><th>公司</th>${etfs.map((x) => `<th class="r">${esc(x.code)}</th>`).join('')}<th></th></tr></thead>
            <tbody>${overlap.map((r) => `<tr><td class="nowrap"><b style="font-weight:500">${esc(r.name)}</b></td>
              ${etfs.map((x) => `<td class="r">${r.w[x.code] != null ? `<span class="num">${Number(r.w[x.code]).toFixed(2)}%</span>` : '<span class="muted">—</span>'}</td>`).join('')}
              <td class="nowrap">${r.ticker && wset.has(r.ticker) ? '<span class="aidc-mark">追蹤中</span>' : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
      </div>`;
  }

  function renderSupply() {
    const el = $('#page-supply');
    const wl = getWatchlist();
    const cats = [...new Set([...(D.watchlist?.categories || []), ...wl.map((w) => w.category)])];
    const demo = D.market?.demo;
    const rows = [];
    cats.forEach((cat) => {
      const its = wl.filter((w) => w.category === cat);
      if (!its.length) return;
      rows.push(`<tr class="cat-row"><td colspan="10">${esc(cat)}</td></tr>`);
      its.forEach((w) => {
        const q = quoteOf(w.ticker);
        const hasFin = !!D.financials?.items?.[w.ticker];
        rows.push(`<tr>
          <td class="nowrap"><button class="row-btn" type="button" data-fin="${esc(w.ticker)}"><b>${esc(w.name || q?.name || w.ticker)}</b><small>${esc(w.ticker)}</small></button></td>
          ${q ? `<td class="r"><span class="num">${curSym[q.currency] || ''}${fmtPrice(q.price, q.currency)}</span></td>
            <td class="r">${pct(q.change_pct, 2)}</td><td class="r">${pct(q.ret_1m)}</td><td class="r">${pct(q.ret_3m)}</td><td class="r">${pct(q.ret_ytd)}</td><td class="r">${pct(q.ret_1y)}</td>
            <td class="r"><span class="num">${q.pe != null ? Number(q.pe).toFixed(1) : '—'}</span></td><td>${spark(q.spark, (q.ret_1y || 0) >= 0)}</td>`
            : `<td colspan="8" class="pending">尚無資料，按「更新資料」後取得行情與財報</td>`}
          <td class="nowrap">${hasFin ? `<button class="rm" type="button" data-fin="${esc(w.ticker)}">財報</button> ` : ''}<button class="rm" type="button" data-rm="${esc(w.ticker)}" aria-label="移除 ${esc(w.ticker)}">移除</button></td>
        </tr>`);
      });
    });
    el.innerHTML = `
      ${head('供應鏈與股價追蹤', '依 AIDC 產品類別追蹤主要供應商的股價與營運表現。可自行增減追蹤公司，點選公司可查看並下載近八季財報。', D.market?.updated)}
      <div class="block"><h2>AIDC 供應鏈架構</h2><p class="sub">由上游關鍵零組件到下游算力需求方</p>
        <div class="chain">
          <div><h3>上游：關鍵製造與零組件</h3><ul><li>晶圓代工與先進封裝（台積電）</li><li>HBM 與記憶體（SK hynix、Samsung、Micron）</li><li>光通訊元件（Coherent）</li></ul></div>
          <div><h3>中游：晶片設計與系統整合</h3><ul><li>GPU／ASIC（NVIDIA、AMD、Broadcom、Marvell）</li><li>伺服器 ODM（鴻海、廣達、緯創、緯穎）</li><li>電源與散熱（台達電、Vertiv、奇鋐、雙鴻）</li><li>網路設備（Arista、智邦）</li></ul></div>
          <div><h3>下游：算力需求方</h3><ul><li>CSP（Microsoft、Alphabet、Amazon、Meta、Oracle）</li><li>Neocloud（CoreWeave 等）</li><li>AI 模型公司</li></ul></div>
        </div></div>
      <div class="block">
        <div class="wl-bar"><div><h2>追蹤清單</h2><p class="sub" style="margin:0">共 ${wl.length} 家；漲跌採台股慣例，紅漲綠跌</p></div>
          <form class="wl-add" id="wlForm">
            <input name="ticker" placeholder="代號，例 NVDA、2330.TW" aria-label="股票代號" required>
            <input name="name" placeholder="名稱（可留空）" aria-label="公司名稱">
            <select name="category" aria-label="類別">${(D.watchlist?.categories || ['自訂']).map((c) => `<option${c === '自訂' ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
            <button class="btn btn-primary" type="submit">加入追蹤</button>
            <button class="btn btn-ghost" type="button" id="wlReset">還原預設清單</button>
          </form></div>
        ${demo ? '<div class="demo-flag">目前為示意行情，版面預覽用。部署到 GitHub 並按「更新資料」後，即替換為實際股價與財報。</div>' : ''}
        <div class="table-wrap"><table>
          <thead><tr><th>公司</th><th class="r">股價</th><th class="r">漲跌</th><th class="r">1 個月</th><th class="r">3 個月</th><th class="r">今年以來</th><th class="r">1 年</th><th class="r">本益比</th><th>近一年走勢</th><th></th></tr></thead>
          <tbody>${rows.join('')}</tbody></table></div>
        <p class="note">代號格式：美股直接輸入（NVDA）；台股上市加 .TW、上櫃加 .TWO；韓股加 .KS；歐股依交易所（例 SU.PA）。</p>
      </div>
      ${etfBlock(wl)}`;

    $('#wlForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const t = String(f.get('ticker') || '').trim().toUpperCase();
      if (!/^[A-Z0-9.\-^=]{1,15}$/.test(t)) { toast('代號格式不正確，例如 NVDA 或 2330.TW'); return; }
      const list = getWatchlist();
      if (list.some((x) => x.ticker === t)) { toast(`${t} 已在追蹤清單中`); return; }
      list.push({ ticker: t, name: String(f.get('name') || '').trim() || quoteOf(t)?.name || t, category: String(f.get('category') || '自訂') });
      saveWatchlist(list); renderSupply(); renderTicker();
      toast(quoteOf(t) ? `已加入 ${t}` : `已加入 ${t}，按「更新資料」取得行情與財報`);
    });
    $('#wlReset').addEventListener('click', () => { store.del('watchlist_v1'); renderSupply(); renderTicker(); toast('已還原預設追蹤清單'); });
    $$('[data-etf]', el).forEach((b) => b.addEventListener('click', () => {
      etfSel = b.dataset.etf; const y = window.scrollY; renderSupply(); window.scrollTo(0, y);
    }));
    $$('[data-etf-add]', el).forEach((b) => b.addEventListener('click', () => {
      const t = b.dataset.etfAdd; const list = getWatchlist();
      if (!list.some((x) => x.ticker === t)) list.push({ ticker: t, name: b.dataset.etfName || t, category: '自訂' });
      saveWatchlist(list); const y = window.scrollY; renderSupply(); renderTicker(); window.scrollTo(0, y);
      toast(quoteOf(t) ? `已加入 ${b.dataset.etfName}` : `已加入 ${b.dataset.etfName}，按「更新資料」取得行情與財報`);
    }));
    $$('[data-rm]', el).forEach((b) => b.addEventListener('click', () => {
      saveWatchlist(getWatchlist().filter((x) => x.ticker !== b.dataset.rm)); renderSupply(); renderTicker(); toast(`已移除 ${b.dataset.rm}`);
    }));
  }

  /* ---------- 財報視窗 ---------- */
  let finTicker = null;
  const FIN_ROWS = [
    ['營收', (q) => q.revenue, 'big'], ['毛利', (q) => q.gross_profit, 'big'], ['毛利率', (q) => (q.revenue && q.gross_profit != null ? q.gross_profit / q.revenue * 100 : null), 'pct'],
    ['營業利益', (q) => q.operating_income, 'big'], ['營業利益率', (q) => (q.revenue && q.operating_income != null ? q.operating_income / q.revenue * 100 : null), 'pct'],
    ['淨利', (q) => q.net_income, 'big'], ['EPS', (q) => q.eps, 'eps']
  ];
  const SRC = { sec: 'SEC EDGAR', finmind: 'FinMind（公開資訊觀測站）', yahoo: 'Yahoo Finance', demo: '示意資料' };
  function openFin(t) {
    const f = D.financials?.items?.[t];
    if (!f) { toast(`${t} 尚無財報資料，按「更新資料」後取得`); return; }
    finTicker = t;
    const qs = f.quarters.slice(-8); const cur = f.currency;
    $('#finTitle').textContent = `${f.name || t}（${t}）近八季財報`;
    $('#finSub').textContent = `幣別 ${cur}；資料來源 ${SRC[f.source] || f.source}${D.financials.updated ? `；更新於 ${D.financials.updated}` : ''}`;
    $('#finDemo').hidden = f.source !== 'demo';
    const yoy = qs.map((q, i) => { const idx = f.quarters.indexOf(q); const prev = f.quarters[idx - 4]; return prev && prev.revenue ? (q.revenue / prev.revenue - 1) * 100 : null; });
    const fmt = (v, k) => (v == null || isNaN(v) ? '—' : k === 'pct' ? `${v.toFixed(1)}%` : k === 'eps' ? Number(v).toFixed(2) : fmtBig(v, cur));
    $('#finTable').innerHTML = `<table><thead><tr><th>項目</th>${qs.map((q) => `<th class="r">${esc(q.period)}</th>`).join('')}</tr></thead><tbody>
      ${FIN_ROWS.map(([n, fn, k]) => `<tr><td class="nowrap">${n}</td>${qs.map((q) => `<td class="r"><span class="num">${fmt(fn(q), k)}</span></td>`).join('')}</tr>`).join('')}
      <tr><td class="nowrap">營收年增</td>${yoy.map((v) => `<td class="r">${v == null ? '—' : pct(v)}</td>`).join('')}</tr></tbody></table>`;
    const dlg = $('#dlgFin'); if (!dlg.open) dlg.showModal();
    const div = cur === 'TWD' ? 1e8 : cur === 'KRW' ? 1e12 : 1e9; const unit = cur === 'TWD' ? '億' : cur === 'KRW' ? '兆' : 'B';
    makeChart('finChart', {
      data: { labels: qs.map((q) => q.period), datasets: [
        { type: 'bar', label: `營收（${unit} ${cur}）`, data: qs.map((q) => (q.revenue != null ? +(q.revenue / div).toFixed(2) : null)), backgroundColor: css('--chart-1'), borderRadius: 2, yAxisID: 'y' },
        { type: 'line', label: 'EPS', data: qs.map((q) => q.eps), borderColor: css('--amber'), backgroundColor: css('--amber'), tension: .25, yAxisID: 'y1', pointRadius: 3.5, borderWidth: 2.5 }
      ] },
      options: { scales: { y: { beginAtZero: true, position: 'left' }, y1: { position: 'right', grid: { display: false } }, x: { grid: { display: false } } } }
    });
  }
  function downloadFinCsv() {
    const f = D.financials?.items?.[finTicker]; if (!f) return;
    const head = ['Period', 'PeriodEnd', 'Currency', 'Revenue', 'GrossProfit', 'OperatingIncome', 'NetIncome', 'EPS'];
    const lines = [head.join(',')].concat(f.quarters.slice(-8).map((q) => [q.period, q.end, f.currency, q.revenue, q.gross_profit, q.operating_income, q.net_income, q.eps].map((v) => (v == null ? '' : v)).join(',')));
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${finTicker.replace(/[^A-Z0-9]/gi, '_')}_8Q_financials.csv`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast('已下載 CSV');
  }

  /* ---------- 應用場域 ---------- */
  function renderApps() {
    const a = D.applications; const el = $('#page-apps');
    if (!a) { el.innerHTML = head('AI 應用場域', '資料尚未載入。'); return; }
    el.innerHTML = `
      ${head('AI 應用場域', a.intro, a.updated)}
      <div class="app-grid">${a.sectors.map((s) => `
        <article class="app">
          <div class="app-head"><h2>${esc(s.name)}</h2><span class="stage">${esc(s.stage)}</span></div>
          ${s.metrics.length ? `<div class="mgrid">${s.metrics.map((m) => `<div><div class="m-val">${esc(m.value)}</div><div class="m-label">${esc(m.label)}</div><div class="m-note">${esc(m.note)}</div></div>`).join('')}</div>` : ''}
          ${s.pending ? '<div class="pending-box">待補數據：目前缺乏可靠的量化指標，將隨公開資料出現後補上。</div>' : ''}
          ${s.trend ? `<div class="chart-box"><canvas id="app-${esc(s.id)}"></canvas></div>` : ''}
          <dl><dt>對算力需求的意涵</dt><dd>${esc(s.compute)}</dd><dt>觀察指標</dt><dd>${s.watch.map(esc).join('、')}</dd></dl>
        </article>`).join('')}</div>`;
    a.sectors.filter((s) => s.trend).forEach((s) => {
      makeChart(`app-${s.id}`, {
        type: 'bar',
        data: { labels: s.trend.labels, datasets: [{ label: `${s.trend.title}（${s.trend.unit}）`, data: s.trend.values, backgroundColor: s.trend.labels.map((l) => (/目標/.test(l) ? 'transparent' : css('--chart-1'))), borderColor: css('--amber'), borderWidth: s.trend.labels.map((l) => (/目標/.test(l) ? 2 : 0)), borderRadius: 2 }] },
        options: { plugins: { legend: { display: false }, title: { display: true, text: `${s.trend.title}（${s.trend.unit}）`, align: 'start', color: css('--ink'), font: { weight: '500', size: 13 } } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true } } }
      });
    });
  }

  /* ---------- 路由 ---------- */
  const RENDER = { home: renderHome, demand: renderDemand, aidc: renderAidc, products: renderProducts, supply: renderSupply, apps: renderApps };
  function current() { const h = location.hash.replace('#', ''); return PAGES.includes(h) ? h : 'home'; }
  function show(page = current()) {
    PAGES.forEach((p) => { $(`#page-${p}`).hidden = p !== page; });
    $$('.tabs a').forEach((a) => a.setAttribute('aria-current', a.dataset.tab === page ? 'page' : 'false'));
    destroyCharts();
    RENDER[page]();
  }
  function renderAll() {
    const dates = FILES.map((f) => D[f]?.updated).filter(Boolean).map((d) => String(d).slice(0, 10)).sort();
    $('#dataDate').textContent = `資料日期 ${dates[dates.length - 1] || '—'}`;
    renderTicker(); show();
  }

  /* ---------- 一鍵更新 ---------- */
  const getGH = () => store.get('gh_settings');
  function openSettings() {
    const gh = getGH() || {}; const f = $('#settingsForm');
    ['owner', 'repo', 'branch', 'token'].forEach((k) => { f.elements[k].value = gh[k] || (k === 'branch' ? 'main' : ''); });
    $('#dlgSettings').showModal();
  }
  function setBusy(on, text) {
    const b = $('#btnUpdate'); b.setAttribute('aria-busy', on ? 'true' : 'false'); b.disabled = on;
    b.querySelector('span').textContent = text || '更新資料';
  }
  async function runUpdate() {
    const gh = getGH();
    if (!gh || !gh.owner || !gh.repo || !gh.token) { toast('請先完成一鍵更新設定（GitHub repository 與 token）'); openSettings(); return; }
    const api = `https://api.github.com/repos/${gh.owner}/${gh.repo}`;
    const headers = { Authorization: `Bearer ${gh.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const startedAt = new Date(Date.now() - 15000).toISOString();
    try {
      setBusy(true, '送出中');
      const wl = getWatchlist().map((w) => ({ ticker: w.ticker, name: w.name, category: w.category }));
      const r = await fetch(`${api}/actions/workflows/update-data.yml/dispatches`, {
        method: 'POST', headers, body: JSON.stringify({ ref: gh.branch || 'main', inputs: { watchlist: JSON.stringify(wl), scope: 'all' } })
      });
      if (r.status === 401 || r.status === 403) throw new Error('token 權限不足，請確認已授權 Actions 讀寫');
      if (r.status === 404) throw new Error('找不到 repository 或 update-data.yml，請檢查設定');
      if (r.status !== 204) throw new Error(`GitHub 回應 ${r.status}`);
      let run = null;
      for (let i = 0; i < 100; i++) {
        await sleep(i < 3 ? 4000 : 8000);
        const rr = await fetch(`${api}/actions/workflows/update-data.yml/runs?event=workflow_dispatch&per_page=5`, { headers });
        const j = await rr.json();
        run = (j.workflow_runs || []).find((x) => x.created_at >= startedAt) || null;
        if (!run) { setBusy(true, '排隊中'); continue; }
        if (run.status === 'completed') break;
        setBusy(true, run.status === 'queued' ? '排隊中' : '更新中');
      }
      if (!run || run.status !== 'completed') throw new Error('更新逾時，請稍後到 GitHub Actions 查看執行狀態');
      if (run.conclusion !== 'success') throw new Error(`更新失敗（${run.conclusion}），請到 GitHub Actions 查看紀錄`);
      setBusy(true, '載入中');
      await loadAll(ghFetch(gh));
      renderAll();
      toast('資料已更新');
    } catch (err) {
      toast(err instanceof TypeError ? '無法連線到 GitHub。若是在預覽頁面，部署到 GitHub Pages 後即可使用' : (err.message || '更新失敗'));
    } finally { setBusy(false); }
  }

  /* ---------- Toast ---------- */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3800);
  }

  /* ---------- 啟動 ---------- */
  async function init() {
    applyTheme(); chartDefaults();
    await loadAll();
    renderAll();
    window.addEventListener('hashchange', () => { show(); window.scrollTo(0, 0); });
    document.addEventListener('click', (e) => { const b = e.target.closest('[data-fin]'); if (b) openFin(b.dataset.fin); });
    $('#btnUpdate').addEventListener('click', runUpdate);
    $('#btnSettings').addEventListener('click', openSettings);
    $('#btnTheme').addEventListener('click', () => { store.set('theme', isDark() ? 'light' : 'dark'); applyTheme(); chartDefaults(); show(); });
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (!store.get('theme')) { chartDefaults(); show(); } });
    $('#dlgSettings').addEventListener('close', () => {
      if ($('#dlgSettings').returnValue !== 'save') return;
      const f = $('#settingsForm');
      const gh = { owner: f.elements.owner.value.trim(), repo: f.elements.repo.value.trim(), branch: f.elements.branch.value.trim() || 'main', token: f.elements.token.value.trim() };
      toast(store.set('gh_settings', gh) ? '設定已儲存' : '此瀏覽器無法儲存設定');
    });
    $('#btnFinClose').addEventListener('click', () => $('#dlgFin').close());
    $('#dlgFin').addEventListener('close', () => destroyCharts('finChart'));
    $('#btnFinCsv').addEventListener('click', downloadFinCsv);
  }
  init();
})();
