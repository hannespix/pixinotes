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
**＋** bleibt wie in M296 (fünf Einträge, „Weitere Module", Vorlagen).  
**⋯** ist das Board-Menü: Anordnen … · Hintergrund … · KI-Assistent … ·
Präsentieren · Als Bild exportieren · Alles einpassen.  
Weg: „Aufgaben" (steht in der Spalte), „Präsentieren" als eigener Knopf,
„Aufräumen" (war „Fluss horizontal" ein zweites Mal), „Archiv einblenden" (steht am
Fuß des Baums), die Zoom-Knöpfe unten links (Mausrad, Pinch, Taste F, ⋯ → Alles
einpassen).

### Karte
Kartenkopf: Griff und Verbindungs-Punkte, kein ✕ (Löschen: Leiste oder Entf).  
Auswahl-Leiste: `Duplizieren · Teilen · ⋯ · Löschen`.  
⋯: Kommentar · Eigenschaften … (Farbe, Schrift & Größe, Auto-Größe, Schlüssel=Wert)
· In Board verschieben … · Nachschlagen · Als Vorlage speichern · KI … ·
Ausrichten … (ab 2) · Als Kachel (Module) · Archivieren.  
„Formatiert kopieren" lebt nur noch im Teilen-Dialog.  
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

## 4. Etappen

| Etappe | Inhalt | Nummer |
|---|---|---|
| 1 | Rahmen: Kopfleiste, Spalte, Dock, Übersicht, Kartenkopf ohne ✕, Zoom-Knöpfe weg | M312 |
| 2 | Karte: Auswahl-Leiste und ⋯ neu geordnet, Modul-Köpfe ≤ 2 Symbole + ⋯ | M313 |
| 3 | Einstellungen auf drei Reiter, Optionen automatisiert, Hilfe/Begrüßung angepasst | M314 |
| 4 | Sync über Firebase als vierter Weg | M315 |

Jede Etappe wird einzeln geprüft (Playwright-Reihe), gebündelt und in den
Hauptzweig gemergt.

## 5. Firebase als Sync-Weg (Antwort auf „geht das?")

Ja, als **wählbarer Weg neben Ordner und WebDAV**, mit derselben
Drei-Wege-Zusammenführung aus M311.

- **Speicher**: Cloud Firestore. Je Nutzer ein Dokument `umgebungen/{uid}` mit
  Bereichen/Projekten und je Board ein Dokument `umgebungen/{uid}/boards/{boardId}`
  (Firestore-Grenze 1 MB je Dokument; ein Board passt, die ganze Umgebung nicht).
  Dateiinhalte (PDF, Bilder) in Cloud Storage unter `dateien/{uid}/{kartenId}`.
- **Anmeldung**: Firebase Auth, Google-Konto oder E-Mail-Link; anonyme Anmeldung
  für „nur dieses Gerät" ist möglich, aber kein Sync.
- **Live statt Abfrage**: `onSnapshot` liefert Änderungen anderer Geräte sofort;
  der Offline-Cache von Firestore puffert ohne Netz. Schreiben je Board, nicht als
  Ganzes — das halbiert Konflikte von vornherein; Konflikte derselben Karte löst
  `dreiWegeMerge` mit dem zuletzt gesehenen Serverstand als Basis.
- **Regeln**: `allow read, write: if request.auth.uid == uid` — jeder sieht nur
  seine Umgebung. Team-Sync je Projekt wäre später eine Mitgliederliste am
  Projekt-Dokument.
- **Einrichtung**: PixiNotes braucht die Web-Konfiguration eines Firebase-Projekts
  (apiKey, projectId …). Die ist kein Geheimnis, aber je Betreiber verschieden;
  sie wird unter Daten → Synchronisation → Firebase eingetragen (oder als
  Voreinstellung in den Build gelegt). Kostenlos im Spark-Tarif bis 1 GB /
  50 000 Lesevorgänge am Tag — für Notizen weit ausreichend.
- **Grenzen, ehrlich**: Die Daten liegen bei Google (Region wählbar, z. B.
  europe-west3). Für dienstliche Notizen ist das eine Datenschutz-Entscheidung,
  die Nextcloud nicht hat. Deshalb bleibt der Ordner-Weg die Voreinstellung;
  Firebase ist die Wahl für „überall, auch am Handy, ohne Client".
