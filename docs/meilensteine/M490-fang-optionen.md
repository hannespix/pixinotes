# M490 — Einrasten wählbar, „Lebendige Fläche" abgelöst
PR: siehe Merge-Titel „… (M490)" · Prüfreihe: `pruefungen/m490-fang-optionen.mjs` (Port 5490) · Datum: 2026-11-23

## Warum
Nutzerfrage: „Seit die Karten ausweichen, braucht man die Option lebendige Flächen doch gar nicht mehr? Kann man
die Fanglinien und das Einrasten in den Optionen optional gestalten?"
Seit M481 hieß „Lebendige Fläche" nur noch Klick-Zoom + Konfetti — zwei Dinge, die nichts miteinander zu tun haben.
Die Fanglinien (M344) waren immer an, nur Strg beim Ziehen legte frei ab; der Raster-Fang (M88) war über Alt+R,
Kontextmenü und Dock erreichbar, aber nicht in den Einstellungen.

## Was
- Einstellungen → Darstellung → Bedienung: **Einrasten: Aus · Fanglinien · Raster** (ein Segment, Standard
  Fanglinien = Verhalten wie bisher). „Aus" legt frei ab (keine Linien, kein Raster), „Raster" ist der bisherige
  Raster-Fang. Alt+R, Kontextmenü „Raster-Fang" und Dock „Gitter & Raster-Fang" schalten dasselbe: Raster an/aus,
  aus dem Raster geht es zurück zum vorherigen Modus (Aus bzw. Fanglinien). Strg/⌘ beim Ziehen legt weiter frei ab.
- **„Lebendige Fläche" entfällt.** An ihrer Stelle **„Konfetti beim Erledigen"** als eigener Schalter (Wert von
  `konfetti` bleibt).
- **Klick-Zoom entfällt** (die Ansicht flog zu einer angeklickten Karte, Esc flog zurück). Grund: Er griff nur bei
  `cardFocus === false` — und den Fokus kann seit M314 niemand mehr abschalten (Migration `schliff < 2` setzt ihn
  an, es gibt keinen Schalter). Die Option wirkte also seit M314 für niemanden mehr. Hinfliegen tun Doppelklick
  (Fokus, M212/M228), die Suche (Strg+K springt zur Karte) und die Übersicht. Der gespeicherte Wert wird verworfen.
- Einmal-Hinweis für sehr alte Stände (M294, `ruheHinweis`): „Physik ist jetzt aus. Bewegung beim Ziehen:
  Einstellungen → Darstellung." (vorher nannte er den Klick-Zoom).

## Wie (Architektur)
- Neues Vorlieben-Feld **`fangLinien`** (Standard `true`; `store/typen.ts`, `store/ansicht.ts` `setFangLinien`,
  persistiert in `store/speicher.ts` `speicherAuswahl` und `lib/einstellungen.ts` `FELDER` — je Gerät wie `gridSnap`).
  Der Modus ist abgeleitet: `gridSnap ? 'raster' : fangLinien ? 'fang' : 'aus'` (`Settings.tsx`). „Raster" setzt nur
  `gridSnap`; `fangLinien` bleibt stehen — deshalb kehrt Alt+R (`Tastatur.tsx`, toggelt `gridSnap`) ohne weiteren
  Code zum vorherigen Modus zurück. Migration ist dadurch ebenfalls kostenlos: wer `gridSnap` an hatte, steht auf
  „Raster", Alt+R führt zu „Fanglinien".
- `Board.tsx` `onNodesChangeFang`: `!st.fangLinien` reiht sich neben `gridSnap`/Strg/Rahmen ein (keine Linien,
  keine Verschiebung). Klick-Zoom-Zweig in `onNodeClick`, `returnViewport`, Esc-Rückflug-Effekt und `onMoveEnd`
  entfernt; `flyingUntil` bleibt (andere Flüge nutzen ihn). Store-Feld `clickZoom`/`setClickZoom` entfernt,
  Tastenkürzel-Eintrag `zurueckfliegen` (`lib/tasten.ts`) entfernt.
- Segment `[data-taste="einrasten"]` mit `data-einrasten="aus|fang|raster"`, Schalter `[data-taste="konfetti"]`.
- Angepasst: m314 (B2 dreizehn statt zwölf Zeilen, B6 Konfetti-Schalter), m294 (Klick-Zoom/Hinweis-Text, D-Block
  auf „Konfetti beim Erledigen").

## Grenzen / offen
- `SCHLIFF` blieb 2 (sonst brächen die Marken-Prüfungen in m294); ein alter `clickZoom`-Wert in
  `pixinotes-einstellungen` wird nicht mehr gelesen und fällt beim nächsten Speichern der Vorlieben heraus.
- Strg im Raster-Modus legt nicht frei ab (React-Flow `snapToGrid` kennt keine Ausnahme) — wie bisher.
