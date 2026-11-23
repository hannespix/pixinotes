# M464 — Mauszeiger überall gut sichtbar (Windows)
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m464-mauszeiger.mjs` (Port 5464) · Datum: 2026-11-23

## Warum
Nutzermeldung: „maus cursor ist in manchen modulen/situationen in windows kaum sichtbar!"

Zwei Ursachen:
1. **System-Fadenkreuz** (`cursor: crosshair`): Unter Windows ist das im Standardschema ein dünnes 1-px-Kreuz,
   das die Pixel darunter **invertiert** (XOR). Auf mittelgrauen Flächen (Grau invertiert ≈ Grau), auf
   Screenshots und bei 150 % Anzeige verschwindet es fast. PixiNotes nutzte es zum Zeichnen auf dem Board,
   für Stift/Textmarker in der Präsentation, beim Verbinden (Anschluss-Punkte, auch React Flows eigene
   Regel `.react-flow__handle.connectionindicator`), im PDF-Pin-Modus und in „Bild bearbeiten".
2. **Laser in der Präsentation** (`.folien-laser.an { cursor: none }`): Der Systemzeiger war weg, sobald der
   Laser an war — der Laserpunkt erscheint aber erst bei der ersten Mausbewegung. Nach „L" mit ruhender Maus
   (und nach Laser aus/an) war auf der Folie gar nichts zu sehen.

## Bestand (vorher → nachher)
| Modul / Situation | Selektor | vorher | nachher |
|---|---|---|---|
| Board: Zeichnen (Stift, Textmarker) | `.drawing-layer` (Inline, `DrawingLayer.tsx`) | `crosshair` | `ZEIGER.fadenkreuz` (eigenes Fadenkreuz) |
| Board: Radierer | `.drawing-layer` | `cell` | `cell` (bleibt: unter Windows dickes weißes Plus mit Rand) |
| Präsentation: Stift/Marker | `.folien-stift.an` | `crosshair` | `var(--zeiger-fadenkreuz)` |
| Präsentation: Radierer | `.folien-stift.an.eraser` | `cell` | `cell` |
| Präsentation: Laser | `.folien-laser.an` | `none` immer | `none` nur, solange der eigene Punkt sichtbar ist (`:has(> .laser-punkt.mein[data-sichtbar])`) |
| Verbinden: Anschluss-Punkt | `.pn-handle` | `crosshair !important` | `var(--zeiger-fadenkreuz) !important` |
| Verbinden: Ziel während des Ziehens | `.react-flow__handle.connectionindicator` (React Flow) | `crosshair` | `var(--zeiger-fadenkreuz)` |
| Datei-Karte: PDF-Pin setzen | `.pdf-seite.pin-modus` | `crosshair` | `var(--zeiger-fadenkreuz)` |
| Bild bearbeiten: Zeichenblatt | `.be-blatt` | `crosshair` | `var(--zeiger-fadenkreuz)` |
| Vollbild „Nur Inhalt" (ruhend) | `html[data-rein-ruhe] *` | `none` | unverändert (gewollt, kommt bei Bewegung sofort wieder, M426) |
| Live-Zeiger der anderen | `.live-zeiger` (`Mauszeiger.tsx`) | gezeichnete Pfeile mit weißer Kontur | unverändert (kein Systemzeiger) |
| Übrige (Pfeil, Hand, Text, Größenpfeile, `zoom-in`, `help`, `copy`, `move`, `progress`) | — | System | System (unter Windows gut sichtbar bzw. Standard aller Programme) |

## Wie (Architektur)
- **Ein Ort:** `--zeiger-fadenkreuz` im ersten `:root`-Block von `src/index.css`: SVG-Daten-URI 24 × 24 px,
  Kreuz mit dunklem Kern (`#111`, 2 px) und weißem Rand (4 px), Mittelpunkt mit Ring, Hotspot `12 12`,
  dahinter `crosshair` als Fallback. Für Inline-Styles `src/lib/zeiger.ts` (`ZEIGER.fadenkreuz`,
  `ZEIGER.radierer`).
- Warum 24 px: Chrome/Edge unter Windows blenden url-Zeiger über 32 CSS-px am Fensterrand aus; Windows
  skaliert url-Zeiger nicht mit der eigenen Zeigergröße, darum etwas größer als die 16-px-Systemkreuze.
  SVG bleibt bei 150 % scharf.
- Laser: `FolienLaser` (`Mauszeiger.tsx`) setzt `data-sichtbar` am eigenen Punkt, sobald er steht, und
  nimmt es in `weg()` wieder ab; der Punkt wird beim Einschalten neu gebaut, ein Rest bleibt also nicht.
  Browser ohne `:has()` behalten den Systemzeiger (sicherer Rückfall).

## Regel für künftige Agenten
- Wo der Systemzeiger gut sichtbar ist, den Systemzeiger nehmen (weniger ist mehr).
- Eigene Zeiger **nur** als Variable im `:root`-Block (`--zeiger-*`) bzw. `lib/zeiger.ts` — mit Kontur
  hell/dunkel, ≤ 32 px, Hotspot, System-Fallback. **Kein nacktes `crosshair`** (Prüfreihe m464, A3).
- `cursor: none` nur, wenn ein Ersatz sicher gezeichnet ist; neue Stellen in m464 A1 eintragen.

## Grenzen / offen
- Der Text-Cursor (I-Balken) bleibt der des Systems: Er ist unter Windows ebenfalls invertierend, aber in
  allen Programmen gleich; Windows-Nutzer können ihn unter „Textcursor" dicker stellen.
- Die echte Darstellung des Betriebssystem-Zeigers lässt sich im Prüflauf nicht abfotografieren; geprüft
  werden berechneter Zeiger, Regeln und das Zeigerbild selbst (Kontrast auf hell/grau/dunkel/Board, 100 %
  und 150 %).
