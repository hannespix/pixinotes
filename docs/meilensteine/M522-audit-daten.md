# M522 — Bugfixing-Audit „Daten, Abgleich und Team": eine kaputte Karte von außen legt PixiNotes nicht mehr lahm
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m522-audit-daten.mjs` (Port 5522) · Datum: 2026-11-24

## Warum
Teil des großen Bugfixing-Audits (M518–M523). Bereich: Speicher (persist, Migration, Verlauf, Struktur, Schutz),
Abgleich (Ordner, WebDAV, Konto), Import/Export, Live/Teilen, `lib/sicher.ts`. Hier wiegt jeder Fehler am schwersten.

## Vorgehen
- **Code gelesen:** `src/store/` (speicher, verlauf, struktur, abgleich, start), `syncMerge`, `abgleichZeiten`,
  `grabsteine`, `syncFolder`, `projectSync`, `filesSync`, `webdav` (Lese-/Übernahme-Wege), `sicher`, `share`,
  `sicherung`, `gastPatch`, `liveKanal`, `serialize` (alle HTML-Ausgaben), alle `dangerouslySetInnerHTML`/`innerHTML`-
  Stellen, alle `JSON.parse` von Fremddaten.
- **Explorativ** (Skripte im Scratchpad, je Befund zweimal nachgestellt):
  - 22 alte und beschädigte Speicherstände geladen (v0–v4, kaputtes JSON, fehlende Felder, Version aus der Zukunft);
  - 40 Karten (20 Arten × „leer"/„schräg") und ein Zufallslauf über verbogene Karten-Inhalte gegen die echte App;
  - Drei-Wege-Abgleich mit 6 000 Zufallsläufen im Protokoll des Sync-Ordners (lesen, mischen, schreiben, Basis);
  - der echte Speicher ohne Oberfläche („Labor": `src/store` + Abgleich-Bibliotheken gebündelt im Browser) für
    Team-Paket, Ebenen löschen/zurück, Verlauf-Grenzen, Sicherung-Rundreise, Grabsteine;
  - Live mit dem nachgebauten Supabase aus m477: Gast verliert die Verbindung und kommt zurück, Gast lädt mitten im
    Tippen neu, Besitzerin lädt mitten im Tippen neu, Karte offline anlegen.

## Befunde

| Nr | Schwere | Was der Nutzer merkte | Ursache | Stand |
|----|---------|-----------------------|---------|-------|
| D1 | hoch | Ein geteilter Link (`#b=…`), eine Einladung zum Mitarbeiten, eine Sicherung oder eine Datei mit **einer** kaputten Karte (Kanban ohne Tickets, Zeitplan ohne Zeilen, E-Mail ohne Anhang-Liste, Zeiterfassung ohne Abschnitte, Wochenplan ohne Einträge, Notiz mit Text statt Blöcken, Form mit Objekt als Text) → **„PixiNotes lässt sich gerade nicht anzeigen"** — die ganze App, bei jedem Start wieder. Über ein gemeinsam bearbeitetes Board konnte ein Gast so die App der Besitzerin dauerhaft lahmlegen. | `karteGueltig` prüft nur die Hülle (Kennung, Art, Lage, `data` ist ein Objekt). Was in `data` steht, lesen aber nicht nur die Karten, sondern Auswertungen über alle Boards (Aufgaben, Suche, Termine) — dort gibt es keine Fehlergrenze je Karte. | ✅ `lib/sicherGestalt.ts` → `karteGestalt`: je Kartenart die Gestalt der Felder; eingehängt in `karteEntschaerfen`, also an allen Eingängen (Konto, Gast-Link, Live-Kanal, Patches, Sicherung, Link, Datei, Ordner, WebDAV, Team-Paket). Kaputtes wird **gerichtet**, nicht verworfen. |
| D2 | hoch | Wer einen beschädigten Stand schon im Browser hatte, kam nicht mehr hinein: „Nochmal versuchen" und „Seite neu laden" führten zum selben Bild. | Der Stand liegt im Browser und kommt mit jedem Start wieder; die Fehlergrenze konnte nur neu zeichnen. | ✅ Die Fehlergrenze (`ErrorBoundary`) richtet beim ersten Fehler den Stand im Speicher (`standRichten`, nachgeladen) und baut sich neu auf. Nichts Lesbares fällt weg — eine Karte ohne Lage bekommt eine. |
| D3 | hoch | Geteilter Link/`.pixiboard.json` mit kaputten Verbindungen, Strichen oder Gesprächen: Import brach still ab bzw. die Zeichen-Ebene fiel aus. | `cloneSharedBoard` prüfte nur die Karten; `edges: [null]` oder ein Strich ohne Punkte gingen ungeprüft durch. | ✅ das ganze Board läuft durch `boardVonAussen`; Punkte eines Strichs sind Zahlenpaare, Beiträge eines Gesprächs Text. |
| D4 | hoch | Sync-Ordner, WebDAV, „Stand laden", Dateien-App, Konfliktkopie: Eine Datei mit einem Board ohne Kartenliste ließ den Abgleich bei **jedem** Takt abbrechen (für immer — die Datei bleibt liegen); über „Stand laden" fiel die App aus (D1). | Aus der Datei liefen nur die Zeitstempel durch `lib/sicher.ts` (M470), nicht die Gestalt. | ✅ `standVonAussen` in allen vier Lesern und in `fremdStandEinarbeiten`. Was die Prüfung herausnimmt, gilt nicht als „drüben gelöscht" (leere Grabstein-Liste → „nie gesehen", M351); der nächste Schreibvorgang heilt die Datei. |
| D5 | hoch | „Projekt beitreten" (Team-Ordner): Ein Paket mit kaputtem Board legte die App lahm. | Pakete anderer liefen an `lib/sicher.ts` vorbei direkt in `importProject`. | ✅ `paketVonAussen` |
| D6 | mittel | Ein gelöschtes Projekt oder ein gelöschter Bereich kam nach dem Abgleich mit einem zweiten Gerät (Ordner, WebDAV) leer zurück. | Grabsteine (M351) gab es nur für Boards, Karten, Pfeile, Striche, Gespräche. Die Zusammenführung fragt aber auch bei Bereichen und Projekten „gelöscht oder nie gesehen?" — ohne Grabstein hieß es immer „nie gesehen": Das zweite Gerät behielt die Ebene und schrieb sie zurück. | ✅ `grabsteine.ts` → `ebenenVerschwunden`; „geteilt" (führt das Konto) bekommt keinen. |
| D7 | mittel | Team-Projekt aktualisiert: Ein Board, das man hier in ein anderes Projekt gelegt hatte, stand danach in beiden — doppelt in Baum und Übersicht. | `importProject` trug die Boards ins Team-Projekt ein, ohne sie aus anderen Projekten zu nehmen. | ✅ |
| D8 | mittel | Nur lesend geteiltes Board (auch: Karte, die gerade jemand anderes hält; Gast mit „nur Eigenes"): Karten meldeten Erfolg, obwohl nichts gespeichert wurde — „Arbeit beendet (2:00 h)", „gelöscht – Rückgängig". (Hinweis aus M520.) | Der Schutz sitzt am `set()` des Speichers und verwirft still; die Karte ruft direkt danach `showToast` mit ihrer Erfolgsmeldung. Der eigene Hinweis des Schutzes ist gedrosselt (einmal je 4 s) und wurde überschrieben. | ✅ Der Schutz merkt sich bis zum Ende des Handgriffs, warum er verworfen hat (`schutzVerworfen`); `showToast` zeigt dann diesen Grund statt der Erfolgsmeldung — eine Stelle für alle Karten. Am Schutz selbst ändert sich nichts. |
| D9 | niedrig | Abgleich: Ein Board, das drüben gelöscht und hier bearbeitet wurde, blieb (richtig) — sprang aber ins erste Projekt des ersten Bereichs. | `mergeHierarchie` legte „Waisen" immer ins erste Projekt. | ✅ Eine Waise bleibt in ihrem Projekt (hier, sonst drüben), solange es das noch gibt. |
| D10 | hoch | Wie D1, nur über Zahlen: Ein Zeitplan mit `dayWidth: [[]]`, eine Tabelle mit zehn Millionen Spalten oder ein Wochenplan „von −1e9 bis 1e12" ließ die **Seite hängen** (kein Fehlerbild, nichts ging mehr); eine Zahl statt Text in einer Tabellenzelle ließ die App ausfallen. Gefunden im Zufallslauf. | Diese Zahlen treiben Schleifen (Spalten, Zeilen, Stunden, Pixel je Tag) bzw. werden als Text gelesen (`startsWith`). | ✅ `GESTALT[…].bereich` (außerhalb → weg, es gilt die Vorgabe der Karte) und `texte?` für Zellen. Danach 704 zufällig verbogene Karten aller 20 Arten ohne Ausfall und ohne Hänger. |

### Offen (braucht eine Entscheidung)
| Nr | Schwere | Befund | Warum offen |
|----|---------|--------|-------------|
| O1 | niedrig | „Alles leeren" und danach eine Gesamt-Sicherung „ersetzen": das leere Startboard „Mein Board" bleibt neben dem Eingespielten stehen (beim Board-Import räumt M370 es weg). | Verhalten ändern = Entscheidung. |
| O2 | niedrig | Ist der gespeicherte Stand kein lesbares JSON (nur durch Eingriff von außen möglich), startet die App leer und überschreibt ihn mit dem nächsten Speichern; eine Kopie des Rohtexts wird nicht aufgehoben. | Neue Funktion. |
| O3 | Hinweis | **Start-JS-Grenze:** Vor diesem Meilenstein lag der Start bei 2 064 837 B, Grenze 2 065 000 B (m483/m502) — 163 B Luft; jede Zeile im Start-Paket riss fünf Reihen. Dieser Meilenstein lädt die Prüfung darum nach und hat zwei Texte, die nur die Einstellungen brauchen, aus dem Start genommen (Einladungs-Mail des Team-Syncs, Bitte an die IT für WebDAV/CORS). Stand danach: 2 062 596 B — rund 2,4 KB Luft. | Die Luft ist endlich; wer Start-Code ergänzt, misst nach (m502 A1). |
| O4 | niedrig | Die Gestalt-Prüfung kennt die Zahlen, die Schleifen treiben (D10), nicht jede Zahl jeder Karte (z. B. eine absurde Frist in Tagen). Ein Board mit sehr vielen heilen Karten bleibt langsam. | Je Karte eigene Grenzen — Sache der Karten (M519/M520). |

### Geprüft, ohne Befund
- **Speicher:** Stände v0 (Einzelboard), v1 (flach), v2 (tote `activeId`, Striche ohne Anker), v3 (`dragHandle`), v4
  (Fahrzeit/Dienstgeschäft), Version aus der Zukunft, fehlende `spaces`, Board außerhalb der Hierarchie, Geister-
  Kennung in der Hierarchie, unbekannte Kartenart, unbekannte Ansicht — alle laden, nichts geht verloren.
- **Verlauf:** Grenze 50 Schritte, 60× zurück und 60× vor, Schritte zu gelöschten Boards fallen weg, Projekt/Bereich
  löschen und „Rückgängig" stellt Reihenfolge und aktives Board exakt wieder her.
- **Drei-Wege-Abgleich:** 6 000 Zufallsläufe (anlegen, ändern, löschen, verschieben, umsortieren, umbenennen,
  Boards anlegen/löschen/umhängen, Kommentare): beide Geräte enden im selben Stand, kommen nach höchstens fünf
  Schritten zur Ruhe, nichts Neues geht verloren, jedes Board steht genau einmal in der Hierarchie; derselbe Stand
  zweimal eingespielt ändert nichts. `abgleichZeiten.ts`: alle Felder des Datenmodells, die jedes Gerät selbst
  stempelt (`geaendert`, `ocrAm`, `spalteSeit`, `erledigtAm`, `archiviertAm`, `zurueckAm`), stehen in den Listen;
  `angelegt` wird nur einmal gesetzt, `bearbeitet`/`at` der Kommentare führt `mergeThread` zusammen.
- **Sicherung:** bauen → lesen → „Alles leeren" → einspielen: alle 18 Beispiel-Boards samt Strichen (frei und
  geankert), Verbindungen mit Etikett, Gesprächen, Tönung, Look (M509), großem Bild, Datei und Tool aus dem
  Gerätespeicher identisch; als Kopie: gleiche Zahl an Karten, Verbindungen, Strichen, Gesprächen, Anker und
  Verbindungen zeigen auf die Kopien.
- **Live (Yjs):** Gast offline, beide tippen weiter, Gast kommt zurück → derselbe Text, jedes Stück einmal; Gast lädt
  mitten im Tippen neu → bekommt den ungespeicherten Text der anderen; Besitzerin lädt mitten im Tippen neu → ebenso;
  offline angelegte Karte kommt nach dem Wiederverbinden bei beiden an. Server, beide Geräte am Ende gleich.
- **`lib/sicher.ts`:** HTML-Ausgaben (`nodeToHtml`, `blocksToHtml`) maskieren jedes Feld; Verweise nur `http(s)`,
  `mailto`, `tel`; Mermaid läuft mit `securityLevel: 'strict'`; eingebettete Seiten nur über `fremdeWebAdresse`.

### Für andere Bereiche
- **M519/M520 (Karten):** Einzelne Karten fallen bei fehlenden Feldern mit „Diese Karte lässt sich gerade nicht
  anzeigen" aus (z. B. `FileCard` ohne `name`, `MermaidCard` ohne `code`, `WeekCard`/`MinutesCard`/`TimeCard`, wenn die
  Liste kein Feld ist). Seit M522 kommt so etwas von außen nicht mehr an; die Karten selbst könnten trotzdem mit
  Vorgaben rechnen. Ebenso die Auswertungen über alle Boards (`lib/tasks.ts` → `for (const item of k.items)`).

## Was
- Ein Board von außen — Link, Einladung, Sicherung, Sync-Datei, Team-Paket — kann PixiNotes nicht mehr als Ganzes zu
  Fall bringen. Kaputte Inhalte werden beim Hereinkommen gerichtet; was sich nicht richten lässt (kein Objekt), fällt
  weg, der Rest des Boards kommt an.
- Wer schon einen beschädigten Stand im Browser hat, kommt wieder hinein: Die App richtet ihn beim ersten Fehler.
- Auf einem Board, das man nicht ändern darf, meldet keine Karte mehr einen Erfolg — der Hinweis nennt den Grund.
- Der Abgleich über Ordner und WebDAV bricht an einer beschädigten Datei nicht mehr ab, löscht deswegen nichts
  Hiesiges und schreibt die Datei heil zurück.
- Gelöschte Projekte und Bereiche bleiben gelöscht, auch mit einem zweiten Gerät am Sync-Ordner.
- Ein Board aus einem Team-Paket steht in genau einem Projekt.

## Wie (Architektur)
- **`src/lib/sicherGestalt.ts` (neu, nachgeladen):**
  - `karteGestalt(n)` — Tabelle `GESTALT` je Kartenart: Feld → `liste` | `liste?` | `text` | `text?` | `zahl` |
    `objekt?` | `texte?` (Objekt aus Texten: Tabellenzellen), `bereich` (Zahl in Grenzen, sonst weg: `dayWidth`,
    `cols`, `rows`, `kopf`, `bis`, `from`, `to`), dazu je Liste ein „Richter" für die Einträge (`satzMit(['id','text'],['col'])` ergänzt fehlende Felder:
    Text leer, Zahl 0, Kennung nach Stelle; `nurText`, `nurSatz`; `mitListen` für Listen im Eintrag: `subs`, `deps`,
    `links` am Ticket, `blocks`, `decisions`, `infoTops` an der Protokoll-Sitzung). Heiles bleibt **dasselbe Objekt**.
  - `strichVonAussen`, `gespraechVonAussen`, `boardGeprueft` (heil → dasselbe Board-Objekt, sonst `boardVonAussen`),
    `bereicheVonAussen`, `standVonAussen` (ganzer Stand; doppelte Board-Kennungen: das erste zählt), `paketVonAussen`
    (Team-Paket), `standRichten()` (Stand im Speicher richten; true = etwas gerichtet).
  - Beim Laden hängt sich die Datei in `lib/sicher.ts` ein: `gestalt.karte/strich/gespraech`.
- **`src/lib/sicher.ts`:** Haken `gestalt` (bis zum Laden: unverändert durchreichen) und `gestaltLaden()`.
  `karteEntschaerfen` ruft `gestalt.karte`, `boardVonAussen` `gestalt.strich`/`gestalt.gespraech` (Gespräche brauchen
  eine Karten-Kennung). `zeitenVonAussen` ist entfallen (steckt in `standVonAussen`).
- **Wer lädt die Prüfung?** Statisch: `gastSync.ts`, `kontoSync.ts`, `sicherung.ts` (selbst nachgeladen). Per
  `await gestaltLaden()`: `syncFolder.ts` (`readSync`, `fremdStandEinarbeiten`), `filesSync.ts` (`readSyncFile`),
  `webdav.ts` (`webdavRead`), `projectSync.ts` (`readProjectFile`, `scanProjectFiles`), `share.ts` (`readShareHash`),
  `linkTeilen.ts`, `importFiles.ts` (vor `cloneSharedBoard`). **Neue Wege, die Fremdes im Start-Paket annehmen,
  rufen vorher `await gestaltLaden()`.**
- **`src/lib/syncFolder.ts` `fremdStandEinarbeiten`:** `standVonAussen(remote0)`; hat die Prüfung etwas
  herausgenommen und trägt die Datei keine Grabsteine, bekommt sie eine leere Liste (`geloescht: {}`) — damit gilt
  Fehlendes als „nie gesehen" statt „gelöscht".
- **`src/components/ErrorBoundary.tsx`:** `componentDidCatch` → `standRichten()` (ein Lauf für alle Grenzen, die
  im selben Augenblick scheitern); war etwas zu richten, setzt die Grenze ihren Fehler zurück.
- **`src/lib/grabsteine.ts`:** `ebenenVerschwunden(vor, nach)`; das Abo reagiert auch auf `spaces`.
- **`src/store/abgleich.ts` `importProject`:** Kennungen aus dem Paket werden aus allen anderen Projekten genommen.
- **`src/store/schutz.ts`:** `verworfenMerken(grund)` (aus `leseHinweis`, `sperrHinweis`, `rechtHinweis`; nur binnen
  1,5 s nach einer Eingabe, gilt bis zum Ende des laufenden Handgriffs — Mikroaufgabe) und `schutzVerworfen()`.
  **`src/store/hinweise.ts` `showToast`:** steht ein Grund an, ersetzt er die Meldung (ohne „Rückgängig").
- **`src/lib/syncMerge.ts` `mergeHierarchie`:** Waisen zuerst in ihr Projekt (`heim`: drüben, dann hier — hier gewinnt).
- **`src/lib/projektEinladung.ts`, `src/lib/webdavCorsText.ts` (neu):** `buildInviteText`/`buildInviteMailto` bzw.
  `corsRequestText` unverändert aus `projectSync.ts`/`webdav.ts` herausgelöst — nur die (nachgeladenen) Einstellungen
  brauchen sie; schafft den Platz im Start-Paket.
- Start-JS: 2 062 596 B (vorher 2 064 837 B, Grenze 2 065 000 B). `sicherGestalt` rund 7,5 KB, nachgeladen.

## Prüfreihe
`pruefungen/m522-audit-daten.mjs`, 41 Prüfpunkte: echte App aus `dist/` und ein „Labor" (echter Speicher und Abgleich
ohne Oberfläche, aus dem Quelltext gebündelt; Sync-Ordner als nachgebaute Ordner-API).

## Nachweis
Gegen den Stand vor M522 (`PN_DIST`/`PN_QUELLE` auf den alten Baum): **9 bestanden, 32 fehlgeschlagen** — rot sind
A1–A5, A7 (Link), B1–B5 (beschädigter Stand), C1–C7 (Sync-Ordner), D1–D4 (Team-Paket), E1–E3, E6 (Grabsteine),
F2, F6, H1, H2 (Leseschutz) und G1 (Seitenfehler beim Link). Mit M522: **41 von 41**.

## Grenzen / offen
Siehe „Offen". Supabase: nichts geändert, keine Migration nötig. Hilfe-Texte: unverändert (es gibt nichts Neues zu
bedienen).
