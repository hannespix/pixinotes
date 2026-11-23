# M473 — Kalender korrekt: Serientermine, Zeitzonen, Token-Erneuerung
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m473-kalender-korrekt.mjs` (Port 5473) · Datum: 2026-11-23

## Warum
Die offenen Punkte aus M471: Serientermine aus ICS-Abos standen nur an ihrem ersten Tag, Zeiten mit `TZID` galten als
Wandzeit (09:00 New York stand hier um 09:00), und ein abgelaufenes Google-Token legte den Hintergrund-Abruf still —
die Erinnerung lief dann mit alten Google-Terminen weiter, ohne dass jemand es merkte.

## Was
- **Serientermine** aus ICS-Dateien und -Abos stehen an jedem ihrer Tage: täglich, wöchentlich, monatlich, jährlich,
  mit `INTERVAL`, `COUNT`, `UNTIL`, `BYDAY` (auch „1MO", „-1FR"), `BYMONTHDAY` (auch „-1"), `BYMONTH`, `BYSETPOS`.
  Ausgelassene Termine (`EXDATE`) fehlen, verschobene (`RECURRENCE-ID`) stehen am neuen Tag, abgesagte
  (`STATUS:CANCELLED`) gar nicht. In der Kalender-Karte, in „Termine heute und morgen" und in der Erinnerung.
- **Zeitzonen:** Zeiten mit `TZID` erscheinen in der Ortszeit des Geräts — IANA-Namen („America/New_York"),
  Windows-Namen aus Outlook („W. Europe Standard Time", „Eastern Standard Time") und Outlooks Anzeigenamen
  („(UTC+01:00) Amsterdam, Berlin, …"). Die Sommerzeit-Umstellung stimmt: eine Serie um 09:00 New York steht in
  Berlin um 15:00, in den zwei Wochen zwischen US- und EU-Umstellung um 14:00; ein Termin über die Umstellung behält
  seine echte Dauer. Unbekannte Zonen bleiben Wandzeit wie bisher.
- **Token im Hintergrund:** Der stille Abruf (mit „Vorher erinnern") erneuert ein abgelaufenes Google-Token wie die
  Kalender-Karte (GIS ohne Abfrage, `prompt: ''`), Outlook wie bisher über das Refresh-Token. Klappt es nicht, steht in
  der Zentrale leise „Google: Anmeldung abgelaufen – die Termine sind womöglich nicht aktuell." mit
  **„Erneut anmelden"** (mit Klick darf Google sein Fenster öffnen); der nächste gelungene Abruf nimmt den Hinweis
  zurück. Keine Fehlermeldung als Toast.

## Wie (Architektur)
- `src/lib/icsSerie.ts` (neu, ohne Abhängigkeiten, nachgeladen): `zoneAus(tzid)` (Windows-Tabelle
  `WINDOWS_ZONEN`, Anzeigenamen `ANZEIGE_ZONEN`, Präfixe wie „/mozilla.org/…/Europe/Berlin", Prüfung über
  `Intl.DateTimeFormat`), `wandZuMs(wand, tz)` (zwei Durchgänge über den Versatz; Lücke im Frühjahr rutscht nach
  vorn, doppelte Stunde im Herbst nimmt die erste), `msZuWand`, `ortsZeitAus`, `ereignisAus()` (die Ende-Regeln aus
  M388/M471 an EINER Stelle), `serieAufloesen(ev, von, bis)` und `icsImFenster(events, von, bis)`. VTIMEZONE-Blöcke
  werden bewusst nicht gelesen — Intl kennt die Regeln.
- Auflösung nur für das Fenster: Wandzeit der Serien-Zone, Perioden je FREQ; ohne `COUNT` springt `sprung()` bis kurz vor
  das Fenster (eine tägliche Serie seit 1990 kostet nichts). Grenzen `MAX_PERIODEN` = 5000 Perioden, `MAX_TERMINE` = 400
  Termine je Serie. `DTSTART` zählt immer als erster Termin, `COUNT` zählt Ausnahmen mit (RFC 5545). Unbekanntes
  (`FREQ=HOURLY`, `BYWEEKNO`, `BYYEARDAY`, `BYHOUR` …) → nur der erste Termin wie vor M473.
- `src/lib/ics.ts`: `IcsEvent.serie` = `{ rrule, tz?, beginn (Wandzeit der Zone), dauer (Minuten bzw. Tage), aus? }`;
  `start`/`startTime` nennen weiter den ersten Termin (Fallback für alte Wege). `parseIcs` liest `TZID` (auch in
  Anführungszeichen mit Doppelpunkt — `teile()` trennt außerhalb von Anführungszeichen), `RRULE`, `EXDATE`
  (mehrere, auch mit anderer Zone), `RECURRENCE-ID`, `STATUS`, `DURATION`. Ersetzte Termine gehen als Ausnahme in
  `serie.aus` ihrer Serie (gleiche UID). `mergeEvents`: der neue Stand gewinnt ganz; ältere Einträge mit einer UID
  des neuen Stands, die er nicht mehr enthält, entfallen (zurückgenommene Verschiebung, Tag vor der Zonen-Umrechnung).
- `src/components/nodes/CalendarCard.tsx`: `fenster()` (gleich für Konto-Abruf und Serien), `icsSichtbar` =
  `icsImFenster(icsEvents, fensterVon, fensterBis)`.
- `src/lib/termineZentrale.ts`: `ausKarten` löst Serien je Tag auf; das Modul `icsSerie` lädt dort per `import()`
  nach (`serien()`, meldet danach `TERMINE_EREIGNIS`), `serienAusstehend(boards)` lässt die Erinnerung in `App.tsx`
  warten (Muster `fristenAusstehend`). `src/lib/importFiles.ts` lädt `ics.ts` erst beim Ablegen einer .ics-Datei —
  so bleibt der Start unter der Grenze von m446.
- `src/lib/calAccounts.ts`: `refreshGoogle` mit `error_callback` und Zeitlimit `GOOGLE_ERNEUERN_MS` (20 s; vorher hing
  ein geblocktes Fenster für immer). `fetchAccountEvents` erneuert in beiden Modi; `erneuert(konto, f)` sammelt
  gescheiterte Erneuerungen, `hinweiseFuehren()` schreibt `localStorage['pixinotes:konto-hinweis']` (nur
  `["google"]`/`["ms"]`, nie ein Token): gesetzt nur vom stillen Abruf, entfernt, sobald das Konto antwortet oder
  getrennt wird. `kontoHinweise()` liest.
- `src/components/TermineAbschnitt.tsx`: Zeile `.th-termine-hinweis` mit Knopf `.th-termine-erneuern` (CSS im
  M469-Block).
- `werkzeug/sprache-ernten.mjs`: `lib/icsSerie.ts` ohne Oberflächentexte (Zonennamen).

## Grenzen / offen
- Der Export über einen Zeitraum nimmt Serien nur im gerade sichtbaren Fenster mit (wie bisher alles Externe).
- `BYHOUR`/`BYMINUTE`, `BYWEEKNO`, `BYYEARDAY` und stündliche Serien werden nicht aufgelöst (nur der erste Termin).
- Ein Termin mit unbekannter Zone (weder IANA, Windows-Tabelle noch Anzeigename) bleibt Wandzeit.
- Die stille Google-Erneuerung braucht ein Fenster, das der Browser ohne Geste meist blockt — dann hilft der Hinweis;
  echte Hintergrund-Erneuerung bräuchte einen Server (Google gibt Browser-Apps kein Refresh-Token).
