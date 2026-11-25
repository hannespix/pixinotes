# M539 — Kein Ruckler mehr, wenn das Nachladen nach dem Start in einen Zug fällt
PR: siehe Merge-Titel „… (M539)" · Prüfreihe: `pruefungen/m491-kanten-60fps.mjs` (neu T3, Port 5491) · Datum: 2026-11-25

## Warum
Aus M536: `m491` war auf dem Hauptzweig rot — T2 (`{"mit":2,"ohne":2}` Stil-Rechnungen über das ganze Dokument im
Zug, erlaubt eine), dazu zeitweise L2. Offen war, ob ein jüngerer Merge (M527, M535, M530 …) das Ziehen wieder
verlangsamt hat oder nur die Maschine ausgelastet war.

## Befund
**Echter Rückschritt, kein Lastproblem.** T2 zählt Ereignisse im Chromium-Trace (Thread-Zeit, keine Uhr) und war auf
jedem Build gleich: alt 0–1, neu 1–2 in jedem Lauf. Suche über die Merge-Commits seit `8cc9bd6` (je Build 2–3 Läufe,
nur `M491_NUR=T`):

| Build | Stil über > 1000 Elemente (ohne / mit Verbindungen) | T2 |
|---|---|---|
| `8cc9bd6` (Ausgang) | 1 / 1, 1 / 0 | grün |
| `dd91cbb` M527 | 1 / 1 (3×) | grün |
| `6514ed1` M530 | 1 / 1 (2×) | grün |
| `293f062` M529 | 1 / 1 (2×) | grün |
| `1f7bd8a` **M534** | 2 / 2, 2 / 1, 2 / 2 | **rot** |
| `e285316` Hauptzweig | 2 / 1, 2 / 2 | rot |
| dieser Zweig | 0 / 0 (5×) | grün |

Ursache (Trace mit `invalidationTracking` und Aufrufstapeln, Skript im Scratch-Ordner): Die zweite Stil-Rechnung über
alle gut 7 000 Elemente hatte den Grund „Affected by :has()" an `html`, ausgelöst von `appendChild` im Vorlade-Helfer
von Vite — **jedes `import()` hängt `<link rel="modulepreload">` in den Kopf**, Chromium prüft das gegen alle
`:has()`-Regeln mit Subjekt `html` (z. B. BlockNotes `.bn-suggestion-node:has(.bn-block-content) > *`) und rechnet den
ganzen Baum neu (gut 40 ms, ein Ruckler). Die App lädt 4 s nach dem Start von selbst nach: Vorladen im Leerlauf (M446,
rund 80 Links), Texterkennung (M502), Sicherung (6 s). M534 kam mit `window.setTimeout(verlaufLaden, 4000)` dazu
(Zurück-Taste, `lib/verlauf.ts`) — ein festes Zeitglied ohne Leerlauf-Bedingung, das die Kette der Ladevorgänge zuverlässig
in den Zug der Reihe legte (die Reihe zieht 3–5 s nach dem Laden). Für Nutzer: Wer in den ersten Sekunden nach dem
Start eine Karte zog, bekam einen Ruckler; das gab es vereinzelt schon vorher (das Vorladen wartete nur auf einen
Leerlauf-Moment, und den gibt es auch zwischen zwei Mausbewegungen), seit M534 regelmäßig.

L2 (Maus → Bild) war in den Läufen dieses Meilensteins grün; die roten L2 aus M536 waren Last (die Reihe rechnet ihre
Grenze bei ausgelasteter Maschine um, M518) — ein einzelner Ruckler hebt den Median von 50 Bewegungen nicht.

## Was / Wie
- `lib/zugAnzeige.ts → ausserhalbZug(f)`: läuft gerade ein Zug, kommt `f` 0,4 s nach dem Ablegen (`nachZug`), sonst
  sofort. Regel aus M491 erweitert: **auch Nachladen hängt etwas ins DOM** (Links in den Kopf).
- `App.tsx`: Vorladen im Leerlauf, Zurück-Taste, Texterkennung und Sicherung starten über `ausserhalbZug`. Was ein
  Druck selbst braucht (z. B. `lib/stricheLoesen` beim Herunterdrücken, das Zieh-Gefühl), lädt weiter sofort — das
  geschieht vor dem Zug, nicht mitten darin.
- Die Funktion der Meilensteine bleibt: Alles wird weiter vorgeladen, nur nicht während eines Zugs.

## Prüfreihe
`m491` neu **T3**: Zug über den Zeitpunkt des Nachladens (vom 3. bis zur 6,5. Sekunde nach dem Laden, Beobachter am
`<head>`): im Zug kommt nichts in den Kopf, nach dem Ablegen schon (Vorladen findet statt). Gegen den Hauptzweig vorher
rot (`imZug: 73`, erst `verlauf-….js`, dann Kanban, Shape …), jetzt grün. Ist der Start unter Last zu langsam (der
Zeitpunkt läge vor dem Zug), lädt die Reihe die Seite neu (höchstens dreimal).

## Grenzen / offen
- Layerize je Bild liegt auf dieser Maschine inzwischen bei rund 5 ms auch ohne Verbindungen (M491 maß 0,9 ms) — auf
  allen Builds seit `8cc9bd6` gleich, also kein Rückschritt der App (anderer Chromium-Build bzw. Software-Rendern);
  T1 vergleicht relativ und bleibt grün.
- Ein Ladevorgang, der vor dem Zug beginnt und dessen Module beim Eintreffen selbst weiter nachladen, kann noch in einen
  Zug fallen; nicht beobachtet.
