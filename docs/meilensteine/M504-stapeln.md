# M504 — Karten bewusst übereinander legen und stapeln
PR: siehe Merge-Titel „… (M504)" · Prüfreihe: `pruefungen/m504-stapeln.mjs` (Port 5504) · Datum: 2026-11-24

## Warum
Nutzerwunsch: „momentan kann man karten nichtmehr übereinander ziehen, da sie ja immer ausweichen. es wäre toll eine
entsprechende funktion zu haben dass man im bedarf auch manuell stapel oder übereinander setzen kann." Seit M481 weichen
Nachbarn beim Ziehen aus (M485 mit Kette) — gut gegen versehentliches Überdecken, aber es gab keinen Weg mehr, eine
Karte absichtlich auf eine andere zu legen (außer den Schalter „Bewegung beim Ziehen" ganz abzustellen).

## Was
- **Verweilen = Absicht:** Hält man die gezogene Karte rund eine halbe Sekunde (`VERWEILEN_MS` 450 ms) still über einer
  anderen, wird diese zum **Stapel-Ziel**: Sie hört auf auszuweichen und gleitet zurück an ihren Platz unter die Karte
  (wer sonst auswich, ebenso), eine ruhige gestrichelte Linie in Akzentfarbe zeigt „hier ablegen = stapeln".
  Loslassen legt die Karte **obenauf in den Stapel-Versatz** (26/46 Punkte, genau wie Dock → Anordnen → „Stapeln
  (überlappend)"); liegt dort schon ein Stapel, kommt sie auf dessen oberste Karte. Weiterziehen (mehr als
  `LOESEN_PX` 28 Bildschirm-Punkte) hebt das Ziel auf, es weicht wieder aus.
- **Alt (⌥) gedrückt:** Während des Zugs weicht niemand aus, es gibt kein Ziel — die Karte landet frei genau dort, wo
  man sie loslässt („übereinander setzen"). Alt wirkt auch mitten im Zug ohne Mausbewegung; loslassen, und die
  Nachbarn weichen wieder aus.
- **Finger:** Verweilen funktioniert gleich (Zittern bis `RUHE_PX` 10 Bildschirm-Punkte zählt als Stillhalten).
- **Ein Schritt:** Strg+Z nimmt Zug und Stapeln zusammen zurück. Live-Team und Sync sehen die neue Lage erst nach dem
  Ablegen (wie M481) — das Ziel, seine Markierung und das Zurückgleiten sind reine Anzeige.
- **Einmal-Hinweis:** Wer lange (`JAGD_MS` 1,6 s) über derselben Karte hin und her zieht, die immer wieder ausweicht,
  bekommt einmal den Toast „Halte die Karte kurz still, dann legt sie sich auf die andere (Stapel). Mit Alt weicht
  nichts aus." (am Finger ohne den Alt-Satz). Danach nie wieder; auch wer einmal gestapelt hat, sieht ihn nicht
  (`localStorage` `pixinotes-stapel-gelernt`).
- „Weniger Bewegung" (System): Stapeln geht genauso, nur mit den kurzen, ruhigen Übergängen.

## Entscheidung: Kaskade statt „genau dort"
Es gibt im Datenmodell keinen Stapel als Gegenstand — ein Stapel sind überlappende Karten, wie sie „Stapeln
(überlappend)" (`lib/arrange.ts` `layoutStack`) anlegt: Kaskade mit 26/46 Punkten, damit die Kopfzeile jeder Karte
darunter lesbar bleibt, und M481 lässt solche Stapel beim Ziehen in Ruhe („wer beim Greifen schon unter der Karte lag,
weicht nicht aus"). Das Verweilen legt deshalb **in diese Kaskade** — vorhersagbar, der Stapel bleibt lesbar, und die
Karte liegt danach wie jede andere Stapelkarte. Wer exakt übereinander will (ohne Versatz), nimmt Alt. So sind die
beiden Wünsche aus dem Zitat („stapeln" und „übereinander setzen") zwei klar getrennte Gesten ohne neuen Knopf.
Zum Stapel gehört, was mit dem Ziel (auch über Ecken, höchstens 40 Karten) überlappt; obenauf ist die Karte mit dem
höchsten `zIndex` (bei Gleichstand die spätere im Board). Mehrere gezogene Karten (bis `ZIEH_HEBEN_MAX`) kommen in
ihrer Lese-Reihenfolge (oben→unten, links→rechts) nacheinander darauf.

## Wie (Architektur)
- **`src/lib/ziehGefuehl.ts`** (nachgeladen, Start-JS unverändert): in `zugStarten` die Liste `stapelbar` (alles
  Sichtbare außer Rahmen, Archiv und den gezogenen Karten, mit der Lage **vor** dem Zug — das Ziel ist ja gerade
  ausgewichen), `zielFinden(box)` (größte Deckung, mindestens ein Viertel der kleineren Fläche, `deckung`),
  Verweil-Uhr (`uhrNeu`/`verweilt`, neu gestartet, sobald sich die Karte mehr als `RUHE_PX` vom Ruhepunkt entfernt),
  `freiSetzen(an)` (= `Zug.frei`), `stapeln(t)` (Kaskade auf die oberste Karte; `Zug.gestapelt` = Reihenfolge) und
  `aufStapelGleiten(el, x, y)` (umgekehrtes `versatzAufloesen`: die Karte steht nach dem Umsetzen per `translate` noch
  an der Ablagestelle und gleitet über die Feder in den Stapel — kein Sprung). `Zug.schritt` bekommt
  `{ alt, finger }`. Das Ziel trägt `data-stapel-ziel` (nur ein Attribut — **nichts wird im Zug ein- oder
  ausgehängt**, M491), die Fläche bei Alt `data-frei`.
- **`Board.tsx`:** `onNodeDrag` reicht das Ereignis an `ziehSchritt` (Alt, Touch); der vorhandene Tasten-Lauscher
  (Strg für Fanglinien, M344) meldet Alt-Drücken/-Loslassen an `zieh.current.frei` — nur hinter `overlayOffen()`, mit
  `preventDefault` (unter Windows öffnet das Loslassen von Alt sonst das Browser-Menü); Fensterwechsel (`blur`) setzt
  zurück. `ziehEnde` setzt bei einem Stapel die Karten per `touchNode` obenauf und die Lagen per `setNodePositions` —
  beides unter `mutedHistory`, im Rückgängig-Schritt vom Zug-Beginn (M365). Der Einmal-Hinweis kommt über
  `showToast` (Rückruf an `zugStarten`).
- **CSS** `styles/34-praesentation.css` (Abschnitt „Ziehen"): `.react-flow__node[data-stapel-ziel]` — `outline: 2px
  dashed var(--accent)`, `outline-offset: 6px`; kein `:has()`.
- **Texte:** Hilfe DE/EN („Was ist neu" und Abschnitt Board), Hinweise in `src/sprache/en.json`.
- **Ziel = Karte unter dem Zeiger:** Board.tsx rechnet Maus bzw. Finger mit `screenToFlowPosition` in
  Flächen-Punkte um (`zeiger`); Ziel ist die oberste Karte, deren Lage vor dem Zug den Zeiger enthält — wie bei jedem
  Ablegen zeigt man, wohin. Ohne Zeiger (Tastatur) nähme `zielFinden` die Karte mit der größten Deckung.
- **Alte Reihe `m481`** (B1, B2, C) hielt die Maus 0,7–1,4 s über dem Nachbarn still, um das Ausweichen zu messen bzw.
  „ablegen ohne Stapel" zu prüfen — seit M504 ist genau das ein Stapeln. Dort bleibt die Karte jetzt in Bewegung
  (`zappeln`: 12 Punkte quer zur Ausweichrichtung hin und her), Aussage und Grenzen unverändert. m485, m486, m491,
  m344, m490 laufen unverändert.

## Grenzen / offen
- Kein Stapel-Gegenstand (gemeinsam verschieben, aufklappen): Ein Stapel bleibt ein Häufchen überlappender Karten.
- Die Fanglinien greifen auch, während ein Ziel markiert ist; beim Ablegen gewinnt der Stapel-Versatz.
- Mit abgeschalteter „Bewegung beim Ziehen" und bei großen Auswahlen (mehr als 6 Karten) weicht ohnehin nichts aus —
  dort gibt es kein Verweilen (man legt einfach ab, wo man will).
- Rahmen sind nie Stapel-Ziel und werden nicht gestapelt.
