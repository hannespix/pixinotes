# M529 — Konto-Abgleich und Speicher: nichts überschreibt, nichts fehlt dauerhaft
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m529-konto-speicher.mjs` (Port 5529) · Datum: 2026-11-25

## Warum
Umsetzungsrunde nach dem Audit. Offene Punkte aus M524 (Konto-Rücksetzer), M522 (O1, O2) und M525, dazu ein Befund
des Besitzers aus dieser Runde: In der Konsole schlugen Abrufe `…/storage/v1/object/authenticated/pixinotes/<Nutzer>/
datei-…` mit HTTP 400 fehl — die Objekte gab es im Dateispeicher nicht. Das Auslagern eingebetteter Bilder (ursprünglich
Punkt 2a dieses Pakets) übernimmt M532.

## Was
- **Vorbedingung beim kartenweisen Schreiben.** Ändern zwei Geräte dieselbe Karte im selben Augenblick, schreibt das
  Konto nur noch auf dem Stand, den das Gerät kennt. Sonst liest das Gerät neu, führt je Feld zusammen und schreibt
  erneut: Verschiebt eines die Karte und ändert das andere ihren Text, bleibt beides. Vorher gewann die später
  eintreffende ganze Karte (M524, „Grenzen"). Braucht die Migration unten; ohne sie bleibt der bisherige Weg.
- **Fehlende Dateien.** Ein Gerät, dem der Inhalt einer Datei-Karte oder eines Tools fehlt und der auch im Konto fehlt,
  fragt nicht mehr bei jedem Aufbau der Karte und jedem Abgleich (2 min, 10 min, 1 h, dann alle 6 h — sofort wieder,
  wenn ein anderes Gerät sie nachgereicht hat). Die Karte sagt es: „fehlt auf diesem Gerät und im Konto. Öffne
  PixiNotes auf dem Gerät, auf dem die App angelegt wurde …". Das Gerät, das den Inhalt hat, lädt ihn von selbst
  hoch — nach dem Start (einmal je Sitzung, danach alle 6 h) und gleich, wenn ein Inhalt nach seiner Karte ankommt.
  Beim Kopieren eines Boards wird ein Inhalt, der nur im Konto liegt, von dort mitgenommen.
- **Speicherstand eigener Tools** (ihr „localStorage") reist mit dem PixiNotes-Konto. Das zweite Gerät startet das
  Tool mit demselben Stand. Hochgeladen wird nur bei Änderung, höchstens alle zehn Sekunden je Tool.
- **Speicher aufräumen** (Einstellungen → Daten → Konto): zeigt Dateien im Konto, auf die keine Karte mehr verweist
  (Anzahl, Größe), löscht erst nach Bestätigung. Jüngeres als 24 Stunden bleibt, Unbekanntes auch.
- **Ring der Server-Stände** (`konto:basen`) wird nicht mehr bei jedem Lesen und Schreiben ganz neu geschrieben.
- **M522 O1:** Nach „Alles leeren" und dem Einspielen einer Gesamt-Sicherung („ersetzen") bleibt kein leeres
  „Mein Board" stehen. **M522 O2:** Ein unlesbarer gespeicherter Stand wird vor dem ersten Überschreiben als
  Rettungskopie aufgehoben (IndexedDB, Hinweis, unter Einstellungen → Daten herunterladen oder verwerfen).

## Befund „HTTP 400 auf datei-…" — Ursache
Nachgestellt mit dem Konto-Nachbau (m529 F) und am Quelltext:
1. **Kein Gerät lud eine verlorene Datei je wieder hoch.** Steht eine Datei in `umgebung.json`, gilt sie auf jedem Gerät
   als „liegt im Konto" (`Kenn.dateien`) — auch wenn das Objekt fehlt. Das Gerät, das sie noch hat, lädt nur Dateien
   hoch, die das Konto NICHT nennt. Einmal verloren, für immer verloren; jedes andere Gerät fragte bei jedem Abgleich
   (`kontoLesen`) und bei jedem Aufbau der Karte (`kontoDateiNachladen`, auch nach jedem `pixinotes:dateien-da`) neu.
2. **Inhalte, die nach ihren Karten ankommen, gingen erst mit der nächsten Änderung hinaus.** Beim Import einer
   Board-Datei (`boardDateienUebernehmen`) und beim Kopieren (`anhaengeKopieren`) stehen die Karten sofort im Stand,
   die Inhalte erst danach in der Geräte-Ablage. Ein Schreiben dazwischen nimmt die Karte ohne Inhalt mit. Ändert dieses
   Gerät danach nichts mehr (oder wird es geschlossen), kommt der Inhalt nie ins Konto — die anderen Geräte fragen
   vergeblich. Die vier fehlenden Kennungen beim Besitzer enden alle gleich (`…wjq5`: in derselben Millisekunde
   angelegt) — sie stammen aus EINEM solchen Vorgang (Import oder Kopie eines Boards mit Tools).
3. **Kopie eines Boards auf einem Gerät, das einen Inhalt nur im Konto hatte:** `anhaengeKopieren` kopierte nur die
   Geräte-Ablage; was dort fehlte, fehlte der Kopie überall.
Welche der drei Wege die vier Dateien beim Besitzer verloren haben, lässt sich ohne Lesen seiner Daten nicht sagen; alle
drei sind geschlossen. Liegen die Inhalte noch auf einem seiner Geräte, lädt es sie beim nächsten Öffnen hoch.

## Wie (Architektur)
- `lib/kontoSync.ts → boardAendern(…, wenn)`: schickt `p_wenn_umgebung` (Besitzer: `Kenn.etag`) bzw. `p_wenn_version`
  (Gast mit Konto: Version der Board-Zeile). 404 mit diesen Parametern → `vorbedingung = 'nein'` und derselbe Aufruf
  ohne sie (die Funktion selbst gilt nicht als fehlend). 400 „vorbedingung" → `VorbedingungFehler` → der bestehende
  Weg in `kontoWriteRoh` (lesen, `einarbeiten` je Feld, neu schreiben). `'ja'` erst mit `geprueft: true` in der
  Antwort; dann entfällt der Mini-Abruf direkt vor dem Schreiben (der Server prüft selbst).
- `lib/kontoSync.ts → fehlt…`: `konto:fehlt` (IndexedDB) je Kennung `{ seit, naechster, n }`; `kontoDateiNachladen` und
  `kontoLesen` fragen nur, wenn fällig; `Umgebung.dateien[id].am` (Zeit des Hochladens) macht eine gemerkte Datei sofort
  wieder fällig. `kontoDateiFehlt(id)` + `FEHLT_EREIGNIS` für die Karte (`HtmlAppCard`).
- `lib/kontoSync.ts → dateienNachreichen(erzwingen, nurUngenannte)`: (i) eigene Karten mit Inhalt hier, die das Konto
  nicht nennt; (ii) genannte, deren Objekt fehlt — Verzeichnis des Dateispeichers (`kontoObjekte`, eine Anfrage), Zeilen
  aus der Zeit vor M329, dann je Verdacht `object/info`. Gefundenes wird wie ein hier ersetztes Tool verbucht
  (`Kenn.ersetzt`, M524) — nicht geholt, beim nächsten Schreiben hochgeladen. Läuft 20 s nach dem Start, alle 6 h im
  Takt und (nur Teil i, ohne Netz) 3 s nach `pixinotes:dateien-da`.
- `lib/anhangKopie.ts`: fehlt der Inhalt hier, `kontoDateiHolen(alt)` → `file:<neu>`. Live-Tools reisen nicht mit.
- `lib/kontoZustand.ts` (nachgeladen): `zustandMelden(id, data)` aus dem Speicher-Kanal der Karte → nach ≥ 1,5 s,
  höchstens alle 10 s, nur bei geänderter Prüfsumme → `<Nutzer>/zustand-<id>`. `zustandHolen(id, hierAm)` beim Start
  des Tools (`freshestState`): nur wenn das Verzeichnis ein solches Objekt nennt (keine 400 für Tools ohne Stand), nur
  wenn neuer; geprüft mit `toolSpeicherVonAussen` (`lib/sicher.ts`: nur Texte, höchstens 5 MB). Nur eigene Boards.
- `lib/kontoAufraeumen.ts` + `components/KontoAufraeumen.tsx`: `speicherPruefen()` = Verzeichnis gegen Verweise
  (`kontoVerweise()`: Kennungen aller Karten in den Board-Zeilen des Kontos und Dateien der Umgebung; dazu Karten dieses
  Geräts, Vorlagen, Anhänge von Versionen). Nur `datei-…`/`zustand-…`, älter als 24 h. `speicherAufraeumen()` prüft
  vor dem Löschen noch einmal frisch.
- `lib/kontoSync.ts → basenMerken/basisFinden/basisIstDrin`: Verzeichnis `konto:basen` = je Stand Kennung, Marke,
  „eingearbeitet", Board-Schlüssel und Fingerabdrücke; je Board-Fassung ein Eintrag `konto:bb:<Board>:<n>`. Gleiches
  Objekt (WeakMap) oder gleicher Fingerabdruck → derselbe Schlüssel, nichts geschrieben. Nicht mehr genannte Fassungen
  werden gelöscht. Das alte Format wird beim ersten Lesen einmal aufgeteilt. `window.pixinotesKontoBasen` zählt.
- `store/speicher.ts → getItem`: unlesbarer Text → `lib/rettung.ts` (IndexedDB `pixinotes:rettung`, die letzten drei),
  `flushPersist` wartet, bis die Kopie liegt. `components/RettungsKopie.tsx` unter Einstellungen → Daten.
- `lib/sicherung.ts → sicherungEinspielen('ersetzen')`, Gesamt-Sicherung: `leeresStartboard` fällt weg samt leerem
  Start-Bereich; ist es offen, wird ein Board der Sicherung geöffnet.

## Migration anwenden
**Datei:** `supabase/migrations/20261125100000_board_aendern_vorbedingung.sql`

**Was sie tut:** ersetzt `public.board_aendern(uuid, text, json, text)` durch
`public.board_aendern(uuid, text, json, text, bigint default null, bigint default null)` — mit den optionalen Parametern
`p_wenn_umgebung` (Version der Umgebung des Besitzers) und `p_wenn_version` (Version der Board-Zeile). Passt eine
genannte Version nicht mehr, schreibt sie nichts und meldet `vorbedingung` (P0001). Die Antwort trägt zusätzlich
`geprueft: true`. Rechte (Besitzer, Freigabe „bearbeiten"), Prüfung des Inhalts (M388-Auslöser), Gast-Rechte (M391) und
die Sperr-Reihenfolge Board → Umgebung bleiben. Aufrufe älterer App-Stände (vier Parameter) laufen unverändert.

**Einspielen:** Supabase Dashboard → SQL Editor → Inhalt ausführen (wiederholbar). Die App braucht sie nicht: ohne sie
antwortet PostgREST auf die neuen Parameter mit 404, die App merkt sich das bis zum nächsten Laden und schreibt wie
bisher (mit Mini-Abruf davor).

**Rückweg:** `drop function if exists public.board_aendern(uuid, text, json, text, bigint, bigint);` und danach aus
`20261115100000_board_aendern.sql` den Abschnitt `create or replace function public.board_aendern …` samt
`revoke`/`grant` erneut ausführen. Die App fällt dann von selbst auf den alten Weg zurück.

Für Speicherstände der Tools, Aufräumen und Nachreichen ist **keine** Migration nötig: Sie nutzen den bestehenden
Dateispeicher (Bucket `pixinotes`, eigener Ordner, bestehende Regeln für Lesen, Anlegen, Ändern, Löschen und Auflisten).

## Prüfreihe
`pruefungen/m529-konto-speicher.mjs` (Port 5529), Gerüst aus m524 (nachgebautes Supabase mit Steuerung). Der Nachbau
beherrscht `board_aendern` mit Migration (Vorbedingung, `geprueft`) und ohne (404 auf unbekannte Parameter), das
Verzeichnis (`object/list`) und die Auskunft (`object/info`) des Dateispeichers und antwortet auf fehlende Objekte mit
400 wie Supabase. Abschnitte V (Vorbedingung, mit und ohne Migration), F (fehlende Dateien), Z (Tool-Speicherstand),
A (Aufräumen), B (Ring), O (O1 über ein Labor wie m522, O2 im echten Build).

## Messen
Ring der Server-Stände, Board der Gestalt des Besitzers (35 Karten, 16 Tools, 8 Bilder): vorher je Lesen und Schreiben
der ganze Ring (sechs Stände, mehrere MB); jetzt je Schreibvorgang das eine geänderte Board und das kleine Verzeichnis.

## Grenzen / offen
- **Eingebettete Bilder** in der Board-Zeile und der Lese-Weg „nur geänderte Karten seit Version n": an M532 abgegeben
  (Bilder werden dort Dateien und reisen über den Datei-Weg). Ein Lese-Weg je Karte bräuchte je Karte eine Version
  auf dem Server (eigene Tabelle oder Protokoll) — nach M532 ist die Board-Zeile ohne Bilder klein; ob er sich dann
  noch lohnt, zeigt erst eine Messung danach.
- Ob die Datei-Liste des Dateispeichers (`object/list`, `object/info`) auf dem echten Projekt genau so antwortet wie im
  Nachbau, ließ sich hier nicht prüfen (am Projekt nichts schreiben/lesen). Antwortet sie nicht, bietet „Speicher
  aufräumen" nichts an und das Nachreichen findet nur Teil (i) — nichts wird gelöscht oder doppelt hochgeladen, ohne
  dass eine Datei wirklich fehlt (jeder Verdacht wird einzeln nachgesehen).
- Der Basis-Stand je Weg aus M311 (`basisMerken('konto', …)`) ist weiter ein ganzer Stand je Schreibvorgang.
- Speicherstände von Tools in GETEILTEN Boards reisen nicht (sie gehören dem Konto des Besitzers).
