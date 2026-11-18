# Umbau: Weniger ist mehr (ab M312)

> Ziel: PixiNotes soll sich ohne Anleitung erschließen. Das Wichtigste ist sichtbar,
> alles andere liegt an genau EINEM vorhersehbaren Ort. Kein Funktionsumfang geht
> verloren, aber jede Funktion hat nur noch einen Weg. Minimalismus ist die Regel,
> nicht die Option.

## 1. Befund (Stand M311, 5. November 2026)

Gezählt mit Playwright auf der gebauten App und per Durchsicht aller Komponenten:

| Ort | Heute |
|---|---|
| Leeres Board (Desktop, Spalte offen) | 21 feste Knöpfe + Suchfeld, mit Baum ≈ 42 klickbare Elemente vor der ersten Karte |
| Übersicht (Starter-Umgebung) | 185 sichtbare Bedienelemente (je Bereich „+ Projekt" und „✕", je Projekt „+ Board", je Board „▶" und „⋯") |
| Einstellungen | Design 15 · Daten 9 · Synchronisation ≈ 24 · Dienste ≈ 22 Optionen |
| Präsentieren | an 7 Stellen erreichbar |
| Board umbenennen | an 6 Stellen |
| Einstellungen öffnen | an 8 Stellen |
| Suche | 6 getrennte Suchfelder |
| Löschen einer Karte | ✕ auf der Karte, 🗑 in der Leiste, Entf |

Die Oberfläche ist mit jedem Schritt gewachsen; jeder Schritt hat einen Knopf
hinterlassen. Das Ergebnis ist nicht schwer zu bedienen, aber schwer zu
überblicken.

## 2. Leitsätze des Umbaus

1. **Drei Orte.** Kopfleiste (global), Spalte (wohin), Dock (was tun). Sonst nichts
   Festes auf der Fläche.
2. **Ein Weg pro Aufgabe.** Jede Aktion hat einen Ort. Kontext-Einstiege (ein Hinweis
   „Konto verbinden" in der Kalender-Karte) sind erlaubt, Knopf-Kopien nicht.
3. **Sichtbar ist, was man täglich braucht.** Alles andere liegt in einem ⋯-Menü,
   das immer gleich aufgebaut ist: Tun · Weitergeben · Aufräumen.
4. **Einstellungen sind Ausnahmen.** Was sich automatisch entscheiden lässt, wird
   nicht gefragt. Eine Option bleibt nur, wenn vernünftige Menschen sie
   verschieden wollen.
5. **Hover zeigt, Klick tut.** Zeilen und Kacheln tragen ihr ⋯ erst, wenn der Zeiger
   darüber steht (am Finger: immer, aber nur eines).

## 3. Zielbild

### Kopfleiste
`[PixiNotes]` … `↶ ↷ · ⚙ (· ☁)`  
Das Logo öffnet die Hilfe (dort stehen „Was ist neu", Tastenkürzel, Impressum,
Datenschutz und die Fassung). Der Suche-Knopf erscheint nur, wenn keine Spalte
sichtbar ist (Handy, Spalte eingeklappt). Das Logo-Menü mit A−/A+, „Sehen &
Bedienen", Hilfe, Impressum entfällt: alles davon hat schon einen Ort.

### Spalte (Navigation)
Suchfeld (DIE Suche: Karten, Boards, Befehle) · **Übersicht** · **Aufgaben** (mit
Zahl) · Baum Bereich → Projekt → Board → Karten. Je Zeile nur Name und Zahl; ⋯
beim Zeigen. Fuß: **＋ Neu** (Board · Projekt · Bereich · Beispiele) und ‹.
Weg: der Stift zum Umbenennen (Doppelklick oder ⋯), „Teilen" im Fuß (steht im
Board-⋯), das ✕ an Reitern am Handy.

### Dock (nur auf dem Board)
`＋ · ✎ · ⋯` — drei Knöpfe.  
**＋** öffnet die Modul-Palette (M316): alle Module als Kacheln in fünf Gruppen
(Notieren & Rechnen · Planen · Ablauf · Einfügen · Ordnen) plus Vorlagen, mit
Suchfeld. Kein „Weitere Module", keine zweite Ebene — jedes Modul hat genau einen Platz.  
**⋯** ist das Board-Menü: Anordnen … · Hintergrund … · KI-Assistent … ·
Präsentieren · Als Bild exportieren · Alles einpassen.  
Weg: „Aufgaben" (steht in der Spalte), „Präsentieren" als eigener Knopf,
„Aufräumen" (war „Fluss horizontal" ein zweites Mal), „Archiv einblenden" (steht am
Fuß des Baums), die Zoom-Knöpfe unten links (Mausrad, Pinch, Taste F, ⋯ → Alles
einpassen).

### Karte
Kartenkopf: Griff und Verbindungs-Punkte, kein ✕ (Löschen: Leiste oder Entf).  
Auswahl-Leiste: `Duplizieren · Teilen · ⋯ · Löschen`.  
⋯ (immer dieselbe Dramaturgie): Kommentar · Eigenschaften … · In Board verschieben …
— Werkzeuge: Schrift & Größe … · KI … · Ausrichten … (ab 2) · Als Kachel (Module) ·
Auto-Größe — Weitergeben: Nachschlagen · Als Vorlage speichern — Aufräumen:
Markierungen lösen · Archivieren.  
„Formatiert kopieren" lebt nur noch im Teilen-Dialog. Die Textleiste in der Notiz
behält A− / A+ neben „Aa": Stufen für den markierten Text sind kein zweiter Weg,
sondern die schnelle Form desselben.  
Modul-Köpfe (Kanban, Zeitplan, Kalender, Tabelle, Diagramm) tragen höchstens
zwei Symbole und ein ⋯; alles Weitere liegt im ⋯ des Moduls.

### Übersicht
Kacheln je Projekt unter Bereichs-Überschriften, Umschalter Hierarchie · Netz.
Keine „+"- und „✕"-Knöpfe in der Fläche: Bereich, Projekt und Board bekommen
beim Zeigen ihr ⋯ (Bereich neu: Umbenennen · Neues Projekt · Löschen). Anlegen
geht über ＋ Neu in der Spalte.

### Einstellungen (drei Reiter)
**Darstellung**: Erscheinungsbild · Akzentfarbe · Anzeigegröße · Besser lesbar
(klare Schrift + kräftige Kontraste) · Mausrad zoomt · Lebendige Fläche (Physik,
Klick-Zoom, Konfetti).  
Automatisch statt Option: Milchglas (aus bei Kontrast oder Systemwunsch),
Navigation links (Fuß ‹), Karte im Fokus / Öffnen mit / Zeigen als (Handy: Tipp,
PC: Doppelklick, Blatt), Stift zeichnet sofort (an).  
**Daten**: Sichern & Laden · Synchronisation (Weg: Ordner · WebDAV · Datei; später
Firebase) · Team-Sync · Exportieren (Markdown) · Importieren (OneNote) · Alles
leeren. Die Dateien-Obergrenze ist fest (25 MB).  
**Dienste**: KI · Gehirn (ein Schalter, Rest unter „Erweitert") · Konten.

### Hilfe & Start
Begrüßung mit zwei Knöpfen (Loslegen · Beispiele ansehen). Die Hilfe trägt die
Fassung und „Was ist neu" im Fuß.

### Gestalt (M315)
Eine Schicht Tokens in `src/index.css`, an der alles hängt:

- **Farbe**: kühle Neutraltöne (`--bg #f3f4f6`, `--ink #16191e`, `--muted #5a616d`,
  5,7:1 auf der Fläche), Weiß für Flächen, eine 1-px-Kante `--border-soft`.
  Dunkel: `#141618` / `#1d2024` / `#e9ebee`. Der Akzent bleibt wählbar.
- **Radius**: `--r-xs 2` (Chips, Felder) · `--r-sm 3` (Knöpfe) · `--r 4` (Karten,
  Menüeinträge) · `--r-lg 6` (Fenster, Leisten). Keine Pillen; echte Kreise
  (Punkte, Avatare, Pins) bleiben 50 %.
- **Schatten**: `--card-shadow` (1-px-Ring + 2 px), `--chrome-shadow` (Leisten),
  `--pop-shadow` (Menüs, Fenster). Flach, kühl, kein Weichzeichner.
- **Flächen**: deckend. Kein `backdrop-filter`, kein Mesh-Verlauf, keine
  Papiertextur — die Fläche ist `--bg` mit Punktraster. Das spart auf jedem
  Schwenk Rechenzeit.
- **Schrift**: Systemschrift (`system-ui, Segoe UI, Roboto, Helvetica Neue`),
  keine gerundete Variante.
- **Bewegung**: Knöpfe hüpfen nicht beim Zeigen; Druck ist `scale(0.96)`;
  Menüs blenden in 140 ms ein.

## 4. Etappen

| Etappe | Inhalt | Nummer |
|---|---|---|
| 1 | Rahmen: Kopfleiste, Spalte, Dock, Übersicht, Kartenkopf ohne ✕, Zoom-Knöpfe weg | M312 |
| 2 | Karte: Auswahl-Leiste und ⋯ neu geordnet, Modul-Köpfe ≤ 2 Symbole + ⋯ | M313 |
| 3 | Einstellungen auf drei Reiter, Optionen automatisiert, Hilfe/Begrüßung angepasst | M314 |
| 4 | Gestalt: Tokens für Farbe, Radius, Schatten; kein Milchglas, keine Textur, kein Verlauf | M315 |
| 5 | Modul-Palette: ＋ zeigt alle Module auf einen Blick, gruppiert, mit Suche — kein zweites Menü | M316 |
| 6 | Konto-Sync: Anmeldung mit Google oder Microsoft, Daten im App-Ordner des eigenen Drive/OneDrive | M317 |
| 7 | Eine Leiste unten: dockt die Auswahl-Leiste an, weicht das Dock — auf jeder Breite | M318 |
| 8 | Stift & Touch: perfect-freehand-Konturen mit Druck, Formen (Pfeil, Kreis, Dreieck, gedrehtes Rechteck), Hand schiebt / Stift zeichnet | M319 |
| 9 | Handschrift → Text: Browser-API, Scribble am iPad, Online-Erkennung nur als Opt-in | M320 |
| 14 | Finger-Gesten überall (Procreate): Zwei-/Drei-Finger-Tipp = Rückgängig/Wiederholen, halten = schnell, Quick-Pinch = Alles einpassen / zurück, Vier-Finger-Tipp = Vollbild, drei Finger nach unten = Duplizieren oder ＋-Palette; Schalter. Ohne Stift-Gerät zoomen zwei Finger und das Mausrad auch auf der Zeichenebene | M326 |
| 15 | Handschrift mit Struktur: Kästchen, Punkt/Strich, Unterstreichung und Schriftgröße werden Aufgabe, Aufzählung, Überschrift; Text-Marker („- ", „1. ", „[ ] ", „# "); unter einer Liste geht die Liste weiter, links der Einrückung wieder Text; Umschalter ¶ • 1. ☐ H im Vorschlag | M327 |
| 16 | Große Anhänge im PixiNotes-Konto: Storage-Bucket `pixinotes` (Ordner je Nutzer, RLS), bis 50 MB, nur Neues hochladen, > 8 MB erst beim Öffnen der Karte; konto_schreiben ohne Löschen (App löscht danach) | M329 |
| 17 | Geteilte Boards zwischen Konten (board_freigaben, Gast schreibt per freigabe_schreiben in die Zeile des Besitzers, Realtime auf fremde Boards, Bereich „Geteilt mit mir", Freigabe-Dialog im Board-Menü) und Tipp-Pause 1 s bei Live-Verbindung | M330 |
| 18 | Fokus = Zoom im Board (Kamera fährt auf die Karte, Rest gedimmt, Rückweg), statt Vollbild-Blatt mit toter Zeichenebene; Tipp daneben schließt, Stift-Strich nicht | M333 |
| 19 | Markdown/Text-Import als formatierte Notiz, „Als Notiz übernehmen" ohne KI; KI-Freitext in Portionen (Fortschritt, Abbrechen, Halbieren bei abgeschnittener Antwort, ehrliche Endmeldung), max_tokens 4096, Kontext-Auslassung wird gemeldet, Checklisten im Markdown-Parser repariert | M332 |
| 20 | Fokus: lange Karten scrollen (Rad über der Karte, ein Finger im Text, Cursor zieht die Kamera nach, Klemmen an Anfang/Ende, kein Rücksprung beim Wachsen, Karte im Fokus nicht ziehbar) | M334 |
| 21 | PDF-Karte zugeklappt/aufgeklappt (eine Seite, Blätterleiste), Striche und Kommentar-Pins seitenbezogen in PDF-Punkten (lib/pdfSeiten.ts: Karte meldet Seitenlage, Ebenen rechnen um), Stift schreibt auf der offenen Seite, Fokus klappt auf | M335 |
| 22 | Kommentare je Seite: nummerierte Seiten-Pins mit Textblasen, Kommentarliste unter der Seite, Sprung zu Seiten mit Kommentaren, Zähler in der Blätterleiste, Kommentar ohne Stelle bei offener PDF auf die aktuelle Seite, „Seite n" im Gesprächskopf | M336 |
| 23 | Word (.docx) als Dokument-Karte: docx-preview rendert Seiten im Browser, eine Seite sichtbar, Seitenpunkte = CSS-pt der Word-Seite, gemeinsame Blätterleiste/Kommentarliste mit der PDF (SeitenLeiste, SeitenKommentare); Import standardmäßig als Dokument, „Als Notiz übernehmen" für Word | M337 |
| 24 | Leistung: ruhende Notizen (schlichtes HTML in Editor-Struktur, Editor bei Klick/Fokus/Stift/Verweilen — lib/notizRuhend.ts, NotizRuhend.tsx), Fern-Ruhe (content-visibility für Karten außerhalb des Bildes — lib/fernRuhe.ts), Anschluss- und Farbpunkt ohne Zeiger per visibility statt opacity (Griff bleibt greifbar); Block-Ids erst mit der ersten Änderung (Pfad-Ids `_r0` in der ruhenden Ansicht — bloßes Ansehen schreibt nichts); 300 Karten 49 s → 1,9 s. Feinschliff: dunkle Haftnotizen, Kopfleiste am Tablet einzeilig, runder Farbpunkt | M338 |
| 25 | Notiz-Überlauf: Kartenkörper scrollt (eigener Daumen in CardShell, Schatten oben/unten, Finger-Scrollen von Hand in Board.tsx, Deckel 640 für Notizen ohne feste Höhe); Striche auf dem Text (`amText`, `block`, `blockY`) zeichnet die Notiz selbst (nodes/NotizStriche.tsx, lib/notizText.ts) — sie scrollen mit und folgen ihrem Absatz; `strichRelativ` rechnet für Radierer und Handschrift um | M339 |
| 26 | Export/Teilen: `cloneSharedBoard` hängt Striche und Kommentare an die neuen Karten-Ids; `blocksToHtml` rekursiv mit Inline-Formatierung, Links, Zitat, Code; `blocksToMarkdown`/`nodeToMarkdown` (echtes Markdown, eine Datei im Fallback); PDF-Seitenschnitt in Leerzeilen; Bild-Export mit Strich-Ebene, Auswahl-Filter, ohne Bedienelemente, Druckfenster im Klick geöffnet; `triggerDownload` wandelt data:-Adressen in Blobs | M340 |
| 27 | WhatsApp: `nodesToWhatsapp` (eigene Auszeichnung statt Klartext), `whatsappNachricht` begrenzt die ADRESSE (6000) und kürzt emoji-sicher an Zeilenenden (`sicherKuerzen`); der Knopf ist ein echter Link; lange Nachrichten gehen am Handy über `navigator.share`, am PC zusätzlich in die Zwischenablage | M341 |
| 28 | WhatsApp-Tabellen: `waTabelle` wählt nach Breite Festbreitenschrift (≤ 30 Zeichen, ausgerichtet) oder Karteikarten-Form; `nodeToWhatsapp` mit eigenen Formen für Rechen-Tabelle, Zeitplan, Wochenplan, Zeiterfassung, Protokolle, E-Mail, Datei, Bild | M342 |
| 29 | Bedienung zoomfest: `--pn-inv` (Kehrwert des Zooms, Board.tsx setzt ihn bei ruhendem Zoom) hält Griff, Anschlusspunkte, Auswahlrahmen, Größen-Kanten in Bildschirm-Größe; `data-weit` unter ~45 %: `noDragClassName`/`noWheelClassName` aus, Karteninhalt ohne Zeiger-Ereignisse — die ganze Karte ist der Griff; Finger: erst wählen, dann ziehen. Bibliotheks-Entscheid: bei React Flow bleiben (tldraw braucht einen Lizenzschlüssel und hieße alle Module neu bauen) | M343 |
| 30 | Ziehen ohne Skalierung/Neigung; Fanglinien (lib/fang.ts, Fanglinien.tsx — Kanten und Mitten, 6 Bildpunkte, Strg schaltet ab, eingehängt über `onNodesChange`); Board-Tastatur (components/boardTasten.ts: Tab, Alt+↓/↑, Strg+Pfeil, Enter, Esc, Strg+D, + − 0, V P M E), Alt+↓/↑ im Fokus | M344 |
| 31 | Pfeiltasten in allen Ansichten (components/pfeilTasten.ts, ein Capture-Handler, liest die Ziele aus dem DOM): Menüs/Paletten zeilenweise, Leisten ← →, Navigationsbaum mit Auf-/Zuklappen, Übersicht und Netz räumlich + Enter, Aufgaben-Zentrale (Leertaste erledigt, Enter klappt auf, Strg+Enter springt), F6 wechselt den Bereich; Board: Pos1/Ende, Strg+Umschalt+Pfeil erweitert die Auswahl; Präsentation: Pos1/Ende | M345 |
| 32 | Notiz-Scrollbalken dauerhaft sichtbar, über `--pn-inv` in Bildschirm-Breite, Mindesthöhe 28 Bildpunkte am Schirm; im weiten Zoom bedienbar (Zug erreicht React Flow nicht, Rad rollt die gewählte Notiz); Abgleich: Auswahl bleibt am Gerät (`ohneAuswahl`, `nurAuswahlAnders`); Fokus: Notiz mit fester Höhe zeigt allen Text (`--karte-h` als Mindesthöhe), verdeckte Nachbarn `data-fokus-weg` | M345/M346 |
| 33 | Überschriften: Notiz-H1/H2/H3 1.5/1.28/1.12 em (BlockNote 3/2/1.3), Titelzeile 1.08 em, Fenster-/Aufgaben-/Präsentationstitel kleiner, Druck-CSS mit; Menüs: `insBild()` verankert aufgeklappte Menüs am Rand nach gemessener Größe (EbenenMenu, Kanban, Netz), Einstellungs-Häkchen rechtsbündig, Farbfelder im Auswahl-Menü, Fingerziele ≥ 36 Punkte, Aufgaben-Schnelleingabe und Hilfe-Kopf am Telefon | M347 |
| 34 | Stift-Latenz: Der laufende Strich hat einen eigenen Pfad, dessen `d` im Zeiger-Ereignis gesetzt wird (vorher lief er über die memoisierte StrichPfad-Komponente und blieb bis zum Absetzen stehen); keine Neu-Darstellung der Ebene je Bewegung; bis zu zwei vorhergesagte Punkte (`getPredictedEvents`), nie gespeichert | M348 |
| 35 | Fangen an Abständen (lib/fang.ts): je Achse Kanten/Mitten, Mitte zwischen den nächsten Nachbarn derselben Reihe/Spalte und Fortsetzen eines vorhandenen Abstands (in beide Richtungen); der nächste Treffer gewinnt; Abstandsmarken mit Maß (Fanglinien.tsx, `.fang-abstand`) | M349 |
| 36 | Eigenes Kontextmenü (lib/kontextmenue.ts, components/Kontextmenue.tsx): Browser-Menü überall unterdrückt außer in Textfeldern/Text im Bearbeiten und mit Umschalt; Karte → „Mehr“ der Auswahl-Leiste am Zeiger (+ Öffnen, Duplizieren, Teilen, Löschen), Fläche → Notiz/Modul hier, Einpassen, Auswählen, Zeichnen, Raster; Verbindung → benennen, löschen; Baum/Übersicht → ⋯-Menü der Zeile am Zeiger; Rechts-Ziehen öffnet nichts | M350 |
| 37 | Grabsteine (lib/grabsteine.ts): Löschungen werden im Speicher mitgeschrieben und reisen in der Sync-Datei (`geloescht`); die Zusammenführung löscht nur, was drüben ausdrücklich gelöscht oder woanders abgelegt ist, und entscheidet Boards dann Karte für Karte. Behebt den Kartenverlust bei gleichzeitigem Speichern zweier Geräte (Ordner, WebDAV); alte Dateien ohne Grabsteine wie bisher. Dazu: Stempel eindeutig unter der Millisekunde (`standStempel`), und die Ordner-Überwachung merkt die Signatur nur, wenn die Datei den erwarteten Stempel trägt (`signaturFuer`) — sonst stand der Abgleich nach gleichzeitigem Schreiben still | M351 |
| 38 | Blättern per Tastatur in PDF/Word (`useBlaetterTasten` in FileCard.tsx): gewählte Karte Bild↓/Bild↑; im Fokus oder mit Tastatur-Fokus auf der Seite (Klick macht sie fokussierbar) zusätzlich →/←, Leertaste, Pos1/Ende. Pfeile/Pos1/Leertaste auf dem Board behalten ihre Bedeutung | M352 |
| 39 | Fokus: aufgeschlagene PDF-/Word-Seite passt ganz zwischen Kopfzeile und Leisten (Zoom darf bis 0,75 unter 1; muss sie stärker schrumpfen, bleibt sie lesbar breit und lässt sich bis über die Leisten rollen); ändert sich der Platz unten (Werkzeugleiste dockt an, Formatier-Leiste), passt die Kamera neu ein | M353 |
| 40 | Stift-Stärken in Bildschirm-Punkten (`STAERKEN`, Breite ÷ Zoom), je Werkzeug drei Stufen + Regler, gespeichert (`pixinotes-stift-staerken`), Vorgabe Stift fein 1,2; Textmarker 8/14/22, Radierer 6/12/24; Seitenstriche speichern die Breite in Seitenpunkten (`seitenBreite`) und wachsen mit der Karte; Handschrift-Vorschlag über dem Geschriebenen | M354 |
| 41 | i-Punkte: kurzer stiller Stift-Kontakt dicht am frisch Geschriebenen (4 s) oder im Stift-Modus auf Nicht-Bedienbarem wird ein Punkt (`punktStattTipp`, `punktSetzen`, Breite ×1,6); Geister-click/dblclick danach geschluckt. Fehler aus M354 behoben: Gruppen-Neuankern rechnete die Seitenbreite jedes Mal erneut um (`brett` in strokeAnchor.ts); einmalige Reparatur gespeicherter Striche (lib/seitenBreiten.ts) | M355 |
| 42 | Textmarker: waagerecht → begradigt; auf Textzeile → Balken in Zeilenhöhe, gerade Kanten (`gerade`), Wortgrenzen (DOM-Text) bzw. Textläufe der PDF (`pdfSeiteText`, lib/markerZeile.ts); Marker je Farbe als eine Gruppe mit Deckkraft/Multiply (`MarkerGruppen`) — kein Nachdunkeln | M356 |
| 43 | Link für alle (lib/linkTeilen.ts, LinkDialog): Board-Fassung + Anhänge im Dateispeicher des Besitzers (`<uid>/link-<token>/`), Tabelle `board_links` (RLS: nur Besitzer) + RPC `link_lesen` (anon) liefert signierte Adressen; Link `#l=<token>`; Empfänger öffnet direkt als Kopie (Anhänge unter neuer Karten-Id), gleicher Link → vorhandenes Board, neuere Fassung → Rückfrage; Migration 20261113120000_board_links.sql | M357 |
| 44 | Zuletzt offene Seite je PDF-/Word-Karte am Gerät gemerkt (`letzteSeite`/`seiteMerken` in lib/pdfSeiten.ts, localStorage `pixinotes-pdf-seite`, höchstens 400 Karten); begrenzt auf die Seitenzahl | M358 |
| 45 | Kommentar-Pins/-Blasen über gewählten Karten: z-index 3001/3000 statt 9/8 (React Flow hebt gewählte Karten auf 1000+) | M359 |
| 46 | Freigabe mit Rolle (bearbeiten / nur lesen): Rollenwahl im Dialog und je Person, Leseschutz am `set()` des Speichers (`geteiltRolle`), Hinweisband + „Eigene Kopie anlegen"; Einladungslink `#e=<token>` (Tabelle `board_einladungen`, RPC `einladung_annehmen`), Annahme auch nach späterer Anmeldung | M360 |
| 47 | Tastatur-Blättern hält auch im Stift-/Marker-Modus: „zuletzt bearbeitetes Dokument" (Zeigergriff im Seitenrahmen) statt DOM-Fokus; Blätter-Knöpfe `aria-disabled` statt `disabled` | M361 |
| 48 | Kommentar-Beiträge bearbeiten/einzeln löschen (`editCommentMsg`, `removeCommentMsg`, Feld `bearbeitet`); `mergeThread` dreiwegig je Beitrag (Schlüssel Verfasser + Zeitpunkt, spätere Fassung gilt, Löschung bleibt) | M362 |
| 49 | Dokumente am Telefon: Fokus auf Seitenbreite, freier Zoom mit Klemmen in beiden Achsen (`fokusGrenzenX`, `fokusSchieben`, `fokusFrei`), Wisch/Doppeltipp, Dokument-Leiste im Fokus-Fuß (`DOKUMENT_BEFEHL`); Präsentation: `DokumentFolie` (PDF/Word/Bild, Seiten als Schritte, Zoom, Anmerkungen) | M363 |
| 50 | Gruppenarbeit per Link ohne Konto: `gast_lesen/gast_stand/gast_schreiben` (Token statt Konto), `lib/gastSync.ts` (kartenweiser Drei-Wege-Abgleich, Blick alle 3,5 s), `lib/liveKanal.ts` (Supabase Realtime Broadcast + Presence, Kanalname je Board aus `board_kanal`); Karten-Sperre „wer zuerst anfasst“ über Presence, Mitlesen beim Tippen nur als Anzeige (`liveHaken`), Schutz am `set()` des Speichers (`sperrschutz`); Notizen frischen an Ort und Stelle auf (`NOTIZ_EXTERN`) | M364 |
| 51 | Gruppenarbeit ohne Chaos: Ersteller je Karte/Strich (`data.von`, `von`), Rechte der Gäste am Einladungslink (`optionen.gastRecht`: alles / eigenes-loeschen / eigenes) — durchgesetzt am `set()` (`gruppenschutz`) und für Gäste ohne Konto in `gast_schreiben`; Rückgängig nimmt nach fremden Änderungen nur den eigenen Schritt zurück (`HistoryEntry.nach`, `gezieltZurueck`); Sicherung „Stand vor der Gruppenarbeit“ beim Besitzer | M365 |
| 52 | Gruppenarbeit für viele: Änderungen kartenweise (`gast_aendern`, `lib/gastPatch.ts`) statt ganzem Board mit Vorbedingung; Versionen als Kette (`v`/`vor`), Deltas über den Live-Kanal, voller Abgleich nur bei Lücken; Takt und Streuung nach Gruppengröße; Geräte mit Konto geben ihre Änderungen als Delta in den Kanal und schreiben nach Gast-Änderungen nicht zurück (`Kenn.alias`); Teilnehmer-Leiste mit aufklappbarer Liste | M366 |
| 53 | „Folgt mir“: Der Vorführende meldet seinen Ausschnitt in Board-Koordinaten über den Live-Kanal (`lib/vorfuehren.ts`, Nachricht `zeig`), Folgende fahren per `fitBounds` mit (`components/Vorfuehren.tsx`); eigenes Schwenken löst, später Begonnenes übernimmt, Ausbleiben beendet | M367 |
| 54 | Mehrsprachig über die Übersetzung des Browsers (M368): Inhalte der Nutzer tragen `translate="no"` (Editor von sich aus, alles Übrige im Markup der Komponenten), die Oberfläche bleibt übersetzbar. `lib/uebersetzung.ts` macht React unempfindlich gegen Übersetzer, die Textknoten durch `<font>` ersetzen (Chrome, Edge): Es wird mitgeschrieben, welcher Knoten wodurch ersetzt wurde; `removeChild`/`insertBefore` bekommen den Stellvertreter, ein geänderter Text bringt den Knoten zurück an seinen Platz. `components/SprachHinweis.tsx` sagt Anderssprachigen einmal in ihrer Sprache, dass der Browser übersetzen kann. Grenzen: Neues erscheint einen Augenblick deutsch, bevor der Browser es übersetzt; Texte in SVG (Gantt-Balken, Netz) und in eingebetteten Seiten sind nicht geschützt bzw. nicht übersetzt; echte Übersetzer waren in der Prüfung nicht verfügbar (nachgebaut in `pruefungen/m368`). Nächste Stufe wäre eine eingebaute Übersetzung der Oberfläche. |
| 55 | Leerer Start (M370): Der Startzustand des Stores ist ein leeres Board (`leererStart` in `store.ts`), nicht mehr die Starter-Umgebung; die kommt nur noch über `addStarter` (Begrüßung, leeres Board, ＋ Neu) und ersetzt dann das unberührte Startboard. Kommt ein Board von außen (`importBoard`: Link `#l=`, `#b=`, Board-Datei; `gastBeitreten`: Einladung ohne Konto) und steht nur das unberührte Startboard da (`leeresStartboard`: einziges Board, leer, Name unverändert), macht es Platz — der Besucher sieht nur das geteilte Board. Wer Eigenes hat, behält es. Bestehende Nutzer, bei denen die Beispiele schon liegen, bleiben unberührt. |
| 56 | Tools und Webseiten im Vortrag und im Team (M371): `HtmlAppSlide` lässt HTML-Karten als Folie wirklich laufen. Der Quelltext eigener Tools reist als Anhang mit (`anhangKarte`/`anhangInhalt` in `lib/syncFolder.ts`; Konto, `gastSync`, `linkTeilen`), `quelleHolen` in der Karte übernimmt ihn. „Folgt mir" (`lib/vorfuehren.ts`) trägt zusätzlich die Stelle im Vortrag (`vortrag`: Karte + Seite), die laufenden Tools (`apps`) und Rollstände (`zeigRoll`, als Anteil des Rollwegs, je Element über seinen Weg ab `<body>`). Die Brücke dafür steckt im Shim der Tools (`lib/htmlStore.ts`). Grenze: Fremde Webseiten (Live-URL) öffnen sich bei allen, aber Rollen und Klicken darin sind nicht übertragbar (Same-Origin-Policy); Eingaben in eigenen Tools werden ebenfalls nicht gespiegelt, nur das Rollen. Gäste mit Konto (Freigabe per E-Mail) bekommen den Quelltext noch nicht. |
| 57 | Entscheidungs-Bubbles (M373): neuer Kartentyp `bubbles` (`components/nodes/BubblesCard.tsx`, Daten und Regeln in `lib/bubbles.ts`), Vorbild `PhysicsBubbleBoard` aus `hannespix/pix-el`. Physik direkt auf dem DOM, ruht von selbst; Lage der Blasen je Gerät. Der eine Sonderfall im Abgleich: Viele schreiben gleichzeitig in EINE Karte — Ideen, Stimmen und Gruppen sind Einträge mit Zeitstempel und Grabstein, zwei Fassungen werden immer vereinigt (`bubblesMischen`: kommutativ, idempotent; eingehängt in `lib/syncMerge.ts` über `bubblesVereinen`, auch wenn das Board als Ganzes von einer Seite kommt). Die Karte nimmt keine Sperre (`data-ohne-sperre`). Der Server bleibt unverändert (er speichert die jeweils letzte Fassung; die Geräte reichen die vereinigte nach). `proOptions.hideAttribution` ist an (Schriftzug „React Flow" aus; xyflow bittet gewerbliche Nutzer in diesem Fall um ein Pro-Abo — eine Bitte, keine Lizenzbedingung). |
| 58 | Bilder rahmenlos (M374): Die Bild-Karte IST das Bild — `.react-flow__node-image` ohne Schatten, `.image-card.rahmenlos` ohne Fläche/Rand/Innenabstand; Griff, Anschlusspunkte und Lupe erst bei Auswahl (`CardShell` `ruhig` → `data-ruhig`), Name als Unterschrift außerhalb der Karte, Griffe halten das Seitenverhältnis (`seitenverhaeltnis` → `keepAspectRatio`). Alte Karten mit gezogener Höhe legen sich beim Laden einmal ans Bild an. `data.rahmen` holt die Karte zurück (⋯ der Auswahl-Leiste). Import: `lib/image.ts` erkennt Transparenz und legt verkleinerte Bilder dann als WebP/PNG statt JPEG ab; `makeImage` nimmt die Bildmaße und bläst kleine Bilder nicht auf. Prüfreihe `m374-bilder-rahmenlos`. |
| 59 | Live-Mauszeiger und Laserpointer (M375): `lib/mauszeiger.ts` sendet die Stelle des Zeigers über den Live-Kanal (Ereignis `maus`: Kennung, x/y in Board-Koordinaten, auf Folien als Anteil; Name und Farbe kommen aus der Anwesenheitsliste). Takt nach Gruppengröße (`zeigerTakt`: 90 ms zu zweit bis 0,7 s ab etwa fünfzig; Laser 70 ms), letzte Stelle kommt immer an, Abmelden beim Verlassen, Verfall nach 12 s (Laser 2,5 s). Anzeige `components/Mauszeiger.tsx`: `LiveZeiger` im ViewportPortal (höchstens 40, feste Größe über `scale(1/zoom)`, gleitet zwischen zwei Meldungen), `FolienLaser` als Schicht über der Folie (Taste L / Knopf „Laser"). Wer vorführt, zeigt einen Laserpunkt. Schalter in der Live-Leiste (`pixinotes-mauszeiger`). Server unverändert. Prüfreihe `m375-live-mauszeiger`. |
| 60 | Reaktionen und Timer für Gruppen (M376): `lib/gruppenraum.ts` — Reaktionen (Ereignis `reakt`: Kennung + eines von acht festen Zeichen; höchstens sechs in zwei Sekunden) und gemeinsamer Timer (Ereignis `timer`: Lauf-Kennung, RESTZEIT statt Endzeit, Dauer; der Starter wiederholt alle 3 s für Nachzügler; der spätere Start gilt; jeder darf anhalten; ein beendeter Lauf startet nicht neu). Anzeige `components/Gruppenraum.tsx`: `ReaktionsKnopf` (Live-Leiste, Kopf der Präsentation), `TimerKnopf` (Live-Leiste), `GruppenraumSchicht` (aufsteigende Symbole, Uhr oben in der Mitte — auch über der Präsentation). Nichts davon wird gespeichert; Server unverändert. Prüfreihe `m376-reaktionen-timer`. |
| 61 | Punkte auf Karten (M377): `lib/punkte.ts` — `data.punkte` je Karte als Tabelle Kennung → `{ n, t }` (ein Punkt je Person, zurückgenommen = n 0 als Grabstein), `punkteMischen` vereinigt zwei Fassungen je Person (die jüngere gilt). In `lib/syncMerge.ts` werden Punkte wie Bubbles-Inhalte IMMER vereinigt (`bubblesVereinen`); unterscheiden sich zwei Fassungen einer Karte nur in den Punkten, ist das kein Konflikt, und hat eine Seite nur Punkte vergeben, gilt der Inhalt der anderen. Anzeige `components/Punkte.tsx`: `PunkteMarken` (ViewportPortal, Zahl an der Kartenecke), `PunkteLeiste` (Punkte-Modus über Dock ⋯: Tipp auf Karte = Punkt, Rangliste, Zurücksetzen). Karten, die gerade ein anderer schreibt, nehmen keinen Punkt an (Hinweis). Server unverändert. Prüfreihe `m377-punkte-auf-karten`. |
| 62 | Ideen-Bubbles für Workshops (M378): Physik — Masse (Ausweichen umgekehrt zur Fläche), Wurf beim Loslassen, weiche Wände, gezogene Blase schwebt über den anderen; Anordnung — die Bühne wird nach Gewicht der Gruppen in Felder geteilt (`felderLegen`: fortgesetzte Zweiteilung entlang der längeren Seite), freie Ideen haben ein eigenes Feld, von Hand verschobene Gruppen bleiben (nur auf dem Gerät). Gruppieren mit der Hand — Blase auf Gruppe / auf Blase in Gruppe / auf freie Blase (Gruppe aus beiden oder Verschmelzen) / ins Freie; „＋ Gruppe", umbenennen, auflösen. Moderation — `regeln` (`zu`, `anonym`, `verdeckt`, `still`; als Ganzes die jüngste Fassung) und vier Schritte (`bubblesSchritt`), Liste statt Blasen, `bubblesAlsBloecke` (Ergebnis als Notiz), Timer aus der Karte. Verdeckt gesammelte Ideen verschmelzen erst nach dem Aufdecken (`blasenVon` mit `jeAutor`). Prüfreihe `m378-bubbles-workshop`. |
| 63 | Vorlagen für neue Boards (M379): `lib/vorlagen.ts` baut neun Vorlagen mit frischen Ids (Besprechung, Rückblick, Projektplan, Brainstorming, Aufgaben-Board, Wochenplanung, Entscheidung, SWOT, Workshop) — Karten beschriftet, aber ohne Beispiel-Inhalte. Dialog (`VorlagenDialog.tsx`, erst bei Bedarf geladen) mit Skizze je Vorlage; Einstiege: ＋ Neu → „Board aus Vorlage …" und Knopf auf dem leeren Board (füllt das Board, ein Undo-Schritt). Store: `boardAusVorlage`. | `pruefungen/m379-vorlagen.mjs` |
| 64 | Module als lebende Folie (M380): `WeekCard`, `TimeCard`, `MinutesCard`, `SheetCard` in Hülle (`…Card`, mit `CardShell`) und Inhalt (`…Body`) geteilt — wie zuvor Kanban, Gantt, Kalender, Bubbles. `Presenter.tsx` zeigt den Inhalt als Folie (`.slide-modul`, `data-taste="folie-week|time|minutes|sheet"`), `EDITABLE` um die vier Arten erweitert. Der Block-Editor des Wochenplans hängt am Dokument und liegt auf der Folie über der Präsentation (`.week-pop.auf-folie`). | `pruefungen/m380-module-als-folie.mjs` |
| 65 | Englische Oberfläche (M381): Kein Umbau aller Texte auf Schlüssel — `lib/sprache.ts` übersetzt die Oberfläche beim Entstehen: ein Beobachter setzt für jeden Textknoten und jedes Beschriftungs-Attribut (title, aria-label, placeholder, alt) die englische Fassung aus `src/sprache/en.json` ein (≈2 700 Einträge, eigenes Paket, nur bei Englisch geladen). Inhalte der Nutzer (translate="no", Editoren) bleiben; Vorlagen mit Einsetzungen sind Muster (`{0}`), deutsche Mehrzahl-Endungen werden zu „s". Dazu: `t()` für Rückfragen des Browsers und Texte außerhalb des Dokuments, Datumsformate 'de-DE' → 'en-GB', BlockNote-Sprache, KI-Antwortsprache, Startnamen. Sprache je Gerät (`pixinotes-sprache`), Wechsel lädt neu. Werkzeuge: `werkzeug/sprache-ernten.mjs` (erntet alle Texte aus dem Quelltext, `--fehlend` prüft das Wörterbuch), `werkzeug/sprache-bauen.mjs`, `glossar-en.md`, `sprache-nachtrag.json`, `sprache-ohne.json`. Hilfe-Texte bleiben vorerst deutsch (`data-sprache="aus"`). | `pruefungen/m381-englisch.mjs` |
| 66 | Englische Hilfe, Vorlagen und Standardnamen (M382): `HelpOverlayEn.tsx` — die Hilfe und „Was ist neu" als übersetzte Fassung von `HelpOverlay.tsx` (dieselben Abschnitte, Anker und Einträge; eigenes Paket, nur bei englischer Oberfläche geladen, `hilfeEnglischSetzen`). Vorlagen (`lib/vorlagen.ts`) und Standardnamen neuer Karten/Boards/Projekte/Bereiche (`lib/nodes.ts`, `store.ts`) laufen durch `t()`. Die Prüfung vergleicht die Marken „(M…)" beider Hilfe-Fassungen — ein neuer Eintrag muss in beiden stehen. | `pruefungen/m382-englische-hilfe.mjs` |
| 67 | Karten einzeln schreiben (M383): `board_aendern` (Migration `20261115100000_board_aendern.sql`) nimmt für Besitzer und Gäste mit Konto nur die geänderten Karten (Patch wie bei `gast_aendern`) und fügt sie unter der Zeilensperre ein — keine Vorbedingung, kein Neuschreiben des ganzen Boards. `kontoSync.ts`: Patch gegen den zuletzt eingearbeiteten Server-Stand (`patchFuer` in `gastPatch.ts`); Board-Angaben oder Reihenfolge geändert, Board neu oder Funktion fehlt → der bisherige Weg. Die Umgebung trägt danach „v<Version>" und den Zeitpunkt des Geräts; ihr Kern wird schlüsselsortiert verglichen (der Server legt sie als jsonb ab). Dabei behoben: Ein nur gelesener, noch nicht eingearbeiteter Stand („später", der Nutzer tippt) galt als bekannt — für geteilte Boards anderer Konten fehlte die Sperre ganz, und er wurde als Vorfahre der Zusammenführung genommen; schrieben Besitzer und Gast zugleich, löschte jeder die Karte des anderen. Jetzt zählt die Marke aus Umgebung und Fremd-Versionen (`kennMarke`), und Ring-Einträge tragen `drin`. Prüfreihe `m383-karten-einzeln.mjs`. | erledigt |
| 68 | Tools für das ganze Team (M384): (1) Gäste mit Konto bekommen Tool-Quelltexte und große Dateien — das Gerät des Besitzers legt signierte Adressen an der Freigabe ab (`board_freigaben.dateien`, wie `board_einladungen.dateien` für Gäste per Link; `anhaengeFreigeben` in `gastSync.ts`), der Gast holt, was ihm fehlt (`fremdAnhaengeHolen`: bei neuer Karte, bei Änderung der Freigabe über Realtime, sonst alle 30 s). Server ohne die Spalte: ein Versuch, dann Ruhe. (2) Eingaben in eigenen Tools reisen beim Vorführen mit: Die Brücke im Tool (`storageShim` in `htmlStore.ts`) meldet echte Eingaben — Feldwerte absolut, Klicks mit Stelle, Enter, Abschicken — und stellt die des Vorführenden nach; `vorfuehren.ts` prüft, bündelt (Text vor Knopfdruck, eine Nachricht bleibt klein) und merkt die Feldwerte für später Dazukommende. Nicht gespiegelt: Passwort- und Datei-Felder, Verweise; in frei beschreibbare Bereiche kommt nur Text. Prüfreihe `m384-tools-fuer-alle.mjs`. | erledigt |
| 69 | QR-Code zum Mitmachen (M385): Der Einladungslink eines Boards als QR-Code — groß in der Mitte für den Raum oder klein in einer verschiebbaren Ecke, die über Board und Folien-Präsentation stehen bleibt (`QrBlende.tsx`, eigenes Paket samt `qrcode-generator`, erst beim Aufruf geladen; `lib/qr.ts`). Aufruf: „QR-Code" neben dem Link im Freigabe-Dialog, Knopf in der Leiste der Anwesenden (auch für Gäste — `einladungVon` in `gastSync.ts`), Strg+K. Immer Schwarz auf Weiß mit Ruhezone, Fehlerkorrektur M; zählt die Anwesenden; verschwindet, wenn der Link widerrufen wird. Der Code entsteht im Browser. Prüfreihe `m385-qr-code.mjs` liest den eingeblendeten Code mit einem QR-Leser (jsQR) zurück und lässt ein Telefon darüber beitreten. Dazu `farbenVerteilen` (`gastSync.ts`): Anwesende bekommen nie dieselbe Farbe — jeder meldet weiter seine mitgebrachte, alle Geräte verteilen aus derselben Liste gleich (der Reihe der Kennungen nach die nächste freie). Vorher traf es bei zwei Leuten in jedem achten Fall dieselbe; daran scheiterte auch m375 A12 gelegentlich. | erledigt |
| 70 | Bubbles am Smartphone bearbeiten (M386): Das Feld zum Ändern einer Idee nahm den Text nur mit der Enter-Taste an — die Telefon-Tastatur bietet dort nur „Weiter". Jetzt `IdeeFeld` (`BubblesCard.tsx`): ✓ übernimmt, ✕ verwirft, Verlassen des Felds übernimmt; `enterKeyHint`. Die Leiste zur gewählten Blase/Gruppe (`Pille`) steht auf schmalen Bildschirmen per Portal fest am unteren Bildschirmrand, über der Tastatur (`--kb`). Neue Gruppe: ✓ neben dem Feld. Allgemein `lib/telefonTastatur.ts`: einzeilige Felder ohne Formular bekommen beim Fokus `enterkeyhint="done"`. Prüfreihe `m386-bubbles-am-telefon.mjs` (Finger-Emulation). | erledigt |
| 71 | Präsentation nimmt das Publikum mit (M387): Startet der Besitzer die Präsentation und sind andere im Board, führt er damit vor (`vorfuehrenMitVortrag`, `Presenter.tsx`) — auch wenn das Publikum später kommt; abwählbar mit „Team folgt" (`pixinotes-vortrag-allein`), Gäste weiter per Knopf. Eine in der Präsentation begonnene Vorführung endet mit ihr. Zur Ansicht (`lib/vorfuehren.ts`, Meldung `zeig`) gehören jetzt `vortrag.ansicht` (Ansicht, Zoom, Rollstand als Anteil; `DokumentFolie`, lange Folien), `fokus` (Karte im Fokus) und `dok` (aufgeklappte Dokument-Karten mit Seite; `DokumentBefehl` `zeige`/`zuklappen`). Behoben: ohne gemessenen Ausschnitt ging nichts hinaus („Team mitnehmen" ohne vorheriges Vorführen); eine geänderte Folienzahl setzte die Stelle auf Folie 1 und warf aus dem Vollbild; der Namens-Dialog lag hinter der Präsentation. Prüfreihe `m387-praesentation-fuer-alle.mjs` (Laptop + Telefon + Spät-Dazukommende). | erledigt |
| 72 | Code-Audit (M388, Liste in `docs/AUDIT.md`): Eingang von außen läuft über `lib/sicher.ts` (`boardVonAussen`, `kartenVonAussen`, `karteEntschaerfen`, `fremdeWebAdresse`, `wordEntschaerfen`) — geteilte Links, Dateien, Konto-/Gast-Abgleich, Live-Kanal (`patchSaeubern`, `zeig` nur von Anwesenden). Server: Trigger `konto_dateien_inhalt_pruefen` (Migration `20261116100000_inhalt_pruefen.sql`) prüft, was ein Gast in ein Board schreibt. Store: Kommentare im Rückgängig-Schritt (`kommentareNach`), Hinweis-Knopf `undo: 'schritt'`, `undoImport` nur das Importierte, `anhaengeMitnehmen` beim Duplizieren (`lib/anhangKopie.ts`). Abgleich: `NetzFehler` ≠ abgemeldet, `KONTO_DIRTY_KEY` bleibt beim Abmelden, `vereinen` ohne Basis, `mein()` filtert nach Besitzer, Gast-Schreiben wiederholt sich, Anhänge-Adressen 30 Tage. Bedienung: `lib/overlay.ts` (`overlayOffen`) für alle Board-Kürzel, `lib/tag.ts` (`tagLokal`), `lib/zielBoard.ts`, Autofokus nur für frische Notizen (`warEbenAngelegt`). Rechnen: `formel.ts` (leere Zellen, WENN, RUNDEN, $), `xlsx.ts` (geteilte Formeln, Zeiten, Datumsformate). Build: `noUnusedLocals`/`noUnusedParameters`; `fahne.ts`, `seed.ts` und 26 tote Exporte entfernt. | `m388-code-audit.mjs` (35), `m388b-sql-inhalt-pruefen.mjs` (24) |
| 73 | UI-Audit (M389, Liste in `docs/AUDIT.md` §2): Farb-Stufen — `--accent-fill` ist die Fläche unter weißer Schrift (4,6:1 in allen fünf Akzenten), `--accent-strong` der Akzent als Schrift (im Dunkeln je Akzent heller); `--accent` selbst bleibt für Rahmen, Linien, Marken. Fenster: `lib/fensterFokus.ts` (ein Beobachter für alle `.modal-backdrop` u. a.: Fokus hinein, Tab im Kreis, Fokus zurück). `TooltipLayer` sichert den Namen als `aria-label`, wenn `title` in die Sprechblase wandert. Übersicht schmal (`layoutHierarchy(…, schmal)`): Projekte untereinander, zwei Spalten, Ansicht an die Breite gesetzt statt eingepasst; Mini-Karten öffnen am Finger das Board. Kartenmenü klemmt unter `.focus-head`. Mermaid: Diagramm immer ganz in der Karte, `.mm-schlicht` (kein Farbschema) mit festen Konturen. Tippziele: Block „M389" am Ende von `index.css`. 38 tote CSS-Klassen entfernt. | `m389-ui-audit.mjs` (33) |
| 74 | Logik-Audit (M390, Liste in `docs/AUDIT.md` §3): Fristen-Anker — `data.fristAnker` (Block → [Tag, Text]) hält fest, wann eine relative Angabe geschrieben wurde; `lib/fristAnker.ts` pflegt und liest ihn, `detectDates(text, jetzt, anker)` rechnet relativ zum Anker und bewertet gegen jetzt. Verlauf: `schritt(schlüssel)` fasst gleichartige Handgriffe zusammen, `verschiebeUm`/`dupliziere` sind je ein Schritt (Rahmen-Inhalt und Verbindungen inklusive), `hinweisRueckgaengig` nimmt genau die gemeldete Handlung zurück, `textRueckgaengig` hält das Editor-Rückgängig aus dem Board-Verlauf heraus. `Tastatur.tsx`: hinter `overlayOffen()` wirkt keine Board-Taste. Planung: Erledigt-Spalte geschützt, Zentrale hakt Protokoll-Punkte ab, Zeiterfassung teilt an Mitternacht, alle Tages-Rechnungen in Ortszeit (`tagLokal`), `alsZahl` liest Tausenderpunkte und lässt Kennungen Text sein, `zurueckAm` startet die Archiv-Frist neu. Ein-/Ausgabe: Sicherung und Board-Datei mit Vorlagen und Anhängen (`dateienVonKarten`, `boardDateienUebernehmen`), `anhaengeMitnehmen` beim Kopieren, `.txt` wörtlich, Markdown-Export maskiert. WebDAV schreibt mit `If-Match` (Rückfall, wenn CORS es nicht erlaubt). CSS: Maße an der Bildschirmhöhe durch `--pn-anz` geteilt. | `m390-logik-audit` |
| 75 | Team-Audit (M391, Liste in `docs/AUDIT.md` §4): `FreigabeDialog` — ein Hauptknopf, Vorgabe „ohne Konto", Optionen und E-Mail-Einladung in `<details>`, ein Satz (`einladung-satz`) fasst die Einstellungen; ohne Konto führt er zur Anmeldung; `FreigabeHost` + Ereignis `pixinotes:freigabe-oeffnen` öffnen ihn von überall. `LiveLeiste` — ein Knopf (wer ist da) öffnet die Liste mit den Werkzeugen der Gruppe (`live-einladen`, `live-qr`, `vorfuehren`, `live-maus`, `TimerZeile`, `live-ich`); sichtbar bleibt nur „Reagieren". `EbenenMenu`: Punkt immer da, für Gäste „Verlassen …" statt Umbenennen/Archivieren/Löschen, „Kopie per Link teilen". `Navigation`: reine Gäste sehen keine leeren eigenen Bereiche. Rechte: `gruppenschutz` stempelt Verbindungen (`data.von`) und hält fremde fest; Server-Gegenstück `gast_stuecke_pruefen` in Migration `team_haertung` (dazu Stempel-Länge, kein Anlegen über `freigabe_schreiben`, Sperr-Reihenfolge in `konto_schreiben`). `liveKanal`: Ablehnung, `phx_error`/`phx_close` und Schließen bauen die Leitung neu auf, ohne auf das Schließen-Ereignis zu warten. | `m391-team-audit`, `m391b-sql-team-haertung` |
| 76 | PDF-Schärfe und rahmenlose Fotos (M392): `lib/boardZoom.ts` meldet den Board-Zoom (`boardZoomMelden` aus `Board.tsx`, Ereignis `pixinotes:board-zoom`) und liefert `zoomStufe()` (Leiter 1 · 1,5 · 2 · 3 · 4 · 6 · 8); `renderPdfPage(…, stufe)` malt Kartenbreite × Schirmdichte × Stufe, gedeckelt (4096 px breit, 8 Mio. Punkte), in einen Puffer und tauscht in einem Zug (kein leeres Aufblitzen); `useMalStufe` in `FileCard.tsx` gibt die Stufe nur Karten im Blick (IntersectionObserver), außer Sicht fällt sie nach 2 s auf 1. Bild-Dateien (`file` mit `vorschauArt === 'bild'`) erscheinen wie `image` rahmenlos (`.image-card.rahmenlos.datei-bild`), `FileData.rahmen` schaltet den Rahmen zurück (⋯ → „Mit Rahmen"); Speicher-voll-Hinweis nur einmal je Sitzung | `m392-pdf-schaerfe-bilder` |
| 77 | Tool im Vollbild ohne Leiste (M393): `lib/randLeiste.ts` (`useRandLeiste`) — eine Leiste, die sich an den oberen Rand zurückzieht: kurz sichtbar beim Eintritt, dann nur bei Zeiger/Finger am Rand (Greifkante `::after`), Ausblenden nach Zeit statt nur per `:hover` (aus einem fremden Rahmen meldet der Browser das Verlassen nicht verlässlich), Tastaturfokus hält sie offen. Genutzt in `HtmlAppCard` (`.happ-full:fullscreen .happ-head`, im Vollbild Knopf `happ-vollbild-zu` statt ⋯) und in `Presenter` (Tool-Folie `.presenter-slide.app` füllt den Schirm, Kopfzeile am Rand, Fußzeile bleibt) | `m393-tool-vollbild` |
| 78 | Stift und Kommentare in der Präsentation (M394): `FolienStift.tsx` — Zeichenschicht als Geschwister über der Folie (misst sich je Bild an Folie und Zeichenfläche aus; alle Maße sind Verhältnisse). Dokument-Folie: Seitenpunkte, gewöhnliche Seiten-Anmerkungen (`seite`, `seitenBreite`), `DokumentFolie` malt sie; `data-mass` an `.folie-dok-seite`. Jede andere Folie: Striche der Folie — `anchor` = Karte, `seite: FOLIEN_SEITE` (−1), Tausendstel der Inhaltsbreite; das Board zeigt sie nicht (Seite −1 ist nie offen). Store: `addStrokeFertig`, `eraseStrokesById` (ein History-Eintrag je Radier-Geste). Stiftgeräte: Stift schreibt, Finger rollt. `Presenter`: Knöpfe `vortrag-stift`/`vortrag-kommentare`, Palette `folien-palette` nur bei gewähltem Werkzeug, Tasten P/M/E/K, Esc-Reihenfolge Stift → Spalte → Präsentation. `FolienKommentare.tsx`: Spalte mit den Gesprächen der Karte bzw. Seite (antworten, erledigen, neu), Pins auf Dokument-Seiten in der Zeichenschicht | `m394-stift-im-vortrag` |
| 79 | Bildbearbeitung (M395), ohne Bibliothek: `lib/bildBearbeiten.ts` — Kette verpixeln (Rechtecke im ursprünglichen Bild) → ausrichten (Vierteldrehung, spiegeln, gerade richten mit Deck-Zoom) → zuschneiden → anpassen (Helligkeit/Kontrast/Sättigung Punkt für Punkt, kein `ctx.filter`); Ausschnitt und Rechtecke als Bruchteile, Vorschau an der Arbeitsfassung (1400 px), Ergebnis am Original (höchstens 3200 px), PNG bleibt PNG, Fotos JPEG. `BildEditor.tsx` (bei Bedarf geladen): Rahmen mit acht Griffen, feste Formate, Drehen/Spiegeln, Regler, „Automatisch", Verpixel-Modus. `BildEditorHost.tsx`: Ereignis `pixinotes:bild-bearbeiten`, `bildBearbeitbar` (nicht bei „nur lesen"/fremden Karten). Store `bildErsetzen`: ein Rückgängig-Schritt, Karte behält die Breite; Bilder aus der Geräte-Ablage ziehen auf eine NEUE Kennung um (Anhänge hängen beim Abgleich an der Kennung) — Verbindungen, Striche, Kommentare, Ticket-Verweise ziehen mit. Einstieg: Knopf `bild-bearbeiten-auf` am Bild, ⋯ → „Bild bearbeiten …". Nebenbei: `DokumentFolie`, `FolienStift`, `FolienKommentare` werden erst beim Präsentieren geladen (`lib/dokumentArt.ts`, `lib/folienWerkzeug.ts` halten das Wenige, das die Präsentation vorher wissen muss) — der Kern bleibt unter 1,5 MB | `m395-bild-bearbeiten` |
| 80 | Finger-Gesten in der Präsentation (M396): `FolienStift` verfolgt die aufliegenden Finger — Handballen (Berührung während eines Stift-Zugs) wird übergangen, der Stift übernimmt auch von einem schiebenden Finger; zwei Finger schieben (Mitte) und kneifen (`FOLIE_ZOOM` → `DokumentFolie.zoomen` um die Mitte), ein zweiter Finger verwirft den begonnenen Finger-Strich; schneller Wisch mit einem Finger blättert (`onWisch`). `lib/tippGesten.ts` (`useTippGesten`): Zwei-/Drei-Finger-Tipp und -Halten = Rückgängig/Wiederholen, in `Presenter` für Folie und Zeichenschicht (nicht in Textfeldern/Leisten), mit dem Schalter `fingerGesten`; ein Stift-Zug meldet sich am `<body>` (`data-stift-zug`) | `m396-gesten-im-vortrag` |
| 81 | Ohne Emojis (M397): `werkzeug/ohne-emoji.mjs` (liest den Quelltext als Syntaxbaum; `--liste`, `--schreiben`, `--pruefen`) nimmt Emojis aus allen Texten der App, macht aus dem Zahnrad im Satz das Wort „Einstellungen“ und aus dem Geviertstrich den Halbgeviertstrich; allein stehende Zeichen sind durch gezeichnete Symbole ersetzt (`Icons.tsx`, `KartenSymbol.tsx`: Karten- und Datei-Art). Emojis bleiben nur im Inhalt der Nutzer und bei den Reaktionen (`lib/gruppenraum.ts`). `alteNamenOhneEmoji()` nimmt einmal je Gerät den Vorsatz von Namen, die die App selbst vergeben hat. Leeres Board als Textblock (`.leer-block`, am Finger ohne Maus-Wege), `theme-color` = App-Grund, Wortmarke einfarbig, App-Symbole flach (`werkzeug/app-zeichen.mjs`), KI-Knöpfe und Portal-Karte in den Akzent-Tokens statt eigenem Violett; die KI-Anweisungen verbieten Emojis. | `m397-ohne-emoji` |
| 82 | Projekte und Bereiche mit Inhalt löschen (M398): `removeProject`/`removeSpace` nehmen `mit` (`{ boards: 'loeschen' }` oder `{ boards: 'behalten', ziel }`), gemeinsamer Helfer `ebeneLoeschen` im Speicher. Der Stand davor liegt in `ebenenUndo` (nur für die Sitzung); die Meldung trägt `undo: 'ebene'`, `ebeneZurueck()` setzt Projekt/Bereich und Boards an ihre Stelle zurück (Grabsteine zählen nur, was fehlt). Boards anderer Konten bleiben und ziehen in ein Auffang-Projekt; bleibt kein sichtbares Board, entsteht ein leeres. Oberfläche: `EbeneLoeschenDialog.tsx` (`ebeneLoeschenFragen` – leer ohne Rückfrage, sonst Dialog über das Ereignis `pixinotes:ebene-loeschen`). Nachtrag zu M397: `font-variant-emoji: text` für Zeichen wie ↩ ▶ ☑, weitere Bildzeichen in der Regel. | `m398-ebene-loeschen` |
| 13 | Stift wie auf Surface und iPad: Stift schreibt, Finger bedient (auch im Auswahlmodus, auf Fläche und Notizen), Tipp = Klick, Radierer-Ende radiert immer, Seitentaste greift Karten, Teil-/Strich-Radierer, getippten Text per Kritzel/Durchstreichen löschen und per Schleife markieren, Handschrift inline zwischen Wörtern, Zwei-/Drei-Finger-Tipp = Rückgängig/Wiederholen, zweiter Finger rastet Form ein (Procreate) | M325 |
| 12 | Stift & Handschrift 2: Vorschlag nach Schreibpause, Ziel-Logik (in die Notiz darunter an passender Stelle / neue Notiz), KI-Korrektur mit Kontext, Umkreisen markiert, Durchstreichen löscht, schnelleres Einrasten, Strichstärke | M324 |
| 11 | Notiz nachgeschärft: Titelzeile (ein Helfer statt sechs), Farbpalette, Checklisten-Fortschritt, Auto-Größe schrumpft und ignoriert das „/"-Menü, deutsche Kurzdaten, Vorlagen und Heute im „/", Strg+V-Text → Notiz, extEpoch bei externen Block-Schreibern, Lesetypografie im Fokus | M323 |
| 10 | Start & Leistung: Mermaid-Rohtext (3,5 MB) und E-Mail-Parser erst bei Bedarf, Fremdcode in stabile Pakete (react · editor · fluss), einmaliges Neuladen bei veralteten Chunk-Namen; Start-JS 6,3 MB → 3,4 MB | M321 |

Jede Etappe wird einzeln geprüft (Playwright-Reihe), gebündelt und in den
Hauptzweig gemergt.

## 5. Sync über ein Konto (Antwort auf „Firebase?" und „so wenig Einrichtung wie möglich")

Gewählt wird **nicht Firebase**, sondern der **Konto-Sync** (M317): Anmeldung mit
**Google** oder **Microsoft** per OAuth, die Daten liegen im **App-Ordner des
eigenen Google Drive bzw. OneDrive** (`appDataFolder` / `approot`). Gründe:

- **Null Einrichtung für Nutzer**: ein Klick „Mit Google anmelden" — kein Projekt,
  keine Regeln, keine Adresse, kein App-Passwort.
- **Daten bleiben beim Nutzer**: im eigenen Cloud-Konto, nicht in einer Datenbank
  des Betreibers. Keine Speicherkosten, keine Quoten, keine Datenschutz-Last für
  den Betreiber. Das passt zu „alles bleibt bei dir".
- **Die Anmeldung gibt es schon**: Die Kalender-Konten (`src/lib/calAccounts.ts`)
  melden sich bereits bei Google (GIS-Token) und Microsoft (PKCE mit Refresh-Token)
  an. Der Sync nutzt dieselben Client-IDs mit einer zusätzlichen Berechtigung
  (`drive.appdata` bzw. `Files.ReadWrite.AppFolder`) — beides „nicht sensibel",
  also ohne Google-Verifizierung veröffentlichbar.
- **Dieselbe Zusammenführung**: `SyncWeg` + `fremdStandEinarbeiten` aus M311.
  Ablage je Board (`board-<id>.json`) plus `umgebung.json` (Bereiche, Reihenfolge,
  Stempel je Board); Dateien (PDF, Bilder) als echte Binärdateien im App-Ordner.
  Abgleich: alle 10 s ein Mini-Abruf der Metadaten von `umgebung.json`
  (modifiedTime / eTag), erst eine Änderung lädt die betroffenen Boards.

**Firebase** bleibt zweite Wahl: eigenes Projekt, Auth-Provider, autorisierte
Domains, Sicherheitsregeln — und alle Notizen aller Nutzer in einem Projekt des
Betreibers. Mehr Einrichtung, mehr Verantwortung, kein Gewinn für den Zweck.
Sollte später ein Echtzeit-Team-Board gewünscht sein, wäre ein Dienst mit
Live-Abonnements (Firestore, Supabase) der richtige Ort — als Ergänzung, nicht
als Ersatz.

**Einrichtung durch den Betreiber (einmalig)**:

1. Google Cloud Console → APIs & Dienste → Anmeldedaten → OAuth-Client
   „Webanwendung"; autorisierte JavaScript-Quelle = die Adresse der App
   (GitHub Pages). Berechtigung `drive.appdata` ist „nicht sensibel".
2. Microsoft Entra → App-Registrierung „Single-Page-Anwendung"; Umleitungs-URI =
   Adresse der App; API-Berechtigung `Files.ReadWrite.AppFolder` (delegiert).
3. Beide IDs als Repository-Variablen setzen (`VITE_GOOGLE_CLIENT_ID`,
   `VITE_MS_CLIENT_ID`, optional `VITE_MS_TENANT`); der Pages-Workflow reicht sie
   in den Build. Ohne Variablen zeigt die App das Feld „Einmalig vom Betreiber".

**Ablage im App-Ordner**: `umgebung.json` (Bereiche, Reihenfolge, Stempel je
Board, Dateiliste) · `board-<id>.json` je Board · `datei-<id>` je Anhang (≤ 4 MB).
Lokal merkt sich PixiNotes die zuletzt gesehene Server-Kenntnis (`konto:kenn`
in IndexedDB); geschrieben wird nur Geändertes, gelesen nur Fremdes. OneDrive
prüft beim Schreiben der Umgebung den eTag (If-Match). Drive kennt keine
Vorbedingung — deshalb nennt jede `umgebung.json` den Stand, auf dem sie
aufbaute (`basisEtag`), und jedes Gerät hält einen kleinen Ring der zuletzt
gesehenen Server-Stände (`konto:basen`). Überschreiben sich zwei Geräte, wählt
der Leser den genannten Vorfahren als Basis der Drei-Wege-Zusammenführung;
nichts geht verloren, beide Anteile landen beim nächsten Takt wieder im Konto.

**Grenzen, ehrlich**: Die portable Einzeldatei (`file://`) kann keine OAuth-
Anmeldung — dort bleiben Ordner, WebDAV und Datei. Google-Tokens leben eine
Stunde; die Verlängerung läuft still beim nächsten Klick in der App.

### 5a. Eigenes Konto mit E-Mail (M328)

Der Wunsch: „mich mit einem Account anmelden, auch auf Geräten ohne Nextcloud,
Google Drive etc. — ein richtiges Online-Tool." Antwort: **Supabase als dritter
Anbieter des Konto-Syncs**, kein Umbau.

- **Für Nutzer**: unter ⚙ → Daten → Konto eine E-Mail eintippen → „Anmelde-Link
  per E-Mail" (Magic Link, kein Passwort) oder darunter „Mit Passwort". Die
  Rückkehr über den Link liest `#access_token=…` aus der Adresse
  (`sbRueckkehrLesen`) und meldet das Gerät an. „Konto löschen" entfernt Konto
  und Daten (RPC `konto_loeschen`, security definer).
- **Ablage**: eine Tabelle `konto_dateien` (user_id, name, inhalt, mime,
  groesse, version, updated_at), je Zeile eine „Datei" — exakt die Struktur des
  App-Ordners (`umgebung.json`, `board-<id>.json`, `datei-<id>` als Base64).
  Deshalb laufen `kontoLesen`/`kontoWrite`/`kontoVerbinden` und die Drei-Wege-
  Zusammenführung unverändert; neu ist nur das Laufwerk (`supabaseLaufwerk`,
  PostgREST ohne SDK). `version` zählt per Trigger hoch und ist der eTag:
  bedingtes Schreiben = PATCH mit `version=eq.N`, leere Antwort = Vorbedingung
  verletzt; Erstanlage = INSERT, 409 = ein anderes Gerät war schneller.
- **Sicherheit**: Row Level Security auf `user_id = auth.uid()`; im Browser nur
  der öffentliche Anon-Key (Repository-Variablen `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`, sonst einmalig in den Einstellungen).
- **Live**: ein minimaler Phoenix-Kanal (`sbRealtime`, WebSocket) auf die
  eigenen Zeilen; eine Änderung an `umgebung.json` stößt den Abgleich nach
  400 ms an. Fällt der Kanal aus, bleibt der 10-Sekunden-Takt; Wiederverbinden
  mit wachsender Pause bis 60 s.
- **Token**: Access-Token eine Stunde, stille Erneuerung über den Refresh-Token
  (`sbErneuern`) in `tokenHolen`; Realtime bekommt das neue Token nachgereicht.
- **Betreiber, einmalig**: Supabase-Projekt (Region Frankfurt), Migration
  `supabase/migrations/20261106120000_konto_dateien.sql` im SQL-Editor
  ausführen, Authentication → E-Mail an, Site-URL = Adresse der App, beide
  Variablen setzen. Gratis-Tarif: 500 MB Datenbank, 50.000 aktive Nutzer/Monat.
  Datenschutz: Auftragsverarbeitungsvertrag mit Supabase (Dashboard), Hinweis
  in der Hilfe (Datenschutz-Abschnitt).
- **M329 — Anhänge im Dateispeicher**: Bucket `pixinotes` (privat, 50 MB je
  Datei), Pfad `<user_id>/datei-<id>`, vier Policies auf `storage.objects` über
  `storage.foldername(name)[1] = auth.uid()`. Das Laufwerk schreibt und liest
  `datei-*` dort (Rückfall: Tabelle für Stände vor M329); `stapel` lädt Anhänge
  zuerst hoch, ruft dann `konto_schreiben(p_dateien, p_umgebung, p_wenn_version)`
  und löscht Verwaistes danach selbst (die Funktion enthält kein DELETE mehr —
  so lässt sie sich ohne Rückfrage einspielen). Der Beipack enthält beim
  eigenen Konto nur noch unbekannte Dateien; die Umgebung trägt je Anhang die
  Größe, Anhänge > 8 MB lädt erst die Karte (`kontoDateiNachladen`).
- **M330 — Geteilte Boards**: Tabelle `board_freigaben` (besitzer, board_id,
  gast_email, gast_id, rolle). Der Besitzer legt eine Zeile mit der E-Mail an;
  `freigaben_annehmen()` übernimmt sie beim Gast, sobald er sich mit dieser
  E-Mail anmeldet (Abgleich jedes `kontoLesen`). Der Gast liest die Board-Zeile
  des Besitzers (Policy „Gast liest freigegebene Boards") und schreibt sie über
  `freigabe_schreiben` (security definer: prüft die Freigabe, Vorbedingung auf
  die Version der Board-Zeile, trägt Stempel und `savedAt` in die Umgebung des
  Besitzers ein, dessen Geräte sehen den Stand wie eine eigene Änderung).
  Client: `BoardDoc.geteiltVon`, `kenn.fremd` je Board (Version, Stempel),
  `kontoLesen` hängt fremde Boards an und legt sie unter „Geteilt mit mir"
  (ein Projekt je Besitzer) ab, `kontoWriteRoh` hält sie aus der eigenen
  Umgebung heraus; Realtime lauscht zusätzlich auf die Zeilen der Besitzer
  (RLS filtert) und auf `board_freigaben`. Verlorene Freigabe = eigene Kopie.
  Tipp-Pause 1 s bei verbundenem Realtime. Grenze: Anhänge geteilter Boards
  liegen im Ordner des Besitzers und reisen (noch) nicht mit.
- **Später möglich**: Anwesenheit und Cursor (Realtime Presence/Broadcast),
  gemeinsames Tippen in einer Notiz (Yjs über Broadcast; BlockNote kann Yjs),
  Lese-Rolle in der Oberfläche, Anhänge geteilter Boards (Storage-Policy über
  die Freigabe), fortsetzbare Uploads (TUS) über 50 MB, OneDrive-Upload-
  Sitzungen über 4 MB, Google/Microsoft-Login über Supabase.


## Stift-Konzept (M325) — was wir von Procreate, OneNote, Nebo und Scribble übernehmen

Quellen: Procreate-Handbuch (Gesten, Gesture Controls, Undo/Redo), Microsoft OneNote (Stift-Seitentaste = Lasso/Greifen, Strich- vs. Flächen-Radierer), MyScript Nebo (Kritzel und Durchstreichen löschen, Schleife markiert, senkrechter Strich teilt), Apple Scribble (Kritzel löscht, Umkreisen markiert), W3C Pointer Events (Radierer-Ende `buttons = 32`, Seitentaste `buttons = 2`).

**Die eine Regel: Der Stift schreibt, der Finger bedient.** Procreate kennt kein „Zeichenwerkzeug einschalten": Der Pencil malt immer, Finger zoomen, schwenken und tippen Gesten. Übertragen auf PixiNotes:

| Eingabe | Auf freier Fläche | Auf einer Notiz | Auf Modul-Karten (Kanban, Tabelle …) | Auf Bedienelementen |
|---|---|---|---|---|
| Stift zieht | schreibt | schreibt (geankert) | normaler Zeiger (Modul bedienen) | normaler Zeiger |
| Stift tippt kurz | wählt ab | Cursor setzen, Haken, Karte wählen | Klick | Klick |
| Stift + Seitentaste | normaler Zeiger | greift die Karte (ziehen) | greift die Karte | — |
| Radierer-Ende | radiert | radiert | radiert | — |
| Finger zieht | schwenkt | zieht die Karte | zieht/bedient | bedient |
| Zwei Finger | zoomt/schwenkt; kurzer Tipp = Rückgängig, halten = schnell zurück; schnelles Zusammenziehen = Alles einpassen (M326: überall) | | | |
| Drei Finger | kurzer Tipp = Wiederholen, halten = schnell vor; nach unten wischen = Duplizieren / ＋-Palette (M326) | | | |
| Vier Finger | kurzer Tipp = Vollbild an/aus (M326) | | | |

Seit M326 übernommen: Zwei-/Drei-Finger halten (schnelles Zurück/Vor), Quick-Pinch (Einpassen, zurück), Vier-Finger-Tipp (Vollbild), Drei-Finger-Wischen nach unten (hier: Duplizieren bzw. ＋-Palette statt Kopieren/Einfügen). Bewusst **nicht** übernommen: Pinch-Drehen (die Fläche hat keine Drehung) und das Drei-Finger-Scrubben (Ebene leeren). Nebos senkrechter Trenn-/Verbinde-Strich: zu leicht mit einem „l" oder „I" zu verwechseln.

**Radierer**: Teil-Radierer als Standard (nimmt nur die berührten Punkte, der Strich zerfällt in Teilstücke), Strich-Radierer als zweite Art (OneNote). Eingerastete Formen verschwinden immer ganz.

**Getippten Text mit dem Stift bearbeiten** (Nebo/Scribble): Kritzel über Wörtern oder ein waagerechter Strich durch die Wortmitte löscht sie; ein Strich unter der Zeile bleibt eine Unterstreichung; eine kleine Schleife markiert Wörter (die Formatierleiste erscheint). Die Wörter werden im DOM vermessen (`lib/stiftText.ts`), die Blöcke danach über den Store geschrieben (extEpoch) — der Editor übernimmt.

**Handschrift zwischen getipptem Text**: Steht die Schrift in einer Zeile, wird sie dort eingefügt (Zeilenanfang, Wortgrenze, Zeilenende), sonst als Block nach dem Block darunter (M324).
