# M460 — Versionen nachgeschärft: vergleichen, einzelne Karten zurückholen, löschen, Team
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m460-versionen-2.mjs` (Port 5460) · Datum: 2026-11-23

## Warum
Offene Punkte aus M449 (`docs/meilensteine/M449-board-versionen.md`, „Grenzen / offen"): Der Dialog zeigte nur
Zahlen und eine Skizze; wer eine einzige versehentlich gelöschte Karte zurückwollte, musste das ganze Board
zurücksetzen. Stände ließen sich nicht löschen. Und gerade wenn das Team viel auf einmal umbaute, griff keine
Sicherung — die „Vor Abgleich"-Sicherung ist auf eine je 10 Minuten gedrosselt.

## Was
- **Karte für Karte:** Unter der Vorschau eines Standes steht „Seitdem" — gelöschte, geänderte und neue Karten mit
  Kartensymbol und Titel/Auszug; geänderte mit der M453-Zeit („geändert vor 3 Tagen", genaue Zeit im Tooltip).
  „Geändert" heißt: der Inhalt ist anders — Lage, Größe und Ansichtsfelder (Monat, Zoom, Filter …) zählen nicht.
- **Zurückholen** je gelöschter oder geänderter Karte: Eine gelöschte kommt samt ihren Verbindungen zu Karten, die
  es noch gibt, zurück (lag sie in einem Rahmen, der fehlt, an ihrer Stelle auf der Fläche); eine geänderte bekommt
  ihren damaligen Inhalt, Lage und Größe bleiben. Je Zurückholen **ein** Strg+Z-Schritt; das übrige Board bleibt.
- **Löschen …** je Stand (leiser Knopf neben „Als Kopie öffnen", Rückfrage im Dialog).
- **Team:** Kommen von außen (Ordner, WebDAV, Konto, Gruppe) in einem Schub mindestens **fünf** gelöschte oder
  geänderte Karten auf ein Board, sichert PixiNotes vorher einen Stand „Vor Änderungen anderer" — gedrosselt auf
  einen je Board in zwei Minuten. Kleine Schübe sichern nichts Eigenes (die 10-Minuten-Regel gilt weiter).
- Keine neuen Dauer-Knöpfe: alles im vorhandenen Versionen-Dialog.

## Wie (Architektur)
- `src/lib/boardVersionen.ts`:
  - `kartenVergleich(stand, jetzt)` (pur) → `{ neu, geloescht, geaendert: {dann, jetzt}[] }`; Inhaltsvergleich über
    `inhaltGeaendert` aus `lib/kartenZeit.ts` (beide Richtungen, gleiche `ANSICHT`-Liste wie M453), Typwechsel zählt.
  - `versionLoeschen(boardId, versionId)` in der Schreibkette (`nacheinander`): Eintrag aus `ver-ix:`, `ver:<id>`
    weg, danach `blobsAufraeumen()` — geteilte `ver-blob:` bleiben, solange ein anderer Stand sie nennt.
    `letzteSig`/`letzteZeit` folgen dem nun jüngsten Stand. **Datei-/Tool-Inhalte** (`file:`/`html:` unter der
    Kartenkennung) werden hier bewusst nicht gelöscht: Sie können auch an Karten, anderen Ständen, Vorlagen oder
    einem Rückgängig-Schritt hängen. Das Aufräumen beim Start (`App.tsx` mit `versionsAnhaenge()`) gibt sie frei,
    sobald kein Stand und keine Karte sie mehr braucht (Prüfreihe C8/C10).
  - Neuer Grund `'team'` („Vor Änderungen anderer"), `FREMD_ABSTAND_MS` 2 min; `initBoardVersionen` setzt
    `vorUmbauHaken.fremdSchub` (Drossel je Board, eigene Map `letzterSchub`).
- `src/store.ts`:
  - `vorUmbauHaken.fremdSchub(board, anzahl)`, `FREMD_SCHUB_AB` = 5, `kartenSchub(alt, neu)` (gelöschte + geänderte
    Karten, neue zählen nicht; Vergleich `gleichesObjekt` ohne Flüchtiges). Aufruf in `importSync` nur im `sanft`-Zweig
    (Hintergrund-Abgleich): Boards mit großem Schub gehen an `fremdSchub` und **nicht** zusätzlich an
    `sichern(…, 'abgleich')`. Weil der Haken im Store sitzt und `kontoSync`/`gastSync`/`syncFolder`/`webdav`
    ohnehin über `importSync` einarbeiten, funktioniert er auch, wenn diese Module nachgeladen werden (M459).
  - Neue Aktion `kartenZurueckholen(boardId, ids, stand)`: ein History-Eintrag (Board vorher), gelöschte Karten
    angehängt (fehlender Rahmen → `parentId` weg, absolute Lage), geänderte nur `data` ersetzt, Verbindungen aus dem
    Stand, deren beide Enden existieren; `geaendert` = jetzt (Zurückholen ist eine Änderung von Hand, M453).
    Geänderte Notizen frischen über `NOTIZ_EXTERN` an Ort und Stelle auf (kein Neuaufbau des Boards).
- `src/components/VersionenDialog.tsx`: `vergleich` (useMemo auf Stand + Board, aktualisiert sich nach dem
  Zurückholen), Liste `.versionen-vergleich` mit `data-taste="vergleich-karte"` (`data-art` geloescht|geaendert|neu)
  und `karte-zurueckholen`; `frage` ist jetzt `'ersetzen' | 'loeschen' | false`, Knöpfe `version-loeschen`,
  `version-loeschen-ja`. `kartenName` (Titel/Betreff/erste Textzeile über `nodeToText`, sonst Art-Name).
- CSS im M449-Block von `index.css` (`.versionen-vergleich`, `.versionen-leise`). Hilfe DE/EN im M449-Eintrag.

## Grenzen / offen
- Live-Mitlesen (Zwischenstände anderer beim Tippen, `gastSync.einspielen`) zählt nicht als Schub — es ist nur
  Anzeige; gesicherte Änderungen kommen über `importSync` und werden gezählt.
- Neue Karten zählen nicht zum Schub (sie nehmen nichts weg). Ein Schub, der nur Pfeile oder Striche ändert, auch nicht.
- → M470: Pfeile und Striche stehen jetzt in der Liste und lassen sich einzeln zurückholen; Mehrfachauswahl mit
  „Auswahl zurückholen" (ein Strg+Z). (Vorher: kein Zurückholen von Pfeilen oder Strichen allein; keine Mehrfachauswahl.)
- Versionen bleiben je Gerät (reisen nicht mit Sync/Export) — wie M449.
