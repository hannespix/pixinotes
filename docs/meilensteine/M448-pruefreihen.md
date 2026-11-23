# M448 — Prüfreihen-Gesundheit: die ganze Reihe grün und verlässlich
PR: #143, #… · Prüfreihen: alle (`node werkzeug/alle-pruefungen.mjs`) · Datum: 2026-11-23

## Warum
Die Prüfreihen sind das Merge-Tor für automatisch arbeitende Agenten. Nach den
parallelen Runden M442–M464 war die volle Reihe nicht mehr grün: einige Reihen
prüften Verhalten, das spätere Meilensteine bewusst geändert hatten, andere
wackelten unter Last (vier Bahnen plus weitere Agenten auf vier Kernen,
Last-Durchschnitt 9–15), und zwei Befunde lagen in der App selbst.

## Was
- Volle Reihe grün (Stand nach Einmischen von M464): siehe Tabelle unten.
- `werkzeug/alle-pruefungen.mjs`
  - `--geaendert` startet nur die Reihen, die zu den seit dem Hauptzweig
    geänderten Dateien passen (Reihe selbst geändert · gleiche
    Meilenstein-Nummer · Quelltext nennt den Dateinamen · ein Wort des
    Dateinamens steckt im Reihennamen, englisch → deutsch: `FocusSheet` →
    `fokus`). Was mehr als 30 Reihen nennen (`HelpOverlay.tsx`), zählt nicht
    als Grund. `--nur-zeigen` listet Auswahl und Grund, `--basis <ref>` wählt
    einen anderen Vergleichsstand.
  - `EADDRINUSE`: Ein anderer Agent belegt den festen Port derselben Reihe in
    seinem Worktree – das Werkzeug wartet 20 s und startet neu (bis sechsmal),
    statt rot zu melden.
  - Der Bericht nennt auch den ersten Fehlschlag mit Grund (`erster Lauf rot,
    wird allein wiederholt`) – Wackler bleiben so auffindbar.
- `pruefungen/README.md`: Reihentabelle bis m469, Aufruf der parallelen Reihe,
  Hinweis zu den Datenbank-Reihen.

## Ergebnis je Reihe (nur, was nicht ohne Weiteres grün war)
| Reihe | Befund | Art |
|---|---|---|
| m299 | Sprechblase „Board-Briefing" (M444) 124 Zeichen → gekürzt (`Dock.tsx`) | **App repariert** |
| m299 | Sprechblase „Absender als Kontakt" (M457) 155 Zeichen → gekürzt (`SelectionToolbar.tsx`) | **App repariert** |
| m299 | „Was ist neu" nicht absteigend (parallele Merges setzten M452 vor M458, M449 weit unten) → `HelpOverlay*.tsx` umsortiert | **App repariert** |
| m299 | Hilfe zur Browser-Erweiterung (M458) ein Punkt über 420 Zeichen → zwei Punkte | **App repariert** |
| m299 | Hilfe „Outlook live" (M466) ein Punkt über 420 Zeichen → zwei Punkte (de/en) | **App repariert** |
| m320 | C5 unter Last zwei gleiche Anfragen an den Handschrift-Dienst: Vorschlag nach der Schreibpause und Knopf „Text" erkannten dieselben Striche je einmal → `handschriftKandidaten` merkt die letzte Erkennung (auch laufend) | **App repariert** |
| m296 | 23 Kacheln seit der Kontakt-Karte (M450) | angepasst |
| m314 | Dienste-Abschnitt „Text in Bildern" (M452) | angepasst |
| m398 | Meldungen mit richtiger Mehrzahl „3 Boards" (M461) | angepasst |
| m312 | ⋯ Mehr trägt „Versionen" (M449) | angepasst |
| m300 | Dienste-Abschnitt „Text in Bildern" (M452) | angepasst |
| m391 | H3 verlangte „kein offener Fund" in ganz `AUDIT.md`; M447 führt bewusst offene Punkte – jetzt nur Team-Funde (T…) | angepasst |
| m348 | verglich die LÄNGE des Pfads statt des Pfads – zwei verschiedene Pfade sind gelegentlich gleich lang | repariert (Messfehler der Reihe) |
| m332 | F3: Endmeldung „Abgebrochen nach Teil …" zwischen zwei Blicken verpasst → Toasts im Seitenkontext mitschreiben, auf die Meldung warten | Wackler |
| m407 | C2 las localStorage vor dem gebündelten Schreiben (400 ms) → wartet auf den gespeicherten Filter | Wackler |
| m419 | B4/C1b Takt ≤ 20 ms ist unter Fremdlast nicht zu halten → Grenze 40 ms, wenn die Last über der Kernzahl liegt (Ausgabe sagt es) | Wackler |
| m425 | Editor im Rahmen unter Last später als 8 s → wartet bis 20 s auf `#edit` | Wackler |
| m429 | Sprung „je Bild" bei ausgefallenen Bildern → auf verstrichene 60-Hz-Bilder umgelegt (parallel auch im Hauptzweig gelöst, dessen Fassung gilt); unter schwerer Last trotzdem 11–12 Punkte → Grenze 12 statt 6, wenn die Last über der Kernzahl liegt | Wackler |
| m273, m328, m387, m389 | unter voller Last einmal rot, allein grün (Doppelklick, Zeitgrenzen) | Wackler, vom Werkzeug wiederholt |
| m381 u. a. | `EADDRINUSE` durch Reihen anderer Agenten | Werkzeug wiederholt |
| m383b, m388b, m391b | brauchen ein lokales Postgres; hier vorhanden (`service postgresql start`), daher grün; fehlt es, melden sie laut „ÜBERSPRUNGEN" | braucht Datenbank (hier lauffähig) |

Alle übrigen Reihen waren grün. Drei volle Läufe (je ~35–42 min, vier Bahnen):
164/168, 174/176, 184/187 grün; die jeweils roten Reihen stehen oben und sind
danach einzeln grün gelaufen. Unter voller Last werden einzelne Reihen erst beim
allein wiederholten Lauf grün (das Werkzeug wiederholt jeden Fehlschlag einmal).

Lehre für parallele Agenten: Reihen, die Mengen zählen (Kacheln, Menüeinträge,
Abschnitte, „Was ist neu"-Reihenfolge, Längen-Leitplanken), brechen bei fremden
Meilensteinen – vor dem Merge `node werkzeug/alle-pruefungen.mjs --geaendert`
plus `m296 m299 m300 m312 m314 m316` laufen lassen.

## Wie (Architektur)
- `werkzeug/alle-pruefungen.mjs`: `einmal()` startet eine Reihe, `lauf()`
  wiederholt bei `EADDRINUSE`; Block `if (nurGeaendert)` mit `git merge-base`,
  `git diff --name-only`, `git ls-files --others` und den vier Regeln.
- Last-Schutz für Takt-Messungen: `os.loadavg()[0] > os.cpus().length`
  (`m419`). Neue Takt-Reihen sollten dasselbe tun oder je verstrichener Zeit
  messen (`m429`).
- Wartebedingungen statt fester Pausen: `P.waitForFunction` auf den Zustand
  (gespeicherter Filter, Toast-Text), Rahmen-Suche mit Frist.

## Grenzen / offen
- `--geaendert` ist eine Auswahl für schnelle Läufe; bei `store.ts`,
  `index.css`, `App.tsx` und Hilfe-Texten bleibt die volle Reihe der sichere Weg.
- Die volle Reihe dauert bei vier Bahnen rund 35 min; neue Meilensteine ändern
  ständig Zahlen (Kacheln, Menüeinträge) – Reihen, die feste Mengen zählen,
  werden weiter gelegentlich nachgezogen werden müssen.
