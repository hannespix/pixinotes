# M469 — Termine aus Kalender-Konten in der Aufgaben-Zentrale
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m469-termine-zentrale.mjs` (Port 5469) · Datum: 2026-11-23

## Warum
Offener Punkt aus M466: Termine der verbundenen Kalender-Konten (Google, Outlook) standen nur in der Kalender-Karte.
Wer morgens die Aufgaben-Zentrale öffnet, soll auch sehen, welche Termine heute und morgen anstehen – ohne erst ein
Board mit Kalender-Karte aufzurufen.

## Was
- Ist mindestens ein Kalender-Konto verbunden, zeigt die Zentrale über der Aufgabenliste einen ruhigen Abschnitt
  **„Termine heute und morgen"**: je Tag eine Unterzeile („Heute · Mo., 23.11."), darunter Uhrzeit (oder „ganztägig"),
  Titel und Konto (Google/Outlook). Keine Haken – Termine sind keine Aufgaben.
- Sortierung: ganztägige zuerst, dann nach Uhrzeit, dann nach Titel. Übermorgen und später erscheinen nicht.
- **Nicht doppeln:** Ein Termin in beiden Konten (gleicher Tag, gleiche Uhrzeit, gleicher Titel) steht einmal. Ein Termin,
  dessen Titel am selben Tag schon als Aufgabe in der Zentrale steht (vor allem Vorgänge/Meilensteine aus dem Zeitplan),
  entfällt im Abschnitt – der Vorgang bleibt mit Haken in der Aufgabenliste.
- **Klick** führt zur Kalender-Karte (aktives Board zuerst, sonst das erste Board mit Kalender) und stellt sie auf den
  Tag des Termins (heute = „heute"-Stellung). Gibt es keine Kalender-Karte, legt der Klick eine auf dem aktiven Board an.
- **Erinnerung (Standard aus):** Häkchen „Vorher erinnern" im Abschnittskopf. Dann meldet die App im vorhandenen Takt der
  Zentrale (beim Start und alle 5 Minuten) Termine, die in den nächsten 15 Minuten beginnen – als Meldung und, falls
  erlaubt, als System-Benachrichtigung; je Termin nur einmal.
- Ohne verbundenes Konto: kein Abschnitt, keine Anfrage.

## Wie (Architektur)
- `src/lib/calAccounts.ts`: `fetchAccountEvents` merkt jeden erfolgreichen Abruf zusätzlich in
  `localStorage['pixinotes-cal-termine']` = `{ stand, tage: { 'JJJJ-MM-TT': CalAccountEvent[] } }` (`termineMerken`,
  `gemerkteTermine()`, Ereignis `TERMINE_EREIGNIS`). Abgedeckte Tage ohne Termin stehen als leere Liste („sicher nichts").
  Aufbewahrt wird gestern bis +62 Tage; ein Konto, das beim Abruf fehlschlägt, behält seine gemerkten Termine.
  `disconnect()` nimmt die Termine des Kontos heraus. Wie die Tokens: nie im Board, Sync, Link oder Export.
- `src/lib/termineZentrale.ts`: `termineHeuteMorgen(aufgaben, jetzt)` (Ortszeit über `tagLokal`, Entdoppeln, Sortierung,
  `abgedeckt`, `stand`), `kontoKennung`, `kontoVerbunden` (= `anyAccountConnected`), Einstellung
  `terminErinnerungAn/setTerminErinnerung` (`localStorage['pixinotes-termin-erinnerung']`), `termineZuErinnern(aufgaben,
  jetzt)` mit Merker `localStorage['pixinotes:termin-erinnert']` und Vorlauf `TERMIN_VORLAUF_MIN` = 15.
- `src/components/TermineAbschnitt.tsx`: der Abschnitt; eingehängt in `TaskHub.tsx` vor der Aufgabenliste. Beim Öffnen
  der Zentrale (Nutzer-Aktion) holt er Heute/Morgen über `fetchAccountEvents`, wenn das Gemerkte fehlt oder älter als
  15 Minuten ist. Sprung über `updateNodeDataOnBoard` (in `mutedHistory`, kein Rückgängig-Schritt) + `openBoard`/`focusNode`.
- `src/App.tsx`: der bestehende Erinnerungs-Takt ruft zusätzlich `termineZuErinnern` – liest nur Gemerktes, kein Netz.
  Kommt gleichzeitig eine Aufgaben-Erinnerung, folgt die Termin-Meldung 6 s später.
- CSS: Block „M469" nach `.th-done-empty` in `index.css`. Texte englisch in `src/sprache/en.json`, Hilfe DE/EN (Neu).

## Grenzen / offen
- Erledigt in **M471** (`docs/meilensteine/M471-termine-vollstaendig.md`): Kennung, Ende, Ort und Web-Link im Abruf;
  der Klick öffnet den einzelnen Termin in der Kalender-Karte; eigene Termine und ICS-Abos stehen im Abschnitt;
  mit eingeschalteter Erinnerung holt die App Heute/Morgen gedrosselt im Hintergrund nach.
- Ursprünglich offen (→ M471):
  - Beim App-Start gibt es bewusst keinen Abruf (m446): Erinnerungen kennen nur Termine, die Kalender-Karte oder
    Zentrale zuletzt geholt haben.
  - Abruf-Termine tragen keine Kennung des Kalenders: Der Klick führt zur Kalender-Karte am Tag, nicht zu einem
    einzelnen Termin. Endzeit und Ort liefert der vorhandene Abruf nicht (nur Start und Titel).
  - Eigene Termine der Kalender-Karte und ICS-Abos stehen nicht im Abschnitt (nur Konten).
- Weiter offen: Erinnerung im 5-Minuten-Takt — sie kommt 10–15 Minuten vor Beginn, nicht minutengenau.
