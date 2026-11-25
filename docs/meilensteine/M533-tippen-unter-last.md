# M533 — Gemeinsam schreiben: Der neueste Text bleibt (auch unter Last)
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m533-tippen-unter-last.mjs` (Port 5533, `M533_PORT`) · Datum: 2026-11-25

## Warum
Befund 1 aus dem Gesamtlauf M518 (hohe Priorität, Datenverlust): Ein Gast tippt in eine Notiz, der Text steht auf allen
drei Geräten und auf dem Server — Sekunden nach dem Verlassen der Notiz steht überall wieder der alte Text
(`m377` C3/C9, nur unter Last). Nach M524 trat das Muster in `m377` nicht mehr auf, die Ursache war aber nicht belegt.

## Ursache (in Alltagssprache)
Hält jemand eine Karte (schreibt darin, zieht sie), sehen die anderen sie **live mit**: Ihr Gerät zeigt den Stand, den
der Schreiber alle 0,2–0,7 s in den Kanal gibt, merkt sich aber daneben den **gesicherten** Stand der Karte — nur der wird
geschrieben und verglichen (M364/M388). Die letzten Tasten vor dem Verlassen gehen nicht mehr live hinaus (der Schreiber
hält die Karte dann schon nicht mehr), sie kommen erst mit seinem Speichern.

Fasste ein Gerät die Karte in genau dieser Lücke selbst an — ein **Punkt**, Verschieben, Umfärben, auch etwas, das von
selbst nachgezogen wird —, galt bis jetzt **der ganze mitgelesene Stand als eigene Änderung**, einschließlich des Texts,
dem die letzten Zeichen fehlten. Kam danach das Speichern des Schreibers an, sah der Abgleich (feldweise seit M524):
„Text hier geändert, drüben auch“ → die hiesige Fassung gewinnt → der ältere Text ging zum Server und von dort an alle,
auch an den Schreiber selbst. Bei einem **Gast** kam ein zweiter Weg dazu: Sein Schreiben ersetzt eine Karte als Ganzes
(`gast_aendern`), ohne Vorbedingung. War das Speichern des Schreibers schon auf dem Server, bei ihm aber noch unterwegs,
ersetzte sein Punkt den neuen Text durch den, den er noch kannte.

Unter Last (langsame Seiten, verspätete Nachrichten) wird diese Lücke von Bruchteilen einer Sekunde zu Sekunden — deshalb
trat es nur dann auf. In `m377` war es Annas Gerät (Besitzerin, Konto); vor M524 gewann dort sogar die ganze Karte mit dem
Ursprungstext (der verlorene Text hatte im Speicher noch keine Block-Kennungen — es war wörtlich die Karte von vor dem
Tippen). M524 hat diesen Weg verengt (feldweise, Basis sofort), aber nicht geschlossen: Die neue Prüfreihe stellt ihn mit
dem Stand nach M524 in jedem Lauf nach (unten).

```
Gerd (schreibt)               Server                    Hanna (liest mit, langsame Verbindung)
tippt „… und Licht“  ── live ─────────────────────────► zeigt „… und Licht“ (gesichert: „Mehr Fenster“)
tippt „ ENDE“, geht            (live geht nichts mehr)   sieht die Karte frei, gibt ihr einen Punkt
speichert ──────────────────► „… und Licht ENDE“
                                                          vorher: „… und Licht“ + Punkt gilt als EIGEN
                              „… und Licht“ ◄──────────── schreibt die ganze Karte
übernimmt „… und Licht“ ◄──── (an alle)                  ENDE ist überall weg
```

## Was
- Was man bei anderen nur mitliest, bleibt Anzeige. Wer eine Karte gleich nach dem Schreiben eines anderen anfasst,
  ändert nur das, was er selbst tut (Punkt, Lage, Farbe) — der Text bleibt der des Schreibers.
- Bevor ein Gast eine Karte schreibt, die eben noch ein anderer in der Hand hatte, holt sein Gerät erst dessen neuesten
  Stand.
- Beim gemeinsamen Tippen (Yjs) kommen die letzten Zeichen beim Speichernden auch dann an, wenn ihre Nachricht im
  Kanal verloren ging: Wer das Feld verlässt, fragt einmal nach.
- Sichtbar ist nur der Eintrag unter „Was ist neu“ (DE/EN); keine neue Bedienung.

## Wie (Architektur)
- `lib/gastSync.ts`, Zuhörer am Store (Block „Eine mitgeschriebene Karte wurde hier anders ersetzt“): Ändert sich eine
  mitgelesene Karte **nicht** durch einen Abgleich (`!isImportedState`), wird die Änderung `live → jetzt` mit
  `aufGesichertem(orig, live, jetzt)` auf den gesicherten Stand übertragen (Felder der Karte und eine Ebene tiefer die
  Felder von `data`; Auswahl/Maße vom Gerät) und als neuer gesicherter Stand gemerkt (`originale`); `liveStaende` zeigt
  weiter die Anzeige mit der eigenen Änderung. Schreiben und Abgleich nehmen über `liveHaken.vor` den gesicherten Stand;
  kommt das Speichern des Schreibers an, ersetzt `liveHaken.nach` die Anzeige wie bisher. Bisher wurde das Mitlesen in
  diesem Fall vergessen — die Anzeige wurde zum eigenen Stand. Abgleiche vergessen es weiter (der neue gesicherte Stand
  ist da).
- `lib/gastSync.ts → hinaus`: Enthält der Schritt eine Karte, die gerade ein anderer hält, die hier mitgelesen wird oder
  die ein anderer vor höchstens `FREMD_FRISCH_MS` (30 s) losgelassen hat (`fremdFrisch`, `fremdLos` aus `sperrenRechnen`),
  sieht `vorSchreibenNachsehen` erst nach (`gast_stand`): Ist der Server weiter als `bekannteVersion` (eingearbeitet oder
  selbst geschrieben), wird erst eingearbeitet — was schon über den Kanal kam (`kettenLauf`), sonst der ganze Stand
  (`holen(boardId, true)`: ohne Tipp-Bremse, ohne eigenes Schreiben am Ende) — und der Schritt neu berechnet. Andere
  Karten schreiben ohne den zusätzlichen Blick (keine Mehrlast in großen Gruppen).
- Konto-Geräte (Besitzer, Gast mit Konto) hatten den Blick vor dem Schreiben schon (M524, `kontoWriteRoh`); für sie
  genügt die erste Änderung. Ordner/WebDAV kennen kein Mitlesen.
- `lib/notizGemeinsamKern.ts` (Yjs-Weg, Notiz/Protokoll/Ticket): Dort speichert nur der Schreiber der Sitzung. Ging die
  letzte Yjs-Nachricht eines anderen im Kanal verloren (Realtime-Broadcast ist nicht zugesichert), fragte niemand nach —
  Yjs meldet eine Lücke erst, wenn danach noch etwas vom selben Gerät kommt; die letzten Zeichen lagen nur in dessen
  Y-Dokument. Jetzt: Verlässt ein Gerät, das hier getippt hat und nicht Schreiber ist, das Feld (sein Cursor in der
  Anwesenheit wird leer, `verlassenPruefen`), schickt es nach 400 ms ein `hallo`; die anderen antworten mit `stand`
  samt Stand-Vektor, und was nur es selbst hat, geht noch einmal hinaus (Weg aus M477). Kosten: eine Nachfrage je
  Verlassen, nur bei eigenen Änderungen.
- Prüfreihe `m377`: `inKarte` wartet auf den Cursor statt fester Pausen (der rote C1-Lauf aus M518: Unter Last kam der
  Editor nach dem abgelehnten Yjs-Teil erst nach Sekunden, Gerds erste Tasten gingen ins Leere — kein Fehler der App,
  das Programm setzt den Cursor wie vorgesehen); `PN_DROSSEL` drosselt die Seiten zum Nachstellen.

## Prüfreihe
`pruefungen/m533-tippen-unter-last.mjs` (Gerüst aus m364–m377, Yjs-Teil abgeschaltet wie in `m377`). Steuerung in der
Attrappe: `steuerung.verzug` (je Gerät alle Nachrichten über seine Verbindung später — Live-Kanal und Realtime,
Reihenfolge bleibt), `steuerung.zufall` (zusätzlich 0–n ms), `steuerung.verwerfen` (Live-Nachrichten eines Absenders
gehen verloren), `M533_DROSSEL` (CPU-Drosselung aller Seiten, CDP), `M533_RUNDEN`, `M533_SAAT`, `M533_LAUT` (jedes
Schreiben auf dem Server mit Text).
- A Gast: Gerd schreibt, Hanna (langsam) punktet sofort nach dem Loslassen → Gerds Text bleibt überall, ihr Punkt auch.
- B Besitzerin (Konto): dasselbe, Anna punktet.
- C Dauerlauf: drei Geräte schreiben abwechselnd, ein zufälliges anderes punktet sofort, zufällige Verzögerungen und
  verlorene Live-Nachrichten → am Ende überall und auf dem Server der neueste Text, Punkte überall wie auf dem Server.
- D Gemeinsam tippen (Yjs, zwei weitere Gäste mit geladenem Yjs-Teil): Wer nicht speichert, tippt; seine letzte
  Yjs-Nachricht geht verloren (`steuerung.verwerfen` „Gerät:notiz-y:upd“) → seine letzten Wörter kommen trotzdem auf den
  Server und zu allen fünf.
- Gegen den Stand davor (`PN_DIST=<alter Build>`): A3/A4, B3/B4, C1/C2, D2/D3 rot (in jedem Lauf); jetzt grün.

## Grenzen / offen
- Es bleibt das Fenster **einer Anfrage**: Speichert der Schreiber genau zwischen dem Blick eines Gasts und dessen
  Schreiben, ersetzt der Gast die Karte noch als Ganzes (wie bei M524 für das Konto). Schließen ließe es sich nur auf dem
  Server — `gast_aendern` mit einer Vorbedingung je Karte oder einem Patch je Feld (Migration, Freigabe des Besitzers).
- Beginnt jemand selbst im **Text** einer Karte zu schreiben, die er eben noch mitgelesen hat, baut sein Text auf dem
  Gezeigten auf (er sieht nichts anderes). Kommt das Speichern des anderen danach, gilt wie bisher bei „beide haben
  denselben Text geändert“ die hiesige Fassung. Mit dem Yjs-Teil (Normalfall für Notizen, Protokolle, Tickets) gibt es
  dieses Mitlesen nicht — dort wird zeichengenau zusammengeführt.
- Yjs-Weg: Verlässt jemand die Notiz, ohne Schreiber zu sein, wird **einmal** nachgefragt; schließt er sie dagegen
  ganz (Board gewechselt, Fenster zu), bevor die Antwort da ist, bleibt eine verlorene letzte Nachricht verloren.
- Der Gesamtlauf-Fehler selbst (Stand vor M524, Gerüst m377) ließ sich mit künstlicher Last (CDP-Drosselung, verzögerte
  Nachrichten) in 16 Durchgängen nicht wieder auslösen; die Erklärung oben stützt sich auf die Mitschrift aus M518
  (Text ohne Block-Kennungen = Karte von vor dem Tippen, Punkte 2) und auf den nachgestellten Weg in A/B.
