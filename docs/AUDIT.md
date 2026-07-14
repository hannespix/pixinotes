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
