# M538 — Schlussrunde: Strg+D im Fokus, Vorbedingung für Gäste, Ablage aufräumen, alte App-Fassung
PR: mehrere kleine PRs „… (M538)" · Prüfreihe: `pruefungen/m538-schlussrunde.mjs` (Port 5538, `M538_PORT`) · Datum: 2026-11-25

## Warum
Letzte offene Punkte der Umsetzungsrunde nach dem Audit (Besitzer: „setz alles um"): Strg+D im Karten-Fokus (offen aus
M530), Vorbedingung in `gast_aendern` (Restfenster aus M533), verwaiste Einträge der Geräte-Ablage und eine alte
App-Fassung, die Verweise statt Bilder sehen könnte (beides offen aus M532), Bilder im Konto über den Datei-Weg
(offen aus M529/M532).

## D — Strg+D im Karten-Fokus
**Vorher:** Strg+D bei geöffneter Karte duplizierte die gewählte Karte — die Kopie lag unsichtbar hinter der offenen
Ansicht (wie Strg+V vor M530). **Jetzt:** ein Hinweis „Die geöffnete Karte wird nicht dupliziert. Esc schließt sie –
dann dupliziert Strg+D die Auswahl.", sonst nichts; die Taste wird geschluckt (kein Lesezeichen des Browsers). Auch mit
dem Schreib-Cursor im Text. Ohne Fokus wie bisher.
- `components/boardTasten.ts`: vor dem Duplizieren `st.focusCard` → `tun(() => showToast(…))`.
- Warum kein „sinnvolles Handeln" wie bei Strg+V: Eine Kopie der offenen Karte gehört aufs Board, nicht in die Karte;
  sie im Fokus anzulegen und dorthin zu springen hieße, die offene Karte ungefragt zu verlassen. Drei-Finger-Wischen
  (FingerGesten) war im Fokus schon gesperrt.
- Prüfreihe D1–D5; gegen den Build davor D1–D3 rot.

## G — Vorbedingung in gast_aendern (Restfenster aus M533)
**Vorher:** Ein Gast per Link, der eine Karte gleich nach dem Loslassen durch einen anderen anfasst (Punkt, Lage, Farbe),
sah vor dem Schreiben auf dem Server nach (M533). Speicherte der andere genau zwischen diesem Blick und dem Schreiben,
ersetzte `gast_aendern` die Karte als Ganzes mit dem Text, den der Gast noch kannte — der neue Text war überall weg.
Nachgestellt in `pruefungen/m538c-gast-vorbedingung.mjs` (Attrappe hält Gerds Speichern zurück und spielt es unmittelbar
vor Hannas Schreiben ein): Build davor W2/W4/W5 rot, auf dem Server stand danach „Mehr Fenster" statt „Mehr Fenster und
Licht ENDE".
**Jetzt:** Der Gast schickt bei solchen Karten die eben gesehene Version der Board-Zeile als Vorbedingung mit. Passt sie
nicht mehr, schreibt der Server nichts und meldet `vorbedingung`; das Gerät sieht neu nach (`vorSchreibenNachsehen`:
Kanal-Kette oder ganzer Stand, je Feld zusammengeführt, M524), berechnet den Schritt neu und schreibt erneut — höchstens
dreimal hintereinander, danach später wieder (`nochmalBald`), nie ohne Vorbedingung über den fremden Stand hinweg.

### Migration anwenden
**Datei:** `supabase/migrations/20261125120000_gast_aendern_vorbedingung.sql`

**Was sie tut:** ersetzt `public.gast_aendern(text, json)` durch dieselbe Signatur mit einer optionalen Vorbedingung
**im Patch**: `p_patch.wenn = { "version": <Version der Board-Zeile> }`. Passt die Version nach der Zeilensperre nicht,
schreibt sie nichts und meldet `vorbedingung` (P0001); eine Vorbedingung in falscher Form → `ungueltig` (P0003). Die
Antwort trägt zusätzlich `geprueft: true`. Unverändert: Rechte der Gäste (M365/M391, `gast_stuecke_pruefen`),
Inhaltsprüfung (M388, Auslöser), Sperr-Reihenfolge Board → Umgebung, Rechnung des Patches, Stempel in der Umgebung.
Ein `do`-Block entfernt jede andere Fassung von `gast_aendern` (wie M536). Wiederholbar.

**Warum im Patch statt als dritter Parameter** (wie `p_wenn_version` bei `board_aendern`, M529): Die Signatur bleibt
`gast_aendern(text, json)`. So kann nie eine zweite Fassung daneben entstehen — auch nicht, wenn jemand später eine
ältere Migration (`20261114200000_gast_aendern.sql`, `20261117100000_team_haertung.sql`) noch einmal einspielt; die
ersetzt dann nur diese Fassung. Mit einem dritten Parameter stünden danach zwei Fassungen nebeneinander, jeder Aufruf
mit benannten Parametern wäre mehrdeutig („is not unique") und **kein Gast** schriebe mehr (genau der Befund aus M536 bei
`board_aendern`). Ein Server ohne die Migration lässt den Schlüssel `wenn` liegen (er rechnet nur `nodes`, `edges`,
`drawings`, `comments`): derselbe Aufruf geht durch, kein 404, kein Umweg — nur ohne Vorbedingung (der Weg aus M533).

**Einspielen:** Supabase Dashboard → SQL Editor → Inhalt ausführen. Die App braucht sie nicht.

**Rückweg:** den Abschnitt `create or replace function public.gast_aendern …` samt `revoke`/`grant` aus
`20261117100000_team_haertung.sql` erneut ausführen (gleiche Signatur, ersetzt diese Fassung). Die App schreibt dann
wie vorher (sie merkt es an der Antwort ohne Vorbedingung; ein „vorbedingung" kommt nie).

### Wie (Client)
- `lib/gastSync.ts → hinaus`: `riskant` = der Patch setzt eine Karte, die `fremdFrisch` ist (hält ein anderer, wird
  mitgelesen oder wurde vor höchstens 30 s losgelassen). Nur dann `wenn = { version }` — die Version aus dem Blick
  (`vorSchreibenNachsehen` liefert jetzt `{ art, version }`; nach `'neu'` das Maximum aus gesehener und eingearbeiteter
  Version). Alle anderen Schritte ohne Vorbedingung — in großen Gruppen scheiterten sonst die meisten an Änderungen
  anderer an anderen Karten (darum hat `gast_aendern` seit M366 keine). `wenn` reist nur zum Server, nicht in den Kanal.
- Fehler `vorbedingung` → `hinaus(boardId)` neu (nachsehen, einarbeiten, neu berechnen), Zähler je Board
  (`vorbedingungVersuche`), nach drei Fehlversuchen `nochmalBald`.

### Prüfreihen
- `pruefungen/m538b-sql-gast-aendern.mjs` (echtes Postgres, eigene Datenbank `pntest538`): frische Kette aller
  Migrationen → genau eine `gast_aendern(text,json)`; Aufrufe mit benannten Parametern (mit und ohne `wenn`) lösen
  eindeutig auf; zweites Einspielen; ältere Migrationen erneut eingespielt → weiter genau eine Fassung; ein Entwurf mit
  anderer Parameterliste wird abgeräumt; anon/authenticated dürfen aufrufen; passende Version schreibt (`geprueft`),
  veraltete schreibt nichts (Text, Version, Umgebung gleich), ohne `wenn` wie bisher, Gast-Rechte und Inhaltsprüfung
  gelten auch mit Vorbedingung, `wenn` in falscher Form wird abgewiesen. Ohne die Datei: rot. m383b, m388b, m391b grün.
- `pruefungen/m538c-gast-vorbedingung.mjs` (Port 6538, Gerüst aus m533, Attrappe beider Wege): W mit Migration (Text und
  Punkt bleiben, erstes Schreiben scheitert an der Vorbedingung, zweites geht durch), O ohne Migration (derselbe Aufruf,
  kein Fehler, kein Wiederholen), R Karten, die niemand hielt, ohne Vorbedingung.

## A — Verwaiste Einträge der Geräte-Ablage aufräumen (offen aus M532)
**Vorher:** Jedes gelöschte, ersetzte oder geänderte große Bild blieb als `pixinotes-ablage:…` in der IndexedDB liegen
— die Ablage wuchs mit jeder Änderung an einem Bild. **Jetzt:** Einmal am Tag, eine Minute nach dem Start im Leerlauf,
löscht PixiNotes Einträge, die nichts mehr nennt — und das erst nach sieben Tagen (Schonfrist).
- `store/ablageAufraeumen.ts` (nachgeladen aus `App.tsx → Vorladen`, nicht im Start-Paket). Genannt ist, was im
  gespeicherten Stand (`pixinotes-board`), im Ersatzspeicher (M532), in den Rettungskopien (M529, auch sessionStorage),
  im Stand dieses Fensters und in seinem **Rückgängig-Verlauf** (`past`/`future`, dort als data-URL → ihr Verweis)
  steht, dazu was gerade gesichert wird (`A.offen`). Versionen (M449), Sicherungen und Abgleich speichern das ganze Bild,
  nicht den Verweis.
- Merkzettel `pixinotes-ablage-waisen` (IndexedDB, Verweis → seit wann verwaist). Gelöscht wird nur, was beim Lauf seit
  mindestens `SCHONFRIST_MS` (7 Tage) verwaist ist — und erst nach einem zweiten, frischen Blick unmittelbar davor.
  Wieder Genanntes fällt aus dem Merkzettel. Höchstens ein Lauf je 20 h (`pixinotes-ablage-aufgeraeumt`), nur ein
  Fenster zugleich (Web Lock `pixinotes-ablage-aufraeumen`). `ablage.ts` lädt erst, wenn es Einträge gibt (ihr Laden
  schaltet das Auslagern ein).
- **Andere offene Fenster:** Ihren Rückgängig-Verlauf sieht der Lauf nicht. Darum geht eine Nachricht an alle Fenster
  (BroadcastChannel `pixinotes-ablage`), welche Verweise gelöscht sind; `ablage.ts` nimmt sie aus `A.gesichert` und
  verwirft das Text-Gedächtnis. Holt ein Fenster das Bild per Rückgängig zurück, legt es den Inhalt erst wieder ab und
  schreibt dann den Verweis (nie ein Verweis ohne Inhalt) — Prüfreihe B.
- `window.pixinotesAblageAufraeumen(jetzt?)` für Prüfreihen und Fehlersuche (liefert `{ eintraege, verwaist, geloescht }`).
- Grenze: Holt ein anderes Fenster das Bild genau in dem Augenblick per Rückgängig zurück, in dem der Lauf löscht, kann
  sein Schreiben der Nachricht zuvorkommen (sieben Tage verwaist und dann in derselben Sekunde zurückgeholt). Dann fehlt
  das Bild nach dem Neuladen auf diesem Gerät; Abgleich und Konto tragen es weiter (der Store hält die data-URL).

## F — Alte App-Fassung sieht Verweise (offen aus M532)
**Befund:** Eine App-Fassung von vor M532 kennt die Verweise nicht. Realistisch ist nur ein **lange offener Tab** von
vor dem Update auf demselben Gerät (die App-Seite kommt vom Netz zuerst, ein alter Offline-Stand hat nie Verweise
gesehen — Verweise schreibt nur neuer Code, der online lief und damit auch den Offline-Speicher erneuert hat; eine alte
portable Datei unter `file://` hat einen eigenen Speicher). So ein Tab übernimmt beim Mitlesen bzw. als Nachfolger des
Schreibers den Stand mit Verweisen; wird er Schreiber, lädt er sie per Konto/Ordner/WebDAV hoch. Auf anderen Geräten
entschärfte `lib/sicher.ts` den Verweis dann als fremde Quelle — **das Bild wurde leer**, und das leere Bild ging an alle
(nachgestellt: Prüfreihe R gegen den Build davor).
Eine Fassung von vor M538 lässt sich nachträglich nicht umstimmen (ihr Code steht fest). Darum zwei Teile:
- **Reparatur beim Empfang** (wirkt gegen die heutigen alten Fassungen): `lib/sicher.ts → standGeprueft` (Konto, Ordner,
  WebDAV, Dateien) und `lib/gastSync.ts → holen` (Gast-Link) setzen Verweise vor jeder Prüfung aus der Ablage dieses
  Geräts ein (`store/ablageIdb.ts → verweiseReparieren`; der Schlüssel ist die Prüfsumme des Inhalts — wer das Bild je
  gespeichert hat, hat es unter genau diesem Schlüssel). Fehlt der Inhalt auch hier, bleibt die hiesige Fassung der
  Karte stehen (der Abgleich sieht „drüben unverändert"); nur eine hier unbekannte Karte kommt wie geliefert.
  `hatAblageVerweis` (Start-Paket, ohne Text zu bauen) lädt den Teil nur, wenn ein Verweis da ist.
- **Speicherformat** (wirkt ab jetzt für jede künftige Änderung des Aufbaus): `pixinotes-speicherformat` im localStorage
  (`store/speicher.ts → SPEICHERFORMAT = 2`). Findet eine Fassung eine höhere Nummer als ihre eigene, schreibt sie nichts,
  gleicht nicht ab, nimmt nie die Schreibrechte (kein Web Lock — das andere Fenster bleibt Schreiber) und zeigt ein Band
  „Eine neuere Fassung von PixiNotes hat hier gespeichert … Neu laden". Auch wenn die Marke erst während des Laufs steigt
  (anderes Fenster, `storage`-Ereignis). **Wer den Aufbau so ändert, dass eine ältere Fassung ihn nicht lesen kann, zählt
  `SPEICHERFORMAT` hoch.**
- Prüfreihen: F1–F4 (Marke, Band, keine Schreibvorgänge, Marke bleibt), R1–R5 (WebDAV-Nachbau: ein Stand mit Verweis —
  Inhalt hier vorhanden bzw. nirgends — kommt an, beide Bilder bleiben, der nächste Upload trägt wieder die ganzen
  Bilder). Gegen den Build davor: R3, R4, R5 rot (Bilder leer, leer hochgeladen), F2–F3 rot.

## Nicht umgesetzt: Bilder im Konto-Abgleich über den Datei-Weg (offen aus M529/M532)
Auf Wunsch des Besitzers („alles zum Ende bringen") nur angefangen, wenn es sauber und sicher in überschaubarer Zeit
geht — das ist es nicht: Der Board-Stand im Konto ist zugleich das Austauschformat für ältere App-Stände, Gäste per Link
(`gast_lesen`/`gast_aendern` lesen und schreiben die Board-Zeile selbst), Freigaben und den Inhalt-Prüfer (M388). Ein
Verweis statt Bild in der Board-Zeile müsste auf all diesen Wegen verstanden werden, und ein älteres Gerät sähe genau den
Fehler, den Abschnitt F gerade schließt (leere Bilder). **Plan:**
1. **Lesen zuerst ausliefern** (ein Meilenstein): Jedes Gerät versteht in Board-Zeilen einen Verweis
   `pixinotes-datei:<prüfsumme>` und holt den Inhalt aus `<Nutzer>/datei-<prüfsumme>` (bestehender Datei-Weg aus M329,
   Bucket-Regeln unverändert, Gäste über die Freigabe-Dateiliste wie bei Tools, M391); `standGeprueft` setzt ihn ein wie
   heute die Ablage-Verweise. Schreiben bleibt unverändert (ganzes Bild).
2. **Schreiben erst, wenn alle Geräte lesen können:** Jedes Gerät trägt seine Fassung in die Umgebung des Kontos ein
   (`umgebung.json → geraete: { <Gerät>: { format, zuletzt } }`); hochgeladen wird als Verweis nur, wenn jedes Gerät,
   das sich in den letzten 60 Tagen gemeldet hat, Schritt 1 kann, und nie für geteilte Boards, solange Gäste per Link
   einen älteren Stand haben könnten (bis die Gast-Funktionen Verweise verstehen). Ein Bild geht genau einmal als Datei
   hoch (Prüfsumme = Name, wiederholbar), danach reist nur der Verweis.
3. **Messen** mit einem Board der Gestalt des Besitzers (8 SVG à 80 KB, 16 HTML-Tools) — vor dem Bau von Schritt 2:
   Geschrieben wird seit M383/M529 kartenweise (`board_aendern`, ein Bild reist nur mit, wenn seine Karte sich ändert);
   gelesen wird nach jeder fremden Änderung die ganze Board-Zeile (rund 0,7 MB bei diesem Board). Dort steckt die
   Ersparnis — oder in einem Lese-Weg „nur geänderte Karten" (M529, Grenzen), der ganz ohne Formatwechsel auskäme und
   zuerst geprüft werden sollte.
4. Prüfreihe mit drei Geräten (alt/neu gemischt), Export/Import-Rundreise, Gast-Link, zweites Gerät ohne Ablage.
