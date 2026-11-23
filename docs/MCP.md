# PixiNotes als MCP-Server (M443)

KI-Programme auf dem eigenen Rechner – Claude Desktop, Claude Code, Cursor, VS Code und alle anderen, die das
[Model Context Protocol](https://modelcontextprotocol.io) sprechen – legen damit Boards an, lesen und füllen sie.
Alle Module sind dabei: Notiz (Markdown), Kanban, Zeitplan (Gantt), Rechen-Tabelle mit Formeln, Wochenplaner,
Protokoll, Zeiterfassung, Ideen-Bubbles, Diagramm (Mermaid), Kontakt (seit M454), Ablauf-Formen, Rahmen und Pfeile.

## Einrichten

1. `pixinotes-mcp.mjs` laden: in der App unter **Einstellungen → Dienste → KI-Assistent → KI-Programme von außen (MCP)**
   oder direkt von <https://hannespix.github.io/pixinotes/pixinotes-mcp.mjs>. Eine Datei, keine Installation;
   gebraucht wird nur Node.js 18 oder neuer.
2. Im KI-Programm als MCP-Server eintragen (Claude Desktop: `claude_desktop_config.json`, Cursor: `mcp.json`):

```json
{
  "mcpServers": {
    "pixinotes": {
      "command": "node",
      "args": ["/Pfad/zu/pixinotes-mcp.mjs", "--ordner", "/Pfad/zum/Sync-Ordner"]
    }
  }
}
```

   Claude Code: `claude mcp add pixinotes -- node /Pfad/zu/pixinotes-mcp.mjs --ordner /Pfad/zum/Sync-Ordner`

### Wohin der Server schreibt

| Weg | Aufruf | Wie die App es bekommt |
| --- | --- | --- |
| Sync-Ordner (empfohlen) | `--ordner <Ordner>` oder `PIXINOTES_ORDNER` | Die Datei `pixinotes-daten.json`, die PixiNotes im Sync-Ordner führt (Einstellungen → Daten → Synchronisation → Ordner). Die App bemerkt die Änderung von allein und führt sie per Drei-Wege-Abgleich mit dem zusammen, was du inzwischen getippt hast. Über Nextcloud, Dropbox oder OneDrive kommt sie auch auf die anderen Geräte. |
| Einzelne Datei | `--datei <pixinotes-daten.json>` | Wie oben, für eine Sicherung, die du später per „Stand laden…" öffnest. |
| PixiNotes-Konto | `--konto` mit `PIXINOTES_EMAIL` und `PIXINOTES_PASSWORT` in `env` | Dieselbe Ablage wie die App; geöffnete Apps laden das geänderte Board nach. Braucht ein Konto mit Passwort. |

Schreibt die App (oder ein anderes Gerät) zwischen Lesen und Schreiben, liest der Server neu und wiederholt seine
Änderung auf dem frischen Stand – es geht nichts verloren.

## Werkzeuge

| Werkzeug | Zweck |
| --- | --- |
| `pixinotes_uebersicht` | Bereiche → Projekte → Boards mit Kennung, Kartenzahl und Modularten |
| `pixinotes_board_lesen` | Inhalt eines Boards: jede Karte mit Kennung, Art, Lage und Inhalt (Tabellen mit Zellen, Formeln und Ergebnissen, Kanban mit Tickets, Zeitplan mit Vorgängen …) und die Pfeile |
| `pixinotes_board_anlegen` | Neues Board, optional in Bereich und Projekt (werden angelegt, wenn nötig) |
| `pixinotes_bearbeiten` | Eine Liste von Operationen in einem Zug: Karten und Module anlegen, füllen, ändern, verschieben, verbinden, löschen |
| `pixinotes_board_umbenennen` | Board umbenennen |

Die Operationen sind dieselben, mit denen der KI-Assistent in der App arbeitet (`src/lib/kiPlan.ts`, `src/lib/kiModule.ts`);
das Bearbeiten-Werkzeug beschreibt sie dem Modell vollständig. Beispiele:

```json
[
  { "op": "note", "title": "Ziel", "text": "**Launch** im März\n- [ ] Landingpage\n- [x] Domain" },
  { "op": "kanban", "title": "Aufgaben", "columns": ["Offen", "In Arbeit", "Erledigt"], "items": [{ "text": "Texte schreiben", "who": "Anna" }, { "text": "Bilder", "column": "In Arbeit" }] },
  { "op": "sheet", "title": "Budget", "rows": [["Posten", "Betrag"], ["Ads", "1200"], ["Design", "800"], ["Summe", "=SUMME(B2:B3)"]] },
  { "op": "edge", "source": "<Kennung>", "target": "<Kennung>", "label": "Kosten" }
]
```

### Kontakte (M454)

`kontakt` legt eine Kontakt-Karte an, `edit_kontakt` ändert eine vorhandene über ihre Kennung aus
`pixinotes_board_lesen`. Felder: `name`, `funktion`, `firma`, `telefone` (Liste aus `{ "nummer", "art" }` oder
einfachen Nummern), `emails`, `adresse` (Zeilen mit `\n`), `web`, `notiz`. Bei `edit_kontakt` ändern sich nur die
genannten Felder; `telefone` und `emails` ersetzen die ganze Liste, `""` leert einen Wert. Ein Foto nimmt der Server
nicht an. In der App gehen die Karten als vCard (.vcf) hinaus – einzeln oder mehrere in einer Datei.

```json
[
  { "op": "kontakt", "name": "Clara Brandt", "funktion": "Ausbildungsberaterin", "firma": "Landratsamt", "telefone": [{ "nummer": "0761 2187-0", "art": "Dienstlich" }], "emails": ["clara.brandt@example.de"] },
  { "op": "edit_kontakt", "id": "<Kennung>", "telefone": [{ "nummer": "0761 208-9999", "art": "Dienstlich" }] }
]
```

## Bauen

`npm run build:mcp` erzeugt `release/pixinotes-mcp.mjs` (esbuild, eine Datei). Die Modul-Logik kommt unverändert aus
`src/`; nur `src/store.ts` wird durch den schlanken Speicher `mcp/storeShim.ts` ersetzt. Der Deploy legt die Datei
neben die App. Prüfung: `node pruefungen/m443-mcp.mjs` (Server über stdio, alle Module, und Ende zu Ende mit der App
am Sync-Ordner).
