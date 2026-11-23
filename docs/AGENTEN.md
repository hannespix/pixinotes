# Mehrere Agenten parallel — Arbeitsweise

Ziel: maximale Entwicklungsgeschwindigkeit bei wenig Tokens. Ein
**Orchestrator** (Haupt-Agent) schneidet Aufgaben, vergibt Meilenstein-Nummern
und startet je Aufgabe einen **Arbeits-Agenten** in einem eigenen Git-Worktree.
Jeder Arbeits-Agent liefert selbstständig bis zum Merge.

## Rollen
| Rolle | Tut | Tut nicht |
|---|---|---|
| Orchestrator | Backlog lesen (`docs/BACKLOG.md`, Nutzerwunsch), Aufgaben mit **wenig Datei-Überschneidung** schneiden, Nummern vergeben, Agenten starten, Ergebnisse prüfen, Backlog/Doku nachführen | selbst Feature-Code schreiben, Dateien der Agenten lesen |
| Arbeits-Agent | eine Aufgabe von Code bis Merge (siehe CLAUDE.md §5) | fremde Branches anfassen, `release/pixinotes.html` committen, Etappen-Tabelle in UMBAU.md erweitern |

## Regeln gegen Konflikte
1. **Eine Nummer, ein Branch, ein PR, eine Datei in `docs/meilensteine/`.**
2. **Ports:** Die Prüfreihe von Meilenstein N lauscht auf **5000 + N**
   (M444 → 5444; zwei Server → 5444 und 6444). Alte Reihen nutzen 4431–4776.
3. **CSS:** neue Regeln nicht ans Ende von `index.css` hängen, sondern an den
   thematisch passenden Abschnitt (oder in den Block des Moduls) — das Ende
   ist der Konflikt-Hotspot. Ausnahme: die drei Listen „Bedienung nur im
   Fokus".
4. **Gebaute Dateien** (`release/pixinotes.html`, `dist/`) nie committen —
   `release.yml` erledigt das nach dem Merge.
5. **Vor dem Merge** den Hauptzweig einmischen, bauen, die eigene Reihe noch
   einmal laufen lassen. Bei Konflikt in Hilfe-/Sprachdateien: beide Seiten
   behalten.
6. Merge-Methode: **Squash**, Titel `Betreff (MNNN) (#PR)`.
7. **Erst mergen, wenn „PR prüfen“ für den Head-Commit grün ist**
   (`mcp__github__actions_list`, `resource_id: pruefen.yml`, ~1 min). In
   Runde 1 mergten zwei Agenten, bevor der Lauf überhaupt startete.

## Brief für einen Arbeits-Agenten (Vorlage)
```
Repo /home/user/pixinotes (Worktree). Lies CLAUDE.md und docs/AGENTEN.md.
Meilenstein: M<N> — <Thema>. Branch: claude/m<N>-<kurz>.
Ziel: <was der Nutzer merkt>. Bereits ausgeschlossen: <…>.
Fertig heißt: Build grün, Prüfreihe pruefungen/m<N>-<kurz>.mjs (Port 5<N>)
grün, betroffene alte Reihen grün, docs/meilensteine/M<N>-<kurz>.md,
PR auf claude/notes-whiteboard-design-bnwvxj, selbst gemergt (squash).
Rückmeldung: 5 Zeilen — PR-Link, was geändert, was offen.
```

## Token sparen
- Agenten lesen gezielt (`grep -n`, `sed -n a,bp`), nie ganze 8 000-Zeilen-
  Dateien.
- `docs/UMBAU.md` nur per `grep` nach dem betroffenen Dateinamen befragen.
- Prüfreihen nur für den eigenen Bereich laufen lassen
  (`node werkzeug/alle-pruefungen.mjs m29 m44`), die volle Reihe läuft
  nachts bzw. auf Wunsch.
- Rückmeldungen kurz halten; Details gehören in die Meilenstein-Datei.
