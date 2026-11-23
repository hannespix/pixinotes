# M458 — Browser-Erweiterung „An PixiNotes senden"
PR: siehe Merge-Titel „… (M458)" · Prüfreihe: `pruefungen/m458-erweiterung.mjs` (Ports 5458, 6458, Debug 7458) · Datum: 2026-11-23

## Warum
Roadmap Phase 4 in `docs/KONZEPT.md` („Browser-Extension", Capture) und Idee aus `docs/BACKLOG.md`. Wer im Browser
recherchiert, soll Fundstücke ohne Kopieren und Umschalten als Karte auf ein Board bringen — ohne dass PixiNotes
dafür einen Server bräuchte (local-first).

## Was
- Erweiterung für Chrome/Edge (Manifest V3, Ordner `erweiterung/`), zweisprachig über `_locales/de|en`.
- Rechtsklick: **Auswahl**, **Seite** (Titel, Adresse, Auszug aus `meta description` oder dem ersten längeren
  Absatz), **Link**, **Bild**, **sichtbaren Bereich als Bild** an PixiNotes senden. Der Werkzeugleisten-Knopf sendet
  die Seite (mit markiertem Text, falls vorhanden); Rechtsklick auf den Knopf bietet das Bildschirmfoto.
- PixiNotes zeigt den bekannten Empfangs-Dialog vom Android-Teilen (M290) mit Titel „Aus dem Browser gesendet":
  Board wählen, als Karten oder in eine Notiz. Option der Erweiterung „Ohne Rückfrage auf das geöffnete Board
  legen" → Karte sofort, kurze Meldung.
- Seiten werden eine Notiz mit echtem Verweis (BlockNote-`link`), Bilder eine Bild-Karte (ohne Notiz daneben).
- Optionen: Adresse von PixiNotes (Vorgabe `https://hannespix.github.io/pixinotes/`), „ohne Rückfrage".
- Download: `pixinotes-erweiterung.zip` neben der App auf GitHub Pages; Installation über „Entpackt laden"
  (Hilfe → Teilen & Export). Kein Store.

## Wie (Architektur)
- **Übergabe ohne Server** (`erweiterung/hintergrund.js`, `zuPixiNotes`): Tab mit der eingestellten Adresse suchen
  (`chrome.tabs.query({})` + Präfix — Adressen sieht die Erweiterung nur dank Host-Berechtigung, kein `tabs`),
  nach vorn holen oder neu öffnen, `geladen()` abwarten, dann `chrome.scripting.executeScript(uebergeben)`: das
  Skript wartet in der eigenen Welt auf `document.documentElement.dataset.pixinotesEingang === 'bereit'` und
  schickt `window.postMessage({ typ: 'pixinotes-erweiterung', id, sendung }, location.origin)`; die App quittiert
  mit `pixinotes-erweiterung-ok` (`angenommen`). Misserfolg → rotes „!" am Knopf mit Grund im Titel (`fehler`).
- **Rückfallweg Fragment:** Ohne Berechtigung für die Adresse (eigene Adresse, Zustimmung verweigert) öffnet die
  Erweiterung `…#pixinotes-senden=<base64url(JSON)>` in einem neuen Tab — nur Text/Links (Text auf 6 000 Zeichen
  gekürzt), Bilder werden abgelehnt.
- **Sendung** `{ v: 1, art: auswahl|seite|link|bild|bildschirm, titel, text, adresse, bild?: { daten, name }, direkt }`.
- **Ein Eingang in der App:** `src/lib/erweiterung.ts` — `erweiterungEingang(annehmen)` (message + hashchange,
  setzt die Bereit-Marke), `sendungPruefen(roh, mitBild)`, `fragmentAbholen()`. Geprüft wird: `e.source === window`
  und `e.origin === location.origin` (Rahmen von HTML-App-Karten und fremde Herkunft fallen weg), Fassung `v: 1`,
  bekannte Art. Gesäubert über neue Helfer in `src/lib/sicher.ts`: `textVonAussen` (Steuer- und
  Richtungszeichen weg, Länge), `webAdresseVonAussen` (nur http/https), `rasterBildVonAussen` (nur
  data:image/png|jpeg|gif|webp, kein SVG, ≤ 25 MB). `direkt` gilt nur über postMessage, nie aus einem Link.
- **Empfang:** `GeteiltDialog.tsx` abonniert den Eingang; neue Modul-Funktionen `platzAuf`, `textBloecke`
  (Adresse als Verweis — gilt jetzt auch fürs Android-Teilen), `aufsBoardLegen` (Dialog und „ohne Rückfrage").
  `Geteiltes.herkunft = 'erweiterung'` (`lib/geteilt.ts`) steuert den Dialog-Titel.
- **Bild holen:** zuerst in der Ausgangsseite (`bildHolen`, Rechte der Seite), sonst im Hintergrund; gelingt
  beides nicht, kommt die Bildadresse als Link-Notiz. Bildschirmfoto: `chrome.tabs.captureVisibleTab` (PNG) — braucht
  die `activeTab`-Erlaubnis aus dem Klick.
- **Berechtigungen:** `activeTab`, `contextMenus`, `scripting`, `storage`; Host nur `hannespix.github.io/pixinotes`,
  `localhost`, `127.0.0.1` (selbst betrieben/Entwicklung); `optional_host_permissions` für eine eigene Adresse,
  die die Optionen genau für deren Herkunft anfragen. Firefox: `background.scripts` + `browser_specific_settings`
  stehen im Manifest (Chrome ignoriert sie), ungeprüft.
- **Paket:** `npm run build:erweiterung` → `werkzeug/erweiterung-packen.mjs` (eigener ZIP-Schreiber, Deflate über
  zlib, festes Datum) → `release/pixinotes-erweiterung.zip` (in `.gitignore`); `pages.yml` legt es nach `dist/`.
  Zeichen: `node werkzeug/app-zeichen.mjs erweiterung/icons erweiterung`.
- **Prüfreihe:** Chromium mit `--load-extension` (headless). Menüs lassen sich nicht anklicken; die Reihe ruft
  `globalThis.pixinotesSenden.*` im Hintergrund auf. Der Werkzeugleisten-Knopf wird echt ausgelöst über das
  Browser-Protokoll `Extensions.triggerAction` (`--remote-debugging-port`, `--enable-unsafe-extension-debugging`,
  Ziel vom Typ `tab`) — das erteilt `activeTab`, ohne das `captureVisibleTab` nicht darf. Adresse ohne Berechtigung:
  `--host-resolver-rules=MAP pixinotes.test 127.0.0.1`.

## Grenzen / offen
- Kein Store-Eintrag (bewusst nicht Teil der Aufgabe); „Entpackt laden" verlangt den Entwicklermodus.
- Die portable Datei (`file://`) erreicht die Erweiterung nicht (Dateizugriff müsste man je Erweiterung erlauben).
- Firefox-Angaben sind enthalten, aber nicht geprüft.
- Nur das oberste Dokument liefert den Auszug; Auswahl in Rahmen kommt über das Kontextmenü (`selectionText`).
