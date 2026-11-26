# M546 — Kommentar-Pins und -Blasen lassen sich nachträglich verschieben
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m546-kommentar-verschieben.mjs` (Port 5546) · Datum: 2026-11-26

## Warum
Auftrag des Besitzers: „kommentar bubbles in pdfs soll man nachträglich verschieben können. machmal überlagern sie
content und man kann ihn dann nicht mehr nachträglich ändern"

Vorher waren Pin und Textblase (M335/M336) fest: Ein Pin auf einer PDF-/Word-Seite stand für immer dort, wo er gesetzt
wurde, die Blase rechts daneben; seit M359 liegen beide obenauf. Verdeckten sie Text, Striche oder Markierungen, blieb
nur Löschen und neu setzen. Mit Stift/Radierer in der Hand sah man nicht, was unter der Blase lag (die Zeichenebene
nahm zwar den Zeiger, die Blase verdeckte aber die Seite). Die Pins wuchsen zudem mit dem Zoom: bei 300 % war eine
Blase 570 Bildpunkte breit und deckte ein Drittel der Seite zu.

## Was
- **Pin ziehen** (Maus, Stift, Finger): legt den Kommentar an eine andere Stelle derselben Seite. Er bleibt auf der
  Seite (px/py ∈ Seite), sitzt beim Verbreitern der Karte und in jeder Zoomstufe an derselben Stelle (Seitenpunkte wie
  bisher). Ein Klick/Tipp ohne Bewegung (Schwelle 4 Bildpunkte, Finger 9) öffnet wie bisher das Gespräch. Ein
  Rückgängig-Schritt je Verschieben, Wiederholen geht.
- **Blase allein aus dem Weg legen**: Blase ziehen → eigener Versatz zum Pin (`bx/by`), eine dünne Linie verbindet
  Pin und Blase. Doppelklick auf die Blase oder „Blase zurück" im Gespräch legt sie wieder neben den Pin. Auch das
  ist ein Rückgängig-Schritt.
  Entscheidung: Pin und Blase sind getrennt greifbar, weil das Gemeinte zwei Fälle hat — der Kommentar sitzt an der
  falschen Stelle (Pin ziehen) oder er sitzt richtig, aber sein Text verdeckt die Umgebung (Blase weglegen, der Pin
  zeigt weiter auf die Stelle). Kein zusätzlicher Knopf an der Karte, kein Menü; „Blase zurück" erscheint nur im
  Gespräch einer weggelegten Blase („Weniger ist mehr").
- **Werkzeug in der Hand** (Stift, Textmarker, Radierer): Blasen und Linien treten zurück (Deckkraft 0,2, keine
  Zeiger) — man sieht und bearbeitet, was darunter liegt. Pins bleiben greifbar: Die Zeichenebene reicht einen Druck
  auf einen Pin an ihn weiter (ziehen verschiebt, tippen öffnet), statt dort zu zeichnen oder zu radieren.
- **Pins an einer Karte** (ohne Seite) lassen sich ebenso ziehen (`kx/ky`, Anteil an Breite/Höhe der Karte, bis 16
  Flächenpunkte vor die Kante); sie wandern mit der Karte und folgen ihrer Drehung (M400).
- **Präsentation**: Die Pins auf der Dokument-Folie (`FolienStift`) lassen sich ziehen, ein Tipp öffnet weiter die
  Spalte.
- **Zoom (M527)**: Pins haben die Bildschirm-Größe der Bedienelemente (`--pn-inv`, also mit derselben Kappung 0,6 …
  7 bzw. 1,5 über 250 %), wachsen um die Stelle, auf die sie zeigen. Blasen schrumpfen beim Herauszoomen mit der Seite
  (Inhalt), wachsen beim Hineinzoomen aber nur wie die Bedienelemente (`scale(min(1, --pn-inv))`).
- **Rechte**: Wer nur lesen darf, verschiebt nichts (Tipp öffnet weiter). Gäste mit „nur Eigenes" verschieben an
  fremden Karten nur Kommentare, deren erster Beitrag von ihnen ist; sonst gelten für Gespräche die bisherigen
  Regeln (sie sind nicht durch `gruppenschutz` geschützt).

## Wie (Architektur)
- `src/store/typen.ts`: `CommentThread.bx/by` (Versatz der Blase, Seitenpunkte) und `kx/ky` (Karten-Pin, Anteile);
  `KOMMENTAR_LAGE` (= px, py, bx, by, kx, ky) und `KommentarLage` (`null` = Feld herausnehmen);
  `HistoryEntry.kommentarOrte` (Lage vor dem Schritt je Gespräch); Aktion `setCommentLage(threadId, lage)`.
- `src/store/kommentare.ts` `setCommentLage`: rundet (Seitenpunkte auf 0,1, Anteile auf 0,001), `pushHistory()`, setzt
  am eben gesicherten Eintrag `kommentarOrte` und schreibt per `patchActive`.
- `src/store/verlauf.ts`: `lageVon`, `lageSetzen`, `orteTauschen`. Gespräche sind sonst kein Teil des Verlaufs (M388,
  `kommentareNach`) — nur ein Schritt mit `kommentarOrte` legt Pins/Blasen zurück; der Gegen-Schritt (Wiederholen)
  bekommt die Lage von jetzt. Gilt im ganzen Rückgängig, im Wiederholen und im gezielten Zurücknehmen
  (`schrittGezielt`, M365).
- `src/components/CommentLayer.tsx` `CommentPin`: `anker` = Stelle, auf die der Pin zeigt (Seite: `g.dx + px·g.k`;
  Karte versetzt: `kx·w/ky·h`; sonst wie bisher rechts neben der Ecke), gedreht wie bisher. Zug (`Zug`-Ref): beim
  Anfassen wird einmal gemessen (Bildpunkte je Flächenpunkt aus dem Kasten der Karte / `measured.width`, × `g.k`),
  im Zug nur ein lokaler Zustand (kein Speichern, nichts wird ein-/ausgehängt — die Linie zur Blase steht immer im
  DOM und wird per `display` gezeigt), beim Loslassen ein `setCommentLage`. `offenAm` unterdrückt den Klick nach Zug
  oder Tipp. Pin: `transform: translate(…) scale(var(--pn-inv))`, Ursprung 13/13 (Seite, versetzt) bzw. `0 50%`
  (an der Ecke). Blase: Standardlage `anker + 15 × --pn-inv` per `calc`, weggelegt `anker + (bx, by)·g.k`.
  Prop `werkzeug` (Tool ≠ select) → Klasse `durchlaessig`. Gespräch: Knopf `data-taste="kommentar-blase-zurueck"`.
- `src/components/DrawingLayer.tsx`: `onDown` reicht einen Druck über einem `.comment-pin` (per `elementsFromPoint`)
  als neues `PointerEvent` an den Pin weiter (der Pin fängt den Zeiger mit `setPointerCapture`); der Fenster-Zuhörer
  für Stiftgeräte (`runter`) lässt Pins in Ruhe.
- `src/components/FolienStift.tsx`: Pins mit eigenem Zug (`pinZug`, `pinLage`, `pinZiehen`) — Seitenpunkte direkt
  aus `lage.k` (Bildpunkte je Seitenpunkt), Tipp ohne Bewegung → `onPin`.
- `src/lib/sicherGestalt.ts` `gespraechVonAussen`: `seite/px/py/bx/by/kx/ky` von außen nur als endliche Zahlen.
  Keine Zeitfelder (kein Eintrag in `abgleichZeiten.ts` nötig).
- `src/styles/32-dialoge-pdf.css`: `.verschiebbar` (`touch-action: none`), `.zieht`, `.comment-blase.weg`,
  `.comment-blase-linie` (z 2999, 1 Bildpunkt), `.durchlaessig`.
- Die Listen in `99-bedienung-im-fokus.css` bleiben unberührt: Pins und Blasen liegen nicht in Karten, sondern in der
  Ansicht-Ebene, und sind Inhalt (immer sichtbar).
- Hilfe (`HelpOverlay.tsx`, `HelpOverlayEn.tsx`), Texte in `src/sprache/en.json`.

## Prüfreihe
`pruefungen/m546-kommentar-verschieben.mjs` — A Pin ziehen (Pixel im Zug, gespeichert erst beim Loslassen, px/py,
kein Gespräch, Klick öffnet, Strg+Z/Wiederholen, Seitenrand), B Blase weglegen (bx/by, Linie, Inhalt frei, „Blase
zurück", Doppelklick, Strg+Z), C Radierer (Blase durchlässig, Strich darunter radierbar, Pin ziehen/tippen), D nur
lesen, E Zoom 50 %/200 % (Pin-Größe, Stelle, Zug), F Karten-Pin (kx/ky, wandert mit der Karte, Strg+Z), G Finger, H
Präsentation, I Hilfe. 54 Prüfpunkte grün; gegen den Stand davor rot (A2, A4, A11, B1–B5, B8 …).

## Grenzen / offen
- Abgleich: Gespräche werden je Gespräch als Ganzes zusammengeführt. Verschiebt ein Gerät den Pin, während ein
  anderes im selben Gespräch antwortet, gewinnt bei Konflikt wie bisher eine Fassung (bestehende Regel für Gespräche).
- Keine Tastatur-Bedienung zum Verschieben (Pfeiltasten am Pin); Klick/Enter öffnet weiter das Gespräch.
- Der Radierer-Knopf am Stift (Radierer-Ende) radiert auf einem Pin nicht, er greift ihn.
- In der Präsentation gibt es weiter keine Textblasen, also auch nichts wegzulegen.
