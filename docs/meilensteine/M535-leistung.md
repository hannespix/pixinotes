# M535 — Leistung: leichter Start, ruhende Flüssigkeit, Bilder und Tools halten an, Diagramme abseits
PR: siehe Merge-Titel „… (M535)" · Prüfreihe: `pruefungen/m535-leistung.mjs` (Port 5535) · Datum: 2026-11-25

## Warum
Umsetzungsrunde nach dem Audit M518–M527, Paket „Leistung". Auslöser: die offenen Punkte aus M525 („Grenzen / offen")
und M518 („Für andere Bereiche") sowie die Entscheidungen des Besitzers vom 25.11.2026. Dazu kam vorab: Nach M527 hatte
das Start-JS nur noch rund 126 B Luft bis zur Grenze der Start-Reihen (m446 2 070 000 B, m459/m467/m483/m502
2 065 000 B), und mehrere Agenten mussten noch mergen.

## Punkt 0: Start-Paket entlastet (eigener PR, zuerst)
Gemessen mit einem Build samt Sourcemaps (Bytes je Quell-Modul im Start-Teil `index-*.js`) und der Liste der beim Start
geladenen Dateien (wie m502 A). Zwei Module lagen fast ganz unnötig im Start, weil ein kleiner Teil von ihnen beim Start
gebraucht wird und Rollup ein Modul nie zerteilt:

| Modul | im Start | beim Start gebraucht | gebraucht von (alle nachgeladen) |
|---|---|---|---|
| `lib/serialize.ts` | 28,0 KB | `nodeToText`, `blocksToText`, `nodesToText` (Suche, Karten, KI-Kontext) | HTML/Markdown/WhatsApp: Präsentation, Teilen-Dialog, Teilen-Karten, Export |
| `lib/htmlStore.ts` | 15,8 KB | Ablage in IndexedDB (Aufräumen beim Start, Abgleich) | Speicher-Shim der Tools: nur die Tool-Karte |

Die beiden selten gebrauchten Teile stehen jetzt in eigenen Dateien: `lib/serializeFormate.ts` (`blocksToHtml`,
`blocksToMarkdown`, `nodeToHtml`, `nodeToMarkdown`, `blocksToWhatsapp`, `nodeToWhatsapp`, `nodesToWhatsapp`,
`nodesToHtml`, `sicherKuerzen`) und `lib/htmlShim.ts` (`storageShim`, `composeSrcdoc`). `serialize.ts` exportiert
dafür seine Helfer (`AnyBlock`, `inlineText`, `esc`, `sheetZeilen`, `kontaktZeilen`).

| | vorher | nachher |
|---|---|---|
| Start-JS (5 Dateien, wie m502 A) | 2 064 874 B | 2 028 073 B |
| davon `index-*.js` (eigener Code) | 714 564 B | 677 763 B |
| Luft bis zur Grenze 2 065 000 B | 126 B | 36 927 B |

Kein Verhalten ändert sich: Präsentation und Teilen-Dialog werden schon im Leerlauf nach dem Start vorgeladen (App.tsx
`LADER`), die Tool-Karte mit `kartenVorladen()` — die neuen Teile reisen mit ihnen und liegen damit auch offline im
Service Worker. Die portable Datei bekommt ohnehin alles.

**Regel für später:** Ein Modul, das beim Start gebraucht wird, nimmt alles mit, was in ihm steht. Große, selten
gebrauchte Teile (Ausgabeformate, Rahmen-Quelltexte, lange Tabellen) in eine eigene Datei legen, die nur von
nachgeladenen Teilen eingebunden wird. Messen: `npx vite build --sourcemap --outDir <scratch>` und die Bytes je
`source` der Sourcemap des `index-*.js` zählen.

## Punkte 1–5 (zweiter PR)
Gemessen wie in M525: alter Build (Hauptzweig ohne diese Änderungen) und neuer Build im Wechsel auf derselben, voll
belegten Maschine (vier Kerne, mehrere Agenten, Grafik in Software). Verlässlich sind die Zähler; Millisekunden gelten nur
im Vergleich alt/neu. Werkzeuge im Scratch-Ordner (Board mit acht animierten SVG-Bildern, einer lebendigen Schrift und
einer Notiz; Board mit neun Diagrammen und 240 Notizen; CDP-Zähler `Performance.getMetrics`).

### 1. Flüssige Schrift ruht, wenn die Maus still über ihr steht
Was der Nutzer merkt: Steht die Maus gut zwei Sekunden still über der Karte, hält die Flüssigkeit an (kein Rechnen, kein
Zeichnen, das Bild bleibt stehen); die nächste Bewegung lässt sie sofort weiterfließen. Die Pause beim Ziehen aus M525
bleibt. Einschwingen, Platzen und ein fallender Tropfen laufen erst zu Ende, damit nichts mitten in der Bewegung erstarrt.
Gilt für die Maus, nicht für Finger und Stift.

**Nebenbefund aus M525 – war ein Fehler, behoben:** Nach dem Neu-Abtasten ohne Übergang (`abtasten(false)`: Größe der
Karte geändert, Web-Schrift nachgeladen) setzte der Motor `ruht = true` – auch bei „lebendig". Die Schrift stand dann,
bis jemand sie berührte. Jetzt weckt `abtasten` eine lebendige Fläche gleich wieder (`aufwecken`).

Wie: `lib/fluessig/motor.ts` — `ANHALTEN_MS` (2000), Feld `mausDrueber` (gesetzt in `bewegen` nur für
`pointerType === 'mouse'`, gelöscht bei `pointerleave`), `angehalten(t)` (Maus darüber, nicht gedrückt, letzte Bewegung
älter als `ANHALTEN_MS`, kein Einschwingen/Platzen/Tropfen) geht in `willLaufen()` ein. Damit setzt der gemeinsame Takt
aus, sobald keine Fläche mehr laufen will; `bewegen` → `aufwecken` → `wecken` startet ihn wieder. `zustand()` meldet
`angehalten` (Prüfreihe).

### 2. Animierte SVG-Bilder: Standbild beim Ziehen und außerhalb des Bildes
Was der Nutzer merkt: Eine Bild-Karte mit animiertem SVG (CSS-Keyframes oder SMIL) steht still, solange irgendeine Karte
gezogen wird, und außerhalb des sichtbaren Bereichs; sonst läuft sie wie bisher. Das Standbild ist dieselbe Zeichnung auf
ihrem ersten Bild (gleiche Maße, kein Flackern beim Wechsel). Nach dem Ablegen bzw. beim Hereinschwenken beginnt die
Animation von vorn. Nicht animierte Bilder werden nicht angefasst (keine Beobachter, kein Abo).

Wie: `lib/bildStandbild.ts` — `svgText(src)` liest SVG-Daten-Adressen (Base64 oder Prozent-kodiert), `standbildVon(src)`
erkennt Animationen (`@keyframes`, `animation:`, SMIL-Elemente), setzt per `DOMParser` ein
`<style>*{animation-play-state:paused!important;transition:none!important}</style>` an den Anfang und
`begin="indefinite"` an jede SMIL-Animation (gemerkt je Adresse, höchstens 64). `useBildAnzeige(ref, src)` liefert die
anzuzeigende Adresse: Standbild, solange `zugLaeuft()` (neu: `zugBeobachten` in `lib/zugAnzeige.ts`) oder das Bild
außerhalb des Fensters (+120 px) liegt (`IntersectionObserver`); das Standbild wird vorab entschlüsselt. Eingebaut in
`ImageCard` (eine Zeile: `src={anzeige}`). Gewechselt wird nur das `src`-Attribut – nichts wird mitten im Zug ein- oder
ausgehängt (M491).

Grenzen: Nur SVG als Daten-Adresse (so liegen Bilder im Stand, auch nach M532). Animierte GIF/WebP und SVG über eine
fremde Adresse bleiben wie bisher. Ob Chrome Animationen außerhalb des Bildes ohnehin drosselt, ließ sich ohne
Grafikkarte nicht messen – das Standbild gilt dort unabhängig davon.

### 3. Eigene Tools halten an
Was der Nutzer merkt: Ein gestartetes Tool hält von selbst an, wenn es etwa 30 s außerhalb des Bildes war; die Karte
sagt dann „Angehalten, weil das Tool eine Weile außerhalb des Bildes war – mit Start geht es weiter. Was es gespeichert
hat, bleibt." Gestartet wird wieder per Klick, mit dem Stand, den das Tool selbst gespeichert hat (Speicher-Shim, M158).
Nicht angehalten wird, was ich vorführe, was ich als Folgender vom Vorführenden bekomme, und ein Tool im Vollbild.
„Alle Tools anhalten" steht im Kontextmenü der freien Fläche (sobald eines läuft) und im ⋯ eines laufenden Tools (sobald
mehr als eines läuft).

Wie: `lib/toolsLaufen.ts` (klein, Start-Paket): `toolLaeuft(id, an)`, `laufendeTools()`, `alleToolsAnhalten()` (Ereignis
`TOOLS_ANHALTEN`), `ausserSichtMs()` (30 000; Prüfreihen setzen `window.__pnToolAnhaltenMs`). `HtmlAppCard`: meldet sich
an/ab, hört auf das Ereignis (wie „Anhalten"-Knopf, `stopSelbst`), beobachtet `wrapRef` mit einem `IntersectionObserver`
und hält nach `ausserSichtMs()` an (`angehaltenWeil` → Text im Poster). `Kontextmenue.tsx`: Eintrag `data-taste="tools-anhalten"`.
Den Abgleich der Tool-Speicherstände (M529) fasst das nicht an.

### 4. Diagramme abseits des Board-Dokuments
Was der Nutzer merkt: Boards mit vielen Diagrammen öffnen deutlich schneller; die Diagramme sehen aus wie bisher,
Bearbeiten im Diagramm (Klick auf Schritt/Pfeil, Doppelklick) ist unverändert.

Ursache (M525, Grenzen): mermaid hängt beim Zeichnen sein Arbeits-Element und Mess-SVGs an `document.body` und misst
Schritt für Schritt; jedes Einhängen macht über die `:has()`-Regeln den Stil des ganzen Board-Dokuments ungültig.

Wie: `lib/mermaid.ts` `mermaidZeichnen(renderId, source)` zeichnet in einem unsichtbaren Rahmen gleicher Herkunft
(`iframe[data-mermaid-werkstatt]`, einmal je Sitzung an `body` gehängt, außerhalb des Bildes, `visibility:hidden`,
`aria-hidden`, ohne Tab-Halt, `contain:strict`). Darin läuft eine eigene mermaid-Instanz (derselbe Rohtext wie bisher,
`?raw`). Damit dort gleich gemessen wird wie im Board, übernimmt `bedingungenAbgleichen` die Stylesheets des Dokuments
(als Text, `url(…)` relativ zum Stylesheet absolut gemacht), die Merkmale von `<html>` und `<body>` und die Fenstergröße;
`schriftenLaden` lädt alle Schriften, die das Board geladen hat, auch im Rahmen (die Handschrift Kalam eingeschlossen).
Reste eines Versuchs räumt `rahmenReste` im Rahmen weg. Geht der Rahmen nicht, zeichnet mermaid wie bisher im
Dokument. Genutzt von `MermaidCard` und der Diagramm-Folie im `Presenter`; `getMermaid()` bleibt für KI/`parse`.

Vergleich der SVG-Texte (gleiche Kennung, alter gegen neuen Build, neun Diagrammarten auf einem Board): Flussdiagramm
(2×), Sequenz, Mindmap, Kreis, Status, Zeitstrahl gleichen sich Zeichen für Zeichen; Gantt unterscheidet sich nur in der
„Heute"-Linie (Uhrzeit des Laufs), das Klassendiagramm zeichnet seine Linien mit Zufall (auch im alten Build bei jedem
Lauf anders), Maße gleich. Dabei gefunden: Zeichnen mehrere Diagramme zugleich, müssen alle auf dieselben Schriften warten
(`r.laden`) – mermaid merkt sich gemessene Textgrößen, eine einmal mit Ersatzschrift gemessene Sequenz war sonst 4 Punkte
höher.

### 5. Loslassen ohne letzte Bewegung
Was der Nutzer merkt: Eine Karte, die man im Schwung loslässt, liegt genau am Zeiger (vorher lag sie an der Stelle der
vorletzten Mausbewegung; mit einer echten Maus selten, in der Prüfreihe 228 Punkte daneben).

Ursache: React Flow (`XYDrag` in `@xyflow/system`) setzt die Lage nur bei Mausbewegungen; das Loslassen übernimmt die Lage
der letzten Bewegung. Kommt das Loslassen an einer anderen Stelle an, fehlt dieser Schritt.

Wie: `lib/ablegenGenau.ts` `ablegenGenauAn()` (vom Board einmal angemeldet): merkt sich die letzte Mausbewegung/den Druck
(Einfang-Phase am Fenster) und schickt beim Loslassen während eines Zugs an einer anderen Stelle vorher eine
`mousemove` an genau diese Stelle – sie läuft durch denselben Weg wie jede Bewegung (Fanglinien, Raster, Ausweichen,
Kanten, Rückgängig-Schritt), danach erst das Loslassen. Der Hörer ist vor dem von React Flow (d3-drag meldet sich erst
beim Druck an) und sieht das Loslassen zuerst.

## Vorher / nachher
| Messung | vorher | nachher |
|---|---|---|
| Start-JS (wie m502 A) | 2 064 874 B | 2 028 076 B nach Punkt 0, 2 031 207 B mit Punkt 1–5 |
| Lebendige Schrift, Maus 5 s still über der Karte: Rechenschritte (3 Runden) | 253 / 282 / 249 | 78 / 56 / 65 (davon gut 2 s bis zum Anhalten, danach 0) |
| … JS-Zeit in diesen 5 s | 3,9 s | 1,2–1,4 s |
| Board mit 8 animierten SVG-Bildern, Notiz ziehen (40 Bewegungen): Haupt-Thread-Aufgaben | 1,16 / 1,44 / 1,19 s | 0,99 / 1,05 / 0,84 s |
| Board mit 9 Diagrammen + 240 Notizen öffnen: bis alle Diagramme stehen | 8,1 s | 1,3–1,9 s |
| … Zeit in Stil-Rechnungen (`RecalcStyleDuration`) | 7,5 s | 0,15–0,54 s |
| … ins Board-Dokument eingehängte Elemente durch mermaid | 18 (Arbeits-Elemente und Mess-SVGs) | 1 (der Rahmen, einmal) |
| Loslassen ohne letzte Bewegung: Abstand Karte–Zeiger | 228 Punkte | 0–3 Punkte |
| Tool außerhalb des Bildes | läuft weiter | hält nach 30 s an |

## Prüfreihe m535 (Port 5535)
A Flüssige Schrift (anhalten nach 2 s Stillstand, Bild steht, weiterfließen bei Bewegung, „lebendig" nach Neu-Abtasten),
B animiertes SVG (Pixel: bewegt in Ruhe, steht im Zug, nicht leer, nicht animiertes Bild unberührt, wieder bewegt nach
dem Ablegen, Standbild außerhalb, läuft beim Hereinschwenken), C Tools (anhalten außerhalb, Hinweis, Start per Klick mit
gespeichertem Stand, Tool im Bild läuft weiter, „Alle Tools anhalten" im Kontextmenü und im ⋯), D Diagramme (nichts im
Board-Dokument außer dem Rahmen, Rahmen unsichtbar und nicht erreichbar, Beschriftungen passen, Bearbeiten wie bisher),
E Ablegen (am Zeiger, gewöhnlicher Zug unverändert, ein Rückgängig-Schritt). Gegen den Build von vorher rot: A3, A7,
B2, B6, C3, C5, D2, D3, E1.

## Grenzen / offen
- Die Flüssigkeit hält nur bei Maus-Stillstand über der Karte an; „lebendig" ohne Maus darüber lebt weiter (so gewollt).
- Tools halten nicht an, solange sie vorgeführt werden, im Vollbild laufen oder ich einem Vorführenden folge.
