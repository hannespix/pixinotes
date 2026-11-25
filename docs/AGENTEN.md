# Mehrere Agenten parallel — Arbeitsweise

Ziel: maximale Entwicklungsgeschwindigkeit bei wenig Tokens. Ein
**Orchestrator** (Haupt-Agent) schneidet Aufgaben, vergibt Meilenstein-Nummern
und startet je Aufgabe einen **Arbeits-Agenten** in einem eigenen Git-Worktree.
Jeder Arbeits-Agent liefert selbstständig bis zum Merge.

## Rollen
| Rolle | Tut | Tut nicht |
|---|---|---|
| Orchestrator | Backlog lesen (`docs/BACKLOG.md`, Nutzerwunsch), Aufgaben mit **wenig Datei-Überschneidung** schneiden, Nummern vergeben, Agenten starten, Ergebnisse prüfen, Backlog/Doku nachführen | selbst Feature-Code schreiben, Dateien der Agenten lesen |
| Arbeits-Agent | eine Aufgabe von Code bis Merge (siehe CLAUDE.md §5) | fremde Branches anfassen, `release/pixinotes.html` committen, Etappen-Tabelle in UMBAU.md erweitern |

## Regeln gegen Konflikte
1. **Eine Nummer, ein Branch, ein PR, eine Datei in `docs/meilensteine/`.**
2. **Ports:** Die Prüfreihe von Meilenstein N lauscht auf **5000 + N**
   (M444 → 5444; zwei Server → 5444 und 6444). Alte Reihen nutzen 4431–4776.
   **Alte Reihen immer über `node werkzeug/alle-pruefungen.mjs …` starten**, nie
   direkt mit `node pruefungen/…`: der Läufer sperrt Ports über alle Worktrees
   (`$TMPDIR/pixinotes-pruef-sperren/`, PID des Halters, tote Halter werden
   übernommen) – parallele Agenten warten aufeinander statt an EADDRINUSE zu
   scheitern.
3. **CSS:** das Stylesheet liegt in Teildateien `src/styles/NN-bereich.css`
   (M475); `src/index.css` bindet sie nur per @import ein (nie Regeln dort).
   Neue Regeln in die Datei ihres Bereichs, dort an den thematisch passenden
   Abschnitt — nicht ans Dateiende. Die drei Listen „Bedienung nur im Fokus"
   stehen in `99-bedienung-im-fokus.css`, die zuletzt eingebunden wird.
   Braucht ein Bereich viel Neues, lieber eine neue Teildatei mit freier
   Nummer zwischen den Nachbarn (plus @import an der passenden Stelle).
4. **Gebaute Dateien** (`release/pixinotes.html`, `dist/`) nie committen —
   `release.yml` erledigt das nach dem Merge.
5. **Vor dem Merge** den Hauptzweig einmischen, bauen, die eigene Reihe noch
   einmal laufen lassen. Bei Konflikt in Hilfe-/Sprachdateien: beide Seiten
   behalten.
6. Merge-Methode: **Squash**, Titel `Betreff (MNNN) (#PR)`.
7. **Erst mergen, wenn „PR prüfen“ für den Head-Commit grün ist**
   (`mcp__github__actions_list`, `resource_id: pruefen.yml`, ~1 min). In
   Runde 1 mergten zwei Agenten, bevor der Lauf überhaupt startete.
8. **Vor jedem PR** `node werkzeug/alle-pruefungen.mjs --geaendert` laufen lassen – das
   nimmt die betroffenen Reihen und immer die Wächter-Reihen (Kacheln, Tooltips,
   Hilfe, „Was ist neu", Englisch, ohne Emoji) mit, die neue Meilensteine sonst brechen.
9. **Farben und Dunkelmodus:** Wer Farben, Flächen oder Menüs anfasst, misst mit
   `werkzeug/kontrast-pruefen.mjs` (M492) — von Hand `node werkzeug/kontrast-pruefen.mjs dist --dunkel`
   oder in einer Reihe `kontrastScan(page, sel)`: meldet jede sichtbare Schrift unter 4,5:1 zu ihrem
   tatsächlich gezeichneten Hintergrund. Farben nur über Tokens (`src/styles/00-tokens.css`).
   Bedienelemente (M494): `randScan(page, sel)` misst Ränder von Feldern und Kästchen, `fokusScan(page, sel)`
   die Fokusringe (je ≥ 3:1, WCAG 1.4.11; von Hand `--rand` / `--fokus`). Feldränder nehmen `--feld-rand`,
   Schrift auf einer frei gewählten Farbe kommt aus `lib/lesbareSchrift.ts` (nie fest Weiß).

## Prüfreihen, die unter Last nicht flattern (M484)
Mehrere Agenten lassen Reihen gleichzeitig laufen; dann bekommt jeder Browser nur einen Bruchteil der CPU. Was
allein grün und unter Last rot ist, ist fast immer eine dieser Ursachen:
- **Nie `waitForTimeout(n)` und danach prüfen, ob etwas eingetreten ist.** Auf den Zustand warten
  (`waitForSelector`, `warteBis(P, fn, ms)`, `waitForFunction`); feste Pausen nur dort, wo bewiesen werden soll,
  dass etwas **nicht** passiert — und dann erst nach dem positiven Zustand (erst „Präsentation offen", dann 2,5 s
  „bei Anna bleibt sie zu").
- **Marken für „seitdem wurde nichts geschrieben" erst setzen, wenn der vorige Schritt beim Server angekommen ist**
  (z. B. `serverRuhig()` in m383: so lange warten, bis der nachgebaute Server einige Sekunden nichts mehr bekommt).
  Sonst zählt ein verspäteter Schreibvorgang des vorigen Schritts für den nächsten.
- **Zeitgrenzen großzügig, wo nur gewartet wird** (Nachladen, Rahmen, Kanal: 15–30 s); eng nur dort, wo die Zeit
  selbst geprüft wird.
- **Testaufbau nicht gegen die App rennen lassen:** Wer `localStorage` von außen umschreibt und neu lädt, prüft
  danach, ob der Eingriff den Neustart überlebt hat (m428 `pfeilUndNeuLaden`) — die App kann ihren Stand dazwischen
  noch einmal schreiben.
- **Rahmen (iframes) nicht an `frame.url()` erkennen:** unter Last meldet Playwright für `srcdoc`-Rahmen zeitweise
  `""`. Am Inhalt erkennen (`#edit`, eine bekannte Kennung) und alle Rahmen durchgehen, nicht nur den ersten.
- **Nachweis:** `node werkzeug/alle-pruefungen.mjs m383 m428 --wiederhole 10 --bahnen 6` lässt die Auswahl zehnmal
  nebeneinander laufen (ohne Einzelwiederholung) und meldet je Reihe „x von 10 grün"; `--ablage <ordner>` hebt die volle
  Ausgabe jedes roten Laufs auf. Zusätzliche CPU-Last für den Nachweis: ein paar `node -e "for(;;);"`-Prozesse daneben.
- **Gespeicherten Stand erst lesen, wenn er steht:** Der Speicher schreibt `pixinotes-board` verzögert. Wer nach einer
  Aktion `localStorage` liest, wartet auf die erwartete Änderung oder darauf, dass der Stand eine Weile gleich bleibt.
- **Tippen, das ein Rückgängig-Schritt sein soll, in einem Zug** (`keyboard.insertText`): einzeln getippte Tasten
  fasst der Editor nur binnen kurzer Zeit zusammen, unter Last zerfällt die Eingabe in mehrere Schritte.
- **Kurze Hinweise (Toasts) mitschreiben statt hinterher abfragen** (MutationObserver vor der Aktion, wie m332/m477).

Aus dem Gesamtlauf M518 (Last 10–25 auf vier Kernen, `docs/meilensteine/M518-audit-gesamtlauf.md`):
- **Flüchtiges misst die Seite selbst.** Wo etwas „im ersten Augenblick" gelten soll (Lage beim Entstehen, Neigung
  im Zug, Dauer bis zu einer Markierung), vor der Aktion einen Beobachter in die Seite setzen und hinterher sein
  Ergebnis lesen (m415 E2, m440 B1, m504 B1) – eine Abfrage „60 ms danach" kommt unter Last Sekunden später.
- **Gesten, bei denen das Tempo zählt** (Wurf, schneller Zug, „ohne stillzuhalten"): Der Ort folgt der Uhr
  (`anteil = (Date.now() - ab) / dauer`), nicht der Zahl der Schritte – sonst wird der schnelle Zug unter Last
  langsam (m440, m378 C8). Beim Wurf den letzten Schritt und das Loslassen zusammen abschicken
  (`Promise.all([mouse.move(…), mouse.up()])`), damit dazwischen keine Pause entsteht – nicht dort, wo die Lage
  beim Ablegen geprüft wird (die Fläche übernimmt sonst die vorletzte Lage, m504).
- **Wer „nicht stillhalten" prüft, bewegt die Maus neben dem Messen weiter** (m504 `zappler`) und über mehr als
  zwei Stellen: Der Browser fasst Mausbewegungen je Bild zusammen, bei zwei Stellen sieht die App unter Last
  zufällig immer dieselbe. Ob die Voraussetzung galt, in der Seite mitmessen (längste Pause) und sonst wiederholen.
- **Bewegliche Ziele nachführen:** Vor dem Loslassen die Lage des Ziels neu lesen und warten, bis die App es als
  Ziel zeigt (m378 `bZiehenAuf`) – „ruht" von außen heißt unter Last oft nur „gerade kein Bild gezeichnet".
- **Die Maus dort wegnehmen, wo sie nichts zu suchen hat:** Ein Zeiger, der nach dem Hinschwenken über einer Karte
  stehen bleibt, kann sie wach halten (m500: Magnet der flüssigen Schrift).
- **Zeit-Messungen (Bildzeit, Bilder je Sekunde) messen die Maschine mit:** `werkzeug/maschinen-last.mjs`
  (`ruhigeMaschine()`, `cpuAnteil()`, `bildGrenze()`, `tempoGrenze()`). Auf ruhiger Maschine gilt die Grenze
  unverändert; nur bei nachweislich fremder Last wird sie umgerechnet (und das steht in der Ausgabe). Reihen, die
  das Werkzeug einbinden, lässt `alle-pruefungen.mjs` allein laufen (Sperre „zeitmessung", meist am Ende).

## Brief für einen Arbeits-Agenten (Vorlage)
```
Repo /home/user/pixinotes (Worktree). Lies CLAUDE.md und docs/AGENTEN.md.
Meilenstein: M<N> — <Thema>. Branch: claude/m<N>-<kurz>.
Ziel: <was der Nutzer merkt>. Bereits ausgeschlossen: <…>.
Fertig heißt: Build grün, Prüfreihe pruefungen/m<N>-<kurz>.mjs (Port 5<N>)
grün, betroffene alte Reihen grün, docs/meilensteine/M<N>-<kurz>.md,
PR auf claude/notes-whiteboard-design-bnwvxj, selbst gemergt (squash).
Rückmeldung: 5 Zeilen — PR-Link, was geändert, was offen.
```

## Nachtlauf
Jede Nacht (02:17 UTC) fährt `.github/workflows/nachtlauf.yml` die **volle**
Prüfreihe gegen den Hauptzweig (M468) – auf dem Runner ohne die drei
Datenbank-Reihen (`--ohne-datenbank`). Ist etwas rot, steht es in **einem**
offenen Issue „Nachtlauf rot" (Label `nachtlauf`) mit der Liste der roten
Reihen und dem Link zum Lauf; der nächste grüne Lauf schließt es. **Der
Orchestrator schaut morgens zuerst dorthin** und vergibt je rote Reihe (oder
je gemeinsame Ursache) eine Aufgabe, bevor neue Meilensteine starten. Bericht
und `nachtlauf-ergebnis.json` liegen als Artefakt am Lauf; die Zusammenfassung
des Laufs zeigt grün/rot je Reihe mit Dauer. Von Hand starten: Workflow
„Nachtlauf" → *Run workflow* (`auswahl` = nur einige Reihen, ein solcher Lauf
fasst das Issue nicht an).

## Token sparen
- Agenten lesen gezielt (`grep -n`, `sed -n a,bp`), nie ganze 8 000-Zeilen-
  Dateien.
- `docs/UMBAU.md` nur per `grep` nach dem betroffenen Dateinamen befragen.
- Prüfreihen nur für den eigenen Bereich laufen lassen
  (`node werkzeug/alle-pruefungen.mjs m29 m44`), die volle Reihe läuft
  nachts (Abschnitt „Nachtlauf") bzw. auf Wunsch.
- Rückmeldungen kurz halten; Details gehören in die Meilenstein-Datei.
