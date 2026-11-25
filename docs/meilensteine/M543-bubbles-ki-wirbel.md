# M543 — Ideabubbles: Wirbel, solange die KI gruppiert
PR: siehe Merge-Titel „… (M543)" · Prüfreihe: `pruefungen/m543-bubbles-ki-wirbel.mjs` (Port 5543) · Datum: 2026-11-25

## Warum
Wunsch des Besitzers: „ideen bubbles brauchen noch eine animation wenn sie neu gruppiert werden durch KI (zb alles
dreht sich solange KI rechnet oder so". Bisher zeigte nur der Menüpunkt „KI gruppiert …" (im ⋯, das sich dabei schließt),
dass etwas läuft; die Karte stand still, und mit der Antwort waren die Gruppen auf einmal da.

## Was
- **Solange die KI rechnet**, kreisen die Blasen ruhig um die Mitte der Karte (eine Runde in gut zehn Sekunden, außen
  schneller als innen, wächst in knapp einer Sekunde an) und rücken dabei etwas zusammen. Oben in der Karte steht
  „KI gruppiert …" (Status, auch außerhalb des Fokus). Die Tropfen der alten Gruppen lösen sich weich in einzelne Blasen,
  ihre Namen blenden aus, „＋ Gruppe" verschwindet.
- **Mit der Antwort** hört der Wirbel auf, die Blasen fließen über die vorhandene Physik in ihre neuen Felder; die Tropfen
  wachsen um sie zusammen (Rand, Kern und Namenskuppe wachsen mit), die Namen blenden ein, Farben wechseln weich.
- **Bei einem Fehler** hört der Wirbel auf, die Blasen kehren zu ihren alten Gruppen zurück; der Toast bleibt wie bisher.
- **Andere Geräte** (Live-Team, Konto, Ordner, Gäste) sehen den Wirbel mit Hinweis ebenfalls — höchstens 60 s ab dem
  Empfang, damit ein Gerät, das mitten im Rechnen ausfällt, keinen ewigen Wirbel hinterlässt; Einträge älter als
  10 Minuten kreisen gar nicht.
- **Bewegung reduzieren:** kein Wirbel, nur der Hinweis; das Ergebnis erscheint ohne Flug (wie bisher).
- **Leistung:** Der Wirbel rechnet nur, solange die Bühne im Bild ist (IntersectionObserver, 120 px Rand) und der Tab
  sichtbar (rAF). Danach klingt alles wie gewohnt in fünf Sekunden ab und die Rechnung hört auf.
- Strg+Z nimmt das Gruppieren in einem Schritt zurück, ohne den Wirbel wiederzubringen.

## Wie (Architektur)
- **Datenfeld** `data.ki` der Bubbles-Karte: `{ an: boolean, t: number, von?: string }` (`BubbleKi`, `KI_WIRBEL_MS` in
  `lib/bubbles.ts`). `von` ist die Sitzung des rechnenden Geräts (`KI_SITZUNG = uid()` je Laden in `BubblesCard.tsx`),
  nicht die Person — in einer Gruppe teilen sich alle eine Kennung. `bubblesDaten` richtet den Eintrag (`kiVon`), kaputte
  fallen weg.
- **Abgleich:** `bubblesMischen` nimmt den jüngeren Eintrag (wie `regeln`); `syncMerge.ts` führt `ki` in
  `BUBBLES_TABELLEN` (zählt beim Vergleich nicht, nie Konflikt) und im Vergleich von `bubblesVereinen`. Kein Eintrag in
  `abgleichZeiten.ts`: Das Feld hat seinen eigenen Stempel und wird vereinigt, nicht feldweise entschieden.
  `sicherGestalt.ts` GESTALT `bubbles.felder.ki = 'objektOpt'`.
- **Schreiben** (`kiGruppen`): `kiSetzen(true)` vor der Anfrage, `kiSetzen(false)` vor dem Ergebnis bzw. im Fehlerfall —
  beides über `mutedHistory` und `updateNodeDataOnBoard(kiBoard, …)` (Board der Anfrage). So hat der Wirbel keinen eigenen
  Verlaufsschritt, und der Schritt des Ergebnisses sichert den Stand ohne Wirbel.
- **Anzeigen:** `fremdWirbel` (Effekt auf `ki.an/t/von`, Zeitgeber bis zum Ablauf; Empfangszeit je Karte|Stempel|Sitzung in
  `KI_GESEHEN`, damit ein Neuaufbau der Karte nicht neu zählt). `kiSichtbar = kiLaeuft || fremdWirbel` → Hinweis
  `.bub-ki-hinweis` (`data-taste="bub-ki-hinweis"`, `role="status"`); `wirbelt = kiSichtbar && !liste && !ruhig` → Klasse
  `.bub.wirbelt`. Prüfreihen kürzen die Höchstdauer mit `window.__pnKiWirbelMs`.
- **Physik:** `wirbelAb` (Ref, performance.now beim Start). In `schritt()` ersetzt der Wirbel die Kraft zum Anker:
  Tangential `omega·dist·(1−d)/d` (bei Dämpfung d bleibt genau die Geschwindigkeit eines starren Tellers stehen,
  `WIRBEL_RUNDE_MS`, Anlauf `WIRBEL_ANLAUF_MS`) und ein sanfter Zug zur Mitte; die Kräfte zwischen Gruppen ruhen.
  Überlappungen und Wände gelten weiter. In `bild()` hält der Wirbel `alter` frisch (kein Abklingen) und läuft nur bei
  `imBild`. Ende: Effekt setzt `wirbelAb = null` und weckt — die Felder ziehen die Blasen an ihren neuen Platz.
- **Tropfen-Rand** je Körper `Koerper.rand` (0…1, Zeitkonstante `RAND_TAU`) statt an/aus; Kern und Kuppe einer Gruppe
  wachsen mit dem Mittel ihrer Ränder (`daVon`). `randRest` hält die Rechnung wach, bis alle Ränder stehen (wie
  `namenRest`). Die gezogene Idee löst sich weiter sofort.
- **Gruppen-Kräfte wachsen mit der Gruppe** (`fest(g)` in `schritt()`, Mittel von `k.rand`): Abstoßen der Gruppen, „als
  Ganzes in die Bühne" und „freie Ideen aus den Gruppenfeldern" zählen anteilig. Gemessen (m543 B6): Bekamen über die Bühne
  verstreute Ideen eine neue Gruppe, war der Kreis um sie riesig, und diese Kräfte schleuderten die Blasen im ersten
  Augenblick bis zu 40 Punkte je Bild (vMax ist ein Radius je Schritt) — das gab es auch vor M543 nach jedem KI-Ergebnis.
  Ebenso der Wandabstand für Rand und Namenskuppe (vorher ein Satz von 40 Punkten, sobald eine freie Idee in eine Gruppe
  kam). In Ruhe sind alle Ränder 1 — dort ändert sich nichts. Zusätzlich sind diese drei Kräfte auf eine Tiefe von 50
  (Gruppen, Bühnenrand) bzw. 60 Punkten (freie Ideen) begrenzt: Selbst halb gewachsene Gruppen um verstreute Ideen
  schleuderten sonst noch 28 Punkte je Bild. In Ruhe überlappen Gruppen nie so tief — dort greift die Grenze nicht.
- **Hinweis-Platz und Kreis:** Der Hinweis steht oben links (wo sonst „＋ Gruppe" steht, das während der KI ausgeblendet
  ist); der Kreis liegt etwas unter der Mitte (`unter`), sein Radius höchstens 30 % der kurzen Seite.
- **CSS** (`66-entscheidungs-bubbles.css`, Abschnitt M543): Hinweis aus Tokens (`--surface-card`, `--ink`, `--border-soft`),
  Namen/Ringe im Wirbel ausgeblendet, weicher Farbwechsel; alles Übergänge aus bei `prefers-reduced-motion`.

## Grenzen / offen
- Die Teilnehmer-Seite „Mitmachen per QR" (`mitmachen.html`) zeigt keinen Wirbel (sie zeigt keine Blasen-Bühne).
- Rechnet die KI länger als 60 s, hören die anderen Geräte vorher auf zu kreisen (das eigene kreist weiter); ein
  Herzschlag wäre möglich, schien das zusätzliche Schreiben nicht wert.
- Fällt das rechnende Gerät aus, bleibt `ki.an = true` in der Karte stehen (harmlos: kreist höchstens 60 s nach Empfang,
  nach 10 Minuten gar nicht mehr; der nächste KI-Lauf überschreibt ihn).
- Uhren mit mehr als 10 Minuten Abweichung zwischen den Geräten sehen den fremden Wirbel nicht.
