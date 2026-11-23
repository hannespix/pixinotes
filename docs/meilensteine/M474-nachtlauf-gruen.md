# M474 — Nachtlauf grün
PR: siehe Merge-Commit · Prüfreihen: m268, m382 (geändert), m299, m314, m398 (unverändert) · Datum: 2026-11-23

## Warum
Der erste Nachtlauf (Run 45151709744, Issue #154 „Nachtlauf rot") meldete fünf Reihen, die auch allein rot
waren. Der Lauf prüfte den Stand `d1ba53f`; bis heute Mittag kamen auf dem Hauptzweig M448 (#150) und die
selbstsortierende „Was ist neu"-Liste (#158) dazu. Jede Reihe wurde lokal gegen den neuen Stand und, wo der
Runner anders war, unter nachgestellten Runner-Bedingungen geprüft.

## Je Reihe: Ursache und Entscheidung
| Reihe | Befund im Runner | Ursache | Entscheidung |
|---|---|---|---|
| m268 | [175 %] ⋯-Menü 624 px „vom" Knopf | **App-Fehler**, auch lokal rot. Das Kartenmenü ist mit den Meilensteinen auf ~370 Layout-Punkte gewachsen; bei 175 % passt es unter dem Knopf nicht mehr ganz (325 frei). Die Korrektur aus M350 („ragt unten heraus → nach oben schieben") schob es dann auf den eigenen Knopf (Unterkante 624 px unter dessen Oberkante). | `SelectionToolbar.tsx`: am Knopf nach unten geöffnet und mindestens 160 Punkte frei → bleibt am Knopf und rollt (`max-height` = Platz darunter). Am Zeiger (Rechtsklick, M350) oder ohne Platz wie bisher. Reihe unverändert. |
| m299 | B8: Hilfe-Punkt „Outlook live" (M466) über 420 Zeichen | War schon behoben: M448 (#150) hat den Punkt in „Outlook live" und „Outlook: nur lesen, mit Terminen" geteilt – lief nach dem Start des Nachtlaufs ein. Die zwischenzeitlich rote Reihenfolge (C2/C3) ordnet #158 (`NeuesteZuerst.tsx`). | Nichts zu tun; lokal 24/24 grün. |
| m314 | D1: Dienste-Liste enthält „Text in Bildern" | Bewusst geänderte Oberfläche (M452: Texterkennung an/aus im Reiter Dienste); M448 (#150) hat die Reihe schon nachgezogen (fünf Abschnitte). | Nichts zu tun; lokal 20/20 grün. |
| m382 | E1: neue Karten tragen englische Standardnamen – im Ergebnis fehlte die Kanban-Karte ganz | **Nur im Runner**: kein App-Fehler (lokal heißt sie „New board"). Der Store schreibt gebündelt 400 ms nach der letzten Änderung; die Reihe las localStorage nach festen Pausen von 700 ms, auf dem langsameren Runner war die zuletzt angelegte Karte noch nicht geschrieben. Nachgestellt mit 6-facher CPU-Drosselung (CDP `Emulation.setCPUThrottlingRate`): lokal genau derselbe Befund. | Reihe robust gemacht: wartet (bis 8 s), bis die Kanban-Karte gespeichert ist, statt sofort zu lesen; Grenzen und Erwartung unverändert. Mit Drosselung grün (Wartezeit 169 ms). |
| m398 | A8/C6/E6/F3: Lösch-Meldungen samt „Rückgängig" | Bewusst geänderte Oberfläche (M461: „3 Boards" statt „3 Board(s)"); M448 (#150) hat die Erwartungen schon angepasst. | Nichts zu tun; lokal 48/48 grün. |

## Grenzen / offen
- Runner-Unterschiede, die hier auffielen: geringere Rechenleistung (Zeitfenster um Debounces). Schriften
  spielten bei diesen fünf Reihen keine Rolle.
- Reihen, die nach festen Pausen localStorage lesen, gibt es weitere; sie fallen erst auf, wenn der Runner sie
  trifft. Muster für die Behebung: `waitForFunction` auf den erwarteten gespeicherten Zustand (wie m382 E1).
