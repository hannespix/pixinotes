# M488 — Eingang: in eine Notiz einfügen
PR: siehe Merge-Titel „… (M488)" · Prüfreihe: `pruefungen/m488-eingang-notiz.mjs` (Port 5488) · Datum: 2026-11-23

## Warum
Offener Punkt aus M478 (BACKLOG): Ein Eingangs-Eintrag ließ sich nur als Karte aufs Board holen. Wer einen
geteilten Link, eine Textstelle oder ein Foto in eine bestehende Sammelnotiz („Leseliste", „Urlaubsideen") haben
wollte, musste die Karte holen, den Inhalt umkopieren und die Karte wieder löschen. Der Empfangs-Dialog (Option
„im Eingang sammeln" aus) konnte das schon — aus dem Eingang ging es nicht.

## Was
- **Ziehen auf eine Notiz:** Ein Eintrag aus der Eingangs-Liste, auf eine Notiz-Karte gezogen, landet **in** der Notiz.
  Ist die Notiz offen (Editor wach), genau an der Stelle, an der man loslässt (vor dem Block, über dessen oberer
  Hälfte der Zeiger steht); ruhend am Ende. Die Notiz unter dem gezogenen Eintrag ist leise umrandet.
  Auf freie Fläche gezogen bleibt alles wie in M478 (Karte an der Ablagestelle).
- **Menü:** Am Eintrag erscheint beim Zeigen ein leises **⋯** (am Finger immer) → **„In Notiz einfügen …"**. Die
  Notiz-Wahl steht an der Stelle der Liste im selben Fenster: Suchfeld (Titel und Board, jedes Wort muss passen,
  Groß/Klein und Akzente egal), Notizen aller Boards, **zuletzt bearbeitete oben**, Enter nimmt den ersten Treffer,
  Esc bzw. ‹ führt zurück in die Liste. Mit Häkchen gewählte Einträge gehen gemeinsam („In Notiz …" in der Fußleiste,
  nur solange etwas gewählt ist). Notizen auf einem anderen Board: man steht danach dort (wie bei „Aufs Board").
- Was hineinpasst (Regel aus M289): **Text** (die Notiz-Karte eines Eintrags mit ihren Verweisen) und **eingebettete
  Bilder** (Bild-Karte bzw. Datei-Karte mit Bild). Anderes (E-Mail, PDF, Datei in der Geräte-Ablage) liegt danach als
  Karte rechts neben der Notiz. Ein Eintrag ganz ohne Einfügbares hat kein ⋯ und wird beim Ziehen auf eine Notiz
  eine Karte an der Ablagestelle.
- Der Eintrag verschwindet aus dem Eingang; **ein Strg+Z** holt Notiz-Inhalt und Eintrag zurück (Hinweis mit
  Notiz-Titel). Der Inhalt übersteht das Neuladen.

## Wie (Architektur)
- **`src/lib/eingangNotiz.ts`** (nachgeladen — Start-JS unverändert): `bloeckeAus(node)` (Notiz → tiefe Kopie der
  Blöcke mit frischen Kennungen, Verweise noch einmal durch `webAdresseVonAussen`; Bild → `image`-Block, Quelle nur
  über `rasterBildVonAussen` — `lib/sicher.ts`), `einfuegbar(eintrag)`, `notizenZurWahl(boards, aktiv)` (ohne
  Eingang und archivierte Boards, sortiert nach `geaendert ?? angelegt`, bei Gleichstand das offene Board zuerst),
  `notizSuche`, `ablageIndex(kartenElement, blocks, y)` und `eingangInNotiz(gruppen, notizId, index?)`.
- `eingangInNotiz` folgt dem Muster von `eingangHolen` (M478): Board der Notiz öffnen, `pushHistoryBoards([EINGANG_ID])`
  (Notiz-Board + Eingang in EINEM Schritt), dann `setState`: Blöcke einsetzen (eine leere Notiz wird ersetzt statt
  ergänzt), Karte `geaendert` stempeln, Nicht-Einfügbares ohne Marke (`ohneMarke`, jetzt exportiert) neben die Notiz.
  Der offene Editor übernimmt den Stand über **`NOTIZ_EXTERN`** (M364: `externRef` verhindert, dass `onChange` ihn als
  Tippen zurückschreibt und einen zweiten Undo-Schritt anlegt). In einem Live-Board (`liveVerbunden`, gemeinsames
  Tippen M477) greift M364 nicht — dort zählt `extEpoch` hoch, der Schreiber übernimmt und verteilt.
  Undo: `notesDiffer` erzwingt den Remount (`importEpoch`), der Editor liest den alten Stand.
- **Ablagestelle:** `ablageIndex` nur bei wachem Editor (`.ProseMirror[contenteditable="true"]` in der Karte); die
  obersten Blöcke findet es über `.bn-block-outer[data-id]`, deren Kennung unter den obersten Blöcken von
  `data.blocks` steht (der Editor schreibt seine Kennungen mit — deshalb auch frische Kennungen beim Einfügen).
- **Board.tsx → `handleDrop`:** Bei `EINGANG_ZIEHEN` über `.react-flow__node-note` lädt es `eingangNotiz` per
  `import()`; liefert `eingangInNotiz` 0 (nichts passt), geht es weiter zu `eingangHolen` an der Ablagestelle.
  `onDragOver` setzt `data-eingang-ziel` an die Notiz unter dem Zeiger; `eingangZielWeg()` (`lib/eingang.ts`) räumt
  beim Ablegen und bei `dragend` des Listeneintrags auf. Der Notiz-Wächter M289 (`useNurBilderInDenText`) lässt
  Ablagen ohne Dateien durch, ProseMirror ohne Text/HTML ebenso — das Ereignis kommt beim Board an.
- **`EingangFenster.tsx`:** ⋯ `eingang-mehr` (nur bei `einfuegbar`), Menü als eigene Zeile unter dem Eintrag
  (`.eingang-menue`, wird nicht vom Listenrand abgeschnitten), Fußknopf `eingang-in-notiz-wahl`, Unterfenster
  `NotizWahl` (`data-taste="eingang-notizwahl"`). Esc schließt erst Menü, dann Notiz-Wahl, dann die Liste.
- Stil in `src/styles/76-eingang.css` (⋯ in Ruhe `opacity: 0` nur bei `hover: hover`, Notiz-Wahl, Markierung
  `.react-flow__node-note[data-eingang-ziel]`). Keine Bedienung in Karten — die Listen in
  `99-bedienung-im-fokus.css` bleiben unberührt.

## Grenzen / offen
- In eine Notiz kommen nur Text, Links und eingebettete Bilder; E-Mails werden nicht in Text umgewandelt (Anhänge,
  Absender, Destillat bleiben an der E-Mail-Karte), sie liegen als Karte daneben.
- Die Ablagestelle gilt nur in der offenen Notiz und nur zwischen obersten Blöcken (nicht in Listen-Unterpunkte
  hinein); eine ruhende Notiz bekommt den Eintrag ans Ende. Im Fokus (Notiz groß geöffnet) ist das Board darunter
  verdeckt — dort geht es über das Menü.
- Die Notiz-Wahl zeigt höchstens 60 Treffer (Suche schränkt ein).
