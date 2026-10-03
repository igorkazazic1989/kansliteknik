# Utlämnas webbplats

Statisk webbplats, skild från produkten. Den säljer och förklarar Utlämna, och delar ut
kontrollverktyget och exempelfilerna. Den tar aldrig emot något.

Inga kakor, inga skript, inga externa typsnitt eller tjänster, inga formulär. Kontakt sker
med e-post. Sidan ska klara samma granskning som produkten.

## Bygga och granska

```
node scripts/bygg.mjs                       # utvecklingsbygge till dist/
node scripts/granska.mjs                    # statisk granskning av dist/
python3 scripts/granska-webblasare.py       # Chromium med serverns säkerhetsrubriker
node scripts/bygg.mjs --release             # vägrar om något är ofyllt eller programmet saknas
```

`granska.mjs` underkänner sidan om den har skript, formulär, inline-stilar eller externa
adresser, om en länk är trasig, om en bild saknar beskrivning, om kontrasten är under 4.5:1,
om en maskad sträng finns under ett svart fält i startsidan, eller om serverkonfigurationen
sparar åtkomstloggar.

`granska-webblasare.py` öppnar varje sida i 1280 och 390 px bredd och underkänner externa
anrop, kakor, webbläsarlagring, CSP-överträdelser, sidledsrullning och bilder som inte laddas.

## Utan företag (nu)

`"bolag": false` i `site.json`. Sidan heter Kansliteknik, drivs av Igor Kazazic och söker
pilotkommuner. Sidan kan inte slås om till säljläge: utan
F-skatt går det inte att fakturera. Ingen postadress visas, kontakt sker via e-post.

Priserna kan ändå visas som information (`"visa_priser": true`). Då står de som planerade
priser efter pilotfasen, med en mening om att inget köp eller avtal ingås via sidan. Det
finns ingen köpknapp, bara kontakt för mer information.

När företaget finns: sätt `"bolag": true`, fyll i `foretag`, `orgnr`, `momsnr` och `adress`.
Då kommer prissidan tillbaka och kontaktuppgifterna byts.

## Två lägen

- **Pilotläge** (`"pilot": true`): sidan söker pilotkommuner, visar listpriser och säger att
  kontrollverktyget är under bygge. Kan lanseras när `site.json` är ifylld.
- **Säljläge** (`"pilot": false`): `--release` kräver dessutom att `utlamna-kontroll.exe` finns
  och att `"signerad"` är true. Slå om först när CI är grön och en låst dator har provats.

## Innan lansering

1. Fyll i `site.json`: företag, organisationsnummer, momsregistreringsnummer, adress, e-post och **hosting**. Sidan
   påstår var den ligger, så det fältet måste vara sant. `--release` vägrar så länge något
   börjar med `EJ-IFYLLT`.
2. *(Säljläge)* Bygg `utlamna-kontroll.exe` i produktens repo (CI-jobbet `windows-paket`), kontrollera den,
   och lägg den i `src/nedladdning/`. Bygget räknar fram kontrollsumman och visar den på sidan.
   Sätt `"signerad": true` när filen är kodsignerad, så försvinner varningen om okänd utgivare.
3. Bekräfta villkoren på prissidan: att invånartalet räknas enligt SCB vid tecknandet, att
   kommunala bolag inte ingår, och att pilotkommuner får särskilda villkor första året.
4. Uppdatera tabellen "Läget idag" i `src/sakerhet.html` när CI är grön och piloten har provat
   installationen. Sidan ska inte lova mer än som är provat.
5. Sätt `"pilot": false` när ni säljer på riktigt. Då byts pilotbandet mot "Begär offert".
6. Kör båda granskningarna och `--release`.

## Hosting

Välj en värd med servrar i EU, och kontrollera vem som äger bolaget, var loggar hamnar och om
värden själv samlar in besöksstatistik. Det är det som avgör vad löftet är värt.

- **Egen server:** `server/nginx.conf`. Inga åtkomstloggar, strikt CSP, bara GET och HEAD.
  Inte provkörd här: kör `nginx -t` och granska. Rotera felloggen så att den sparas högst så
  många dagar som `logg_dagar` i `site.json` (står på integritetssidan), till exempel:

  ```
  /var/log/nginx/utlamna-error.log { daily  rotate 7  missingok  notifempty  compress }
  ```
- **Statisk värd:** `server/_headers` för värdar som läser en sådan fil.

## Exempelfiler och bilder

`scripts/bygg-exempel.py` tar fram dem ur en riktig körning av Utlämnas testkedja och
kontrollerar varje fil med den oberoende verifieraren innan den används. Avviker ett resultat
från det sidan lovar avbryts körningen. Kräver produktens repo bredvid (`--repo ../utlamna`),
poppler, qpdf och tesseract.

Alla personer och nummer är påhittade. Personnumren har födelsedatum år 2031, så de kan inte
tillhöra någon verklig person. Telefonnumret, organisationsnumret och kontonumret är också
påhittade, men inte kontrollerade mot verkliga register: byt dem om ni vill vara helt säkra.

## Det som medvetet saknas

- **Ingen kontroll i webbläsaren.** Den skulle kunna köras lokalt i sidan, men den skulle få
  folk att tro att man laddar upp handlingar. Kontrollen är ett nedladdat program.
- **Inget kontaktformulär.** E-post räcker, och då finns det inget att ta emot filer med.
## Priser

Står i `src/priser.html`: 39 000 kr per år upp till 25 000 invånare, 79 000 kr per år för
25 000–100 000 invånare, offert över 100 000 och för regioner och myndigheter. Ändra där.
