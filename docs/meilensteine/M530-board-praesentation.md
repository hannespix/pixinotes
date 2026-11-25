# M530 — Board, Rahmen und Präsentation: Einfügen im Fokus, Rahmen samt Inhalt, Ausgänge der Reise, Esc-Stapel, Board löschen mit Rückgängig
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m530-board-praesentation.mjs` (Port 5530) · Datum: 2026-11-25

## Warum
Umsetzungsrunde nach dem Audit (M528–M533, „ok. setzte alles um!"). Dieses Paket nimmt die offenen Punkte aus
M521 (Board und Präsentation), M514 (Rahmen-Reise) und M523 (Oberfläche) auf. Jeder Punkt ist gegen den Build von
vorher nachgestellt (rot) und gemessen; die Reihe ist jetzt grün.

## Was
| Nr | Was der Nutzer jetzt merkt | Vorher |
|----|----------------------------|--------|
| 1 | **Strg+V im Karten-Fokus** gehört der offenen Karte: In eine Notiz kommt Text bzw. Bild in einem eigenen Absatz ans Ende ihres Texts (der Cursor steht danach dort); jede andere Karte sagt „In diese Karte lässt sich nichts einfügen. Esc schließt sie – dann landet Eingefügtes auf dem Board." — und nichts passiert. Ohne Fokus wie bisher. | Eine Notiz bzw. Bild-Karte entstand unsichtbar hinter der offenen Karte (M521 offen). |
| 2 | **Strg+D am Rahmen** dupliziert ihn samt Inhalt (auch archivierte Karten darin, archiviert) und legt die Kopie **frei daneben** (rechts, sonst darunter) — nicht 30 Punkte versetzt darüber wie bei Karten, denn zwei Rahmen übereinander fingen gegenseitig die Karten des anderen ein. Verbindungen zwischen den kopierten Karten kommen mit, Rahmenpfeile (Rahmen → Rahmen) nicht; ein Strg+Z nimmt alles zurück. Ein **Rahmen allein** hat im Rahmen-Menü „Duplizieren" und „In Board verschieben …" (samt Inhalt, archivierte mit — der Weg aus M521 B11). Die Leiste selbst bekommt keinen Knopf dazu. | Strg+D nahm Rahmen nicht mit; ein Rahmen allein ließ sich weder duplizieren noch verschieben. |
| 3a | **Rahmen-Reise per Alt+Umschalt+P beendet, während die Aufgaben-Zentrale offen ist:** Das Board kommt in der Ansicht von **vor** der Reise zurück, die Oberfläche ist wieder da. | Ausschnitt des letzten Rahmens. |
| 3b | **F in der Reise** passt den aktuellen Rahmen ein (wie die Landung), die Reise läuft weiter. | F passte das ganze Board ein und verließ den Rahmen-Ausschnitt. |
| 3c | **0 im Karten-Fokus** heißt „zurück zur gewählten Darstellung": Die Karte wird wieder eingepasst (wie beim Öffnen, `fokusAnsicht`), die Stufe (−/+) zurückgesetzt. Ohne Fokus stellt 0 weiter 100 % ein. | 100 % — die offene Karte stand danach halb im Bild. |
| 4 | **Reihenfolge der Ausgänge:** Führen von einem Rahmen mehrere Rahmenpfeile weg, zeigt sein Rahmen-Menü „Reihenfolge der Ausgänge" (1. Ziel, 2. Ziel …); ein Klick auf einen Eintrag rückt ihn einen Platz nach vorn. Die Reise und die Nummernmarken folgen; Strg+Z nimmt es zurück. | Nur die Zieh-Reihenfolge — Pfeil löschen und neu ziehen (M514 offen). |
| 5 | **Esc mit Stift in der Hand** und offenem Fenster (Hilfe, Einstellungen, Suche …): erst das Fenster, das zweite Esc legt den Stift weg. | Beides auf einmal. |
| 6 | **Präsentation, Strg+K, Esc** schließt nur die Suche; das nächste Esc beendet die Präsentation — auch, wenn der Fokus nicht im Suchfeld steht (Klick in die Trefferliste). | Suche und Präsentation zusammen (M523 an M521). |
| 7 | **Esc-Stapel** auch für Bild-Export, „Per Link teilen", „Gemeinsam bearbeiten" (Freigabe) und die Liste der Gruppe: Liegt ein Fenster darüber (Alt+H, Alt+E), schließt Esc erst das. | Beide auf einmal (M523 offen). |
| 8 | **Board löschen** fragt nicht mehr mit einem Browser-Fenster: Der Hinweis „Board „…" gelöscht." bietet 12 s lang **„Rückgängig"**; das Board kommt mit Inhalt, Verbindungen und Kennung an seine Stelle im Projekt zurück und ist wieder offen, wenn es das vorher war. **Konto:** Hat das zweite Gerät das Board schon verloren, kommt es dort mit dem nächsten Abgleich wieder und bleibt (Reihe K, zwei Geräte gegen nachgebautes Supabase). | `window.confirm`, kein Weg zurück (M523 offen). |

## Wie (Architektur)
- **Einfügen im Fokus:** `Board.tsx` `onPaste` — bei `focusCard` (und nicht schon von einem Feld behandelt): Daten der
  Zwischenablage synchron in einen eigenen `DataTransfer` kopieren (Text, HTML, Dateien — das Original ist nach dem
  Ereignis nicht mehr lesbar), dann `import('../lib/fokusEinfuegen')`. `lib/fokusEinfuegen.ts` (nachgeladen):
  Notiz → ihr Editor aus `lib/notizEditoren.ts` (Map Kennung → BlockNote-Editor, `NotizEditor` trägt sich per Effekt ein
  und aus): leerer letzter Absatz oder ein neuer (`insertBlocks … 'after'`), `setTextCursorPosition(…, 'end')`, `focus()`,
  dann ein `ClipboardEvent('paste')` an `editor.domElement` — BlockNote/ProseMirror behandeln es wie Strg+V im Text
  (Markdown, Bilder über `uploadFile`, gemeinsam über Yjs; der Fenster-Zuhörer des Boards lässt es durch, weil das Ziel
  im Notiz-Text liegt). Nur lesend (`isEditable` falsch) oder andere Karte → Hinweis.
- **Duplizieren:** `store/duplizieren.ts` (nachgeladen; die Aktion `dupliziere(ids)` in `store/karten.ts` ruft hierher und
  liefert jetzt `Promise<number>`, Aufrufer zeigen den Hinweis im `then`) nimmt zu jedem gewählten Rahmen `frameMembers(f, nodes, true, true)`
  dazu (verschachtelte Rahmen, archivierte Karten) und lässt Kanten zwischen zwei kopierten Rahmen weg (`istRahmen`).
  Ist ein Rahmen dabei, rückt die ganze Kopie um die Breite (bzw. Höhe) der Auswahl + 60 nach rechts (sonst nach unten),
  bis kein anderes Element im Weg liegt (40 Punkte Abstand) — `findFreeSpot` ließ Ränder überlappen.
  `boardTasten.ts` Strg+D reicht alle gewählten Karten **und** Rahmen (`mitRahmen`), Zähltext über `zahlWort`.
  `SelectionToolbar.tsx`: `duplicate()` mit `selFrames`; im Rahmen-Menü bei `framesOnly` `data-taste="rahmen-duplizieren"`
  und `data-taste="rahmen-verschieben"` (öffnet das vorhandene Menü `move` → `moveNodesToBoard`).
- **Rahmen-Reise:** `RahmenReise.tsx` — der `reiseAbo`-Zuhörer am Modul: Endet die Reise, während das Board nicht
  eingehängt ist, schreibt er die gemerkte Ansicht von vorher über `ansichtVormerken(boardId, v)` (neu, `Board.tsx`) in
  `gemerkteAnsicht`, die das Board beim Wiederkommen anwendet (M249), und stellt „Oberfläche ausblenden" zurück. Taste
  `f`/`F` im Tasten-Zuhörer der Reise → `fliegen(300)`.
- **0 im Fokus:** `boardTasten.ts` — `fokusStufeLoesen()` + `FOKUS_ANSICHT_EREIGNIS` (das Board fährt wie bei einem Wechsel
  der Darstellung neu heran, `lib/fokusAnsicht.ts`).
- **Ausgänge:** Kante `data.folge` (Zahl, Platz am Ausgang). `lib/rahmenReise.ts` `rahmenPfeile` sortiert die Ausgänge je
  Rahmen nach `folge` (ohne `folge` hinten, sonst Zieh-Reihenfolge) — `rahmenReise` und damit `rahmenPfeilNr` folgen.
  Store: `ausgaengeOrdnen(kantenIds)` (Aktion in `store/kanten.ts`, nachgeladen aus `store/ausgaenge.ts`, Typ in
  `typen.ts`, ein Rückgängig-Schritt). Menü in
  `SelectionToolbar.tsx` (`data-taste="ausgang-vor"`). Abgleich: eine Kante wird als Ganzes zusammengeführt, `folge` reist
  mit; Fremddaten: Kanten prüft `sicherGestalt` nur auf Kennung/Enden, eine unbekannte `folge` (keine Zahl) wird ignoriert.
- **Esc:** `fensterDarueber()` (M523) in `DrawingLayer.tsx` (Stift; `null` = „liegt irgendein Fenster darüber"),
  `Presenter.tsx` (zusätzlich zu den bisherigen Fenstern), `BildExport.tsx`, `LinkDialog.tsx`, `FreigabeDialog.tsx`
  (je mit `ref` auf den eigenen `.modal-backdrop`), `LiveLeisteVoll.tsx` (`null`). Weil `overlay.ts` den Stapel beim
  Tastendruck festhält, stimmt die Antwort auch für Zuhörer, die nach dem Schließen des oberen Fensters laufen.
- **Board löschen:** `store/struktur.ts` `removeBoard` lädt `store/boardZurueck.ts` nach: `boardLoeschen` (die bisherige
  Logik — letztes sichtbares Board bleibt, nächstes Board des Projekts wird offen) merkt Board, Stelle in `boards`,
  Projekt, Stelle im Projekt und aktives Board und zeigt den Hinweis mit `undo: 'ebene'` — derselbe Knopf wie bei
  Bereich/Projekt (`hinweise.ts` → `ebeneZurueck`); `boardZurueck` legt es zurück. `struktur.ts` merkt nur `boardWeg`
  (das letzte Gelöschte war ein Board); ein Löschen von Bereich/Projekt setzt es zurück und umgekehrt — der Knopf
  gehört dem letzten Hinweis.
  `EbenenMenu.tsx` ohne `window.confirm`. Abgleich: Die Grabsteine des Boards (`lib/grabsteine.ts`) reisen nur, solange
  es fehlt (`grabsteineFuer` lässt Vorhandenes weg); im Konto schreibt der nächste Takt die Board-Datei neu, die
  Zusammenführung auf dem zweiten Gerät sieht es als „drüben neu" (Basis ohne Board). Nachgewiesen in Reihe K.
- **Start-JS (m446/m459/m467/m483/m502):** Nach M527 waren auf dem Hauptzweig nur rund 126 B frei. M530 kostet das
  Start-Paket netto nichts: Nachgeladen sind `lib/fokusEinfuegen.ts`, `store/boardZurueck.ts` (ganz `removeBoard`),
  `store/duplizieren.ts` (ganz `dupliziere`, auch der Teil von vorher) und `store/ausgaenge.ts`. Stand nach dem
  Einmischen von M527/M528/M531: 2 064 812 B (Grenze 2 065 000 B, 188 B frei — rund 60 B mehr als vorher).

## Prüfreihe
`pruefungen/m530-board-praesentation.mjs [A B C D E F G H K]` — A Einfügen im Fokus (Notiz, Bild, andere Karte, ohne
Fokus), B Rahmen duplizieren/verschieben, C Reise (Ende bei offener Zentrale, F) und 0 im Fokus, D Ausgänge, E Stift,
F Suche in der Präsentation, G Esc-Stapel (Bild-Export, Link-Dialog), H Board löschen mit Rückgängig, K dasselbe über
das Konto mit zwei Geräten (Supabase nachgebaut, Gerüst aus m524 ohne Steuerung). Gegen den Build von vorher
(`PN_DIST=…`): A1–A8, B1–B3, B5, B7, C1, C3, D2, E3, F4, G1, G3, H1–H2, K3–K6 rot.

## Grenzen / offen
- Einfügen im Fokus nur für Notizen; Protokoll, Kanban, Tabelle u. a. haben eigene Felder — wer dort hineinklickt, fügt
  wie bisher in das Feld ein. Ohne Klick gibt es nur den Hinweis.
- Strg+D im Karten-Fokus dupliziert wie bisher die gewählte Karte (dahinter) — nicht Teil dieses Pakets.
- Duplizieren nimmt geankerte Striche (Zeichnungen auf Karten) nicht mit (war schon bei Karten so).
- Die Reihenfolge der Ausgänge lässt sich nur im Rahmen-Menü ändern (nicht an der Nummernmarke) — eine Stelle genügt.
- Der Hinweis mit „Rückgängig" nach dem Board-Löschen gilt 12 s und nur in dieser Sitzung (wie bei Bereich/Projekt).
- Die Liste der Gruppe (Live) ist in der Reihe nicht gemessen (braucht einen Live-Kanal); der Weg ist derselbe wie beim Stift.

## Für andere Bereiche
- **m514 K1/K2 (Bildzeit bzw. Stilrechnungen im Flug mit 200 Karten)** flattern unter Last (zwei Läufe nebeneinander):
  gemessen mit `--wiederhole 3 --bahnen 2` auf dem Build **vor** M530 (2 von 3 grün, K2) wie danach (1 von 3, K1) —
  allein grün. Es sind Zeitmessungen, die mit der CPU-Last schwanken; M530 ändert am Flug nichts (nur `F` löst einen
  zusätzlichen Flug aus).
