# M463 — Nachschärfen der Runde 1 (offene Punkte aus M444, M445, M453, M457)
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m463-nachschaerfen.mjs` (Port 5463) · Datum: 2026-11-23

## Warum
Die Meilenstein-Dateien der ersten Runde paralleler Agenten nannten unter „Grenzen / offen" kleine Lücken, die
zusammen einen Meilenstein ergeben: ein „Pin" gegen das Themen-Ordnen (M445), Kontakte über den Namen erkennen
und das Angebot nach dem Destillat (M457), Wege ohne Zeitstempel und die Zeit im Kontextmenü (M453), eine
Risiko-Liste ohne KI, die mehr als ein Wortmuster ist (M444).

## Was
- **(a) Nicht mit ordnen (M445):** ⋯ der Karte (auch Rechtsklick) → „Nicht mit ordnen" / „Wieder mit ordnen".
  „Nach Themen ordnen" lässt solche Karten liegen – auch in einer Auswahl, und sie gehen nicht an die KI. Im Fokus
  steht dezent „· ordnet nicht mit" in der Unterzeile; die Meldung nach dem Ordnen nennt die Zahl. EIN Schritt im
  Verlauf, kein Stempel „geändert" (Lage, nicht Inhalt). Bewusst kein nächtliches Auto-Aufräumen.
- **(b) Kontakt über den Namen (M457):** Findet „Absender als Kontakt" keinen Kontakt mit derselben Adresse, sucht
  es einen mit demselben **Namen** (klein, ä = ae, ß = ss, ohne Akzente, ohne Anreden/Titel, Wortreihenfolge egal:
  „Berg, Anna" = „Dr. Anna Berg" = „ANNA BERG"; mindestens zwei Namensteile). Dann wird ergänzt statt doppelt
  angelegt, und eine andere Adresse kommt als **weitere E-Mail** dazu. Ähnliche Namen („Anna Bergmann") zählen nicht.
- **(b) Nach dem Destillat (M451):** Die Mail bietet nach dem Destillat „Absender als Kontakt" an (Zeile unter den
  Mail-Aktionen) – derselbe Aufruf wie im ⋯ (`absenderAlsKontakt`), kein zweiter Weg. Das Angebot verschwindet, sobald
  ein Kontakt per Pfeil an der Mail hängt.
- **(c) Zeit auf allen Wegen (M453):** „Bild bearbeiten" (`bildErsetzen`), das Rückgängig im Notiz-Editor
  (`textRueckgaengig`) und der MCP-Server (`mcp/storeShim.ts`: `addNode` → `frisch`, `updateNodeData` → `nachPatch`)
  stempeln jetzt. Der Destillat-Merker an der Mail (`data.destillat`) zählt dagegen als Ansicht (`ANSICHT` in
  `lib/kartenZeit.ts`) – die Mail selbst bleibt unverändert, das Briefing sieht die Destillat-Notiz als Folge.
  KI-Pläne (`kiPlan.ts`, `kiModule.ts`) und die Destillat-Checkliste liefen schon über `addNode`/`updateNodeData`.
- **(c) Zeit im Kontextmenü:** ganz unten im ⋯ einer einzelnen Karte eine leise Zeile „Geändert vor 3 Tagen"
  (genaue Zeit im Tooltip) bzw. „Änderung unbekannt" – ein `div`, kein Knopf.
- **(d) Briefing-Risiken ohne KI (M444):** vor den Wortmustern stehen jetzt Befunde aus der Struktur des Boards:
  überfällige Fristen mit Namen und Dauer („Frist seit 5 Tagen überschritten: …", höchstens drei, älteste zuerst),
  Tickets in den mittleren Kanban-Spalten einer Karte, die seit 14 Tagen niemand geändert hat („Seit 20 Tagen in
  „In Arbeit": …"), und Pfeile, deren Beziehungsname blockiert („blockiert", „wartet auf", „hängt an", „abhängig",
  „blocks", „depends on" …) als „„A" blockiert „B"". Mit KI gehen die Befunde als Fakten an das Modell.

## Wie (Architektur)
- `src/types.ts`: `ohneOrdnen?: boolean` auf Node-Ebene (wie `archived`, nicht in `data` → kein Zeitstempel).
- `src/lib/ohneOrdnen.ts` (nachgeladen): `ohneOrdnenSetzen(ids, an)` – `pushHistory` + ein `setState`; bewusst nicht
  in `store.ts` (Hotspot). `themenOrdnen.ts`: `themenKandidaten` filtert, `ausgenommenZahl` für die Meldung.
- `SelectionToolbar.tsx`: Eintrag `data-taste="ohne-ordnen"` im Abschnitt „Aufräumen"; Zeitzeile `.sel-menu-zeit`
  (`data-zeit`) als letztes Kind des ⋯ (CSS beim `.sel-attr-hint`). `FocusSheet.tsx`: `.focus-ohne-ordnen`.
- `kontaktAusMail.ts`: `personSchluessel(name)`, `kontaktMitNamen`, `kontaktErgaenzen(alt, neu, { weitereEmails })`.
  (Der Name `nameNormal` war in der Datei schon für die Signatur-Heuristik vergeben.)
- `EmailCard.tsx`: `kontaktAngeboten` (Destillat-Notiz da, kein Kontakt per Pfeil, Absender bekannt), Knopf
  `data-taste="kontakt-nach-destillat"` – bewusst NICHT `destillat-…`, weil m451 diese Knöpfe zählt.
- `boardBriefing.ts`: `BoardLage.befunde`, `befundeSammeln`, `IN_ARBEIT_TAGE` 14, `BLOCKIERT`. Tickets haben keine
  eigene Zeit – maßgeblich ist die Änderungszeit der Kanban-Karte (jedes Verschieben stempelt sie); Kanbans mit
  Auto-Einsammeln zählen nicht (ihre Tickets sind Kopien).
- Zähl-Texte über `zahlWort` (M461).

## Grenzen / offen
- „In Arbeit" misst die Karte, nicht das einzelne Ticket: wer in derselben Kanban-Karte irgendein Ticket bewegt,
  setzt die Uhr für alle zurück.
- Gleichnamige verschiedene Personen werden zusammengelegt (ergänzt, nichts überschrieben); Unterscheidung nur über
  die Adresse. Ein Vorname allein reicht nie.
- Automatische Wege (`runDerived`: Kanban-Rücksync, Auto-Einsammeln, Ticket-Archiv, Umbenennen von Verknüpfungen)
  stempeln weiterhin bewusst nicht.
- Kein nächtliches Auto-Aufräumen (bewusst, siehe Auftrag).
