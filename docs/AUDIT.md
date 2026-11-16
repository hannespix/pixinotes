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
| S5 | hoch | Live-Kanal: Inhalte (`karte`, `delta`, `zeig`, Sperren) gelangen ungeprüft in den Stand; Nur-Lese-Gäste können senden; Karte ohne Lage bringt alle zum Absturz | ✅ alles aus dem Kanal wird geprüft (Form, Absender anwesend, Zeit); kaputte Stücke fallen weg · Kanäle mit Server-Prüfung der Teilnehmer: ⏳ M391 |
| S6 | mittel | `nodeToHtml`: `progress`, `kind`, `date` ohne Escaping → Skript beim PDF-/Druck-Export | ✅ |
| S7 | mittel | Anhänge-Adressen 10 Jahre gültig — Widerruf eines Links beendet den Zugriff nicht | ✅ neue Adressen gelten 30 Tage und erneuern sich selbst · früher ausgestellte bleiben bis zu ihrem Ablauf gültig (lassen sich nur durch Löschen der Datei entwerten) |
| S8 | mittel | „Board im Link" / `.pixiboard.json` enthalten Einladungs-Token und E-Mail des Besitzers | ✅ beides wird vor dem Weitergeben entfernt |
| S9 | mittel | Gast-Rechte („nur Eigenes") serverseitig nur für Karten geprüft, nicht für Verbindungen/Striche/Kommentare; `board_aendern` prüft sie gar nicht | ✅ Form jedes vom Gast geschriebenen Stücks prüft der Server (Migration `inhalt_pruefen` — liegt bereit, Einspielen braucht die Bestätigung des Besitzers; bis dahin prüft die App allein) · „nur Eigenes" für Verbindungen/Striche/Kommentare: ⏳ M391 |
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
| K17 | `RUNDEN(1,005;2)` → 1; Zahlenerkennung zerlegt Telefonnummern/PLZ | ✅ RUNDEN · Zahlenerkennung: ⏳ M390 |
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
| R8 | Ticket ziehen und Board schwenken gleichzeitig (Touch außerhalb des Fokus) | ⏳ M390 |
| R9 | Auswahl-Leiste und Zeichen-Ebene rechnen je Bild neu | ⏳ M390 |
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
| A8 | WebDAV: Schreiben ohne Vorbedingung — zwei Geräte überschreiben einander | ⏳ M390 |
| A9 | Konto löschen lässt die Dateien im Speicher zurück (und scheitert daran) | ✅ |
| A10 | Mitgelesene Karte: gefälschte Felder (`archived`, Art, Größe) bleiben nach dem Loslassen stehen und gehen mit dem nächsten Speichern hinaus | ✅ übernommen werden nur Inhalt, Lage, Größe |
| A11 | Abgelehnter Kanal-Beitritt wird nie wiederholt; „live verbunden" wird fälschlich angezeigt | ✅ Konto-Kanal · Live-Kanal der Boards: ⏳ M391 |
| A12 | wie S9; dazu: `p_stempel` unbegrenzt, `freigabe_schreiben` ohne Version legt Zeilen an | ⏳ M391 |
| A13 | Entgegengesetzte Sperr-Reihenfolge in `konto_schreiben` und den Gast-Funktionen (Deadlock möglich) | ⏳ M391 |
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

## 4 · Team-Audit (M391)
