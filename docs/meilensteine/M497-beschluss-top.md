# M497 — Protokoll: Beschlüsse gehören zu ihrem TOP
PR: siehe Merge-Titel „… (M497)" · Prüfreihe: `pruefungen/m497-beschluss-top.mjs` (Port 5497) · Datum: 2026-11-23

## Warum
M495 ließ zwei Punkte offen: Ob ein TOP „ohne Beschluss" ist, entschied eine Wortregel (ein Beschluss nennt ein Wort
des TOPs ab vier Buchstaben) — reine Informations-TOPs und Beschlüsse in eigenen Worten („Wir feiern am 12. Juli" unter
„Sommerfest") landeten fälschlich in der Übergabe. Und abgelehnte Personen-Vorschläge galten nur, solange die Karte offen
war.

## Was (Nutzersicht)
- **§ Beschluss** merkt sich den TOP, unter dem die Zeile stand (vor dem ersten TOP: ohne TOP).
- In der Beschluss-Liste steht rechts in jeder Zeile eine ruhige Auswahl mit dem TOP — ändern, oder „ohne TOP"
  lösen. Ohne Zuordnung ist sie nur im Fokus sichtbar (M421), eine gesetzte bleibt als Inhalt stehen.
- Ein im Feld getippter Beschluss, der genau einen TOP nennt, gehört gleich dazu (änderbar).
- Unter den Beschlüssen: **„Ohne Beschluss: TOP 1 [nur Info] · TOP 3 [nur Info]"** — nur im Fokus. „nur Info" markiert
  einen TOP als reine Information; er kommt nie in die Übergabe. Noch einmal klicken nimmt es zurück.
- **＋** schlägt nur TOPs vor, zu denen kein Beschluss gehört und die nicht „nur Info" sind.
- Die **Übersicht** nennt beim Beschluss seinen TOP.
- **Personen:** „Mia zur Runde hinzufügen?" → × merkt sich die Reihe dauerhaft (auch nach dem Neuladen, auf allen
  Geräten). Kommt Mia später über „+ Person" oder „Hinzufügen" doch in die Runde, fällt sie aus der Liste; wird sie wieder
  entfernt, fragt die Karte wieder.
- Im Live-Board läuft alles über das gemeinsame Dokument: Zuordnung und „nur Info" kommen beim anderen an.

## Wie (Architektur)
- **Datenmodell** (`types.ts`, alles optional, keine Migration):
  - `MinutesEntry.decisions[].top` — Kennung der Überschrift (Block-`id`), sonst `text:<suchNorm(Text)>`; `''` = bewusst
    ohne TOP. `decisions[].topText` — Text der Überschrift bei der Zuordnung (Rückfall: Die Kennung fehlt, solange eine
    neue Sitzung nie im Editor stand, und ist allein im Speicher manchmal eine andere als im Editor). Fehlen beide
    (ältere Beschlüsse, KI, `kiModule`), gilt weiter die Wortregel von M495.
  - `MinutesEntry.infoTops?: string[]` — Schlüssel wie `top` (Kennung oder `text:…`).
  - `MinutesData.personenAbgelehnt?: string[]` — klein geschriebene Namen, je Reihe.
  - Keine Zeit-/Merkfelder → nichts für `lib/abgleichZeiten.ts`. Der Abgleich (`syncMerge`, Patches) vergleicht und
    trägt Kartendaten als JSON; unbekannte Felder bleiben erhalten. Ältere App-Fassungen lesen und schreiben die Einträge
    mit Spread (`{ ...x, text }`) — sie lassen die Felder im Speicher stehen (Ausnahme: siehe Grenzen).
- `lib/protokollSchliff.ts` (nachgeladen, nicht im Start): `topsDerSitzung`, `topDesBeschlusses` (Kennung → `text:` →
  `topText`), `hatZuordnung`, `istInfoTop`, `infoSchluessel`, `topSchluessel`, `topVor` (Überschrift vor einem Block,
  Lesereihenfolge), `topRaten` (Wortregel, nur bei genau einem Treffer), `topStand` (`beschluss` | `info` | `offen` je TOP,
  ohne feste Tagesordnung und Übergabe-Überschrift), `offeneTops` = `topStand(…).offen` der letzten Sitzung,
  `beschlusslage` (Übersicht, mit TOP).
- `lib/notizGemeinsamKern.ts` (`protokollOeffnen`, klein gehalten): Y.Map `beschluesse` trägt je Beschluss zusätzlich
  `top`/`topText`; neue Y.Map `infoTops` (Schlüssel → true) mit Marke `pn.tops`. Zuordnung und Info-TOPs gehen nur dann
  in die Kennung des deterministischen Anfangs, wenn es sie gibt — sonst ist der Anfang derselbe wie in M493 (gleiche
  Kennung = gleicher Inhalt, auch mit Geräten der älteren Fassung). `beschlussSetzen` behält beim Textändern alle übrigen
  Felder (`{ ...alt, text }`), neu `beschlussZuordnen`, `beschlussDazu(text, top?)`, `infoTops()`, `infoTopSetzen()`; die
  erste eigene Info-Änderung in einem Dokument ohne Marke übernimmt den Speicherstand und setzt die Marke. Der Schreiber
  sichert `infoTops` mit (nur mit Marke). `protokollHaken(…, infoTops)` reicht sie für den Anfang durch.
- `lib/protokollLive.ts`: `Beschluss` mit `top?`/`topText?`, Typ `TopZuordnung`, Schnittstelle um die drei Methoden
  erweitert; `beiBeschluessen` meldet auch Info-Änderungen.
- `store/schutz.ts` `mitTextVon`: `infoTops` geht wie `blocks`/`decisions` durch, solange gemeinsam getippt wird.
- `components/nodes/MinutesCard.tsx`: `infoListe`, `sitzungsTops`, `topStaende` (aus dem Y-Dokument, wenn live);
  `alsBeschluss` mit `topVor(ed.document, b.id)`; `addDecision` mit `topRaten`; Auswahl `.pr-beschluss-top`
  (`.leer` ohne Zuordnung), Zeile `.pr-top-stand` mit `.pr-info-knopf` (`aria-pressed`); Übersicht `.pr-beschluss-zu`.
  Personen: `personenAbgelehnt` + lokaler Satz (hält den Vorschlag auch weg, wenn der Kartenschutz die Änderung gerade
  zurücknimmt); `personDazu` streicht hinzugefügte Namen. `ProtokollGemeinsam.tsx` und `TaskHub.tsx` reichen
  `infoTops` an den Kern.
- CSS in `styles/52-phone-termine-protokoll.css` (Ränder `--pr-muted` gestrichelt, ≥ 3:1), `.pr-top-stand` und
  `.pr-beschluss-top.leer` in den drei M421-Listen und „nur Inhalt" (`72-…`). Hilfe DE/EN („Was ist neu", Abschnitt
  Protokoll-Reihe), `src/sprache/en.json` (9 Texte).

## Prüfreihe
A allein: § Beschluss unter TOP 2 („Wir feiern …", ohne Wort des TOPs) speichert `top`/`topText` und zeigt TOP 2 · ändern
und zurück · getippter Beschluss „Der Haushalt …" → TOP 1, „ohne TOP" löst (`top: ''`) · Liste „Ohne Beschluss" (TOP 1,
TOP 3) · „nur Info" für TOP 3 · nach Neuladen alles da · Übergabe nur TOP 1 · „nur Info" zurück → TOP 3 wieder in der
Übergabe · Übersicht nennt den TOP · Ruhe: Liste und leere Auswahl ausgeblendet, gewählter TOP sichtbar · P abgelehnte
Person bleibt nach Neuladen weg, „+ Person" streicht sie, wieder entfernt → Frage kommt zurück · K Kontraste
hell/dunkel auf Weiß und Gelb (Schrift ≥ 4,5:1, Ränder ≥ 3:1) · L Live-Board (Gerüst aus m487): Gerds § Beschluss kommt
mit TOP bei Anna an, Server; Annas Umordnung und ihr „nur Info" kommen bei Gerd an, Server und Gerds Speicher · keine
Seitenfehler.

## Grenzen / offen
- Ist im Live-Board ein Gerät mit der Fassung vor M497 der Schreiber der Sitzung, sichert es die Beschlüsse ohne
  `top`/`topText` (es kennt die Felder in der Y.Map nicht) und keine Info-TOPs — die Zuordnung ginge dort verloren.
  Fassungen gleichen sich über das Neuladen der Web-App schnell an.
- Beginnen zwei Geräte verschiedener Fassung eine Sitzung, die schon Zuordnungen trägt, zur selben Zeit, unterscheiden
  sich ihre Anfänge (wie jede Abweichung im Anfang, M493). Ohne Zuordnungen ist der Anfang unverändert.
- `personenAbgelehnt` geht wie die Runde über den Speicher, nicht über das Y-Dokument (die Runde lag nie dort, M495).
  Tippt gerade ein anderer gemeinsam in der Karte, nimmt der Kartenschutz die Änderung zurück — der Vorschlag bleibt
  für diesen Besuch trotzdem weg (lokaler Satz), dauerhaft gemerkt ist er dann aber nicht.
- Die Ausgaben (Markdown, HTML/Druck, Mail) nennen die Zuordnung noch nicht.
