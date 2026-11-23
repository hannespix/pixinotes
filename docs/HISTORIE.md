# Historie — wie PixiNotes entstanden ist (14.07.–23.11.2026)

Für Agenten und LLMs, die hier weiterbauen. Diese Datei erzählt die
Entwicklung in Phasen und hält fest, **welche Entscheidungen tragen** — damit
niemand eine Lösung „vereinfacht", die eine Antwort auf einen echten Fehler
war. Details je Meilenstein: `docs/UMBAU.md` §4 (bis M441, per `grep -n M3xx`),
`docs/meilensteine/` (ab M442), Commit-Rümpfe (`git log --grep="M351"`).

Stand: 23.11.2026 · ≈ 445 Commits auf dem Hauptzweig
`claude/notes-whiteboard-design-bnwvxj` · Meilensteine M1–M441 (Lücken in der
Zählung sind normal: Nummern wurden teils vergeben und gebündelt) · 171
Prüfreihen in `pruefungen/` · PRs ab #4 (M307), vorher direkte Pushes.

## Zeitleiste auf einen Blick

| Phase | Zeitraum | Meilensteine | Kern |
|---|---|---|---|
| 0 Konzept & Prototyp | 14.07. | — | `docs/KONZEPT.md`, `prototype/index.html`, OSS-Recherche |
| 1 MVP bis Version 1.0 | 14.07. | MVP, M1–M16 | React Flow + BlockNote, Single-File, drei Audits, „1.0" am ersten Tag |
| 2 Office-Magie & Breite | 14.–19.07. | ≈M17–M156 | KI-Assistent, Sync, Kalender, Mermaid, Kanban, Gantt, Kanten, Frames |
| 3 Werkzeugkasten, Netz, Gehirn | 21.07.–09.08. | M157–M210 | Zeiterfassung, HTML-Apps, Daten-Abos, Glas-Optik, Netz, Gehirn (RAG) |
| 4 Telefon, Fokus, Messbarkeit | 09.08.–04.09. | M211–M293 | Karten-Fokus, Fehlergrenzen, Rechen-Tabelle, Prüfreihen ins Repo |
| 5 Erster Schliff | 16.09.–14.10. | M294–M311 | Ruhige Fläche, eine Navigation, Kachel-Ansicht, Drei-Wege-Sync |
| 6 Umbau „Weniger ist mehr" | 05.11. | M312–M321 | drei Orte, ⋯-Dramaturgie, Gestalt flach/kühl, Start-Bundle halbiert |
| 7 Stift & Handschrift | 05.–17.11. | M319–M327, M347–M356, M394–M396 | Druck-Konturen, Stift schreibt / Finger bedient, Handschrift → Text |
| 8 Konto, Team, Sync | 06.–16.11. | M328–M387 | Supabase-Konto, Freigaben, Gäste per Link, Patch-Sync je Karte, Live |
| 9 Audit-Runde November | 16.11. | M388–M391 | Code/Security, UI, Logik, Team — `docs/AUDIT.md` |
| 10 Präsentation & Vortrag | 14.–23.11. | M367–M431 (verstreut) | „Folgt mir", Laser, Folien-Zoom, Vibe Studio, Reihenfolge entlang Pfeilen |
| 11 KI-Module | durchgehend | M16 … M428, M444 ff. | Aktionen, Freitext, Vision, Gehirn, Recherche, KI kennt jedes Modul |
| 12 Gestalt „Flat" & Agenten | 21.–23.11. | M412–M441, #120 | zwei Schriften, Tropfen-Look, Bedienung nur im Fokus, parallele Agenten |

---

## Phase 0 — Konzept und Prototyp (14.07.2026)

- `docs/KONZEPT.md`: Vision „Sticky Notes × Notion × OneNote × Excalidraw ×
  Kanban, aber radikal einfacher"; vier Leitprinzipien (Zero-Friction
  Capture · Alles ist eine Karte · Das Board denkt mit · Local-first).
- `prototype/index.html`: statische Designstudie (Physik, E-Mail-Karte, Kanban).
- `docs/OSS-BAUSTEINE.md`: Bausteine mit Lizenz-Ampel.

**Lehre:** Das Konzept empfahl tldraw und Yjs (§9). Gebaut wurde mit
**React Flow (`@xyflow/react`) + BlockNote + Zustand** — tldraw hat Lizenz-/
Wasserzeichen-Fragen (§12 „Offene Entscheidungen"), React Flow ist MIT und
macht jede Karte zu einem normalen React-Knoten. Diese Wahl ist durch
≈ 440 Meilensteine verfestigt; ein Wechsel der Canvas-Engine ist kein
realistischer Schritt mehr. Yjs liegt nur indirekt (BlockNote) im Bundle.

## Phase 1 — MVP bis Version 1.0 (14.07.2026, MVP, M1–M16)

Am ersten Tag: MVP v0.1 (Karten als Custom Nodes, BlockNote deutsch,
`.eml`/`.msg` im Browser geparst, `tel:`-Links, Strg+V, Wurf-Physik,
localStorage über `zustand/persist`, Playwright-Nachweis), dann M1 Touch,
M2 Teilen/Export, M3 Fristen (chrono-node), M4 Spotlight/Undo, M6/M7 drei
Ebenen Bereich → Projekt → Board mit Mission Control, M8 Arbeitsordner-
Architektur, fuzzy Suche (uFuzzy), M11–M16 Prozess-Formen, Mermaid,
Freihand, PDF-Vorschau, Präsentationsmodus, Ollama.

- **Portable Single-File** `release/pixinotes.html` (vite-plugin-singlefile,
  ≈ 3 MB, läuft von `file://`, USB-Stick, Netzlaufwerk, ohne Admin).
- Drei Audit-Runden (Usability, Logik, Code/Security) → **Version 1.0** noch
  am selben Tag, GitHub Pages deployt jeden Push.

**Lehren:**
- **Warum Single-File:** Zielgruppe ist der Büro-PC ohne Adminrechte und ohne
  npm. Die Datei ist der Weg, PixiNotes überall zu öffnen. Folge: alles muss
  sich inline bündeln lassen (kein Laufzeit-Nachladen von Fremdservern, keine
  Chunk-Abhängigkeit — siehe M90). Seit #120 baut `release.yml` die Datei
  **nach** dem Merge; in PRs nie anfassen (war die häufigste Konfliktquelle).
- **Warum E2E statt Unit-Tests:** schon der MVP wurde im echten Browser
  geprüft. Fehler dieses Werkzeugs liegen fast immer im Zusammenspiel
  (React Flow, Editor, Touch, Speicher), nicht in reinen Funktionen.

## Phase 2 — Office-Magie und Breitenausbau (14.–19.07., ≈M17–M156)

Rasantes Wachstum, viele Module an wenigen Tagen:
- **Sync & Teilen:** Sync-Ordner (Nextcloud/OneDrive-Client), Board im Link
  ohne Server, `.pixiboard.json`, WebDAV direkt, Kalender-Konten Google/M365;
  **Sync-Audit M81–M86** (Single-Writer-Schutz, ehrliche Konflikte, Status
  sichtbar); M145 Team-Sync je Projekt in eigenen Ordner.
- **Wissen:** Obsidian-Paket (`[[Wikilinks]]`, #Tags, Netz-Graph,
  Tagesnotiz), Backlinks, Trilium-Paket (Attribute, Verlauf, Vorlagen).
- **KI:** Assistent für Board/Auswahl, JSON-Reparatur kaputter LLM-Antworten,
  Gratis-KI (OpenRouter), Freitext-Kommando, KI-Cluster.
- **Starter-Umgebung „Verwaltung"**, Aufräumen mit Cluster-Layout, PWA,
  Themes/Dunkelmodus, Hilfe, Impressum/Datenschutz.
- **Mermaid M90–M101:** WYSIWYG für alle Diagrammtypen. M90: nach jedem Deploy
  waren Mermaids gehashte Chunks weg → IIFE als Rohtext einbetten.
- **Auto-Größe M93–M111:** Hin und Her zwischen Automatik und Hand.
  Ergebnis **M104 „Manuelle Größe gewinnt IMMER"** und **M106 Pointer-Wache**
  (keine Automatik, solange die Maus gedrückt ist).
- **Aufgaben-Zentrale M113–M116**, **Kanban M118–M121** (Ticket-Modal,
  Abhängigkeiten, WIP, Zyklen-Wächter), **Kanten-Geometrie M132–M139**
  (Routing, senkrechtes Andocken, tangentenstetige Kurven), Anordnen
  M141/M142, **M144 SVG-Icons statt Emojis**, Kommentar-Pins M148,
  **Frames M149–M152**, Wochenplan M153/M154.

**Lehren:** Automatik darf nie gegen eine Nutzerhandlung arbeiten (M104,
M106). M143: offene Menüs pausieren Board-Gesten — Ursprung der späteren
`overlayOffen()`-Regel.

## Phase 3 — Werkzeugkasten, Netz und Gehirn (21.07.–09.08., M157–M210)

- Zeiterfassung M157/M161/M171 (wieder verschlankt), **eigene Apps: HTML-Dateien
  als Karten M158/M164**, Karten in andere Boards M163/M180, Nachschlagen M168.
- **Daten-Abos M169/M170:** Pfeile aktivieren Datenaustausch zwischen Modulen.
- **Glas-Optik M172–M178, M191** (Milchglas, Mesh-Verlauf, Rausch-Textur) —
  in M315 vollständig zurückgenommen.
- Protokoll-Reihe M186, OneNote-/Word-Import M184 (eigener ZIP-Leser),
  Termine 2.0 M176/M177.
- **Netz-Ansicht** M193–M197, M203, M221–M223 (Physik, Gelände aus der
  Gliederung, Leistungs-Audit mit Messung).
- **Gehirn M204–M209, M220:** Embeddings über alle Karten, Synapsen-Vorschläge,
  „Frag dein Gehirn" (RAG), Themen-Inseln, Sub-Brains. M199 KI sieht Bilder.

**Lehre:** Optik mit `backdrop-filter`/Verläufen kostet auf jedem Schwenk
Rechenzeit und wirkte später „nach KI-Vorlage" (M315). Nicht wieder einführen.

## Phase 4 — Telefon, Fokus, Messbarkeit (09.08.–04.09., M211–M293)

- **Karte im Fokus** am Handy M212–M214, Flug in die Karte M227, ein Fokus für
  alle Geräte M228; Handy-Tastatur M211.
- **M213 Fehlergrenzen je Karte** (statt weißer Seite bei einem Kartenfehler).
- Tastenkürzel fürs ganze Werkzeug M251, Stift auf dem iPad M254,
  **M255 Barrierefreiheit „gemessen, nicht geschätzt"**.
- **M256 Rechen-Tabelle mit Formeln + Excel-Import**, M257 lokale KI fragt den
  Server nach Modellen, M259 Dateiinhalte in IndexedDB unabhängig von der Größe.
- Gantt-Sanierung M271–M282, Kalender M270/M272, KI-Recherche M274/M278.
- **M275 Prüfreihen ins Repository** — ein Container-Reset hatte alle Reihen
  bis M264 vernichtet.
- M283 eine Tabelle für alles (Rechen-Tabelle in der Notiz), M285 Karten aus
  jeder Ansicht bearbeiten, M287 „Rahmen ist nicht Bereich", M290 Android-
  Teilen-Ziel, M293 Kanban-Archiv.

**Lehren:** Prüfreihen gehören ins Repo, nicht in die Arbeitsumgebung (M275).
Binärdaten nie in localStorage (5-MB-Grenze, M259, M303).

## Phase 5 — Erster Schliff (16.09.–14.10., M294–M311)

Auslöser, Nutzerwunsch: „so einfach, unkompliziert und übersichtlich wie
möglich … Workflow ähnlich wie bei OneNote".
- **M294 Ruhige Fläche:** Physik, Klick-Zoom, Konfetti werden Optionen (aus).
- M295 Kanban entrümpelt, M296 Dock/Auswahl-Leiste, **M297 eine Navigation
  statt drei** (linke Spalte mit Baum), **M298 Kachel-Ansicht** großer Module,
  M299 „Die App redet weniger", M300/M301 Einstellungen und Telefon.
- `docs/KONZEPT.md` §10a: fünf Leitplanken (fester Rahmen, ruhige Fläche, wenig
  sichtbar, ein Weg pro Aufgabe, die App schweigt).
- **M311 Drei-Wege-Zusammenführung** je Board/Karte/Pfeil/Strich/Kommentar,
  Basis in IndexedDB, Konfliktkopien des Cloud-Clients werden eingearbeitet.

## Phase 6 — Umbau „Weniger ist mehr" (05.11., M312–M321)

Befund M311 (`docs/UMBAU.md` §1): leeres Board ≈ 42 klickbare Elemente,
Übersicht 185, Präsentieren an 7 Stellen, Einstellungen an 8, sechs
Suchfelder. „Nicht schwer zu bedienen, aber schwer zu überblicken."
Leitsätze (§2): **drei Orte** (Kopfleiste, Spalte, Dock) · **ein Weg pro
Aufgabe** · sichtbar nur Tägliches, Rest im ⋯ (Tun · Weitergeben · Aufräumen)
· Einstellungen sind Ausnahmen · Hover zeigt, Klick tut.
- M312 Rahmen, M313 Auswahl-Leiste/Modulköpfe auf ein ⋯, M314 drei Reiter in
  den Einstellungen, **M315 Gestalt** (Tokens; kühl, kantig, deckend, flach;
  Radius 2–6 px; kein Milchglas/Verlauf/Textur), **M316 Modul-Palette** (＋
  zeigt alles, gruppiert, mit Suche), M318 eine Leiste unten.
- **M321 Start-Leistung:** Mermaid-Rohtext und E-Mail-Parser erst bei Bedarf,
  Fremdcode in stabile Pakete (react · editor · fluss), einmaliges Neuladen bei
  veralteten Chunk-Namen; Start-JS 6,3 → 3,2 MB.

**Lehren:** Jede neue Funktion braucht einen bestehenden Ort, keinen neuen
Knopf. Schweres per `import()` nachladen. Seit M312 gilt das als Regel, nicht
als Option (CLAUDE.md §1).

## Phase 7 — Stift und Handschrift (05.–17.11.)

- M319 perfect-freehand-Konturen mit Druck, Formen; „Hand schiebt, Stift
  zeichnet". M320 Handschrift → Text (Browser-API, Scribble am iPad,
  Online-Erkennung nur Opt-in). M322 Stift schwenkt die Seite nicht mehr
  (Touch-Doppelmeldung vor React Flow abfangen).
- M324/M325/M327: Vorschlag nach Schreibpause, Ziel-Notiz, Umkreisen markiert,
  Durchstreichen löscht, Kästchen/Aufzählung/Überschrift aus der Schrift;
  **Stift schreibt, Finger bedient** (Surface/iPad). M326 Procreate-Gesten.
- M347/M348 Latenz (eigener Pfad für den laufenden Strich), M354 Stärken in
  Bildschirmpunkten, M355 i-Punkte, M356 Textmarker auf Zeilenhöhe,
  M335–M337 Striche/Kommentare seitenbezogen auf PDF und Word, M394/M396 Stift
  und Gesten in der Präsentation.

## Phase 8 — Konto, Team und Sync (06.–16.11., M328–M387)

- **M317 Konto-Sync** über App-Ordner von Google Drive/OneDrive — bewusst
  **kein Firebase**: Daten beim Nutzer, nicht beim Betreiber (UMBAU §5).
- **M328 PixiNotes-Konto mit E-Mail** über Supabase (Projekt in Frankfurt),
  **ohne SDK** (`lib/kontoSupabase.ts`: PostgREST, Magic Link, Realtime per
  Phoenix-WebSocket), RLS, atomares `konto_schreiben`; Anon-Key öffentlich im
  Build, Daten schützt RLS. M329 Dateispeicher bis 50 MB, M330 Freigaben.
- M333 **Fokus = Zoom auf dem Board** statt eigener Blatt-Ansicht;
  M338 **ruhende Notizen** (HTML statt Editor, 300 Karten: 49 s → 1,9 s).
- **M351 Grabsteine:** Ordner/WebDAV kennen kein bedingtes Schreiben; zwei
  Geräte verloren Karten. Löschungen reisen als Grabstein (120 Tage), fehlende
  Karten gelten nicht mehr als gelöscht.
- M357 Board per kurzem Link, M360 Rollen + Einladungslink, **M364–M366
  Gruppenarbeit per Link ohne Konto**: kartenweise Drei-Wege, Karten-Sperre,
  Rechte der Gäste, **Patches je Karte** unter Zeilensperre (≈ 15 ms bei 400
  Karten) statt ganzem Board mit Vorbedingung. **M383** dasselbe für Besitzer
  und Gäste mit Konto (`board_aendern`). M384 Anhänge/Tools für Gäste.
- Live: M367 „Folgt mir", M375 Mauszeiger/Laser, M376 Reaktionen/Timer,
  M377 Punkte, M385 QR-Code. M368 Browser-Übersetzung verträglich, M370
  **leerer Start**, M381/M382 englische Oberfläche (Beobachter übersetzt beim
  Entstehen, kein Umbau auf Schlüssel).

**Lehren (tragend):**
- **Warum Patch-Sync je Karte:** ganzes Board mit Vorbedingung scheitert bei
  vielen Schreibern reihum (alle lesen neu, versuchen erneut). Kartenweise
  Patches + Delta über den Live-Kanal + voller Abgleich nur bei Lücke skaliert.
  Nicht zurück zu „Board schreiben".
- **Grabsteine + Drei-Wege** sind Pflicht für jeden Weg ohne Server-Vorbedingung.
- Server-Code liegt in `supabase/migrations/`; Einspielen braucht die
  Freigabe des Besitzers, die App muss mit und ohne neue Migrationen laufen.

## Phase 9 — Audit-Runde November (16.11., M388–M391)

Vier Durchgänge, je Fund am Code nachgestellt (`docs/AUDIT.md`):
- **M388 Code** (≈ 70 Funde): alles von außen über **`lib/sicher.ts`**
  (Links, Dateien, Konto/Gast, Live-Kanal); nur http(s) einbetten, Downloads
  nur `data:`/`blob:`, Word-Vorschau ohne Skripte; Kommentare im Undo;
  `lib/tag.ts` für „heute" in Ortszeit; Server-Trigger `inhalt_pruefen`.
- **M389 UI**: `--accent-fill`/`--accent-strong` für 4,5:1 in allen
  Akzenten, Tippziele, `lib/fensterFokus.ts`.
- **M390 Logik**: Fristen-Anker (relative Angaben merken ihren Tag),
  „ein Handgriff, ein Rückgängig-Schritt", vollständige Sicherung (Vorlagen,
  Tools, große Dateien), WebDAV mit `If-Match`.
- **M391 Team**: Einladungs-Dialog 212 → 25 Wörter, eine Leiste mit einem
  Knopf, Migration `team_haertung`.

Frühere Audit-Runden: Tag 1 (drei Runden → 1.0), Runde 5 Responsivität,
Runde 6 (21 Befunde), Runde 7 Design, Mermaid-Audits M94/M97/M98, Kanban
M120, Netz M203/M223, a11y M255.

## Phase 10 — Präsentation und Vortrag (14.–23.11.)

Präsentieren gab es seit M16 (Folien aus Karten, live editierbar, Reihenfolge
entlang der Gliederung). Ausbau ab M367: „Folgt mir" (Board als
Präsentationsraum), M371 Tools/Webseiten als Folie für alle, M380 Module als
lebende Folie, **M387 Präsentation nimmt das Publikum mit**, M393 Tool im
Vollbild ohne Leiste, M402–M405 Zoom/Verschieben/„Weiter geht immer zur
nächsten Karte", **M413 eine Reihenfolge für Fokus und Vortrag**
(`lib/kartenFolge.ts`, entlang der Pfeile), M414 Laser/Tools bei Gästen wie
beim Vorführenden, M418 am Handy, **M425 Vibe Studio** (Präsentations-App als
Karte), M426 „Nur Inhalt", M427/M428 Präsentation per KI erzeugen/überarbeiten,
M431 Ende bei der letzten Karte, M441 Wischen im Vollbild-Fokus.

## Phase 11 — KI-Module (durchgehend)

M16 Aktionen auf Karten (immer als neuer Vorschlag daneben, nie destruktiv;
eigener Schlüssel oder Ollama) → Assistent/Freitext/JSON-Reparatur (Juli) →
M117 Format-Steckbrief und Markdown-Parser → M199 Vision → M204–M209 Gehirn
(Embeddings, RAG) → M257 Modelle vom Server → M274/M278 Recherche mit Quellen →
M276 KI liest Word/Excel → M332 Stapelaufgaben in Portionen → **M410 Die KI
kennt jedes Modul** (`lib/kiModule.ts`: lesen, bedienen, erinnern) → M427/M428
Präsentationen → laufend M444 Board-Briefing, M445 Auto-Clustering.

**Lehre:** KI schlägt vor, der Mensch entscheidet; Zugangsdaten bleiben im
Browser; lange Aufgaben in Portionen mit Fortschritt und ehrlicher Meldung.

## Phase 12 — Gestalt „Flat" und parallele Agenten (21.–23.11., M412–M441)

- M412 Kopfleiste aus einem Guss (ein Maß `--kopf-h`), M397 ohne Emojis.
- M415 Ideabubbles als Tropfen (SVG-Filter), M419/M423/M439 Netz als
  Tropfen-Inseln; M416 zwei Schriften (Manrope/Playfair) → **M420 Newsreader +
  Geist** (ruhiger); **M417 flache Karten**.
- **M421 Bedienung nur im Fokus:** Karten zeigen in Ruhe nur ihren Inhalt;
  Werkzeuge erscheinen bei Auswahl/Fokus/Verweilen. Neue Bedien-Elemente in die
  drei Listen am Ende von `index.css` eintragen.
- M424 Fokus-Darstellung, M429–M440 Feinschliff (Bubbles, Kanban schmal,
  Pfeilschatten, Formen mit Notiz-Text, Übersicht ziehen).
- **#120 Arbeitsweise für parallele Agenten:** `CLAUDE.md`, `docs/AGENTEN.md`,
  `docs/BACKLOG.md`, PR-Prüfung `pruefen.yml`, Single-File per `release.yml`
  nach dem Merge, Meilenstein-Dateien statt Tabellenzeilen ab M442.

---

## Phase 13 — Multi-Agent-Betrieb (23.11., M444–M479)

Ein Orchestrator, bis zu sieben Arbeits-Agenten in eigenen Worktrees, jeder liefert
bis zum Merge (Squash) – in einem Tag 36 Meilensteine, PR #120 bis #167.

**Was entstand:** KI-Board-Briefing (M444), Ordnen nach Themen (M445), Versionen mit
Vergleich und Zurückholen (M449/M460/M470), Kontakt-Karte mit vCard, KI/MCP und Signatur
(M450/M454/M457/M463), E-Mail-Destillat (M451), Text in Bildern samt Gehirn und Chips
(M452/M465), Änderungsdatum je Karte (M453/M472), Browser-Erweiterung (M458), Outlook
live (M466), Termine in der Aufgaben-Zentrale mit Serien und Zeitzonen (M469/M471/M473),
BlockNote 0.31 → 0.57 (M462), Barrierefreiheit (M447/M456), Mauszeiger unter Windows
(M464), Sicherung als `.pixinotes` (M476), Eingang (M478), Mit Google anmelden über
Supabase (M479). Start-JS 3,58 → ~2,2 MB (M446/M459/M467).

**Werkzeug und Arbeitsweise:** CLAUDE.md, AGENTEN.md, BACKLOG.md, je Meilenstein eine
Datei; PR-Prüfung als Merge-Tor; `release.yml` baut die Single-File nach dem Merge
(vorher Konfliktquelle Nr. 1); Prüfreihen-Läufer mit Port-Sperre über Worktrees,
`--geaendert` mit Wächter-Reihen; Nachtlauf aller Reihen mit Issue „Nachtlauf rot"
(M468/M474); „Was ist neu" sortiert sich selbst; `index.css` in 29 Teile (M475).

**Lehren:**
- Konflikte entstehen an Dateien, an die jeder anhängt (Single-File, Tabellenzeilen,
  Ende von index.css, „Was ist neu") – solche Stellen strukturell entschärfen, nicht
  per Disziplin.
- Agenten mergen gern vor dem CI-Lauf → Regel „erst nach grünem PR prüfen" ausdrücklich
  in jeden Brief.
- Zähl-/Längen-Reihen (Kacheln, Tooltips, Hilfe) brechen bei fast jedem Feature →
  laufen als Wächter immer mit.
- Große Umbauten (CSS-Aufteilung, store.ts) nur, wenn wenige Agenten laufen; vorher
  Byte-/Pixel-Vergleich als Nachweis.
- Start-JS-Grenze als Prüfreihe hält alle Agenten zum Nachladen an.
- Betreiber-Schritte (OAuth-Clients, Supabase-Provider, Variablen) gesammelt in
  `docs/EINRICHTUNG.md`.

## Entscheidungen, die man nicht rückgängig machen soll

| Entscheidung | Seit | Warum |
|---|---|---|
| Single-File `release/pixinotes.html` neben der Web-App | Tag 1 | Büro-PCs ohne npm/Admin; `file://`, USB, Netzlaufwerk |
| Single-File nur per `release.yml` nach dem Merge | #120 | 3-MB-Datei war Konfliktquelle jedes PRs |
| E2E-Prüfreihen mit playwright-core statt Unit-Tests | MVP, M275 | Fehler liegen im Zusammenspiel; Reihen messen Verhalten, nicht Klassen |
| React Flow + BlockNote statt tldraw | Tag 1 | Lizenz, Karten als React-Knoten |
| Local-first, Daten beim Nutzer (kein Firebase) | M317 | Datenschutz, keine Betreiber-Datenbank nötig |
| Supabase ohne SDK, RLS, Anon-Key im Build | M328 | Bundle klein; Schutz liegt in RLS |
| Drei-Wege-Abgleich + Grabsteine | M311, M351 | Ordner/WebDAV ohne bedingtes Schreiben |
| Patches je Karte statt ganzes Board | M366, M383 | viele Schreiber gleichzeitig |
| Manuelle Größe gewinnt, Pointer-Wache | M104, M106 | Automatik darf Nutzer nicht bekämpfen |
| Physik/Klick-Zoom/Konfetti aus | M294 | ruhige Fläche |
| Kein Milchglas, kein Verlauf, keine Textur | M315 | Leistung und Ruhe |
| Mermaid als Rohtext, schweres per `import()` | M90, M321 | Chunk-Namen sterben nach Deploy; Start-Bundle |
| Fokus = Zoom auf dem Board | M333 | keine tote Zweitansicht |
| Ruhende Notizen | M338 | Editor nur bei Bedarf, große Boards bedienbar |
| Leerer Start, Beispiele nur auf Wunsch | M370 | geteilter Link zeigt nur das geteilte Board |
| Englisch per Beobachter + `translate="no"` an Inhalten | M368, M381 | kein Großumbau aller Texte |
| Fehlergrenze je Karte | M213 | ein Fehler reißt nicht die Ansicht mit |
| Eingang von außen nur über `lib/sicher.ts` | M388 | geteilte Boards sind fremder Code-Eingang |
| Keine Emojis in der Oberfläche | M144, M397 | Ruhe; Symbole aus `Icons.tsx` |
| Bedienung nur im Fokus | M421 | Karten zeigen in Ruhe nur Inhalt |

## Wiederkehrende Fehlerklassen

1. **Tasten und Gesten wirken durch Overlays** (M143, M192, M239, AUDIT R2,
   R3, L8). Regel: Board-Kürzel nur hinter `overlayOffen()` (`lib/overlay.ts`);
   Esc schließt immer nur die oberste Ebene.
2. **Ortszeit vs. UTC** (Gantt „UTC-saubere Tagesarithmetik" 15.07., ICS K13, „heute" K16, Zeitplan L13,
   Zeiterfassung L17/L22). Regel: Tage über `lib/tag.ts`, nie
   `toISOString().slice(0,10)`; Prüfungen mit gestellter Uhr und drei Zeitzonen.
3. **Konflikte und Wettläufe beim Sync** (M81/M82, M247 zweites Fenster,
   M311, M330, M351, A1–A14, M366, M383). Regel: nie „fehlt drüben = gelöscht";
   Basis merken; nur Geändertes schreiben; Gelesenes erst nach Einarbeiten als
   bekannt werten.
4. **Fremde DOM-Eingriffe** — Browser-Übersetzer ersetzen Textknoten durch
   `<font>` und bringen React zum Absturz (M368, `lib/uebersetzung.ts`);
   Inhalte der Nutzer `translate="no"`.
5. **Stapelung/z-index** — React Flow hebt gewählte Karten auf 1000+ (M359);
   Menüs per Portal heben (M151); Schleier über Fokus-Karte (M237), Leisten
   übereinander (M291, M353).
6. **Touch, Stift, IME** — Doppelmeldungen von Stift/Touch (M322), Android-
   IME-Rücktaste (M110), Enter fehlt auf Telefon-Tastaturen (M386),
   Touch-Drag markiert Text (M196), Griff verliert Drag bei Re-Render (M109).
7. **Automatik gegen Nutzerabsicht** — Auto-Größe (M93–M111), Physik (M294),
   Cursor-Klau leerer Notizen (R4).
8. **Zoom-abhängige Maße** — Griffe/Linien im weiten Zoom (M343 `--pn-inv`,
   M401), Anzeige-Skalierung (M268, L27), PDF-Schärfe (M242, M392).
9. **Nachlade-Chunks nach Deploy** (M90, M321 `vite:preloadError`).
10. **Speichergrenzen** — localStorage voll (M259, M303, K18); Anhänge in
    IndexedDB beim Kopieren/Export vergessen (K6, L25, L26, M340).
11. **Falsches Ziel-Board** bei langlaufenden Aktionen (R6, `lib/zielBoard.ts`).
12. **Rückgängig-Granularität** — „ein Handgriff, ein Schritt" (K1, K12, L4,
    L5, L9, L20).
13. **Kontrast im Dunkelmodus** nach Farbänderungen (Runde 7, M178, M284,
    U1–U3) — Akzent als Fläche `--accent-fill`, als Schrift `--accent-strong`.

## Ziele und Leitbild des Betreibers

- **Büroalltag zuerst:** Outlook-Mails, Excel, Word, PDF, Termine, Aufgaben,
  Besprechungen, Präsentieren im Raum — ein Ort für das, was sonst auf
  Zetteln, in Postfächern und Ordnern verstreut ist.
- **Ruhig und flach:** „so einfach, unkompliziert und übersichtlich wie
  möglich" (M294), „cleaner, kantiger, hochwertiger, schneller" (M315). Nichts
  bewegt sich von selbst, die App schweigt, jede Funktion hat einen Ort.
- **Local-first und datensparsam:** läuft offline und ohne Konto; Sync wählbar
  (Ordner, WebDAV, Datei, Google/OneDrive-App-Ordner, PixiNotes-Konto);
  KI mit eigenem Schlüssel oder lokal; Online-Dienste nur als Opt-in.
- **„So wenig Einrichtung wie möglich"** (M317) und „ein richtiges
  Online-Tool" (M328) — beides zugleich: Konto optional, Link ohne Konto.
- **Jedes Gerät gleichwertig:** PC, Tablet mit Stift, Telefon (Fokus, Wischen,
  Teilen-Ziel).
- **Deutsch** in Oberfläche, Code-Bezeichnern, Commits und Doku; Englisch als
  zweite Oberfläche.
- **Vollautomatische Entwicklung:** Agenten liefern bis zum Merge, ohne
  Rückfrage; Wissen steht im Repo (`CLAUDE.md`, diese Datei, `docs/`), nicht im
  Chat.
