# M461 — Englische Oberfläche: Einzahl und Mehrzahl stimmen
PR: #139 · Prüfreihe: `pruefungen/m461-mehrzahl.mjs` (Port 5461) · Datum: 2026-11-23

## Warum
M455 meldete: In der Hierarchie-Ansicht der Übersicht steht in englischer Oberfläche „1 cards". Ursache war
nicht der Übersetzer, sondern der Quelltext: `lib/boardStats.ts` schrieb `${n} Karten` — auf Deutsch stand also
„1 Karten", der Beobachter machte daraus korrekt „1 cards". Dasselbe Muster (`${n} Karten`, „Karte(n)",
„Ticket(s)", „Termin(e)" …) steckte an rund 55 weiteren Stellen.

## Was
- Zähl-Texte heißen jetzt in beiden Sprachen richtig: „1 Karte / 2 Karten / 0 Karten", „1 card / 2 cards /
  0 cards" — Übersicht (Hierarchie-Kacheln, Portal-Karten), Suche (Board-Treffer, Netz-Tooltip), Aufgaben-Zentrale
  (Kopfzeile „1 Aufgabe angezeigt", Hinweis, Kalender-Export), Kanban (Spaltenzähler, WIP-Limit, Einsammeln,
  dauerhaft entfernte Tickets), Rahmen-Zähler, Ideen-Blasen (Zähler, Punkte-Abstimmung), Tabelle (Filter-Stand),
  Kalender (Import, Abos, Export), Gruppenraum-Timer, Gehirn-Index, Themen ordnen, OneNote-Import, Teilen,
  Recherche, Board-Briefing, Bereiche/Projekte löschen und kopieren, Datei-Import (Kontakte, Anhänge, Bilder).
- Zahlen ab 1000 mit Tausendertrennung der Sprache („1.234 Aufgaben", „1,234 tasks").
- Die Kachel des Wochenplans bleibt „2 Blöcke in 5 Spalten" (jetzt auch „1 Block in 1 Spalte").

## Wie (Architektur)
- **Helfer `zahlWort(n, einzahl, mehrzahl)` in `src/lib/sprache.ts`.** Wählt die Form mit `Intl.PluralRules`
  der Oberflächensprache und formatiert die Zahl (`toLocaleString` de-DE bzw. en-GB). Auf Deutsch liefert er
  `„2 Karten"`; auf Englisch schlägt er im Wörterbuch unter `„{n} Karte"` / `„{n} Karten"` nach (Schlüssel mit
  `{n}`, nicht `{0}` — sonst würden daraus allgemeine Muster, die fremde Texte wie „Neue Karte" treffen) und
  merkt das Ergebnis als eigenes Englisch (`eigene`, keine Lücke).
- **Gleiche Formen** („Rahmen", „Kalender"): ein Schlüssel, der Eintrag nennt beide englischen Formen mit `|` —
  `"{n} Rahmen":"{n} frame|{n} frames"`.
- **In größeren Vorlagen** (`${zahlWort(n, 'Karte', 'Karten')} im Index`) übersetzt der Beobachter den Rest
  über das Muster `„{0} im Index"`; das eingesetzte Englisch bleibt stehen. Ein Text, der nur aus
  zahlWort-Ergebnissen und Satzzeichen besteht („ (2 frames)"), gilt nicht als Lücke (`nurZahlWorte`).
- **Ernte:** `werkzeug/sprache-ernten.mjs` erntet aus jedem Aufruf `zahlWort(x, 'A', 'B')` die Schlüssel
  `„{n} A"` und `„{n} B"` (nur Zeichenketten als Argumente) — `--fehlend` meldet fehlende Zähl-Wörter wie
  jeden anderen Text.
- Für die Prüfreihe hängt der Helfer als `window.__pnZahlWort` (in beiden Sprachen).
- Die alten Wörterbuch-Einträge („{0} Karte(n) …") sind verwaist und fallen beim nächsten
  `sprache-bauen.mjs` heraus.

### Regel für künftige Agenten
**Zähl-Texte nur über `zahlWort` aus `lib/sprache.ts`** — nie `${n} Karten`, nie „Karte(n)", nie
`n === 1 ? … : …` für ein neues Zähl-Wort. Danach `node werkzeug/sprache-ernten.mjs --fehlend` und die
englischen Formen als `"{n} Karte":"{n} card"` eintragen. Wortstellung, die im Englischen anders ist
(„{0} wieder zulassen" → „Allow {0} again"), als ganze Vorlage schreiben (`{`${zahlWort(…)} wieder zulassen`}`),
nicht als JSX-Text hinter dem Ausdruck.

## Grenzen / offen
- Texte für die KI (`lib/kiModule.ts`, `kiAnweisung.ts`, `aiActions.ts`, `brain.ts`, `recherche.ts` — von der
  Ernte ausgenommen) und Dateinamen (`kontaktExport.ts`) bleiben unverändert.
- Stellen, die schon richtig waren (`n === 1 ? 'Karte gelöscht' : …`, „Karte{1}" über die Endungs-Regel des
  Beobachters), sind nicht umgebaut.
- Sätze mit „Alle {n} …" (nur bei mehreren) und Ideen-Inhalt in Notizen (`lib/bubbles.ts`, Inhalt) bleiben.
