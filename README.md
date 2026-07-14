# 📌 PixiNotes

**Das lebendige Whiteboard für deinen Office-Alltag** — ein browserbasiertes, unendliches Whiteboard, auf dem E-Mails, Screenshots, Aufgaben, Tabellen und Ideen als anfassbare Karten landen, sich intelligent selbst organisieren und mit einem Klick teilbar sind.

Eine Mischung aus **Sticky Notes × Notion × OneNote × Excalidraw × Kanban** — aber radikal einfacher.

## 🚀 Schnellstart

| Was | Wo |
|---|---|
| 📖 **Vollständiges Konzept** (Vision, Features, Datenmodell, Architektur, Roadmap) | [`docs/KONZEPT.md`](docs/KONZEPT.md) |
| 🖱️ **Interaktiver Prototyp** (einfach im Browser öffnen!) | [`prototype/index.html`](prototype/index.html) |

Den Prototyp ausprobieren:

```bash
# Beliebiger Browser genügt — keine Installation nötig:
open prototype/index.html        # macOS
xdg-open prototype/index.html    # Linux
start prototype\index.html       # Windows
```

Im Prototyp erlebbar: Karten ziehen & mit Schwung **werfen** (Physik!), sanfte Kollision, E-Mail-Karte mit Anhang-Chips und klickbarer ☎️ Telefonnummer, Kanban- und Tabellen-Objekte, Verbindungslinien, editierbare Haftnotizen (Doppelklick = neue Notiz) und der ✨-Button für die KI-Aufräum-Demo.

## 🧭 Kernidee in 30 Sekunden

1. **Alles ist eine Karte** — E-Mail, Screenshot, Tabelle, Kanban, Kontakt: gleiche Gesten, gleiche Physik.
2. **Zero-Friction Capture** — Doppelklick, `Ctrl+V`, Drag & Drop aus Outlook. Fertig.
3. **Das Board denkt mit** — KI clustert, poliert Texte, extrahiert Aufgaben & Fristen. Immer als Vorschlag, nie als Zwang.
4. **Local-first** — läuft offline im Browser (PWA); Echtzeit-Kollaboration via CRDT, wenn man sie will.

## 🗺️ Status

Projektphase: **Konzept & Prototyp**. Nächster Schritt laut Roadmap: MVP mit Infinite Canvas (tldraw SDK), Markdown-Karten, Datei-Drop und Local-first-Speicherung. Details in [`docs/KONZEPT.md`](docs/KONZEPT.md#11-roadmap-mvp--wow).
