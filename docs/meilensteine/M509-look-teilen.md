# M509 — Der Look des Boards reist beim Teilen mit
PR: #… · Prüfreihe: `pruefungen/m509-look-teilen.mjs` (Port 5509) · Datum: 2026-11-24

## Warum
Nutzerwunsch: „der style des boards soll sich bei sharing (gemeinsame freigabe) mit übertragen. also wenn ich z. B.
spezielle look einstellungen (dark mode, pix-el grafik etc.) eingestellt habe, sollen die follower eines qr codes die
selben grundeinstellungen für das board übermittelt bekommen.“ Bisher reiste nur der Board-Hintergrund (`bg`, M88)
mit; Erscheinungsbild, Design (M507) und Akzentfarbe galten je Gerät.

## Was
- **Teilender:** Im Dialog „Gemeinsam bearbeiten“ steht die Zeile **„Look mitgeben“** (Vorgabe an) mit dem Look in
  Worten, etwa „Dunkel · pix·el“ oder „Hell · Klassisch · Grün“ (pix·el bringt sein LCD-Grün mit, M507 — der Akzent
  zählt dort nicht). Sobald das Board geteilt wird (Einladungslink/QR-Code angelegt oder eine Person per E-Mail
  freigegeben) bzw. beim Öffnen des Dialogs für ein schon geteiltes Board, steht der aktuelle Look am Board.
  Ändert der Teilende danach Erscheinungsbild, Design oder Akzent, ziehen alle seine Boards mit aktivem Look nach —
  die Gäste sehen es live. Abgeschaltet bleibt `look: { aus: true }` am Board: niemand bekommt einen Look, und spätere
  Änderungen schreiben keinen.
- **Gast** (per Link ohne Konto, per Konto-Freigabe, über QR): Auf dem geteilten Board gilt der mitgegebene Look —
  nur solange es offen ist. Auf eigenen Boards und in der Übersicht gilt der eigene Look; die eigenen Einstellungen
  (`ui`) werden nie geschrieben. Ein Hinweis (einmal je Board und Gerät, nur wenn der Look sichtbar anders ist) sagt
  es, mit Knopf **„Eigenen Look verwenden“**; derselbe Schalter steht im Board-Dialog (zurück mit „Look des Boards
  verwenden“) und unter Einstellungen → Darstellung → Aussehen (dort mit dem Satz, dass die eigene Auswahl für die
  eigenen Boards gilt).
- **Barrierefreiheit hat Vorrang:** Anzeigegröße, „Besser lesbar“ (`data-lesbar`) und weniger Bewegung gehören nie
  zum Look und bleiben beim Gast, wie er sie eingestellt hat.

## Wie (Architektur)
- Datenfeld: `BoardDoc.look?: BoardLook` mit `BoardLook = { aus?, theme?, design?, accent? }` (`src/store/typen.ts`),
  Aktion `setBoardLook(id, look)` in `src/store/struktur.ts` (neben `setBoardBg`). Der Look ist **Inhalt des Boards**:
  er reist mit Konto-Abgleich, Gast-Link (`gast_lesen`/`gast_schreiben`) und Sicherungen — **kein neues Server-Feld,
  keine Migration, RLS unverändert**.
- `src/lib/boardLook.ts` (klein, im Start): `lookAusUi`, `lookVonAussen` (nur bekannte Werte — Themen, Designs, die
  fünf Akzente; `aus` nur als `true`), `lookAktiv`, `lookWort`, `wirksamerLook(ui, look, eigen)`, `lookNachziehen`
  (Boards des Teilenden mit aktivem Look nachziehen), `lookRohVon`/`lookAusRoh` (ein Text als Selektor-Ergebnis —
  App zeichnet nur bei einer Look-Änderung neu, nicht bei jeder Karten-Änderung), „eigener Look“ je Gerät in
  `localStorage` `pixinotes-eigener-look` (Liste von Board-Kennungen, Ereignis `pn-eigener-look`), Hinweis einmal je
  Board über `pixinotes-look-hinweis`.
- Anwenden: `src/App.tsx` — der Design-Effekt nimmt den wirksamen Look (statt `ui`) und setzt zusätzlich
  `html[data-look-von="board"]`, solange der Look des Boards wirkt. Gilt nur für `view === 'board'` und Boards mit
  `geteiltVon` (also nie beim Besitzer).
- Nachziehen beim Teilenden: `setUiTheme/setUiAccent/setUiDesign` in `src/store/ansicht.ts` rufen `lookNachziehen`
  (nur Boards ohne `geteiltVon`/`gastLink` mit aktivem Look).
- Sicherheit: `boardVonAussen` in `src/lib/sicher.ts` prüft den Look (`lookVonAussen`, dort re-exportiert) — jeder
  Stand von Server, Konto, Sicherung.
- Abgleich: `src/lib/syncMerge.ts` führt `look` dreiwegig wie `bg`; kein Zeitstempel, also nichts für
  `lib/abgleichZeiten.ts`. Live: `kontoAenderungenSenden` in `src/lib/gastSync.ts` schickt bei einer Änderung nur an
  `look` oder `bg` (ein Patch kennt Board-Felder nicht) ein `stand` in den Kanal — die Gäste holen den Stand sofort
  statt beim nächsten Kontrollblick (20 s). Davon profitiert auch der Board-Hintergrund.
- Oberfläche: `src/components/FreigabeDialog.tsx` (Zeile `data-taste="look-mitgeben"`, Gast-Zeile
  `data-taste="look-gast"`/`look-eigen`), `src/components/Settings.tsx` (`data-taste="look-hinweis"`), Stile in
  `src/styles/64-gruppenarbeit-bild.css` (bei den Freigabe-Schaltern).

## Prüfreihe
`m509` (zwei Kontexte, nachgebautes Supabase aus m503): Anna (Dunkel, Grün) legt den Link an → Look am Board und
beim Server; Gerd (Hell, Orange, „Besser lesbar“) folgt ohne Konto → gleiche Attribute und gezeichnete Farben,
Lesbarkeit bleibt, Einstellungen unverändert, Hinweis; anderes Board → eigener Look; Anna stellt auf pix·el → kommt
live an; „Eigenen Look verwenden“ und zurück; Gerds eigene Änderung rührt das Board nicht an; „Look mitgeben“ aus →
Gerd hat seinen Look, Annas spätere Änderung schreibt nichts; fremde Werte im Look vom Server fallen weg.

## Grenzen / offen
- Der Look wird beim Teilen bzw. beim Öffnen des Freigabe-Dialogs gesetzt — ein Board, das vor M509 geteilt wurde,
  bekommt ihn, sobald der Besitzer den Dialog einmal öffnet oder seinen Look umstellt (dann nur, wenn schon ein Look
  am Board steht). Bewusst nicht automatisch für alle Boards, die irgendwann geteilt wurden.
- „System“ wird als „System“ mitgegeben: dann entscheidet das Gerät des Gastes über Hell/Dunkel.
- Die Kopie per Link (M357, kein Live-Teilen) nimmt das Feld mit, beim Empfänger ist es aber sein eigenes Board —
  der Look wirkt dort nicht.
