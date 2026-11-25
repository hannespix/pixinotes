# M532 — Browser-Speicher voll: Bilder liegen im Datei-Speicher, nichts geht verloren
PR: siehe Merge-Titel „… (M532)" · Prüfreihe: `pruefungen/m532-speicher-voll.mjs` (Port 5532) · Datum: 2026-11-25

## Warum
Meldung des Besitzers: Beim Konto-Abgleich erscheint „Der Stand aus dem Konto konnte nicht gespeichert werden
(Browser-Speicher voll?)". Ursache: Der ganze App-Stand liegt in **einem** localStorage-Eintrag (`pixinotes-board`),
und Browser geben einer Herkunft dafür rund 5 Mio. Zeichen. Eingebettete Bilder (Bild-Karten mit `data:`-URL in
`data.src`, beim Besitzer z. B. acht SVG-Grafiken zu je rund 80 000 Zeichen auf einem Board, dazu weitere Boards)
steckten darin. Ist der Eintrag voll, scheitert **jedes** Speichern: Der Stand lebt nur noch im Arbeitsspeicher, beim
Neuladen ist alles seit dem letzten gelungenen Speichern weg. Der Abgleich bricht ab (`fremdStandEinarbeiten` →
`flushPersist()` → `'fehler'`), `autoPush` versucht es alle 3 s erfolglos.

Nachgestellt (Prüfreihe gegen den Build vor M532, localStorage-Attrappe mit kleiner Grenze): A9 „nach dem Neuladen
fehlen die zuletzt eingefügten Bilder" (9 statt 11), C2 genau die gemeldete Meldung „Abgebrochen: Der Stand aus dem
Konto konnte nicht gespeichert werden (Browser-Speicher voll?)", B1 „von drei eingelesenen Boards steht eins im
Speicher". Mit dem Export des gemeldeten Boards (nur lokal, nicht im Repository; acht SVG-Bilder, zusammen
0,64 Mio. Zeichen) neunmal eingelesen, mit der echten Grenze von Chromium: vorher standen nach dem Neuladen 7 von 9
Boards da (Stand 4,66 Mio. Zeichen, Hinweis „Speicher voll"), mit M532 alle 9 mit allen 72 Bildern (Stand
0,26 Mio. Zeichen, kein Hinweis).

## Was der Nutzer merkt
- Bilder (und jede andere große eingebettete `data:`-URL ab 10 000 Zeichen, auch Bilder in Notizen und kleine
  Anhänge) liegen im **Datei-Speicher des Geräts** (IndexedDB), wie schon Anhänge und eigene Tools. Der gespeicherte
  Stand trägt nur noch einen kurzen Verweis; er schrumpft beim Besitzer von Megabyte auf wenige Kilobyte je Board.
- Vorhandene Stände ziehen **von selbst** um: beim ersten Start im Leerlauf, ein Bild nach dem anderen.
- Export, Sicherung (`.pixinotes`), `.pixiboard.json`, Teilen per Link, Präsentation, Bild-Export, Kopieren und der
  Abgleich (Konto, Ordner, WebDAV, Team-Ordner) tragen weiter das **ganze Bild** — Geräte mit älterem Programmstand
  merken keinen Unterschied.
- Ist der Speicher trotzdem voll (sehr viel Text), sagt der Hinweis das ausdrücklich und nennt den Ausweg:
  Einstellungen → Daten → „Alles sichern", danach nicht mehr gebrauchte Boards löschen. Der Abgleich unterscheidet
  „voll" von „Browser lässt nicht schreiben" und von „konnte nicht eingearbeitet werden" (vorher immer „voll?").

### Was der Besitzer jetzt tun kann
Nach dem Update **einmal neu laden** (auf jedem Gerät). Die Bilder ziehen im Hintergrund um; danach gelingt das
Speichern wieder, und der Abgleich läuft. Was vor dem Update nur im Arbeitsspeicher stand und nie gespeichert wurde,
liegt — wenn das Konto es schon hat — wieder im Konto und kommt mit dem nächsten Abgleich zurück. Zur Sicherheit vor
dem Neuladen eines Fensters mit ungespeicherter Arbeit: Einstellungen → Daten → „Alles sichern".

## Wie (Architektur)
- **`src/store/speicher.ts`** (Start-Paket): Alle Texte (`einzeln`, `objektText`, `speicherText`, Prüfbetrieb
  `vollText`) laufen durch `ersetzer`. Bis die Ablage geladen ist, ist das ein winziger Wächter: Trifft er eine
  `data:`-URL ab `AUSLAGERN_AB` (10 000) Zeichen, lädt er `ablageIdb.ts` (und damit `ablage.ts`) nach; die meldet sich
  mit `ablageAnmelden` an, setzt ihren Ersetzer ein, verwirft das Text-Gedächtnis (M525) und schreibt einmal neu. So
  kostet M532 das Start-Paket rund 1 KB; zum Ausgleich lädt die einmalige Umbenennung alter Emoji-Namen (M397,
  `store/ohneEmoji.ts`) über dasselbe Modul nach — und nur, wenn überhaupt ein Name einen Vorsatz trägt
  (`alteNamenOhneEmoji` in `start.ts`). Unterm Strich bleibt das Start-Paket gleich groß (m502: 2 064 885 B).
  `speicherAblage.getItem` ruft `nachDemLaden(roh)`: Stehen Verweise im Text (oder alte große data-URLs), lädt die
  Ablage nach; `standBereit()` ist das Versprechen dazu, und **`main.tsx` zeichnet erst danach** (und erst danach
  `alteNamenOhneEmoji`) — keine Karte ohne Bild, kein Abgleich/Export, der einen Verweis sieht. `adoptPersistedState`
  (Mitlese-Fenster) setzt Verweise ebenso ein (`mitInhalten`), bevor es übernimmt. **Der Store hält nie einen
  Verweis** — deshalb ändern sich Export, Teilen und Abgleich nicht.
- **`src/store/ablage.ts`** (nachgeladen): `ablageErsetzer` macht aus einer großen `data:`-URL den Verweis
  `pixinotes-ablage:<prüfsumme>-<prüfsumme>-<länge>` (`verweisVon`, cyrb53 mit zwei Startwerten, rund 106 Bit plus
  Länge) — **aber nur, wenn ihr Inhalt nachweislich in der IndexedDB liegt** (`A.gesichert`). Sonst bleibt sie im Text
  und wird vorgemerkt (`A.offen`), `planen` sichert im Leerlauf (`requestIdleCallback`).
- **`src/store/ablageIdb.ts`** (nachgeladen): `abarbeiten` sichert eins nach dem anderen (`inhaltSichern`,
  Schreibtransaktion mit `durability: 'strict'`) und führt das Gesicherte **erst am Ende, gemeinsam mit dem
  Neuschreiben** als gesichert (sonst passte ein dazwischen geprüfter, gemerkter Text nicht mehr zum Stand — m525 S9
  fing genau das). `nachDemLaden` (Verweise einsetzen per `runDerived`: kein Hochladen, kein Rückgängig-Schritt;
  alter Stand: im Leerlauf `vormerken`), `mitInhalten`, `inhalteLaden`, `verweiseEinsetzen` (Unverändertes bleibt
  dasselbe Objekt), `vorab`. Dieselbe Datenbank wie `lib/syncFolder.ts` (`pixinotes-sync`, Tabelle `kv`), Schlüssel =
  der Verweis. `navigator.storage.persist()` wird einmal angefragt, sobald etwas in der Ablage liegt.
- **`ablageVorab(wert)`** (speicher.ts): Ein Stand von außen wird vor dem Übernehmen in die Ablage gelegt, sonst
  scheiterte schon das erste Speichern nach dem Einarbeiten. Aufgerufen in `fremdStandEinarbeiten` (Konto, Ordner,
  WebDAV), `projectSync` (Team-Ordner: Beitreten, Prüfen) und den Lade-Knöpfen in `Settings.tsx`.
- **Meldung:** `flushPersist` merkt den Grund (`QuotaExceededError` → `voll`, sonst `anderer`, `letzterFehler`);
  `speicherFehlerText()` in `kontoSync.ts` baut daraus den Satz (drei Stellen). Der allgemeine Hinweis bei vollem
  Speicher (`pixinotes:quota` in `App.tsx`) nennt „Alles sichern".

## Grenzen / offen
- **Aufräumen** verwaister Einträge `pixinotes-ablage:*` gibt es noch nicht (ein gelöschtes Bild bleibt in der
  Ablage). Gleiche Bilder liegen nur einmal (Prüfsumme). Aufräumen bräuchte die Sicht aller Fenster und des Verlaufs.
- **Älterer Programmstand auf demselben Gerät** (eine alte portable Datei unter `file://`, eine Seite aus dem
  Offline-Cache) kennt die Verweise nicht und zeigt dort kein Bild; schreibt er, bleibt der Verweis stehen (kein
  Verlust auf dem Gerät). Lädt er über das Konto hoch, kommen bei anderen Geräten Verweise statt Bilder an — nur dieser
  seltene Fall (alte Fassung offen **und** Abgleich) ist nicht abgedeckt.
- `canEmbed` (lib/nodes.ts) rechnet weiter mit dem Stand im Arbeitsspeicher (4 Mio. Zeichen): sehr viele Bilder
  führen dort wie bisher zur Datei-Karte (Geräte-Ablage) statt zur Bild-Karte — kein Verlust, nur die alte Bremse.
- Der Abgleich trägt die Bilder weiter im Board-Stand (nicht über den Datei-Weg); den Datenverkehr zu senken wäre ein
  eigener Schritt (Verweise im Konto-Format brauchen eine Übergangszeit für ältere Geräte).
