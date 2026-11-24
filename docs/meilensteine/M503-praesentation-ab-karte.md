# M503 — Präsentation startet bei der gewählten Karte
PR: #194 · Prüfreihe: `pruefungen/m503-praesentation-ab-karte.mjs` (Port 5503) · Datum: 2026-11-24

## Warum
Rückmeldung: „wenn ich bei einem modul präsentieren klicke soll die präsentation an dieser stelle öffnen.
momentan öffnet es immer das erste modul nicht das ausgewählte."

## Ursache
1. **Nur der Fokus-Knopf nannte eine Startkarte.** „Ab dieser Karte präsentieren" im Karten-Fokus (M228) setzte
   `presentFrom`, alle anderen Wege riefen `setPresenting(true)` ohne Karte: das Dock (⋯ → Präsentieren), Alt+P, die
   Suche, das Menü des Boards. Wer eine Karte markiert hatte und dort „Präsentieren" drückte, landete immer auf
   Folie 1. Am Rechtsklick-Menü der Karte und im ⋯ der Auswahl-Leiste gab es gar kein „Präsentieren" – auf dem
   Board blieb von einer gewählten Karte aus nur das Dock, und das begann vorn.
2. **Gewählte Karte ohne Folie → Folie 1.** Der Presenter suchte die Karte nur unter den Folien
   (`slides.findIndex`). Fiel sie aus der Folienliste (statische Karte ohne Inhalt), war der Index −1 und der Vortrag
   begann von vorn. (Selten – die meisten Typen sind immer Folien –, aber derselbe Fehlerweg.)
3. **Die Startstelle kam einen Durchgang zu spät.** Sie wurde in einem Effekt NACH dem ersten Zeichnen gesetzt. Der
   erste Durchgang zeigte Folie 1 (bzw. die Stelle des vorigen Vortrags, der Presenter bleibt eingehängt) und
   meldete sie per `vortragMelden` ans Team – bei Gästen im Live-Board blitzte Folie 1 auf, bevor die gewünschte kam.

## Was
- **Fokus** („Ab dieser Karte präsentieren"), **Kontextmenü** (Rechtsklick auf die Karte → „Ab hier präsentieren")
  und **⋯ der Auswahl-Leiste** (eine Karte markiert) starten bei genau dieser Karte.
- **Dock „Präsentieren", Alt+P, Suche „Präsentieren"** und das **Menü des Boards, auf dem man ist**, starten bei der
  Karte im Fokus, sonst bei der EINEN markierten Karte, sonst von vorn. Begründung: Wer eine Karte markiert hat, ist
  „dort"; mehrere markierte Karten sind keine Stelle (dafür gibt es „Als Präsentation" in der Auswahl-Leiste), dann
  wie gewohnt von vorn.
- **Ein anderes Board** (Menü eines anderen Boards in der Spalte, Portal-Karte „Ziel-Board präsentieren") beginnt
  immer vorn – eine alte Markierung dort ist keine Stelle, an der man gerade ist.
- **Rahmen markiert** → seine Abschnitts-Folie (der Rahmen-Name, M413), danach seine Karten. **Gewählte Karte ist
  keine Folie** → die nächste Folie dahinter (sonst die letzte davor), nicht wieder Folie 1.
- **Live-Board:** Gäste sehen von Anfang an dieselbe Startfolie wie die Vortragende, ohne Folie 1 dazwischen; die
  eigene Markierung eines Gastes spielt beim Mitgehen keine Rolle.

## Wie (Architektur)
- `src/store/ansicht.ts`: `setPresenting(on, ab?)` – `ab` gesetzt = Startkarte (`null` = ausdrücklich von vorn);
  ohne `ab` gilt `presentFrom ?? startKarte(state)`, `startKarte` = `focusCard` (wenn auf dem aktiven Board) sonst
  genau eine markierte, nicht archivierte Karte. Typ in `store/typen.ts`. `setPresentFrom` bleibt.
- `src/lib/kartenFolge.ts`: `folieAb(folge, folien, id)` – Index der Startfolie: die Karte selbst, sonst die
  nächste Folie hinter ihr in der Kartenfolge (sonst die letzte davor); −1 = von vorn.
- `src/components/Presenter.tsx`: `slides`-Memo liefert jetzt `{ reihe, slides }` (volle Kartenfolge + Folien). Die
  Startstelle wird **im Render** gesetzt, in dem `open` umschlägt (`offenStand`, Muster „Zustand an Eigenschaft
  angleichen"): Wem ich folge (`folgeIch` + `werFuehrtVor().vortrag`), dessen Karte und Seite – sonst
  `useBoard.getState().presentFrom`. So zeichnet und meldet schon der erste Durchgang die richtige Folie.
  `presentFrom` wird in einem Effekt geleert (Store nicht im Render ändern). Der Effekt `[open, slides.length]` hält
  nur noch die offene Karte fest (M387). Öffnet sich die Präsentation beim Folgen, ruft der Presenter
  `setOpen(true, karteDesVorfuehrenden)` – nie die Auswahl des Gastes.
- Einstiege: `FocusSheet` → `setPresenting(true, node.id)`; `SelectionToolbar` ⋯/Kontextmenü (eine Karte) neuer
  Eintrag (als erster unter „Weitergeben“ – die Reihenfolge Kommentar · Eigenschaften · Verschieben vorn bleibt, m313) `data-taste="auswahl-praesentieren"` „Ab hier präsentieren"; `EbenenMenu` → `setPresenting(true,
  hier ? undefined : null)`; `PortalCard` → `setPresenting(true, null)`; Dock, `Tastatur` (Alt+P), `SearchOverlay`
  unverändert (`setPresenting(true)` → Fokus/Auswahl).
- Englisch: „Ab hier präsentieren" in `src/sprache/en.json`; „Was ist neu" DE/EN.

## Grenzen / offen
- Die Übersicht (`Overview.tsx`) hat kein eigenes „Präsentieren" (M288/M312) – dort gibt es keine Karte.
- Wer eine Karte markiert lässt und später Alt+P drückt, startet bei ihr; das ist gewollt („dort, wo ich bin").
