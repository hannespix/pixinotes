# M451 — E-Mail-Destillat
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m451-mail-destillat.mjs` · Datum: 2026-11-23

## Warum
Roadmap `docs/KONZEPT.md` §5 Punkt 3: Aus einem langen Mail-Verlauf soll die KI ein Destillat machen – Kernaussage,
offene Fragen, Aufgaben mit Frist und Verantwortlichem, wichtige Termine und Zahlen –, als Notiz neben der Mail und
nie destruktiv; die Aufgaben sollen mit einem Klick Kanban-Tickets bzw. Checklisten-Punkte werden und mit Frist in
der Aufgaben-Zentrale erscheinen. Bisher gab es an der E-Mail-Karte nur „Zusammenfassen": 3–5 Stichpunkte ohne
Gliederung, Aufgaben bloß als Text, Platzbudget 6 000 Zeichen vom Anfang.

## Was
- E-Mail-Karte: **„Destillat"** ersetzt „Zusammenfassen" (keine zweite, ähnliche Aktion). Neue Notiz rechts neben der
  Mail (frei liegend), Titel „Destillat: Betreff", Abschnitte Kernaussage · Offene Fragen · Aufgaben · Termine und
  Zahlen (leere Abschnitte außer der Kernaussage entfallen), Pfeil Mail → Notiz „Destillat". Die Mail bleibt
  unverändert; Notiz, Pfeil und Merker sind EIN Schritt im Verlauf.
- Aufgaben stehen zuerst als Aufzählung „Text – Person – bis TT.MM.JJJJ". An der Mail erscheinen danach zwei Knöpfe:
  **Als Checkliste** (die Aufgaben-Punkte der Notiz werden Haken; die Frist liest die Aufgaben-Zentrale aus dem Text)
  oder **Als Tickets** (neue Kanban-Karte unter dem Destillat, je Aufgabe ein Ticket mit `due`/`who` und Verweis auf
  die Mail, Pfeil Mail → Kanban „Aufgaben"). Nur ein Weg je Destillat – sonst stünde jede Aufgabe doppelt in der
  Zentrale; danach verschwinden die Knöpfe.
- Langer Verlauf: bis 12 000 Zeichen gehen ganz an die KI, darüber Anfang (9 000, die neueste Nachricht) und Ende
  (3 000, der Beginn des Verlaufs) mit Auslassungsvermerk; die Meldung sagt es.
- **Nachtrag M445:** „Nach Themen ordnen" ohne Chat-KI meldete in einem vom Gehirn ausgeschlossenen Bereich „Zu
  wenig Inhalt". Jetzt: „Dieser Bereich ist vom Gehirn ausgeschlossen – … Einschalten unter Einstellungen → Gehirn →
  Bereiche." Scheitert die Chat-KI und der Bereich ist ausgeschlossen, nennt die Meldung den KI-Fehler und dass der
  Rückfall nicht geht.

## Wie (Architektur)
- `src/lib/mailDestillat.ts` (nachgeladen aus `EmailCard.tsx`): `mailDestillieren(mailId)` – `askJson` aus
  `aiActions.ts` mit `{"kern","fragen","aufgaben":[{"text","wer","frist"}],"termine"}`, „Heute ist …" und Mail-Datum
  für relative Fristen; `destillatBereinigen` (nur Texte, Listen ≤ 12, Frist nur als gültiges ISO-Datum);
  `mailImBudget`; Lage über `findFreeSpot`. Merker an der Mail: `data.destillat = { notizId, aufgaben, blockIds,
  uebernommen?, kanbanId? }` (`EmailData` hat eine Index-Signatur, kein Typ-Umbau).
- `alsCheckliste`: setzt die Blöcke mit den gemerkten `blockIds` (Rückfall: unveränderter Text) auf
  `checkListItem` und zählt `extEpoch` hoch, damit der offene Editor sie übernimmt (M170); `updateNodeData` pflegt
  dabei die Frist-Anker (M390).
- `alsKanban`: `makeKanban` mit Tickets (`links` statt `link` – `link.itemId` hieße „eingesammelte Kopie" und fiele
  aus der Zentrale). **Kein Pfeil Destillat ↔ Kanban:** Ein Pfeil Notiz → Kanban abonniert alle Listenpunkte der
  Notiz (M182) – Fragen und Termine würden Tickets; die Kanban-Karte hängt an der Mail (E-Mails liefern keine
  Aufgaben).
- `src/lib/themenOrdnen.ts`: `perGehirn` prüft `brainBoardIds()` vor `kartenVektoren`; Konstante
  `GEHIRN_AUSGESCHLOSSEN`.
- CSS `.email-aufgaben` neben `.card-actions` (bleibt wie die übrigen Mail-Aktionen sichtbar; im „Nur Inhalt"-Modus
  über `.card-actions` ausgeblendet).

## Grenzen / offen
- Die Aufgaben-Zentrale zeigt bei Checklisten-Punkten keine Person (nur Tickets haben `who`); die Person steht im Text.
- Nur das jüngste Destillat einer Mail bietet das Übernehmen an; ein zweites Destillat legt eine weitere Notiz an.
- Keine bestehende Prüfreihe arbeitete bisher mit .eml-Dateien – m451 deckt Ablegen und Parsen mit ab.
