"""Tar fram exempelfilerna och bilderna till hemsidan ur en riktig körning av Utlämnas
testkedja. Resultatet checkas in i src/, så att själva webbygget inte behöver produkten.

    python3 scripts/bygg-exempel.py [--repo ../utlamna]

Skapar:
  src/exempel/testakt-skannad.pdf          skannad, bara bilder: filen man matar appen med
  src/exempel/kontroll-godkand.pdf         plattad till bild: ska godkännas av kontrollverktyget
  src/exempel/kontroll-underkand-text.pdf  svarta rutor ovanpå text: ska underkännas
  src/exempel/kontroll-underkand-dolt.pdf  ren bild men med dolt innehåll: ska underkännas
  src/bilder/fore.png, efter.png           utdrag ur samma sida, före och efter snäppning

Varje exempel kontrolleras med den oberoende verifieraren. Avviker utfallet från det
som sidan lovar avbryts körningen, så att hemsidan aldrig lovar något exemplen inte håller.
"""
import argparse, importlib.util, io, os, re, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ap = argparse.ArgumentParser()
ap.add_argument("--repo", default=os.environ.get("UTLAMNA_REPO") or os.path.join(ROOT, "..", "utlamna"))
a = ap.parse_args()
E2E = os.path.abspath(os.path.join(a.repo, "tests", "e2e"))
if not os.path.isdir(E2E):
    sys.exit(f"Hittar inte Utlämnas testkedja i {E2E}. Ange --repo.")
sys.path.insert(0, E2E)

import numpy as np                                   # noqa: E402
import img2pdf                                       # noqa: E402
from PIL import Image, ImageDraw                     # noqa: E402
import inkbox                                        # noqa: E402
import prove_verifier                                # noqa: E402
from verify_export import locate, verify             # noqa: E402

OUT = os.path.join(E2E, "out")
SRC = os.path.join(ROOT, "src")
langs = subprocess.run(["tesseract", "--list-langs"], capture_output=True, text=True).stdout.split()
LANG = "swe" if "swe" in langs else "eng"
print(f"OCR-språk: {LANG}")

# --- 1. Den skannade testakten (offentlig, påhittad variant) --------------------------
os.environ["PUBLIK"] = "1"
spec = importlib.util.spec_from_file_location("make_scanned_akt", os.path.join(E2E, "make_scanned_akt.py"))
mk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mk)           # skriver publik-skannad-akt.pdf vid import
akt = os.path.join(OUT, "publik-skannad-akt.pdf")

alltext = "\n".join("\n".join(p) for p in mk.PUBLIK_PAGES)
FORBID = [
    *re.findall(r"\d{8}-\d{4}", alltext),
    "070-174 06 05",
    "sara.andersson@example.org",
    "Sara Andersson",
    "Liam Andersson",
    "Exempelgatan 14 B",
]
print("Maskas:", FORBID)

# --- 2. OCR. JPEG-data återanvänds, så filen blir liten ---------------------------------
with tempfile.TemporaryDirectory() as d:
    subprocess.run(["pdfimages", "-j", akt, os.path.join(d, "pg")], check=True)
    parts = []
    for f in sorted(x for x in os.listdir(d) if x.startswith("pg-")):
        base = os.path.join(d, f.rsplit(".", 1)[0])
        subprocess.run(["tesseract", os.path.join(d, f), base, "-l", LANG, "--dpi", "200", "pdf"], check=True, capture_output=True)
        parts.append(base + ".pdf")
    ocr = os.path.join(OUT, "publik-ocr.pdf")
    subprocess.run(["qpdf", "--empty", "--pages", *parts, "--", ocr], check=True)

located = locate(ocr, FORBID)
found = {s for v in located.values() for s, _ in v}
missing = [s for s in FORBID if s not in found]
if missing:
    sys.exit(f"OCR läste inte: {missing}. Exemplen skulle bli missvisande. Avbryter.")
boxes = {p: [b for _, b in v] for p, v in located.items()}


# --- 3. Sidbilder med målade rutor ----------------------------------------------------------
def rasters(dpi):
    with tempfile.TemporaryDirectory() as d:
        subprocess.run(["pdftoppm", "-r", str(dpi), "-gray", "-png", ocr, os.path.join(d, "p")], check=True)
        return [Image.open(os.path.join(d, f)).convert("L").copy() for f in sorted(os.listdir(d))]


def paint(dpi, snap):
    k = dpi / 72.0
    out = []
    for pno, im in enumerate(rasters(dpi), start=1):
        g = np.array(im)
        dr = ImageDraw.Draw(im)
        for x0, t, x1, b in boxes.get(pno, []):
            r = (x0 * k, t * k, x1 * k, b * k)
            dr.rectangle(inkbox.snap(g, r) if snap else r, fill=0)
        out.append(im)
    return out


def to_pdf(images, dst, q=70):
    jpgs = []
    for im in images:
        b = io.BytesIO()
        im.save(b, format="JPEG", quality=q, dpi=(200, 200))
        jpgs.append(b.getvalue())
    open(dst, "wb").write(img2pdf.convert(jpgs, layout_fun=img2pdf.get_fixed_dpi_layout_fun((200, 200))))


# --- 4. Exempelfilerna, kontrollerade innan de får användas --------------------------------------
tmp = tempfile.mkdtemp()
good = os.path.join(tmp, "godkand.pdf")
to_pdf(paint(200, True), good)
bad_text = os.path.join(tmp, "text.pdf")
prove_verifier.case_b_overlay(ocr, boxes, bad_text)
bad_hidden = os.path.join(tmp, "dolt.pdf")
prove_verifier.case_e_hidden(good, bad_hidden, secret="Sara Andersson och ett personnummer i en bilaga", title="Utredning Liam Andersson")

for path, want, kw in [
    (good, True, dict(ocr=True, ocr_lang=LANG, original=ocr)),
    (bad_text, False, {}),
    (bad_hidden, False, {}),
]:
    r = verify(path, FORBID, **kw)
    ok = r["godkand"] == want
    print("OK " if ok else "FEL", os.path.basename(path), "godkänd" if r["godkand"] else "underkänd", f"(väntat {'godkänd' if want else 'underkänd'})")
    if not ok:
        print(r["fel"])
        sys.exit("Ett exempel beter sig inte som sidan lovar. Avbryter.")

txt = subprocess.run(["pdftotext", akt, "-"], capture_output=True, text=True).stdout.strip()
if txt:
    sys.exit("Testakten har ett textlager, alltså är den ingen skanning. Avbryter.")

os.makedirs(os.path.join(SRC, "exempel"), exist_ok=True)
os.makedirs(os.path.join(SRC, "bilder"), exist_ok=True)
shutil.copy(akt, os.path.join(SRC, "exempel", "testakt-skannad.pdf"))
shutil.copy(good, os.path.join(SRC, "exempel", "kontroll-godkand.pdf"))
shutil.copy(bad_text, os.path.join(SRC, "exempel", "kontroll-underkand-text.pdf"))
shutil.copy(bad_hidden, os.path.join(SRC, "exempel", "kontroll-underkand-dolt.pdf"))
with open(os.path.join(SRC, "exempel", "OM-FILERNA.txt"), "w", encoding="utf-8") as f:
    f.write(
        "Exempelfiler till Utlämna och utlamna-kontroll\n\n"
        "Alla personer, nummer och adresser är påhittade.\n"
        "Personnumren har födelsedatum år 2031, så de kan inte tillhöra någon verklig person.\n\n"
        "testakt-skannad.pdf            En skannad akt, bara bilder. Mata Utlämna med den.\n"
        "kontroll-godkand.pdf           Maskad och plattad till bild. Kontrollverktyget ska godkänna den.\n"
        "kontroll-underkand-text.pdf    Svarta rutor ovanpå text. Kontrollverktyget ska underkänna den.\n"
        "kontroll-underkand-dolt.pdf    Ren bild, men med dolt innehåll. Kontrollverktyget ska underkänna den.\n"
    )

# Strängar som aldrig får finnas i startsidans källkod: de ligger under de svarta fälten.
# scripts/granska.mjs kontrollerar det.
with open(os.path.join(ROOT, "scripts", "maskade-strangar.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join([*FORBID, "Exempelgatan"]) + "\n")

# --- 5. Bilder: före och efter snäppning, samma utdrag ----------------------------------------------
dpi = 160
k = dpi / 72.0
b1 = boxes[1]
top = min(t for _, t, _, _ in b1) - 24
bot = max(b for _, _, _, b in b1) + 20
crop = (int(48 * k), int(top * k), int(548 * k), int(bot * k))
for name, snap in (("fore", False), ("efter", True)):
    im = paint(dpi, snap)[0].crop(crop)
    im.save(os.path.join(SRC, "bilder", f"{name}.png"), optimize=True)
    print(name, im.size)

for f in sorted(os.listdir(os.path.join(SRC, "exempel"))):
    print(f"{os.path.getsize(os.path.join(SRC, 'exempel', f)) / 1024:7.0f} kB  exempel/{f}")
for f in sorted(os.listdir(os.path.join(SRC, "bilder"))):
    print(f"{os.path.getsize(os.path.join(SRC, 'bilder', f)) / 1024:7.0f} kB  bilder/{f}")
