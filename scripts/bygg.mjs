#!/usr/bin/env node
// Bygger dist/ ur src/ och site.json. Inga beroenden.
//
//   node scripts/bygg.mjs              utvecklingsbygge, ofyllda fält syns i texten
//   node scripts/bygg.mjs --release    vägrar bygga om något är ofyllt eller om kontrollverktyget saknas
//
// Sidan får inte påstå något vi inte vet: hosting, företag och e-post fylls i av en människa,
// och nedladdningslänken finns bara om filen finns, med kontrollsumma uträknad av det här skriptet.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src");
const dist = path.join(root, "dist");
const release = process.argv.includes("--release");
const site = JSON.parse(fs.readFileSync(path.join(root, "site.json"), "utf8"));

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const isPlaceholder = (v) => typeof v === "string" && v.startsWith("EJ-IFYLLT");
const problems = [];

// --- ofyllda fält -------------------------------------------------------------------
// Utan företag krävs inte orgnr, momsnr och adress, men då får sidan inte sälja.
const required = site.bolag ? ["foretag", "orgnr", "momsnr", "adress", "epost", "hosting"] : ["varumarke", "agare", "epost", "hosting"];
const open = required.filter((k) => !site[k] || isPlaceholder(site[k]));
if (!site.host_loggar && /vercel|netlify|cloudflare|github|pages/i.test(String(site.hosting))) {
  problems.push('hosting ser ut som en molnvärd men "host_loggar" är false: sidan skulle påstå att inga loggar sparas. Sätt "host_loggar": true');
}
if (!site.bolag && !site.pilot) problems.push('"bolag" är false: utan företag kan sidan bara vara i pilotläge');
if (release && !site.pilot && !site.signerad) {
  problems.push('"pilot" är false men "signerad" är också false: sälj inte ett osignerat program');
}
if (open.length) {
  const msg = `Ofyllda fält i site.json: ${open.join(", ")}`;
  if (release) problems.push(msg);
  else console.warn(`VARNING  ${msg}`);
}

// --- kopiera src -> dist ------------------------------------------------------------
fs.rmSync(dist, { recursive: true, force: true });
function copy(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) copy(a, b);
    else if (e.name !== ".gitkeep") fs.copyFileSync(a, b);
  }
}
copy(src, dist);

// --- kontrollverktyget --------------------------------------------------------------
const exeName = "utlamna-kontroll.exe";
const exePath = path.join(dist, "nedladdning", exeName);
let download;
let kvKort = `Ett gratis kontrollprogram som mottagaren kan köra själv är under bygge. Det läser bara filen och skickar inget över nätet.`;
let kvMening = `Programmet som kontrollerar en utlämnad fil är gratis. Det är under bygge och publiceras här, med kontrollsumma, när det är provat. Ett dataskyddsombud eller en jurist behöver inte Utlämna för att kontrollera en fil.`;
let kvStatus = `<td class="nej">Under bygge. Publiceras med kontrollsumma när det är provat.</td>`;
if (fs.existsSync(exePath)) {
  kvKort = `Mottagaren kan kontrollera filen själv med ett gratis program som bara läser filen och inte skickar något över nätet.`;
  kvMening = `Programmet som kontrollerar en utlämnad fil är gratis och kan hämtas av vem som helst. Ett dataskyddsombud eller en jurist behöver inte Utlämna för att se om filen innehåller dold text, kommentarer, bilagor eller tidigare versioner, eller om den ändrats sedan utlämningen. Det fungerar på en PDF från vilket program som helst.`;
  kvStatus = `<td class="ok">Byggd och provad på Windows av vårt byggsystem, men ännu inte av en kund. <a href="kontrollera.html">Hämta den här.</a></td>`;
  const bytes = fs.readFileSync(exePath);
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  fs.writeFileSync(`${exePath}.sha256`, `${sha}  ${exeName}\n`);
  const kb = Math.round(bytes.length / 1024);
  const osignerad = site.signerad
    ? ""
    : `<p class="liten">Programmet är ännu inte signerat. Windows kan därför visa en varning om okänd utgivare. Kontrollera att kontrollsumman stämmer innan du kör filen.</p>`;
  download = `<div class="hamta" id="hamta">
  <h2>Hämta ${exeName}</h2>
  <p>För Windows. En enda fil, ingen installation.</p>
  <p><a class="knapp primar" href="nedladdning/${exeName}" download>Hämta ${exeName}</a></p>
  <dl><dt>Version</dt><dd>${esc(site.kv_version)}</dd><dt>Storlek</dt><dd>${kb} kB</dd><dt>SHA-256</dt><dd class="hash">${sha}</dd></dl>
  <p class="liten">Kontrollera kontrollsumman i PowerShell:</p>
  <pre>Get-FileHash .\\${exeName} -Algorithm SHA256</pre>
  ${osignerad}
</div>`;
} else {
  // I pilotläge säger sidan att programmet är under bygge, så det får saknas.
  // I säljläge är kontrollverktyget en del av erbjudandet och måste finnas.
  if (release && !site.pilot) problems.push(`src/nedladdning/${exeName} saknas (krävs när "pilot" är false)`);
  else console.warn(`VARNING  src/nedladdning/${exeName} saknas, sidan visar att programmet inte är publicerat`);
  download = `<div class="hamta" id="hamta">
  <h2>${exeName}</h2>
  <p>Programmet är under bygge och är inte publicerat än. Här står en länk och en kontrollsumma när det är byggt och provat.</p>
</div>`;
}

// --- mallar -------------------------------------------------------------------------
const mailto = (subject) => `mailto:${esc(site.epost)}?subject=${encodeURIComponent(subject)}`;
const mailtoBody = (subject, body) => `mailto:${esc(site.epost)}?subject=${encodeURIComponent(subject)}&amp;body=${encodeURIComponent(body)}`;
// Mejlet som öppnas när någon vill säga vilka planerade funktioner som skulle hjälpa mest. Inget formulär, inget skript.
const planeratBody = [
  "Hej,", "",
  "Det här skulle hjälpa oss mest (skriv numret, eller båda):", "", "",
  "1. Underlag när en handling lämnas ut delvis",
  "2. Säkerhetsunderlag för vår IT", "",
  "Det här saknar vi också:", "",
  "Organisation (valfritt):", "",
].join("\r\n");
const planeratCta = `<a class="knapp primar" href="${mailtoBody("Planerat Utlämna: det här skulle hjälpa oss", planeratBody)}">Svara med det ni behöver mest</a>`;
// Prissidan kan visas som information även innan företaget finns ("visa_priser").
// Då står priserna som planerade, och sidan säger att inget avtal ingås här.
// Ingen köpknapp, bara kontakt för mer information.
const pages = [
  ["index.html", "Start"],
  ["kontrollera.html", "Kontrollera en fil"],
  ["sakerhet.html", "Säkerhet"],
  ...(site.visa_priser ? [["priser.html", "Priser"]] : []),
  ["integritet.html", "Integritet"],
];
if (!site.visa_priser) fs.rmSync(path.join(dist, "priser.html"), { force: true });

const topp = (file) => `<header class="topp"><div class="rad">
<a class="varumarke" href="index.html">${esc(site.varumarke)}</a>
<nav aria-label="Huvudmeny">${pages
  .map(([f, t]) => `<a href="${f}"${f === file ? ' aria-current="page"' : ""}>${t}</a>`)
  .join("")}</nav>
</div></header>`;

const fot = () => `<footer class="fot"><div class="inne">
<div><h2>${esc(site.varumarke)}</h2><p>Utlämna: lokal maskning för utlämnande av allmän handling.</p><p>Inga kakor. Ingen spårning.</p></div>
<div><h2>Sidor</h2>${pages.map(([f, t]) => `<p><a href="${f}">${t}</a></p>`).join("")}</div>
<div><h2>Kontakt</h2>${
  site.bolag
    ? `<p>${esc(site.foretag)}</p><p>Org.nr ${esc(site.orgnr)}</p>${/^ej\b/i.test(site.momsnr) ? "" : `<p>Momsreg.nr ${esc(site.momsnr)}</p>`}<p>${esc(site.adress)}</p>`
    : `<p>${esc(site.varumarke)} drivs av ${esc(site.agare)}.</p>`
}<p><a href="mailto:${esc(site.epost)}">${esc(site.epost)}</a></p></div>
</div></footer>`;

const pilotband = site.pilot
  ? `<div class="pilotband"><p><strong>Pilot.</strong> Utlämna är i pilotfas. Vi söker kommuner och myndigheter som vill vara med och pröva det. <a href="${mailto("Pilot Utlämna")}">Skriv till oss.</a></p></div>`
  : "";

const cta = site.pilot
  ? `<a class="knapp primar" href="${mailto("Pilot Utlämna")}">Bli pilotkommun</a>`
  : `<a class="knapp primar" href="${mailto("Offert Utlämna")}">Begär offert</a>`;

const kontakt = site.pilot
  ? `<section class="band bla" id="kontakt"><div class="inne las">
<h2>Bli pilotkommun</h2>
<p>Vi söker en eller ett par kommuner eller myndigheter som vill pröva Utlämna på riktiga ärenden. Skriv till oss, så berättar vi hur en pilot går till.${site.visa_priser ? (site.bolag ? ' Ordinarie priser står på <a href="priser.html">prissidan</a>.' : ' Planerade priser står på <a href="priser.html">prissidan</a>.') : ""}</p>
<p>Berätta gärna vilken organisation ni är, hur många handläggare som skulle använda det, vilken sorts handlingar det gäller och hur program rullas ut hos er.</p>
<p><strong>Skicka inga handlingar.</strong></p>
<div class="knappar"><a class="knapp primar" href="${mailto("Pilot Utlämna")}">Skriv till ${esc(site.epost)}</a></div>
</div></section>`
  : `<section class="band bla" id="kontakt"><div class="inne las">
<h2>Begär offert</h2>
<p>Priserna står på <a href="priser.html">prissidan</a>. Skriv till oss för offert eller avtal. Berätta gärna hur många handläggare som skulle använda Utlämna och hur program rullas ut hos er.</p>
<p><strong>Skicka inga handlingar.</strong></p>
<div class="knappar"><a class="knapp primar" href="${mailto("Offert Utlämna")}">Skriv till ${esc(site.epost)}</a></div>
</div></section>`;

const flat = {
  loggtext: site.host_loggar
    ? `<p>Webbplatsens värd kan spara tekniska loggar, till exempel besökares IP-adresser, enligt sina egna villkor. Vi själva ser ingen besöksstatistik och sätter inga kakor. Se värdens villkor för hur länge loggarna sparas.</p>`
    : `<p>Servern sparar inga åtkomstloggar, och därmed inte besökarnas IP-adresser. Felloggar kan innehålla en IP-adress när något går sönder tekniskt. De rensas efter ${esc(site.logg_dagar)} dagar.</p>`,
  pris_rubrik: site.bolag ? "Licenser för kommuner" : "Planerade licenser för kommuner",
  pris_villkor: site.bolag
    ? `<p>Alla priser är exklusive moms. Licensen faktureras en gång per år, som e&#8209;faktura.</p>`
    : `<div class="ruta"><p><strong>Planerade priser efter pilotfasen.</strong> Priserna är information, inte ett erbjudande. Inget köp och inget avtal ingås via den här sidan. Avtal tecknas efter pilotfasen. Alla priser är exklusive moms.</p></div><p>Vill du veta mer, eller vara med som pilotkommun, <a href="mailto:${esc(site.epost)}?subject=${encodeURIComponent("Priser Utlämna")}">skriv till oss</a>.</p>`,
  ansvarig: site.bolag
    ? `${esc(site.foretag)}, organisationsnummer ${esc(site.orgnr)}, ${esc(site.adress)}`
    : `${esc(site.agare)}, som driver ${esc(site.varumarke)}. Kontakt sker via e-post`,
};
for (const [k, v] of Object.entries(site)) if (!k.startsWith("_") && typeof v !== "boolean" && !(k in flat)) flat[k] = esc(v);

for (const [file] of pages) {
  const p = path.join(dist, file);
  if (!fs.existsSync(p)) continue;
  let html = fs.readFileSync(p, "utf8");
  const sakerhetCta = `<a class="knapp primar" href="${mailto("Säkerhetsunderlag Utlämna")}">Be om säkerhetsunderlaget</a>`;
  const blocks = { sakerhet_cta: sakerhetCta, kv_mening: kvMening, kv_kort: kvKort, planerat_cta: planeratCta, kv_status: kvStatus, topp: topp(file), fot: fot(), pilotband, cta_primar: cta, kontakt_block: kontakt, nedladdning_block: download };
  // Block först (de innehåller själva {{epost}} m.fl. via esc, inga fler tokens), sedan fält.
  html = html.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in blocks ? blocks[k] : k in flat ? flat[k] : m));
  const left = html.match(/\{\{\w+\}\}/g);
  if (left) problems.push(`${file}: okänd token ${[...new Set(left)].join(", ")}`);
  fs.writeFileSync(p, html);
}

// --- sammanfattning -----------------------------------------------------------------
function size(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => {
    const f = path.join(dir, e.name);
    return n + (e.isDirectory() ? size(f) : fs.statSync(f).size);
  }, 0);
}
if (problems.length) {
  console.error("\nBygget stoppades:\n  - " + problems.join("\n  - "));
  process.exit(1);
}
const kb = (n) => Math.round(n / 1024);
console.log(`Byggt: dist/  (sidor ${kb(size(dist) - size(path.join(dist, "exempel")) - size(path.join(dist, "nedladdning")))} kB, exempelfiler ${kb(size(path.join(dist, "exempel")))} kB)`);
