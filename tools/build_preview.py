"""把 index.html、CSS、JS 與 data/*.json 內嵌成單一 HTML（dist/preview.html），供離線預覽或分享。"""
import json, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
html = (ROOT / "index.html").read_text(encoding="utf-8")
css = (ROOT / "assets/style.css").read_text(encoding="utf-8")
js = (ROOT / "assets/app.js").read_text(encoding="utf-8")
names = ["news", "demand", "aidc", "products", "applications", "market", "financials", "watchlist"]
data = {n: json.loads((ROOT / f"data/{n}.json").read_text(encoding="utf-8")) for n in names}
blob = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
html = html.replace('<link rel="stylesheet" href="assets/style.css">', "")
html = html.replace("<!--INLINE_CSS-->", f"<style>\n{css}\n</style>")
html = html.replace('<script src="assets/app.js"></script>', "")
html = html.replace("<!--INLINE_DATA-->", f"<script>window.__INLINE__ = {blob};</script>")
html = html.replace("<!--INLINE_JS-->", f"<script>\n{js}\n</script>")
out = ROOT / "dist"; out.mkdir(exist_ok=True)
(out / "preview.html").write_text(html, encoding="utf-8")
print("dist/preview.html", len(html) // 1024, "KB")
