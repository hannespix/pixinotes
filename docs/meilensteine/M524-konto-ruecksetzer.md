# M524 — Konto-Abgleich: Ein älterer Stand setzt die eigene Arbeit nicht mehr zurück
PR: #… · Prüfreihe: `pruefungen/m524-konto-ruecksetzer.mjs` · Datum: 2026-11-25

## Warum
Fehlerbericht des Besitzers: „Ich arbeite, verändere, verschiebe … dann wird plötzlich ein älterer Stand vom Server
abgerufen und meine Änderung zurückgesetzt." Mehrere Geräte desselben Kontos haben dasselbe Board offen; das Board
hat rund 30 Karten, darunter viele eigene HTML-Tools, Bilder, Ideabubbles und Kanban.

Der Fehler ließ sich nachstellen — mit einem nachgebauten Konto-Server, drei Browsern (drei Geräte desselben Kontos)
und einem Board derselben Gestalt. Es war nicht eine Ursache, sondern eine Kette. In Alltagssprache:

1. **Ein Gerät hielt Übernommenes für seine eigene Änderung.** Jedes Gerät merkt sich den „letzten gemeinsamen
   Stand" mit dem Konto. Kam ein neuer Stand vom Server, wurde er eingearbeitet; der gemerkte gemeinsame Stand rückte
   aber erst nach, wenn das Gerät danach auch sein Eigenes hochladen konnte. Scheiterte das (ein anderes Gerät war
   schneller, das Netz hakte, der Server antwortete nicht), blieb der alte gemeinsame Stand stehen. Beim nächsten
   Abgleich sah das Gerät dann: „Diese Karte ist bei mir anders als im gemeinsamen Stand — also habe ICH sie
   geändert." Kam für dieselbe Karte inzwischen eine neuere Lage vom Server, galt das als Konflikt, die hiesige
   (ältere!) Fassung gewann und wurde zurück ins Konto geschrieben. Beim arbeitenden Gerät sprang die Karte auf die
   alte Stelle.
2. **Ideabubbles-Karten gewannen immer als Ganzes.** Für sie galt: „beide Seiten geändert → die hiesige Fassung".
   „Hier geändert" ist eine Karte aber auf jedem Gerät schon dadurch, dass jedes Gerät sie selbst ausmisst. Wer eine
   Bubbles-Karte verschob, bekam sie vom nächsten offenen Gerät an der alten Stelle zurück.
3. **Bei „beide geändert" gewann die ganze Karte, nicht das Feld.** Hatte ein Gerät an einem Bild nur den erkannten
   Text ergänzt (das tut jedes Gerät von selbst) und ein anderes dieselbe Karte verschoben, blieb beim ersten die
   alte Lage — und reiste von dort zurück.
4. **Geräte, die nur offen standen, schrieben von selbst.** Erkannter Text eines Bilds, gemessene Kartenhöhen,
   eingesammelte Tickets entstehen auf jedem Gerät automatisch. Das löste ein Hochladen aus — mit ganzen Karten, samt
   der Lage, wie das ruhende Gerät sie gerade kannte. Zwei ruhende Geräte schrieben sich dieselbe Karte außerdem
   endlos zu, weil derselbe Inhalt bei ihnen nur in anderer Reihenfolge im Speicher lag.
5. **Ein Abgleich dauerte auf diesem Board viele Sekunden, und alles andere wartete dahinter.** Bei jedem Lesen
   wurde der Quelltext jedes HTML-Tools dreimal aus der Geräte-Ablage geladen (16 Tools, 5 MB), nur um zu prüfen, ob
   er noch aktuell ist. Jeder eigene Schreibvorgang zog zusätzlich ein, zwei volle Lesevorgänge des EIGENEN Stands
   nach sich, und jeder weitere Wunsch stellte sich hinten an. Das Hochladen kam minutenlang nicht an die Reihe —
   die anderen Geräte zeigten so lange den alten Stand, und die Fenster für die Fehler 1–3 wurden riesig.
6. **Wer ohne Pause weiterarbeitete, lud nichts hoch.** Hochgeladen wurde erst nach einer Sekunde Ruhe; und solange
   irgendeine fremde Änderung am offenen Board anstand und der Nutzer innerhalb von 2,5 s irgendetwas tat, wartete
   der ganze Abgleich („später") — auch das Hochladen.
7. **Ein hier ersetzter Tool-Quelltext wurde von der älteren Fassung im Konto überschrieben**, wenn vor dem Hochladen
   ein Lesen dazwischenkam (die hiesige Größe wich von der im Konto ab → „veraltet" → alte Fassung geholt).

## Ablauf (der häufigste Weg zum Rücksetzer)
```
Gerät A (arbeitet)          Konto                    Gerät B (steht nur offen)
verschiebt Karte K → X1 ──► K = X1 ────────────────► liest, übernimmt K = X1
                                                     will „Eigenes" nachschreiben (Text eines Bilds,
                                                     Maße, Reihenfolge) — scheitert / kommt zu spät
                                                     gemeinsamer Stand bleibt: K = X0   ◄── Ursache 1
verschiebt Karte K → X2 ──► K = X2 ────────────────► liest: hier X1, gemeinsam X0, Server X2
                                                     „beide geändert" → hiesige Fassung X1 gilt
                            K = X1 ◄──────────────── schreibt K = X1 zurück (ganze Karte, ohne Prüfung)
liest: hier X2 = gemeinsam,
Server X1 → übernimmt X1    ◄── „plötzlich ist meine Änderung weg"
```

## Was
- Verschieben, Ändern, Löschen bleiben, auch wenn mehrere Geräte dasselbe Board offen haben und eines davon gerade
  nicht schreiben kann.
- Ein Gerät, das nur offen steht, schreibt weder Lage noch Inhalt ins Konto.
- Zwei Geräte an derselben Karte: Lage, Größe und jedes Feld des Inhalts werden einzeln entschieden — verschiebt
  eines und ergänzt das andere etwas, bleibt beides. Nur wenn beide DASSELBE Feld verschieden ändern, gilt die
  hiesige Fassung (wie bisher mit Hinweis).
- Wer zügig weiterarbeitet, lädt trotzdem hoch (spätestens nach 6 s), und beim Verschieben und Anordnen arbeitet
  der Abgleich fremde Änderungen ein, ohne auf eine Pause zu warten. Solange in einem Textfeld geschrieben wird,
  wartet er wie bisher.
- Kommt ein Stand vom Server, werden nur die wirklich geänderten Karten ersetzt; alle anderen bleiben dieselben
  Objekte (kein Neuzeichnen des ganzen Boards, laufende Tools laufen weiter).
- Ein Abgleich lädt keine Tool-Quelltexte mehr aus der Ablage, nur um nachzusehen.

## Wie (Architektur)
- `lib/syncFolder.ts → fremdStandEinarbeiten`: Nach dem Einarbeiten ist der gelesene Stand sofort die Basis
  (`basisMerken(weg.source, remote)` VOR `weg.schreiben()`), nicht erst nach geglücktem Schreiben. Gilt für Konto,
  Ordner und WebDAV. — Ursache 1.
- `lib/syncFolder.ts → trifftEingabe`: „später" nur noch, solange der Cursor in einem Textfeld steht (wie bisher),
  wenn eine gerade gezogene Karte selbst anders würde oder das offene Board kommt/geht. Vorher: jede Änderung am
  offenen Board + irgendeine eigene Änderung in 2,5 s — auch beim bloßen Verschieben. — Ursache 6.
- `lib/syncMerge.ts → karteFeldweise`: Karte, die auf beiden Seiten geändert ist, Feld für Feld (Karte selbst und
  `data` eine Ebene tiefer; Lage = ein Feld; Zeitfelder aus `abgleichZeiten.ts` = der spätere Wert; Maße bleiben die
  hiesigen). `vergleichsKarte`: Bubbles-Karten ohne ihre Tabellen vergleichen (die vereinigt `bubblesVereinen`
  weiterhin) — die Sonderregel „Bubbles: hiesige gewinnt" ist weg. — Ursachen 2 und 3.
- `lib/syncMerge.ts → hiesigeObjekte`: Das Ergebnis trägt für alles Unveränderte die hiesigen Objekte (Karten ohne
  Blick auf `measured`); ist alles wie hier, ist es das hiesige Board selbst → `lokalNeu` bleibt false, `geaendert`
  nennt nur wirklich geänderte Boards. `fremdNeu` wird weiter am unveränderten Ergebnis gemessen (sonst schriebe ein
  Ordner-Gerät seine Maße zurück).
- `lib/abgleichZeiten.ts → kanonText`; `bubblesVereinen` und `gastPatch.ts → patchAus` vergleichen nach Inhalt, nicht
  nach Schlüsselfolge. — Ursache 4 (Hin und Her).
- `lib/kontoSync.ts`:
  - Zuhörer am Store: abgeleitete Änderungen (`inDerived()`) lösen allein kein `autoPush` mehr aus. — Ursache 4.
  - `kontoLesen`: Ob ein Tool im Konto eine andere Fassung hat, sagt `Kenn.groessen` (Größen, wie zuletzt im Konto
    gesehen); ob eine Datei hier liegt, sagt `idbHat` (zählt, lädt nicht). `Kenn.ersetzt`: hier ersetzte, noch nicht
    hochgeladene Tools — sie werden nicht geholt und gelten nicht als „im Konto bekannt". — Ursachen 5 und 7.
    Der alte Vergleich (hiesige Größe gegen die im Konto) schlug bei jedem Tool mit Umlauten **dauerhaft** an: Die
    Karte nennt die Länge in Zeichen, die Ablage misst Bytes. Solche Tools wurden bei jedem Lesen auf jedem Gerät
    neu aus dem Dateispeicher geladen — im Lauf mit dem Board des Besitzers 14 von 16 Tools, rund 4,5 MB je
    Lesevorgang und Gerät. `kontoWriteRoh` hält für bekannte Dateien jetzt die Größe vom Hochladen fest
    (`Kenn.groessen`), damit die Zahl in der Umgebung nicht zwischen Zeichen und Bytes wechselt.
  - `checkKontoRemote(erzwingen, nurWennNeu)`: höchstens ein wartender Blick; er prüft in der Warteschlange noch
    einmal per Mini-Abruf, ob es etwas zu holen gibt (das eigene, inzwischen verbuchte Schreiben ist es nicht).
    `autoPush`: nur einer zur Zeit (`pushLaeuft`/`pushNochmal`). — Ursache 5.
  - `kontoWriteRoh`: unmittelbar vor `board_aendern` noch einmal der Mini-Abruf; hat ein anderer geschrieben, erst
    einarbeiten. Das schließt das Fenster nicht ganz (siehe unten), verkleinert es aber von Sekunden auf eine Anfrage.
  - Entprellung mit Obergrenze (`WARTE_HOECHSTENS` = 6 s). — Ursache 6.

## Nachstellen / Prüfreihe
`pruefungen/m524-konto-ruecksetzer.mjs` (Port 5524) baut Supabase nach (konto_dateien, konto_schreiben,
board_aendern, Dateispeicher, Realtime) und hat eine **Steuerung**: je Gerät und Art der Anfrage Antworten verzögern
(vor/nach dem Ausführen), verlieren, mit Fehler beantworten; Realtime je Gerät anhalten; Protokoll jeder Anfrage mit
Zeit und — bei Patches — den geänderten FELDERN je Karte. `--laut` zeigt das Protokoll, `M524_SAAT`/`M524_RUNDEN`
steuern den Dauerlauf, `M524_BOARD=<Export>` nimmt statt des eingebauten Boards eine Board-Datei (nur von Hand).
- L1–L9 Logik (syncMerge/gastPatch per esbuild), E1 Ursache 1, E3 Ursache 7, E4 Ursache 5 (Zurücklesen), E6
  Ursache 6, D Dauerlauf (drei Geräte: eines arbeitet, eines gelegentlich an eigenen Karten, eines ruht/wacht auf;
  verspätete, verlorene, fehlgeschlagene Antworten).
- Gegen den Stand davor (`PN_DIST=<alter Build> M524_SRC=<alter src>`): 20 Prüfpunkte rot, darunter E1.2 „bei Anna
  bleibt die Karte, wo sie sie zuletzt hingelegt hat" und D1 „keine eigene Änderung zurückgesetzt".

## Was wo liegt (PixiNotes-Konto) — und was je Abgleich reist
- **Boards und Umgebung:** Tabelle `konto_dateien`, je Board eine Zeile (`board-<id>.json`, ganzer Inhalt als Text —
  eingebettete Bilder als data-URL stecken mit darin), dazu `umgebung.json`. Geschrieben wird kartenweise
  (`board_aendern`, wenige hundert Byte bis zur Größe der geänderten Karte) oder — bei Namen, Reihenfolge, neuen
  Boards — als ganze Zeile (`konto_schreiben`).
- **Anhänge und Tool-Quelltexte:** Dateispeicher (Bucket `pixinotes`), Pfad `<Nutzer>/datei-<Karten-Id>`, mit
  `x-upsert` — dieselbe Karte überschreibt dasselbe Objekt, es sammeln sich **keine** alten Fassungen je Änderung.
  Hochgeladen wird eine Datei einmal (solange sie in `Kenn.dateien` als bekannt gilt), heruntergeladen einmal je
  Gerät (bis 8 MB sofort, größere beim Öffnen der Karte). Verschwindet die Karte, löscht der nächste Schreibvorgang
  das Objekt (ein Fehler dabei wird übergangen — dann bleibt eine Leiche). Mehr Objekte als Karten entstehen vor
  allem durch **Import einer Board-Datei** (jede Karte bekommt eine neue Kennung, also neue Objekte) und durch
  Kopien von Boards.
- **Lesen:** Ändert ein anderes Gerät eine Karte, liest jedes andere Gerät die **ganze Board-Zeile** neu (hier
  rund 0,65 MB, die größte Zeile im Projekt 2,9 MB) — je Änderung und je Gerät. Das ist der eigentliche
  Ausgangsverkehr im Alltag; M524 ändert daran nur, dass ruhende Geräte keine zusätzlichen Runden mehr auslösen und
  die Tool-Dateien nicht mehr mitreisen.

## Grenzen / offen
- **Entscheidung des Besitzers (Verkehr/Kosten):** Bei jeder fremden Änderung die ganze Board-Zeile zu lesen, kostet
  bei drei offenen Geräten und einem 0,65-MB-Board rund 1,3 MB Ausgangsverkehr je Änderung. Abhilfen wären ein
  Lese-Weg „nur die geänderten Karten seit Version n" (Server-Funktion) oder eingebettete Bilder (data-URL in
  `data.src`) wie Anhänge in den Dateispeicher zu legen. Beides ist ein eigener Meilenstein.
- Leichen im Dateispeicher (Objekte ohne Karte) räumt niemand auf; ein Aufräum-Lauf („Objekte, die keine Umgebung
  mehr nennt") wäre klein, fasst aber Daten beim Betreiber an — nicht ohne Freigabe.
- **Braucht eine Freigabe des Besitzers (Server):** `board_aendern` ersetzt Karten ohne Vorbedingung. Schreiben zwei
  Geräte dieselbe Karte innerhalb derselben Anfrage-Laufzeit, gewinnt die später eintreffende ganze Karte. Sauber
  wäre ein optionaler Parameter `p_wenn_umgebung bigint` (Fehler „vorbedingung", wenn die Umgebung des Besitzers
  inzwischen eine andere Version hat) oder ein Patch je Feld. Das ist eine Migration; hier ist nichts am Server
  geändert. Ohne sie bleibt ein Fenster von einer Anfrage-Laufzeit (vorher: Sekunden bis Minuten).
- Zeit- und Merkfelder (`ocrAm`, Ticket-Zeiten): Der spätere Wert gilt (M472); ein ruhendes Gerät reicht ihn weiter
  nach — als Patch der ganzen Karte, unmittelbar nach einem frischen Lesen. Lage und Inhalt schreibt es nicht.
- Der gemerkte Ring der letzten Server-Stände (`konto:basen`, sechs ganze Stände) wird bei jedem Lesen und Schreiben
  ganz gelesen und geschrieben; bei Boards mit großen eingebetteten Bildern sind das mehrere Megabyte je Abgleich.
  Nicht angefasst (Leistung → M525).
- Was ein HTML-Tool selbst speichert (sein „localStorage"), reist nicht über das Konto — nur der Quelltext. Das war
  schon so und ist kein Teil dieses Fehlers, wirkt auf zwei Geräten aber wie „Stand weg".
- Wer minutenlang ohne 2,5 s Pause TIPPT, während ein anderes Gerät am selben Board schreibt, lädt in dieser Zeit
  weiterhin nicht hoch (der Tipp-Schutz hält den ganzen Abgleich an). Enger schneiden hieße: einarbeiten, während
  ein Editor den Fokus hat — die Reihen m383 B5 und m328 F0 erwarten ausdrücklich, dass dabei nichts dazwischenkommt.
- Zwei Geräte ändern dasselbe Feld derselben Karte: weiterhin „hiesige Fassung gilt" auf jedem Gerät, das zuletzt
  schreibende setzt sich durch.
