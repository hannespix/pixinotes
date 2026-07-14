# OSS-Bausteine — Recherche für die PixiNotes-Entwicklung

> Stand: Juli 2026. Ziel: hochentwickelten, bewährten Open-Source-Code nutzen, statt alles selbst zu bauen. Fokus auf **Lizenz-Sicherheit** (kommerziell nutzbar) und **aktive Pflege**.

## Lizenz-Ampel (Faustregel)

| Lizenz | Bedeutung für uns |
|---|---|
| 🟢 MIT / Apache-2.0 / BSD / ISC | Frei nutzbar, auch kommerziell & closed-source |
| 🟡 MPL-2.0 | Nutzbar; Änderungen *an den Bibliotheksdateien selbst* müssen offen bleiben — unproblematisch bei normaler Nutzung als Dependency |
| 🔴 GPL / AGPL / proprietär | Nicht einbetten (würde unser Produkt "infizieren") — nur als Inspiration/Referenz lesen |

---

## 1. Canvas-Engine (die wichtigste Entscheidung)

| Kandidat | Lizenz | Bewertung für PixiNotes |
|---|---|---|
| **[React Flow / xyflow](https://github.com/xyflow/xyflow)** | 🟢 MIT | **⭐ Empfehlung.** Infinite Canvas mit Pan/Zoom, Minimap, **DOM-basierten Custom Nodes** (= unsere Karten können echtes HTML sein: Editoren, E-Mail-Karten, Kanban!) und eingebauten **Edges** (= unsere Verbindungslinien, sogar mit Labels). Riesige Community, battle-tested. |
| [tldraw SDK](https://tldraw.dev/legal/tldraw-license) | 🔴/💰 proprietär | Bestes Canvas-Gefühl am Markt, ABER: Wasserzeichen-Pflicht in der Gratis-Variante, kommerzielle Lizenz kostenpflichtig, Lizenz-Key-Validierung. Nur nehmen, wenn Budget da ist. |
| [Excalidraw](https://github.com/excalidraw/excalidraw) (`@excalidraw/excalidraw`) | 🟢 MIT | Als **einbettbares Paket** verfügbar. Aber: rendert auf `<canvas>` — HTML-reiche Karten (Editor, E-Mail) sind dort Fremdkörper. **Ideen klauen:** Handzeichnen-Werkzeug, UX-Details, Datenformat. |
| [Konva](https://konvajs.org/docs/faq.html) | 🟢 MIT | Low-Level-2D-Canvas mit React-Bindings. Gut als Zeichen-Layer *über* React Flow (Stift-Werkzeug). |

**Warum React Flow passt:** Unser Konzept "Karten mit beliebigem HTML-Inhalt + logische Verbindungen" ist *exakt* das React-Flow-Datenmodell (Nodes + Edges). Wir bekommen Canvas, Zoom, Minimap, Selektion, Verbindungen und Custom-Node-Rendering geschenkt und bauen nur noch die Karten-Inhalte.

## 2. Karten-Editor (Notion-Feeling in der Karte)

| Kandidat | Lizenz | Bewertung |
|---|---|---|
| **[BlockNote](https://www.blocknotejs.org/)** | 🟡 MPL-2.0 (Kern) | **⭐ Empfehlung.** Notion-artiger Block-Editor für React: `/`-Menü, Checklisten, Tabellen, Bilder — fertig. **Yjs-Kollaboration eingebaut.** Achtung: Zusatzfeatures (KI, PDF/Word-Export, Multi-Column) sind GPL/kostenpflichtig — brauchen wir nicht zwingend. |
| [Tiptap](https://tiptap.dev/) | 🟢 MIT (Kern) | Flexibler Unterbau (BlockNote basiert darauf). Falls BlockNote zu eng wird, eine Ebene tiefer gehen. |
| [BlockSuite](https://github.com/toeverything/blocksuite) (AFFiNE) | 🟡 prüfen (MPL-2.0) | Kompletter Editor-Stack inkl. **Edgeless-Canvas-Editor** — quasi unser Produkt als Framework. Mächtig, aber stark an AFFiNE-Roadmap gekoppelt. Als Referenzarchitektur Gold wert. |

## 3. Sync & Kollaboration (Local-first + Echtzeit)

| Kandidat | Lizenz | Rolle |
|---|---|---|
| **[Yjs](https://docs.yjs.dev/)** + y-indexeddb | 🟢 MIT | CRDT-Kern + Offline-Speicher im Browser. De-facto-Standard. |
| **[Hocuspocus](https://github.com/ueberdosis/hocuspocus)** | 🟢 MIT | Produktionsreifer Yjs-WebSocket-Server (Auth-Hooks, Persistenz, skalierbar; läuft auf Node/Bun/Workers). **⭐ Empfehlung** für den Sync-Server. |
| [y-sweet](https://jamsocket.com/y-sweet) | 🟢 MIT | Alternative in Rust mit S3-Persistenz — interessant, wenn wir Dateiablage + Sync aus einer Hand wollen. |

Bonus: BlockNote + Yjs + Hocuspocus sind ein **dokumentiert zusammenspielendes Trio** — Live-Cursor und konfliktfreies Tippen in Karten kosten uns fast keinen Eigencode.

## 4. Office-Import (unser Differenzierungsmerkmal)

| Aufgabe | Baustein | Lizenz |
|---|---|---|
| `.eml`-E-Mails parsen (Browser!) | **[postal-mime](https://github.com/postalsys/postal-mime)** — Header, Body, **Anhänge**, ohne Server, ohne Dependencies | 🟢 permissiv (MIT-Familie) |
| `.msg`-Outlook-Dateien parsen | **[@kenjiuno/msgreader](https://www.npmjs.com/package/@kenjiuno/msgreader)** — Betreff, Absender, Body, Anhänge; aktiv gepflegt (100+ Releases) | 🟢 Apache-2.0 |
| PDF-Vorschau | [pdf.js](https://mozilla.github.io/pdf.js/) (Mozilla) | 🟢 Apache-2.0 |
| Excel → Tabellen-Karte | [SheetJS CE](https://sheetjs.com/) | 🟢 Apache-2.0 |
| OCR für Screenshots | [tesseract.js](https://github.com/naptha/tesseract.js) (WASM, lokal im Browser) | 🟢 Apache-2.0 |
| `.ics`-Termine | [ical.js](https://github.com/kewisch/ical.js) | 🟢 MPL-2.0 |

→ **Der komplette Outlook-Drag&Drop-Pfad ist mit fertigen Bausteinen abgedeckt** — wir schreiben nur den Glue-Code (Drop-Handler → Parser-Worker → Karte).

## 5. Smart Layer (Entity-Erkennung ohne KI-Kosten)

| Aufgabe | Baustein | Lizenz |
|---|---|---|
| Telefonnummern erkennen & normalisieren (→ `tel:`-Links!) | [libphonenumber-js](https://www.npmjs.com/package/libphonenumber-js) | 🟢 MIT |
| Datumsangaben in Text („bis Freitag", „am 24.07.") | [chrono-node](https://github.com/wanasit/chrono) — versteht auch Deutsch | 🟢 MIT |
| Link-Erkennung | [linkifyjs](https://linkify.js.org/) | 🟢 MIT |

→ Klickbare Telefonnummern, Termin-Chips und Link-Karten funktionieren **komplett offline und kostenlos** — KI nur für die Kür (Clustering, Politur, Destillat).

## 6. UX, Physik & Quality-of-Life

| Aufgabe | Baustein | Lizenz |
|---|---|---|
| Feder-Animationen, „Wurf"-Gefühl | [framer-motion / motion](https://motion.dev/) (Springs, Drag mit Momentum!) | 🟢 MIT |
| Drag & Drop innerhalb von Karten (Kanban-Spalten) | [dnd-kit](https://dndkit.com/) | 🟢 MIT |
| Auto-Clustering-Layout (Karten-Inseln) | [d3-force](https://github.com/d3/d3-force) (Physik-Simulation für Gruppierung) | 🟢 ISC |
| Cmd+K-Spotlight | [cmdk](https://github.com/pacocoursey/cmdk) | 🟢 MIT |
| Konfetti 🎉 | [canvas-confetti](https://github.com/catdad/canvas-confetti) | 🟢 ISC |

## 7. Ganze Produkte als Referenz (lesen, nicht einbetten)

- **[AFFiNE](https://github.com/toeverything/affine)** (Frontend MPL-2.0) — Doc+Whiteboard+Datenbank-Hybrid, local-first, Yjs. **Die architektonische Blaupause für PixiNotes**; Backend/EE-Teile proprietär, also selektiv lernen. 
- **[Excalidraw](https://github.com/excalidraw/excalidraw)** (MIT) — UX-Messlatte für Leichtigkeit; Freihand-Rendering-Code (`rough.js`, perfect-freehand 🟢 MIT) direkt nutzbar.
- Logseq / AppFlowy (AGPL) — 🔴 nur Ideen, kein Code.

---

## Konsequenz: Der beschleunigte Stack

```
React + Vite + TypeScript
 └─ Canvas:       @xyflow/react (MIT) ← Karten als Custom Nodes, Edges als Verknüpfungen
 └─ Karteninhalt: BlockNote (MPL-2.0) ← Notion-Blocks + /-Menü + Yjs fertig
 └─ Sync:         Yjs + y-indexeddb (MIT) lokal · Hocuspocus (MIT) Server
 └─ Office:       postal-mime · @kenjiuno/msgreader · pdf.js · SheetJS · tesseract.js
 └─ Smart Layer:  libphonenumber-js · chrono-node · linkifyjs
 └─ Gefühl:       motion (Springs/Wurf) · d3-force (Cluster) · dnd-kit · cmdk · canvas-confetti
```

**Geschätzte Beschleunigung:** Phase 1+2 der Roadmap schrumpfen deutlich — Canvas, Editor, Sync und sämtliche Parser sind fertige, gepflegte Bausteine. Unser Eigenanteil konzentriert sich auf das, was PixiNotes einzigartig macht: das Karten-Modell, die Physik-Abstimmung, den Office-Glue-Code und die KI-Vorschläge.

**Nächster Schritt:** Spike (1–2 Tage): React Flow + BlockNote + eine `.msg`-Datei per Drag&Drop → E-Mail-Karte mit Anhang-Chips. Damit ist das Risiko der drei wichtigsten Integrationen sofort validiert.
