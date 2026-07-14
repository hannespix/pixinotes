# 📌 PixiNotes

**Das lebendige Whiteboard für deinen Office-Alltag** — ein browserbasiertes, unendliches Whiteboard, auf dem E-Mails, Screenshots, Aufgaben, Tabellen und Ideen als anfassbare Karten landen, sich intelligent selbst organisieren und mit einem Klick teilbar sind.

Eine Mischung aus **Sticky Notes × Notion × OneNote × Excalidraw × Kanban** — aber radikal einfacher.

## 🚀 App starten (MVP v0.1)

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

Projektphase: **Konzept & Prototyp**. Nächster Schritt laut Roadmap: MVP mit Infinite Canvas (tldraw SDK), Markdown-Karten, Datei-Drop und Local-first-Speicherung. Details in [`docs/KONZEPT.md`](docs/KONZEPT.md#11-roadmap-mvp--wow).
