"""Provar dist/ i en riktig webbläsare (Chromium), med samma säkerhetsrubriker som servern.

    python3 scripts/granska-webblasare.py [--bilder ut/]

Kontrollerar för varje sida, i bredd 1280 och 390 px:
  - alla anrop går till sidans egen adress, inga andra
  - inga kakor, ingen lagring i webbläsaren
  - inga CSP-överträdelser eller konsolfel (CSP:n är den strikta från server/_headers)
  - ingen horisontell rullning
  - alla bilder laddades med verklig storlek
Sparar skärmbilder om --bilder anges. Exit 1 om något brister.
"""
import argparse, http.server, os, re, socketserver, sys, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
ap = argparse.ArgumentParser()
ap.add_argument("--bilder")
a = ap.parse_args()

# Rubrikerna läses ur samma fil som den riktiga servern ska använda.
hdr = {}
cur = None
for line in open(os.path.join(ROOT, "server", "_headers"), encoding="utf-8"):
    if not line.strip() or line.lstrip().startswith("#"):
        continue
    if not line.startswith((" ", "\t")):
        cur = line.strip()
        hdr[cur] = {}
    else:
        k, v = line.strip().split(":", 1)
        hdr[cur][k] = v.strip()


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kw):
        super().__init__(*args, directory=DIST, **kw)

    def end_headers(self):
        for k, v in hdr.get("/*", {}).items():
            self.send_header(k, v)
        if self.path.startswith("/nedladdning/"):
            for k, v in hdr.get("/nedladdning/*", {}).items():
                self.send_header(k, v)
        super().end_headers()

    def log_message(self, *a):
        pass


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(("127.0.0.1", 0), H)
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
origin = f"http://127.0.0.1:{port}"

pages = sorted(f for f in os.listdir(DIST) if f.endswith(".html"))
fails = []
if a.bilder:
    os.makedirs(a.bilder, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    for width, label in ((1280, "bred"), (390, "smal")):
        ctx = browser.new_context(viewport={"width": width, "height": 900}, device_scale_factor=1)
        for name in pages:
            pg = ctx.new_page()
            requests, problems = [], []
            pg.on("request", lambda r: requests.append(r.url))
            pg.on("console", lambda m: problems.append(m.text) if m.type in ("error", "warning") else None)
            pg.on("pageerror", lambda e: problems.append(str(e)))
            pg.goto(f"{origin}/{name}", wait_until="networkidle")

            foreign = [u for u in requests if not u.startswith(origin)]
            if foreign:
                fails.append(f"{name} ({label}): anrop utanför sidan: {foreign}")
            if problems:
                fails.append(f"{name} ({label}): konsol/CSP: {problems}")
            if ctx.cookies():
                fails.append(f"{name} ({label}): kakor: {ctx.cookies()}")
            storage = pg.evaluate("localStorage.length + sessionStorage.length")
            if storage:
                fails.append(f"{name} ({label}): webbläsarlagring används")
            over = pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            if over > 0:
                fails.append(f"{name} ({label}): horisontell rullning, {over}px för bred")
            broken = pg.evaluate("[...document.images].filter(i => !i.complete || i.naturalWidth === 0).map(i => i.src)")
            if broken:
                fails.append(f"{name} ({label}): bilder som inte laddades: {broken}")
            if name == "index.html":
                # De svarta fälten ska ha synlig bredd. Utan det (t.ex. om CSP stoppar stilen) vore sidan tom.
                widths = pg.evaluate("[...document.querySelectorAll('.blad .m')].map(e => e.getBoundingClientRect().width)")
                if not widths or min(widths) < 8:
                    fails.append(f"index.html ({label}): de svarta fälten har ingen bredd: {widths}")
            print(f"{'OK ' if not any(name in f and label in f for f in fails) else 'FEL'} {name:18} {label} {width}px  anrop {len(requests)}")
            if a.bilder:
                pg.screenshot(path=os.path.join(a.bilder, f"{name[:-5]}-{label}.png"), full_page=True)
            pg.close()
        ctx.close()
    browser.close()

srv.shutdown()
if fails:
    print("\n" + "\n".join(f"FEL  {f}" for f in fails))
    sys.exit(1)
print("\nWebbläsargranskningen godkänd: inga externa anrop, inga kakor, inga CSP-överträdelser, ingen sidledsrullning.")
