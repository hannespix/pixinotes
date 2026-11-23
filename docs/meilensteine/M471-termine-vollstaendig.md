# M471 — Termine vollständig: Kennung, Ende, Ort; alle Quellen in der Zentrale
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m471-termine-vollstaendig.mjs` (Port 5471) · Datum: 2026-11-23

## Warum
Die offenen Punkte aus M469: Der Konten-Abruf lieferte nur Start und Titel, ein Klick in „Termine heute und morgen"
führte nur zum Tag, eigene Termine der Kalender-Karte und ICS-Abos fehlten, und die Erinnerung kannte nur Termine, die
zuletzt jemand von Hand geholt hatte.

## Was
- **Vollständige Termine:** Zentrale zeigt Beginn–Ende („09:30–10:30") und den Ort; Mehrtägiges steht an jedem Tag
  („bis 25.11." am ersten, „ganztägig" an den folgenden). Ganztägiges steht oben, dann nach Uhrzeit.
- **Alle Quellen:** neben Google und Outlook auch die eigenen Termine aller Kalender-Karten (Kennung „Kalender") und
  ICS-Importe/-Abos („Abo"). Ohne verbundenes Konto erscheint der Abschnitt, sobald heute oder morgen ein solcher
  Termin liegt. Doppel stehen einmal — bevorzugt der Konto-Termin (er hat den Link), fehlender Ort/Ende kommt vom
  Doppel; ein ganztägiger ICS-Eintrag (Import vor M471, ohne Uhrzeit) entfällt neben demselben Titel mit Uhrzeit.
- **Klick öffnet den Termin:** Die Kalender-Karte springt auf den Tag, markiert den Eintrag und zeigt eine kleine Fläche
  mit Datum, Zeit, Ort, Quelle und **„In Outlook öffnen" / „In Google Kalender öffnen"** (neuer Tab). Ein eigener
  Termin öffnet stattdessen seinen Editor; eigene und ICS-Termine führen in ihre eigene Karte. Auch ein Klick auf einen
  Konto- oder ICS-Eintrag direkt in der Karte zeigt jetzt diese Angaben (vorher: nichts).
- **Erinnerung mit Hintergrund-Abruf:** Ist „Vorher erinnern" an, holt die App Heute/Morgen beim Start und im
  5-Minuten-Takt still nach — höchstens alle 15 Minuten, auch über Neuladen hinweg — und erinnert danach an Termine,
  die nur so bekannt wurden. Ohne Erinnerung bleibt es beim Start ohne Netz (m446, m469 A1). Erinnert wird jetzt auch an
  eigene und ICS-Termine mit Uhrzeit.

## Wie (Architektur)
- `src/lib/calAccounts.ts`: `CalAccountEvent` + `id`, `end`, `endDate`, `allDay`, `place`, `link` (Google
  `fields=items(id,summary,start,end,location,htmlLink)`, Graph `$select=id,subject,start,end,isAllDay,location,webLink`).
  Graph jetzt mit `Prefer: outlook.timezone="UTC"`, `msZeit()` rechnet in die Ortszeit des Geräts (vorher fest
  „Europe/Berlin"); ohne Zonenangabe gilt die Wandzeit (alte Prüfreihen). Ganztägiges Ende (exklusiv) → letzter Tag.
  `termFelder()` säubert (Längen, Link nur `https:`). `fetchAccountEvents(…, { still })` erneuert ein abgelaufenes
  Google-Token nicht (kein GIS-Fenster ohne Geste). Zwischenspeicher `pixinotes-cal-termine` = `{ v: 2, stand, tage }`
  (`TERMINE_FASSUNG`); Fassung 1 (ohne `v`) bleibt lesbar, ihr `stand` zählt aber als alt → das nächste Öffnen holt nach.
  Mehrtägiges wird an jedem abgedeckten Tag gemerkt.
- `src/lib/ics.ts`: `parseIcs` liest zusätzlich Uhrzeit (Weltzeit → Ortszeit), Endzeit, `LOCATION`, `UID`
  (0 Uhr bis 0 Uhr bleibt ganztägig, m388 A6). `mergeEvents` ergänzt bestehende Einträge ohne Uhrzeit beim nächsten
  „Abos aktualisieren". Das Raster der Karte bleibt tagesgenau.
- `src/lib/termineZentrale.ts`: `ZentralTermin` mit `quelle` (`google|ms|eigen|ics`), `beginn`, `end`, `place`, `link`,
  `boardId/nodeId/eigenId`; `terminSchluessel()` (gemeinsam mit der Karte; ohne Kennung wie in M469 → alte Merker
  gültig), `ausKonto()`, `terminZeit()`, `termineHeuteMorgen(aufgaben, jetzt, boards)`, `termineZuErinnern(…, boards)`,
  `termineHintergrund()` (Drossel `localStorage['pixinotes:termin-abruf']`, `HINTERGRUND_MS` = 15 min).
- `src/lib/terminMarke.ts`: flüchtige Marke `{ kartenId, termin }` (nur im Speicher, kein Sync/Undo), Ereignis
  `pixinotes-termin-marke`; gilt drei Sekunden bzw. bis zum Schließen.
- `src/components/nodes/CalendarCard.tsx`: Einträge tragen `key`/`termin`; Zustand `markiert`/`detail`; Fläche
  `.cal-termin` (Link über `fremdeWebAdresse` aus `lib/sicher.ts`, `rel="noopener noreferrer"`); markierter Eintrag mit
  `aria-current`.
- `src/components/TermineAbschnitt.tsx`: liest die Boards, setzt die Marke vor dem Sprung, zeigt Ort; `App.tsx` ruft
  im Erinnerungs-Takt `termineHintergrund()` und meldet danach erneut.
- CSS: `.cal-termin*`, `.cal-chip.markiert` bei `.cal-dayedit-foot`; `.th-termin-ort` im M469-Block.

## Grenzen / offen
- Serientermine aus ICS-Abos werden weiter nicht aufgelöst (nur der Starttag, wie bisher in der Karte).
- ICS-Zeiten mit `TZID` gelten als Wandzeit (wie bisher die Tage); nur Weltzeit (`…Z`) wird umgerechnet.
- Ein abgelaufenes Google-Token erneuert der Hintergrund-Abruf nicht — bis zum nächsten Öffnen von Zentrale oder
  Kalender-Karte erinnert die App dann mit den zuletzt gemerkten Google-Terminen.
- Die Kalender-Karte zeigt Konto-Einträge weiter nur am Starttag (die Zentrale an jedem Tag).
