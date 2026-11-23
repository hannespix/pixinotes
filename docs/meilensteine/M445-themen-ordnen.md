# M445 — Karten nach Themen ordnen (Auto-Clustering mit Rahmen)
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m445-themen-ordnen.mjs` · Datum: 2026-11-23

## Warum
Roadmap `docs/KONZEPT.md` „Clustering" (Punkt 1, Auto-Clustering): Die KI soll Karten thematisch gruppieren, in
benannte Inseln ordnen und erst nach einer Vorschau wirklich etwas ändern. Das alte „Themen clustern & anordnen"
(`aiCluster`, M130) änderte sofort, legte Form-Karten als Überschriften plus eine Linie zu jeder Karte an und gab
es nur im Dock – ohne Chat-KI ging es gar nicht.

## Was
- **Ganzes Board:** Dock ⋯ → KI-Assistent → „Nach Themen ordnen …" ordnet alle *losen* Karten (nicht archiviert,
  keine Rahmen, in keinem Rahmen). Schon Gerahmtes bleibt liegen.
- **Auswahl:** ⋯ → Anordnen … → „Nach Themen …" (ab drei Karten; geht auch ohne Chat-KI) und in den KI-Werkzeugen
  „Nach Themen ordnen …". Keine neuen Dauer-Knöpfe.
- **Vorschau:** Dialog mit jeder Gruppe (Name, Zahl, Kartentitel). Namen änderbar, Gruppen abwählbar, Esc bricht ab.
  Erst „n Karten ordnen" ändert das Board.
- **Ergebnis:** je Gruppe ein Rahmen (Frame-Karte) mit dem Namen und einer Pastell-Tönung, Karten darin als Raster
  in Lesereihenfolge, Rahmen in Reihen zu je drei, kollisionsfrei neben unbeteiligten Karten und Rahmen.
  EIN Schritt im Verlauf; die Meldung bietet „Rückgängig".
- **Ohne Chat-KI** (oder wenn sie scheitert): das Gehirn gruppiert über die Einbettungen, Namen aus dem häufigsten
  tragenden Wort der Kartentitel.
- Nichts geht verloren: von der KI vergessene Karten landen in „Weitere Karten", unbekannte Kennungen fallen weg,
  doppelt genannte Karten zählen nur in der ersten Gruppe.

## Wie (Architektur)
- `src/lib/themenOrdnen.ts`: `themenKandidaten` (Auswahl oder lose Karten), `themenVorschlagen` (KI über
  `gather`/`askJson` aus `aiActions.ts`, Antwort `{"themen":[{"titel","ids"}]}`, alte Form `clusters/title/nodeIds`
  wird auch gelesen; Rückfall `perGehirn`), `gruppenBereinigen`, `gruppierenNachVektoren` (agglomerativ, mittlere
  Ähnlichkeit, Schwelle 0,6, höchstens 6 Gruppen), `themenPlan` (Lage relativ zu 0,0; Innenrand 30, Kopf 46 wie
  `frameOps.ts`), `themenAnwenden` (`pushHistory` + `mutedHistory`: Rahmen per `addNode`, Karten per
  `setNodePositions`; Ursprung über `findFreeSpot`, Rahmen dabei als Hindernis verkleidet, weil `findFreeSpot` sie
  sonst übergeht), `themenOrdnenStarten` (globale `aiBusy`-Sperre, Toast mit Abbrechen, Dialog, zurück aufs
  Start-Board).
- `src/components/ThemenDialog.tsx`: `themenDialog(vorschlag) → Promise<ThemenGruppe[] | null>`, hängt sich mit
  eigener React-Wurzel an `document.body` (kein Zustand in `App.tsx`), Klassen `.modal-backdrop`/`.modal`
  (`overlayOffen()` greift), CSS `.themen-*` im Modal-Abschnitt von `index.css`.
- `src/lib/brain.ts`: `kartenVektoren(boardId, ids)` gleicht den Index ab und liefert Titel + Vektor je Karte.
- `src/lib/aiActions.ts`: `aiCluster` entfernt; `gather` und `auslassungsHinweis` exportiert.
- Einstiege: `Dock.tsx` (`data-taste="ki-themen-board"`), `SelectionToolbar.tsx` (`data-taste="ki-themen"`,
  `data-anordnen="themen"`). `m399` erwartet den neuen Knopf im Anordnen-Feld.

## Grenzen / offen
- Kein automatisches nächtliches Aufräumen und kein Pin „vom Aufräumen ausschließen" (KONZEPT nennt beides).
- Karten aus bestehenden Rahmen werden bei Auswahl herausgenommen; verschachtelte Rahmen werden nicht gebildet.
- Liegt das Board in einem vom Gehirn ausgeschlossenen Bereich, hat der Rückfall keine Vektoren („zu wenig Inhalt").
- Keine Morph-Animation – die Karten springen an ihren Platz (ruhiger, und die Messung bleibt eindeutig).
