# M534 — Zurück-Taste in der App, Suche ohne Umlaute, robustes Nachladen, Service Worker räumt auf
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m534-oberflaeche.mjs` (Port 5534) · Datum: 2026-11-25

## Warum
Offene Punkte aus dem Audit der Rahmen-Oberfläche (M523, „Grenzen / offen"), vom Besitzer freigegeben:
Suche ohne Umlaute, Zurück-Taste verlässt die App, Cache des Service Workers wächst mit jeder Fassung, ein
gescheitertes Nachladen reißt die ganze Darstellung mit, Esc-Stapel in weiteren Dialogen, Firefox-Hinweis (M516).

## Was
- **Suche (Strg+K):** „ubersicht" findet „Übersicht", „vertraege" „Verträge", „strasse" „Straße" — für Karten,
  Boards und Befehle. Boards und Befehle sind jetzt auch tippfehlertolerant (vorher nur Teiltext). Die Fundstelle ist
  im Original unterstrichen (`<mark class="such-treffer">`), der Ausschnitt setzt an der richtigen Stelle an.
  Archivierte Boards werden weiter gefunden (Entscheidung des Besitzers), stehen hinten und tragen die Marke
  „archiviert" (auch Karten auf archivierten Boards bzw. archivierte Karten).
- **Zurück-Taste** (Taste, Wischgeste, Alt+←) springt in der App zurück: Board-Wechsel, Übersicht ↔ Board, Karte im
  Fokus, Einstellungen, Hilfe, Suche, Aufgaben-Zentrale; „Vor" geht wieder hin. Blättern im Fokus und Baum ↔ Netz
  ersetzen nur den Eintrag. Wer ein Fenster selbst schließt (Esc, ✕), geht im Verlauf mit zurück — kein toter Eintrag,
  „Zurück" öffnet das Fenster nicht wieder. Die Adresse bleibt (Deep-Links, Anker); in der portablen Datei geht es genauso.
- **Nachladen:** Kommt ein Teil nicht (Netz weg, nach einem Update ist die alte Datei weg), steht an seiner Stelle
  „Teil konnte nicht geladen werden – meist fehlt gerade das Netz." mit **Nochmal versuchen** und **Neu laden** —
  Fenster und Ansichten schwebend unten, Karten in der Karte. Kein „PixiNotes lässt sich nicht anzeigen" mehr.
  Ohne Netz startet die Seite nicht mehr von selbst neu.
- **Service Worker:** räumt beim Übernehmen einer neuen Fassung den Cache auf; die Dateien der Fassung davor bleiben
  eine Runde (ein Tab mit der alten Fassung lädt weiter). Bemerkt neue Fassungen jetzt auch selbst (sw.js ändert sich).
- **Esc-Stapel:** Vorlagen, Versionen, Sicherung, App installieren, Ebene löschen, Themen, Eingang, QR-Blende,
  Mitmach-QR fragen vor dem Schließen, ob ein Fenster darüberliegt (Alt+H, Alt+E, Strg+K darüber → Esc schließt
  erst das obere). Freigabe, Link, Bild-Export und Gruppen-Liste sind Sache von M530.
- **Firefox unter Windows:** „Als App installieren" nennt „Zur Taskleiste hinzufügen" (neuere Fassungen); Mac/Linux
  wie bisher: Chrome oder Edge.

## Wie (Architektur)
- `lib/suchFalten.ts`: `falte(text)` (klein, ß → ss, Akzente weg, ae/oe/ue → a/o/u — beide Seiten gleich gefaltet),
  `falteMitStellen` (je Zeichen die Stelle im Original), `fundstellen(text, worte)` für die Markierung.
  `SearchOverlay.tsx`: `suchIn(heu, q)` = uFuzzy auf gefaltetem Text, sonst Teiltext; `entries[].falt` wird je Öffnen
  einmal gebaut; `Markiert` setzt `<mark>`. Läuft nur im nachgeladenen Suche-Teil.
- `lib/verlauf.ts` (nachgeladen: `verlaufLaden()` in `App.tsx` im Leerlauf nach `VORLADEN_NACH_MS` — auch im
  Datensparmodus —, mit dem ersten Fenster über `BeiBedarf`/`Suche` und mit der ersten Karte im Fokus aus
  `FocusSheet.tsx`). Schritt `{ v, o, b, f, e, h, s, t }` in `history.state.pn = { i, s }`, Spiegel `eintraege[]`.
  `abgleichen()` (gebündelt per Mikrotask aus `useBoard.subscribe`): gleich → nichts; Schichten zu und der Eintrag
  darunter passt → `history.go(-k)`; Blättern/Baum↔Netz → `replaceState`; sonst `pushState`. `popstate` →
  `uebertragen()` (nur Abweichendes; gelöschte Boards/Karten werden übergangen und der Eintrag berichtigt).
  `history.replaceState(null, …)` anderer Teile (Teilen-Links, Anmeldung) behält den Schritt (Hülle um replaceState).
  FocusSheet führt keinen eigenen Eintrag mehr (vorher `pnFocus`).
- `lib/nachLazy.tsx`: `nachLazy(lade)` statt `lazy` in `App.tsx`, `Board.tsx` (`spaet`, Kommentare, Auswahl-Leiste),
  den Hosts und den nachgeladenen Teilen in Karten. Zweiter Versuch nach 700 ms, dann `Ersatz` (versucht beim Einhängen
  noch einmal, zeigt sonst `.nachlade-fehler`). **Der Browser merkt sich ein gescheitertes `import()`** (Modul-Tabelle
  des Dokuments) — derselbe Aufruf scheitert danach sofort. `neuHolen` holt die Datei aus der Fehlermeldung unter
  `?neu=<Zeit>` und nimmt den Export, der wie die Datei heißt (`Settings-….js` → `Settings`), sonst `default` oder den
  einzigen Komponenten-Export. Ohne Netz **und** ohne Service Worker wird gar nicht erst angefragt (`ohneNetz()`), damit
  nichts vergiftet wird. `main.tsx`: `vite:preloadError` lädt ohne Netz nicht neu (`navigator.onLine`).
- `App.tsx`: `AufRuf` ersetzt sieben gleichartige Ereignis-Dialoge (Vorlagen, Versionen, Sicherung, App installieren,
  Outlook, Eingang, QR) — `wie` macht aus dem Ereignis die Angaben, `k` setzt neu auf; Hilfe und Einstellungen über
  `BeiBedarf`. Das hat die Bytes für das Neue frei gemacht.
- `public/sw.js`: `DATEIEN` (vom Build eingesetzt), `aufraeumen()` in `activate` — löscht Einträge unter `/assets/`, die
  weder in `DATEIEN` noch in der Liste der Fassung davor stehen (Merkzettel `./__pixinotes-dateien__` im Cache).
  `vite.config.ts` `swDateiliste()` (closeBundle) setzt die Liste der Dateien in `dist/assets` an den Platzhalter
  `[] /*__PIXINOTES_DATEIEN__*/`; fehlt er, bricht der Build ab. Leere Liste (alter sw.js) = nichts löschen.
- `lib/fensterEsc.ts` `escDarueber(el, e, sel)` (eigenes Modul, nicht im Start-Paket) für die Dialoge;
  `EingangFenster` fragt `fensterDarueber(null, e)` (Stapel vom Tastendruck) statt `querySelector`.
- `Board.tsx` `zgLaden`: ohne Netz kein unbehandelter Fehler mehr (Zieh-Gefühl fehlt dann eben).
- **Start-Paket:** vorher 2 064 874 B (126 B Luft); mit M534 2 064 721 B — Neues nachgeladen, `AufRuf` spart mehr,
  als `nachLazy` und der Verlaufs-Auslöser kosten. Mit M535 eingemischt 2 027 757 B.

## Prüfreihe
A Suche (8) · B Zurück-Taste (10, davon B9/B10 am Telefon mit Fokus) · C Esc-Stapel (5 Dialoge) · D Nachladen
(Einstellungen ohne Netz, Kanban-Datei nach Update weg) · E Service Worker über vier Fassungen (der Server schreibt
Stylesheet-Namen und sw.js-Liste je Fassung um — kein Mehrfach-Build) · F portable Datei (braucht
`release/pixinotes.html` dieses Stands; lokal mit `PN_SINGLE=<Datei>` aus `npx vite build --mode single --outDir …`) ·
G Firefox · Z Konsole. Gegen den Build vor M534 rot (A, B, C, D, E1–E3, G1).

## Grenzen / offen
- **Vergiftete gemeinsame Dateien:** Hat ohne Netz ein anderer Teil eine gemeinsame Datei nicht bekommen (Auswahl-Leiste,
  Texterkennung …), scheitert auch ein späterer Teil, der sie braucht — der Browser fragt sie bis zum Neuladen nicht
  wieder an. Dann lädt „Nochmal versuchen" über `vite:preloadError` die Seite einmal neu (M321), bzw. „Neu laden".
  Betrifft nur den ersten Besuch ohne Netz; mit Service Worker liegen die Teile nach dem Leerlauf-Vorladen bereit.
- Die Zurück-Taste schließt die Präsentation nicht (sie hat ihr eigenes Esc); Fenster, die nicht im Store stehen
  (Vorlagen, Versionen …), haben keinen Verlaufs-Eintrag.
- Bei „Vor" in ein Fenster öffnet die Hilfe am Anfang (nicht beim zuletzt gezeigten Abschnitt).
- Chrome überspringt mit der Zurück-Taste Einträge, die ohne Nutzerhandlung entstanden sind (History-Intervention) —
  Einträge entstehen hier nur aus Klicks und Tasten; in Prüfreihen daher echte Tasten statt `evaluate`.
