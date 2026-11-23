# M502 — Start-JS wieder entlastet: rund 68 KB weniger bis zum ersten Board
PR: siehe Merge-Titel „… (M502)" · Prüfreihe: `pruefungen/m502-start-leicht-2.mjs` (Port 5502) · Datum: 2026-11-23

## Warum
M483 hatte das Start-JS auf 2 097 102 B gesenkt und die Grenzen auf 2 120 000 B (m459, m467, m483) bzw. 2 125 000 B
(m446) gesetzt. Mit M484–M500 stand es wieder bei 2 110 339 B — keine 10 KB Luft mehr. Ziel: wieder mindestens 60 KB
Luft, ohne Verhaltensänderung, und die Grenzen erneut auf neuen Stand + gut 20 KB senken.

## Was
Nichts Sichtbares. Was ein frisch geöffnetes Board nicht braucht, kommt mit dem ersten Aufruf bzw. still im Leerlauf
kurz nach dem Start (`imLeerlaufVorladen`, App.tsx) — danach steht es ohne Verzug da, und der Service Worker hat es
auch offline.

| Messung (Board mit zwei Notizen, 1440×900) | vorher | nachher |
|---|---:|---:|
| Start-JS gesamt | 2 110 339 B | **2 042 564 B** (−67 775 B) |
| davon App-Teil `index-*.js` | 765 616 B | 697 841 B |
| Editor, Fluss, React | 1 344 723 B | 1 344 723 B (unverändert) |
| Luft zur alten Grenze 2 120 000 B | 9 661 B | 77 436 B |
| Grenze m459 / m467 / m483 / m502 | 2 120 000 B | **2 065 000 B** |
| Grenze m446 (misst etwas mehr: +~4 KB) | 2 125 000 B | **2 070 000 B** |

Die Grenzen sind wie bei M483 bewusst **gesenkt** (neuer Stand + gut 20 KB): Das Polster soll für mehrere Meilensteine
reichen. Ein neuer Teil im Start fällt weiter sofort auf.

Nachgeladen (Dateiname des Nachlade-Teils, gebaute Größe → wann er kommt):

| Teil | Datei (min.) | kommt mit |
|---|---:|---|
| Live-Team: `vorfuehren`, `mauszeiger`, `gruppenraum` (Kanal-Logik) | 9,5 + 3,2 + 2,6 KB | dem Live-Abgleich (`lib/gastSync.ts`), bevor der erste Kanal aufgeht |
| Live-Team: `Vorfuehren`, `Mauszeiger`, `Gruppenraum` (Anzeigen) | 4,3 + 7,7 + 4,8 KB | dem ersten Live-Board der Sitzung |
| `brain` (semantischer Index, verwandte Karten) | 10,1 KB | eingeschaltetem Gehirn (3,5 s nach dem Start, wie vorher) |
| `CommentLayer` (Pins, Gesprächs-Panel) | 7,8 KB | dem ersten Kommentar — ein Board mit Kommentaren lädt ihn beim Öffnen |
| `RechenTabelleGitter` (Raster der Rechen-Tabelle) | 6,3 KB | der ersten Tabelle, die gezeichnet wird; bis dahin Platzhalter in gleicher Gestalt |
| `Punkte` (Marken, Punkte-Leiste) | 6,1 KB | dem ersten Punkt auf dem Board bzw. dem Punkte-Modus |
| `handschriftStruktur` (Marker, Textarten) | 5,5 KB | der ersten Handschrift-Erkennung |
| `textInBildern` (Wächter der Bild-Texterkennung) | 4,5 KB | 4 s nach dem Start (die erste Runde lief schon vorher erst nach 4 s) |
| `LookupPanel` (Nachschlagen) | 3,9 KB | ⋯ → „Nachschlagen" |

## Wie (Architektur)
- **Messen** wie M483: vorübergehende Vite-Konfiguration mit `generateBundle`-Plugin (je Modul `renderedLength`, über
  `this.getModuleInfo` der statische Import-Graph), dann je Modul bzw. je Gruppe der „exklusive Gewinn" (was vom Einstieg
  aus nicht mehr statisch erreichbar ist, wenn alle Kanten zu diesen Modulen wegfallen). Nicht eingecheckt.
- **Live-Team:** `lib/vorfuehrenLeicht.ts` (neu, im Start) hält `VORFUEHR_EREIGNIS` und die Weichen `folgeIch`/
  `werFuehrtVor` — sie antworten „nein", bis `lib/vorfuehren.ts` geladen ist und sich per `vorfuehrenAnmelden` meldet
  (vorher kann niemand vorführen: nur dessen Nachrichten setzen den Zustand). `vorfuehren.ts` reicht `VORFUEHR_EREIGNIS`
  weiter, alle bisherigen Importe bleiben gültig. `initVorfuehren`/`initMauszeiger`/`initGruppenraum` ruft jetzt
  `kanalOeffnen` in `lib/gastSync.ts` (statisch importiert, jedes init läuft nur einmal) — vor der ersten Nachricht des
  Kanals, also ohne Lücke. Die Anzeigen hängen über `LiveZeigerSpaet` (Board.tsx), `VorfuehrenSpaet`, `GruppenraumSpaet`
  (App.tsx) aus `components/LiveLeiste.tsx` ein: `useLiveTeam()` hört auf `TEILNEHMER_EREIGNIS`; sobald das erste Board
  der Sitzung live ist (`liveAuf`), bleiben sie eingehängt (Modul-Merker `liveTeamDa`), wie früher von Anfang an. Ohne
  Kanal hängen sie nichts ins DOM — auch nicht mitten im Zug (M491).
- **Gehirn:** `lib/brainStart.ts` (neu) mit `initBrain` (gleiche Zeitpunkte wie vorher: 3,5 s, 12 s nach Änderung, sofort
  bei `pixinotes:brain-scope`, 1,5 s nach `pixinotes:bildtext-fertig`), lädt `lib/brain.ts` nur bei `brain.on`.
  `BacklinksPanel` holt `relatedToBoard` per `import()` (nur mit eingeschaltetem Gehirn).
- **Kommentare:** Verfasser-Name `getAuthor`/`setAuthor` nach `lib/autor.ts` (CommentLayer reicht beide weiter).
  `Board.tsx` → `Kommentare()`: hängt `CommentLayer` (lazy, `kommentareLaden`) ein, sobald das aktive Board Kommentare
  hat oder `commentOpen` gesetzt ist; danach bleibt er (Merker `kommentareEingehaengt`).
- **Rechen-Tabelle:** `components/RechenTabelle.tsx` ist nur noch der Block fürs Notiz-Schema (`RechenTabelleBlock`,
  `rechenTabelleLaden`); das Raster liegt in `RechenTabelleGitter.tsx` (`Gitter`). Der `Platzhalter` baut Zeilen ×
  Spalten aus denselben Bausteinen, die Leiste mit denselben Knöpfen (ohne Wirkung) und die Hilfezeile — gemessen gleich
  hoch (m502 C3: 201,1 px vorher wie nachher), die Notiz springt nicht.
- **Punkte:** `components/PunkteSpaet.tsx` (neu) mit `PunkteMarkenSpaet` (Board, sobald eine Karte Punkte trägt) und
  `PunkteLeisteSpaet` (App, sobald `punkteModus()` an ist); `lib/punkte.ts` bleibt im Start (Dock, Abgleich).
- **Nachschlagen:** `LADER.nachschlagen` + `Nachschlagen()` über `BeiBedarf` (M446-Muster) in App.tsx.
- **Handschrift:** `DrawingLayer.tsx` lädt `lib/handschriftStruktur.ts` in `schriftErkennen` bzw.
  `handschriftUebernehmen` (`strukturLaden`, Modul-Merker `struktur`); der Vorschlag zeigt Textarten erst, wenn die
  Erkennung fertig ist — dann ist der Teil da.
- **Bild-Texterkennung:** App.tsx lädt `lib/textInBildern.ts` nach `BILDTEXT_NACH_MS` (4 s) und startet ihn mit
  `bildTextStarten(0)` (neuer Parameter `verzugMs`, Vorgabe 4000) — die erste Runde liegt wie vorher bei rund 4 s.
- **Leerlauf:** `imLeerlaufVorladen` holt zusätzlich Rechen-Tabelle, Kommentar-Ebene, Punkte, die drei Live-Anzeigen,
  Handschrift-Struktur und Gehirn (Nachschlagen über `LADER`, Live-Logik über `gastSync`).
- Portable Einzeldatei (`build:single`) packt alles in eine Datei wie bisher; geprüft per file:// ohne Netz.

## Prüfreihe m502
A Start unter der Grenze, keiner der neuen Teile im Start, alle als eigene Datei im Build. B (Datensparmodus, also ohne
Leerlauf-Vorladen) Punkte-Modus → Leiste und Marke, ⋯ → Nachschlagen, ⋯ → Kommentar → Pin und gespeichert; ohne
Live-Kanal kein Live-Team. C Board mit Rechen-Tabelle (Raster künstlich 1,5 s verzögert), Kommentar und Punkten:
Platzhalter, gleiche Höhe, danach rechnet die Tabelle; Pin und Marke stehen. D Leerlauf holt alles nach. Das Live-Team
selbst prüfen die Live-Reihen (m364–m366, m372, m377, m387, m414).

## Grenzen / offen
- Weitere Kandidaten, falls wieder Luft gebraucht wird: `EbenenMenu` (~19 KB Quelltext, ⋯-Menüs im Navigator — Inhalt
  des Menüs nachladen, Knopf bleibt), `termineZentrale` (~9 KB, Erinnerung 2,5 s nach dem Start), `einladung` (~5 KB,
  Token-Teil muss im Start bleiben), `htmlStore` (~17 KB, NoteCard braucht `loadAppState`).
- Bewusst im Start: `boardVersionen` (seine Haken müssen vor der ersten Änderung stehen), Sync-Initialisierung,
  Zeichen-Ebene, Tastenkürzel, Grundkarten (siehe M483).
