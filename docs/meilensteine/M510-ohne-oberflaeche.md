# M510 — Oberfläche ausblenden: nur das Board
PR: #… · Prüfreihe: `pruefungen/m510-ohne-oberflaeche.mjs` (Port 5510) · Datum: 2026-11-24

## Warum
Nutzerwunsch: „Für die Sharing-Arbeit wäre manchmal praktisch, wenn man live das Board überträgt, aber das UI
(Menüs, Rahmen mit Anfassern etc.) ausgeblendet werden kann (mit Shortcut/einem dezenten Umschalter)."
„Nur Inhalt" (M426) gab es schon — aber nur in Präsentation und Karten-Fokus, mit Vollbild und ohne Bearbeiten.

## Was
- **Alt+B** (Mac ⌥B), **⋯ der Leiste unten → „Oberfläche ausblenden"** oder die **Suche** (Strg+K, „Oberfläche
  ausblenden") blenden alles aus, was nicht Board ist: Kopfleiste, Navigation (samt ihrem Platz), Leiste unten,
  Impressum-Ecke, Minikarte, Auswahl-Leisten, Auswahlrahmen, Größen-Griffe, Drehknopf, Anschlusspunkte, Griff,
  Farbpunkt, Rollbalken der Notiz, Live-Leiste, „Folgt mir"-Band, Timer-Chip, Punkte-Leiste, Backlinks, Live-Sperren
  („✎ Name") und die Bedienung in den Karten (M421-Listen, dazu ⋯-Knöpfe, Spalten-Knöpfe, Ticket-Knöpfe).
- **Bleibt:** Karteninhalte, Verbindungen und ihre Beschriftungen, Zeichnungen, Kommentare, Board-Hintergrund,
  **Zeiger der Gäste und Laser** sowie aufsteigende Reaktionen. Entscheidung: Zeiger zeigen, wohin jemand zeigt — beim
  Übertragen ist das Inhalt der gemeinsamen Arbeit, nicht Bedienung; wer sie nicht will, schaltet die Mauszeiger der
  Gruppe wie bisher in der Live-Leiste ab (vor dem Ausblenden).
- **Weiter bedienbar:** Ansicht verschieben und zoomen (Maus, Touch, +/−), Karten anklicken, darin rollen und
  schreiben, Doppelklick legt eine Notiz an, Entf löscht, Rechtsklick-Menü. Entscheidung: Bearbeiten bleibt möglich —
  wer beim Teilen etwas notiert, soll dafür nicht die Oberfläche zurückholen müssen; nur Rahmen und Griffe fehlen.
- **Hinweise:** nur noch solche, die eine Antwort brauchen oder vor Verlust warnen (Rückgängig, eigener Knopf,
  Abbrechen, „Speicher voll") — Klasse `wichtig` am `.toast`.
- **Zurück:** Esc (beim Schreiben führt das erste Esc aus dem Text), noch einmal Alt+B, oder der **dezente
  Umschalter** unten rechts: beim Einschalten 2,6 s mit Beschriftung „Oberfläche einblenden Alt+B", dann unsichtbar;
  jede Mausbewegung zeigt ihn halb durchsichtig (nur Symbol) für 1,6 s, unter dem Zeiger ganz. Am Finger zeigt der
  erste Tipp in die Ecke ihn, der zweite schaltet (ein Wisch übers Board lässt ihn in Ruhe).
- Die Karten bleiben beim Umschalten an ihrer Stelle, obwohl die angeheftete Navigation ihren Platz freigibt.
- **Nur lokal:** nicht gespeichert, nicht im Live-Kanal. Gäste sehen ihr Board wie immer; nach dem Neuladen ist die
  Oberfläche wieder da. Präsentation, Karten-Fokus, Aufgaben-Zentrale und Übersicht beenden den Modus.

## Wie (Architektur)
- `src/lib/nurBoard.tsx`: Zustand als Modul-Variable mit `useSyncExternalStore` (`istNurBoard`, `nurBoardSetzen`,
  `nurBoardUmschalten`); Bauteil `NurBoard({ moeglich })` in `App.tsx` (im `ReactFlowProvider`, nach `<Tastatur />`).
  - Setzt `data-nur-board` am `<html>` im **Layout-Schritt** und misst `.board-wrap` davor und danach; den Versatz
    gleicht es über `setViewport` aus (sonst sprängen die Karten um die Breite der Spalte). Steht die Markierung schon
    (Bauteil neu eingehängt, z. B. `importEpoch`), wird nichts ausgeglichen.
  - Kein Aufräumen beim Aushängen: `ReactFlowProvider key={importEpoch}` hängt das Bauteil kurz nach dem Start neu ein;
    ein Aufräumen nahm die Markierung weg, während der Umschalter noch stand (gefunden in Reihe F).
  - `seit` (Modul): Die Beschriftung des Umschalters steht nur in den ersten `EINFUEHRUNG_MS` nach dem Einschalten —
    auch nach dem Neu-Einhängen.
  - Esc im Capture-Zuhörer, außer in Eingabefeldern, mit offenem Fenster (`overlayOffen()`) oder offenem Menü
    (`[role="menu"]`).
- `src/lib/tasten.ts`: Kürzel `nurBoard` = `Alt+B` (Gruppe Ansichten → Hilfe-Tabelle); ausgeführt in
  `components/Tastatur.tsx` nur bei `amBoard` (kein Fenster, kein Karten-Fokus).
- Einstiege: `components/Dock.tsx` (⋯, `data-taste="dock-nur-board"`), `components/SearchOverlay.tsx` (Befehl).
- `src/styles/73-nur-board.css` (neue Teildatei zwischen 72 und 74): Leisten mit `visibility: hidden` statt `display:
  none` — keine Änderung am DOM und an den Maßen (die gemessene Kopfhöhe bleibt, M491); Spalten-Band (`::before`) weg,
  `.board-wrap` ohne Rand; Auswahlrahmen, Griffe usw. wie beim Bild-Export (M340); Umschalter `.nur-board-ecke` /
  `.nur-board-knopf` (Tokens, ≥ 44 px, `prefers-reduced-motion` ohne Übergang). Kein `:has()`.
- `src/styles/99-bedienung-im-fokus.css`: die M421-Liste steht jetzt **viermal** — die vierte (`html[data-nur-board]`)
  blendet die Bedienung auch an der gewählten, fokussierten Karte aus und nimmt ihr die Klicks.
- `App.tsx`: `.toast.wichtig` (Rückgängig, Knopf, Abbrechen, „Speicher voll / nicht gespeichert").

## Grenzen / offen
- Kein eigener Knopf in der Kopfleiste (Leitbild „Weniger ist mehr") — ⋯ der Leiste, Suche und Kürzel reichen.
- Der Ausschnitt, den „Folgt mir" (M367) überträgt, wird beim Einschalten etwas größer (die Fläche wird um die
  Spalte breiter); Folgende sehen dann etwas mehr Rand. Das Board selbst ändert sich für sie nicht.
- Gruppen-Timer und Live-Sperren sind ausgeblendet; wer sie beim Teilen zeigen möchte, braucht die Oberfläche.
- Am Telefon behalten Tickets den Platz ihrer (unsichtbaren) Knöpfe — wie in M421, damit nichts springt.
