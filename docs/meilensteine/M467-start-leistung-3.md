# M467 — Start-Leistung Teil 3: Node-Ersatz nur für den Outlook-Leser
PR: (siehe Merge) · Prüfreihe: `pruefungen/m467-start-leistung-3.mjs` (Port 5467) · Datum: 2026-11-23

## Warum
M459 ließ offen (siehe dort „Grenzen / offen"): `vite-plugin-node-polyfills` setzt den Buffer-Ersatz ins Editor-
Paket des Starts, obwohl ihn nur der .msg-Import (@kenjiuno/msgreader → iconv-lite) braucht.

Die Auswertung der Bundle-Module (`generateBundle`, je Paket die Module samt Importeuren) zeigte genauer: Das Plugin
schaltet standardmäßig **globale** Namen `Buffer`, `process` und `global` ein und setzt per `@rollup/plugin-inject`
in **jede** Datei, die einen dieser Namen frei erwähnt, einen Import des Ersatzes. Im Start betraf das lib0 (yjs-
Hilfen), yjs, @mantine/core, html-to-image, jszip und pdf.js — alle prüfen `typeof Buffer`/`typeof process` oder
lesen `process` in try/catch und nehmen im Browser ohnehin den Browser-Weg (lib0 `isNode` braucht `process.release`,
das der Ersatz nicht hat; pdf.js braucht `"[object process]"`; Mantine vergleicht nur mit `"test"`). Rollup legte
den Ersatz ins Editor-Paket, das der Start lädt (Buffer ~67 KB, process ~4 KB Quelltext). Der .msg-Leser hatte
ohnehin eine **eigene** CommonJS-Kopie des Buffer-Ersatzes in seinem Nachlade-Paket.

## Was
Kein sichtbarer Verhaltenswechsel. .msg und .eml werden wie vorher zu E-Mail-Karten samt Anhängen, in der Web-
Version und in der portablen Datei (file://).

Gemessen mit `dist/`, Board mit einer Notiz, Chromium kalt (wie M446/M459), Stand nach Einmischen von M463:

| | vorher | nachher |
|---|---|---|
| Start-JS (über die Leitung) | 2 198 693 B (2,10 MiB), 4 Dateien | 2 168 523 B (2,07 MiB), 4 Dateien — −30 170 B; nach Einmischen von M466: 2 170 290 B |
| Paket `editor` | 989 876 B (gzip 299,8 KB) | 959 887 B (gzip 290,6 KB) |
| Buffer-/process-Ersatz im Start | ja (im Editor-Paket) | nein — nur im MSG-Paket |
| globales `Buffer`/`process` im Browser | nein | nein |

## Wie (Architektur)
- **`vite.config.ts`:** `nodePolyfills({ include: ['buffer','stream','util'], globals: { Buffer: false, global:
  false, process: false }, overrides: { buffer: 'vite-plugin-node-polyfills/shims/buffer' } })` — das Plugin liefert
  nur noch den Modul-Ersatz für `require('buffer' | 'stream' | 'util')` (die Override hält für `require('buffer')`
  denselben Ersatz wie vorher statt des rohen buffer-Pakets).
- **`processNurMsg()`** (eigenes Plugin in `vite.config.ts`, `@rollup/plugin-inject` jetzt als direkte
  devDependency, Version wie bisher transitiv 5.0.5): `process` als freier Name nur in den Node-Modulen des
  Outlook-Lesers (`@kenjiuno/*`, iconv-lite, safer-buffer, safe-buffer, string_decoder, stream-browserify,
  readable-stream, util, events, inherits). Freier `Buffer` kommt dort nicht vor (alle holen ihn über
  `require('buffer')`), `global` nur in yjs (mit typeof-Prüfung). Gegenprobe ohne `processNurMsg`: der .msg-Import
  lief trotzdem (die Stream-Teile von iconv-lite werden beim Lesen nicht berührt) — die Injektion bleibt als
  Absicherung (rund 4 KB im MSG-Paket), weil readable-stream/util `process.nextTick`/`process.env` ungeprüft lesen.
- **Fixture:** `pruefungen/daten/m467-msg.mjs` baut eine .msg mit dem CFB-Schreiber von msgreader (`lib/Burner.js`):
  Betreff, Absender und Text als ANSI-Zeichenketten (Typ 001E, windows-1252 mit Umlauten — der Weg über iconv-lite),
  Adresse als Unicode, ein Anhang `bericht.txt`. Keine eingecheckte Binärdatei.
- **Grenzen:** m446, m459 und m467 messen gegen `START_JS_GRENZE` 2 190 000 B (knapp über 2 168 523 B; kommt der
  Ersatz zurück, schlägt A1 an, m467 zusätzlich A2/A3).

## Prüfreihe
`m467`: A Start-JS unter der Grenze, kein Buffer-/process-Ersatz in den Start-Dateien, kein globales Buffer/process/
global; B .msg ablegen → Karte mit Betreff, Absender, Text, Anhang samt Inhalt, Ersatz erst danach geladen; C .eml mit
Anhang; D neue Notiz tippen (Editor mit lib0/yjs ohne Ersatz); E Single-File per file://: .msg mit Anhang, keine
Fehler beim Start (für E vorher `npm run build:single`).

## Grenzen / offen
- Weitere große Start-Teile laut Modul-Auswertung sind Kernbestand: BlockNote/ProseMirror/yjs (~2,2 MB Quelltext im
  Editor-Paket), `store.ts`, `Board.tsx`. Kein schneller Gewinn ohne Verhaltensänderung — M462 (BlockNote-Update)
  ändert das Editor-Paket ohnehin; danach neu messen.
- jszip (in docx-preview) sah wegen des globalen Buffer-Ersatzes bisher „Node" (`support.nodebuffer`); jetzt nimmt es
  den reinen Browser-Weg (Uint8Array/ArrayBuffer), für den es gebaut ist. Word-Vorschau bleibt gleich (m-Reihen zu
  docx unverändert grün über `--geaendert`).
