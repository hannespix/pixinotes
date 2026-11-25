# M518 — Audit: Gesamtlauf aller Prüfreihen („läuft alles?“)
PR: siehe Merge-Commit · Prüfreihen: geändert `m377`–`m504` (Liste unten), Werkzeug `werkzeug/maschinen-last.mjs`,
`werkzeug/alle-pruefungen.mjs` · Datum: 2026-11-25

## Warum
Teil des Bugfixing-Audits M518–M523: die objektive Antwort auf „läuft alles?“. Alle Prüfreihen laufen gegen den
Hauptzweig; jede rote Reihe wird allein wiederholt und eingestuft: (a) Fehler der App, (b) Prüfung veraltet,
(c) wacklig.

## Ergebnis in Zahlen
| Lauf | Stand | Reihen | grün im ersten Lauf | erst allein grün | rot | Prüfpunkte | Dauer |
|---|---|---|---|---|---|---|---|
| 1 (Ausgangslage) | Hauptzweig `8272a97`, sechs Agenten zugleich (Last 10–25 auf vier Kernen) | 239 | 231 | 7 | 1 (`m485` L2, danach allein 3 von 3 grün) | 6 382 gezählt (zwölf Reihen ohne lesbare Schlusszeile fehlen in der Zahl) | 94,5 min bei 2 Bahnen |
| 2 (Schluss) | @@STAND@@ | @@REIHEN@@ | @@ERST@@ | @@ZWEIT@@ | @@ROT@@ | @@PUNKTE@@ | @@DAUER@@ |

Kein Prüfpunkt war wegen eines Fehlers der App rot, der sich allein und ohne Last zeigt; keine Reihe war veraltet
(Einstufung b: keine). Alle Auffälligkeiten waren Reihen, die unter Last anders messen als allein (c) — und eine
davon (`m377`) belegt einen echten Fehler der App, der nur unter Last auftritt (unten, „Für andere Bereiche“).

Daneben geprüft (Schlussstand): `npm run check`, `npm run build`, `npm run build:single`, `npm run build:mcp` ohne
Fehler; einzige Warnung des Builds ist die bekannte Größe des nachgeladenen Mermaid-Pakets (3,6 MB, kein Start-JS).
`werkzeug/ohne-emoji.mjs --pruefen`: 0 Textstellen. `werkzeug/sprache-ernten.mjs --fehlend`: @@SPRACHE@@.
`werkzeug/kontrast-pruefen.mjs dist` hell/dunkel, Text, `--rand`, `--fokus`: keine Stelle unter der Grenze.
Die portable Datei aus `build:single` startet per `file://` ohne Konsolenfehler (@@SINGLE@@).

## Rote und wacklige Reihen
Wiederholt wurde mit `node werkzeug/alle-pruefungen.mjs … --wiederhole N --bahnen 2` neben der Last der anderen
Agenten bzw. neben acht bis zehn rechnenden Prozessen (`node -e "for(;;);"`).

| Reihe · Punkt | vorher unter Last | Einstufung · Ursache | Fix | nachher unter Last |
|---|---|---|---|---|
| `m485` L2 Bildzeit ≤ 18 ms | 2 von 5 grün | c · Zeit-Messung: unter fremder Last 33,3 statt 16,7 ms, die App rechnet nicht langsamer | Maschine mitmessen (`maschinen-last.mjs`), ruhigen Moment abwarten, bis zu drei Messungen; Reihe läuft allein | 9 von 9 |
| `m491` L1/L2 Bildzeit, Maus → Bild | 0 von 5 | c · wie oben (Board ohne Verbindungen hielt 16,7 ms, mit 100 fiel auf 33,3) | wie oben, je Lauf mit Anteil der freien Rechenzeit | 9 von 9 |
| `m500` F2 ≥ 15 Bilder/s | 4 von 5 (im Gesamtlauf rot) | c · wie oben | wie oben (`tempoGrenze`) | 9 von 9 |
| `m500` E2 „in Ruhe kein Takt“ | 4 von 5 | c · die Maus stand nach dem Hinschwenken über der Schrift; kam dort noch eine Bewegung an, hielt der Magnet die Flüssigkeit wach (siehe „Für andere Bereiche“) | `aufKarte` nimmt die Maus von der Karte; E2 verlangt, dass die Ruhe wirklich eintrat | 4 von 4 |
| `m481` I2 Bildzeit ≤ 18 ms | gemeldet (M521/M523), hier nicht nachgestellt | c · dieselbe Messung wie `m485` L2 | wie `m485` | 3 von 3 |
| `m419` B4 Takt beim Zoomen | gemeldet, hier nicht nachgestellt | c · die Fremdlast-Erkennung nahm den Minutenschnitt der Last, der einer Lastspitze nachhinkt | zusätzlich `ruhigeMaschine()`; Reihe läuft allein | 3 von 3 |
| `m504` A3 „ohne Verweilen frei abgelegt“ | 3 von 5 | c · zwischen letztem Mausschritt und Loslassen lagen Abfragen; unter Last wurde daraus ein Stillhalten (> 450 ms), die App stapelte zu Recht | Maus zappelt neben dem Messen weiter (`zappler`, fünf Stellen), die Seite misst die längste Pause selbst; war sie zu lang: Strg+Z und noch einmal (höchstens dreimal) | 6 von 6 |
| `m504` B1 „Markierung nach rund einer halben Sekunde“ | 4 von 5 | c · die Uhr des Prüfprogramms lief erst nach einer Abfrage los (288 statt 450 ms) | Verweildauer in der Seite gemessen (letzte Bewegung → Markierung) | 6 von 6 |
| `m378` B5 Blase auf Blase gezogen | 4 von 5 | c · gezielt wurde auf die Lage der Ziel-Blase vor dem Zug; `ruhen` meldete Ruhe, während nur gerade kein Bild gezeichnet war | `bZiehenAuf`: Lage nachführen, loslassen erst, wenn die Karte das Ziel zeigt | 9 von 9 |
| `m378` C8 Wurf | 1 von 5 rot (nach dem ersten Fix sichtbar) | c · Wurf = Tempo; sechs Schritte mit Pausen wurden unter Last zum Ablegen | der Ort folgt der Uhr (84 Punkte in 130 ms), letzter Schritt und Loslassen zusammen | 4 von 4 |
| `m415` E2 „Idee entsteht am Doppelklick“ | 4 von 5 | c · die Lage wurde „60 ms nach dem Erscheinen“ von außen gelesen – unter Last war die Blase da schon 120 Punkte weitergeschwommen | Beobachter in der Seite hält die Lage beim ersten Zeichnen fest | 9 von 9 |
| `m425` B3/C1/C2 + Abbruch | im Gesamtlauf rot, danach 5 von 5 | c · Rahmen an `frame.url()` erkannt; Playwright meldet für `srcdoc` unter Last zeitweise `""` (Regel aus M484) | Rahmen am Inhalt (`#edit`) erkennen, 30 s Geduld; ebenso `m427` (gleiches Muster, noch nicht aufgefallen) | 9 von 9 |
| `m440` B1 Neigung beim schnellen Zug | im Gesamtlauf rot, danach 5 von 5 | c · 14 Schritte mit je einer Abfrage: unter Last war der „schnelle“ Zug langsam (1,18° statt > 1,2°) | Strecke in festen 300 ms (Ort folgt der Uhr), Neigung schreibt die Seite je Bild mit | 9 von 9 |
| `m389` C4 Schließen-Kreuz 44 Punkte | gemeldet (44 × 43,99999), hier nicht nachgestellt | c · mitten im Öffnen des Fensters gemessen, Vergleich ohne Rundung | warten, bis das Maß steht; auf Hundertstel runden | 3 von 3 |
| `m377` C3/C9 „Gerds Text ist bei allen angekommen“ | 2 von 3 | **a · Fehler der App unter Last** (unten) | nicht behoben (fremder Bereich, kein kleiner Fix) | unverändert |
| `m312`, `m402`, `m505` | von anderen Agenten je einmal rot gemeldet | nicht nachgestellt (vier Läufe auf ruhiger Maschine, drei unter Last: alle grün) | – | 7 von 7 |

### Gegenprobe (wie M517): Die geänderten Prüfpunkte werden weiter rot, wenn das Verhalten fehlt
Zwei absichtlich fehlerhafte Builds (Quellen kopiert, nur dort geändert; die Reihen liefen mit `PN_DIST=…`):
- Blasen entstehen immer am Rand statt am Doppelklick → `m415` E2 rot (Abstand > 600 Punkte).
- Keine Nachfrage beim Ablegen auf eine freie Blase → `m378` B5 rot.
- Neigung je Tempo 1 statt 9 → `m440` B1 rot (0,46°).
- Verweilen schon nach 40 ms → `m504` A1, A2, A3 und B1 rot (Markierung 51 ms nach der letzten Bewegung, B1 „Dauer 11 ms“).
- 40 ms Rechenzeit je Bild beim Ziehen mit Verbindungen → `m491` L1 und L2 rot (66,7 ms gegen 16,7 ms), auch bei
  halber Rechenzeit. `m485` L2 blieb in dieser Gegenprobe grün (Fremdlast, umgerechnete Grenze): Unter starker
  Fremdlast fällt nur ein grober Rückschritt auf – darum laufen diese Reihen jetzt allein, und auf ruhiger Maschine (Nachtlauf)
  gilt die Grenze unverändert.
- 250 ms Rechenzeit je Takt der flüssigen Schrift → `m500` F2 rot (3 Bilder/s gegen Grenze 4 bei 27 % freier Rechenzeit).

## Wie
- `werkzeug/maschinen-last.mjs` (neu): `cpuAnteil()` lässt so viele Fäden rechnen, wie die Maschine Kerne hat
  (höchstens vier), und vergleicht verbrauchte Rechenzeit mit vergangener Zeit (1 = frei); `ruhigeMaschine(ms)`
  wartet begrenzt auf zwei ruhige Proben; `bildGrenze(ms, anteil)` und `tempoGrenze(n, anteil)` lassen die Grenze
  ab `RUHIG` = 0,85 unverändert und rechnen sie sonst auf den Anteil um (Bildzeiten in ganzen Bildern);
  `lastText()` sagt es in der Ausgabe. Aufruf von Hand: `node werkzeug/maschinen-last.mjs`.
- `werkzeug/alle-pruefungen.mjs`: Reihen, die `maschinen-last.mjs` einbinden, bekommen die Sperre `zeitmessung` –
  sie starten nur, wenn keine Bahn belegt ist, und nichts startet neben ihnen (auch nicht die Zeitmessung eines
  anderen Worktrees). Schlusszeile und JSON (`gut`, `schlecht` je Reihe) zählen die Prüfpunkte an den Zeilen ✓/✗.
- Regeln für neue Reihen: `docs/AGENTEN.md`, Abschnitt „Prüfreihen, die unter Last nicht flattern“ (sechs neue Punkte).

## Für andere Bereiche
| Nr. | Schwere | Was der Nutzer merkt | Beleg | Bereich |
|---|---|---|---|---|
| 1 | hoch (Datenverlust, nur unter Last nachgestellt) | In einer gemeinsamen Runde tippt ein Gast in eine Notiz; alle sehen den Text, er ist auf allen Geräten und dem Server gespeichert – Sekunden nachdem er die Notiz verlassen hat, steht überall wieder der alte Text. | `m377` C3/C9: 1 von 3 Läufen neben acht rechnenden Prozessen, 2 von 2 neben zehn. Mitschrift (Sicht, Speicher je Gerät, Server): erst überall „Mehr Fenster und Licht bitte“, danach überall „Mehr Fenster“. Vermutung, nicht belegt: Eine Sitzung des gemeinsamen Tippens mit älterem Y-Dokument „heilt“ den Speicher zurück (`lib/notizGemeinsamKern.ts`, `anbinden`). | M522 (gemeinsames Tippen, Abgleich) |
| 2 | niedrig | Steht die Maus still über einer flüssigen Schrift, rechnet die Karte dauerhaft weiter (60 Takte/s), bis die Maus sie verlässt – der Magnet hält die Teilchen von ihrem Platz, die Ruhe-Bedingung „alles an seinem Platz“ tritt nie ein. | Nachgestellt: an drei von fünf Stellen über der Schrift keine Ruhe binnen 8 s (Takte 214 → 417), nach dem Wegnehmen der Maus Ruhe nach 1,3 s. `lib/fluessig/motor.ts` `schritt()` | M519 (Flüssige Schrift) – Entscheidung, ob das so gewollt ist |
| 3 | niedrig | Folgt auf die letzte Mausbewegung ohne ein Bild Abstand das Loslassen, landet die Karte an der vorletzten Stelle. Mit einer echten Maus nicht zu merken. | `m504` mit `Promise.all([mouse.move, mouse.up])`: Karte 48 Punkte neben dem Zeiger | M521 (Board) – nur zur Kenntnis |

## Grenzen / offen
- `m377` bleibt unter starker Last wacklig, bis Befund 1 behoben ist – die Reihe misst dort richtig.
- Unter starker Fremdlast prüfen `m485` L2, `m481` I2, `m491` L1/L2, `m500` F2 und `m419` B4 mit umgerechneter
  Grenze; die volle Schärfe haben sie auf ruhiger Maschine (allein, Nachtlauf).
- `m312`, `m402`, `m505`: gemeldete Einzelfälle, hier nicht nachgestellt – ohne Ausgabe des roten Laufs keine Ursache.
