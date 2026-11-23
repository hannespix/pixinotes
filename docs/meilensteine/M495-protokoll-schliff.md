# M495 — Protokollreihe Feinschliff
PR: siehe Merge-Titel „… (M495)" · Prüfreihe: `pruefungen/m495-protokoll-schliff.mjs` (Port 5495) · Datum: 2026-11-23

## Warum
Der Nutzer hat die Protokollreihe ausdrücklich als wichtig markiert („muss deutlich besser werden“). M489 hat sie neu
gebaut, M493 das gemeinsame Tippen darin gefestigt; M489 ließ vier Punkte offen: viele Sitzungen (die Leiste wuchs nur
waagrecht), Versand langer Protokolle (`mailto:` kürzt), Personen-Erkennung („Name:“ zählte nur mit einem Namen aus der
Runde, alles andere wurde still übergangen) und die Übergabe an die nächste Sitzung (nur offene Aufgaben).

## Was (Nutzersicht)
- **Viele Sitzungen:** Die Leiste zeigt die neuesten Sitzungen, so viele in die Karte passen (höchstens acht), die
  gezeigte immer. Alle übrigen stehen in der Auswahl **„Ältere (n)“**, nach Monat gruppiert („Oktober 2026“), mit Datum
  und Titel. Mit **← →** blättert man von Sitzung zu Sitzung, wenn eine Sitzung der Leiste den Fokus hat (neueste links).
  Bei 60 Sitzungen rollt nichts mehr, auch am Telefon nicht.
- **Übergabe:** **＋** fragt jetzt nach, was mitkommt — offene Aufgaben und **TOPs ohne Beschluss** der letzten Sitzung
  stehen angehakt da, dazu das vorgeschlagene Datum (änderbar). Abwählen, was nicht mehr gilt, „Sitzung anlegen“. Ein
  übernommener TOP steht in der neuen Sitzung als Überschrift mit „(offen seit …)“. Gibt es nichts zu übernehmen, legt
  ＋ die Sitzung sofort an wie bisher. Die Meldung nennt alles („… übernommen: 3 Personen, 2 offene Aufgaben und 1
  offener TOP.“).
- **Versenden und Ablegen** (⋯): *Per E-Mail versenden* — passt die Sitzung nicht in eine mailto-Adresse (ab 1 800
  Zeichen), liegt der volle Text in der Zwischenablage, das Mailprogramm öffnet mit Betreff und dem Hinweis „Der Text des
  Protokolls liegt in der Zwischenablage – bitte hier einfügen“. Neu: *Drucken / als PDF* (eigenes Fenster mit einem
  ruhigen Blatt: Reihe, Sitzung, Teilnehmende, Tagesordnung, Protokolltext, Beschlüsse, Aufgaben-Tabelle mit Person,
  Frist und Stand; dort bietet jeder Browser „Als PDF sichern“) sowie *Als Markdown speichern (.md)* und *Als Webseite
  speichern (.html)* mit denselben Teilen.
- **Personen:** Steht in einer Aufgabe „Mia: Raum buchen“ und Mia ist nicht in der Runde, fragt die Karte leise
  **„Mia zur Runde hinzufügen?“** (Hinzufügen / ×). Beschriftungen wie „Hinweis:“, „Frage:“, „Status:“ zählen nicht.
- **@-Liste:** „@“ am Wortanfang im Protokolltext zeigt die Runde; Tippen filtert, ↑ ↓ Enter oder Klick fügt „@Anna “
  ein (bei zwei gleichen Vornamen der volle Name). In „anna@amt.de“ erscheint keine Liste; passt niemand, schließt sie
  sofort (sie schluckte sonst Enter).

## Wie (Architektur)
- `src/lib/protokollSchliff.ts` (neu, ohne React, nur von der nachgeladenen Karte benutzt — nicht im Start):
  `offeneTops` (Regel: ein TOP gilt als beschlossen, wenn ein Beschluss der Sitzung eines seiner Wörter ab vier
  Buchstaben nennt; feste Tagesordnung und die Übergabe-Überschrift zählen nie), `uebergabeVorschlag`, `neueSitzung`
  (ersetzt in der Karte `buildEntry`, das für andere Aufrufer bleibt), `unbekanntePersonen` (Stoppliste `KEINE_PERSON`),
  `erwaehnung`, `aufgabenDerSitzung`, `sitzungAlsMarkdown`, `sitzungAlsHtml` (eigenes Druck-CSS, alles maskiert, kein
  Skript), `dateiName`, `mailAdresse` mit `MAILTO_MAX = 1800`, `nachMonat`.
- `lib/minutes.ts`: `personVon` erkennt „@Anna Berg“ als zwei Wörter, wenn genau so jemand in der Runde steht.
- `components/nodes/MinutesCard.tsx`
  - Leiste: `LEISTE_MAX = 8`; `useLayoutEffect` misst nach jedem Zeichnen und nimmt eine Sitzung weg, solange die
    Leiste breiter ist als ihr Platz; ein `ResizeObserver` setzt beim Breiterwerden zurück. Die Auswahl `.pr-aeltere`
    steht neben (nicht in) der `tablist`. ←/→ über `onKeyDown` der Leiste, nur ohne `overlayOffen()`, mit
    `stopPropagation`; Pos1/Ende bleiben dem Board (`boardTasten.ts` hört sie auf der ganzen Fläche, M345). Roving
    `tabIndex` (nur die gezeigte Sitzung ist Tab-Ziel), der Fokus folgt der Taste.
  - Übergabe: Zustand `uebergabe` (Punkte, Auswahl, Datum), Feld `.pr-uebergabe` unter dem Kopf; Escape schließt.
    Die neue Sitzung wird wie bisher über den Speicher angelegt (sie ist neu — niemand tippt darin).
  - Versand: `perMail` schreibt die Zwischenablage im Klick (Nutzergeste) und öffnet danach die kurze Adresse;
    `drucken` (Fenster, bei Blocker Rückfall auf die HTML-Datei), `speichern` (Blob → `triggerDownload`).
  - Personen: `personVorschlaege` aus dem Speicherstand der Sitzung, abgelehnte Namen nur für diesen Besuch (lokaler
    Zustand, kein Merkfeld — nichts für `lib/abgleichZeiten.ts`). Die Runde selbst lag nie im Y-Dokument; „Hinzufügen“
    schreibt sie wie „+ Person“.
  - `PersonenMenue`: BlockNotes `SuggestionMenuController` mit `triggerCharacter="@"`, `shouldOpen` nur am Wortanfang,
    eigene Liste `PersonenListe` (`.pr-at-liste`, Menü der Oberfläche wie M492: `--surface`/`--ink`), schließt bei
    leerer Trefferliste über `useExtension(SuggestionMenu).closeMenu()`. Eingefügt wird über den Editor — gemeinsam
    damit über das Yjs-Dokument (M493).
- CSS in `styles/52-phone-termine-protokoll.css` (Leiste, Vorschlag, Übergabe, @-Liste, Ziele ≥ 36 px am Finger);
  `.pr-aeltere` und `.pr-vorschlag` in den drei M421-Listen und in „nur Inhalt“ (`72-…`). Rand der Auswahl
  `--pr-muted` gestrichelt (≥ 3:1 auf jedem Papier).
- Hilfe (beide Sprachen: Eintrag „Was ist neu“ und Abschnitt Protokoll-Reihe), `src/sprache/en.json` (27 Texte).
- Datenmodell unverändert; keine Migration. Start-JS unverändert unter der Grenze (m483 grün).

## Prüfreihe
A 60 Sitzungen: Leiste ohne Überlauf (≤ 8 sichtbar, „Ältere“ führt die übrigen 52+, ≥ 12 Monatsgruppen), Sprung zu
Sitzung 37 über die Auswahl, ←/→ mit Fokus, Telefon hell/dunkel ohne Überlauf · B lange Sitzung: abgefangene
mailto-Adresse < 1 800 Zeichen mit Betreff und Hinweis, Zwischenablage voll (bis zum letzten Satz); kurze Sitzung wie
bisher ganz · C Markdown/HTML per Download (Kopf, Teilnehmende, TOPs, Beschlüsse, Aufgaben-Tabelle mit Person, Frist,
Stand; kein Skript) · D Druckfenster mit Blatt (Überschriften, Tabelle, dunkle Schrift auf Weiß) · E Vorschlag „Mia“
(nicht „Hinweis“), Hinzufügen → Runde und Übersicht; × blendet aus · F keine Liste in „a@b“, @-Liste mit der Runde,
Filtern, Enter fügt „@Gerd“ ein, Übersicht ordnet zu · G Übergabe: Aufgaben + TOP ohne Beschluss angehakt, beschlossener
TOP, feste Tagesordnung und Erledigtes fehlen; abgewählte Aufgabe fehlt in der neuen Sitzung, TOP mit „offen seit“,
Meldung · H Kontraste (Schrift ≥ 4,5:1, Ränder ≥ 3:1) mit offener Übergabe und an der Leiste auf Weiß und Gelb, hell und
dunkel · keine Seitenfehler.

Angepasst: `m489` (B: nach ＋ jetzt „Sitzung anlegen“ in der Übergabe — geprüft wird dasselbe).

## Grenzen / offen
- „TOP ohne Beschluss“ ist eine Wortregel (Beschlüsse hängen im Datenmodell an der Sitzung, nicht am TOP). Ein reiner
  Informations-TOP wird vorgeschlagen — darum ist alles abwählbar. Eine feste Zuordnung Beschluss → TOP bräuchte ein
  neues Feld im Y-Dokument der Beschlüsse (M493) und ist bewusst nicht Teil dieses Schritts.
- Abgelehnte Personen-Vorschläge gelten nur, solange die Karte offen ist.
- Die Druckansicht nutzt die Schrift des Systems (keine eingebetteten Schriften) und das Fenster des Browsers; ist es
  blockiert, liegt die Ansicht als .html bei den Downloads.
