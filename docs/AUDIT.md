# Design-/Usability-/Logik-Audit — Juli 2026

**Methodik:** (1) Interaktive Usability-Tour durch 14 App-Zustände inkl. Edge Cases (Desktop 1440/1024, iPhone-Emulation) mit Screenshot-Review · (2) systematisches Logik-Audit des gesamten `src/`-Codes gegen die realen Bibliotheks-Implementierungen · (3) Robustheits-Proben (kaputte Dateien, Extreminhalte, Speicherlimits).

**Ergebnis:** 3 kritische, 7 mittlere, 8 niedrige + 9 Usability-Befunde. **22 davon direkt behoben** (Commits „Audit-Fixes Runde 1/2"), 4 dokumentiert als Backlog.

---

## ✅ Behoben — Kritisch (Datenverlust-Risiken)

| # | Befund | Fix |
|---|---|---|
| K1 | **localStorage-Quota-Fehler crashte still jede Store-Action** — nach 3–4 großen Bildern wurde nie mehr gespeichert; beim Reload war alles seit dem letzten Save weg, ohne Hinweis | Storage-Wrapper mit try/catch, ⚠️-Warn-Toast bei vollem Speicher, Flush bei Tab-Wechsel/Schließen |
| K2 | **Bilder ohne Größenlimit** — ein Handyfoto (4–8 MB) sprengte als Base64 den Speicher und machte jede Interaktion zäh | Bilder werden vor dem Einbetten auf max. 1600 px skaliert und als JPEG komprimiert (Drop + Strg+V); Skalierung greift auch bei kleinen Dateien mit Riesen-Abmessungen |
| K3 | **Tab-✕ löschte ein komplettes Board ohne Rückfrage und ohne Undo** | Rückfrage mit Board-Name + Kartenzahl, wenn das Board nicht leer ist |

## ✅ Behoben — Mittel

| # | Befund | Fix |
|---|---|---|
| M1 | Entf-Taste: Undo stellte Karten **ohne ihre Verbindungen** wieder her (React Flow entfernt Kanten vor den Karten → Snapshot war leer) | Entf läuft jetzt über `onBeforeDelete` durch die eigene Lösch-Logik — Kanten sind im Undo-Snapshot |
| M2 | „Rückgängig" auf inzwischen gelöschtem Board meldete Erfolg, tat aber nichts | Existenz-Check + ehrliche Meldung |
| M3 | `moveBoard`/`addBoard` auf totes Projekt erzeugte unsichtbare „Geister-Boards" | Zielprojekt wird validiert (no-op bzw. Fallback) |
| M4 | Wurf-Physik-Loop lief nach Board-Wechsel weiter und schrieb aufs falsche Board; kein Cleanup bei Unmount | rAF-Cleanup + Board-Guard im Loop |
| M5 | **Kompletter Store wurde bei jedem Tastendruck/Drag-Frame synchron serialisiert** (bei eingebetteten Bildern = MB-Writes pro Buchstabe) | Persist-Writes auf 400 ms gedrosselt (trailing debounce, Flush bei beforeunload/hidden) |
| M7 | .msg-Import: deutsche Umlaute in ANSI-kodierten Outlook-Mails wurden zerstört („GrÃ¼ÃŸe") — und so gespeichert | `ansiEncoding: windows-1252` im Parser |

## ✅ Behoben — Niedrig & Usability

- **N1** Store-Mutationen verpufften still bei toter `activeId` → `patchActive` nutzt denselben Fallback wie die Anzeige
- **N2** Übersicht: Zoom/Pan sprang nach jedem Kachel-Drag zurück → Remount nur noch bei echter Strukturänderung
- **N3** `mailto:`/URL-Links nahmen Satzzeichen mit („max@firma.de.") → Trailing-Interpunktion wird gestrippt
- **N4** Telefonnummern-Erkennung zerschnitt URLs (wa.me/49170…) → URLs werden zuerst erkannt, Nummern darin ignoriert
- **N5** Fristen-Chips veralteten bei lange offener App → 10-Minuten-Refresh
- **N6** Korrupter Storage (leeres boards-Array) → dauerhafter White-Screen → Migration repariert auf Default-Board
- **N7** „Invalid Date" auf E-Mail-Karten bei kaputtem Date-Header → Validitätsprüfung
- **N8** .msg ohne Plaintext-Body ergab leere Karte → Fallback auf HTML-Body
- **U1** Strg+K griff den Fokus nicht zuverlässig (Tippen landete im vorherigen Eingabefeld!) → Fokus wird hart erzwungen
- **U2** Leeres Board war komplett leer (kein Einstieg) → Empty-State-Hinweise, verschwinden mit der ersten Karte
- **U3** Fünf neue Boards hießen alle „Neues Board" → automatische Nummerierung (Boards, Projekte, Bereiche)
- **U4** Übersicht lief beim Anlegen von Projekten/Boards aus dem Bild → fitView bei Strukturänderung
- **U5** Kanban: lange Ticket-Titel quetschten sich neben die Buttons (1 Wort/Zeile) → Umbruch, Aktionen darunter
- **U6** Kachel-Titel in der Übersicht verschwand unter ✏️/✕ → Abstand reserviert
- **U7** Portal-„Board wählen" ragte aus der Karte → volle Kartenbreite
- **U8** Tab-Leiste kollidierte mit dem Hinweis-Pill → Breiten begrenzt
- **U9** Such-Placeholder abgeschnitten; Zoom-Geste (Strg+Scroll) nirgends erklärt → gekürzt bzw. in Import-Hilfe ergänzt

## 📋 Backlog (bewusst offen, mit Empfehlung)

| # | Befund | Empfehlung |
|---|---|---|
| M6 | **Zwei Browser-Tabs überschreiben sich gegenseitig** (letzter Schreiber gewinnt) | `storage`-Event abonnieren und rehydrieren oder Tab-Lock; strukturell gelöst durch den geplanten Arbeitsordner-Modus |
| B2 | Base64-Bilder blähen den persistierten State weiter auf (nur gemildert durch K2/M5) | Binärdaten nach IndexedDB auslagern bzw. Arbeitsordner-Modus (`dateien/`) |
| B3 | Karten-Inhalt wird beim Verkleinern hart abgeschnitten (kein Scroll/Fade) | „…"-Fade unten + Scroll bei Fokus |
| B4 | Kein vollständiges Undo für Board-Löschung (nur Rückfrage) | Board-Snapshot in den Undo-Puffer aufnehmen |

---

*Alle behobenen Punkte sind einzeln per Playwright im echten Chromium nachgetestet (u. a.: Undo stellt Kanten wieder her; 3200-px-Bild wird auf 1600 px skaliert; Persist-Write erfolgt erst nach Tipp-Pause; wa.me-URL bleibt ein Link; Tab-Löschung fragt nach).*

---

# Code-Audit — Juli 2026 (zweiter Durchgang)

**Methodik:** Zwei parallele Voll-Reviews des `src/`-Codes (① Qualität/Duplikate/TypeScript, ② Security/Performance/A11y — jeweils gegen die real installierten Bibliotheken verifiziert) plus mechanische Checks (npm audit, tsc-Strenge, WCAG-Kontraste, Bundle-Analyse).

## 🛡️ Security (alle behoben ✅)

| Schwere | Befund | Fix |
|---|---|---|
| **HOCH** | **XSS im Clipboard-Export:** `esc()` escapte keine Anführungszeichen; ein Anhang mit Dateiname `x" onerror="…"` aus einer fremden Mail landete beim „📋 Kopieren" als aktives Attribut im text/html-Clipboard | `esc()` escapt jetzt `"` und `'`; `img.src` wird ebenfalls escaped. **Per Live-Test mit präpariertem Dateinamen verifiziert** |
| **HOCH** | **mailto-Injection:** „↩ Antworten" übernahm die Absender-Adresse unkodiert — eine präparierte Mail konnte per `?bcc=…&body=…` den Antwort-Entwurf manipulieren | Adresse wird gegen Mail-Muster validiert und encodiert |
| MITTEL | Anhänge mit MIME `text/html` wurden als `data:text/html`-URL eingebettet (Skript-Ausführung beim späteren Öffnen der heruntergeladenen Datei) | Aktive MIME-Typen werden auf `application/octet-stream` neutralisiert |
| — | **Geprüft & sicher:** Live-Rendering (React-Escaping), Link-Erzeugung (kein `javascript:` konstruierbar), ReDoS, Prototype Pollution, „Teilen per E-Mail" (korrekt encodiert), SVG nur im `<img>`-Kontext | |

## ⚡ Performance (behoben ✅)

- **Suchindex wurde bei jedem Tastendruck in jeder Karte neu über alle Boards gebaut — auch bei geschlossener Suche** → Index wird nur noch bei geöffnetem Overlay berechnet
- Entity-Erkennung (libphonenumber) in E-Mail-Karten lief bei jedem Render → memoisiert
- **Bundle −197 kB (gzip −125 kB):** chrono-node und BlockNote luden alle Sprach-Locales; jetzt nur Deutsch (1.833 → 1.636 kB)
- Geprüft & gut: Board re-rendert nicht bei Toasts; React Flow memoisiert Karten; BlockNote-Editoren werden nicht neu instanziert; msgreader lazy; libphonenumber min-Metadata

## 🧹 Code-Qualität (behoben ✅)

- **Typisierte Karten (größter Hebel):** `AppNode`-Union mit per-Typ-Nodes — alle **16 blinden `as unknown as`-Casts eliminiert**, `node.data` ist überall typsicher, `switch (node.type)` narrowt automatisch
- **Duplikate extrahiert:** `InlineName` (3 Implementierungen → 1 Komponente), `countOpenTickets`/`boardMetaLabel` (2 divergierende reduce-Kopien), `readFileAsDataUrl` (2 identische FileReader-Wrapper), Karten-Fabriken `makeNote/makeEmail/…` (Notiz-Erzeugung war 4× dupliziert, Farb-Rotation 2×)
- **Konstanten statt Magic Numbers:** `MAX_EMBED_BYTES` exportiert, `DONE_COL` ersetzt verstreute `=== 2`, `STICKY_COLORS` als eine Quelle, Kartenbreiten zentral in `CARD_WIDTHS`
- **Toter Code entfernt:** ungenutzte Store-Action, No-op-`useReactFlow()`-Aufruf, sinnfreier Alias, ~45 Zeilen CSS der alten Listen-Übersicht (inkl. Reparatur eines dadurch nie greifenden Hover-Effekts)
- Suche öffnet jetzt über Store-State statt synthetischem Tastatur-Event (Dock & Shortcut nutzen dieselbe Quelle)

## ♿ Barrierefreiheit

- ✅ `--muted`-Kontrast von 3,2:1 auf 4,7–5,3:1 (WCAG AA) angehoben — betraf alle Meta-Texte
- ✅ Such-Overlay mit `role="dialog"`/`aria-modal`; aria-Labels für kritische Icon-Buttons ergänzt
- 📋 Backlog: vollständige Fokus-Falle im Overlay, flächendeckende aria-Labels (alle Buttons tragen bereits `title`)

## 📦 Dependencies

- ✅ Einzige im Bundle relevante Schwachstelle (uuid via BlockNote) per npm-Override auf 9.0.1 behoben und Editor-Kompatibilität verifiziert
- ℹ️ elliptic-Kette (low): nur im Build-Werkzeug, nachweislich nicht im ausgelieferten Bundle
- 📋 Backlog: BlockNote 0.31 → 0.49+ (Major-Sprung, behebt die Advisory an der Wurzel — bei nächster Gelegenheit mit Regressionstest)

*Regressionslauf nach dem Umbau: 13/13 Checks grün, inkl. XSS-Probe mit präpariertem Dateinamen, Entf+Undo mit Kanten, Suche/Kanban/Übersicht/Umbenennen.*

---

# Review neuer Features — Release 1.0 (Workflow, Juli 2026)

Vor Release 1.0 lief ein mehrstufiger Review-Workflow: drei parallele Prüf-Agenten (Korrektheit / Security / Vollständigkeit) über den neuen Code (Formen, Mermaid, PDF-Viewer, Zeichnen, Präsentation, Einstellungen), jeder Fund von einem zweiten Agenten gegen den echten Code verifiziert. **7 bestätigte Funde — alle behoben ✅:**

| Schwere | Befund | Fix |
|---|---|---|
| **HOCH** | **Präsentations-Crash:** `slides[idx]` ohne Bereichsprüfung — schrumpfte das Board während der Präsentation (z. B. Backspace löscht eine Karte), stürzte die ganze App ab | idx wird geklemmt (`safeIdx`); Presenter schluckt Board-Shortcuts (Entf/Backspace) statt sie durchzulassen |
| **HOCH** | **localStorage-Quota:** ein großer Import konnte den Speicher sprengen — danach scheiterte *jeder* Write still, der ganze Board-Stand ging beim Reload verloren | Budget-Wächter (`canEmbed`): große Assets werden bei knappem Speicher gar nicht erst eingebettet, mit klarer Meldung „→ in Datenordner exportieren" (Bilder werden ohnehin herunterskaliert) |
| MITTEL | PDF-Viewer: überlappende Renders auf demselben Canvas bei schnellem Blättern (pdf.js-Fehler, verschluckt) | Render ist abbrechbar (`RenderHandle.cancel` im Effect-Cleanup); PDF-Dokument wird pro dataUrl gecacht statt bei jedem Seitenwechsel neu geparst |
| MITTEL | Mermaid: neue Render-ID + Vollrender bei *jedem* Tastendruck | stabile Render-ID pro Karte + 250 ms Debounce |
| NIEDRIG | SVG-Anhänge (`image/svg+xml` mit `<script>`) wurden als `data:`-URL eingebettet | `safeMime` neutralisiert jetzt auch SVG auf `application/octet-stream` (reiner Download) |
| NIEDRIG | Prozess-Formen/Mermaid ohne Icon in Suchtreffern | `TYPE_ICON` um 🔷/📊 ergänzt |
| — | (bereits vorab gefixt) shape/mermaid fehlten im Serializer → nicht durchsuchbar/exportierbar | im `switch` von `nodeToText`/`nodeToHtml` ergänzt |

**Verbleibendes Roadmap-Item:** Für sehr viele oder große eingebettete Assets ist eine Auslagerung der Binärdaten (Datei-/Bild-`dataUrl`) nach **IndexedDB** vorgesehen (statt localStorage) — der Budget-Wächter verhindert bis dahin den katastrophalen Fall (stiller Totalverlust).

*Regressionslauf nach den Fixes: 8/8 gezielte Checks grün (Presenter-Crash-Probe, PDF-Schnellblättern, Mermaid-Edit, Shape-Suche) + 15/15 Voll-Regression Desktop/Mobile + 4/4 auf `file://`.*

---

## Runde 4: Design-Refresh & Modul-Tiefe (auf Nutzer-Feedback)

**Befund:** Das UI-Chrome (Dock, Menüs, Toolbars) setzt durchgehend auf farbige
Emojis — das wirkt verspielt bis kindisch und visuell unruhig. Das Dock hat
12 Slots ohne Gruppierung. Die neuen Module (Zeitplan, Kalender, Aufgaben)
funktionieren, haben aber zu wenig Bedienungstiefe.

### Fix-Liste

**Design / Chrome**
- [x] D1 Emoji-Icons im Chrome durch monochrome SVG-Icons ersetzen (Dock,
      ➕-Menü, Karten-Toolbars, Aufgaben-Zentrale, Presenter-Kopf, Tabs) —
      Emojis bleiben nur im INHALT (Notizen etc.), nicht in der Bedienung
- [x] D2 Dock entrümpeln: Zeichenwerkzeuge (Stift/Marker/Radierer) in ein
      Flyout gebündelt, Import-Hilfe ins ➕-Menü verlagert → 8 statt 12 Slots
- [x] D3 ➕-Menü strukturieren: Sektionen „Notizen & Boards" / „Planung" /
      „Prozess-Formen" / „Verknüpfen" + Import-Hinweis als Fußzeile
- [x] D4 Einheitliche Icon-Buttons (Größe, Abstände, Hover, Aktiv-Zustand)
- [x] D5 Kanban-Ticket-Aktionen auf Icons umgestellt, Fälligkeit dezenter

**Gantt (G)**
- [x] G1 „Heute"-Sprung: Button zentriert die Heute-Linie; beim Öffnen
      scrollt das Diagramm automatisch zu heute
- [x] G2 Konflikt-Auflösung: ein Klick terminiert abhängige Vorgänge
      automatisch nach ihren Vorgängern (topologisch, Dauer bleibt)
- [x] G3 Zeilen umsortierbar (↑/↓ in der Auswahl-Leiste)

**Kalender (K)**
- [x] K1 Zeitplan-Vorgänge als Laufzeit-Streifen über ALLE Tage der Dauer
      (nicht nur am Starttag)
- [x] K2 Wochenansicht: Monat ⇄ Woche umschaltbar, Navigation folgt
- [x] K3 Quellen-Filter: „Alle Boards" ⇄ „nur dieses Board"

**Aufgaben (T)**
- [x] T1 Filter-Chips (Alle / Heute / Überfällig) + Board-Filter
- [x] T2 Fälligkeit direkt in der Liste ändern (Datumsfeld pro Aufgabe)
- [x] T3 Schnell-Eingabe: neue Aufgabe tippen → landet als Ticket im
      Kanban des aktiven Boards (wird bei Bedarf angelegt)

---

## Runde 5 — Responsivitäts-Audit (Phone 390px / Tablet ≤860px)

Methode: Playwright-Durchlauf bei 390×844 (Touch), Screenshot + automatische
Überlauf-Messung (fixe/absolute Elemente außerhalb des Viewports) über alle
UI-Schichten: Board, Tab-Leiste, Dock-Menüs, Auswahl-Leiste, Übersicht
(Hierarchie & Netz), Aufgaben-Zentrale, Suche, Einstellungen, Presenter.

**Befunde & Fixes**
- [x] R5-1 Übersicht-Umschalter (Hierarchie ⇄ Netz) und Graph-Filter liegen
      bei ≤860px AUF der Tab-Leiste (beide `top: 6xpx`) → auf 112px unter
      die Leiste verschoben, Netz-Ansicht bekommt mehr Kopf-Padding
      *(exakt der Fehler aus dem User-Screenshot)*
- [x] R5-2 Tab-Leiste: Home-, Teilen-, Verlauf- und ＋-Button scrollen bei
      vielen Boards aus dem Bild → nur die Board-Tabs scrollen
      (`.tabs-scroll`), Aktionen bleiben fix
- [x] R5-3 Verlaufs-Dropdown wurde vom `overflow-x: auto` der Tab-Leiste
      geclippt (unsichtbar auf Phone) → Scroll-Container nur noch um die
      Tabs, Panel liegt außerhalb; Breite auf Viewport geklemmt
- [x] R5-4 Auswahl-Leiste (Selection-Toolbar) breiter als der Viewport,
      Buttons rechts/links abgeschnitten → bricht ab 640px um,
      Text-Labels („E-Mail", „Kopieren", Zähler) weichen Icon-only
- [x] R5-5 Attribut-/KI-Popover lief links aus dem Bild (rechtsbündig am
      mittig sitzenden Button verankert) → ab 640px mittig über dem Button,
      Breite max. `100vw - 24px`
- [x] R5-6 Aufgaben-Zentrale: Datumsfeld überlappte den Aufgabentext bei
      schmalen Zeilen → Zeile bricht um, Fälligkeit + Board-Chip rutschen
      in die zweite Zeile
- [x] R5-7 Einstellungen ließen sich nicht mit Esc schließen (alle anderen
      Overlays können das) → Esc-Handler ergänzt
- [x] R5-8 Backlinks-Pill kollidierte auf Phones mit dem Dock-Bereich →
      Abstand angepasst, Panel-Breite geklemmt

**Bewusst nicht geändert:** Karten (Kanban/Gantt/Kalender) skalieren über
Canvas-Zoom statt eigener Mobile-Layouts — auf dem Board ist Pan/Zoom die
natürliche Geste; die Karten selbst bleiben desktop-identisch.

---

## Runde 6 — Komplett-Audit: Logik, Features, KI

Methode: drei parallele Prüf-Agenten (Store/State, Feature-Module, KI-Schicht),
jeder Befund am Code verifiziert. 30 Befunde, davon 21 gefixt, 4 als
Fehlalarm/By-Design verworfen, Rest dokumentiert.

**Logik/Store**
- [x] R6-S1 Undo über Notiz-Inhalte remountete Editoren nicht (Store/Editor
      liefen auseinander, Editor schrieb alten Text zurück) → Undo/Redo
      vergleichen Notiz-Blöcke per Referenz und erzwingen den Remount
- [x] R6-S2 Kantenlöschung per Entf-Taste war nicht undo-fähig → läuft
      jetzt durch pushHistory
- [x] R6-S4 Frisch verbundenes Gerät überschrieb fremde Sync-Daten beim
      ersten Edit (Stempel-Prüfung übersprang den Null-Fall) → fremder
      Bestand gilt auch ohne eigenen Stempel als Konflikt
- [x] R6-S5 Geteilte Boards: Portal-boardId und Ticket-Verknüpfungen
      zeigten auf die Welt des Absenders → werden beim Klonen entwertet
- [x] R6-S6 Auto-gesammelte Checklisten-Tickets galten fälschlich als
      erledigt, sobald die Quellnotiz erstmals editiert wurde (pos:-IDs
      wechseln zu echten Block-IDs) → pos:-Links vom Abgleich ausgenommen
- [x] R6-S7 Zwei Auto-Sammler fütterten sich gegenseitig → eingesammelte
      Kopien (link.itemId) zählen nirgends mehr als eigene Aufgaben
      (entdoppelt auch die Aufgaben-Zentrale)
- [x] R6-S8 versions[] gelöschter Boards blieben für immer im Storage →
      removeBoard räumt auf
- [~] R6-S3 (Fehlalarm) TaskHub-Abhaken: das Board ist während der
      Aufgaben-Zentrale unmounted, es gibt keinen veralteten Editor

**Features**
- [x] R6-F1 Kalender-Export verlor ALLE mehrtägigen Einträge und
      exportierte mehr als die sichtbare Ansicht → nur sichtbare Zellen,
      Streifen als ein Termin mit Zeitspanne
- [x] R6-F2 Suche/Export ignorierten Ticket-Person/-Beschreibung/-Frist
      und Gantt-Person → in nodeToText aufgenommen
- [x] R6-F3 Auto-Einsammeln duplizierte Tickets bei Textänderung der
      Quelle → Dedupe zusätzlich über die Link-Identität
- [x] R6-F4 Präsentation: Pfeiltasten in Dropdowns blätterten die Folie
      um → SELECT/BUTTON gelten als Bedienelemente
- [x] R6-F5 Board-Dropdown im Ticket-Detail warf nodeId/itemId weg
      (Auto-Abgleich tot) → unveränderte Auswahl behält die IDs
- [x] R6-F6 Meilensteine zeigten nie einen Konflikt-Pfeil, wurden aber
      von „Konflikte auflösen" verschoben → Anzeige angeglichen
- [x] R6-F7 Esc schloss das Ticket-Detail erst nach Feld-Klick → Panel
      erhält beim Öffnen den Fokus
- [x] R6-F8 „0 neue Termine" trotz Import, sobald 800er-Kappung griff →
      Zählung über Dedupe-Schlüssel
- [x] R6-F9 ICS-Titel mit \\ wurden falsch entescaped → ein Durchgang
      inkl. Backslash
- [x] R6-F10 „Konflikte auflösen" brach bei Ketten > 20 ab → Pässe
      skalieren mit der Zeilenzahl

**KI**
- [x] R6-K1 „1× Strg+Z macht alles rückgängig" stimmte nicht: innere
      Mutatoren pushten eigene History-Einträge → mutedHistory(): ein
      Snapshot pro KI-Plan (aiCommand, aiCluster, aiEdges)
- [x] R6-K2 API-Schlüssel überlebte den Anbieterwechsel und ging an den
      falschen Anbieter (Credential-Leak, z. B. an eigene Server-URL) →
      Schlüssel wird beim Wechsel geleert
- [x] R6-K4 Kein Limit für die Prompt-Größe → Kontext-Deckel (80 Karten /
      30 kB)
- [x] R6-K5 JSON-Reparatur konnte String-Inhalte mit }{ verfälschen →
      String-bewusste Komma-Einfügung (Zeichen-Walker statt Regex)
- [x] R6-K6/K9 Zwei getrennte Busy-Sperren (Dock/Auswahl) erlaubten
      parallele KI-Aktionen; Enter umging die Sperre → globale Sperre im
      Store + Enter-Guard
- [x] R6-K8 Freitext-Eingabe war nach Fehlschlag weg → wird bei Fehler
      wiederhergestellt
- [x] R6-K12 free-Retry ignorierte laufenden Abort → Signal-Check vor dem
      zweiten Versuch
- [~] R6-K3 Lösch-Toast „verdrängt" Erfolgsmeldung: Reihenfolge ist
      umgekehrt (Zusammenfassung kommt zuletzt) — durch K1 ohnehin ein
      einziger Undo-Schritt
- [~] R6-K10 Doppelte Kosten beim JSON-Retry: bewusster Trade-off (nur
      im Fehlerfall)
- [~] R6-K11 „claude-sonnet-5 existiert nicht": doch — Agentenwissen
      veraltet; OpenRouter-Rotation bleibt beobachtet
- [ ] R6-K7 edit_note-Remount setzt den Viewport zurück (fitView) —
      bekannt, bewusst zurückgestellt: Viewport-Erhalt über Remounts ist
      ein eigenes Vorhaben
