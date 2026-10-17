# AI 趨勢研究追蹤

追蹤 AI 需求、AIDC 建置與投資、AIDC 產品規格、供應鏈股價與財報，以及 AI 應用場域的靜態網站。
純 HTML／CSS／JavaScript，資料放在 `data/*.json`，可直接部署在 GitHub Pages，之後也能原封不動搬到自架伺服器。

## 目錄結構

```
index.html                 網站主頁（六個分頁以上方選單切換）
assets/style.css           樣式（支援深淺色、手機版）
assets/app.js              前端程式：繪圖、追蹤清單、財報下載、一鍵更新
data/
  news.json                首頁頭條
  demand.json              AI 需求與發展
  aidc.json                AIDC 建置、資本支出、財報重點
  products.json            產品規格（每週自動檢查）
  applications.json        應用場域
  watchlist.json           預設追蹤清單
  market.json              行情（由 update_market.py 產生）
  financials.json          近八季財報（由 update_market.py 產生）
  csv/                     各公司近八季財報 CSV
scripts/
  update_market.py         行情＋財報（Yahoo Finance、SEC EDGAR、FinMind）
  update_news.py           新聞頭條（Google News RSS，可選 Claude 中文摘要）
  update_products.py       產品規格自動更新（Claude API＋網路搜尋）
.github/workflows/
  update-data.yml          一鍵更新（由網頁按鈕觸發，不排程）
  update-products.yml      產品規格每週一自動檢查
tools/
  build_preview.py         產生單檔預覽 dist/preview.html
  make_demo_data.py        產生示意行情（僅首版預覽用）
```

## 部署到 GitHub Pages

1. 建立新的 repository（例如 `ai-trends`），把本資料夾全部推上去。
2. Settings → Pages → Source 選 `Deploy from a branch`，Branch 選 `main`／`/ (root)`。
3. Settings → Actions → General → Workflow permissions 選 **Read and write permissions**。
4. Settings → Secrets and variables → Actions，新增：
   - `SEC_USER_AGENT`：例如 `AI Trends Tracker your@email.com`（SEC 要求提供聯絡資訊）
   - `FINMIND_TOKEN`：選填，到 finmindtrade.com 免費註冊可提高台股財報呼叫額度
   - `ANTHROPIC_API_KEY`：選填，用於產品規格自動更新與新聞中文摘要
5. Actions 分頁手動執行一次「一鍵更新資料」，把示意行情換成實際資料。

## 啟用網頁上的「更新資料」按鈕

1. GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token。
2. Repository access 只勾選這個 repository；Permissions 設定 **Actions: Read and write**、**Contents: Read**。
3. 打開網站，點右上角齒輪，填入帳號、repository 名稱、分支與 token 後儲存。
4. 之後按「更新資料」：網站會觸發 `update-data.yml`，並把你在網頁上增減後的追蹤清單一併送出；約 2–5 分鐘完成後自動重新載入。

token 只存在該瀏覽器的 localStorage，請勿在共用電腦上儲存。

## 追蹤清單代號格式

| 市場 | 格式 | 範例 |
| --- | --- | --- |
| 美股 | 直接輸入 | NVDA、MSFT |
| 台股上市 | 代號.TW | 2330.TW |
| 台股上櫃 | 代號.TWO | 3324.TWO |
| 韓股 | 代號.KS | 000660.KS |
| 歐股 | 依交易所 | SU.PA |

財報來源：美股走 SEC EDGAR（第四季以全年減前三季推得，EPS 為近似值）；台股走 FinMind；其他市場走 Yahoo Finance（部分市場僅提供約 5 季）。

## 本機預覽

```
python3 -m http.server 8000
# 瀏覽 http://localhost:8000
```

或執行 `python3 tools/build_preview.py` 產生不需伺服器的單檔 `dist/preview.html`。

## 之後搬到自架伺服器

網站本身不需改動，只要把 `update_market.py` 等腳本改用 cron 在伺服器上執行、輸出到同一個 `data/` 目錄即可；
「更新資料」按鈕可改為呼叫伺服器上的更新 API（`assets/app.js` 的 `runUpdate()`）。屆時也可加入地圖檢視與資料庫。

## 免責聲明

本站資料彙整自公開報導、公司財報與研究機構，僅供研究參考，不構成投資建議。
