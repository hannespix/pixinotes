# Prüfreihen (E2E)

Ende-zu-Ende-Prüfungen der Meilensteine — jede Reihe startet einen lokalen
Server über `dist/`, fährt ein echtes Chromium und misst das Verhalten
(bis hin zu Bildpunkt-Helligkeiten). Sie liegen im Repository, damit sie
jede Umgebung überleben.

## Ausführen

```bash
npm run build                      # die Reihen prüfen den dist/-Stand
node pruefungen/m266-schatten.mjs  # eine einzelne Reihe
node werkzeug/alle-pruefungen.mjs --bahnen 4   # alle, vier parallel (M448)
node werkzeug/alle-pruefungen.mjs --geaendert   # nur Reihen zu den geänderten Dateien
```

`--geaendert` wählt die Reihen, die zu den seit dem Hauptzweig geänderten
Dateien passen: die Reihe selbst, die Reihe derselben Meilenstein-Nummer, Reihen,
deren Quelltext den geänderten Dateinamen nennt, und Reihen, deren Name ein Wort
des Dateinamens trägt (`GanttCard.tsx` → `m271-gantt`). `--nur-zeigen` listet die
Auswahl samt Grund, ohne etwas zu starten. Für Änderungen an `store.ts`,
`index.css` oder `App.tsx` bleibt die volle Reihe der sichere Weg.

Die Reihen `m383b`, `m388b`, `m391b` brauchen ein lokales Postgres
(`service postgresql start`, Nutzer `postgres`); fehlt es, melden sie laut
„ÜBERSPRUNGEN" und gelten als bestanden.

Chromium: Standardpfad `/opt/pw-browsers/chromium` (Claude-Umgebung) —
anderswo per Umgebungsvariable `PW_CHROMIUM=/pfad/zu/chromium` setzen.
`playwright-core` kommt aus den normalen Abhängigkeiten (`npm ci`).

Screenshots und Zwischendateien landen in `pruefungen/ablage/`
(nicht eingecheckt).

## Reihen

| Reihe | Prüft |
|---|---|
| m265 | Zoom-Ansicht: Scrollen im vergrößerten Bild, Board-Zoom im Fokus |
| m266 | Kein Streifen-Schatten an der linken Leiste (Pixelmessung) |
| m267 | Textformatierung: Größen-Leiter, Aa-Menü, ein Ort, Kollisionsfreiheit |
| m268 | Anzeige-Skalierung 100/130/175 %: Verbinden, Ziehen, Menüs, Zeichnen |
| m269 | Dateien im Sync-Beipack · KI liest PDF-Text (abgefangene Anfrage) |
| m270 | Kalender: Jahresansicht · Outlook-Export ganzer Zeiträume (RFC 5545) |
| m271 | Gantt: Datumsfelder, klebende Monatsnamen, Einpassen, Namensspalte |
| m272 | Notiz-Termine fließen in den Kalender und den Export |
| m273 | Gantt-UI: klebende Kopfzeile, Balken-Namen, Zieh-Fahne, Doppelklick |
| m274 | Recherche: Rückfragen-Dialog, echte Quellen-Abrufe, Quellen im Prompt |
| m276 | KI liest Word, Excel, Text; Bild-Karten gehen an bildfähige Modelle |
| m277 | Formatier-Leiste am Telefon: angedockt statt über der Markierung |
| m278 | Websuche über den KI-Anbieter: Werkzeug, Quellen, Zeitüberschreitung |
| m279 | Gantt-Zeitskalen: Tage/Wochen/Monate/Jahre, Zeitanker, Quartale |
| m280 | Gantt: nichts abgeschnitten — Beschriftungen, Ränder, Verläufe |
| m281 | Gantt: Skalenwechsel greift zuverlässig (alle vier Stufen) |
| m282 | Gantt am Telefon: scrollbare Werkzeugleiste, 40-Punkt-Trefferflächen |
| m283 | Rechen-Tabelle in der Notiz: Formeln, Slash-Menü, ein Tabellentyp |
| m284 | Dunkelmodus: Kontraste in Rechen-Tabelle und hellen Notizen (WCAG) |
| m285 | Karten aus jeder Ansicht bearbeiten — ein Karten-Blatt, ein Rückweg |
| m287 | „Rahmen" ≠ „Bereich": Wortwahl, Rückfragen, Board-Umbenennen im Baum |
| m288 | Board- und Projekt-Menü: überall derselbe Vorrat, Archiv, Duplikate |
| m289 | Bilder in Notizen: einfügen, verkleinern, Chip am Telefon, Export |
| m290 | Android-Teilen: Manifest, Service Worker, Zielwahl, Übernahme |
| m291 | Karten-Fokus: Blättern, Formatieren und Werkzeuge ohne Überlappung |
| m292 | Auswahl-Leiste dockt an die Karte (oben/unten/feste Zeile) |
| m293 | Kanban-Archiv: Erledigtes archivieren, Automatik nach Tagen, Zurückholen |
| m294 | Ruhige Voreinstellungen |
| m295 | Kanban entrümpelt |
| m296 | Dock, Menüs und Auswahl-Leiste entrümpelt |
| m297 | Eine Navigation statt drei |
| m298 | Kachel-Ansicht für große Module |
| m299 | Die App redet weniger |
| m300 | Einstellungen entrümpelt |
| m301 | Ein Weg am Telefon, ruhigere Karten |
| m302 | Einfügen im Menü der Notiz |
| m303 | Speicher fast voll: Das Bild wird zur Karte, nicht zum leeren Block |
| m304 | Das Netz als Landkarte mit Inseln |
| m305 | Das Netz öffnet als Karte, nicht als Lupe |
| m306 | Hüllen ohne Haken |
| m308 | Die linke Spalte lässt sich ziehen und ausblenden |
| m309 | Archivierte Karten sind im Baum verborgen, bis man das Archiv einblendet |
| m310 | Boards sortieren: manuell, alphabetisch, nach Erstellung |
| m311 | Sync in beide Richtungen über den (Nextcloud-)Ordner |
| m312 | Weniger ist mehr, Etappe 1: der Rahmen |
| m313 | Weniger ist mehr, Etappe 2: die Karte |
| m314 | Weniger ist mehr, Etappe 3: die Einstellungen |
| m315 | Weniger ist mehr, Etappe 4: die Gestalt |
| m316 | Die Modul-Palette: ＋ zeigt alle Module auf einen Blick |
| m317 | Konto-Sync: Anmelden mit Google oder Microsoft, Daten im App-Ordner des eigenen Drive/OneDrive |
| m318 | Eine Leiste unten, nie zwei |
| m319 | Stift & Touch |
| m320 | Handschrift → Text |
| m321 | Start & Leistung |
| m322 | Der Stift schwenkt nicht mehr die Seite |
| m323 | Notiz nachgeschärft |
| m324 | Stift & Handschrift 2 |
| m325 | Stift wie auf Surface und iPad: „Der Stift schreibt, der Finger bedient." |
| m326 | Finger-Gesten überall (Procreate) |
| m327 | Handschrift mit Struktur |
| m328 | Eigenes PixiNotes-Konto mit E-Mail (Supabase als dritter Konto-Weg) |
| m330 | Geteilte Boards zwischen Konten und schnellerer Live-Abgleich |
| m332 | Markdown-Import als Notiz & KI-Stapelaufgaben in Portionen |
| m333 | Fokus ist ein Zoom im Board, kein eigenes Blatt |
| m335 | PDF-Karte: zugeklappt klein, aufgeklappt eine Seite; Anmerkungen gehören zur Seite |
| m337 | Word-Dokument als Dokument-Karte (wie PDF) |
| m338 | Notizen ruhen, bis man schreibt; ferne Karten kosten nichts |
| m339 | Lange Notizen scrollen in der Karte; Markierungen und Zeichnungen haften am Text |
| m340 | Alle Export- und Teilen-Wege, wirklich durchgespielt |
| m341 | WhatsApp-Nachricht |
| m342 | Tabellen und Module in der WhatsApp-Nachricht |
| m343 | Karten greifen in jeder Zoomstufe |
| m344 | Ruhiges Ziehen, Fanglinien, Tastatur auf dem Board |
| m345 | Pfeiltasten in allen Ansichten |
| m346 | Scrollbalken der Notiz auf dem Board; aufgeräumter Zoom-Modus |
| m347 | Überschriften kleiner; Menüs und Einstellungen nachgemessen |
| m348 | Der Strich erscheint sofort |
| m349 | Fangen an Abständen |
| m350 | Eigenes Rechtsklick-Menü statt des Browser-Menüs |
| m351 | Grabsteine: gleichzeitiges Speichern zweier Geräte verliert keine Karten mehr |
| m352 | Blättern mit der Tastatur in PDF- und Word-Karten |
| m353 | Im Fokus liegt eine PDF-/Word-Seite ganz zwischen Kopfzeile und unteren Leisten |
| m354 | Stift: Stärken stufenlos, Vorgabe fein, Stärke passt zur Ansicht und zur Seite; Vorschlag über dem Text |
| m355 | i-Punkte und Umlaut-Punkte mit dem Stift |
| m356 | Textmarker für bessere Lesbarkeit |
| m357 | Ein Board per kurzem Link teilen; der Empfänger öffnet es direkt, ohne Konto |
| m358 | PDF- und Word-Karten merken sich die zuletzt offene Seite (am Gerät) |
| m359 | Kommentar-Pins und -Blasen auf einer PDF-Seite liegen ÜBER der Karte, auch wenn sie gewählt ist |
| m360 | Freigabe mit Rolle (bearbeiten / nur lesen) und Einladungslink |
| m361 | Blättern mit den Pfeiltasten geht nicht mehr verloren |
| m362 | Kommentare lassen sich bearbeiten (und einzelne Beiträge löschen) |
| m363 | Dokumente am Telefon bedienen und annotieren; Dokumente in der Präsentation lesbar und blätterbar |
| m364 | Gruppenarbeit per Link, auch ohne Konto, in Echtzeit; Karten-Sperre „wer zuerst anfasst" |
| m365 | Gruppenarbeit ohne Chaos: Rechte der Gäste, eigenes Rückgängig, Sicherung |
| m366 | Gruppenarbeit für viele: 50 Teilnehmer in einem Board, Änderungen kartenweise |
| m367 | „Folgt mir": Wer vorführt, nimmt die anderen mit seiner Ansicht mit |
| m368 | Die Seite verträgt die Übersetzung des Browsers |
| m369 | Der Radierer hat keine Farbwahl |
| m370 | Leerer Start; ein geteilter Link zeigt nur das geteilte Board |
| m371 | Tools und Webseiten in der Präsentation, und für das ganze Team |
| m372 | Karten, die ein anderer anlegt oder bearbeitet, sind nicht mehr blass |
| m373 | Entscheidungs-Bubbles: Ideen sammeln, gruppieren, mit Punkten abstimmen — alle gleichzeitig |
| m374 | Bilder liegen rahmenlos auf dem Board |
| m375 | Live-Mauszeiger und Laserpointer in gemeinsamen Boards |
| m376 | Reaktionen und gemeinsamer Timer für Gruppen |
| m377 | Punkte auf Karten: abstimmen, was wichtig ist |
| m378 | Ideen-Bubbles für Workshops: bessere Physik, Gruppieren mit der Hand, Moderation |
| m379 | Vorlagen beim Anlegen eines Boards |
| m380 | Wochenplan, Zeiterfassung, Protokoll und Rechen-Tabelle leben auf der Folie |
| m381 | Eingebaute englische Oberfläche |
| m382 | Englische Hilfe, Vorlagen und Standardnamen |
| m383 | Karten einzeln schreiben: auch der Besitzer und Gäste mit Konto schicken nur, was sich geändert hat |
| m383b | board_aendern gegen ein echtes Postgres (braucht lokale Datenbank) |
| m384 | Lücken beim Teilen: Gäste mit Konto bekommen Tool-Quelltexte und Dateien; Eingaben in Tools reisen mit |
| m385 | QR-Code zum Mitmachen: Der Einladungslink eines Boards als Code, den das Publikum vom Beamer scannt |
| m386 | Bubbles am Smartphone bearbeiten: Die Änderung muss sich abschließen lassen |
| m387 | Die Präsentation nimmt das Publikum mit; Ausschnitt, Karten-Fokus und PDF-Seiten gehören zur Ansicht |
| m388 | Code-Audit: was die Prüfung gefunden hat, bleibt behoben |
| m388b | Auslöser konto_dateien_inhalt_pruefen gegen ein echtes Postgres (braucht lokale Datenbank) |
| m389 | UI-Audit: was die Durchsicht der Oberfläche gefunden hat, bleibt behoben |
| m390 | Logik-Audit: was beim Durchspielen der Abläufe gefunden wurde, bleibt behoben |
| m391 | Team-Audit: Zusammenarbeit ist unkompliziert, und in Ruhe ist wenig zu sehen |
| m391b | Team-Audit, Server-Seite: Migration team_haertung gegen ein echtes Postgres (braucht lokale Datenbank) |
| m392 | PDF-Vorschau scharf in jeder Kartengröße; Fotos aus der Geräte-Ablage ohne Rahmen |
| m393 | Ein Webtool im Vollbild gehört der ganze Schirm |
| m394 | Stift, Textmarker, Radierer und Kommentare in der Präsentation |
| m395 | Einfache Bildbearbeitung: zuschneiden, drehen, spiegeln, gerade richten, Helligkeit, verpixeln |
| m396 | Finger-Gesten in der Präsentation, während man mit dem Stift arbeitet |
| m397 | Keine Emojis mehr in der Oberfläche, und ein ruhigeres Bild |
| m398 | Projekte und Bereiche löschen, in denen noch Boards liegen |
| m399 | Mehrere Karten auf einmal in Form bringen |
| m400 | Karten frei drehen |
| m401 | Pfeilspitzen bleiben beim Herauszoomen im Maß |
| m402 | Zoom in der Präsentation, und das Pfeil-Menü über den Karten |
| m403 | Präsentation: den Ausschnitt verschieben, mittig zoomen, Darstellung als Schnellauswahl |
| m404 | Das Mausrad zoomt gleichmäßig und weich; Bedienung der Dokument-Karten im Zoom; weiter hineinzoomen |
| m405 | Präsentation: „Weiter" und „Zurück" gehen immer von Karte zu Karte; im Dokument blättert dessen eigene Leiste |
| m406 | Eine eingefügte Excel-Datei bleibt bei der Rechen-Tabelle und lässt sich wieder herunterladen |
| m407 | Die Rechen-Tabelle als Datentabelle: Links, Kopfzeile, Filtern und Sortieren – auch aus Excel |
| m408 | Das Archiv wiederfinden |
| m409 | Das Tabellen-Modul: Kopfzeilen, Rollen, Fokus – und das Aussehen aus Excel |
| m410 | Die KI kennt jedes Modul: lesen, bedienen, erinnern |
| m411 | Links in Tabellen: auch die, deren Adresse eine Formel zusammensetzt |
| m412 | Kopfleiste aus einem Guss |
| m413 | Fokus und Präsentation: eine Reihenfolge nach Pfeilen, Seiten und Karten getrennt, Zoom gemerkt, Form behalten |
| m414 | Vorführen: Laserpointer und Tools bei den Gästen genau wie beim Vorführenden |
| m415 | Ideabubbles im Tropfen-Look: Gruppen fließen als Tropfen um ihre Ideen, das Modul ist randlos |
| m416 | Schrift: eine elegante, zeitlose Serife für Überschriften, eine klare Sans für alles andere |
| m417 | Flache Karten mit leisen Rändern |
| m418 | Präsentation auf dem Handy: „Präsentation beenden" bleibt immer erreichbar |
| m419 | Das Netz im Tropfen-Look, ruhiger und flüssiger |
| m421 | Bedienung nur im Fokus |
| m422 | Ideabubbles: Kein Tropfen wird mehr am Rand der Bühne abgeschnitten |
| m424 | Karten-Fokus: Darstellung einstellbar wie in der Präsentation |
| m425 | Präsentationen mit Vibe Studio direkt auf dem Board |
| m426 | „Nur Inhalt": Vollbild ohne Bedienung in Präsentation und Karten-Fokus |
| m427 | Präsentation per KI: Gliederung als JSON, PixiNotes baut die Vibe-Studio-Folien |
| m428 | Bestehende Präsentationen per KI überarbeiten |
| m429 | Ideabubbles: ruhige Gruppen-Namen, Gruppen kommen zur Ruhe |
| m430 | Kanban bei wenig Breite: keine Überlappungen |
| m431 | Präsentation verlassen: das Board steht auf der zuletzt gezeigten Karte |
| m432 | Pfeile mit Tiefe: ein perspektivischer Schatten unter jeder Verbindung, die Linie gewinnt zum Ziel an Kraft |
| m435 | Ablauf-Module (Schritt, Entscheidung, Start/Ende) mit Text-Bearbeitung wie in Notizen, und sie wachsen mit |
| m436 | Ablauf-Formen nachgeschärft |
| m437 | Fokus mit angehefteter Seitenleiste: kein toter Streifen links |
| m438 | Seitenleiste: Projekte und Boards ruhig unterscheidbar |
| m440 | Boards in der Übersicht ziehen: haften, ausweichen, federnd ablegen |
| m441 | Vollbild-Fokus am Telefon: mit einem Wisch zur nächsten Karte |
| m442 | Google einfacher verknüpfen: E-Mail-Adresse statt technischer Felder |
| m443 | MCP-Schnittstelle: KI-Modelle legen von außen Boards an, lesen und füllen sie – mit allen Modulen |
| m444 | KI: Board-Briefing „Was ist auf diesem Board gerade wichtig?" |
| m445 | Karten nach Themen ordnen (Auto-Clustering) |
| m447 | Barrierefreiheit (WCAG 2.1 AA): Kern-Oberfläche per Tastatur und Vorlese-Programm bedienbar |
| m449 | Board-Versionen: frühere Stände ansehen und wiederherstellen |
| m450 | Kontakt-Karte: Visitenkarte mit Rufnummern, E-Mail, Anschrift; vCard rein und raus |
| m451 | E-Mail-Destillat: Kernaussage, offene Fragen, Aufgaben, Termine aus einem langen Mail-Verlauf |

Die Reihen sind bewusst GEGEN DAS VERHALTEN geschrieben, nicht gegen die
Struktur: Wo möglich messen sie Bildpunkte, echte Downloads, abgefangene
Netz-Anfragen — nicht bloß Klassennamen.
