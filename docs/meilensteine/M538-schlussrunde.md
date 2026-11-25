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
