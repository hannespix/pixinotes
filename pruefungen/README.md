# Prüfreihen (E2E)

Ende-zu-Ende-Prüfungen der Meilensteine — jede Reihe startet einen lokalen
Server über `dist/`, fährt ein echtes Chromium und misst das Verhalten
(bis hin zu Bildpunkt-Helligkeiten). Sie liegen im Repository, damit sie
jede Umgebung überleben.

## Ausführen

```bash
npm run build                      # die Reihen prüfen den dist/-Stand
node pruefungen/m266-schatten.mjs  # eine einzelne Reihe
for f in pruefungen/m*.mjs; do node "$f" || break; done   # alle
```

Chromium: Standardpfad `/opt/pw-browsers/chromium` (Claude-Umgebung) —
anderswo per Umgebungsvariable `PW_CHROMIUM=/pfad/zu/chromium` setzen.
`playwright-core` kommt aus den normalen Abhängigkeiten (`npm ci`).

Screenshots und Zwischendateien landen in `pruefungen/ablage/`
(nicht eingecheckt).

## Reihen

| Reihe | Prüft |
|---|---|
| m265 | Zoom-Ansicht: Scrollen im vergrößerten Bild, Board-Zoom im Fokus |
| m266 | Kein Streifen-Schatten an der linken Leiste (Pixelmessung) |
| m267 | Textformatierung: Größen-Leiter, Aa-Menü, ein Ort, Kollisionsfreiheit |
| m268 | Anzeige-Skalierung 100/130/175 %: Verbinden, Ziehen, Menüs, Zeichnen |
| m269 | Dateien im Sync-Beipack · KI liest PDF-Text (abgefangene Anfrage) |
| m270 | Kalender: Jahresansicht · Outlook-Export ganzer Zeiträume (RFC 5545) |
| m271 | Gantt: Datumsfelder, klebende Monatsnamen, Einpassen, Namensspalte |
| m272 | Notiz-Termine fließen in den Kalender und den Export |
| m273 | Gantt-UI: klebende Kopfzeile, Balken-Namen, Zieh-Fahne, Doppelklick |
| m274 | Recherche: Rückfragen-Dialog, echte Quellen-Abrufe, Quellen im Prompt |
| m276 | KI liest Word, Excel, Text; Bild-Karten gehen an bildfähige Modelle |
| m277 | Formatier-Leiste am Telefon: angedockt statt über der Markierung |
| m278 | Websuche über den KI-Anbieter: Werkzeug, Quellen, Zeitüberschreitung |
| m279 | Gantt-Zeitskalen: Tage/Wochen/Monate/Jahre, Zeitanker, Quartale |
| m280 | Gantt: nichts abgeschnitten — Beschriftungen, Ränder, Verläufe |
| m281 | Gantt: Skalenwechsel greift zuverlässig (alle vier Stufen) |
| m282 | Gantt am Telefon: scrollbare Werkzeugleiste, 40-Punkt-Trefferflächen |
| m283 | Rechen-Tabelle in der Notiz: Formeln, Slash-Menü, ein Tabellentyp |
| m284 | Dunkelmodus: Kontraste in Rechen-Tabelle und hellen Notizen (WCAG) |
| m285 | Karten aus jeder Ansicht bearbeiten — ein Karten-Blatt, ein Rückweg |
| m287 | „Rahmen" ≠ „Bereich": Wortwahl, Rückfragen, Board-Umbenennen im Baum |
| m288 | Board- und Projekt-Menü: überall derselbe Vorrat, Archiv, Duplikate |
| m289 | Bilder in Notizen: einfügen, verkleinern, Chip am Telefon, Export |

Die Reihen sind bewusst GEGEN DAS VERHALTEN geschrieben, nicht gegen die
Struktur: Wo möglich messen sie Bildpunkte, echte Downloads, abgefangene
Netz-Anfragen — nicht bloß Klassennamen.
