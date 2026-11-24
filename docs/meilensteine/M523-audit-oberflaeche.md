# M523 — Audit der Rahmen-Oberfläche: Fenster, Kürzel, Suche, Menüs, Offline-Start, Hilfe
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m523-audit-oberflaeche.mjs` (Port 5523) · Datum: 2026-11-24

Teil des Bugfixing-Audits M518–M523. Bereich: alles um das Board herum — `App.tsx`, die Komponenten außerhalb von
`nodes/` und `Board.tsx`, `src/styles/`, PWA.

## Vorgehen
Code gelesen (Tastatur, Fenster-Führung, Suche, Navigation, Einstellungen, Service Worker) und die Oberfläche mit
playwright-core gegen `dist/` bedient: erster Start, Übersicht, Navigation (anlegen, umbenennen, löschen), jede Kachel
der Modul-Palette (26, jede legt die richtige Karte an bzw. öffnet den richtigen Dialog), jeder Schalter der
Einstellungen (umschalten → neu laden → vergleichen), Suche (Umlaute, Tippfehler, Wortfolge, leer, `#`, Befehle),
Hilfe DE/EN (Abschnitte und Listen gleich lang; 42 Aussagen in der App ausprobiert), 13 Fensterstapel und Kürzel bei
offenem Fenster, KI ohne Schlüssel, Start mit zehn Adress-Anhängen, Offline-Start, Darstellung bei 360, 390, 720×450
(= 200 % Zoom), 820, 1440 und 2560 Punkten, Kontrast-Scan in Hell/Dunkel × Klassisch/pix·el über Einstellungen,
Übersicht, Kopf/Spalte/Dock, Hilfe, Suche, Aufgaben, Palette und Menüs. Jeder Befund wurde nachgestellt; die
Prüfpunkte sind gegen den Stand vor dem Fix rot und danach grün (`PN_DIST=<alter Build> node pruefungen/m523-…`).

## Befunde

| Nr | Schwere | Was der Nutzer merkt | Ursache | Status |
|----|---------|----------------------|---------|--------|
| O1 | hoch | Nach dem **ersten** Besuch (gerade nach „Als App installieren") startet die App ohne Netz als weiße Seite | Skript und Stylesheets der Seite laden, bevor der Service Worker sie übernimmt — sie fehlten im Cache; erst der zweite Besuch füllte ihn | ✅ `public/sw.js`: Installation liest die gecachte Seite und holt, was sie einbindet (F1/F2) |
| O2 | hoch | Ohne Netz ließen sich Einstellungen und Hilfe nicht öffnen, wenn sie vorher nie offen waren — der Versuch ersetzte die ganze App durch „PixiNotes lässt sich gerade nicht anzeigen" | Beide fehlten im Leerlauf-Vorladen (M446); ein gescheitertes Nachladen läuft in die äußerste Fehlergrenze | ✅ Vorladen ergänzt (Einstellungen, Hilfe DE/EN, Vorlagen, Versionen, Sicherung, Eingang, App installieren) (F3). ⏳ Die Fehlergrenze selbst: siehe „offen" |
| O3 | mittel | Zwei Fenster übereinander (Aufgaben-Zentrale + Einstellungen, Einstellungen + Hilfe, + Suche): **ein** Esc schloss alle | Jedes Fenster hört selbst auf Esc am `window`, keines fragt, ob es obenauf liegt | ✅ `lib/overlay.ts` `fensterDarueber()` — Esc gehört dem obersten (A1, A5, A8, A10) |
| O4 | mittel | Die Hilfe (Alt+H) öffnete sich **hinter** den offenen Einstellungen, die Suche (Strg+K) hinter beiden; Tab lief im verdeckten Fenster | Einstellungen, Hilfe und Suche teilen sich z-index 80 und stehen in fester Reihenfolge im Dokument | ✅ `lib/fensterFokus.ts`: Was zuletzt aufgeht, hebt sich eine Stufe über das bisher oberste; „oberstes Fenster" nach z-index statt nach Dokument (A3, A4, A6, A7) |
| O5 | mittel | Mit offenem Fenster wechselte Alt+G die Ansicht dahinter, Alt+U klappte die Spalte weg, Alt+W öffnete die Navigation hinter dem Fenster (Fokus verließ es), Alt+T die Aufgaben-Zentrale | M390 hatte nur die Board-Kürzel gesperrt; diese vier standen darüber | ✅ `Tastatur.tsx` (B1–B5) |
| O6 | mittel | Alt+T oder Strg+K „Aufgaben-Zentrale" in der Übersicht: nichts passiert — und beim nächsten Board-Wechsel springt die Zentrale unerwartet auf | `tasksOpen` wird gesetzt, die Übersicht verdeckt die Zentrale | ✅ `setTasksOpen(true)` holt die Board-Ansicht (C3, C4) |
| O7 | mittel | Aufgaben-Zentrale offen, Suche → Treffer bzw. Karte im Baum angeklickt: das Ziel bleibt hinter der Zentrale | `focusNode`/`oeffneKarte` wechseln Board und Ansicht, lassen die Zentrale aber offen | ✅ beide schließen sie (C1, C2) |
| O8 | mittel | Strg+K, „einstellungen", Enter: nichts. Befehle und Boards waren mit der Tastatur nur über Tab erreichbar (die Einführung verspricht „führt Befehle aus") | Enter kennt nur Kartentreffer | ✅ ohne Kartentreffer führt Enter den ersten Befehl aus bzw. öffnet das erste Board; die Zeile ist markiert (D1–D4) |
| O9 | mittel | Esc schließt „＋ Neu" und die ⋯-Menüs an Bereich, Projekt, Board nicht (per Tastatur geöffnet: kein Ausweg außer einem Eintrag) | Nur „Klick daneben" war verdrahtet | ✅ `lib/useEscSchliesst.ts`, Fokus zurück auf den Knopf; in der Ausstülpung schließt Esc nur das Menü (E1–E5, E9) |
| O10 | mittel | Esc schließt den Recherche-Dialog und „Karten teilen" nicht | kein Esc-Zuhörer | ✅ (E7, E8) |
| O11 | niedrig | Modul-Palette: nach Esc steht der Fokus im Leeren | das Suchfeld verschwindet mit der Palette | ✅ zurück auf „Objekt hinzufügen" (E6) |
| O12 | niedrig | Letztes Board löschen: erst die Rückfrage „wirklich löschen?", dann „Das letzte Board bleibt offen" | Rückfrage vor der Prüfung | ✅ gleich der Hinweis (E10) |
| O13 | niedrig | „Zur Übersicht" (Strg+K) landete im Netz, wenn zuletzt das Netz zu sehen war | Befehl setzt nur die Ansicht, nicht die Art | ✅ (D5) |
| O14 | niedrig | Einstellungen: Reiterwechsel öffnet den neuen Reiter mittendrin | der Rollstand des vorigen blieb | ✅ beginnt oben (G1) |
| O15 | niedrig | Einstellungen: Vorlese-Programme erfahren nicht, welcher Reiter gewählt ist | nur eine CSS-Klasse | ✅ `aria-pressed` (G2) |
| O16 | niedrig | Einführung: „alles Weitere steht in der Hilfe: ein Klick auf das Logo" — das Logo führt seit M412 zur Übersicht | Text nicht mitgezogen | ✅ nennt das Fragezeichen und Alt+H (H1, H2) |
| O17 | niedrig | Hilfe: „Dock ⋯ → Board aufräumen" — den Eintrag gibt es seit M312 nicht mehr | Text nicht mitgezogen | ✅ nennt „Anordnen & Hintergrund" (H3), DE und EN |
| O18 | niedrig | Hilfe: „im Dock sammelt alles boardübergreifend …" — Satz ohne Subjekt, und die Aufgaben stehen in der Navigation | das Symbol am Satzanfang fiel mit M397 weg | ✅ „Aufgaben in der Navigation (Alt+T) …" (H4), DE und EN |
| O19 | niedrig | Englisch, Kürzel-Tabelle: „Rechtsklick", „Ctrl+Y → wiederholen", „Ctrl+Arrowtaste" | Tastenname ohne Wörterbuch-Eintrag; „wiederholen" hält die Ernte für einen Schlüssel; „Pfeiltaste" wurde als „Pfeil"+„taste" übersetzt | ✅ (H5, H6) |
| O20 | niedrig | Übersicht (hell): Bereichsnamen in Bereichsfarbe mit 2,8:1 (Orange) bis 3,9:1 | Farbe unverändert als Schrift (im Dunkeln seit M492 gemischt) | ✅ 70 % Bereichsfarbe + Schriftfarbe: ≥ 4,7:1 (I1–I3) |
| O21 | niedrig | Beschädigter Teilen-Link (`#b=…` abgeschnitten): die App startet stumm, der Rest bleibt in der Adresse | Fehler beim Entpacken wird verschluckt | ✅ Hinweis, Adresse aufgeräumt (K1) |
| O22 | niedrig | Aus dem Teilen-Menü (Android) gekommen, aber nichts liegt bereit: die App startet stumm | `if (!g) return` | ✅ Hinweis (K2) |
| O23 | niedrig | Teilnehmer-Seite `mitmachen.html` ohne Netz: es erscheint die App unter dieser Adresse | Offline-Ersatz galt für jede Navigation | ✅ nur noch für die App-Seite (F4, F5) |
| O24 | niedrig | Englisch (Hinweis aus M520): Zeiterfassung zeigt „day" neben „Week/Month/Year"; Fristen „in 3 T."; am Beschluss „ohne TOP" | „Tag" steht im Wörterbuch klein (Einheit); das Muster im Wörterbuch hieß noch „in {1} Tagen"; die Auswahl trägt `translate="no"` (TOP-Texte des Nutzers) | ✅ Reiter per CSS groß, Muster „{0} · in {1} T.", fester Eintrag über `t()` (L1–L3) |
| O25 | niedrig | Zähl-Texte mit Klammer-Endung (Hinweis aus M520): „1 Checklisten-Punkt(e)", „3 Frist(en)", „2 Karte(n)", „Eintrag/Einträge", „Quelle(n)", „Verbindung(en)", „Aufgabe(n)" — zwölf Stellen | vor M461 geschrieben bzw. später dazugekommen | ✅ `zahlWort` (deutsch und englisch), die Prüfreihe sucht den Quelltext danach ab (L4) |

Ohne Befund blieben: die 26 Kacheln der Modul-Palette, die Einstellungs-Schalter (jeder wirkt und bleibt nach dem
Neuladen), Darstellung in allen sechs Größen (nichts abgeschnitten, nichts aus dem Bild), Kontraste in Dunkel und
pix·el, Kopf/Spalte/Dock/Menüs/Hilfe/Suche/Aufgaben im Hellen, KI ohne Schlüssel (jede Aktion sagt sauber, was fehlt),
Hilfe DE = EN (Abschnitte, Listenlängen), Anlegen/Umbenennen/Löschen von Bereich, Projekt, Board (leerer Name, Esc,
sehr langer Name, Sonderzeichen), Fokus + Fenster + Esc.

## Wie (Architektur)
- `lib/overlay.ts`: `obenauf()`, `liegtUeber()`, `fensterDarueber(wurzel, e)`. Ein Capture-Zuhörer (der erste am
  `window`) hält bei jedem Esc den Stapel fest, **wie er beim Tastendruck stand** — React hängt ein geschlossenes
  Fenster schon zwischen zwei Zuhörern aus, der zweite sähe das obere sonst nicht mehr. Wer auf Esc hört und nicht
  selbst `stopPropagation` in der Capture-Phase macht, fragt `fensterDarueber(meinFenster, e)` (Einstellungen, Hilfe,
  Suche, Aufgaben-Zentrale mit `null`, Ausstülpung der Navigation).
- `lib/fensterFokus.ts`: `geoeffnet()` setzt `style.zIndex` eine Stufe über das bisher oberste Fenster, wenn das neue
  sonst darunter läge; `oberstes()` nutzt `obenauf()`.
- `lib/useEscSchliesst.ts`: Esc für Menüs/Dialoge ohne eigenen Zuhörer (Capture + stopPropagation, Fokus zurück).
- `store/ansicht.ts` `setTasksOpen`, `oeffneKarte`; `store/karten.ts` `focusNode`: Ansicht und Zentrale gehören zusammen.
- `public/sw.js`: `einstiegVorladen()` in `install`; Offline-Ersatz nur für `/` und `/index.html`.
- `App.tsx` `imLeerlaufVorladen()`: Einstellungen, Hilfe und Leisten-Dialoge.

## Grenzen / offen
- **Fehlgeschlagenes Nachladen reißt die ganze Darstellung mit.** Jeder nachgeladene Teil ohne eigene Fehlergrenze
  (Einstellungen, Hilfe, Dialoge) landet bei einem Ladefehler in der äußersten Grenze; „Nochmal versuchen" hilft nicht
  (React merkt sich den Fehlschlag), nur „Seite neu laden". Mit dem Vorladen tritt es nur noch auf, wenn das Netz in
  den ersten Sekunden des ersten Besuchs wegbricht oder der Datensparmodus das Vorladen abschaltet. Eine saubere
  Lösung („dieser Teil ist ohne Netz noch nicht geladen" als Hinweis, erneuter Versuch möglich) ist ein eigenes Stück.
- **Der Cache des Service Workers wächst mit jeder Veröffentlichung** (`pixinotes-v1`, alte Dateien werden nie
  entfernt; jede Fassung bringt u. a. Mermaid mit 3,5 MB neu). Aufräumen braucht eine Liste der gültigen Dateien aus
  dem Build.
- **Schriften nach dem ersten Besuch ohne Netz:** Ersatzschrift, bis ein zweiter Besuch mit Netz sie gecacht hat.
- **Suche ohne Umlaute:** „ubersicht" findet „Übersicht" nicht, „vertraege" nicht „Verträge" (Tippfehler mit einem
  eingefügten Buchstaben werden gefunden). Wäre eine neue Fähigkeit (Umlaute falten).
- **Board im Baum anklicken, während die Aufgaben-Zentrale offen ist:** Die Zentrale bleibt und zeigt die Aufgaben
  des angeklickten Boards („Aktives Board – …"). Als Filter stimmig, als Navigation überraschend — Entscheidung.
- **Board löschen** fragt mit einem Browser-Dialog und hat kein „Rückgängig"; Bereich und Projekt haben ein eigenes
  Fenster und „Rückgängig" in der Meldung.
- **Zurück-Taste des Browsers** verlässt die App (nur die Karte im Fokus steht im Verlauf).
- **Hinweis von BlockNote** in der Konsole (bei jedem Start mit Notiz/Protokoll): Dem `viewport`-Meta fehlt
  `interactive-widget=resizes-content`. **Bewusst nicht ergänzt:** Mit dem Zusatz verkleinert Chrome auf Android beim
  Öffnen der Bildschirmtastatur das ganze Layout (`innerHeight` schrumpft mit). Die App rechnet die Tastatur aber
  selbst ein (`lib/viewport.ts`, M211): `--kb = innerHeight − visualViewport.height`, dazu `data-keyboard` und 21
  Regeln im Stylesheet plus zwei Stellen in `Board.tsx`. Mit dem Zusatz wäre diese Differenz 0 — Dock, Auswahl-Leiste
  und angedockte Formatier-Leiste (M277) verhielten sich am Telefon anders. Das lässt sich nur am echten Gerät
  beurteilen (Headless-Chromium hat keine Bildschirmtastatur); die Warnung selbst ist folgenlos.
- Weitere Dialoge hören auf Esc, ohne nach dem Stapel zu fragen (Freigabe, Link, Bild-Export, Liste der Gruppe) —
  sie lassen sich nicht unter ein anderes Fenster bringen, außer über Alt+E/Alt+H; dort greift O3 nicht.

## Für andere Bereiche
- **M519 (HTML-App/Präsentation):** Beim Anlegen einer „Präsentation" (Vibe Studio) meldet der Rahmen
  `Failed to read the 'sessionStorage' property from 'Window': The document is sandboxed and lacks the
  'allow-same-origin' flag` (pageerror aus dem eingebetteten Dokument).
- **M519 (Fokus am Telefon):** Im Fokus (390 px) zeigt die Notiz ihre vier Größen-Anfasser an den Ecken.
- **M520 (Aufgaben, Englisch):** Platzhalter der Schnell-Eingabe „New task … – understands “bis Freitag”".
