# M511 — Reaktionen im geteilten Board am Telefon frei bedienbar
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m511-reaktionen-telefon.mjs` (Port 5511) · Datum: 2026-11-24

## Warum
Fehlermeldung: „Ich kann am Smartphone schlecht im geteilten Board mit Emojis reagieren, da diese oben von einer
Dauermeldung überdeckt werden.“ Bildschirmfoto dazu (Gast, Link „nur lesen“, Telefon hochkant): Die Pille
„Nur lesen · geteilt von Per Link | Eigene Kopie anlegen“ lag über der Reiterzeile (nur „Pe…“ zu sehen) und über
der Live-Leiste; der Reaktions-Knopf hing angeschnitten am rechten Rand.

## Ursache
Drei **Dauerbänder** (bleiben stehen, solange ein Zustand gilt) waren je Datei mit fester Lage und Ebene gebaut –
für den Desktop, wo oben mittig Platz ist:
- `.lese-band` (62-greifen…): `top: 58px`, mittig, bis 92 vw breit, **Ebene 60** – am Telefon genau auf der Höhe
  von Reiterzeile (Ebene 50) und Live-Leiste (`.live-leiste`, **Ebene 55**, oben rechts). Die Live-Leiste trägt
  den Reaktions-Knopf → zugedeckt. `elementFromPoint` am Knopf traf `lese-kopie` bzw. `lese-band`
  (Bilder `vorher/iPhone-13-0.png`, `vorher/Pixel-7-0.png`).
- `.zeig-band` („… führt vor“, Ebene 61, `top: 14px`): lag am Telefon quer über der Kopfzeile (Rückgängig, Suche).
- `.gruppen-timer` (Ebene 96, `top: 58px`, mittig): überdeckte am schmalen Telefon die Live-Leiste – mit der
  Stunden-Anzeige aus M512 („1:29:59“) noch breiter (Befund in M512, hier mit gelöst).
Dazu war der Reaktions-Knopf 26 × 26 px, die Reaktionen 34 × 34 px – unter der Mindestgröße für Finger.

## Was
- **Telefon** (`max-width: 640px` oder Querformat `max-height: 500px` mit Finger): Die Dauerbänder stehen in
  **einer Spalte unter Kopfzeile, Reitern und Live-Leiste**, eine Ebene unter der Bedienung; die Auswahl der
  Reaktionen klappt über ihnen auf. Im Querformat stehen sie nebeneinander (sonst reichte die Spalte bis ans Dock).
- **„Nur lesen“ schrumpft** nach 6 s auf Schloss, „Nur lesen“ und einen Pfeil. Antippen zeigt den Hinweis samt
  „Eigene Kopie anlegen“ wieder ganz (und er schrumpft danach erneut); der Pfeil klappt ihn von Hand zu/auf.
- **Fingergroß** (mit Finger, `pointer: coarse`): Reaktions-Knopf 44 × 44 px (sichtbar bleibt ein kleiner Kreis –
  durchsichtiger Rand um die Fläche), jede Reaktion 44 × 44 px; die Live-Leiste ist so hoch wie Kopfzeile und Reiter.
  Unter 380 px Breite stehen die acht Reaktionen in zwei Reihen zu vier.
- **Querformat mit Kerbe:** Live-Leiste, Bänder und Auswahl rücken aus `safe-area-inset-left/right`.
- **Desktop unverändert:** Der Stapel ist dort `display: contents` – jedes Band an seinem bisherigen Platz, mit seiner
  bisherigen Ebene; die Kurzform hat dort keine Wirkung. `werkzeug/bild-vergleich.mjs` (alter gegen neuen Build):
  11 von 11 Ansichten pixelgleich; Reihe m511 Block D prüft Lage, Größe und Ebene der Live-Ansicht am Desktop.

## Wie (Architektur)
- **Ebenen als Tokens** (`src/styles/00-tokens.css`): `--ebene-dauerband: 49`, `--ebene-live: 55` mit der
  Reihenfolge im Kommentar (Dauerbänder < Reiter/Dock 50 < Live-Leiste 55 < Kopfzeile 56). `.live-leiste` nimmt
  `var(--ebene-live)`. Neu außerdem `--safe-left`/`--safe-right` (wurden in 66-… schon mit Ersatzwert benutzt).
- **Stapel** `<div class="dauerbaender">` in `App.tsx` (vor dem Toast): `LeseBand`, `writer-banner`,
  `VorfuehrenSpaet` (Band „… führt vor“), `GruppenTimerSpaet`. Bei laufender Präsentation trägt er `im-vortrag` und
  ist wieder `display: contents` (Band und Uhr der Präsentation liegen wie bisher über ihr, Ebene 96/97); ebenso im
  Karten-Fokus (`.app.focus-mode`).
- **`src/components/Dauerbaender.tsx`**: `LeseBand` (vorher Inline-JSX in App.tsx, Text unverändert; Zusatz in
  `.band-mehr`, Knopf `.band-klapp` / `data-taste="lese-klapp"`) und der Hook `useBandKurz(schluessel, ms)` – nach
  `BAND_KURZ_NACH` (6 s) Klasse `kurz`; neuer Schlüssel (anderes Board) zeigt das Band wieder ganz. Wiederverwendbar
  für weitere Dauerbänder.
- **Uhr eigenständig:** `GruppenTimer` (Gruppenraum.tsx) ist aus `GruppenraumSchicht` herausgelöst; die Schicht
  zeigt nur noch die aufsteigenden Reaktionen. Nachgeladen über `GruppenTimerSpaet` (LiveLeiste.tsx, gleiches
  Paket wie die Schicht – Start-JS unverändert).
- **CSS** (`64-gruppenarbeit-bild.css`): Block „M511: Dauerbänder in einem Stapel“ nach `.zeig-band` (Spalte,
  `top: max(--head-space, --kopf-oben) + 4px`, Kinder `position: relative; transform: none; z-index: auto`),
  Querformat-Zeile, Finger-Block nach `.presenter-head .reakt-wahl` (44-px-Ziele, `width: max-content` für die
  Auswahl – ohne sie umbrach die absolut gesetzte Auswahl auf die 44 px des Knopfs).
- **Neues Dauerband?** In den Stapel in App.tsx hängen, nichts mit eigener fester Lage oben bauen; Ebene unter
  `--ebene-live` lassen.

## Prüfung
`pruefungen/m511-reaktionen-telefon.mjs`: Anna (Desktop) lädt „nur lesen“ ein, fünf Gäste (iPhone 13 hochkant,
iPhone 13 quer, Pixel 7, Galaxy S8 mit 360 px, Desktop); Anna führt vor und stellt den Timer auf 90 Minuten (freie
Eingabe aus M512, Anzeige mit Stunden) – alle drei Bänder liegen an. Je Telefon steht die Uhr ganz im Bild unter
der Live-Leiste.
Je Telefon: kein Band über Live-Leiste/Kopfzeile/Reitern; Stapel unter der Live-Leiste; `elementFromPoint` am
Mittelpunkt des Reaktions-Knopfs und jeder der acht Reaktionen trifft den Knopf, je ≥ 44 px, im Bild; jede getippte
Reaktion kommt bei Anna an (MutationObserver); „Nur lesen“ wird kurz, bleibt sichtbar, klappt per Tipp auf
(„Eigene Kopie anlegen“ erreichbar) und per Pfeil zu; „Lösen“ und die Uhr bleiben erreichbar. Desktop (Block D):
Stapel `contents`, Bänder, Uhr und Leiste an Platz und Ebene wie vorher, nichts schrumpft. Block E: wer am Telefon
vorführt („Du führst vor“). Block F: die Gastgeberin selbst am Telefon (Sitzung per `storageState` übernommen).

## Grenzen / offen
- Die Bänder bleiben am Telefon sichtbar (nur „Nur lesen“ schrumpft); „… führt vor“ trägt eine Handlung („Lösen“,
  „Beenden“) und bleibt darum ganz.
- In der Folien-Präsentation am Telefon ist nichts verändert (Reaktions-Knopf im Kopf der Präsentation, M376).
- M509 (Look beim Teilen) und M512 (freier Timer) sind eingemischt: der M509-Hinweis ist ein Toast unten (12 s), er
  deckt die Reaktionen nicht. M510 war beim Bau noch nicht im Hauptzweig; dauerhafte Hinweise gehören in den Stapel.
- Am sehr schmalen Telefon (360 px) mit vielen Teilnehmern reicht die Live-Leiste (über den Reitern, Ebene 55) ein
  paar Punkte über deren rechten Rand; „+ Board“ bleibt frei.
