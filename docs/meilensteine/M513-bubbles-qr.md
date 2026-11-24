# M513 — Ideabubbles einzeln per QR-Code teilen (Mitmachen ohne ganzes Board)
PR: #… · Prüfreihe: `pruefungen/m513-bubbles-qr.mjs` (Port 5513) · Datum: 2026-11-24

## Warum
Nutzerwunsch: „bei Idea-Bubbles bitte auch direkt in der Idea-Bubble eine Share-Möglichkeit per QR-Code einbauen.
Damit man auch nur einen kleinen Teil der Präsentation teilen kann, ohne dass alle direkt am ganzen Whiteboard als
Gast teilnehmen. Das kann für große Gruppen sinnvoll sein. Man hält einen Vortrag via Teams-Meeting und scrollt per
Screenshare über das Whiteboard. Die Teilnehmer scannen dann nur den QR des Ideaboards ab und stimmen mit ab,
brauchen aber nicht das gesamte Board als Interaktionselement.“

Der bisherige QR-Code (M385) trägt den Einladungslink des Boards — wer ihn scannt, ist Gast im ganzen Board, lädt die
ganze App und bekommt alle Karten.

## Was
- **In der Karte** (nur wer leitet, Leiste unten, also „Bedienung nur im Fokus" M421): Knopf mit QR-Zeichen
  „Mitmachen per QR" (`data-taste="bub-mitmachen"`). Öffnet ein großes Fenster (`BubblesQr`, Klassen der M385-Blende):
  Code (immer Schwarz auf Weiß), Kurzlink, „n Personen dabei" live, **Link kopieren**, **Groß auf der Bühne zeigen**,
  **Mitmachen beenden**, Schließen (✕, Esc, Klick daneben). Schließen beendet die Runde nicht.
- Solange die Runde läuft, steht oben in der Karte ein kleiner Zustand „QR · 12 dabei" (`bub-mit-stand`) — bleibt in
  Ruhe sichtbar (zeigt einen Zustand), ein Klick öffnet das Fenster wieder.
- **Bühne**: Der Code steht groß neben den Blasen in der Karte (`MitmachenBuehne`) — auf dem Board und auf der Folie der
  Präsentation (M380). Die Bühne der Blasen wird schmaler, nichts liegt übereinander.
- **Teilnehmer-Seite** `mitmachen.html`: schlank, telefongerecht, folgt Hell/Dunkel des Geräts und dem Look des Boards
  (pix·el, M507 — wird im Link als `d=pixel` mitgegeben). Zeigt Titel, Frage, die vier Schritte und je nach Schritt:
  - Sammeln: Name (freiwillig, fehlt bei „Namen ausblenden"), Idee senden, eigene Ideen zurückziehen; verdeckt sieht
    man nur Eigenes und „n Ideen von anderen (noch verdeckt)".
  - Gruppieren: Hinweis, Ideen nach Gruppen (nur lesen).
  - Abstimmen: „Noch x von y Punkten", je Idee − / ＋ mit den eigenen Punkten; „Zwischenstand verbergen" blendet fremde
    Punkte aus.
  - Ergebnis: Rangfolge mit Plätzen und Punkten.
  - Beendet: „Diese Mitmach-Runde ist beendet. Danke fürs Mitmachen!" Alter Link / Gastgeber weg: freundliche Meldung
    „gerade nicht offen …", die Seite versucht es weiter. Kaputter Link: Hinweis zum erneuten Scannen.
  - Sprache: Deutsch, Englisch bei englischem Gerät (eigenes kleines Wörterbuch in der Seite).
- **Mitmachen beenden**: Karte vermerkt `an: false`, der Gastgeber sagt allen „beendet" (dreimal, für Nachzügler), legt
  auf und vergisst den Schlüssel. Ein neuer Start erzeugt einen neuen Link.

## Wie (Architektur)
Kein Server-Code, keine Migration. Der **Gastgeber ist das Gerät, das die Runde geöffnet hat**: Es prüft und schreibt,
der Server (Supabase Realtime, öffentlicher Schlüssel, kein Konto) reicht nur Nachrichten weiter.

| Datei | Inhalt |
|---|---|
| `src/lib/mitmachenProtokoll.ts` | Protokoll ohne Store/React: Link (`linkBauen/linkLesen`), Kanalnamen, `GRENZEN`, `GRUND`, Signatur (ECDSA P-256), Schlüsseltausch (ECDH P-256 → AES-GCM), `kennungAus`, `restSenden`, Typen `MitStand`, `MeinStand`, `Wunsch` |
| `src/lib/mitmachen.ts` | leichter Teil fürs Board: Kartenfeld `mitmachen` lesen (`mitmachenVon`), privater Schlüssel in `localStorage['pixinotes-mitmachen']` (`gemerkt`), `mitmachenLink`, `mitmachenOeffnen`, Teilnehmerzahl (`mitmachenStand`, Ereignis `pixinotes:mitmachen`), `gastgeberLaden` |
| `src/lib/mitmachenHost.ts` | Gastgeber: `mitmachenDienste()` gleicht mit dem Store ab (Runden dieser Karte starten/beenden, nur im Schreiber-Tab), hört auf Wünsche, prüft (`anwenden`), schreibt gebündelt per `updateNodeDataOnBoard` (ohne Verlaufseintrag, `mutedHistory`), sendet den signierten Stand |
| `src/components/BubblesQr.tsx` | Fenster `BubblesQr`, `MitmachenBuehne`, `useMitmachenStand` |
| `src/components/nodes/BubblesCard.tsx` | Knopf, Zustand, Bühne (Hülle `.bub-mitte` um `.bub-buehne`) |
| `mitmachen.html`, `src/mitmachen/main.ts`, `src/mitmachen/mitmachen.css` | Teilnehmer-Seite (Vanilla-TS, kein React); zweiter Einstieg in `vite.config.ts` (`rollupOptions.input`) |
| `src/lib/liveKanal.ts` | neue Option `stumm` (ohne Presence) |
| `src/App.tsx` | lädt den Gastgeber nach, wenn `pixinotes-mitmachen` existiert |
| `public/sw.js` | cacht als Offline-Seite nur noch die App-Seite selbst (vorher hätte ein Aufruf von `mitmachen.html` sie ersetzt) |

**Kartenfeld** `data.mitmachen = { token, k, an, t, buehne? }` — `k` ist nur der **Abdruck** des öffentlichen
Signierschlüssels (SHA-256, 16 Byte). Der private Schlüssel (JWK) liegt nur auf dem Gastgeber-Gerät.

**Kanäle** (Realtime, Präfix `pn-` wie M364): `pn-mit-<token>` — der Gastgeber sendet den Stand, alle Telefone hören
zu (ohne Presence). `pn-mit-<token>-ein` — nur der Gastgeber hört; Telefone senden über die REST-Schnittstelle
`POST /realtime/v1/api/broadcast` ohne beizutreten (eine Nachricht geht an EINEN Empfänger, nicht an alle — bei 200
Leuten 200-mal weniger Verkehr). Geht REST nicht, senden sie über den Stand-Kanal (alle sehen dann nur Verschlüsseltes).

**Stand** (`MitStand`, signiert): Titel, Frage, Schritt, Punkte je Person, Regeln, Gruppen (Name, Farbe), Blasen
(`id`, Ideen-`i`, Text — leer, solange verdeckt —, Nennungen, Punkte — fehlen bei „Zwischenstand verbergen" —, Gruppe,
Namen — fehlen bei „anonym"), `h` (Tausch-Schlüssel des Gastgebers), `k` (Signier-Schlüssel, geprüft gegen den Abdruck
im Link), `dabei`, `z` (steigt; ältere Stände zählen nicht), `ende`. Dazu `u`: persönliche Stände (`MeinStand`: höchste
verarbeitete Wunsch-Nummer, Ablehnungen, eigene Ideen, eigene Punkte), je Person mit ihrem Schlüssel verschlüsselt.
Takt: frühestens alle `max(600 ms, aktive × 12 ms)` (höchstens 4 s), ohne Änderung alle 12 s.

**Wünsche** (`Wunsch`: `da | idee | weg | plus | minus`, laufende Nummer `n`) — verschlüsselt mit dem gemeinsamen
Schlüssel aus dem Tausch-Paar der Person (je Gerät und Runde, `localStorage['pixinotes-mit:<token>']`) und dem des
Gastgebers. Urheber in der Karte: `von: 't:<Abdruck des Personen-Schlüssels>'`. Unbestätigte Wünsche schickt das
Telefon nach 6 s erneut (gleiche Nummer, der Gastgeber nimmt jede Nummer nur einmal).

## Sicherheitsgrenzen
- **Nur diese Karte verlässt das Gerät** — und von ihr nur, was die Regeln zeigen (verdeckt: keine fremden Texte;
  anonym: keine Namen; Zwischenstand verborgen: keine fremden Punkte). Board, andere Karten, Notizen, Kommentare,
  Anhänge gehen nie in den Kanal (m513 I1/I2 prüft Leitung und DOM). Die Teilnehmer-Seite lädt keine Board-Daten und
  keinen App-Code (27 KB JS statt ~2 MB).
- **Teilnehmende können nur Ideen und Punkte dieser Karte schreiben**, und nur so, wie die Regeln der Karte es
  erlauben (Ideen nur beim Sammeln, Punkte nur beim Abstimmen, Budget, nur eigene Ideen zurückziehen). Andere Felder,
  andere Karten, Gruppen, Regeln, Schritte: nicht ansprechbar.
- **Niemand kann sich als jemand anderes ausgeben**: Wünsche sind mit dem Schlüssel der Person verschlüsselt — wer
  mitliest, kann keine fremde Idee löschen, keine Punkte unter fremdem Namen setzen und keine persönlichen Stände lesen.
- **Niemand kann den Telefonen einen Stand unterschieben**: Stände sind signiert, der Schlüssel ist über den Abdruck im
  Link (Teil hinter „#", geht an keinen Server) gebunden; ältere Stände werden verworfen.
- **Grenzen gegen Fluten** (beim Gastgeber, `GRENZEN`): 140 Zeichen je Idee, 40 je Name, 10 lebende Ideen je Person,
  400 in der Karte, Eimer 8 Wünsche auf einmal + 1 je 1,2 s je Person, 60 Wünsche je Sekunde insgesamt, 1000 Personen,
  4 000 Zeichen je Nachricht. Texte laufen durch `textVonAussen` (`lib/sicher.ts`) und landen nur als Text im DOM.
- Was der Server sieht: Token und Kanalnamen, verschlüsselte Wünsche, die signierten öffentlichen Stände.

## Was am Server fehlt / bewusst nicht gemacht
- **Keine Migration nötig, keine eingespielt.** Die Abgrenzung liegt beim Gastgeber, nicht in RLS — der Server kann sie
  darum auch nicht durchsetzen, wenn der Gastgeber nicht läuft (dann kommt einfach nichts an).
- Wer den Link hat, kann den Stand-Kanal mitlesen (öffentlicher Kanal): das ist die öffentliche Ansicht der Karte, die
  jede Person mit dem Link ohnehin sieht. Wer mehr will (Kanäle nur mit Token-geprüftem Zugang), braucht Realtime
  Authorization (`realtime.messages`-Richtlinien) samt einer Edge Function, die Gäste-Tokens ausstellt — das wäre
  eine Server-Änderung und braucht die Freigabe des Betreibers.
- Die Teilnehmerzahl zählt Meldungen („hallo" alle 25 s) — wer will, kann sie mit erfundenen Schlüsseln aufblähen
  (gedeckelt bei 1000); an den Daten der Karte ändert das nichts.
- Supabase-Kontingente (Nachrichten je Sekunde, gleichzeitige Verbindungen) setzen eine Obergrenze; ab einigen hundert
  Teilnehmenden sollte man es vorher ausprobieren.

## Grenzen / offen
- **Das Gastgeber-Gerät muss das Board offen haben** (Schreiber-Tab). Ein anderes Teammitglied sieht die Runde und alle
  Beiträge über den normalen Abgleich, ist aber nicht Gastgeber; es kann die Runde neu starten (neuer Link).
- Gastgeber-Neustart (Seite neu geladen): neuer Tausch-Schlüssel, die Telefone verbinden sich von selbst neu;
  Unbestätigtes schicken sie erneut.
- Die portable Datei hat keine eigene Teilnehmer-Seite (ihr Link zeigt auf die Web-Adresse der App,
  `WEB_ADRESSE`) — WASM-/Kanal-Teile gehören nicht in die Einzeldatei, und eine `file://`-Adresse kann kein Telefon öffnen.
- Moderation verdeckt: Auch die Moderation sieht verdeckt gesammelte Texte erst nach dem Sammeln (Regel der Karte seit M378).
- Bilder: `pruefungen/ablage/m513/` (QR-Fenster, Bühne, Telefon hell/dunkel je Schritt).
