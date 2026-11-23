# Audit November 2026

Vier Durchgänge: Code (M388), Oberfläche (M389), Logik im Tool (M390), Zusammenarbeit im Team (M391).
Jeder Fund wurde am Code nachgeprüft, bevor er behoben wurde. Status: ✅ behoben · ⏳ offen · ➖ bewusst nicht geändert (mit Grund).

## 1 · Code-Audit (M388)

### 1.1 Statische Prüfung

| Nr | Fund | Status |
|----|------|--------|
| C1 | 34 ungenutzte Deklarationen (Importe, Store-Abos in den Einstellungen, toter `copyHtml`) | ✅ entfernt; `noUnusedLocals`/`noUnusedParameters` jetzt im Build an |
| C2 | 26 nie benutzte Exporte, zwei tote Module (`lib/fahne.ts`, `seed.ts`) | ✅ entfernt |
| C3 | `xlsx.ts`: Zweig für Text-Ergebnisse von Formeln (`t="str"`) nie erreichbar — „&amp;" kam roh an | ✅ |
| C4 | `CalendarCard`: frisches `[]` je Durchlauf ließ die Terminberechnung bei jedem Rendern neu laufen | ✅ |
| C5 | Abhängigkeiten mit bekannten Lücken: dompurify (kritisch), prosemirror-view (XSS beim Einfügen), markdown-it, katex, mermaid | ✅ aktualisiert (`npm audit fix`) |
| C6 | Übrig: 22 „moderate" Meldungen in tiptap/uuid — nur über BlockNote 0.31 → 0.57 lösbar (großer Versionssprung) | ➖ eigener Schritt, nicht im Audit |

### 1.2 Sicherheit

| Nr | Schwere | Fund | Status |
|----|---------|------|--------|
| S1 | kritisch | „Live"-Tool-Karte bettet jede Adresse ein — auch `javascript:` (läuft im Namen von PixiNotes; über ein geteiltes Board auslösbar) | ✅ nur fremde http(s)-Adressen werden eingebettet (`lib/sicher.ts`), sonst Hinweis |
| S2 | kritisch | Word-Vorschau (docx-preview) führt eingebettetes HTML (altChunk) ohne Sandbox aus; Verweise ungefiltert | ✅ altChunk aus; Skripte, Rahmen, Ereignis-Attribute und fremde Verweise werden aus der Vorschau entfernt |
| S3 | hoch | Rückkehr vom Anmelde-Link nimmt jedes `#access_token=…` an — fremdes Konto ließe sich unterschieben, eigene Boards würden dorthin hochgeladen | ✅ Rückfrage, wenn der Link nicht auf diesem Gerät angefordert wurde oder ein anderes Konto ersetzen würde |
| S4 | hoch | `triggerDownload` klickt jede Adresse aus dem Board an (auch `javascript:`) | ✅ nur `data:`/`blob:` werden gespeichert; fremde Webadressen öffnen einen neuen Tab; alles andere wird ignoriert |
| S5 | hoch | Live-Kanal: Inhalte (`karte`, `delta`, `zeig`, Sperren) gelangen ungeprüft in den Stand; Nur-Lese-Gäste können senden; Karte ohne Lage bringt alle zum Absturz | ✅ alles aus dem Kanal wird geprüft (Form, Absender anwesend, Zeit); kaputte Stücke fallen weg · Kanäle mit Server-Prüfung der Teilnehmer: ➖ setzen ein Konto je Teilnehmer voraus (§4) |
| S6 | mittel | `nodeToHtml`: `progress`, `kind`, `date` ohne Escaping → Skript beim PDF-/Druck-Export | ✅ |
| S7 | mittel | Anhänge-Adressen 10 Jahre gültig — Widerruf eines Links beendet den Zugriff nicht | ✅ neue Adressen gelten 30 Tage und erneuern sich selbst · früher ausgestellte bleiben bis zu ihrem Ablauf gültig (lassen sich nur durch Löschen der Datei entwerten) |
| S8 | mittel | „Board im Link" / `.pixiboard.json` enthalten Einladungs-Token und E-Mail des Besitzers | ✅ beides wird vor dem Weitergeben entfernt |
| S9 | mittel | Gast-Rechte („nur Eigenes") serverseitig nur für Karten geprüft, nicht für Verbindungen/Striche/Kommentare; `board_aendern` prüft sie gar nicht | ✅ Form jedes vom Gast geschriebenen Stücks prüft der Server (Migration `inhalt_pruefen` — liegt bereit, Einspielen braucht die Bestätigung des Besitzers; bis dahin prüft die App allein) · „nur Eigenes" gilt jetzt auch für Verbindungen und Striche — in der App und auf dem Server (Migration `team_haertung`, M391); Kommentare ➖ (§4) |
| S10 | niedrig | Speicher-Meldungen der Tools ohne Absender-Prüfung | ✅ nur der eigene Rahmen und selbst geöffnete Tabs |
| S11 | niedrig | Bild-/Dateiquellen aus fremden Boards können fremde Server ansprechen (IP sichtbar) | ➖ Bilder aus dem Netz sind eine gewollte Funktion (Bild per Adresse); wer ein fremdes Board übernimmt, wird vorher gefragt |

### 1.3 Store und Kernlogik

| Nr | Fund | Status |
|----|------|--------|
| K1 | „Rückgängig" im Hinweis ruft immer „Gelöschtes wiederherstellen" — nach Strg+Z oder nach „Verschieben" entstehen doppelte Karten | ✅ |
| K2 | Kommentare sind nicht Teil der Rückgängig-Schritte — nach Löschen/Verschieben + Strg+Z sind sie weg oder verwaist | ✅ Kommentare sind Teil jedes Schritts und des Papierkorb-Stands |
| K3 | Rechen-Tabelle: leere Zellen zählen als 0 (`MITTELWERT`, `ANZAHL`, `MIN`, `PRODUKT`) | ✅ |
| K4 | `WENN` meldet den Fehler des nicht gewählten Zweigs (`=WENN(B1=0;0;A1/B1)` → `#DIV/0!`) | ✅ |
| K5 | Excel-Import: Komma als Trenner, `$A$1`, geteilte Formeln, Uhrzeiten, eigene Datumsformate | ✅ |
| K6 | Board/Projekt duplizieren kopiert große Dateien und Tool-Quelltexte nicht mit | ✅ (`lib/anhangKopie.ts`) |
| K7 | wie S8 | ✅ |
| K8 | `importBoard` lässt Kommentare und Hintergrund fallen | ✅ |
| K9 | Text aus Notiz-Tabellen fehlt in Suche, KI-Kontext, Text-Export | ✅ |
| K10 | „Letzten Import zurücknehmen" verwirft alle Arbeit seit dem Import | ✅ entfernt nur noch das Importierte |
| K11 | Notiz → Kalender erkennt „am 3.12." nicht | ✅ |
| K12 | Rückgängig: Schnelleintrag auf anderem Board nicht rücknehmbar; nach Strg+Z frisst Tipp-Bündelung den Schritt | ✅ |
| K13 | ICS: Ende um 00:00 als zusätzlicher Tag; Export-Ende vor Beginn (23:30); Monatsrhythmus läuft über (31.01. → 03.03.) | ✅ |
| K14 | Rückverweise und Aufgaben: ganze Umgebung wird bei jeder Änderung neu durchsucht | ✅ gemerkt je Board-Stand (Texte, Titel-Index, Datums-Funde) |
| K15 | Alt+Z (Zeichnen) liegt auf deutscher Tastatur auf Y | ✅ |
| K16 | „Heute" aus UTC: zwischen 0 und 2 Uhr gilt gestern (`HEUTE()`, Vorlagen, Anordnen, Aufgaben, Zeiterfassung, Fokus) | ✅ (`lib/tag.ts`) |
| K17 | `RUNDEN(1,005;2)` → 1; Zahlenerkennung zerlegt Telefonnummern/PLZ | ✅ RUNDEN; Zahlenerkennung in M390 |
| K18 | Aufgaben-Protokoll schreibt ohne Schutz in den Speicher — voller Speicher blockiert „erledigt" | ✅ |

### 1.4 Bauteile (React)

| Nr | Fund | Status |
|----|------|--------|
| R1 | Jede Board-Änderung (auch jeder Zieh-Schritt) rechnet Aufgaben der ganzen Umgebung neu; viele Karten hängen an `boards` | ✅ die teuren Teile sind gemerkt (K14); die breiten Abos selbst bleiben — sie rechnen jetzt nur noch nach |
| R2 | Esc im Fokus schließt den Fokus statt des offenen Ticket-Fensters/der Bild-Lupe; in der Präsentation schließt Esc Fenster und Präsentation zugleich | ✅ |
| R3 | Board-Kürzel (N, F, Strg+Z, +/−) wirken durch offene Fenster hindurch | ✅ (`lib/overlay.ts`) |
| R4 | Leere Notiz zieht bei jedem Öffnen des Boards den Cursor an sich (Tastatur am Telefon, Sperre im Team) | ✅ nur frisch angelegte Notizen |
| R5 | Leertaste auf Knöpfen wirkungslos, solange das Board offen ist | ✅ |
| R6 | Anordnen/KI/Handschrift schreiben auf das gerade aktive Board, nicht auf das, wo sie begannen | ✅ (`lib/zielBoard.ts`) |
| R7 | Fenster ohne Fokus-Führung; Tab in der Präsentation tot | ✅ Tab in der Präsentation; Fokus-Führung der Fenster in M389 (U11) |
| R8 | Ticket ziehen und Board schwenken gleichzeitig (Touch außerhalb des Fokus) | ✅ in M390 |
| R9 | Auswahl-Leiste und Zeichen-Ebene rechnen je Bild neu | ➖ gemessen in M390: 60 Bilder/s |
| R10 | Kommentar-Entwurf wandert in den nächsten Faden | ✅ |
| R11 | Suche: Antwort einer überholten Frage erscheint | ✅ |
| R12 | wie K16 | ✅ |
| R13 | Datei-Karte: Objekt-Adresse wird nie freigegeben | ✅ |
| R14 | Raster-Farbe folgt dem Hell/Dunkel-Wechsel erst später | ✅ Farbe kommt aus dem Stylesheet |

### 1.5 Abgleich und Datensicherheit

| Nr | Fund | Status |
|----|------|--------|
| A1 | Abmelden räumt Merkzeichen und Abgleich-Basis weg — nach erneutem Anmelden ersetzt der Server-Stand still alles Lokale; „Anmeldung abgelaufen" entsteht schon bei kurzem Offline; Abmelden meldet alle Geräte ab | ✅ Merkzeichen bleibt; Netzfehler ist kein Abmelden; Abmelden gilt nur für dieses Gerät |
| A2 | Vom Gast geschriebener Board-Inhalt wird nicht geprüft: fremde `id` im Inhalt überschreibt ein anderes Board des Besitzers; kaputter Inhalt gilt als „gelöscht"; ungültige Stücke lassen den Abgleich abstürzen | ✅ im Programm (`boardVonAussen`); auf dem Server mit der Migration `inhalt_pruefen` (liegt bereit) |
| A3 | Schlägt das Lesen eines geteilten Boards fehl, gilt der lokale Stand (mit Ungesichertem) als Server-Stand — die Änderungen gehen nie hinaus | ✅ es gilt der zuletzt gelesene Stand |
| A4 | Konflikt beim ersten Anmelden lässt sich nicht zugunsten des lokalen Stands auflösen („Jetzt hochladen" scheitert immer) | ✅ ohne Basis wird vereinigt statt abgelehnt |
| A5 | Tabellen-Abfragen filtern nur nach Name — bei gleicher Board-Kennung (eigene und geteilte Zeile) wird die falsche gelesen | ✅ |
| A6 | „Anmeldung nötig" wird nach erfolgreichem Erneuern nicht zurückgesetzt — Live-Abgleich bleibt für die Sitzung aus | ✅ |
| A7 | Fehlgeschlagenes Schreiben eines Link-Gasts wird nicht wiederholt | ✅ wiederholt mit wachsendem Abstand und sobald das Netz zurück ist |
| A8 | WebDAV: Schreiben ohne Vorbedingung — zwei Geräte überschreiben einander | ✅ in M390 |
| A9 | Konto löschen lässt die Dateien im Speicher zurück (und scheitert daran) | ✅ |
| A10 | Mitgelesene Karte: gefälschte Felder (`archived`, Art, Größe) bleiben nach dem Loslassen stehen und gehen mit dem nächsten Speichern hinaus | ✅ übernommen werden nur Inhalt, Lage, Größe |
| A11 | Abgelehnter Kanal-Beitritt wird nie wiederholt; „live verbunden" wird fälschlich angezeigt | ✅ Konto-Kanal · Live-Kanal der Boards (M391): Ablehnung und Kanal-Ende bauen die Leitung neu auf |
| A12 | wie S9; dazu: `p_stempel` unbegrenzt, `freigabe_schreiben` ohne Version legt Zeilen an | ✅ Migration `team_haertung` (M391): Stempel höchstens 200 Zeichen; `freigabe_schreiben` legt keine Zeile mehr an |
| A13 | Entgegengesetzte Sperr-Reihenfolge in `konto_schreiben` und den Gast-Funktionen (Deadlock möglich) | ✅ Migration `team_haertung` (M391): `konto_schreiben` sperrt erst die Dateien, dann die Umgebung — wie alle Gast-Funktionen |
| A14 | Aufräumen beim Start löscht Tool-Quelltexte, die per Ordner/WebDAV kamen und noch nie geöffnet wurden | ✅ |

## 2 · UI-Audit (M389)

Vorgehen: Jede Ansicht auf drei Geräten (Laptop 1440, Tablet 820 mit Finger, Telefon 390) in Hell und Dunkel
durchfahren, fotografiert und vermessen — Kontrast jedes Bedienelements, Größe jedes Tippziels, Überdeckungen,
Abgeschnittenes, Elemente außerhalb des Bildes; dazu alle 18 Beispiel-Boards. Vor dem Aufräumen des Stylesheets
ein Bild-für-Bild-Vergleich (37 von 38 identisch, eines mit 5 Bildpunkten Schreibmarke).

| Nr | Fund | Status |
|----|------|--------|
| U1 | Weiße Schrift auf Akzentfarbe: 3,1–4,4:1 statt 4,5:1 — Start-Knopf, aktive Reiter und Filter, Zähler, alle „an"-Knöpfe (31 Regeln), in allen fünf Akzentfarben | ✅ eigene Stufe `--accent-fill` |
| U2 | Akzent als Schrift: 3,5–3,7:1 (aktiver Reiter der Einstellungen, Verweise, Termine „heute"; im Dunkeln auf getönten Flächen) | ✅ `--accent-strong`, im Dunkeln je Akzent eine hellere Stufe |
| U3 | „Impressum · Datenschutz" im Dunkeln mit 2,3:1 | ✅ |
| U4 | Punkte der Präsentation 9 × 9 Punkte | ✅ zu sehen 9, zu treffen 24 × 32 (Finger 36 × 40) |
| U5 | Tippziele am Finger unter 40 Punkten: „⋮" und Aufklapp-Pfeile der Navigation, Farbpunkte im Kartenmenü, „Übersicht"/„Neu" am Telefon, Knöpfe der Präsentations-Kopfzeile; mit Maus: Schließen-Kreuz 25 × 20, Pfeile 17 × 17 | ✅ |
| U6 | Tablet, Karte im Fokus: Das Kartenmenü ragte oben aus dem Bild — die ersten Einträge lagen unter der Kopfzeile | ✅ bleibt darunter und rollt bei Bedarf |
| U7 | Fokus-Leiste: „▶ Präsentieren" stand als zweizeiliger, ungestaltet wirkender Knopf da (Zeichen über dem Wort) | ✅ |
| U8 | Telefon: Die Übersicht zeigte die ganze Umgebung als Briefmarke (Kacheln 30 Punkte breit) | ✅ Projekte untereinander, zwei Kacheln je Zeile, an die Breite angepasst |
| U9 | Telefon: Tipp auf die Vorschau einer Kachel öffnete blind eine einzelne Karte im Fokus statt des Boards | ✅ mit dem Finger öffnet die Kachel das Board |
| U10 | Knöpfe, die nur ein Zeichen zeigen, verloren nach dem ersten Überfahren ihren Namen (title wandert in die Sprechblase) | ✅ bleibt als `aria-label` |
| U11 | Fenster ohne Fokus-Führung (aus dem Code-Audit, R7): Tab wanderte durch das Board dahinter, nach dem Schließen stand der Fokus irgendwo | ✅ `lib/fensterFokus.ts` — für alle Fenster |
| U12 | Mindmap ohne Farbschema: jede zweite Ebene (Kästen und Äste) auf dem Board-Grund unsichtbar | ✅ |
| U13 | Hohe Diagramme (Ablauf von oben nach unten) in der Karte abgeschnitten, der Anfang nicht einmal durch Rollen erreichbar | ✅ passt immer ganz hinein |
| U14 | Beispielprojekt: Kanban ragte aus dem Rahmen „Umsetzung", Kalender überlappte ihn; Wochenplan-Einträge mitten im Wort abgeschnitten | ✅ |
| U15 | 38 CSS-Klassen ohne Verwendung (75 Regeln, 9 KB) | ✅ entfernt |
| U16 | Kopfleiste am Laptop: freie Fläche links von Rückgängig (die Suche steht dort in der Spalte) | ➖ gewollt: Die Leiste ist so breit wie die Spalte darunter |

## 3 · Logik-Audit (M390)

Vorgehen: Drei Durchgänge im laufenden Programm (Headless-Browser, als Nutzer geklickt und getippt) — Karten und
Boards, Planungs-Module, Ein-/Ausgabe und Präsentation; mit gestellter Uhr und in drei Zeitzonen. Jeder Fund wurde
zweimal nachgestellt, bevor er hier landete.

| Nr | Schwere | Fund | Status |
|----|---------|------|--------|
| L1 | hoch | Relative Fristen („bis Freitag", „morgen") wandern mit dem Tag des Ansehens und werden nie überfällig; Notiz und eingesammeltes Ticket widersprechen sich | ✅ jede relative Angabe merkt sich den Tag, an dem sie geschrieben wurde (Anker je Absatz); Altbestand bekommt den Tag des ersten Starts |
| L2 | mittel | Board löschen kennt archivierte Boards nicht: springt auf ein archiviertes; löscht das letzte sichtbare | ✅ archivierte Boards zählen nicht als Arbeitsfläche |
| L3 | mittel | Board umbenennen bricht `[[Verknüpfungen]]`; der Klick legt ein leeres Board mit altem Namen an (immer im ersten Projekt) | ✅ Umbenennen schreibt die Verknüpfungen in allen Notizen mit; ein per Klick angelegtes Board landet im Projekt der Notiz |
| L4 | mittel | Ohne eigenen Rückgängig-Schritt: Etikett/Art einer Verbindung, Größe ziehen, Pfeiltasten — Strg+Z nimmt den Schritt davor mit | ✅ Etikett, Art und Stil einer Verbindung, Größe ziehen und Pfeiltasten sind je ein eigener Schritt |
| L5 | mittel | Strg+Z im Notiztext, danach Strg+Z auf dem Board holt den entfernten Text zurück | ✅ das Rückgängig im Text legt auf dem Board keinen eigenen Schritt mehr an |
| L6 | mittel | Rahmen in Mehrfachauswahl oder per Pfeiltasten bewegt: Inhalt bleibt liegen | ✅ jeder bewegte Rahmen nimmt seinen Inhalt mit — auch in der Mehrfachauswahl und per Pfeiltasten |
| L7 | mittel | Archiv ausgeblendet: archivierte Karte bleibt unsichtbar gewählt, Entf löscht sie | ✅ beim Ausblenden des Archivs fällt Unsichtbares aus der Auswahl |
| L8 | mittel | Tasten wirken durch Fenster und andere Ansichten: Entf, Alt+A, Strg+A, Alt+→, Alt+Z, Alt+P | ✅ hinter einem offenen Fenster wirkt keine Board-Taste mehr |
| L9 | mittel | Mehrere Karten duplizieren/färben: je Karte ein Rückgängig-Schritt; Kopien stapeln sich deckungsgleich; Verbindungen zwischen den Kopien fehlen | ✅ Duplizieren und Färben mehrerer Karten sind ein Schritt; Kopien liegen versetzt, Verbindungen zwischen ihnen kommen mit |
| L10 | niedrig | „Rückgängig" im Hinweis: nimmt nach weiterer Arbeit den falschen Schritt; nach Wiederherstellen löscht Strg+Z erneut; Verlauf am falschen Board | ✅ der Knopf nimmt genau die gemeldete Handlung zurück und verfällt, sobald weitergearbeitet wurde |
| L11 | niedrig | Abgehakte Punkte behalten ihre Frist-Marke („überfällig!") | ✅ |
| L12 | niedrig | Archiv: Alt+→ blättert auf archivierte Boards; Hinweis nennt falschen Ort; „Alle archivieren (2)" archiviert eines; archivierte Karte bleibt beim Rahmen-Zug liegen; Projekt-Kopie: Portale zeigen aufs Original | ✅ alle fünf |
| L13 | hoch | Zeitplan: „heute" in Weltzeit und gerundet — ab 13 Uhr gilt morgen (neue Vorgänge, Heute-Linie) | ✅ |
| L14 | hoch | Kanban: „Erledigt"-Spalte löschen macht laufende Tickets zu erledigten | ✅ erst die Spalte davor leeren — die Meldung sagt, warum |
| L15 | hoch | Aufgaben-Zentrale: Punkte der Protokoll-Reihe lassen sich nicht abhaken, zählen aber als „geschafft" | ✅ abhaken in der Zentrale hakt im Protokoll ab |
| L16 | mittel | Protokoll: Vermerk „(offen seit 09.11.26)" wird als Frist gelesen — jeder vertagte Punkt ist sofort überfällig | ✅ der Vermerk ist kein Termin |
| L17 | mittel | Zeiterfassung über Mitternacht verliert die Zeit nach 0 Uhr | ✅ der Abschnitt endet um Mitternacht, der Rest steht am neuen Tag |
| L18 | mittel | Rechen-Tabelle liest anders, als sie zeigt: „3.000" eingetippt wird 3; „2026" erscheint als „2.026" | ✅ gelesen wird, wie gezeigt wird („3.000" ist 3000, „1.5" bleibt 1,5). ➖ Die Anzeige mit Tausenderpunkt bleibt, damit Zahlen und Summen gleich aussehen; eine Jahreszahl als Text schreibt man mit Hochkomma |
| L19 | mittel | Sammel-Kanban: „Zurück" aus Erledigt prallt zurück; Änderungen an Titel und Frist werden vom Abgleich überschrieben | ✅ „Zurück" öffnet die Quelle wieder (Zeitplan auf 90 %, Ticket eine Spalte zurück); Titel und Frist schreiben in die Quelle durch, bei Notiz-Punkten sind sie dort zu ändern |
| L20 | mittel | Strg+Z nach „Weiter" an einem eingesammelten Ticket hinterlässt einen Stand, den es nie gab (zwei Schritte für einen Handgriff) | ✅ ein Handgriff, ein Schritt |
| L21 | mittel | Kalender: Zeitplan-Vorgänge doppelt; Schalter „Meilensteine"/„Balken" blenden sie nicht aus; Balken über 120 Tage reißen ab | ✅ Vorgänge erscheinen einmal und folgen ihren Schaltern; Balken bis zwei Jahre |
| L22 | mittel | Zeiterfassung ab UTC+13: Tageswechsel klemmt, Woche verschoben | ✅ Kalender-Rechnen in Ortszeit |
| L23 | mittel | Schnelleingabe der Zentrale legt die Aufgabe in ein archiviertes Kanban | ✅ |
| L24 | niedrig | Kleineres: zurückgeholtes Ticket wird wieder auto-archiviert; Zeiterfassung erlaubt Beginn nach Ende; Tagesnotiz ab Folgetag „überfällig"; zweiter Klick auf Auto-Summe summiert die Summe mit; Wochenplan: Zeilenwechsel verschiebt Blöcke | ✅ alle fünf (das zurückgeholte Ticket behält sein Erledigt-Datum; die Archiv-Frist zählt ab dem Zurückholen) |
| L25 | hoch | Gesamt-Sicherung, Board-Datei und „Board im Link" sind nicht vollständig: Vorlagen, Tool-Quelltexte und große Dateien fehlen ohne Hinweis — nach „Alles leeren" endgültig weg | ✅ Sicherung und Board-Datei tragen Vorlagen, Tool-Quelltexte und Dateien mit; der Link sagt ehrlich, was er nicht tragen kann |
| L26 | mittel | Karte duplizieren / aus Vorlage einfügen: Datei- und Tool-Karten kommen leer an | ✅ |
| L27 | mittel | Anzeigegröße ab 130 %: Fenster und ＋-Menü ragen aus dem Bild, unterste Bedienelemente unerreichbar | ✅ alle Maße an der Bildschirmhöhe rechnen die Anzeigegröße ein (geprüft bei 150 % auf 1280×720) |
| L28 | mittel | `.txt` wird als Markdown gelesen (Text geht verloren); Markdown-Export maskiert nichts | ✅ `.txt` bleibt Text, Zeile für Zeile; der Markdown-Export maskiert Zeichen mit Bedeutung |
| L29 | niedrig | Die 21. Karten-Vorlage verdrängt still die älteste | ✅ Obergrenze 40 — und eine Meldung statt stillem Verdrängen |
| L30 | niedrig | Reihenfolge: Teilen/Kopieren und Blättern im Fokus folgen der Anlege- statt der Lesefolge | ✅ überall die Lesefolge (zeilenweise von links oben) |
| L31 | niedrig | English: Rückfrage „Alles leeren" deutsch; Export-Gerüst deutsch | ✅ Rückfrage übersetzt. ➖ Das Gerüst exportierter Dokumente bleibt deutsch — es ist Teil des Dokuments, nicht der Oberfläche |

Aus dem Code-Audit hierher verschoben: K17 Zahlenerkennung ✅ (Telefonnummern, Postleitzahlen und Kennungen bleiben
Text) · R8 ✅ nachgestellt und behoben (Ticket am Finger: Board schwenkt nicht mehr mit) · R9 ➖ gemessen: 300 Striche,
60 Karten, Auswahl — Schwenken bleibt bei 60 Bildern/s · A8 ✅ WebDAV schreibt mit Vorbedingung (`If-Match`), wo der
Server sie zulässt.

## 4 · Team-Audit (M391)

Vorgehen: Die Zusammenarbeit von Anfang bis Ende durchgespielt — als Besitzerin ohne und mit Konto, als Gast am
Laptop und am Telefon — und gezählt, was man sieht, bevor man etwas tun kann. Leitlinie: Ein Hauptweg je Fenster;
in Ruhe zeigt die Oberfläche einen Zustand, keine Werkzeugsammlung.

| | vorher | jetzt |
|---|---|---|
| Einladungs-Dialog: Wörter | 212 | 25 |
| Einladungs-Dialog: sichtbare Bedienelemente (ohne Link / mit Link) | 8 / 11 | 4 / 6 |
| Leiste der Gruppe: Knöpfe (allein / zu dritt) | 4 / 7 | 1 / 2 |
| Schritte bis jemand ohne Konto mitarbeiten kann | Menü → Haken setzen → Link erstellen | Menü → Link erstellen |

| Nr | Schwere | Fund | Status |
|----|---------|------|--------|
| T1 | hoch | Ohne Konto fehlte der Menüpunkt „Gemeinsam bearbeiten" ganz — die Funktion war nicht zu finden | ✅ der Punkt ist immer da; der Dialog sagt in zwei Sätzen, was fehlt, und führt mit einem Knopf zur Anmeldung |
| T2 | hoch | Einladungs-Dialog: 212 Wörter, elf Bedienelemente, zwei gleichrangige Wege, eine Fußnote aus fünf Sätzen; in der Vorgabe brauchten Gäste ein Konto | ✅ ein Hauptknopf („Einladungslink erstellen"), Vorgabe „mitmachen ohne Konto"; Rolle, Rechte, Widerrufen und die E-Mail-Einladung sind eingeklappt; ein Satz sagt, was der Link gerade kann |
| T3 | hoch | Leiste der Gruppe: bis zu sieben runde Symbol-Knöpfe (Name, Liste, QR, 📣, 😀, ⏱, Zeiger) — nur per Überfahren zu deuten | ✅ ein Knopf zeigt, wer da ist; dahinter stehen die Werkzeuge mit Namen. Sichtbar bleibt nur „Reagieren" (ein Tipp, braucht jeder). Was läuft, zeigt sich selbst: das Band „Du führst vor", die Uhr des Timers |
| T4 | mittel | Telefon: Die Leiste lag über dem Board-Namen der Kopfzeile | ✅ sie ist schmal genug und überdeckt keinen Knopf; die Liste bleibt im Bild, ihre Zeilen sind 44 px hoch |
| T5 | mittel | Gast per Link sah neben dem einen Board einen leeren eigenen Bereich („Arbeit › Allgemein 0") | ✅ wer nur Gast ist, sieht nur, worum es geht; mit dem ersten eigenen Board sind die Bereiche da |
| T6 | mittel | Am fremden Board bot das Menü Umbenennen, Archivieren und Löschen — es wirkte nur auf dem eigenen Gerät oder kam beim nächsten Abgleich wieder | ✅ für Gäste: „Verlassen …" statt der drei |
| T7 | mittel | „Gemeinsam bearbeiten …" und „Per Link teilen …" standen nebeneinander — beides Links, der Unterschied (live oder Kopie) stand nirgends | ✅ „Kopie per Link teilen …"; eigenes Symbol für das Gemeinsame |
| T8 | mittel | „Nur Eigenes" schützte Karten, aber nicht die Verbindungen dazwischen (App und Server) und Striche nur in der App | ✅ eine Verbindung trägt, wer sie gezogen hat; fremde bleiben, solange ihre Karten bleiben — bei „eigenes" auch unverändert. Der Server prüft Verbindungen und Striche mit (Migration `team_haertung`) |
| T9 | mittel | Lehnte der Server den Beitritt zum Live-Kanal ab oder endete der Kanal, blieb es bei „verbindet …" bzw. bei einer stummen Verbindung | ✅ die Leitung wird mit wachsender Pause neu aufgebaut — ohne auf ein Schließen zu warten, das bei stummer Gegenstelle nicht kommt |
| T10 | niedrig | Befehl „QR-Code zum Mitmachen" ohne Link: nur ein Hinweis, wo der Link anzulegen wäre | ✅ der Dialog geht gleich auf; neuer Befehl „Gemeinsam bearbeiten" in Strg+K |
| T11 | niedrig | Das Recht des Gasts stand als Kürzel in der Leiste („🔒 nur Eigenes ändern"), am Telefon gar nicht | ✅ als ganzer Satz in der Liste — auf jedem Gerät |
| T12 | mittel | Vom Board aus führte kein Weg zur Zusammenarbeit — nur über „⋯" am Board-Namen in der linken Spalte, die es am Telefon nicht gibt | ✅ „Gemeinsam bearbeiten …" steht auch im „⋮" des Docks (Abschnitt Board) |

Bewusst nicht geändert: ➖ **Kommentare** bleiben ein Gespräch — sie tragen einen Namen, keine Kennung; die App lässt
jeden nur die eigenen Beiträge ändern, der Server kann einen Namen nicht prüfen. ➖ **Private Kanäle** (Server prüft
jeden Teilnehmer) setzen ein Konto je Teilnehmer voraus — Gäste per Link haben keins. Der Kanalname ist ein Geheimnis,
das nur der Server an Berechtigte ausgibt; alles aus dem Kanal wird in der App geprüft (S5), und der Stand selbst
kommt immer vom Server. ➖ **Reaktionen, Timer, Punkte, QR-Einblendung** sind unverändert — sie waren im Durchgang
ohne Befund.

Server: Die Migrationen `inhalt_pruefen` (M388) und `team_haertung` (M391) liegen im Repository und sind gegen ein
lokales Postgres geprüft (`m388b`, `m391b`). Einspielen braucht die Bestätigung des Besitzers der Datenbank; bis dahin
gilt, was die App prüft. Die App läuft mit und ohne sie.

## 5 · Barrierefreiheit (M447)

Vorgehen: Automatischer Durchgang mit Playwright in Hell **und** Dunkel (`pruefungen/m447-barrierefreiheit.mjs`) über
Kopfleiste, Seitenleiste, Dock, Auswahl-Leiste, beide Kontextmenüs, Einstellungen (alle Reiter), Hilfe, Suche (Strg+K),
Aufgaben-Zentrale, Übersicht und Karten-Fokus. Gemessen: zugänglicher Name jedes Bedienelements und Felds, Kontrast jeder
Schrift gegen den tatsächlich darunterliegenden Grund (aus `getComputedStyle` gerechnet, durchscheinende Schichten und
Deckkraft der Vorfahren eingerechnet, feste Leisten über `elementsFromPoint`), sichtbarer Fokus bei jedem Tab-Schritt
(Ring, Schatten, Randfarbe oder Grund ändert sich), Fenster (role, aria-modal, Fokus hinein, Tab im Kreis, Esc, Fokus
zurück), Tab-Reihenfolge bis ins Dock, `prefers-reduced-motion`, Tippziele am Tablet. Dazu eine Durchsicht aller
Fenster im Quelltext. Ohne Befund blieben: Namen (keine namenlosen Knöpfe, alle Felder beschriftet), Kontraste im
Dunkeln, Einstellungen, Hilfe, Suche, Karten-Fokus, Übersicht, reduzierte Bewegung, Tippziele.

| Nr | Fund | Status |
|----|------|--------|
| B1 | „Impressum · Datenschutz" im Hellen mit 3,7:1 (Deckkraft 0,8) | ✅ volle Deckung |
| B2 | Tab auf dem Board kreiste ohne Ausweg durch die Karten — Auswahl-Leiste und Dock waren per Tab nicht erreichbar (WCAG 2.1.2) | ✅ nach der letzten Karte (Umschalt+Tab: vor der ersten) verlässt Tab die Fläche |
| B3 | Aufgaben-Zentrale: Der Fokus blieb beim Öffnen auf dem ausgehängten Board, nach dem Schließen stand er nirgends | ✅ Fokus hinein, beim Schließen zurück auf den Knopf |
| B4 | Aufklapp-Knöpfe ohne Zustand: Dock „+", „Zeichnen", „Mehr"; Auswahl-Leiste „Mehr", „Rahmen" | ✅ `aria-expanded` + `aria-haspopup` |
| B5 | Das Menü einer Karte (⋯ und Rechtsklick) war für Vorlese-Programme eine lose Knopfsammlung — das Menü der Fläche dagegen ein Menü | ✅ `role="menu"`, Einträge `menuitem` |
| B6 | Fenster ohne `aria-modal`: Recherche, Kanban (Einsammeln, Archiv, Ticket) | ✅ |
| B7 | Nachschlagen ohne `role="dialog"` | ✅ |
| B8 | Bild-Lupe ohne `role="dialog"` und ohne Fokus-Führung (Tab lief ins Board dahinter) | ✅ gehört jetzt zu `lib/fensterFokus.ts` |
| B9 | Hilfe-Suchfeld zeigt den Fokus nur als Randfarbe (kein Ring) | ➖ Randfarbe im Akzent ist ein sichtbarer Fokus (2.4.7); die Prüfung vergleicht mit und ohne Fokus |
| B10 | Suchfelder ohne sichtbares Etikett, benannt über Platzhalter bzw. `aria-label` | ➖ Chrome und Vorlese-Programme lesen beides als Namen; ein Etikett je Suchfeld widerspräche dem ruhigen Leitbild — die Prüfung lässt den Platzhalter gelten |
| B11 | Navigation als Ausklapp-Spalte am Telefon (`.nav-panel`): `role="dialog"` ohne `aria-modal` und ohne Fokus-Falle | ✅ M456: `aria-modal`, Fokus-Führung über `lib/fensterFokus.ts` (`.nav-backdrop`), Hintergrund `inert`, Auslöser mit `aria-expanded`/`aria-controls` — die Abdunklung deckt die Kopfleiste ohnehin, eine Ausnahme braucht es nicht |
| B12 | Vor dem Board liegen am Laptop rund 50 Tab-Stationen der Navigation | ➖ F6 springt von Bereich zu Bereich (M345), Strg+K sucht |
| B13 | Einstellungen › Dienste › „KI-Programme von außen (MCP)": Verweis „pixinotes-mcp.mjs laden" in `--accent` mit 3,5:1 | ✅ `--accent-strong` |
