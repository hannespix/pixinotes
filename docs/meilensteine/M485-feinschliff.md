# M485 — Feinschliff Ziehen und Rechtschreibung
PR: siehe Merge-Titel „… (M485)" · Prüfreihe: `pruefungen/m485-feinschliff.mjs` (Port 5485) · Datum: 2026-11-23

## Warum
Drei offene Punkte aus M481 (Karten ziehen mit Gefühl) und M482 (Rechtschreibprüfung), beides ausdrücklich
gewünscht:
1. Verbindungslinien zeigten während des Zugs auf die ungehobene Lage — an der gegriffenen Karte (gehoben,
   geneigt) um ein paar Punkte daneben, an ausweichenden Nachbarn um die ganze Ausweich-Strecke.
2. Ausweichen war einstufig: Ein Nachbar glitt auf eine dritte Karte und lag dann auf ihr.
3. Codeblöcke und Inline-Code in Notizen bekamen Wellenlinien unter jedes `const`.

## Was
- **Kanten folgen der sichtbaren Karte** — der gehobenen (vergrößert, geneigt) und den ausweichenden Nachbarn,
  Bild für Bild auch mitten in den Übergängen (Ausweichen, Zurückgleiten, Landen). Nichts davon wird gespeichert.
- **Kettenreaktion:** Eine ausweichende Karte nimmt angrenzende Karten mit, höchstens drei Stufen tief, mit
  kleiner werdendem Abstand (12 → 8 → 5 Punkte) und je Stufe 45 ms später — die Welle läuft sichtbar von der
  Karte weg. Dieselben Ausnahmen wie M481 (Rahmen, Rahmen-Inhalt, Archiv, Stapel, mehr als 6 gezogene Karten);
  bei „weniger Bewegung" bleibt es einstufig. Ein Strg+Z nimmt Zug und ganze Kette zurück.
- **Codeblock und Inline-Code ohne Rechtschreibprüfung** (`spellcheck=false`), der übrige Notiztext bleibt geprüft.

## Wie (Architektur)
- **`src/lib/zugAnzeige.ts`** (Start, winzig): je Karte `[dx, dy, Skala, Winkel]` als Anzeige-Versatz,
  `anzeigeSetzen`/`anzeigeMelden` (einmal je Bild), `useAnzeige(id)` über `useSyncExternalStore`. Kein Stand,
  kein Verlauf, kein Live-Kanal.
- **`floatingEdge.ts` `mitAnzeige(node, a)`:** verschiebt den internen Knoten, vergrößert ihn um die Mitte und
  addiert den Winkel (die M400-Drehung rechnet `getFloatingEdgeParams` schon). `LabeledEdge` nimmt ihn für
  Quelle und Ziel.
- **`ziehGefuehl.ts` `kantenBeobachter`** (nachgeladen): liest je Bild aus dem berechneten Stil der Knoten
  `translate`/`scale`/`rotate` — mitten in einem CSS-Übergang ist das der aktuelle Zwischenwert, Kante und Karte
  stimmen so in jedem Bild überein, ohne die Kurven in JS nachzubauen. Nur Karten mit Verbindung
  (`zugStarten(…, verbunden)`, Board.tsx gibt die Endpunkte aller Kanten mit) und nur die gegriffenen plus die in
  diesem Zug je angestoßenen (`ausweichen().beruehrt`); ohne Kanten läuft er gar nicht. Nach dem Loslassen schaut
  er `LANDEN_MS + 400` ms nach, bis alles ruht, und räumt dann ab.
- **Kein doppelter Versatz beim Ablegen:** `versatzAufloesen(el, x, y, id)` nimmt die Anzeige im selben Bild weg,
  in dem `translate` fällt (React Flow hat die Karte dann schon an die neue Lage gesetzt). Bis dahin gilt
  „Stand + Versatz" sowohl für die Karte als auch für die Kante.
- **Kette** in `ausweichen(kandidaten, abstand, stufen)`: Stufe 1 wie M481; jede weitere Stufe prüft die noch
  ruhenden Kandidaten gegen die verschobenen Kästen der vorigen Stufe (`STUFEN_DAEMPFUNG` 0,66 für den Abstand).
  Nie angestoßen wird, was schon vor dem Zug an der Schiebenden lag (Stapel), und nie in die gezogene Karte hinein.
  `--zieh-stufe` am Knoten verzögert den Übergang (`styles/34-praesentation.css`, Abschnitt „Ziehen").
- **Codeblock:** `NoteTypo.tsx` ersetzt im gemeinsamen `noteSchema` die `codeBlock`-Darstellung durch eine, die
  `spellcheck=false` an Block und `code` setzt, und konfiguriert die Tiptap-Mark `code` mit
  `HTMLAttributes: { spellcheck: 'false' }`. Von außen gesetzte Attribute verwürfe ProseMirror beim Neuzeichnen
  (darum ging es in M482 nicht); an der eigenen Block-Ansicht bzw. Mark bleiben sie — auch nach dem Tippen und für
  neu angelegte Codeblöcke (```).
- Start-JS: +960 B (2 239 141 B, Grenze 2 240 000 B) — die Rechnung liegt im nachgeladenen `ziehGefuehl.ts`.

## Messwerte
200 Karten mit 20 Verbindungen: Median 16,7 ms je Bild beim Ziehen über Nachbarn (Prüfreihe L2).

## Grenzen / offen
- Mit sehr vielen Verbindungen (100 auf 200 Karten) ist das Ziehen schon ohne M485 zäh: Jedes Zug-Ereignis
  zeichnet alle Kanten neu (Hindernis-Ausweichen über alle Karten, M132) — gemessen über 100 ms je Mausbewegung
  im Prüf-Chromium. Der Beobachter kommt mit einem zweiten Neuzeichnen der betroffenen Kanten je Bild dazu.
  Kandidat für einen eigenen Meilenstein (Kanten nur bei Bedarf neu routen).
- Hindernis-Ausweichen der Kanten rechnet weiter mit den Lagen im Stand, nicht mit den ausweichenden.
- Exportiertes HTML einer Notiz trägt am Inline-Code jetzt `spellcheck="false"` (harmlos).

## Prüfreihe
`m485-feinschliff`: K Kanten folgen (ruhend, ausgewichen, gehoben, je Bild beim Hin- und Zurückgleiten, beim
Ablegen, gelandet; nichts gespeichert), W Kettenreaktion (drei Stufen, gedämpft, vierte bleibt, keine Überdeckung,
im Stand nach dem Ablegen, ein Strg+Z, einstufig bei „weniger Bewegung"), L 200 Karten mit Verbindungen,
C Codeblock/Inline-Code aus, Fließtext an (auch nach dem Tippen und für neue Codeblöcke), T Texte.
