# M453 — Karten wissen, wann sie zuletzt geändert wurden
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m453-karten-zeit.mjs` (Port 5453) · Datum: 2026-11-23

## Warum
Karten hatten kein Änderungsdatum. Das Board-Briefing (M444, „Grenzen / offen") konnte darum weder „verwaiste
Karten" noch „unbeantwortete E-Mails" nennen, und die Suche kannte nur Relevanz. Für den Büroalltag ist „was habe
ich zuletzt angefasst" und „was liegt seit Wochen herum" oft die eigentliche Frage.

## Was
- Jede Karte trägt **`angelegt`** und **`geaendert`** (Millisekunden, wie `Date.now()`), gesetzt beim Anlegen
  bzw. bei jeder **inhaltlichen** Änderung. Verschieben, Größe, Drehung, Schrift, Farbe und Ansicht (Monat, Zoom,
  Filter, Sortierung …) stempeln nicht.
- **Fokus:** leise in der Unterzeile unter dem Titel „Geändert vor 3 Tagen" (de-DE, relativ), genaue Zeit im
  Tooltip; ohne Zeitpunkt „Änderung unbekannt".
- **Suche (Strg+K):** Alter am Treffer; Knopf **„Zuletzt geändert zuerst"** ordnet die Treffer neu (Unbekanntes
  ans Ende, Relevanz als zweite Ordnung) und listet ohne Suchwort die 15 zuletzt geänderten Karten aller Boards.
- **Board-Briefing:** neuer Abschnitt **„Lange unberührt"** (nur wenn es etwas gibt, auch mit KI lokal angehängt):
  Karten, deren Inhalt seit über 30 Tagen nicht geändert wurde, und E-Mail-Karten seit über 7 Tagen **ohne
  Folgeaktivität** (keine eigene Bearbeitung, keine danach geänderte verbundene Karte, kein Ticket mit Verweis,
  kein neuerer Kommentar). Je höchstens sechs, älteste zuerst.
- **Alte Boards:** kein erfundenes Datum — „unbekannt", bis die Karte das nächste Mal geändert wird. Sie fehlen im
  Briefing und stehen in der Suche ohne Alter am Ende.

## Wie (Architektur)
- `src/lib/kartenZeit.ts`: `inhaltGeaendert` (Patch gegen alte `data`, wertgleich zählt nicht, Ansichtsfelder in
  `ANSICHT`), `nachPatch`, `frisch` (Anlage/Kopie), `zeitVon`, `zeitSaeubern`, `spaetere`, `vorWann`
  (`Intl.RelativeTimeFormat`, de-DE/en), `tageSeit`, `zeitLang`.
- `src/types.ts`: `angelegt?`/`geaendert?` auf Node-Ebene von `AppNode` (wie `archived`), nicht in `data` — so
  bleiben Karten-Komponenten und `data`-Vergleiche unberührt.
- `src/store.ts` (klein gebündelt): `zeitNachPatch` in `updateNodeData` und `updateNodeDataOnBoard`
  (nicht in `runDerived` — Automatik ist keine Änderung von Hand); `frisch` in `addNode`, `addNodeToBoard`,
  `dupliziere`. Strg+Z stellt den Zeitpunkt mit zurück, weil der Verlauf die ganze Karte sichert.
- **Sync:** gestempelt wird nur, wo auf diesem Gerät von Hand geändert wird; `importSync`, Live-Patches
  (`gastPatch`/`kontoSync`, M383) und der Drei-Wege-Abgleich übernehmen Karten unverändert. `syncMerge.ts`:
  `ohnePunkte` lässt `geaendert` aus dem Vergleich, inhaltsgleiche Fassungen mit verschiedenem Zeitpunkt sind
  **kein Konflikt** — es gilt die spätere (`spaetere`, auf beiden Geräten gleich). Echte Konflikte bleiben wie
  bisher (hiesige Fassung, unverändert samt Zeitpunkt).
- **Eingang von außen:** `karteEntschaerfen` (lib/sicher.ts) ruft `zeitSaeubern` — nur endliche Zahlen ab 2020
  und höchstens einen Tag in der Zukunft (Uhren gehen nie gleich), sonst fällt der Wert weg („unbekannt").
- `SearchOverlay.tsx`: `nachZeit`, `Hit.zeit`, `.search-sortierung`, `.hit-alter` (CSS beim Suchblock).
- `boardBriefing.ts`: `BoardLage.unberuehrt`/`mailsOhneFolge`, `hatFolge`, `unberuehrtMarkdown`,
  `UNBERUEHRT_TAGE` 30, `MAIL_TAGE` 7.

## Grenzen / offen
- → M463: Bild ersetzen, Editor-Rückgängig und der MCP-Server stempeln jetzt. (Vorher: Wege, die Karteninhalt ohne `updateNodeData*` schreiben (z. B. Bild ersetzen, Kanban-Rücksync über eigene
  Pfade, MCP-Server), stempeln noch nicht; Karten aus Importen (Datei, Vorlage) sind „unbekannt" oder tragen den
  Zeitpunkt der Quelle, bis sie geändert werden. Kanban-Rücksync bleibt als Automatik bewusst ohne Stempel.)
- Bei echtem Konflikt (beide Seiten geändert) bleibt die hiesige Fassung samt ihrem Zeitpunkt; ein „spätere
  Änderung gewinnt" für den Inhalt wäre ein eigener Meilenstein (Konfliktregeln, m311).
- Kein Filter „älter als …" in der Suche. Zeitpunkt im Kontextmenü → M463 (leise Zeile ganz unten im ⋯).
