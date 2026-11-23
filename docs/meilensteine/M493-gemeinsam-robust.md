# M493 — Gemeinsames Tippen robust: Zeichen landen an der richtigen Stelle
PR: siehe Merge-Titel „… (M493)" · Prüfreihe: `pruefungen/m487-gemeinsam-weiter.mjs` erweitert (B12–B18, Port 5487) · Datum: 2026-11-23

## Warum
M484 ließ zwei Befunde offen: Im gemeinsam getippten **Protokoll** (M487) landeten unter Last Zeichen an falscher Stelle
(m487 B5/B8, 8 von 10), und m477 lief einmal ins Zeitlimit des Läufers (hängend bei `keyboard.type`). Dazu aus M489:
Abhaken in der Übersicht ging verloren, wenn im Live-Board gerade jemand in derselben Sitzung tippte.

## Ursachen (mit Beleg)
Mitgeschnitten wurden je Gerät alle Yjs-Änderungen (Herkunft, Größe, Text des Fragments), alle empfangenen
Kanal-Nachrichten, der Start der Sitzung (`warten`, `bekamStand`, Anfang aus dem Speicher) und jede ProseMirror-
Transaktion (Herkunft, Text, Cursor) — eine Reihe, die nur Abschnitt B wiederholt, fünffach parallel bei Last 20–28.

1. **Zwei Anfänge übereinander (m487 B5/B8) — App-Fehler.** Beispiel eines roten Laufs (Annas Gerät):
   ```
   beginn  warten:false andere:false  → init len 252 „|Protokoll Start|"
   rx hallo (Gerd) … rx upd len 304   → „|Protokoll Start|Protokoll Start|"   (Gerds Anfang kommt dazu)
   yupd (PM) „|Protokoll Start|"  …  rx upd (Gerd) → „"                       (jeder nimmt einen anderen Absatz weg)
   … „G 0Ag0a  eziwnsei"                                                      (beide tippen an derselben Stelle)
   ```
   Gerd begann zur selben Zeit **ohne zu warten** (`warten: false`, `bekamStand: false`) mit init **len 227** — ein
   anderer Anfang: Annas gespeicherte Blöcke trugen Kennungen und Standardwerte (`"id":"eb4269e6-…"`), Gerds nicht.
   Der Grund: Beim Wechsel von „allein" zu „gemeinsam" baute Annas Editor ab und schrieb dabei seine **umgeformte**
   Fassung zurück (BlockNote ergänzt beim Laden Kennungen und Props; der Vergleich mit dem Gespeicherten, M410, sah das
   als Änderung). Zwei verschiedene deterministische Anfänge → Yjs legt beide übereinander, die Editoren entfernen je
   einen anderen der doppelten Absätze → der Text ist leer, beide tippen an Position 0 und die Zeichen mischen sich.
   Ohne Last kam Annas Schreibvorgang meist vor Gerds Anfang an, deshalb nur unter Last.
2. **Endlosschleife beim „Heilen" (m477-Hänger) — App-Fehler.** Der Schreiber einer gemeinsamen Sitzung sichert neu,
   sobald sich die Karte im Speicher „von außen" ändert (M477, Heilen). Nimmt der Kartenschutz (`store/schutz.ts`: ein
   anderer hält die Karte oder tippt darin) den geschriebenen Stand sofort zurück, ist die Karte wieder „anders" — der
   Schreiber sicherte in einer endlosen Kette von Mikroaufgaben, die Seite stand still. Nachgestellt mit der neuen
   Reihe (Beschluss-Knopf, während Gerd tippt): `keyboard.type` hing bis zum Zeitlimit; mit Sperre gegen das
   Wiedereintreten zählte Annas Gerät in demselben Ablauf **6** abgefangene Heil-Ketten.
3. **Beschluss und Haken am Y-Dokument vorbei (M489) — App-Fehler.** „§ Beschluss" nahm die Zeile über den Editor
   (Yjs) aus dem Text, schrieb den Beschluss aber in den Speicher — tippte ein anderer, nahm der Schutz das zurück, und
   die Zeile war weg, ohne als Beschluss anzukommen (alte Fassung: m487 B13/B14 rot, `[[],[]]`). Der Haken in der
   Übersicht ging ebenfalls über den Speicher und wurde vom Schreiber wieder „geheilt" (B16/B18 rot). Ein Klick auf den
   Haken nahm außerdem eine Karten-Sperre, so dass der gemeinsame Schreiber nicht mehr sichern konnte (B17).
4. **Rückschreiben in den Editor (Notiz).** Jedes Sichern des Schreibers zählte `extEpoch` hoch (M323 tut das für
   jedes `blocks`-Schreiben) — der NoteCard-Editor des Schreibers ersetzte daraufhin seinen ganzen Inhalt durch genau
   diesen Stand. Kam dazwischen ein Zeichen, drehte das Ersetzen es über Yjs bei allen zurück.

Die Prüfungen lasen in keinem dieser Fälle zu früh; sie blieben unverändert (nur erweitert).

## Was
- Gemeinsam getippte Protokolle beginnen auf allen Geräten aus demselben Stand — kein verdoppelter oder verlorener
  Text, keine vermischten Zeichen mehr, auch unter Last.
- „§ Beschluss", „Aufgabe", „TOP", das Bearbeiten und Entfernen von Beschlüssen sowie das Abhaken in der Übersicht
  (und in der Aufgaben-Zentrale) laufen im Live-Board über das gemeinsame Dokument: Nichts geht verloren, wenn
  gleichzeitig jemand anderes in derselben Sitzung schreibt; Hineinklicken in die Beschlüsse und die Übersicht nimmt
  keine Karten-Sperre.
- Die Seite kann nicht mehr in eine Endlosschleife geraten, wenn eine Karte gehalten wird, während andere gemeinsam
  tippen.

## Wie (Architektur)
- `lib/notizGemeinsamKern.ts`
  - **Fragen nachholen:** Ein `hallo`, das ankommt, während das Gerät selbst noch auf Stände wartet, wird gemerkt
    (`fragen`) und beantwortet, sobald es steht (vorher verworfen). Kommt ein `hallo` von einer kleineren Kennung, die
    gerade ebenfalls anfängt (`kleinererBeginnt`), wartet das Gerät länger auf deren Stand (zweimal nachfragen) statt
    selbst anzufangen; Rückfall wie bisher.
  - **Heilen ohne Kette:** `heilt` sperrt das Wiedereintreten des Speicher-Abos während des eigenen Sicherns.
  - **Notiz:** `schreiben` gibt `extEpoch` unverändert mit (kein Rückschreiben in den eigenen Editor).
  - **Protokoll:** `protokollOeffnen(…, beschluesse)` legt die Beschlüsse als Y.Map `beschluesse` (Kennung →
    `{ text, o }`) mit in den deterministischen Anfang (Kennung des Hilfsdokuments rechnet sie mit) und setzt die Marke
    `pn.beschluesse`. `schreiben` sichert `blocks` und `decisions` (nur mit Marke — Dokumente einer älteren Fassung
    lassen die Beschlüsse im Speicher). `ProtokollSitzung`: `beschluesse`, `beschlussSetzen`, `beschlussDazu`,
    `beiBeschluessen`, `aufgabeHaken(blockId)` (setzt `checked` am `checkListItem` des Blocks im Y-Fragment, Kennung
    oder `pos:`-Pfad), `mitBeschluessen`. `neuSichern()` (intern) sichert nach einer Beschluss-Änderung mit dem
    letzten Editor-Stand (`quelle` aus `anbinden`).
  - `protokollHaken(…)`: kurz der Sitzung beitreten (wartet auf den Stand der anderen), Haken setzen, sichern, wenn
    dieses Gerät Schreiber ist (`yXmlFragmentToBlocks`), senden, gehen.
- `lib/protokollLive.ts` (neu, ohne Abhängigkeiten): Brücke Karte ↔ Sitzung (`protokollLiveSetzen`,
  `protokollLive`, Ereignis `PROTOKOLL_LIVE`).
- `components/nodes/ProtokollGemeinsam.tsx`: wartet immer kurz auf den Stand der anderen (`warten = true`, die
  ruhende Ansicht steht so lange); meldet die Sitzung an der Brücke an.
- `components/nodes/MinutesCard.tsx`: `useProtokollLive` — Beschlüsse gemeinsam aus dem Y-Dokument, sonst aus dem
  Speicher (`beschlussDazu`, `beschlussSetzen`); Abhaken im Live-Board über `protokollHaken` (Rückfall: Speicher);
  `.minutes-decisions` (gemeinsam) und `.pr-uebersicht` tragen `data-ohne-sperre`; `EntryEditor` schreibt beim Abbau
  nichts zurück, wenn sich seit dem Aufbau nichts geändert hat (`beimAufbau`).
- `components/TaskHub.tsx`: Haken an Protokoll-Punkten im aktiven Live-Board über `protokollHaken`.
- `store/schutz.ts` `mitTextVon`: beim Protokoll gehen `blocks` **und** `decisions` durch (beide sichert der
  gemeinsame Schreiber).
- Start-JS: 2 107 104 B (Grenze 2 120 000 unverändert); neu im Start nur der `liveVerbunden`-Import der Zentrale.

## Prüfreihe
`m487` neu B12–B18: Gerd macht eine Zeile zum Beschluss, während Anna vorne tippt (aus dem Text, bei beiden als
Beschluss, auf dem Server) · „Aufgabe", während Anna tippt · Anna hakt in der Übersicht ab, während Gerd in derselben
Sitzung tippt — der Haken bleibt (Server, Gerds Editor, auch nach 2 s), Gerds Text vollständig, Übersicht erledigt.
Gegen die Fassung vor M493: B13, B14, B16, B18 rot.

## Nachweis
`node werkzeug/alle-pruefungen.mjs m477 m487 m489 --wiederhole 10 --bahnen 4` mit Dauerlast-Prozessen daneben:

| Reihe | Last 9 | Last 17–22 |
|---|---|---|
| m477-gemeinsam-tippen | 10 von 10 | 10 von 10 |
| m487-gemeinsam-weiter (mit B12–B18) | 10 von 10 | 10 von 10 |
| m489-protokoll-neu | 10 von 10 | 10 von 10 |

Experiment (nur Abschnitt B, fünffach parallel, Last 20–28): vorher 2 von 20 Läufen mit verdoppeltem bzw. verlorenem
Text, danach 50 von 50 Runden richtig. Dazu grün: m364, m365, m366, m372, m377, m383, m483 und `--geaendert` (41 Reihen).

## Grenzen / offen
- Unterscheiden sich die **gespeicherten** Stände zweier Geräte wirklich (eine Änderung ist noch unterwegs) und
  öffnen beide im selben Augenblick, ohne dass einer die Frage des anderen rechtzeitig beantwortet, entstehen weiter
  zwei Anfänge (wie M477/M487, jetzt deutlich seltener: wer wartet, bekommt den Stand; wer kleiner ist, fängt an).
- Beschlüsse in einem Dokument, das ein Gerät mit älterer Fassung begann, laufen weiter über den Speicher.
- Hält jemand die Karte, während der Schreiber sichern will, wird erst bei der nächsten Änderung gesichert (keine
  Wiederholung im Takt).
- Ticket-Felder im Kanban liefen schon über Yjs (M487); unverändert.
