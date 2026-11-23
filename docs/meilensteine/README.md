# Meilensteine ab M442

Bis M441 stehen die Architektur-Notizen als Zeilen in der Etappen-Tabelle von
`docs/UMBAU.md` §4. Ab M442 bekommt **jeder Meilenstein eine eigene Datei**
`MNNN-kurzname.md` — so kollidieren parallel arbeitende Agenten nicht in einer
Tabelle.

## Vorlage
```markdown
# MNNN — Titel (was der Nutzer merkt)
PR: #… · Prüfreihe: `pruefungen/mNNN-….mjs` · Datum: JJJJ-MM-TT

## Warum
Auslöser (Nutzerwunsch, Fehler, Audit-Befund).

## Was
- Verhalten aus Nutzersicht.

## Wie (Architektur)
Dateien, Funktionen, Datenfelder, Speicher-Schlüssel — so, dass ein späterer
Agent per `grep` hierher findet.

## Grenzen / offen
Was bewusst nicht gemacht wurde und warum.
```
