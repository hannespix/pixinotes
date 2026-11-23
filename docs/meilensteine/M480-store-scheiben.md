# M480 — `src/store.ts` in Scheiben (reiner Umbau, für niemanden sichtbar)
PR: #… · Prüfreihe: `pruefungen/m480-store-scheiben.mjs` · Datum: 2026-11-23

## Warum
`src/store.ts` war mit ≈ 3 750 Zeilen der Hotspot Nr. 1: Fast jeder Meilenstein fügte dort eine Aktion, einen Typ
oder einen Haken hinzu, und parallel arbeitende Agenten trafen sich in derselben Datei (Merge-Konflikte, lange
Lesewege). Ziel: kleinere Konfliktfläche – wer an Kommentaren arbeitet, berührt nicht die Datei, in der jemand
anderes den Abgleich ändert.

## Was
- Nichts für den Nutzer. Gleiches Verhalten, gleicher Speicherstand (`pixinotes-board`, Fassung 5), gleiche Exporte.

## Wie (Architektur)
`src/store.ts` (≈ 80 Zeilen) bleibt der **eine Einstieg**: `import './lib/firstRun'` zuerst (M217), dann
`create(persist(…))` mit dem Leseschutz-`set` (M360) und `patchActive`, die Scheiben werden zusammengespreizt;
dieselben 55 Namen wie vorher werden weiterexportiert (`export { … } from './store/…'`). Keine der ~140
importierenden Dateien musste sich ändern.

| Datei | Inhalt |
|---|---|
| `store/typen.ts` | `Stroke`, `BoardDoc`, `CommentThread`, `Space`/`Project`, Verlaufs-Typen, **`BoardState`**, dazu `Setzen`/`Holen`/`AufsOffene` (die Parameter jeder Scheibe) |
| `store/struktur.ts` | `strukturScheibe`: Start-Board, Bereiche/Projekte/Boards (anlegen, umbenennen, sortieren `sortiereProjekte`, verschieben, duplizieren, löschen mit `ebeneLoeschen`/`ebenenUndo`), `standEinsetzen`, `kartenZurueckholen`, `archiveBoard`, `setBoardBg` |
| `store/karten.ts` | `kartenScheibe`: Karten anlegen/ändern/duplizieren/verschieben/löschen/wiederherstellen, Portale, Größe, Drehung, Kachel, Schrift, Fristen-Anker, Vorlagen, `onNodesChange`; Helfer `anhaengeMitnehmen`, `zeitNachPatch`, `mitFristAnker` |
| `store/kanten.ts` | `kantenScheibe`: `onEdgesChange`, `onConnect`, Beschriftung, Art, Aussehen, Löschen |
| `store/zeichnen.ts` | `zeichnenScheibe`: Striche, Radieren (`eraseSnapPending`), Lösen, `bildErsetzen` |
| `store/kommentare.ts` | `kommentareScheibe`: Kommentar-Pins (M148), Nachschlagen |
| `store/ansicht.ts` | `ansichtScheibe`: offene Dialoge, Werkzeug, Fokus, Darstellung, Bedienung, KI/Brain-Einstellungen, Archiv einblenden |
| `store/verlauf.ts` | Schnappschüsse, gezieltes Zurücknehmen in der Gruppe (M365), Tipp-Bündelung (M122), `mutedHistory`; `verlaufScheibe`: `pushHistory`, `undo`, `redo`, `schritt` |
| `store/abgleich.ts` | `abgleichScheibe`: `addStarter`, Struktur-Import (M184, `importUndo`), `resetAll`, `importSync`, `importProject` |
| `store/hinweise.ts` | `hinweisMitKnopf`/`hinweisKnopfDruecken` (M476); `hinweiseScheibe`: `showToast`, `hinweisRueckgaengig` |
| `store/schutz.ts` | Leseschutz (M360), Karten-Sperren (M364), Notiz-Schutz (M477), Gruppenrechte (M365), `persistHaken`, `vorUmbauHaken`, `kartenSchub` |
| `store/speicher.ts` | gedrosselter localStorage-Schreiber, Single-Writer (M81), `markImported`, `runDerived`; `speicherAuswahl` (partialize) und `speicherMigration` (migrate) |
| `store/start.ts` | leeres Startboard (M370), Namen ohne Emoji (M397), Startnamen auf Englisch (M381) |
| `store/selektoren.ts` | `selectActiveBoard`, `selectNurLesen`, `useNurLesen`, `useKarteFest` |

Regeln für neue Arbeit:
- Neue Aktion: Typ in `BoardState` (`store/typen.ts`), Umsetzung in der Scheibe ihres Themas. `store.ts` nur
  anfassen, wenn ein **neuer öffentlicher Name** dazukommt (Weiterexport) oder eine neue Scheibe.
- Eine Scheibe ist eine Funktion `(set, get, patchActive)` → Teilobjekt mit `satisfies Partial<BoardState>`
  (Parameter einzeln statt als Objekt: spart Start-JS). Fehlt eine Aktion in allen Scheiben, meldet `tsc` es am
  Zusammenbau in `store.ts`.
- Modulvariablen (`let`) bleiben in der Datei, die sie setzt. Die Tipp-Bündelung (`lastEditKey`/`lastEditAt`)
  setzen auch Karten und Struktur – dort über `tippBuendelEnde()` / `tippBuendelMerken(key, at)` aus
  `store/verlauf.ts` (ein importiertes `let` ist nur lesbar). Das ist die einzige Stelle, an der sich Code
  (Zuweisung → Aufruf) geändert hat; alles andere ist Zeile für Zeile verschoben (Kommentare mit Meilenstein
  wanderten mit).
- Teile importieren `useBoard` aus `../store` (Kreis Einstieg ↔ Teil): nur in Funktionen benutzen, nie beim Laden
  des Moduls.

Gemessen: Start-JS (Haupt-Chunk) gegen den Hauptzweig mit M481 892 725 B → 893 111 B (+386 B: die neun
Scheiben-Funktionen und ihr Aufruf; vor M481/M482 ebenso 891 972 B → 892 357 B).
Die Grenzen der Reihen m446 (2 245 000 B) sowie m459/m467 (2 240 000 B) halten.

Prüfreihe `m480-store-scheiben.mjs` (Port 5480): Exporte unverändert, firstRun zuerst, kein Teil über 750 Zeilen;
in der App Migration Fassung 4 → 5, Löschen mit Hinweis, Strg+Z/Strg+Y, Tippen als ein Schritt, Board wechseln,
Neuladen.

## Grenzen / offen
- `store/struktur.ts` und `store/karten.ts` sind mit je ~650 Zeilen noch die größten Teile; weiter schneiden
  (z. B. Portale aus Karten, Stände/Zurückholen aus Struktur), wenn sie wieder zum Konfliktherd werden.
- `BoardState` steht weiter als ein Interface in `store/typen.ts` – neue Aktionen treffen sich dort (eine Zeile je
  Aktion, Konflikte dort sind klein).
