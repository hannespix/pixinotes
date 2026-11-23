# M482 — Rechtschreibprüfung des Browsers in Karten und Modulen
PR: siehe Merge-Titel „… (M482)" · Prüfreihe: `pruefungen/m482-rechtschreibung.mjs` (Port 5482) · Datum: 2026-11-23

## Warum
Nutzerwunsch: „Was auch noch fehlt ist die Standard-Browser-Rechtschreibkorrektur in den Cards und Modulen!"

## Ursache
Abgeschaltet hat die App die Prüfung nirgends (einzige `spellCheck={false}`: Mermaid-Code und Link-Feld der
Tabelle; BlockNote, React Flow und `translate="no"` (M368) berühren sie nicht). Sie hat sie aber auch nirgends
**verlangt** — ob ein Feld geprüft wird, blieb der Voreinstellung des Browsers überlassen. Die ist uneinheitlich:
Firefox prüft einzeilige Felder (Ticket-Titel, Gantt-Vorgang, Kartentitel, Tabellenzelle, Kontakt-Name) von sich aus
gar nicht, Safari und Chromium je nach Feldart und Geräte-Einstellung; ohne Angabe an der Wurzel erbt ein Feld
nichts. Dazu fehlte die andere Hälfte: Formeln, Zahlen, Adressen bekamen Wellenlinien und Telefon-Autokorrektur.

## Was
- In jedem Feld für **freien Text** steht `spellcheck="true"` ausdrücklich, sobald man darin bearbeitet: Notiz,
  Ticket (Titel, Beschreibung, Person), Gantt-Vorgang, Tabellen-Textzelle, Protokoll, Form-Text (M435), Kontakt
  (Name, Funktion, Firma, Anschrift, Notiz), Kommentar, Kartentitel, Bubbles, Wochenplan … — jedes Eingabefeld der
  App, das nicht unter die Ausnahmen fällt.
- **Aus** (samt `autocorrect`/`autocapitalize="off"` für Telefon-Tastaturen): Formel- und Zahlenzellen (folgt beim
  Tippen: aus Text wird „=1+2" → aus), Mermaid-Code, Suchfelder (`type="search"` oder Beschriftung „Suchen …",
  „… durchsuchen", „search"), URL/E-Mail/Telefon (Typ, `inputMode` oder Beschriftung mit „://", Schlüssel/Token),
  Datum/Zeit/Zahl/Passwort/Farbe.
- **Einstellung** „Rechtschreibung prüfen" unter Einstellungen → Darstellung → Bedienung (Vorgabe an, je Gerät,
  `localStorage pixinotes-rechtschreibung`), kein neuer Knopf. Aus: überall aus, sofort und nach dem Neuladen.
- Ruhende Karten (M421, `NotizRuhend`, ruhende Formen) sind nicht bearbeitbar — dort zeichnet kein Browser
  Wellenlinien. Mobile Autokorrektur bleibt in freiem Text (auch Titel/Namen) unangetastet.

## Wie (Architektur)
- `src/lib/rechtschreibung.ts`, gestartet in `main.tsx` neben `initTelefonTastatur` (M386, gleiches Muster): die
  Wurzel `<html spellcheck>` gibt die Haltung vor (alles erbt sie); ein `focusin`-Lauscher (Capture) setzt am
  fokussierten Feld (`input`/`textarea`/Wurzel des bearbeitbaren Bereichs) das Attribut nach
  `pruefungGewuenscht(el)`; ein `input`-Lauscher führt Zellen mit `data-rechtschreibung="formel"` beim Tippen nach.
  Zentral statt Feld für Feld: neue Module sind ohne eigenes Zutun richtig.
- Markierung im Markup: `data-rechtschreibung="aus"` (Feld oder Vorfahre; Mermaid-Code in Karte und Vortrag,
  Link-Feld der Tabelle, Webseite im Kontakt) und `data-rechtschreibung="formel"` (`SheetCard`, `RechenTabelle`).
- Autokorrektur-Attribute werden nur dort zurückgenommen, wo die Datei sie selbst gesetzt hat (`data-rs-aus`).

## Grenzen
- Codeblöcke **innerhalb** einer Notiz werden mitgeprüft (Attribute in ProseMirror-Knoten würde der Editor beim
  Neuzeichnen verwerfen).
- Die Wellenlinie selbst ist headless nicht messbar; die Reihe prüft `el.spellcheck`/das Attribut im Bearbeiten.

## Prüfreihe
`m482-rechtschreibung`: A Felder für freien Text an (ausdrücklich), B Ausnahmen aus ohne Autokorrektur, C ruhende
Karten nicht bearbeitbar, D Einstellung aus (sofort, nach dem Neuladen, an allen Stellen) und wieder an.
