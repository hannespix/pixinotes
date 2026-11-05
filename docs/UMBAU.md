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

**Grenzen, ehrlich**: Die portable Einzeldatei (`file://`) kann keine OAuth-
Anmeldung — dort bleiben Ordner, WebDAV und Datei. Google-Tokens leben eine
Stunde; die Verlängerung läuft still beim nächsten Klick in der App.
