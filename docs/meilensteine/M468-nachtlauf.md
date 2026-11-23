# M468 — Nächtlicher CI-Lauf aller Prüfreihen
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m468-nachtlauf.mjs` (ohne Port, ohne Browser) · Datum: 2026-11-23

## Warum
Die PR-Prüfung (`pruefen.yml`) baut nur; E2E-Reihen laufen beim Agenten, und meist nur die zu seinen Dateien
(`--geaendert`, M448). Was parallele Meilensteine nebenbei an alten Reihen kaputt machen, fiel erst auf, wenn
jemand die volle Reihe (~35 min) anstieß – bei M448 waren es nach einer Runde ein Dutzend Befunde.
Backlog-Idee „Nächtlicher CI-Lauf aller Prüfreihen".

## Was
- Jede Nacht um 02:17 UTC (und von Hand über *Run workflow*) baut ein GitHub-Runner die App (`dist/`,
  Single-File, MCP-Server) und fährt **alle** Prüfreihen außer den drei Datenbank-Reihen.
- Die Zusammenfassung des Laufs zeigt grün/rot je Reihe mit Dauer, die roten Reihen mit ihren ersten
  Fehlerzeilen, die Wackler (erst beim zweiten Mal grün) und die ausgelassenen Reihen.
- Ist etwas rot, gibt es **ein** Issue „Nachtlauf rot" (Label `nachtlauf`) mit Checkliste der roten Reihen und
  Link zum Lauf; ein weiterer roter Lauf erneuert Text und kommentiert, der nächste grüne Lauf schließt es.
  Der Orchestrator schaut morgens dorthin (`docs/AGENTEN.md`, „Nachtlauf").
- Bericht (`nachtlauf-bericht.txt`) und Ergebnis (`nachtlauf-ergebnis.json`) als Artefakt (14 Tage).

## Wie (Architektur)
- `.github/workflows/nachtlauf.yml`: `schedule` + `workflow_dispatch` (Eingaben `bahnen`, `auswahl`),
  `permissions: issues: write`, `concurrency: nachtlauf`, Job-Limit 180 min, Prüfschritt 150 min.
  Chromium: `npx playwright-core install --with-deps --no-shell chromium`, dann
  `PW_CHROMIUM=$(node werkzeug/chromium-pfad.mjs)` nach `$GITHUB_ENV`. Bahnen = Kerne − 1 (ubuntu-latest: 3),
  damit Takt-Messungen (m419) nicht unter Eigenlast wackeln. Artefakt und Auswertung mit `if: always()`.
- `werkzeug/alle-pruefungen.mjs`:
  - `--ohne-datenbank` lässt Reihen aus, deren Quelltext `psql`/`pntest` nennt – dieselbe Erkennung wie die
    Sperre `datenbank` (M448); Ausgabe und JSON nennen sie (`ausgelassen`).
  - `--json datei` schreibt `{ start, bahnen, fertig, gesamt, minuten, ausgelassen, reihen: [{ reihe, rot, rc,
    sek, summe, wiederholt, fehler }] }` nach **jeder** Reihe neu; ein abgebrochener Lauf hinterlässt
    `fertig: false` mit dem Stand bis dahin.
  - `--nur-zeigen` listet jetzt auch ohne `--geaendert` die Auswahl samt Sperren (Trockenlauf).
- `werkzeug/chromium-pfad.mjs`: `chromium.executablePath()` aus playwright-core, Rückgabewert 1 mit Hinweis,
  wenn die Datei fehlt (sonst scheitern 187 Reihen einzeln am Browser).
- `werkzeug/nachtlauf-melden.cjs` (CommonJS für `require` in actions/github-script): `auswerten()` (rot =
  Bau nicht `success`, keine Ergebnisdatei, `fertig: false` oder eine Reihe auch allein rot), `zusammenfassung()`
  → `core.summary`, Issue über `issues.listForRepo` (Label `nachtlauf`, Titel „Nachtlauf rot"), Label wird bei
  Bedarf angelegt. Ein Hand-Lauf mit `auswahl` (`teilauswahl`) schreibt nur die Zusammenfassung.
- Prüfreihe `m468`: Läufer-Optionen, Auswertung gegen ein nachgebautes GitHub (anlegen, erneuern, schließen,
  Bau kaputt, Abbruch, Teilauswahl), Chromium-Pfad mit gefälschtem `PLAYWRIGHT_BROWSERS_PATH`, Workflow-Text.

## Grenzen / offen
- Die Datenbank-Reihen (m383b, m388b, m391b) laufen nachts nicht; ein Postgres-Dienst im Runner wäre möglich,
  die Reihen erwarten aber den lokalen Nutzer `postgres` über `psql` – bewusst später.
- Der Runner hat andere Schriften und eine andere Grundlast als die Claude-Umgebung; Reihen, die Pixel oder
  Takte messen, können dort anders ausfallen. Wackler stehen in der Zusammenfassung und im Issue getrennt.
- Geplante Läufe laufen nur auf dem Standardzweig (= Hauptzweig) und setzen nach 60 Tagen ohne Commit aus.

## Erster Lauf (2026-11-23, von Hand)
Run 45151709744: 183 von 188 Reihen grün in 40,2 min bei 3 Bahnen, keine Wackler; rot und in Issue #154
„Nachtlauf rot" eingetragen: m268 (175 %: Menü 624 px vom Knopf), m299 (Hilfe-Punkt „Outlook live", M466, über
420 Zeichen), m314 (Dienste-Liste trägt „Text in Bildern"), m382 (englische Standardnamen neuer Karten), m398
(Lösch-Meldungen samt „Rückgängig"). Der Lauf ließ m468 selbst als „Datenbank-Reihe" aus, weil ihr Quelltext das
Erkennungsmuster wörtlich enthielt – die Reihe setzt es jetzt zusammen und prüft das (A1b).
