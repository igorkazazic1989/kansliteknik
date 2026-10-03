#!/usr/bin/env node
// Granskar dist/ mot det sidan lovar. Inga beroenden. Exit 1 om något brister.
//
//   node scripts/granska.mjs
//
// Löftena: inga kakor, inga skript, inga externa filer, inga formulär, ingen uppladdning,
// inget under de svarta fälten, läsbar kontrast, trasiga länkar finns inte, och serverns
// konfiguration sparar inga åtkomstloggar.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
if (!fs.existsSync(dist)) {
  console.error("Kör scripts/bygg.mjs först.");
  process.exit(2);
}

const fails = [];
const ok = (msg) => console.log(`OK   ${msg}`);
const fail = (msg) => {
  fails.push(msg);
  console.log(`FEL  ${msg}`);
};

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const files = walk(dist);
const htmlFiles = files.filter((f) => f.endsWith(".html"));
const cssFiles = files.filter((f) => f.endsWith(".css"));
const rel = (f) => path.relative(dist, f).replace(/\\/g, "/");

// 1. Inga skript, formulär, inbäddningar eller inline-stilar (CSP:n tillåter inga) ------------------------------------------------
const banned = [/<script/i, /<iframe/i, /<form/i, /<input/i, /<object/i, /<embed/i, /<video/i, /<audio/i, /<link[^>]+rel=["']?(?:preload|prefetch|preconnect|dns-prefetch)/i, /\son\w+=/i, /javascript:/i, /\sstyle=/i];
let bad = 0;
for (const f of htmlFiles) {
  const t = fs.readFileSync(f, "utf8");
  for (const re of banned) if (re.test(t)) { fail(`${rel(f)} innehåller ${re}`); bad++; }
}
if (!bad) ok(`${htmlFiles.length} sidor: inga skript, formulär, inbäddningar, händelseattribut eller inline-stilar`);

// 2. Inga externa adresser ------------------------------------------------------------
bad = 0;
for (const f of [...htmlFiles, ...cssFiles]) {
  const t = fs.readFileSync(f, "utf8");
  const urls = t.match(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s"')]*/gi) || [];
  for (const u of urls) { fail(`${rel(f)} pekar utanför sidan: ${u}`); bad++; }
  if (/@import|url\(\s*["']?(?!data:)/i.test(t) && f.endsWith(".css")) { fail(`${rel(f)} använder @import eller url()`); bad++; }
}
if (!bad) ok("inga externa adresser i HTML eller CSS, inga typsnitt eller bilder utifrån");

// 3. Länkar och ankare finns -----------------------------------------------------------
bad = 0;
for (const f of htmlFiles) {
  const t = fs.readFileSync(f, "utf8");
  const ids = new Set([...t.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of t.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
    const v = m[1];
    if (!v || v.startsWith("mailto:")) continue;
    if (v.startsWith("#")) { if (!ids.has(v.slice(1))) { fail(`${rel(f)}: ankaret ${v} finns inte`); bad++; } continue; }
    const [file, hash] = v.split("#");
    const target = path.join(path.dirname(f), file.split("?")[0]);
    if (!fs.existsSync(target)) { fail(`${rel(f)}: ${v} finns inte`); bad++; continue; }
    if (hash && target.endsWith(".html")) {
      const tt = fs.readFileSync(target, "utf8");
      if (!new RegExp(`\\sid="${hash}"`).test(tt)) { fail(`${rel(f)}: ${v} saknar ankare`); bad++; }
    }
  }
}
if (!bad) ok("alla länkar, bilder och ankare pekar på något som finns");

// 4. Sidstruktur, bilder, tillgänglighet -----------------------------------------------------
bad = 0;
for (const f of htmlFiles) {
  const t = fs.readFileSync(f, "utf8");
  const h1 = (t.match(/<h1[\s>]/g) || []).length;
  if (h1 !== 1) { fail(`${rel(f)} har ${h1} h1`); bad++; }
  if (!/<html lang="sv"/.test(t)) { fail(`${rel(f)} saknar lang="sv"`); bad++; }
  if (!/<title>[^<]{5,}<\/title>/.test(t)) { fail(`${rel(f)} saknar titel`); bad++; }
  if (!/name="viewport"/.test(t)) { fail(`${rel(f)} saknar viewport`); bad++; }
  if (!/<main id="innehall"/.test(t) || !/class="hoppa"/.test(t)) { fail(`${rel(f)} saknar main eller hoppa-länk`); bad++; }
  for (const img of t.match(/<img\b[^>]*>/g) || []) {
    if (!/\salt="[^"]{8,}"/.test(img)) { fail(`${rel(f)}: bild utan beskrivande alt: ${img.slice(0, 60)}`); bad++; }
    if (!/\swidth=/.test(img) || !/\sheight=/.test(img)) { fail(`${rel(f)}: bild utan width och height`); bad++; }
  }
  const prev = [...t.matchAll(/<h([1-6])[\s>]/g)].map((m) => +m[1]);
  for (let i = 1; i < prev.length; i++) if (prev[i] - prev[i - 1] > 1) { fail(`${rel(f)}: rubriknivå hoppar från h${prev[i - 1]} till h${prev[i]}`); bad++; }
}
if (!bad) ok("en h1 per sida, lang=sv, titel, viewport, bilder med alt och mått, rubriknivåer i ordning");

// 5. Kontrast (WCAG AA, 4.5:1 för text) ------------------------------------------------------
const lum = (hex) => {
  const c = hex.replace("#", "").match(/../g).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const css = fs.readFileSync(path.join(dist, "stil.css"), "utf8");
const tok = (n) => css.match(new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{6})`))[1];
const pairs = [
  ["svart text på papper", tok("svart"), tok("papper")],
  ["svart text på vit yta", tok("svart"), tok("yta")],
  ["blå länk på papper", tok("bla"), tok("papper")],
  ["blå länk på vit yta", tok("bla"), tok("yta")],
  ["blå länk på blå-mjuk", tok("bla"), tok("bla-mjuk")],
  ["vit text på blå", "#ffffff", tok("bla")],
  ["sidhuvudets länkar på blå", "#d6dfec", tok("bla")],
  ["dämpad text på papper", tok("dov"), tok("papper")],
  ["dämpad text på vit yta", tok("dov"), tok("yta")],
  ["felröd text på vit yta", tok("fel"), tok("yta")],
  ["felröd text på papper", tok("fel"), tok("papper")],
  ["svart text på gul markering", tok("svart"), tok("gul-fyll")],
];
bad = 0;
for (const [namn, a, b] of pairs) {
  const r = ratio(a, b);
  if (r < 4.5) { fail(`kontrast ${namn}: ${r.toFixed(2)}:1`); bad++; }
}
if (!bad) ok(`kontrast: alla ${pairs.length} textpar når 4.5:1 (lägsta ${Math.min(...pairs.map(([, a, b]) => ratio(a, b))).toFixed(1)}:1)`);

// 6. Inget under de svarta fälten -------------------------------------------------------------
const hemligt = fs.readFileSync(path.join(root, "scripts", "maskade-strangar.txt"), "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
const index = fs.readFileSync(path.join(dist, "index.html"), "utf8");
bad = 0;
for (const s of hemligt) if (index.includes(s)) { fail(`index.html innehåller "${s}", som ska finnas under ett svart fält`); bad++; }
const maskade = (index.match(/class="m(?:\s[^"]*)?"/g) || []).length;
const tomma = (index.match(/<span class="m(?:\s[^"]*)?"><\/span>/g) || []).length;
if (maskade !== tomma) { fail(`${maskade - tomma} svarta fält har innehåll`); bad++; }
if (!bad) ok(`${tomma} svarta fält i startsidan är tomma, och ingen av ${hemligt.length} maskade strängar finns i källkoden`);

// 7. Serverns konfiguration håller löftena --------------------------------------------------------
bad = 0;
const nginx = fs.readFileSync(path.join(root, "server", "nginx.conf"), "utf8");
const headers = fs.readFileSync(path.join(root, "server", "_headers"), "utf8");
if (!/^\s*access_log\s+off;/m.test(nginx)) { fail("nginx.conf saknar 'access_log off;': då sparas besökarnas IP-adresser"); bad++; }
for (const [namn, t] of [["nginx.conf", nginx], ["_headers", headers]]) {
  if (!/default-src 'none'/.test(t)) { fail(`${namn} saknar CSP med default-src 'none'`); bad++; }
  if (!/Referrer-Policy[: ]+"?no-referrer/.test(t)) { fail(`${namn} saknar Referrer-Policy: no-referrer`); bad++; }
  if (/Set-Cookie/i.test(t)) { fail(`${namn} sätter en kaka`); bad++; }
}
const vj = fs.existsSync(path.join(root, "vercel.json")) ? JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8")) : null;
if (vj) {
  const v = Object.fromEntries(vj.headers[0].headers.map((h) => [h.key, h.value]));
  const m = headers.match(/Content-Security-Policy:\s*(.+)/);
  if (!m || v["Content-Security-Policy"] !== m[1].trim()) { fail("vercel.json har en annan CSP än server/_headers"); bad++; }
  if (v["Referrer-Policy"] !== "no-referrer") { fail("vercel.json saknar Referrer-Policy: no-referrer"); bad++; }
  if (vj.outputDirectory !== "dist" || !/bygg\.mjs/.test(vj.buildCommand)) { fail("vercel.json bygger inte dist/ med bygg.mjs"); bad++; }
}
if (!bad) ok("serverkonfigurationen: strikt CSP, ingen referrer, inga kakor" + (vj ? ", vercel.json stämmer med _headers" : ""));

// 8. Vikt ---------------------------------------------------------------------------------------------
const heavy = files.filter((f) => !/\/(exempel|nedladdning)\//.test(f.replace(/\\/g, "/")));
const total = heavy.reduce((n, f) => n + fs.statSync(f).size, 0);
if (total > 1.5 * 1024 * 1024) fail(`sidorna väger ${(total / 1048576).toFixed(1)} MB (utan exempelfiler)`);
else ok(`sidorna väger ${Math.round(total / 1024)} kB tillsammans (utan exempelfiler)`);

console.log(fails.length ? `\n${fails.length} fel.` : "\nGranskningen godkänd.");
process.exit(fails.length ? 1 : 0);
