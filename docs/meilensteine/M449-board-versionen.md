# M449 — Board-Versionen: frühere Stände ansehen und wiederherstellen
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m449-board-versionen.mjs` (Port 5449) · Datum: 2026-11-23

## Warum
Roadmap `docs/KONZEPT.md` Phase 3 „Board-History" („zeig mir das Board von letztem Dienstag"). Strg+Z reicht
50 Schritte und endet mit dem Neuladen; danach gab es den Stand von gestern nur über einen alten Datei-Export.
Ein früherer Revisions-Ansatz (Kommentar „Trilium-Paket: Board-Verlauf" in `store.ts`) war nicht mehr im Code.

## Was
- PixiNotes sichert jedes Board selbst: **vor der ersten Änderung einer Sitzung**, **beim Verlassen** (anderes
  Board, Übersicht), **alle 10 Minuten**, wenn sich etwas geändert hat, wenn das Fenster verdeckt wird, und **vor
  riskanten Vorgängen**: Abgleich (Ordner/WebDAV/Konto, höchstens alle 10 Minuten je Board), Import (voller
  `importSync`, `importProject`), KI-Umbau (Dock → KI-Assistent).
- Dialog **„Versionen"**: ⋯ Mehr im Dock (`dock-versionen`), ⋯ des Boards in Navigation/Übersicht
  (`board-versionen`), Suche Strg+K („Versionen"). Liste mit Zeit, Kartenzahl und Anlass, Mini-Vorschau (Skizze
  wie bei den Vorlagen), „gegenüber jetzt: n kämen zurück, m fielen weg".
- **Wiederherstellen** nur nach Bestätigung im Dialog; der jetzige Stand wird vorher gesichert, das Einsetzen ist
  EIN Rückgängig-Schritt (Strg+Z / Strg+Y). **Als Kopie öffnen** legt „Board (Stand TT.MM., hh:mm)" mit frischen
  Kennungen daneben. Nur-Lesen-Boards: nur Kopie.
- „Stand jetzt sichern" von Hand.

## Wie (Architektur)
- `src/lib/boardVersionen.ts`: IndexedDB über `syncFolder.ts` (`idbGet/idbSet/idbKeys/idbDel`, DB
  `pixinotes-sync`, Store `kv`), nicht localStorage. Schlüssel `ver-ix:<boardId>` (Liste `VersionInfo[]`),
  `ver:<versionId>` (Inhalt), `ver-blob:<hash>` (Zeichenketten ≥ 16 KB, über alle Stände geteilt — `auslagern`/
  `einlagern`). Dateien/Tool-Quelltexte bleiben unter `file:<kartenId>`/`html:` liegen; der Stand merkt sich nur
  die Kennungen (`anhaenge`), `App.tsx` nimmt sie beim Aufräumen nach dem Start aus (`versionsAnhaenge()`).
- `versionSichern(board, grund, abstandMs)`: hält den Inhalt **synchron** fest (wer danach umbaut, ändert den
  Stand nicht mehr), schreibt danach in einer Kette (`nacheinander`), überspringt gleiche Stände (Prüfsumme
  `sig`, cyrb53) und leere Boards ohne Vorgänger. Mitgelesenes anderer bleibt draußen (`persistHaken.board`).
- `ausduennen()`: letzte Stunde alle, bis 24 h einer je Stunde, älter einer je Kalendertag; höchstens 50 und
  ~20 MB je Board. Verwaiste `ver-blob:` werden danach entsorgt; Stände gelöschter Boards nach 30 Tagen
  (`verwaisteAufraeumen`).
- `initBoardVersionen()` (aus `App.tsx`): `useBoard.subscribe` merkt geänderte Boards (Referenzvergleich von
  nodes/edges/drawings/comments), die ersten 2,5 s nach dem Start zählen nicht (Nachträge wie Fristen-Anker).
  Takt 60 s, Sicherung, wenn die letzte ≥ 10 min alt ist; `visibilitychange` → sofort.
- Store (`store.ts`): `vorUmbauHaken.sichern(boards, 'abgleich' | 'import')` in `importSync` (nur Boards, die
  sich ändern; `sanft` → nur `geaendert`) und `importProject`; neue Aktion `standEinsetzen(boardId, stand,
  alsKopie?)` — ohne Kopie ein History-Eintrag mit `remount` und `importEpoch + 1` (BlockNote liest nur beim
  Aufbau), mit Kopie frische Kennungen (Pfeile, `parentId`, Striche-Anker), `anhaengeMitnehmen`.
- Wiederherstellen ist eine **normale Änderung**: Sync (Ordner, WebDAV, Konto, Live) trägt sie weiter wie jede
  andere; es gibt keinen Sonderweg am Abgleich vorbei.
- Oberfläche: `src/components/VersionenDialog.tsx` (lazy, `App.tsx` → `Versionen`, Ereignis
  `pixinotes:versionen`), CSS-Block „M449" direkt nach den Vorlagen-Regeln in `index.css`.

## Grenzen / offen
- Versionen liegen **nur auf diesem Gerät**; sie reisen nicht mit Sync/Export (bewusst: Größe, Datenschutz).
- ~~Live-Team-Änderungen (Realtime-Deltas) lösen keine eigene „Vor Abgleich"-Sicherung aus; sie sind über Takt und
  Verlassen abgedeckt.~~ → erledigt in M460 (große Schübe anderer sichern vorher, gedrosselt).
- ~~Kein Vergleich Karte für Karte im Dialog (nur Zahlen + Skizze), kein Löschen einzelner Stände.~~ → erledigt in
  M460 (Vergleich, einzelne Karten zurückholen, Stände löschen).
