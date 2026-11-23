# M455 — Texte in Grafiken mehrsprachig
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m455-svg-sprache.mjs` (Port 5455) · Datum: 2026-11-23

## Warum
UMBAU Zeile 54 (M368, „Grenzen") nannte Texte, die die App selbst in SVG zeichnet, als Lücke der Mehrsprachigkeit.
Die Bestandsaufnahme (grep nach `<text` und `fillText`) ergab ein gemischtes Bild:
- Der Beobachter der englischen Oberfläche (M381) übersetzt auch Textknoten in SVG — „Heute" in der Gantt-Fahne
  wurde schon „Today". Aber er übersetzte genauso **Inhalte**: Ein Vorgang namens „Heute" oder ein Board namens
  „Wochen" wurde zu „Today" bzw. „Weeks", weil SVG-Texte kein `translate="no"` trugen.
- Zusammengesetzte Schilder kannte das Wörterbuch nicht: „KW 48" (zu wenig feste Buchstaben für ein Muster),
  „März 2026" im Kopf der Zeiterfassung, die Wochentags-Buchstaben der Kalender-Jahresansicht („Mo"[0] → „M D M
  D F S S" auch auf Englisch; ein Buchstabe ist für das Wörterbuch kein Text).
- Allgemeine Kartenbezeichnungen an den Punkten der Übersicht („Kalender (Monatsansicht)") blieben deutsch.

## Was
- Gantt: Kalenderwochen „Wk 48" statt „KW 48"; Monate über Intl (schon en-GB durch M381), Quartale/Jahre
  sprachneutral, Heute-Fahne „Today". Balken- und Rautennamen, Initialen und der Balken-Tooltip (Name: Datum →
  Datum) tragen `translate="no"` — der Abo-Hinweis im Tooltip bleibt Oberfläche und wird übersetzt.
- Kalender: Wochentags-Buchstaben der Jahresansicht über `Intl` (`weekday: 'narrow'`) → „M T W T F S S".
- Zeiterfassung: Wochenkopf „Wk 48 · …", Monatskopf „March 2026".
- Übersicht (Netz): Board-Namen, Bereichsnamen und Karten-Punkte (Titel und Beschriftung) tragen `translate="no"`;
  „· schläft" steht getrennt vom Bereichsnamen und wird allein übersetzt; allgemeine Kartenbezeichnungen laufen
  durch `kartenName()`.

## Wie (Architektur)
- `lib/sprache.ts`: `kwText(n)` — „KW n" / „Wk n". Gezeichnet **und gemessen** wird derselbe Text (Gantt misst
  Schilder mit `textBreite`, bevor es entscheidet, ob sie passen) — deshalb im Code statt im Beobachter.
- `lib/uebersetzung.ts`: `SVG_INHALT` (`{ translate: 'no' }` als Spread) — Reacts SVG-Typen kennen das Attribut
  nicht; Beobachter (M381) und Browser-Übersetzer (M368) suchen beide per `[translate="no"]`.
- `GanttCard.tsx`, `CalendarCard.tsx` (`wochentagBuchstaben()` erst beim Zeichnen, weil M381 die Datumsformate
  beim Start umstellt), `TimeCard.tsx`, `Overview.tsx`.
- `en.json`: „· schläft", „Abo aus Kanban: „{0}" fällig am {1}".

## Entscheidung: kein Weg der Browser-Übersetzung in SVG
SVG-Texte für den Übersetzer des Browsers erreichbar zu machen ist nicht nötig: Die von der App erzeugten Texte
kommen jetzt in der Sprache der Oberfläche (eingebautes Englisch), Inhalte sind ausgenommen. Wer eine dritte
Sprache über den Browser übersetzt, bekommt Schilder wie „Nov 26" oder „Wk 48" — kurz und ohne Satzbau, das ist
hinnehmbar. Die Bild-Ausfuhr (`lib/exporter.ts`, Kopfzeile mit `fillText`/SVG-`<text>`) enthält nur Board-Name und
Datum; das Datum folgt bereits der Sprache (en-GB-Umstellung).

## Grenzen / offen
- Mermaid-Diagramme sind Inhalt der Nutzer (schon `translate="no"`, M368); deren eigene Schlüsselwörter (Gantt-
  Achsen von mermaid) formatiert mermaid selbst.
- Die Hierarchie-Ansicht der Übersicht schreibt „1 cards" (Mehrzahl-Regel des Beobachters) — HTML, nicht Teil
  dieses Meilensteins.
