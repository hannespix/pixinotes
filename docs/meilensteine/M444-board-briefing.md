# M444 — KI: Board-Briefing (die Lage des Boards auf einen Blick)
PR: (siehe Merge-Commit) · Prüfreihe: `pruefungen/m444-board-briefing.mjs` · Datum: 2026-11-23

## Warum
Roadmap `docs/KONZEPT.md` („Board-Briefing: Was ist heute wichtig?"). Das bisherige „Analytisches Briefing
erstellen" im KI-Assistenten schrieb einen freien Überblick ohne Fristen-Reihenfolge und ging nur mit KI.

## Was
- Dock ⋯ → KI-Assistent → **„Board-Briefing (Lage)"** (ersetzt „Analytisches Briefing erstellen") und Strg+K
  „Board-Briefing" legen eine **neue Notiz** (Farbe sky, 380 px breit) **rechts neben den sichtbaren Ausschnitt**
  und fliegen hin. Am Board ändert sich sonst nichts; Strg+Z nimmt die Notiz wieder weg.
- Inhalt: **Aufgaben und Fristen** (überfällig → bald → später, je mit Frist und @Person, höchstens 10, dann
  „n offene ohne Frist"), **Entscheidungen** (Beschlüsse aus Protokollen, Zeilen „Beschluss: …" aus Notizen),
  **Wichtigste Inhalte** (die fünf gehaltvollsten Karten), **Risiken und Blocker** (überfällige Fristen und Zeilen
  mit „Risiko", „blockiert", „Verzug", „Engpass" …).
- **Mit KI**: Die Fristenliste bleibt lokal (exakte Daten, Reihenfolge, nichts erfunden); das Modell schreibt
  Lage, Entscheidungen, Inhalte und Risiken aus dem ganzen Board. **Ohne KI** (Anbieter „none"): dasselbe Gerüst
  lokal, Meldung „(ohne KI) … Mit eingerichteter KI wird es ausführlicher" – kein Umweg in die Einstellungen.
  **KI scheitert** (Netz, 500): Briefing lokal, Meldung nennt den Grund. Abbruch über den Hinweis: keine Notiz.
- Bewusst **keine Checklisten** in der Notiz: `- [ ]` würde in der Aufgaben-Zentrale als neue Aufgabe auftauchen
  und Fristen doppelt mahnen. Checklisten des Modells werden zu Stichpunkten (`kiTextSaeubern`).

## Wie (Architektur)
- `src/lib/boardBriefing.ts`: `lageSammeln(board)` (lokal, nutzt `collectTasks` aus `lib/tasks.ts` mit
  `archived:false`, `nodeToText`), `aufgabenMarkdown`, `lageMarkdown`, `kiTextSaeubern`, `platzNeben`
  (`findFreeSpot` rechts vom Ausschnitt), `boardBriefing(rechtsOben, mitKi, fortschritt)`. KI-Teil lädt `ai`,
  `aiActions` und `zielBoard` nach (`import()`), Kontext über `gather` aus `aiActions.ts` (dafür jetzt
  exportiert – derselbe Platzdeckel `CTX_MAX_*` und `kiLesen` wie alle Board-Aktionen), Antwort über
  `aufDemselbenBoard` (M388). Notiz über `mdToBlocks`, ein Undo-Schritt (`pushHistory` + `mutedHistory`),
  dann `focusNode`.
- `src/components/Dock.tsx`: `briefing()` statt `runAi('brief', aiBriefing)` – eigene Sperre über `aiBusy`,
  aber ohne `aiReady`-Pflicht; Position `screenToFlowPosition({ x: innerWidth, y: 90 })`. Hört auf das
  Fenster-Ereignis `pixinotes:board-briefing`.
- `src/components/SearchOverlay.tsx`: Befehl „Board-Briefing" (Alias briefing, lage, fristen …) → `setView('board')`
  und das Ereignis (die Suche kennt den Ausschnitt nicht).
- `aiBriefing` bleibt für die Auswahl-Leiste („Zusammenfassen" markierter Karten).
- Texte englisch in `src/sprache/en.json`; Hilfe in `HelpOverlay.tsx`/`HelpOverlayEn.tsx`.

## Grenzen / offen
- „Unbeantwortete E-Mail-Karten" und „verwaiste Karten (seit 3 Wochen unangefasst)" aus dem Konzept fehlen –
  Karten tragen kein Änderungsdatum; das wäre ein eigener Meilenstein.
- → M463: ohne KI nennt die Risiko-Liste jetzt auch überfällige Fristen mit Namen, Tickets lange „in Arbeit“ und blockierende Pfeile. (Vorher: Die Risiko-Erkennung ohne KI ist ein Wortmuster (deutsch + risk/blocked/delay); „Problem" kann auch
  harmlose Zeilen treffen – das Wortmuster bleibt als Ergänzung.)
- Briefing nur fürs aktive Board, nicht boardübergreifend (dafür gibt es „Woche planen" in der Aufgaben-Zentrale).
