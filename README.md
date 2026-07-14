# 📌 PixiNotes

**Das lebendige Whiteboard für deinen Office-Alltag** — ein browserbasiertes, unendliches Whiteboard, auf dem E-Mails, Screenshots, Aufgaben, Tabellen und Ideen als anfassbare Karten landen, sich intelligent selbst organisieren und mit einem Klick teilbar sind.

Eine Mischung aus **Sticky Notes × Notion × OneNote × Excalidraw × Kanban** — aber radikal einfacher.

## 🚀 Ohne Installation nutzen (empfohlen!)

**[`release/pixinotes.html`](release/pixinotes.html) herunterladen → Doppelklick → fertig.**

Die komplette App steckt in **einer HTML-Datei** (~3 MB): läuft in jedem modernen Browser direkt von der Festplatte, dem USB-Stick oder dem Netzlaufwerk — **kein npm, kein Server, keine Adminrechte nötig**. Auch auf dem Handy: Datei aufs Gerät schicken (z. B. per Mail/OneDrive) und im Browser öffnen.

> 💡 Die Daten liegen im Browser-Speicher (localStorage), gebunden an Browser + Ablageort der Datei. Gleicher Browser + gleicher Ort = alles bleibt erhalten. Zum Mitnehmen: Karten über die Auswahl-Toolbar teilen/exportieren. Der geplante **Arbeitsordner-Modus** (Kapitel 8b im Konzept) speichert künftig direkt als Markdown-Dateien.

Neu bauen nach Code-Änderungen: `npm run build:single` → erzeugt `release/pixinotes.html`.

## 🛠️ Entwicklung (mit npm)

```bash
npm install
npm run dev        # → http://localhost:5173
```

**Was schon funktioniert:**

- ♾️ **Infinite Canvas** mit Pan/Zoom, Minimap und Verbindungslinien (React Flow)
- 📝 **Haftnotizen mit Notion-Editor** (BlockNote, deutsch): Doppelklick (oder `N`) → lostippen, `/` öffnet das Block-Menü (Checklisten, Tabellen, Überschriften …), Farbwechsel per Klick
- 📧 **Outlook-E-Mails per Drag & Drop**: `.eml`- und `.msg`-Dateien werden im Browser geparst (postal-mime / msgreader) und zu strukturierten Karten mit **Anhang-Chips** — Bild-Anhänge lassen sich als eigene Karten herauslösen
- ☎️ **Smart Layer**: Telefonnummern automatisch klickbar (`tel:`-Link), URLs und E-Mail-Adressen ebenso (libphonenumber-js); 📅 **Fristen-Erkennung** („bis Freitag") mit Countdown-Chips und `.ics`-Kalender-Export (chrono-node)
- 🖼️ **Strg+V** fügt Screenshots als Bild-Karten ein; beliebige Dateien per Drop als Datei-Karten
- 📋 **Kanban-Karten** mit drei Spalten, Ticket nach *Done* schieben → 🎉 Konfetti
- 🗂️ **3-Ebenen-Organisation**: Bereiche → Projekte → Boards, verwaltet in der **Mission-Control-Übersicht** (🏠): Boards per Drag & Drop verschieben/sortieren, alles per Doppelklick umbenennbar, Board-Kacheln mit Live-Statistik und Mini-Vorschau; dazu Tab-Leiste zum schnellen Wechseln und **Portal-Karten**, die Projekte visuell verlinken
- 🧩 **Prozessmanagement**: Prozess-Formen (Schritt/Entscheidung/Start-Ende), Pfeil-Verbindungen mit umschaltbarem Stil, **Mermaid-Diagramme** mit Live-Vorschau (Flowchart/Sequenz/Gantt)
- ✏️ **Freihand-Zeichnen mit Formerkennung**: Stift und Neon-Textmarker (Multiply-Effekt wie beim echten Leuchtstift) plus Radierer — Striche werden beim Loslassen automatisch entzittert, fast gerade Striche (Unterstreichungen!) rasten gerade ein, und wer am Strich-Ende kurz hält, bekommt Linien/Rechtecke/Ellipsen sauber geformt (wie in OneNote/FigJam)
- 📕 **PDF-Karten mit Inline-Vorschau**: erste Seite als Thumbnail, Klick öffnet den Viewer mit Seiten-Navigation (pdf.js)
- ▶️ **Präsentationsmodus mit Live-Bearbeitung**: Karten des Boards als Vollbild-Folien (Pfeiltasten/Esc) — Notizen, Formen, Diagramme und Kanban-Boards sind **direkt auf der Folie editierbar** (Tickets im Meeting weiterschieben!), alle Änderungen landen live auf dem Board. Die **Folien-Reihenfolge folgt der Gliederung**: verbundene Karten werden als Cluster zusammenhängend gezeigt, innerhalb geht es den Pfeilen nach (Prozess-Logik)
- 🤖 **KI-Aktionen direkt auf den Karten**: ✨ E-Mails zusammenfassen, ✨ Notiztexte verbessern (immer als neuer Vorschlag daneben — nie destruktiv). Anbieter frei wählbar: eigener Cloud-Key (Anthropic/OpenAI) **oder Ollama / selbstgehosteter Server** (dann bleibt alles lokal); Zugangsdaten nur im Browser
- ☁️ **Nextcloud/OneDrive/Dropbox-Sync**: Sync-Ordner in den Einstellungen verbinden → PixiNotes speichert alle Boards automatisch als `pixinotes-daten.json` dorthin, der Cloud-Client verteilt sie auf alle Geräte (Konfliktschutz warnt, statt fremde Stände zu überschreiben; KI-Schlüssel bleiben lokal)
- 📁 **Datenordner-Export**: alle Boards als echte Markdown-Dateien (Bereich/Projekt/Board.md) via File System Access, plus Board-Export als PNG/SVG (→ PDF via Drucken)
- ↩️ **Undo/Redo**: Karten, Verbindungen und Zeichnungen (Strg+Z / Strg+Y oder ↩️/↪️ im Dock); Texte haben ihr eigenes Editor-Undo
- 🧲 **Verdrängungs-Physik**: Karten schieben sich beim Ziehen federnd beiseite (inkl. Kettenreaktion), geworfene Karten räumen sich den Weg frei, die gezogene Karte neigt sich in Bewegungsrichtung
- 🔗 **Verbindungen mit Beziehung**: Karten am Rand-Punkt verbinden; auf die Linien-Mitte klicken benennt die Beziehung („blockiert", „gehört zu" …), ✕ löscht sie
- 🔍 **Spotlight-Suche** (`Strg+K`): findet Karten über alle Boards und fliegt animiert hin
- 📤 **Teilen**: Auswahl-Toolbar mit „Als E-Mail" (mailto) und „Formatiert kopieren" (HTML für Outlook/Word-Paste), Duplizieren, Löschen mit **Undo**
- 🚀 **Wurf-Physik**: Karten mit Schwung loslassen — sie gleiten mit Momentum weiter
- 👆 **Touch & responsiv**: große Hit-Targets und permanente Controls auf Touch-Geräten, Doppel-Tap = Notiz, angepasstes Layout für schmale Screens
- 💾 **Local-first**: Alles wird automatisch im Browser gespeichert (localStorage), kein Account nötig

| Weitere Ressourcen | Wo |
|---|---|
| 📖 Vollständiges Konzept (Vision, Features, Datenmodell, Architektur, Roadmap) | [`docs/KONZEPT.md`](docs/KONZEPT.md) |
| 🧩 OSS-Baustein-Recherche mit Lizenz-Ampel | [`docs/OSS-BAUSTEINE.md`](docs/OSS-BAUSTEINE.md) |
| 🖱️ Ur-Prototyp (statische HTML-Designstudie) | [`prototype/index.html`](prototype/index.html) |

## 🧭 Kernidee in 30 Sekunden

1. **Alles ist eine Karte** — E-Mail, Screenshot, Tabelle, Kanban, Kontakt: gleiche Gesten, gleiche Physik.
2. **Zero-Friction Capture** — Doppelklick, `Ctrl+V`, Drag & Drop aus Outlook. Fertig.
3. **Das Board denkt mit** — KI clustert, poliert Texte, extrahiert Aufgaben & Fristen. Immer als Vorschlag, nie als Zwang.
4. **Local-first** — läuft offline im Browser (PWA); Echtzeit-Kollaboration via CRDT, wenn man sie will.

## 🗺️ Status

**Version 1.0** — voll funktionsfähige App, lokal nutzbar ohne Installation. Drei Audit-Runden (Design/Usability, Logik, Code inkl. Security) sind eingeflossen; siehe [`docs/AUDIT.md`](docs/AUDIT.md).

**Noch offen (Roadmap):** Echtzeit-Kollaboration (Yjs/CRDT), IndexedDB-Auslagerung großer Binärdaten, weitere KI-Aktionen (Auto-Clustering, Board-Briefing), Live-Anbindung an Microsoft 365 (MS Graph). Details in [`docs/KONZEPT.md`](docs/KONZEPT.md).
