# M531 — Karten: Fristen auf Englisch, Timer überlebt Neuladen, Kalender, Nur-lesen-Leisten, Kontakt
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m531-karten.mjs` (Port 5531) · Datum: 2026-11-25

## Warum
Umsetzungsrunde nach dem Audit (M518–M527, „ok. setze alles um!“). Dieses Paket nimmt die offenen Punkte der Karten
aus M520 (Planung, Daten, Workshop), M519 (KA10, KA11, KA13) und M513 (Mitmachen per QR). Die Rechen-Tabelle macht M528.

## Was (was der Nutzer merkt)
1. **Fristen auch englisch:** „by Friday“, „tomorrow“, „next week“, „Review on Friday“ werden Fristen – in der
   englischen Oberfläche immer, in der deutschen, wenn der Text deutsch nichts ergibt. Die englische Schnell-Eingabe
   der Aufgaben-Zentrale heißt „New task … – understands “by Friday” …“ und nimmt „by/on/until/due“ mit der Frist aus
   dem Titel. Der Kalender liest englische Termine aus Notizen ebenso.
2. **Timer für alle überlebt das Neuladen beim Starter:** Die Uhr läuft nach dem Laden weiter, wo sie stehen müsste
   (gleiche Restzeit wie bei den anderen); ein angehaltener Timer kommt nicht wieder; lief er während des Neuladens ab,
   ist er danach vorbei (bis 8 s nach dem Ende noch „Zeit ist um“). Bei den anderen ändert sich nichts.
3. **Kalender:** Eigene Termine eines Tages stehen nach Uhrzeit, ganztägige zuerst (Monatsfeld und Tagesliste).
   „Bis“ vor „Von“ am selben Tag wird nicht gespeichert: Feld rot, Satz „„Bis“ liegt vor „Von“ …“ mit **Tauschen**,
   Speichern (auch Enter) gesperrt. Mit Bis-Datum am Folgetag ist 14:00 bis 10:00 gültig.
   **Wochenplan → Soll der Zeiterfassung:** zählt nur, was der Plan zeigt – keine Blöcke an Tagen außerhalb des Rasters
   (Sa/So bei Mo–Fr), vom Block nur der Teil zwischen Raster-Beginn und -Ende.
   **Zeiterfassung:** Blättern in Monat/Jahr (Weiter/Zurück, Klick auf einen Monat der Jahresansicht) behält den Tag
   bzw. nimmt den letzten gültigen Tag des Monats (31.01. → 28.02.), statt auf den 15. zu springen.
4. **Mitmachen per QR nach Löschen + Strg+Z:** Die zurückgeholte Karte zeigt die Runde nicht mehr als laufend (kein
   „QR offen“, kein „Läuft auf einem anderen Gerät“); „Mitmachen per QR“ startet ohne Rückfrage eine neue Runde.
5. **Diagramm (KA10):** Der Hinweis „Klick auf Schritt oder Pfeil = bearbeiten …“ erscheint nur, wenn unter dem
   gezeichneten Diagramm Platz ist; sonst steht derselbe Text als Tooltip an der Zeichenfläche. Er verdeckt keinen
   Schritt mehr.
6. **Nur zum Lesen (KA11):** Auf Boards, die nur zum Lesen freigegeben sind, und an Karten, die ein Gast nicht ändern
   darf, gibt es die Bearbeiten-Leisten nicht mehr: Diagramm-Leiste („＋ Schritt“), Form-Leiste, Farbpunkt und Palette
   der Notiz, „Arbeit/Pause starten“ und „＋ Eintrag“ der Zeiterfassung, „Vorgang hinzufügen“ des Zeitplans, „Zeile
   anhängen“ der Tabelle, Raster-Einstellungen des Wochenplans, TOP/Aufgabe/Beschluss, Einrichten und „＋“ des
   Protokolls, „＋ Neues Ticket“ im Kanban, „Bearbeiten“ des Kontakts, Einstellungen von Flüssiger Schrift und Pixi,
   Eintragen/Löschen im Tages-Editor des Kalenders. Ansichts-Bedienung bleibt (Blättern, Ansicht, Skala, Filter,
   Sortieren, Kopieren/Drucken, vCard, Export – M520 `lib/kartenAnsicht.ts`).
7. **Kontakt (KA13):** Klick daneben oder Fokus woandershin (Tastatur) beendet das Bearbeiten wie „Fertig“; Eingaben
   sind ohnehin sofort gespeichert. Klicks innerhalb des Formulars lassen es offen.
8. **Zähl-Texte:** Im Quelltext stehen keine „Karte(n)“, „Frist(en)“, „Punkt(e)“ mehr (schon von früheren
   Meilensteinen umgestellt); Prüfpunkt H1 hält es so.

## Wie (Architektur)
- **Fristen** (`lib/dates.ts`): `chronoKern.ts` exportiert jetzt `chronoDe` **und** `chronoEn`. Gemessen: Die
  englischen Regeln lagen schon immer im Nachlade-Teil „fristen“ (chrono-node baut seine Grundeinstellung `Chrono`
  aus `locales/en/configuration`) – ein eigenes Paket „fristen-en“ hätte das deutsche Paket zirkulär davon abhängig
  gemacht. Kosten: +0,5 KB im Paket „fristen“, nichts im Start. Gelesen wird englisch über
  `englischNoetig(text, deutschGefunden)`: englische Oberfläche → immer (mit `KANN_EN`), deutsche → nur wenn deutsch
  nichts kam und der Text eindeutig englische Wörter hat (`EINDEUTIG_EN`, ohne „Jan“, „Nov“, „Sat“ …). `kannDatumSein`
  bekam die englische Vorprüfung dazu (`kannEnglischSein`). `lib/notizTermine.ts` (Kalender) nutzt dieselbe Regel.
  `lib/tasks.ts` → `parseQuickTask`: „by/on/until/due“ fallen mit der Frist aus dem Titel. Platzhalter/Hinweise:
  `en.json` (Schnell-Eingabe, Ticket-Frist aus Notiz).
- **Timer** (`lib/gruppenraum.ts`): `sichern()` schreibt bei jeder Änderung (`melden`) die eigenen Läufe als
  `{ lauf, ende, dauer, name }` je Board nach `sessionStorage['pixinotes-gruppen-timer']` – das Ende nach der Uhr dieses
  Geräts, nicht die Restzeit. `zurueckholen()` (aus `initGruppenraum`, also beim ersten Live-Kanal) setzt sie wieder
  ein (Starter = `ich().id`, dieselbe Kennung wie vorher), verwirft Läufe, die länger als `NACHLAUF_MS` (8 s) vorbei
  sind, und startet das Wiederholen (`takten`). Nur sessionStorage: ein zweites Fenster wird kein zweiter Sender.
- **Kalender** (`CalendarCard.tsx`): `meineSortiert` (Sortieren nur fürs Zeigen, gespeichert bleibt die Reihenfolge);
  `zeitFalsch` sperrt `saveEvent` und den Knopf, `.cal-evform-fehler` (52-phone-termine-protokoll.css, Farbe
  `--warn-text`). **Wochenplan-Soll** (`lib/moduleFeeds.ts` → `weekSollByDay`): Raster wie `WeekCard.tsx` (Tage 5/7,
  Vorgabe 8:00–17:00), Block auf `[from, to]` zugeschnitten. **Zeiterfassung** (`TimeCard.tsx`): `tagImMonat`,
  `addMonthsIso` behält den Tag.
- **Mitmachen** (`lib/mitmachen.ts`, `lib/mitmachenHost.ts`): Gemerkte Runde mit `ende` (ohne Schlüssel) = „die Karte
  wurde hier gelöscht, die Runde ist vorbei“. `abgleichen()` legt den Vermerk an, wenn die Karte fehlt (statt den
  Eintrag nur zu löschen), räumt ihn nach 30 Tagen weg; `hierGastgeber` übergeht ihn, `hierBeendet(token, karte)`
  meldet ihn. `BubblesCard.tsx`: `mitAn = mit.an && !hierBeendet(...)`. `mitmachenOeffnen` löscht alte Einträge der
  Karte samt Vermerk wie bisher.
- **Diagramm** (`MermaidCard.tsx`): `hinweisAn`, `hinweisText`, `hinweisFrei`; ein Effekt misst nach jedem Zeichnen
  und bei Größenänderung (ResizeObserver der Zeichenfläche), ob eine der Gruppen unter dem `svg` den Hinweis schneidet.
  Nicht frei → Hinweis `visibility: hidden` (behält seine Lage für die nächste Messung), Text als `title` der
  `.mermaid-preview`.
- **Nur lesen** (zentral): `useKarteFestId(id)` in `store/selektoren.ts` (wie `useKarteFest`, sucht den Ersteller nur,
  wenn Gäste eingeschränkt sind). `CardShell` und die Form-Hülle (`ShapeCard`, ohne CardShell) setzen `data-fest`; die
  Liste der Bearbeiten-Leisten steht **einmal** in `src/styles/62-greifen-tastatur-teilen.css` (`[data-fest] :is(…)`,
  dazu `.board-wrap.nur-lesen .mm-toolbar` für die Diagramm-Leiste, die als NodeToolbar außerhalb der Karte liegt;
  `MermaidCard` blendet sie für Gäste über `isVisible` aus). **Neue Bearbeiten-Leisten dort eintragen.** Welche Knöpfe
  auf einem Nur-lesen-Board nur „nur zum Lesen freigegeben“ melden, wurde je Kartentyp durchgeklickt.
- **Kontakt** (`KontaktCard.tsx`): Solange `bearbeiten`, hören `pointerdown` (Dokument, Fang-Phase) und `focusout`
  (Karte, mit `relatedTarget` außerhalb) auf „daneben“ und rufen `fertig()`; `fertig` schreibt nur noch, wenn es leere
  Zeilen zu räumen gibt (kein leerer Verlaufsschritt).

## Grenzen / offen
- Timer: Ein **anderes Fenster** oder ein geschlossener und neu geöffneter Tab des Starters übernimmt den Timer nicht
  (bewusst sessionStorage); die anderen behalten ihn wie bisher bis zum Ablauf.
- Mitmachen: Andere Geräte im Board sehen die Karte weiter „an“ („Läuft auf einem anderen Gerät“), bis jemand die
  Runde neu startet oder beendet – nur das Gerät, das Gastgeber war, weiß, dass niemand mehr Gastgeber ist.
- Nur lesen: Einträge in Menüs, die Ansicht und Inhalt mischen (Zeitplan „Aufgaben übernehmen/Konflikte auflösen“,
  Tabelle „Spalte anhängen/Auto-Summe“, Kalender „.ics importieren“), bleiben und melden wie bisher. Die Auswahl-Leiste
  (Duplizieren/Löschen) gehört nicht zu den Karten und ist unverändert. Für Gäste mit „nur Eigenes“ greift dieselbe
  Liste (über `karteFest`); die Prüfreihe prüft das Nur-lesen-Board.
- Wochenplan: Blöcke außerhalb des Rasters zählen nicht mehr zum Soll und werden nicht gesondert angezeigt.
- Zeiterfassung: Wer vom 31.01. über Februar in den März blättert, landet auf dem 28.03. (der Februar kürzt den Tag).
- Bilder: `pruefungen/ablage/m531/` (Kalender, Diagramm schmal, Nur lesen, Mitmachen, Timer).
