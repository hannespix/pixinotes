# M542 — Rahmen fangen, richten sich aus und wachsen mit (wie Karten)
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m542-rahmen-fangen.mjs` (Port 5542) · Datum: 2026-11-25

## Warum
Wunsch des Besitzers: „auch Rahmen sollen Snap-Funktionen und automatische Ausrichtungsfunktionen und automatische
Größen etc. bekommen (wie Module)". Bisher blieben Rahmen beim Fangen ausdrücklich außen vor (`frei = … ||
bewegt.some(frame)` in `Board.tsx`), das Menü „Anordnen" arbeitete nur mit Karten, und Rahmen hatten keine
automatische Größe.

## Was
- **Ziehen:** Ein Rahmen (oder eine Auswahl mit Rahmen) rastet mit Kanten und Mitte an anderen Karten und Rahmen
  ein, mit Fanglinien und Abstandsmarken. Der Inhalt bewegt sich exakt mit (auch im Zug kein Versatz). Was der Rahmen
  mitnimmt, zählt beim Fangen nicht als „anderer". Strg/⌘ = frei; mit Raster-Fang rastet er aufs Raster.
- **Größe ändern:** Die gezogene Kante (Griffe von React Flow) rastet an Anfang, Mitte und Ende der Nachbarn ein, die
  gegenüberliegende bleibt stehen; Linie im Zug, Strg = frei, mit Raster-Fang rastet React Flow selbst aufs Raster.
  Gilt für Rahmen **und** Karten (die konnten es vorher auch nicht) — außer Karten mit festem Seitenverhältnis
  (Bild ohne Rahmen, Datei, Pixi): eine Kante allein bräche das Verhältnis. Rahmen fangen nicht an ihrem Inhalt.
- **Anordnen:** Ausrichten, verteilen, Zeile/Spalte, gleiche Größe, größer/kleiner, Raster, Packen, Aufräumen gelten
  jetzt auch für Rahmen — samt Inhalt (bei Größer/Kleiner und gleicher Größe bleibt der Inhalt liegen). Mehrere Rahmen:
  im Rahmen-Menü „Anordnen …" (dasselbe Untermenü wie bei Karten); Rahmen mit Karten gemischt: wie bisher unter ⋯.
  Karten in einem gewählten Rahmen gehen mit ihm und zählen nicht für sich.
- **Größe:** Rahmen-Menü, Abschnitt „Größe": **An Inhalt anpassen** (Rahmen umschließt seine Karten mit dem
  Innenabstand des Anordnens: 30 Punkte, oben 46; Mindestgröße 260 × 180) und **Auto-Größe** (an/aus, wie bei Karten):
  Der Rahmen wächst mit, wenn eine Karte hineingelegt wird, eine Karte am Griff oder mit ihrem Inhalt größer wird.
- Jede Aktion ist ein Rückgängig-Schritt (Wachsen nach dem Ablegen gehört zum Zug, nach der Größe von Hand zu ihr).

## Wie (Architektur)
- `src/components/Board.tsx` `onNodesChangeFang`: `frei` ohne Rahmen-Ausnahme; `andere` ohne `frameDrag.ids`. Der
  **Rahmen-Mitzug** lief bisher in `onNodeDrag` mit `node.position` — das ist die *ungefangene* Lage aus React Flow
  (`getEventHandlerParams` → `dragItem.position`), mit Fangen wären Rahmen und Inhalt auseinandergelaufen. Jetzt hängt
  `onNodesChangeFang` an denselben Schub Positions-Änderungen für den Inhalt an (Versatz der gegriffenen Karte nach dem
  Einrasten, `frameDrag.current.x/y` = zuletzt geschriebene Lage; `ids` ist ein `Set`). `rasterSelbst` gilt jetzt
  auch für Rahmen (M505-Raster in `onNodesChangeFang`).
- `groesseImZug(changes)` (Board.tsx): fängt `dimensions`-Änderungen mit `resizing: true` (NodeResizer). Startkasten
  beim ersten Schritt in `groesseZug.current` (bewegte Kanten = Vergleich mit dem Start; React Flow rechnet jeden
  Schritt aus dem Zeigerweg, Einrasten sammelt sich nicht an). Die letzte Meldung (`resizing: false`) trägt wieder die
  rohe Größe — sie bekommt die zuletzt gefangene (`letzte`). Rechnung: `groesseFangen()` in `src/lib/fang.ts`.
- `src/lib/frameOps.ts`: `rahmenWachstum(nodes)` (reine Rechnung, nur wachsen, kleine Rahmen zuerst — ein innerer
  wächst vor dem äußeren), `rahmenWachsen()` (schreibt ohne eigenen Schritt; nicht bei Nur-lesen und für Gäste nicht
  an fremden Rahmen, `karteFest`), `rahmenAnpassen(ids)`, `rahmenAutoSetzen(ids, an)`, `rahmenAuto(n)`, `RAHMEN_MIN`.
  Rahmenmaß: gesetzte `width/height` vor der Messung (die folgt erst ein Bild später). Datenfeld:
  `data.autoGroesse: boolean` am Rahmen (normale Änderung im Abgleich).
- Auslöser der Auto-Größe: `onNodeDragStop` (Rahmen und Karten, nach `ziehEnde`, nur wenn sich etwas bewegt hat), Ende
  einer Größe von Hand (`groesseImZug` → `'ende'`), und **Messungen** (`dimensions` ohne `resizing`, z. B. eine Notiz
  mit Auto-Größe wächst beim Tippen) — diese in `runDerived` (kein Hochladen, kein Schritt; jedes Gerät misst selbst,
  CLAUDE.md §6 „Abgleich"), nicht mitten in einem Zug oder einer Größenänderung (deren Ende übernimmt es als echte
  Änderung). Geprüft wird nur, ob es überhaupt einen Rahmen mit Auto-Größe gibt — nichts läuft je Store-Änderung.
- `src/components/SelectionToolbar.tsx`: `einheitenAus(nodes)` (äußere gewählte Rahmen + Karten außerhalb gewählter
  Rahmen, `inhalt` = Mitglied → Rahmen), `anordnen` verschiebt den Inhalt eines Rahmens mit (nicht bei
  `bigger`/`smaller`), `einheitenZahl` steuert „Anordnen …" und die Mindestzahl der Knöpfe. Rahmen-Menü: Knopf
  `data-taste="rahmen-menue"` (Titel ändern die Tooltips beim Überfahren), `rahmen-anordnen`, `rahmen-anpassen`,
  `rahmen-auto` (mit `aria-pressed`).

## Grenzen / offen
- Auto-Größe **wächst nur** (begründet in `rahmenWachstum`): Schrumpfen von selbst zöge den Rahmen zusammen, sobald eine
  Karte herausgezogen wird, und gäbe freigehaltenen Platz auf. „An Inhalt anpassen" schrumpft auf Wunsch.
- Ein Rahmen, der wächst (oder angepasst wird), kann Karten einfangen, deren Mitte danach in ihm liegt — so wie beim
  Vergrößern von Hand (Mittelpunkt-Regel, M149).
- Fremde Änderungen (Abgleich, Live-Team) lösen kein Wachsen aus; das Gerät, das die Karte bewegt, lässt den Rahmen
  wachsen und gleicht das ab. Gemessenes Wachsen (Inhalt) rechnet jedes Gerät selbst.
- Beim Ändern der Größe rasten nur Kanten (Anfang/Mitte/Ende der Nachbarn), keine Abstandsmarken.
- Größe ändern mit gedrehten Karten (eigene Eck-Griffe, M400) fängt nicht.
- Nebenbei behoben (`src/store/karten.ts` `onNodesChange`): Eine Größe von Hand am rechten/unteren Griff kommt nur als
  `dimensions`-Änderung und galt deshalb als „mechanisch" (`runDerived`) — sie löste allein kein Hochladen aus. Jetzt
  zählt eine `dimensions`-Änderung mit `resizing` (NodeResizer) als Bearbeitung; reine Messungen bleiben Mechanik.
