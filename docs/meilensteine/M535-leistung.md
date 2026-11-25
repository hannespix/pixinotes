# M535 — Leistung: leichter Start, ruhende Flüssigkeit, Bilder und Tools halten an
PR: siehe Merge-Titel „… (M535)" · Prüfreihe: `pruefungen/m535-leistung.mjs` (Port 5535) · Datum: 2026-11-25

## Warum
Umsetzungsrunde nach dem Audit M518–M527, Paket „Leistung". Auslöser: die offenen Punkte aus M525 („Grenzen / offen")
und M518 („Für andere Bereiche") sowie die Entscheidungen des Besitzers vom 25.11.2026. Dazu kam vorab: Nach M527 hatte
das Start-JS nur noch rund 126 B Luft bis zur Grenze der Start-Reihen (m446 2 070 000 B, m459/m467/m483/m502
2 065 000 B), und mehrere Agenten mussten noch mergen.

## Punkt 0: Start-Paket entlastet (eigener PR, zuerst)
Gemessen mit einem Build samt Sourcemaps (Bytes je Quell-Modul im Start-Teil `index-*.js`) und der Liste der beim Start
geladenen Dateien (wie m502 A). Zwei Module lagen fast ganz unnötig im Start, weil ein kleiner Teil von ihnen beim Start
gebraucht wird und Rollup ein Modul nie zerteilt:

| Modul | im Start | beim Start gebraucht | gebraucht von (alle nachgeladen) |
|---|---|---|---|
| `lib/serialize.ts` | 28,0 KB | `nodeToText`, `blocksToText`, `nodesToText` (Suche, Karten, KI-Kontext) | HTML/Markdown/WhatsApp: Präsentation, Teilen-Dialog, Teilen-Karten, Export |
| `lib/htmlStore.ts` | 15,8 KB | Ablage in IndexedDB (Aufräumen beim Start, Abgleich) | Speicher-Shim der Tools: nur die Tool-Karte |

Die beiden selten gebrauchten Teile stehen jetzt in eigenen Dateien: `lib/serializeFormate.ts` (`blocksToHtml`,
`blocksToMarkdown`, `nodeToHtml`, `nodeToMarkdown`, `blocksToWhatsapp`, `nodeToWhatsapp`, `nodesToWhatsapp`,
`nodesToHtml`, `sicherKuerzen`) und `lib/htmlShim.ts` (`storageShim`, `composeSrcdoc`). `serialize.ts` exportiert
dafür seine Helfer (`AnyBlock`, `inlineText`, `esc`, `sheetZeilen`, `kontaktZeilen`).

| | vorher | nachher |
|---|---|---|
| Start-JS (5 Dateien, wie m502 A) | 2 064 874 B | 2 028 073 B |
| davon `index-*.js` (eigener Code) | 714 564 B | 677 763 B |
| Luft bis zur Grenze 2 065 000 B | 126 B | 36 927 B |

Kein Verhalten ändert sich: Präsentation und Teilen-Dialog werden schon im Leerlauf nach dem Start vorgeladen (App.tsx
`LADER`), die Tool-Karte mit `kartenVorladen()` — die neuen Teile reisen mit ihnen und liegen damit auch offline im
Service Worker. Die portable Datei bekommt ohnehin alles.

**Regel für später:** Ein Modul, das beim Start gebraucht wird, nimmt alles mit, was in ihm steht. Große, selten
gebrauchte Teile (Ausgabeformate, Rahmen-Quelltexte, lange Tabellen) in eine eigene Datei legen, die nur von
nachgeladenen Teilen eingebunden wird. Messen: `npx vite build --sourcemap --outDir <scratch>` und die Bytes je
`source` der Sourcemap des `index-*.js` zählen.
