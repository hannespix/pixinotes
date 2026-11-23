# M483 — Start-JS entlastet: rund 140 KB weniger bis zum ersten Board
PR: siehe Merge-Titel „… (M483)" · Prüfreihe: `pruefungen/m483-start-leicht.mjs` (Port 5483) · Datum: 2026-11-23

## Warum
Das Start-JS (alles, was bis zum bedienbaren Board über die Leitung kommt) lag bei 2 238 181 B, die Grenzen der
Prüfreihen bei 2 240 000 B (m459, m467) bzw. 2 245 000 B (m446). Jeder neue Meilenstein stieß an die Grenze und
musste Umwege bauen oder sie anheben (M477, M481, M482). Ziel: mindestens 60 KB, besser 100 KB echte Luft — ohne
Verhaltensänderung.

## Was
Nichts Sichtbares. Was ein frisch geöffnetes Board nicht braucht, kommt mit dem ersten Aufruf bzw. still im Leerlauf
kurz nach dem Start (`imLeerlaufVorladen`, App.tsx, 4 s + `requestIdleCallback`) — danach geht die erste Auswahl, das
erste Ablegen, „Beispiele laden" ohne Verzug, und der Service Worker hat die Teile auch offline.

| Messung (Board mit einer Notiz, 1440×900) | vorher | nachher |
|---|---:|---:|
| Start-JS gesamt | 2 238 181 B | **2 095 863 B** (−142 318 B) |
| davon App-Teil `index-*.js` | 893 111 B | 750 793 B |
| Editor, Fluss, React | 1 345 070 B | 1 345 070 B (unverändert) |
| Grenze m459 / m467 | 2 240 000 B | **2 120 000 B** |
| Grenze m446 (misst etwas mehr: +~4 KB) | 2 245 000 B | **2 125 000 B** |

Die Grenzen sind bewusst **gesenkt** (neuer Stand + gut 20 KB): Das gewonnene Polster soll für mehrere Meilensteine
reichen, nicht beim nächsten wieder verbraucht sein. Ein neuer Teil im Start fällt weiter sofort auf.

Nachgeladen (Dateiname des Nachlade-Teils → Einstieg):

| Teil | gewonnen (unminifiziert) | kommt mit |
|---|---:|---|
| `SelectionToolbar` (Auswahl-Leiste samt Ausrichten, Rahmen-Werkzeugen) | ~61 KB | der ersten Auswahl (`AuswahlLeiste` in Board.tsx) |
| `aiActions` (KI-Aktionen) | ~25 KB | dem Klick im Dock bzw. mit der Auswahl-Leiste |
| `starter` (Beispiel-Boards) | ~26 KB | „Beispiele laden" (Begrüßung, leeres Board, ＋ Neu) |
| `calAccounts` (Anmelden, Token, Abruf Google/Microsoft) | ~22 KB | dem ersten Hintergrund-Abruf, Kalender-Karte, Einstellungen |
| `importFiles` (+ Word-, vCard-, Board-Datei-Leser) | ~17 KB | dem ersten Ablegen/Einfügen (`lib/importSpaet.ts`) |
| `ShareCardsModal` (Karten teilen) | ~17 KB | „Teilen" |
| `BildExport` (+ Exporter) | ~14 KB | Dock ⋯ → „Als Bild exportieren" |
| `bildBearbeiten` | ~10 KB | „Fertig" im Bild-Editor |
| `kontaktExport` (+ vCard-Schreiber) | ~12 KB | Board-⋯ → „Kontakte als vCard" |
| `EbeneLoeschenFenster` | ~10 KB | Projekt/Bereich mit Boards löschen |
| `GeteiltDialog` | ~4 KB (Rest war schon Import) | Geteiltes aus Android/Browser-Erweiterung |

## Wie (Architektur)
- **Messen:** eine vorübergehende Vite-Konfiguration mit einem Plugin, das in `generateBundle` je Chunk die Module mit
  `renderedLength` und über `this.getModuleInfo` den statischen Import-Graphen schreibt. Für jedes Modul wurde der
  „exklusive Gewinn" gerechnet: die Größe aller Module, die vom Einstieg aus nicht mehr statisch erreichbar sind,
  wenn alle statischen Kanten zu diesem Modul wegfallen. Das zeigt, welcher `import()` sich lohnt (und welcher nur
  ein Modul verschiebt, das ein anderer Starter-Teil ohnehin zieht). Nicht eingecheckt — bei Bedarf neu bauen.
- **Auswahl-Leiste:** `Board.tsx` → `auswahlLeisteLaden`, `AuswahlLeisteSpaet` (React.lazy), `AuswahlLeiste` hängt sie
  ein, sobald eine Karte gewählt ist, und lässt sie danach eingehängt (Modul-Merker `auswahlLeisteEingehaengt`, auch
  über einen Board-Wechsel/Remount). Den Rechtsklick-Wunsch holt sie sich beim Einhängen selbst ab
  (`kartenWunschNehmen`, M350 — war schon so gebaut, weil sie „evtl. erst mit der Auswahl entsteht").
- **Import:** `src/lib/importSpaet.ts` — Weichen mit denselben Signaturen (`importFilesToBoard`,
  `importHtmlAppFromUrl`, `praesentationAnlegen`, alle schon vorher asynchron) und `importLaden` für den Leerlauf.
  Board, Dock, NoteCard, MinutesCard, GeteiltDialog und `lib/eingang.ts` importieren von dort.
- **KI-Aktionen im Dock:** Weichen wie M410 `aiCommand` (`type KiAktionen = typeof import(...)`).
- **Beispiele:** `addStarter` in `store/abgleich.ts` lädt `lib/starter` per `import()`; die Aktion bleibt `() => void`.
- **Kalender:** neuer leichter Teil `src/lib/calKonten.ts` (Typen, `loadCalAccounts`/`save`/`patch`,
  `anyAccountConnected`, `oauthAvailable`, `handleOAuthRedirect`, gemerkte Termine M469). `calAccounts.ts` importiert
  ihn und reicht alles weiter — alle bisherigen Importe bleiben gültig. `main.tsx` und `termineZentrale.ts` nehmen
  den leichten Teil; `termineHintergrund` lädt `fetchAccountEvents` per `import()` (war schon ein Versprechen).
- **Dialoge:** `KartenTeilen`, `BildExportFenster` in App.tsx über `BeiBedarf` und `LADER.teilen`/`LADER.bildExport`
  (M446-Muster). `EbeneLoeschenDialog.tsx` behält Ereignis, `ebeneLoeschenFragen` und Host; der Dialog liegt in
  `EbeneLoeschenFenster.tsx`. `GeteiltHost.tsx` (neu, im Start) wacht beim Start und hört auf die
  Browser-Erweiterung; `GeteiltDialog.tsx` ist nur noch der Dialog (`gabe`, `ziel`, `onClose`) plus `aufsBoardLegen`.
  `BildEditorHost.tsx` holt `blobAlsDataUrl`/`nameMitEndung` erst in `fertig`. `EbenenMenu.tsx` lädt
  `kontaktExport` mit dem Klick.
- **Leerlauf:** `imLeerlaufVorladen` holt zusätzlich Auswahl-Leiste, Import, Beispiele, GeteiltDialog,
  EbeneLoeschenFenster, kontaktExport (Teilen und Bild-Export über `LADER`).
- Portable Einzeldatei (`build:single`) packt alles in eine Datei wie bisher; geprüft per file:// ohne Netz
  (Auswahl-Leiste erscheint, keine Fehler, keine Anfragen nach draußen).

## Grenzen / offen
- Bewusst **im Start** geblieben: Tastenkürzel (`Tastatur`, `pfeilTasten`), Zeichen-Ebene (`DrawingLayer`, ~84 KB —
  sie nimmt auch ohne Zeichenmodus Stift-Eingaben an), Grundkarten (Notiz, E-Mail, Bild, Datei, Rahmen, Portal —
  M446-Entscheidung, sie sollen ohne Verzug stehen), Sync-Initialisierung (`syncFolder`, `webdav`, `projectSync`,
  sie prüfen beim Start, ob eine Verbindung besteht).
- Weitere Kandidaten, falls wieder Luft gebraucht wird: `RechenTabelle` (Tabellen-Block in Notizen, ~13 KB — nur mit
  Platzhalter, sonst ruckt eine Notiz mit Tabelle beim Start), `vorfuehren`/`Mauszeiger`/`Gruppenraum` (Live-Team,
  ~40 KB, starten beim Start ihre Kanäle), `brain` (~16 KB), `tasks`-Erinnerung (~13 KB).
- Die erste Auswahl **vor** dem Leerlauf-Vorladen (in den ersten ~4 s) wartet auf einen lokalen Abruf (wenige
  Millisekunden, ohne Platzhalter).
