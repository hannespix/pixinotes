# M447 — Barrierefreiheit: Tastatur und Vorlese-Programm in der Kern-Oberfläche
PR: siehe Merge-Titel „… (M447)" · Prüfreihe: `pruefungen/m447-barrierefreiheit.mjs` (Port 5447) · Datum: 2026-11-23

## Warum
WCAG 2.1 AA-Durchsicht der Kern-Oberfläche (Kopfleiste, Seitenleiste, Dock, Auswahl-Leiste, Kontextmenüs,
Einstellungen, Hilfe, Suche, Aufgaben-Zentrale, Übersicht, Karten-Fokus, Fenster) — automatisch in Hell und Dunkel.
Befund-Liste mit Status: `docs/AUDIT.md` §5 (B1–B12).

## Was
- **Tab auf dem Board** springt weiter von Karte zu Karte, verlässt nach der letzten Karte aber die Fläche
  (Auswahl-Leiste, dann Dock); Umschalt+Tab vor der ersten ebenso rückwärts. Vorher kreiste der Fokus ohne Ausweg.
- **Aufgaben-Zentrale** nimmt beim Öffnen den Fokus und gibt ihn beim Schließen an den auslösenden Knopf zurück.
- **Aufklapp-Knöpfe** (Dock „+", „Zeichnen", „Mehr"; Auswahl-Leiste „Mehr", „Rahmen") melden `aria-expanded`.
- **Menü einer Karte** (⋯ und Rechtsklick) ist ein Menü (`role="menu"`, Einträge `menuitem`) — wie das Menü der Fläche.
- **Fenster**: Recherche, Kanban (Einsammeln, Archiv, Ticket) mit `aria-modal`; Nachschlagen und Bild-Lupe mit
  `role="dialog"`; die Bild-Lupe hat jetzt Fokus-Führung (Fokus hinein, Tab im Kreis, Fokus zurück).
- **„Impressum · Datenschutz"** im Hellen mit voller Deckung (vorher 3,7:1).

## Wie (Architektur)
- `src/components/boardTasten.ts`: im Block „Nächste / vorige Karte" — ist die gewählte Karte die letzte (erste) der
  Lesefolge, fokussiert Tab das nächste (vorige) Bedienelement in Dokument-Reihenfolge außerhalb von
  `.react-flow__viewport`. Alt+↓/↑ kreist weiter (bewusst: das ist der Karten-Sprung, nicht die Tab-Folge).
- `src/components/TaskHub.tsx`: `wurzel`-Ref, `tabIndex={-1}`, Effekt auf `open` (Fokus hinein, beim Abbau per
  `requestAnimationFrame` zurück, wenn er verloren ist). CSS `.taskhub:focus { outline: none; }` beim `.taskhub`-Block.
- `src/components/SelectionToolbar.tsx`: `menuPortal` setzt bei `menu === 'more'` `role="menu"` +
  `aria-label="Kartenmenü"`; ein `useLayoutEffect` ohne Abhängigkeiten gibt Knöpfen ohne Rolle `role="menuitem"`
  (Einträge wechseln je Auswahl).
- `src/lib/fensterFokus.ts`: `FENSTER` enthält `.pdf-backdrop` (Bild-Lupe).
- `src/index.css`: `.legal-corner` ohne `opacity: 0.8`.
- Texte: `src/sprache/en.json` („Kartenmenü", „Nachschlagen"), Hilfe DE/EN (Was ist neu).
- Prüfreihe: Werkzeug `window.__a11y` (Namen nach accname-Kurzregel ohne `data-tip`; Kontrast gegen den Grund aus
  Vorfahren + `elementsFromPoint`; Fokus sichtbar = Ring/Schatten/Randfarbe/Grund unterscheidet sich ohne Fokus;
  Tippziele). Dazu eine Quelltext-Durchsicht: jedes Fenster aus `FENSTER` trägt role, aria-modal, aria-label.

## Grenzen / offen
- B11: Ausklapp-Navigation am Telefon (`.nav-panel`) ohne Fokus-Falle — eigene Aufgabe.
- Karten-Inhalte (Editor, Tabellen, Diagramme) prüfen die Reihen der Karten (m284 Kontraste); hier ausgenommen.
- Kontrast des Fokusrings selbst (WCAG 2.2, 2.4.11) ist nicht Teil von 2.1 AA und nicht gemessen.
