# M525 — Schwere Boards bleiben flüssig
PR: siehe Merge-Titel „… (M525)" · Prüfreihe: `pruefungen/m525-grosse-boards.mjs` (Port 5525) · Datum: 2026-11-25

## Warum
Meldung des Besitzers: Beim Arbeiten an Boards, die per Konto abgeglichen werden, „bricht die Performance immer wieder
ein" — auf Boards mit viel Inhalt und vielen Modulen. (Der zweite Teil der Meldung, zurückgesetzte Änderungen durch
einen älteren Stand vom Server, ist M524.) Das betroffene Board hat nur 31 Karten, aber schwere: 16 eigene Tools
(HTML, 70–730 KB je Tool, im Gerätespeicher), 8 Bilder als **animiertes** SVG im Stand (je rund 60 KB), 4 Ideabubbles,
2 Kanban, 1 Flüssige Schrift „lebendig", 22 Verbindungen, 158 Striche — und es ist auf mehreren Geräten zugleich offen.

## Was gemessen wurde
Drei Boards, jeweils gegen den Build vor M525: (1) der Export des gemeldeten Boards (nur lokal, nichts davon im
Repository), (2) ein nachgebautes „35 Karten, 8 Tools, 3,9 Mio. Zeichen Stand" (große Bilder in Notizen), (3) ein
Board mit 300–450 gemischten Karten. Mit und ohne Konto-Abgleich gegen eine nachgebaute Drive-Ablage (wie m317) und
ein zweites Gerät, das alle paar Sekunden etwas verschiebt. Werkzeuge (im Scratch-Ordner, nicht im Repository):
Zähler im Fenster (JSON-Zeichen, localStorage-Schreiber, React-Renders je Komponente über den Entwicklerhaken,
geladene Rahmen), CDP-Zähler (Stil-/Layout-Rechnungen, JS- und Haupt-Thread-Zeit), CPU-Profil und Chromium-Trace
(Thread-Zeit je Ereignis, Aufrufer erzwungener Stil-Rechnungen).

Die Maschine teilt vier Kerne mit anderen Agenten und zeichnet ohne Grafikkarte (WebGL und Rastern in Software).
Verlässlich sind deshalb die **Zähler** (Zeichen, Schreibvorgänge, Renders, Rechenschritte); Millisekunden gelten nur
im Vergleich alt/neu im Wechsel. Was eine echte Grafikkarte anders macht (Flüssige Schrift, Rastern der Bilder), ist
hier nicht messbar — siehe „Grenzen".

## Ursachen, in Alltagssprache
1. **Jede einzelne Änderung schrieb den ganzen Stand aller Boards als Text.** Der Speicher (`persist`) wandelte bei
   jeder Store-Änderung — jeder Mausbewegung beim Ziehen, jedem Tastendruck, sogar beim Öffnen der Einstellungen —
   alle Boards in JSON um, nur um den Text 400 ms zu puffern und fast immer ungenutzt wegzuwerfen. 30 Mausbewegungen
   auf dem Board mit 3,9 Mio. Zeichen: 138 Mio. Zeichen JSON; auf dem gemeldeten Board (0,67 Mio.) rund 24 Mio. Das
   kostet Rechenzeit in jedem Bild und füllt den Speicher mit Wegwerf-Texten (Aufräum-Pausen des Browsers — das
   „immer wieder").
2. **Beim Ziehen zeichnete sich fast alles neu, was auf „alle Boards" hört.** Die gezogene Karte samt Inhalt (ein
   Kanban mit 60 Tickets: jedes Ticket, jede Mausbewegung), **jedes andere Kanban** des Boards, die Auswahl-Leiste
   mit gut 130 Symbolen und Menüs, die Reiter-Leiste. Gemessen beim Ziehen eines Kanbans: 560 Komponenten je
   Mausbewegung. Dazu maß die Auswahl-Leiste seit M521 nach jedem Zeichnen ihre Lage — eine erzwungene Stil- und
   Layout-Rechnung je Mausbewegung (3,8 ms im Trace).
3. **Dauer-Animationen im Bild.** Die acht SVG-Bilder enthalten CSS-Animationen: Solange sie im Bild sind, rechnet
   der Browser für jedes in **jedem** Bild Stil und Zeichnung neu (im Trace neun Dokumente mit je einer Stil-Rechnung
   je Bild, auch im Leerlauf). Die Flüssige Schrift „lebendig" kommt nie zur Ruhe und rechnet ihre Physik je Bild.
   Gestartete Tools laufen immer weiter (Zeitgeber) und animieren, sobald sie im Bild sind; außerhalb des Bildes hält
   der Browser ihre Animationen selbst an (gemessen: 0 Bilder je Tool außerhalb, volle Rate im Bild). Das Board ist
   also auch „im Leerlauf" beschäftigt, und jede zusätzliche Last (Punkt 1, 2, 4) wird als Ruckeln sichtbar.
4. **Jede Abgleich-Runde ist ein kleiner Hänger** (gemessen, Zahlen unten; die Abhilfe gehört M524).

Was **nicht** die Ursache ist (ausdrücklich geprüft): Laufende Tools werden weder beim Ziehen, Zoomen oder Speichern
noch beim Eintreffen eines Stands vom anderen Gerät neu geladen (kein neuer Rahmen, kein `srcdoc` neu, Prüfpunkt T2);
der Tool-Quelltext liegt im Gerätespeicher und wird nur beim Start eines Tools gelesen, nicht je Render. Karten
werden beim Eintreffen eines Stands nicht neu aufgebaut (kein Remount), aber alle einmal neu gezeichnet. Die
Texterkennung in Bildern läuft je Bild einmal im Hintergrund-Thread und ist nach rund 20 s fertig.

## Was sich geändert hat
- **Speichern** (`src/store/speicher.ts`, `speicherAblage` statt `createJSONStorage`): Gemerkt wird der Stand als
  Verweis; der Text entsteht erst beim Schreiben (weiter 400 ms nach der letzten Änderung). Dabei behalten
  unveränderte Karten, Verbindungen, Striche und Boards ihren Text (`speicherText`, WeakMap je Objekt) — wer eine
  Karte verschiebt, schreibt den Text dieser einen Karte neu, nicht die Bilder aller anderen. Ändert sich nichts, das
  gespeichert wird (Hinweis, Dialog auf/zu), wird nichts vorgemerkt (`standGleich`). Beim Verlassen oder Verdecken
  der Seite (`pagehide`, `beforeunload`, `visibilitychange`) wird sofort geschrieben.
- **Ziehen**: Karten bekommen ihre Lage nicht mehr als Anlass zum Neuzeichnen (`guard` in `Board.tsx` mit `memo`,
  E-Mail-Karte ausgenommen, sie liest die Lage). Auswahl-Leiste, Kanban, Portal, Projektbaum, Aufgaben-Zentrale und
  Reiter halten ihren Stand während eines Zugs fest und lesen mit dem Ablegen neu (`lib/imZugFest.ts`,
  `useNutzerBoards`). Die Auswahl-Leiste misst im Zug nicht.
- **Flüssige Schrift**: hält an, solange eine Karte gezogen wird, und fließt mit dem Ablegen weiter
  (`lib/fluessig/motor.ts`). Wer die Flüssigkeit selbst anfasst, bewegt sie weiter. Das ist die einzige sichtbare
  Änderung dieses Meilensteins.

## Vorher / nachher
Alter und neuer Build im Wechsel auf derselben Maschine, je drei Runden, Median; je Messung 30 Mausbewegungen Ziehen.
Zähler (oben in jeder Gruppe) sind lastunabhängig, Millisekunden nur im Vergleich zu lesen.

| Board | Messgröße | vorher | nachher |
|---|---|---|---|
| Gemeldetes Board (0,66 Mio. Zeichen), Kanban ziehen | JSON je Zug | 22,6 Mio. Zeichen | 0,7 Mio. |
| | Layout-Rechnungen | 43 | 25 |
| | Renders der Karten (äußere Hülle) | 34 | 4 |
| — mit Flüssiger Schrift im Bild | JS-Zeit / Haupt-Thread | 8 590 / 9 970 ms | 2 530 / 4 160 ms |
| | lange Aufgaben (> 50 ms) | 98, zusammen 8,9 s | 29, zusammen 2,1 s |
| — ohne Flüssige Schrift | JS-Zeit / Haupt-Thread | 400 / 1 990 ms | 262 / 1 800 ms |
| Nachbau 3,9 Mio. Zeichen (35 Karten, große Bilder), Kanban ziehen | JSON je Zug | 133,9 Mio. Zeichen | 0,02 Mio. |
| | Layout-Rechnungen | 64 | 40 |
| | JS-Zeit / Haupt-Thread | 910 / 3 110 ms | 499 / 2 550 ms |
| | lange Aufgaben | 17, zusammen 1 190 ms | 3, zusammen 194 ms |
| — Notiz ziehen | JSON je Zug | 129,9 Mio. Zeichen | 0,02 Mio. |
| | JS-Zeit / lange Aufgaben | 791 ms / 8 (589 ms) | 488 ms / 4 (231 ms) |
| Board der Prüfreihe (Gestalt des gemeldeten, Kanban mit 60 Tickets) | Komponenten je Mausbewegung | 560 | 39 |
| | Renders in der gezogenen Karte, 20 Bewegungen | 9 220 | 0 |
| | Renders im anderen Kanban | 940 | 0 |
| | Board-Schreibvorgänge bei „Einstellungen auf/zu" | 2 | 0 |
| | Rechenschritte der Flüssigen Schrift während eines Zugs | 73 | 0 |
| 300 gemischte Karten (1,03 Mio. Zeichen), zwei Runden | JSON je Zug | 35,6 Mio. Zeichen | 0,6 Mio. |
| | JS-Zeit, Kanban / Notiz ziehen | 6,4 s / 10,1 s | 3,7 s / 5,0 s |
| | Haupt-Thread, Kanban / Notiz ziehen | 28,9 s / 24,6 s | 23,4 s / 19,2 s |

Die Zeilen zum 300-Karten-Board fallen in die Zeit kurz nach dem Öffnen, in der der Browser noch Diagramme aufbaut
(siehe „Grenzen", erster Punkt) — sie zeigen, dass ein solches Board hier weiter zäh ist.

Einordnung: Auf dem gemeldeten Board selbst ist der Stand klein (0,66 Mio. Zeichen) — dort bringen Speichern und
Renders rund ein Drittel weniger JavaScript beim Ziehen, der Haupt-Thread bleibt zu neun Zehnteln beim Zeichnen des
Browsers (animierte Bilder, Striche, Karten). Der große Sprung in der Zeile „mit Flüssiger Schrift" kommt vom
Anhalten der Flüssigkeit im Zug und ist auf dieser Maschine überzeichnet (Software-Grafik). Je größer der Stand
(eingebettete Bilder, lange Notizen) und je schwerer die Karten (lange Kanbans), desto größer der Gewinn aus 1 und 2.

## Wie (Architektur)
- **`store/speicher.ts`** — `speicherAblage.setItem(name, { state, version })` bekommt das Objekt von zustand
  (`persist` ruft es nach jedem `set`): `standGleich(letzterStand, state)` vergleicht die gespeicherten Felder per
  Verweis (bei `boards` Eintrag für Eintrag, weil `speicherAuswahl` die Liste je Aufruf neu baut) und überspringt
  Unverändertes; sonst `pendingWrite = { key, wert }` und der 400-ms-Zeitgeber. `flushPersist()` baut den Text mit
  `speicherText`: Reihenfolge und Inhalt wie `JSON.stringify`, aber `state.boards` über `boardText` (Text je Board in
  `textVon`), darin `nodes`, `edges`, `drawings`, `comments` Eintrag für Eintrag über `einzeln`. `getItem` liefert
  den vorgemerkten Stand, falls einer wartet. `reassertPersist` setzt `erzwingen`, damit derselbe Stand trotzdem
  geschrieben wird; ein Rollenwechsel (Schreiber/Mitleser) leert `letzterStand`. Der Single-Writer-Schutz (M81) ist
  unverändert: ein Mitlese-Fenster merkt nichts vor und schreibt nichts.
- **Sicherheitsnetz gegen ein veraltetes Gedächtnis.** Das Gedächtnis stimmt, solange Store-Objekte nie an Ort und
  Stelle verändert werden (so arbeitet der Store, und darauf beruht auch React). Für den Fall, dass es doch einmal
  geschieht: (a) Beim Verlassen/Verdecken der Seite wird ohne Gedächtnis geschrieben (`flushPersist(true)`) bzw. das
  zuletzt mit Gedächtnis Geschriebene gegengeprüft (`nachpruefen`) und bei Abweichung richtig geschrieben. (b)
  Prüfbetrieb: `localStorage['pixinotes-speicher-pruefen'] = '1'` (oder ein Build mit `VITE_SPEICHER_PRUEFEN=1`)
  vergleicht bei **jedem** Schreiben mit `JSON.stringify` und zählt in `window.pixinotesSpeicher.abweichungen`
  (dazu `vorgemerkt`, `uebersprungen`, `geschrieben`); `VITE_SPEICHER_PRUEFEN=2` lässt die Seite bei einer
  Abweichung sichtbar scheitern — damit lief vor dem Merge eine breite Auswahl bestehender Prüfreihen (47 Reihen quer durch
  Karten, Board, Abgleich und Gruppenarbeit: 0 Abweichungen). Die Prüfreihe m525 läuft im Prüfbetrieb (S9).
- **`components/Board.tsx`** — `guard(C, mitLage)`: `memo(Guarded, ohneLageGleich)` vergleicht alle Props außer
  `positionAbsoluteX/Y`. `AuswahlLeiste` ist `memo` (das Board zeichnet beim Ziehen je Mausbewegung neu).
- **`lib/imZugFest.ts`** — `useImZugFest(wahl, schluessel?)`: Auswahl aus dem Store, die während `zugLaeuft()` den
  Wert von vor dem Zug behält; `nachZug` löst nach dem Ablegen ein Neuzeichnen aus. `schluessel` (bei der
  Auswahl-Leiste: Board + gewählte Karten) nennt, was auch im Zug sofort zählt. Genutzt in `SelectionToolbar.tsx`
  (Board, Board-Liste), `lib/eingang.ts` (`useNutzerBoards` → KanbanCard, PortalCard, Navigation, TaskHub),
  `Tabs.tsx`.
- **`lib/fluessig/motor.ts`** — im `takt`: läuft ein Zug, rechnen und zeichnen nur Flächen, die berührt werden
  (`wirdBeruehrt`), der Takt läuft leer mit; `zaehler.schritte` zählt echte Rechenschritte
  (`window.pixinotesFluessig`).

## Für M524 (Konto-Abgleich) gemessen, nicht geändert
Auf dem gemeldeten Board (ohne Flüssige Schrift, damit sie die Messung nicht überdeckt), Gerät A beobachtet, Gerät B
verschiebt eine Karte:
- **Ein eintreffender Stand** kostet auf A rund 150 ms JavaScript, verteilt auf mehrere Aufgaben (längste 137 ms auf
  der vollen Maschine): 843 Aufrufe `JSON.stringify` mit zusammen 10,6 Mio. Zeichen (≈ 16 × das Board — Vergleichen
  und Zusammenführen: `fremdStandEinarbeiten`, `dreiWegeMerge`, `str`, `hash`, `gleicheBoards`), zwei volle
  Schreibvorgänge in localStorage, **alle 30 Karten zeichnen einmal neu** (die Karten kommen als neue Objekte aus
  dem JSON, auch die unveränderten), kein Neuaufbau, kein Tool neu geladen. Mit einem zweiten Gerät, das alle 4 s
  etwas ändert, ist das ein Hänger alle paar Sekunden. Blieben unveränderte Karten beim Einspielen dieselben
  Objekte (Abgleich mit dem Stand davor), zeichnete nur die geänderte Karte neu — und das neue Gedächtnis des
  Speichers schriebe nur deren Text.
- **Jede eigene Änderung** lädt die ganze Board-Datei hoch (0,66 MB, alle acht Bilder reisen jedes Mal mit) plus
  `umgebung.json`; davor liest `anhangInhalt` die Tool-Dateien aus dem Gerätespeicher (jede Runde ein eigenes
  `indexedDB.open`). Auf dem 3,9-Mio.-Board waren es in 40 s Arbeit mit liefernder Gegenseite 12 Uploads mit 23,6 MB
  und 17 Abrufe mit 31,5 MB.
- Drei Abos (`syncFolder`, `webdav`, `kontoSync`) setzen bei jeder Store-Änderung je drei Merker in localStorage
  (`…-dirty` = '1'), rund sechs kleine Schreibvorgänge je Mausbewegung, auch wenn der Merker schon steht (im Profil
  rund 1 ms je Mausbewegung).

## Grenzen / offen
- **Großes Board, viele Diagramme: das Öffnen.** Im Trace des 300-Karten-Boards (neun Mermaid-Karten, rund 27 000
  Elemente im Dokument) erzwingt der Aufbau der Diagramme 180 Stil-Rechnungen über das **ganze** Dokument (je rund
  160 ms, zusammen 28,8 s Thread-Zeit; Aufrufer `insertEdge`/`paintLayoutData` in Mermaid: einhängen, messen,
  einhängen …), und das Einordnen der Ebenen (Layerize) kostet in dieser Phase je Bild rund 150 ms. Das ist
  derselbe Mechanismus wie in M491 (jedes ins Dokument gehängte Element macht über die `:has()`-Regeln den Stil des
  ganzen Baums ungültig) — hier beim Zeichnen der Diagramme statt bei den Fanglinien. Abhilfe wäre, Diagramme
  außerhalb des Board-Dokuments zu zeichnen (eigener Rahmen oder Schattenbaum) und fertig einzusetzen; nicht in
  diesem Meilenstein (MermaidCard gehört gerade M519). **Größter offener Brocken für Boards mit Hunderten Karten.**
- **Animierte Bilder** (SVG mit CSS-Animation) rechnen in jedem Bild, solange sie zu sehen sind; von außen lässt
  sich ein `<img>` nicht anhalten. Möglich wäre: beim Ziehen/Zoomen ein Standbild zeigen oder Animationen nur an der
  gewählten Karte laufen lassen — beides ändert das Aussehen und braucht eine Entscheidung.
- **Laufende Tools** lassen sich nicht pausieren, nur anhalten (dann ist ihr Zustand weg, soweit sie ihn nicht selbst
  speichern). Ein „alle Tools anhalten" oder ein automatisches Anhalten weit außerhalb des Bildes wäre eine neue
  Funktion — Entscheidung nötig.
- **Flüssige Schrift** hält nur beim Ziehen einer Karte an, nicht beim Schwenken und Zoomen. Ihre Kosten mit echter
  Grafikkarte sind hier nicht messbar (ohne Grafikkarte kostet jedes Bild eine Rückkopie aus der Software-Grafik).
- **Der Speicher bleibt localStorage:** Geschrieben wird der ganze Stand als ein Text (jetzt nur noch nach einer
  Pause, und der Text entsteht günstig) — der Schreibvorgang selbst ist synchron (gemessen 5–7 ms bei 0,67 Mio.
  Zeichen, 25–35 ms bei 3,9 Mio. auf der vollen Maschine). Aufteilen je Board oder IndexedDB wäre ein Umbau am
  Speicherformat samt Mitlese-Fenstern.
- **Tippen**: Jede Änderung an einer Notiz ändert `boards`; Kanban, Projektbaum und Reiter zeichnen dann weiter
  einmal je Änderung neu (festgehalten wird nur während eines Zugs).
- **Zoomen und Schwenken** zeichnen je Schritt Auswahl-Leiste, Minikarte, Zeichen-Ebene und Hintergrund neu; die
  Zeit liegt dort fast ganz im Zeichnen des Browsers (Bilder, Striche, Karten), nicht im JavaScript. Unverändert.
- Beim ersten Messlauf am gemeldeten Board trat einmal ein Seitenfehler „Cannot read properties of undefined
  (reading 'length')" auf (ohne Aufrufer festgehalten); in allen späteren Läufen mit Aufrufer-Mitschrift kam er
  nicht wieder.
