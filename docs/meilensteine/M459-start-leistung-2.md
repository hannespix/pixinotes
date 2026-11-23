# M459 — Start-Leistung Teil 2: Fristen, Rufnummern und Abgleich bei Bedarf
PR: (siehe Merge) · Prüfreihe: `pruefungen/m459-start-leistung-2.mjs` (Port 5459) · Datum: 2026-11-23

## Warum
M446 ließ drei Dinge bewusst im Start (siehe dort „Grenzen / offen"): die Fristen-Erkennung chrono-node, die
Rufnummern-Erkennung libphonenumber-js und den Konto-/Team-Abgleich (kontoSync, gastSync). Alle drei werden auf
einem Board ohne Termin, ohne Rufnummer und ohne Konto nie gebraucht — und das ist der häufigste Start.

## Was
Kein sichtbarer Verhaltenswechsel. Fristen-Chips, Telefon-Chips und tel:-Links erscheinen einen Augenblick nach dem
Board (Text erst ohne Verknüpfung, dann still ergänzt). Mit Konto, als Gast per Link oder mit einem Anmelde-Link in
der Adresse lädt der Abgleich sofort beim Start; meldet man sich später an (Einstellungen, anderes Fenster), in dem
Augenblick. Einladungslinks (`#e=…`) und Kurz-Links (`#l=…`) öffnen wie vorher direkt.

Gemessen mit `dist/`, Board mit einer Notiz „Hallo Welt", Chromium kalt (wie M446):

| | vorher (Stand M456) | nachher (vor / nach Einmischen von M460–M464) |
|---|---|---|
| Start-JS (über die Leitung) | 2,35 MiB (2 465 230 B), 5 Dateien | 2 176 845 B / 2 192 986 B (2,09 MiB), 4 Dateien — −11 % |
| Start-JS gzip (Vite-Angabe) | 784 KB | 699 KB / 708 KB |
| eigener App-Teil (`index`) | 1 004 KB | 852 KB / 868 KB |
| Paket `rufnummer` (libphonenumber) im Start | 137 KB | — (nur bei Text mit ≥ 6 Ziffern) |
| chrono-node im Start | ~55 KB (im `index`) | — (Paket `fristen`, nur bei Text, der ein Datum tragen kann) |
| kontoSync + gastSync + Freigabe-/Link-Dialog im Start | ~90 KB (im `index`) | — (nur mit Konto/Gast-Zugang) |

## Wie (Architektur)
- **Fristen (`lib/dates.ts`):** `fristenLaden()` holt `lib/chronoKern.ts` (nur `de` aus chrono-node — ein
  `import('chrono-node')` brächte alle Sprachen). `detectDates` prüft zuerst `kannDatumSein(text)` (Ziffer,
  Wochentag samt Kürzel, Monat, „heute/morgen/gestern", Zeiteinheit — großzügig, lieber einmal zu oft laden): ohne
  Treffer gibt es nichts zu erkennen, mit Treffer und ohne Bibliothek stößt es das Laden an und liefert vorerst `[]`
  (nicht gemerkt). `useFristenStand()` (useSyncExternalStore) steht in den Abhängigkeiten von `DueChips` und der
  Aufgaben-Zahl in `Tabs.tsx`; `fristenAusstehend()` lässt die Erinnerung in `App.tsx` auf die Erkennung warten.
  Kanban, Zeitplan, Kalender (`Board.tsx` `mitFristen`), Aufgaben-Zentrale (`App.tsx` `LADER.taskhub`) und das
  Board-Briefing laden erst mit ihr — dort ändert sich nichts. `lib/notizTermine.ts` nutzt ebenfalls `chronoKern`.
- **Fristen-Anker (M390, `lib/fristAnker.ts`):** `hatRelativesDatumOderOffen` liefert `null`, solange die Erkennung
  fehlt. `fristAnkerPflegen` behält dann einen Anker zum selben Text und trägt neue nach dem Laden nach
  (`fristAnkerNachLaden` → `fristAnkerNachtragen` im Store). `fristAnkerNachtragen` lädt erst, wenn eine eigene Notiz
  einen möglichen Termin trägt (`blockeMitDatum`) — sonst blieben Anker ungeprüft liegen oder fielen weg.
- **Rufnummern (`lib/rufnummer.ts`, `lib/rufnummerKern.ts`):** `rufnummernFuer(text)` gibt die Bibliothek nur her,
  wenn sie geladen ist; bei ≥ 6 Ziffern stößt es das Laden an (kürzer gilt in `lib/entities.tsx` nie als Nummer).
  `useRufnummernStand()` in `NoteEntityChips` und `EmailCard`. `vcard.ts` `telAdresse` nimmt `rufnummern()`; die
  Kontakt-Karte lädt mit der Erkennung zusammen (`Board.tsx` `KARTEN_LADER.kontakt`).
- **Abgleich (`lib/syncStart.ts`):** `initSyncStart()` ersetzt `initKontoSync()`/`initGastSync()` im App-Start.
  `syncNoetig()` = Konto angemeldet, `#access_token=`/`#error=` in der Adresse, Gast-Einträge (`pixinotes-gast`)
  oder ein Board mit `gastLink`/`geteiltVon`. Sonst lauscht es auf `pixinotes:konto`, `pixinotes:konto-verbunden`,
  `hashchange`, `storage` (anderes Fenster), neue geteilte Boards und schaut alle 10 s nach. `syncLaden()` lädt
  beide Module und startet sie einmal in der alten Reihenfolge. `kontoAnmelden`/`kontoAnmeldenSupabase` rufen
  `initKontoSync()` selbst zuerst — wie früher läuft der Abgleich also schon, wenn die Sitzung gespeichert wird.
  Das Merkzeichen `KONTO_DIRTY_KEY` setzen ohnehin die Ordner- und WebDAV-Zuhörer im Start mit.
- **Leichte Teile im Start:** `lib/kontoSitzung.ts` (`loadKonto`, `kontoLabel`, `kontoIstEigenes`, Typen —
  kontoSync reicht sie weiter) und `lib/liveStand.ts` (Kanäle, Anwesende, Sperren, „wer bin ich", Einladungslink
  des Boards — `ich`, `ichIn`, `teilnehmerVon`, `liveAuf`, `liveSenden`, `sperrenVon`, `einladungVon` …; gastSync
  füllt die Karten und reicht alles weiter). Mauszeiger, Vorführen, Gruppenraum, Spiegel, Punkte, Live-Leiste, QR
  importieren von dort. `lib/einladung.ts` und `lib/linkTeilen.ts` holen kontoSync/gastSync per `syncLaden()` bzw.
  `import()`; `kontoDateiHolen()` (syncStart) lädt den Konto-Teil nur mit PixiNotes-Konto. Der Kurz-Link `#l=` lädt
  `linkTeilen` erst, wenn die Adresse einen trägt.
- **Dialoge:** `components/FreigabeHost.tsx` (Ereignis `FREIGABE_OEFFNEN`, `FreigabeHost`, `FreigabeDialogSpaet`)
  bleibt im Start, der Freigabe-Dialog selbst und der Link-Dialog (`EbenenMenu.tsx`) kommen beim ersten Öffnen.
- **Im Leerlauf** (`imLeerlaufVorladen`, 4 s nach dem Start): zusätzlich Fristen-, Rufnummern-Erkennung, Freigabe-
  Dialog und gastSync (nur geladen, nicht gestartet) — für den Service Worker, damit sie offline da sind.
- **`vite.config.ts` `manualChunks`:** chrono-node → Paket `fristen`, libphonenumber-js → `rufnummer`, und die Weichen
  `lib/chronoKern.ts`/`lib/rufnummerKern.ts` jeweils mit hinein. Ohne das legte Rollup die reine Weiterleitung
  `rufnummerKern` ins Start-Paket (sobald ein zweiter Importeur wie `lib/kontaktAusMail.ts` dazukam) und lud damit
  das ganze `rufnummer`-Paket wieder beim Start.
- **Grenzen der Prüfreihen:** m446 und m459 messen gegen `START_JS_GRENZE` 2 250 000 B (knapp über 2 192 986 B).
  m388/m390 bündeln `lib/dates.ts` direkt und warten vor den Fristen-Prüfungen auf `fristenLaden()`.

## Grenzen / offen
- `vite-plugin-node-polyfills` setzt den Buffer-Ersatz (~67 KB Quelltext) ins Editor-Paket, weil eine Editor-
  Bibliothek (lib0) den Namen `Buffer` erwähnt. Gebraucht wird er nur von msgreader (Outlook-.msg). Ihn global
  abzuschalten (`globals.Buffer`) änderte den Weg von lib0 und eventuell anderer Bibliotheken — eigener Meilenstein.
- Ordner- und WebDAV-Sync (`syncFolder`, `webdav`, ~32 KB) bleiben im Start: ihre Zuhörer setzen die Merkzeichen
  für ungesicherte Änderungen, die jeder spätere Abgleich braucht.
- `calAccounts` (~15 KB) bleibt im Start: `main.tsx` fängt damit die Rückkehr aus der Kalender-Anmeldung ab.
- Die Notiz-Chips erscheinen bei Texten mit Termin/Rufnummer einen Augenblick nach dem Board (lokal wenige ms,
  über das Netz ein Abruf von ~55 bzw. ~140 KB).
