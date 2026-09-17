import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useBoard } from '../store';
import { KUERZEL, taste } from '../lib/tasten';
import { MailLink } from './MailLink';

/**
 * Die Hilfe (❓ im Dock): sechs Abschnitte in Alltagssprache, dazu Impressum
 * und Datenschutz. „Was ist neu" ist eine eigene Seite (Logo-Menü) — die
 * Hilfe beschreibt, wie die App heute aussieht, die Neu-Seite, was sich
 * wann geändert hat. Vollständig offline — keine externen Links nötig.
 */
const SECTIONS = [
  { id: 'start', icon: '🚀', title: 'Erste Schritte' },
  { id: 'ordnung', icon: '🗂️', title: 'Bereiche · Projekte · Boards' },
  { id: 'karten', icon: '🃏', title: 'Karten & Module' },
  { id: 'aufgaben', icon: '✅', title: 'Aufgaben & Erinnerungen' },
  { id: 'daten', icon: '💾', title: 'Speichern, Sync & Teilen' },
  { id: 'tasten', icon: '⌨️', title: 'Tastenkürzel' },
] as const;

/** Rechtliches steht unter den sechs Abschnitten — klein, aber immer da */
const RECHT = [
  { id: 'impressum', icon: '⚖️', title: 'Impressum' },
  { id: 'datenschutz', icon: '🔒', title: 'Datenschutz' },
] as const;

const ALLE = [...SECTIONS, ...RECHT];

/** Editierdistanz ≤ max? (bandbegrenztes Levenshtein mit Frühabbruch) */
function editDistanceAtMost(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return false; // ganze Zeile über dem Limit → nie mehr drunter
    prev = cur;
  }
  return prev[b.length] <= max;
}

/** Erlaubte Tippfehler pro Suchwort: kurze Wörter exakt, sonst 1–2 */
const fuzzyMax = (len: number): number => (len >= 7 ? 2 : len >= 4 ? 1 : 0);

/** Wie oft kommt das Suchwort im Text vor? Erst wörtlich (auch als Wortteil,
 *  wichtig für Komposita wie „Sync-Ordner"), sonst fuzzy gegen jedes Wort und
 *  gegen Wortanfänge („syncro" trifft „Synchronisation"). */
function tokenHits(token: string, text: string, words: string[]): number {
  let n = 0;
  for (let i = text.indexOf(token); i !== -1; i = text.indexOf(token, i + token.length)) n += 1;
  if (n > 0) return n;
  const max = fuzzyMax(token.length);
  if (max === 0) return 0;
  for (const w of words) {
    if (editDistanceAtMost(token, w, max)) n += 1;
    else if (w.length > token.length && editDistanceAtMost(token, w.slice(0, token.length + 1), max)) n += 1;
  }
  return n;
}

export function HelpOverlay() {
  const open = useBoard((s) => s.helpOpen);
  const setOpen = useBoard((s) => s.setHelpOpen);
  const helpSection = useBoard((s) => s.helpSection);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState<string>('start');
  // Zwei Seiten in einem Fenster: die Hilfe selbst und „Was ist neu"
  const [seite, setSeite] = useState<'hilfe' | 'neu'>('hilfe');
  const [query, setQuery] = useState('');
  // Treffer pro Sektion (null = keine Suche aktiv). Der Text wird aus dem
  // gerenderten DOM gelesen — so bleibt die Suche automatisch vollständig,
  // egal was in den Sektionen steht (kein doppelt gepflegter Suchindex).
  const [hits, setHits] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    if (!open || seite !== 'hilfe') return;
    const q = query.trim().toLowerCase();
    const body = bodyRef.current;
    if (!body) return;
    if (!q) {
      setHits(null);
      body.classList.remove('help-filtering');
      return;
    }
    // Mehrwort-Suche: JEDES Wort muss in der Sektion vorkommen (UND) —
    // wörtlich oder mit Tippfehler-Toleranz (fuzzy, s. tokenHits)
    const tokens = q.split(/\s+/).filter(Boolean);
    const res: Record<string, number> = {};
    for (const s of ALLE) {
      const el = body.querySelector(`#help-${s.id}`);
      const text = (el?.textContent ?? '').toLowerCase();
      const words = text.split(/[^\p{L}\p{N}#+@-]+/u).filter((w) => w.length > 1);
      let total = 0;
      let all = true;
      for (const t of tokens) {
        const n = tokenHits(t, text, words);
        if (n === 0) { all = false; break; }
        total += n;
      }
      if (all && total > 0) res[s.id] = total;
      el?.classList.toggle('help-hit', all && total > 0);
    }
    body.classList.add('help-filtering');
    setHits(res);
  }, [query, open, seite]);

  // Direktsprung beim Öffnen: „Was ist neu" aus dem Logo-Menü, „Impressum"
  // aus dem Einstellungs-Fuß, sonst die Hilfe dort, wo sie zuletzt stand.
  // useLayoutEffect, damit nicht erst kurz die falsche Seite aufblitzt.
  useLayoutEffect(() => {
    if (!open) return;
    if (helpSection === 'neu') { setSeite('neu'); return; }
    setSeite('hilfe');
    if (!helpSection) return;
    setActive(helpSection);
    const t = setTimeout(() => {
      bodyRef.current?.querySelector(`#help-${helpSection}`)?.scrollIntoView({ block: 'start' });
    }, 30);
    return () => clearTimeout(t);
  }, [open, helpSection]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Esc räumt erst die Suche, erst der zweite Druck schließt die Hilfe
      if (query) setQuery(''); else setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen, query]);

  if (!open) return null;

  const jump = (id: string) => {
    setActive(id);
    bodyRef.current?.querySelector(`#help-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (seite === 'neu') {
    return (
      <div className="modal-backdrop" onClick={() => setOpen(false)}>
        <div className="modal help-modal help-neu-modal" role="dialog" aria-modal="true" aria-label="Was ist neu" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h2>🆕 Was ist neu</h2>
            <button className="link-btn help-zurueck" onClick={() => setSeite('hilfe')}>Zur Hilfe</button>
            <button className="modal-x" onClick={() => setOpen(false)} aria-label="Schließen">✕</button>
          </div>
          <div className="help-body help-neu">
            {/* Kurzer Überblick über die jüngsten Ausbaustufen, neueste zuerst —
                bewusst in Alltagssprache. Hier stehen die Begründungen; die
                Hilfe daneben beschreibt nur, wie die App heute aussieht. */}
            <section id="help-neu">
              <p>Die letzten Ausbaustufen in Kürze, neueste zuerst. Welche Fassung gerade läuft, steht im <b>Logo-Menü</b> oben links.</p>
              <ul>
                <li><b>💾 Speicher fast voll: Bild wird zur Karte (M303):</b> Passte ein eingefügtes Bild nicht mehr in den Stand, blieb in der Notiz ein leerer Bild-Block stehen, und in der Konsole lag ein unbehandelter Fehler („Speicherbudget"). Jetzt verschwindet der Platzhalter, und das Bild wird zur <b>Datei-Karte</b> in der Geräte-Ablage — rechts neben der Notiz, auf der Fläche an der Einfügestelle — statt verworfen zu werden. Auch ein zu großes Bild auf dem Board landet nicht mehr als Base64 im Stand, sondern in der Geräte-Ablage; so bleibt der Stand speicherbar. Nebenbei: <code>index.html</code> trägt neben dem Apple-Meta das allgemeine <code>mobile-web-app-capable</code>.</li>
                <li><b>📝 Einfügen im Menü der Notiz (M302):</b> Der 🖼-Chip unter der Notiz ist weg — er hing an jeder Notiz, sobald der Cursor im Text stand, für etwas, das selten vorkommt. Das <b>„/"-Menü</b> hat dafür unter „Medien" drei Einträge: „Bild aus Zwischenablage", <b>„Bild aus Datei"</b> (am Telefon Fotomediathek oder Kamera) und <b>„Datei als Karte daneben"</b>, das PDF, Word und andere Dateien als Datei-Karte rechts neben die Notiz legt. Strg+V und Ablegen bleiben wie gehabt.</li>
                <li><b>📱 Ein Weg am Telefon, ruhigere Karten (M301):</b> Auf der schmalsten Kopfleiste steht statt Brotkrume <i>und</i> Board-Wähler ein Knopf mit dem Weg <b>„Projekt › Board"</b> — er öffnet den Baum, der alles kann, was der Wähler konnte (wechseln, umbenennen, schließen, neues Board). Die <b>＋-Verbindungspunkte</b> erscheinen am PC nur noch beim Zeigen auf die Karte; eine ausgewählte Karte trug sonst dauerhaft vier Kreise. Am Touchscreen zeigt sie die Auswahl weiterhin. Die Reiter der Einstellungen passen am Telefon in eine Zeile.</li>
                <li><b>⚙️ Einstellungen entrümpelt (M300):</b> Vier Reiter statt sechs — <b>Design · Daten · Synchronisation · Dienste</b>, das Alltägliche zuerst. Design ist in Aussehen, Lesbarkeit, Bedienung und Bewegung gegliedert, Erscheinungsbild und die Fokus-Optionen sind Umschalter statt Listen und Häkchen. Unter Daten steht Sichern &amp; Laden ganz oben, der Word-Hinweis ohne Knopf ist weg, die Starter-Umgebung erklärt sich in einem Satz. Die Synchronisation zeigt <b>einen Weg zur Zeit</b> (Ordner, WebDAV oder Dateien-App) statt drei Abschnitte übereinander; Team-Sync verbindet Projekte über einen Wähler statt neun Knöpfe, „Einladen" kopiert den Text und öffnet die E-Mail in einem Schritt, die Dateien-Obergrenze steht als Option am Ende. Dienste bündelt KI, Gehirn (jetzt ein Häkchen) und die Konten — das Microsoft-Konto gilt für Kalender <i>und</i> OneNote, das zweite Formular im OneNote-Import ist weg. Der <b>Bild-Export</b> ist eine Aktion am Board (Dock ⋯ → „Als Bild exportieren") und keine Einstellung mehr; der Fuß mit Version und Rechtlichem entfällt (steht im Logo-Menü), und die Seg-Schalter zeigen endlich, was gewählt ist.</li>
                <li><b>🤫 Die App redet weniger (M299):</b> Jeder Hinweis ist ein Satz — Toasts, Sprechblasen und die Erklärtexte in den Einstellungen sind gekürzt; eine Sprechblase nennt, was ein Knopf tut, sie erklärt nicht. Die <b>Hilfe</b> hat sechs Abschnitte statt dreizehn (Erste Schritte · Bereiche, Projekte, Boards · Karten &amp; Module · Aufgaben &amp; Erinnerungen · Speichern, Sync &amp; Teilen · Tastenkürzel), Impressum und Datenschutz stehen darunter, und <b>„Was ist neu"</b> ist diese eigene Seite hinter dem Logo-Menü statt ein Abschnitt in der Hilfe. Die Hilfetexte sind neu geschrieben: kurz, ein Gedanke pro Punkt, ohne Begründungen und Fassungsnummern — und sie beschreiben die Oberfläche von heute (⋯-Menüs, Navigation links, Netz in der Übersicht, Kachel).</li>
                <li><b>🧩 Kachel-Ansicht für große Module (M298):</b> Kanban, Zeitplan, Wochenplan und Protokoll-Reihe wachsen mit ihrem Inhalt und sprengen den Bildschirm. Jetzt lassen sie sich zur <b>Kachel</b> zusammenklappen (Karte auswählen → ⋯ → „Als Kachel zeigen", beim Kanban auch im ⋯ der Kopfzeile): Typ, Titel und zwei bis drei Zeilen Kennzahlen — Tickets je Spalte und die nächste Frist, laufende Vorgänge und der nächste Endtermin, die Blöcke von heute, Sitzungen und Beschlüsse. „Öffnen" oder Doppelklick zeigt das ganze Modul im Fokus, „Ausklappen" bringt es in der alten Größe zurück aufs Board. Das ist die zweite der „zwei Ansichten" aus dem Konzept.</li>
                <li><b>🧭 Eine Navigation statt drei (M297):</b> Ab Tablet-Breite ist die linke Spalte ein <b>fester Rahmen</b> — ein Band von oben bis unten mit Logo, Aktionen und dem ganzen Baum <b>Bereich › Projekt › Board › Karte</b>; die Fläche beginnt rechts davon, nichts rutscht mehr darunter. Das aktive Projekt und das aktive Board sind aufgeklappt, alles andere lässt sich aufklappen, die Suche oben findet Boards und Karten. Die <b>rechte Seitenleiste</b> und das <b>Navigator-Popup</b> aus der Brotkrume sind darin aufgegangen; das <b>Netz</b> gibt es nur noch in der Übersicht (🏠). Am Telefon bleibt die Kopfleiste mit Board-Wähler, die Brotkrume öffnet denselben Baum als Ausstülpung. Alt+U blendet die Spalte ein und aus, Alt+W springt in ihre Suche.</li>
                <li><b>🧰 Dock und Auswahl-Leiste entrümpelt (M296):</b> Das <b>＋-Menü</b> zeigt fünf Dinge (Notiz, Kanban, Rechen-Tabelle, Datei oder Bild, Zeitplan) und dahinter „Weitere Module" — vorher 22 Einträge, länger als der Bildschirm. <b>Aufräumen</b> ist ein Knopf im ⋯ des Docks (Verbundenes als Fluss, der Rest als Raster); die Varianten, das Gitter und der Hintergrund liegen unter „Anordnen &amp; Hintergrund". Der Physik-Schalter steht nur noch unter ⚙ → Bedienung (Alt+O geht weiter). Die <b>Auswahl-Leiste</b> hat sechs Elemente: Duplizieren, Verschieben, <b>Teilen</b>, ⋯, Löschen und den Zähler — „Formatiert kopieren" und „Schrift &amp; Größe" liegen im ⋯. Der Toast weicht nach oben aus, solange ein Dock-Menü offen ist; die <b>Minimap</b> erscheint erst ab zehn Karten; eine Sprechblase verschwindet jetzt auch bei einem Tastendruck; am Telefon liegen Impressum und Datenschutz nicht mehr unter dem Dock (sie stehen im Logo-Menü).</li>
                <li><b>📋 Kanban entrümpelt (M295):</b> Die Kopfzeile hat nur noch <b>Filter</b> und <b>⋯</b>; Einsammeln, Auto-Einsammeln, Archiv, Automatik, „Erledigte archivieren", Spalten und die Ansicht liegen im ⋯-Menü, und eine <b>Statuszeile</b> unter dem Titel zeigt, was gerade läuft (Auto-Einsammeln, Archiv-Zähler, Automatik-Frist). Die <b>Erledigt-Spalte</b> ordnet nach Zeit: <b>Heute · Diese Woche · Älter</b>, neueste oben, „Älter" zugeklappt mit Zähler, jede Gruppe mit einem Griff archivierbar. Ticket-Zeilen: Text in voller Breite (kein buchstabenweiser Umbruch mehr), Tags nur als Chip, Aktionen erst beim Zeigen aufs Ticket. <b>Kompakte Tickets</b> (⋯ → Ansicht) zeigen nur Text, Priorität und Frist. Archiv und Einsammeln öffnen als <b>Fenster</b> über der App statt in der Karte. Nebenbei ist ein Stylesheet-Fehler behoben, der die Reiterleisten-Regel ab Tablet-Breite ungültig machte.</li>
                <li><b>🤫 Ruhige Fläche (M294):</b> Physik, Klick-Zoom und Konfetti sind jetzt <b>Optionen</b> und standardmäßig aus — Karten weichen nicht mehr aus, die Ansicht fliegt nicht mehr, nichts rieselt. Bestehende Geräte wurden einmal umgestellt und haben das beim Start gemeldet; wer es lebendiger mag, schaltet es unter <b>⚙ → Design → Bewegung auf der Fläche</b> wieder ein. Der Spickzettel-Toast beim Start ist weg, die Erklärtexte im Reiter Design sind auf einen Satz gekürzt. Im Konzept stehen dafür jetzt fünf Leitplanken und ein Glossar (Kapitel 10a), damit die Oberfläche nicht wieder mit jeder Funktion einen Knopf dazubekommt.</li>
                <li><b>🗃 Erledigte Tickets archivieren — von Hand oder automatisch:</b> Die Erledigt-Spalte eines Kanbans wächst und wächst, aber löschen will man das Erledigte nicht — es ist der Nachweis. Jetzt trägt jedes erledigte Ticket ein <b>🗃</b>, die Erledigt-Spalte hat <b>„Alle archivieren"</b>, und das Ticket-Fenster zeigt, <b>wann</b> etwas erledigt wurde. Archiviertes verlässt die Spalten, bleibt aber in der Karte: <b>🗃 in der Kopfzeile</b> öffnet das Archiv mit Erledigt- und Archiv-Datum, <b>↩</b> holt ein Ticket zurück, ✕ löscht es endgültig; Strg+Z nimmt jeden Schritt zurück. Dort sitzt auch die <b>Automatik</b>: „Erledigte automatisch archivieren nach … Tagen" — die Frist zählt ab dem Moment der Erledigung, geprüft wird beim Start und alle fünf Minuten. Archivierte Tickets zählen nirgends mehr mit (WIP-Limit, Aufgaben-Zentrale, Einsammeln, Zeitplan-Abo), die Suche und der Export finden sie weiterhin. Tickets aus älteren Ständen haben noch kein Erledigt-Datum; sie bekommen es beim ersten Lauf, ihre Frist läuft also ab dem Update — nicht rückwirkend.</li>
                <li><b>🧲 Die Bearbeiten-Leiste hat einen festen Platz:</b> Sie ließ sich frei wegschieben, und wohin, wurde gemerkt — gedacht als Ausweg, wenn sie mal im Weg stand. In der Praxis stand sie dadurch bei jeder Karte woanders, gern mitten auf dem Text. Jetzt gilt eine Regel, die man nach einmal Sehen kennt: <b>über der Karte</b> → sonst <b>darunter</b> → sonst als <b>feste Zeile unten</b>. Entschieden wird nach echtem Platz (Kopfleiste, Dock, Formatier- und Blätter-Zeile werden mitgemessen), gleich auf Telefon und großem Schirm. Beim Verschieben der Ansicht wechselt sie die Seite von selbst, sobald oben kein Platz mehr ist.</li>
                <li><b>📥 „Teilen mit …" landet jetzt in PixiNotes (Android):</b> Ein Foto aus der Galerie, eine Seite aus dem Browser, eine PDF aus dem Dateimanager — das Teilen-Menü von Android kennt PixiNotes jetzt als Ziel, sobald die App <b>installiert</b> ist. Und es landet nicht blind irgendwo: PixiNotes fragt, <b>auf welches Board</b> und <b>in welcher Form</b> — als Karten oder direkt in eine bestehende Notiz. Technisch steckt dahinter das Web Share Target; die POST-Anfrage von Android nimmt der Service Worker entgegen (ein statischer Server könnte das gar nicht) und legt das Geteilte in der Geräte-Ablage ab, aus der die App es beim Start abholt. <b>Auf iPhone und iPad geht das nicht</b> — Safari unterstützt diese Schnittstelle nicht; dort bleibt „Kopieren" in der Fotos-App und Einfügen in PixiNotes.</li>
                <li><b>🖼 Bilder mitten in die Notiz:</b> Ein kopierter Screenshot landete bisher immer als eigene Karte NEBEN der Notiz — im Text selbst passierte beim Einfügen gar nichts, weil der Editor Bilder gar nicht annehmen konnte. Am Telefon gab es überhaupt keinen Weg. Jetzt geht beides: <b>Strg+V</b> und das Einfügen-Menü des Telefons setzen das Bild an die Cursor-Stelle, ein <b>Chip „🖼 Bild"</b> unter der Notiz öffnet Fotomediathek oder Kamera, und „/" → <b>„Bild aus Zwischenablage"</b> holt ein kopiertes Foto ohne Tastatur. Große Bilder werden auf ein speicherbares Maß gebracht (gemessen: ein 3000-Punkte-Bild wird zu ~14 KB), bleiben im Kartenrand und kommen beim <b>Kopieren, Drucken und per E-Mail</b> mit. <b>Nur Bilder</b> — eine PDF auf der Notiz abgelegt wird weiterhin eine Datei-Karte auf dem Board, denn Videos und Dokumente im Notiztext würden den Speicher der Anwendung sprengen.</li>
                <li><b>⋯ Boards und Projekte können jetzt dasselbe wie Karten:</b> Karten ließen sich längst duplizieren, verschieben, teilen und archivieren — eine Ebene höher hing es von der Ansicht ab: in der Reiterleiste umbenennen und schließen, auf der Übersichts-Kachel umbenennen, präsentieren und löschen, im Navigator gar nichts. Jetzt liegt überall dasselbe <b>⋯</b>-Menü an: <b>Umbenennen · Duplizieren · In Projekt verschieben · Teilen-Link · Als Datei sichern · Präsentieren · Archivieren · Löschen</b>, beim Projekt zusätzlich <b>Neues Board</b> und <b>Duplizieren mit allen Boards</b>. Neu ist auch das <b>Archivieren von Boards</b> — das sanfte Löschen: Das Board tritt aus Reitern, Navigator und Übersicht zurück und seine Fristen ruhen, bleibt aber vollständig erhalten und kommt mit „Archiv einblenden" jederzeit zurück. Beim Duplizieren bekommt jede Karte eine <b>frische Kennung</b>: Zwei Boards mit gleichen Kennungen würden sich beim Verschieben, bei Pfeilen und beim Sync gegenseitig überschreiben.</li>
                <li><b>✏️ „Umbenennen" benennt das um, was du meinst:</b> Ein Board hieß „🏖️ Amrum 2026", der Umbenennen-Dialog zeigte aber „Amrum" — weil zwei verschiedene Dinge dasselbe Wort trugen: der <b>Bereich</b> als oberste Ordnungsebene (Bereich › Projekt › Board) und der <b>Rahmen</b> auf dem Board. Der Knopf in der Auswahl-Leiste benannte also den Rahmen um, nicht das Board. Der Rahmen heißt jetzt überall <b>Rahmen</b> (＋-Menü, neue Rahmen, Export), die Rückfrage sagt ausdrücklich „Rahmen auf dem Board umbenennen — die Karten darin bleiben unberührt", und das <b>Board</b> lässt sich dort umbenennen, wo man es gerade sieht: im Navigator per Stift oder Doppelklick auf den Namen.</li>
                <li><b>👁 Dateien zeigen ihren Inhalt — in jeder Größe:</b> Eine eingefügte PDF blieb bisher ab <b>1,5 MB</b> ein Dateiname mit Größenangabe: keine Vorschau, kein Hinweis, warum. Der Grund lag im Lagerort — Karteninhalte liegen im <code>localStorage</code>, und den riegeln Browser bei etwa 5 MB ab; eine große Datei dort hätte jeden weiteren Speichervorgang des ganzen Boards zerstört. Die Bremse war also richtig, der Ort falsch. Dateien liegen jetzt in der <b>Geräte-Ablage</b> (IndexedDB) — derselbe Weg, den eigene HTML-Apps längst gehen. Damit gibt es die PDF-Vorschau auch bei 12 MB, dazu neu: <b>Textdateien, Markdown, CSV, JSON und Protokolle</b> zeigen ihre ersten Zeilen, <b>Ton und Video</b> bekommen einen Abspieler. Und wo es wirklich nichts zu sehen gibt, steht der Grund da statt eines leeren Kastens.</li>
                <li><b>🔎 „Läuft nicht" ist etwas anderes als „darf nicht":</b> Scheitert der Zugriff auf den lokalen Ollama-Server, meldete die App bisher beides in einem Satz — und stellte die falsche Ursache nach vorn. Wer im Terminal gerade nachgewiesen hatte, dass Ollama läuft, suchte dann an der falschen Stelle. Der Browser liefert für beide Fälle denselben nichtssagenden Fehler; unterscheiden lassen sie sich trotzdem, über eine zweite Anfrage, die auf das Lesen der Antwort verzichtet. Kommt die durch, lief die Verbindung und es fehlte nur die Erlaubnis. Jetzt steht entweder <b>„Der Server läuft — aber der Browser darf nicht zugreifen"</b> samt der Anleitung für dein Betriebssystem, oder <b>„Unter … antwortet nichts"</b> mit dem passenden Prüfbefehl. Beides schließt sich aus, beides ist nachprüfbar.</li>
                <li><b>🖥 Lokale KI: alle Modelle, nicht vier:</b> Bei <b>Ollama</b> stand die Modell-Auswahl früher fest im Programm — vier Namen, und <code>gemma3:12b</code> war keiner davon. Jetzt fragt PixiNotes den Server selbst: <b>Was ist bei dir installiert?</b> Die Antwort steht als anklickbare Liste da, mit Größe und Quantisierung, dazu ein <b>⟳</b> für nach dem nächsten <code>ollama pull</code>. Das Feld bleibt zusätzlich frei beschreibbar — jeder Name aus ollama.com/library geht, auch blind ohne laufenden Server. Für den Anfang gibt es aufklappbare Vorschläge von ~2&nbsp;GB bis ~17&nbsp;GB mit fertigem Pull-Befehl. Dasselbe gilt für eigene OpenAI-kompatible Server (llama.cpp, LM&nbsp;Studio, vLLM) und für das <b>Einbettungs-Modell des Gehirns</b>.</li>
                <li><b>Σ Tabellen, die rechnen — und Excel-Listen, die weiterrechnen:</b> Neu im ＋-Menü: die <b>Rechen-Tabelle</b>. Alles, was mit <code>=</code> beginnt, ist eine Formel — <code>=SUMME(B2:B9)</code>, <code>=MITTELWERT(…)</code>, <code>=B4*1,19</code>, <code>=WENN(A1&gt;100;"über Plan";"im Rahmen")</code>. Angezeigt wird das <b>Ergebnis</b>, beim Hineinklicken die <b>Formel</b>; <b>Σ</b> setzt Autosummen unter jede Zahlenspalte. Und: Eine <b>.xlsx</b> aufs Board gezogen wird zur bearbeitbaren Karte — mitsamt ihrer Formeln, jedes Blatt als eigene Karte. Ändert man dort eine Zahl, wandert die Summe mit; es ist keine tote Momentaufnahme. Alles offline, ohne Excel, ohne Zusatz-Bibliothek. Bewusst eine eigene Karte statt Formeln in den Notiz-Tabellen: Dort ist eine Zelle Fließtext mit Fett, Farbe und Links — ein Raster darf rechnen, ein Textblock nicht.</li>
                <li><b>🧠 Das Gehirn</b> — der größte Umbau: PixiNotes versteht deine Karten jetzt nach <b>Bedeutung</b>, nicht nur nach Wortlaut. Daraus folgen vier Dinge: Die Suche findet Verwandtes („Kita" findet „Betreuungszeiten"), das ↩-Panel zeigt <b>verwandte Karten</b> aus anderen Boards, das Netz <b>schlägt fehlende Verbindungen vor</b>, und du kannst <b>Fragen an deine eigene Wissensbasis</b> stellen (mit Quellenangabe, ohne Erfinden). Einschalten in ⚙️ → KI; alles kann komplett lokal laufen.</li>
                <li><b>🧠 Gehirn-Puls &amp; Auto-Struktur</b> — die Aufgaben-Zentrale zeigt, was das Gehirn im Wissensnetz sieht: Themen-Inseln über Board-Grenzen, Knotenpunkte, offene Vorschläge. Aus einer Themen-Insel heraus kannst du alle Karten <b>als Thema markieren</b> oder dir eine <b>Übersichts-Notiz</b> bauen lassen.</li>
                <li><b>🖼️ Die KI sieht Bilder</b> — Screenshots und Fotos gehen jetzt als echte Bild-Anhänge an die KI. Aus einem abfotografierten Zettel wird so direkt eine Einkaufsliste oder ein Kanban.</li>
                <li><b>🔤 Schrift &amp; Größe</b> — pro Karte und sogar für einzelne markierte Textstellen, inklusive der für Sehschwäche entworfenen Schrift „Sehr gut lesbar".</li>
                <li><b>📤 Karten einzeln teilen</b> — ein Dialog mit allen Wegen: Übernahme-Link, WhatsApp, E-Mail, Drucken, PDF, formatiertes Kopieren.</li>
                <li><b>🧹 Weniger Knöpfe</b> — Dock und Auswahl-Leiste zeigen nur noch das Häufigste, alles Weitere liegt im ⋯-Menü. Alle Bedienelemente sind jetzt auch am Finger sicher zu treffen.</li>
                <li><b>⚡ Netz-Ansicht flüssig</b> — das Ruckeln beim Ziehen ist weg, auch auf dem Handy.</li>
                <li><b>🗺 Die Gliederung als Landkarte:</b> Im <b>Netz</b> liegen deine Boards jetzt auf weichen, eingefärbten Flächen — eine je Bereich, feinere je Projekt. Bereiche und Projekte werden also <b>nicht</b> zu weiteren Punkten im Netz (drei Knotenarten würden nur um Aufmerksamkeit kämpfen), sondern zum Untergrund, auf dem alles liegt. Ein <b>abgeschaltetes Sub-Brain</b> erscheint dabei als graue, gestrichelte Region mit dem Zusatz „schläft" — ein Klick auf ihren Rand schaltet sie wieder ein. Über die Ebene <b>„Gliederung"</b> oben im Netz lässt sich das Gelände ausblenden.</li>
                <li><b>👓 Sehen &amp; Bedienen — für Augen, die nicht mehr die besten sind:</b> Im <b>PixiNotes-Menü</b> oben links stehen jetzt <b>A− / A+</b>: Sie vergrößern die <b>ganze App</b> — Schrift, Knöpfe, Abstände und die Karteninhalte, bis 175 %. Bewusst nicht nur die Schrift: Wer Text schlecht liest, trifft auch kleine Knöpfe schlecht. Dazu in ⚙️ → Design zwei Schalter: <b>„Gut lesbare Schrift"</b> stellt alles auf Atkinson Hyperlegible um (eigens dafür entworfen, dass sich I l 1 und O 0 unterscheiden lassen), <b>„Mehr Kontrast"</b> nimmt Milchglas und Papiertextur weg und macht Schrift, Ränder und Fokusrahmen kräftiger. Alles bleibt gespeichert.</li>
                <li><b>🧮 Tabellen: Zeilen und Spalten lassen sich wirklich löschen:</b> Steht der Cursor in einer Tabelle, erscheinen unten in der Notiz drei Chips: <b>⌫ Zeile</b>, <b>⌫ Spalte</b>, <b>⌫ Tabelle</b>. Die eingebauten Griffe verweigern die <b>letzte</b> Zeile und die letzte Spalte — eine Tabelle darf dort nie leer werden, also blieb immer ein Rest stehen. Hier gilt: Wer die letzte Zeile oder Spalte löscht, löscht die Tabelle. Strg+Z im Text holt alles zurück. <b>Nachgebessert:</b> Die Chips bleiben jetzt stehen, solange der Cursor in der Tabelle steht — vorher verschwanden sie nach dem ersten Antippen, weil der Cursor aus der Tabelle sprang, und man musste für jeden weiteren Schritt erst wieder in eine Zelle tippen. Am Telefon ging das praktisch nie, also blieben Reste stehen. Jetzt räumt jedes weitere Antippen den nächsten Rest weg, bis nichts mehr da ist.</li>
                <li><b>📐 Kopfleiste vermisst sich selbst — auch bei großer Schrift:</b> Wer A+ benutzte, bei dem schob sich die Board-Reihe unter die Aktionsleiste; Lupe und Seitenleisten-Knopf verschwanden dahinter. Ursache: Im Stylesheet stand die Breite der Aktionsleiste als feste Zahl aus einer alten Messung — der Text-Zoom vergrößert die Leiste, die Zahl blieb. Jetzt misst sich die Kopfleiste selbst, und die Board-Reihe setzt exakt dort an, wo die Aktionsleiste endet: bei jeder Zoomstufe, bei jeder Fensterbreite, und auch nach künftigen Knöpfen. Dasselbe gilt für den Umbruch auf zwei Zeilen — bisher hing er an der Fensterbreite, die den Zoom gar nicht kennt.</li>
                <li><b>📌 Das aktive Board bleibt immer sichtbar:</b> In einer langen Board-Reihe scrollte das gerade offene Board mit den anderen aus dem Bild — auf schmalen Schirmen fast immer, und dann sah man nirgends mehr, wo man arbeitet. Jetzt <b>klebt</b> es am linken Rand der Reihe, die übrigen ziehen dahinter vorbei. Wechselst du über den Navigator oder die Suche auf ein Board weit hinten, rückt die Reihe zusätzlich so, dass man die Nachbarn sieht.</li>
                <li><b>🖥 Der Handy-Zoom jetzt auch am PC — zwei Schalter:</b> In ⚙️ → Design → Bedienung steht unter „Karte im Fokus" neu <b>„… am PC mit einem Klick öffnen"</b> und <b>„… am PC formatfüllend statt als Blatt"</b>. Beide sind aus Voreinstellung, damit sich für niemanden ungefragt etwas ändert. Ohne sie gilt am PC weiter: <b>Doppelklick</b> öffnet die Karte (ein einfacher Klick setzt dort den Cursor in den Text — sonst könnte man auf dem Board nicht mehr schreiben), und sie schwebt als Blatt über dem abgedunkelten Board. Mit ihnen ist es exakt wie am Handy: ein Klick, randlos. Am Telefon ändert sich nichts.</li>
                <li><b>🔍 Karte löschen im Zoom führt zurück aufs Board:</b> Wer eine Karte in der Zoom-/Fokus-Ansicht gelöscht (oder archiviert, oder auf ein anderes Board geschoben) hat, saß danach in einer leeren Fläche fest — die Ansicht blieb im Vollbild, obwohl es nichts mehr zu zeigen gab. Jetzt endet der Fokus in dem Moment, in dem die Karte verschwindet, und das Board steht wieder da, wo du es verlassen hast. Bewusst wird <b>nicht</b> zur Nachbarkarte weitergeblättert: Wer löscht, will die Karte weghaben — und ein stiller Wechsel sähe aus, als wäre die falsche erwischt worden.</li>
                <li><b>🖱 Netz-Menü auf jedem Gerät:</b> Das Knoten-Menü im Netz (Board öffnen · Verknüpfen · Hierher zoomen · neu ausschwingen) hing am Rechtsklick beziehungsweise daran, dass der Browser aus einem langen Tipp von sich aus ein Kontextmenü macht — je nach Gerät und Hersteller mal so, mal so. Jetzt gibt es einen Weg, der überall gleich ist: <b>gedrückt halten</b>, mit Finger wie mit Maus. Der Rechtsklick bleibt zusätzlich. Ziehen bricht das Halten ab, ein kurzer Klick öffnet weiterhin einfach das Board — und die Sprechblase am Knoten sagt beides an.</li>
                <li><b>✅ Aufgaben starten beim aktuellen Board:</b> Die Aufgaben-Zentrale zeigte beim Öffnen alles aus dem gesamten Werkzeug — bei gewachsenen Beständen eine Wand aus Zeilen, durch die man sich erst filtern musste. Jetzt ist <b>„Aktives Board"</b> die Voreinstellung und beim Öffnen aktiv; direkt darunter in der Board-Auswahl steht <b>„Auf allen Boards"</b>, darunter die einzelnen Boards. Der Kopf nennt den Umfang immer mit („12 angezeigt · Kochen/Einkaufen"), damit auf schmalen Schirmen — wo die Auswahl hinter dem Trichter liegt — nie unklar bleibt, warum die Liste kurz ist. Wer während einer Sitzung bewusst auf „alle" stellt, behält das; beim nächsten Öffnen zählt wieder, woran gerade gearbeitet wird.</li>
                <li><b>🗃 Archivierte Karten sind auch im Netz archiviert:</b> Im Netz und in der Übersicht tauchten archivierte Karten weiter auf — sie blähten die Board-Kugeln auf, hingen als Punkte daneben und zogen über ihre Portale sogar Verbindungslinien, obwohl sie auf dem Board selbst ausgeblendet sind. Der Archiv-Schalter im Dock gilt jetzt überall gleich: ausgeblendet heißt ausgeblendet, eingeblendet zeigt sie wieder — samt Kartenzahl und Mini-Vorschau.</li>
                <li><b>📑 Eingerückte Aufzählungen ohne Zitat-Balken:</b> Beim Einrücken zeichnete der Editor links neben dem Punkt einen dünnen senkrechten Strich — die eingebaute „Verschachtelungs-Hilfslinie". Die sieht aus wie eine Zitat-Formatierung, hing durch die kompaktere Einrückung in den Karten aber auch noch neben dem Aufzählungspunkt der Elternzeile in der Luft. Sie ist weg; die Ebene erkennt man weiterhin am Zeichen (• ◦ ▪). Ein <b>echtes</b> Zitat (Slash-Menü → „Zitat") behält seinen Balken.</li>
                <li><b>🖥 Ein Fokus für alle Geräte:</b> „Karte im Fokus" gilt jetzt <b>überall</b>, nicht mehr nur am Handy — am Telefon formatfüllend, ab Tablet-Breite als <b>Blatt über dem Board</b>, das abgedunkelt sichtbar bleibt. Damit gibt es nur noch EINEN Weg, an einer einzelnen Karte zu arbeiten; der frühere Klick-Zoom greift nur noch, wenn du den Fokus in ⚙️ → Design abschaltest. Aus dem Fokus führt <b>„▶ Präsentieren"</b> direkt in den Vortrag — <b>ab dieser Karte</b>. Präsentation und Fokus bleiben bewusst getrennt: Der eine Modus ist zum Arbeiten (alle Werkzeuge), der andere zum Zeigen (feste Folienfolge, keine Bedienelemente).</li>
                <li><b>🔍 Der Flug in die Karte:</b> Tippst du eine Karte an, <b>wächst genau diese Karte</b> von ihrem Platz auf dem Board ins Vollbild — man sieht, was man getroffen hat. Beim Schließen fliegt sie zurück, und das Board rückt sie so ins Bild, dass sie <b>ganz</b> zu sehen ist. Wer im System „Bewegung reduzieren" eingestellt hat, bekommt den Wechsel ohne Animation.</li>
                <li><b>✍️ Formatieren am Handy, ohne den Text zu verdecken:</b> Markierst du Text in einer Notiz, dockt die Formatierungsleiste <b>unten an</b> — über der Tastatur, quer schiebbar. Vorher schwebte sie an der Auswahl, legte sich also über genau den Satz, den du formatieren wolltest, und die letzten Knöpfe (Einrücken, Link) lagen außerhalb des Bildes. Am Desktop bleibt alles wie gewohnt.</li>
                <li><b>🧰 Im Fokus sind jetzt alle Werkzeuge da (Handy):</b> Über der Blätter-Zeile liegt die <b>Werkzeugleiste der Karte</b> — mit ⋯ für Nachschlagen, Eigenschaften, Schrift &amp; Größe, Vorlage, Kommentar, Teilen, Archiv und (bei eingerichteter KI) die KI-Aktionen. Vorher musste man dafür den Fokus verlassen, herauszoomen und die Karte auf dem Board treffen. Beim Blättern wandert die Auswahl mit, die Werkzeuge gelten also immer für die Karte, die du gerade siehst. Das <b>⋯ oben rechts</b> öffnet dasselbe Menü — es führte vorher nur zum Teilen-Dialog.</li>
                <li><b>🔭 Der Zoom wechselt die Ebene:</b> Ziehst du das Netz weit heraus, treten die einzelnen Boards zurück und die <b>Bereiche</b> übernehmen — als Kontinente mit großer Beschriftung. Dazwischen liegen die <b>Projekte</b>, ganz nah wieder die Boards. Nichts springt dabei, die Ebenen blenden ineinander. Weit draußen fasst PixiNotes außerdem alle Verbindungen zwischen zwei Bereichen zu einem <b>Band</b> zusammen und schreibt die Anzahl daran — so siehst du auf einen Blick, wie eng Dienstliches und Privates tatsächlich verwoben sind, statt hundert Einzellinien zu zählen.</li>
                <li><b>🧠 Sub-Brains — Bereiche einzeln abschalten:</b> In ⚙️ → KI legst du fest, <b>welche Bereiche zum Gehirn gehören</b>. Wer „Privat" abschaltet, hält Privates aus dienstlichen KI-Antworten heraus: keine Bedeutungssuche, keine Vorschläge, kein Puls. Wichtig dabei — die bereits berechneten Vektoren werden <b>gelöscht</b>, nicht bloß ausgeblendet. Jederzeit umschaltbar, der Index baut sich beim Einschalten neu auf.</li>
                <li><b>🎫 Kanban-Tickets ziehen — jetzt auch mit dem Finger:</b> Zwischen Spalten UND innerhalb einer Spalte umsortieren. Am Handy kurz halten, dann ziehen (so bleibt das Scrollen der Spalte möglich); mit der Maus einfach losziehen. Eine Marke zeigt, wo das Ticket landet. WIP-Limits und Abhängigkeiten bremsen wie gewohnt.</li>
                <li><b>⌘ Befehle in der Suche:</b> Strg+K findet nicht nur, sondern <b>handelt</b> auch. Tippe „notiz", „kanban", „übersicht", „aufgaben", „netz", „einstellungen" — passende Befehle stehen über den Treffern und legen an oder wechseln die Ansicht.</li>
                <li><b>🛟 Kaputte Karte reißt nichts mehr mit:</b> Stolpert ein Modul über beschädigte Daten, erscheint an seiner Stelle eine Meldung statt einer weißen Seite. Der Rest des Boards arbeitet weiter, und die Daten bleiben unangetastet.</li>
                <li><b>📱 Karte im Fokus (Handy):</b> Ein Tipp auf eine Karte öffnet sie <b>formatfüllend</b> — mit Titel und ✕ oben, Blättern unten. Der Grund: Die Module sind kleine Anwendungen, und ein Stundenraster oder Kanban im Canvas auf Handy-Breite zu bedienen ist ein Kampf, den man nicht gewinnt. Im Fokus gibt es nur, was zu diesem Modul gehört; Verbinden, Anordnen und Archivieren bleiben Board-Sache. <b>Wischen</b> blättert zur Nachbarkarte, <b>nach unten wischen</b>, das <b>✕</b> oder die <b>Zurück-Taste</b> führen aufs Board. Abschaltbar unter ⚙️ → Design → Bedienung.</li>
                <li><b>📱 Ruhe am Handy, wenn die Tastatur kommt</b> — sobald du tippst, weicht alles, was gerade nicht hilft: Das Dock fährt weg, Zoom-Knöpfe und Fußzeile blenden aus, und die Eingabe-Blasen von Planer und Kalender docken als Blatt direkt über der Tastatur an, statt das Modul zu verdecken, in das du schreibst. Ist etwas ausgewählt, übernimmt die Auswahl-Leiste die Dock-Zeile — eine Leiste statt zweier gestapelter, und nie mehr zweireihig.</li>
              </ul>
            </section>
            <div className="help-foot">
              <button className="link-btn" onClick={() => setSeite('hilfe')}>Zur Hilfe</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal help-modal" role="dialog" aria-modal="true" aria-label="Hilfe" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>❓ Hilfe</h2>
          <input
            className="help-search"
            type="search"
            placeholder="Hilfe durchsuchen…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Hilfe durchsuchen"
          />
          <button className="modal-x" onClick={() => setOpen(false)} aria-label="Schließen">✕</button>
        </div>
        <div className="help-layout">
          <nav className="help-nav">
            {SECTIONS.filter((s) => !hits || hits[s.id]).map((s) => (
              <button key={s.id} className={active === s.id ? 'on' : ''} onClick={() => jump(s.id)}>
                <span>{s.icon}</span> {s.title}
                {hits?.[s.id] ? <em className="help-count">{hits[s.id]}</em> : null}
              </button>
            ))}
            {hits && Object.keys(hits).length === 0 && (
              <div className="help-empty">Nichts gefunden zu „{query.trim()}" — anders formulieren?</div>
            )}
            <div className="help-nav-recht">
              {RECHT.filter((s) => !hits || hits[s.id]).map((s) => (
                <button key={s.id} className={'recht' + (active === s.id ? ' on' : '')} onClick={() => jump(s.id)}>
                  <span>{s.icon}</span> {s.title}
                  {hits?.[s.id] ? <em className="help-count">{hits[s.id]}</em> : null}
                </button>
              ))}
            </div>
          </nav>
          <div className="help-body" ref={bodyRef}>

            <section id="help-start">
              <h3>🚀 Erste Schritte</h3>
              <p>PixiNotes ist ein Whiteboard: eine Fläche voller Karten. Alles bleibt <b>lokal in deinem Browser</b> — kein Konto, kein Server.</p>
              <h4>Karten anlegen</h4>
              <ul>
                <li><b>Doppelklick</b> auf die Fläche legt eine Notiz an.</li>
                <li><b>＋</b> im Dock zeigt Notiz, Kanban-Board, Rechen-Tabelle, Datei oder Bild und Zeitplan. „Weitere Module" öffnet den Rest samt Vorlagen.</li>
                <li><b>Strg+V</b> fügt Bilder und Screenshots ein. E-Mails, PDFs, Bilder und Dateien einfach aufs Board ziehen.</li>
              </ul>
              <h4>Bewegen, Größe, Zoom</h4>
              <ul>
                <li>Karten am <b>Griff</b> über der Oberkante oder an der Titelzeile ziehen, am Rand die Größe ändern.</li>
                <li>Karten wachsen mit ihrem Inhalt. Wer selbst zieht, bestimmt die Größe; läuft der Inhalt über, bietet ein <b>⤢-Chip</b> einmaliges Anpassen an.</li>
                <li>Die zuletzt angefasste Karte liegt vorn.</li>
                <li>Zoomen mit <b>Strg+Rad</b>, Pinch oder Mausrad (⚙ → Design). <b>F</b> passt die Auswahl ein, <b>Esc</b> beendet den Fokus.</li>
                <li>Die <b>Minimap</b> erscheint ab zehn Karten; ein Klick darauf springt an die Stelle.</li>
              </ul>
              <h4>Auswahl-Leiste</h4>
              <ul>
                <li>Karte anklicken → die Leiste sitzt an der Karte: <b>Duplizieren · Verschieben · Teilen · ⋯ · Löschen</b>.</li>
                <li>Im <b>⋯</b>: Formatiert kopieren, Nachschlagen, Eigenschaften, Vorlage, Kommentar, Schrift &amp; Größe, KI, Ausrichten &amp; Verteilen, Als Kachel zeigen, Auto-Größe, Markierungen lösen, Archivieren.</li>
                <li>Bei einem Rahmen kommt <b>„Rahmen"</b> dazu: Umbenennen, Tönung, Inhalt anordnen.</li>
              </ul>
              <h4>Board</h4>
              <ul>
                <li>Dock <b>⋯ → „Board aufräumen"</b> ordnet Verbundenes als Fluss und den Rest als Raster; Strg+Z stellt alles wieder her. „Anordnen &amp; Hintergrund" bietet Varianten, Gitter und Tönung.</li>
                <li><b>Strg+K</b> sucht überall — auch Personen, Eigenschaften und #Tags. <b>Strg+Z / Strg+Y</b> machen rückgängig und wiederholen.</li>
                <li><b>Archivieren:</b> Karte → ⋯ → „Archivieren". Dock ⋯ → „Archiv einblenden" zeigt Archiviertes gedimmt; dort „Zurückholen".</li>
                <li>Ruhe ist Voreinstellung: <b>Physik, Klick-Zoom und Konfetti</b> schaltest du unter ⚙ → Design → „Bewegung auf der Fläche" ein.</li>
                <li>⚙ → Daten → Starter-Umgebung <b>„Verwaltung"</b>: 14 Beispiel-Boards zum Ausprobieren.</li>
              </ul>
            </section>

            <section id="help-ordnung">
              <h3>🗂️ Bereiche · Projekte · Boards</h3>
              <p>Drei Ebenen: <b>Bereiche</b> bündeln <b>Projekte</b>, Projekte bündeln <b>Boards</b>.</p>
              <h4>Navigation</h4>
              <ul>
                <li>Ab Tablet-Breite steht links die <b>Navigation</b> mit dem ganzen Baum <b>Bereich › Projekt › Board › Karte</b>. Klick öffnet, ▸ klappt auf, das Suchfeld findet Boards und Karten.</li>
                <li><b>Alt+U</b> blendet die Spalte aus und ein, <b>Alt+W</b> springt in ihre Suche.</li>
                <li>Am Telefon öffnet der Weg <b>„Projekt › Board"</b> in der Kopfzeile denselben Baum.</li>
                <li><b>🏠 Übersicht:</b> Bereiche als Zonen, Boards als Kacheln — per Drag in andere Projekte verschiebbar. Der Umschalter <b>Hierarchie ⇄ Netz</b> zeigt dort den Verknüpfungs-Graphen (Portale, [[Wikilinks]]).</li>
              </ul>
              <h4>⋯ an Board und Projekt</h4>
              <ul>
                <li><b>Board:</b> Umbenennen · Duplizieren · In Projekt verschieben · Teilen-Link · Als Datei sichern · Präsentieren · Archivieren · Löschen.</li>
                <li><b>Projekt:</b> Umbenennen · Neues Board · Duplizieren · Alle Boards archivieren · Löschen.</li>
                <li>Archivierte Boards verschwinden aus Navigation und Übersicht, ihre Fristen ruhen. Dock ⋯ → „Archiv einblenden" zeigt sie; dort ⋯ → Zurückholen.</li>
              </ul>
              <h4>Portale</h4>
              <ul>
                <li>Ein <b>Portal</b> ist eine Karte, die auf ein anderes Board springt. PixiNotes legt drüben automatisch den Rückverweis an.</li>
              </ul>
            </section>

            <section id="help-karten">
              <h3>🃏 Karten &amp; Module</h3>
              <h4>📝 Notiz</h4>
              <ul>
                <li>Block-Editor; <b>„/"</b> öffnet Checklisten, Tabellen und Überschriften. Der Farbpunkt oben rechts färbt die Karte.</li>
                <li>Bilder mitten im Text: <b>Strg+V</b>, Drag &amp; Drop oder „/" → <b>„Bild aus Zwischenablage"</b> und <b>„Bild aus Datei"</b> (am Telefon Fotomediathek oder Kamera). Fotos werden verkleinert. „/" → <b>„Datei als Karte daneben"</b> legt PDF, Word &amp; Co. als Datei-Karte neben die Notiz.</li>
                <li>Text markieren → schwebende Leiste: Fett, Kursiv, Farben, <b>A₋ / A₊ / A₊₊</b> und <b>Aa</b> für die Markierung. Schrift für die ganze Karte: ⋯ → „Schrift &amp; Größe".</li>
                <li><b>[[Wikilinks]]</b> verlinken Boards oder Karten, <b>#Tags</b> gliedern; Strg+K und „#" listet alle Themen.</li>
              </ul>
              <h4>📋 Kanban</h4>
              <ul>
                <li>Spalten frei benennbar. Klick auf ein Ticket öffnet das <b>Ticket-Fenster</b>: Beschreibung, Frist, Person, Priorität, Checkliste, Abhängigkeiten (🔒) und Verknüpfungen zu Karten.</li>
                <li>Kopfzeile: <b>🔍 Filter</b> und <b>⋯</b>. Im ⋯: Einsammeln (offene Aufgaben aus anderen Boards, auch automatisch), Archiv &amp; Automatik, „Erledigte archivieren", kompakte Tickets, Spalte hinzufügen, Als Kachel zeigen.</li>
                <li><b>Erledigt</b> ordnet nach Heute · Diese Woche · Älter; jede Gruppe lässt sich archivieren. Das Archiv holt Tickets zurück oder löscht sie endgültig; die Automatik räumt Erledigtes nach einer wählbaren Zahl Tage selbst weg.</li>
              </ul>
              <h4>📅 Zeitplan, Wochenplan, Zeiterfassung, Protokoll</h4>
              <ul>
                <li><b>Zeitplan (Gantt):</b> Balken ziehen, ◆ Meilenstein, Pfeile = Abhängigkeiten mit Konflikt-Warnung; Skala von Tagen bis Jahren.</li>
                <li><b>Wochenplan:</b> Raster aus Spalten (Wochentage oder frei: Personen, Räume) × Zeilen (Uhrzeiten oder eigene Einheiten). Klick auf einen Slot legt einen Block an.</li>
                <li><b>Zeiterfassung:</b> Arbeit / Pause mit einem Klick, jede Zeile direkt editierbar; Ansichten Tag, Woche, Monat, Jahr.</li>
                <li><b>Protokoll-Reihe:</b> eine Karte für eine ganze Besprechungsserie. „＋ Neue Sitzung" nimmt offene Punkte mit; Rhythmus und feste Tagesordnung im ⚙ der Karte; Beschlüsse getrennt von Aufgaben.</li>
                <li><b>Kachel:</b> ⋯ → „Als Kachel zeigen" klappt diese Module auf Typ, Titel und Kennzahlen zusammen. „Öffnen" zeigt das Modul im Fokus, „Ausklappen" bringt es in alter Größe zurück.</li>
              </ul>
              <h4>Weitere Module</h4>
              <ul>
                <li><b>Σ Rechen-Tabelle:</b> „=" beginnt eine Formel (<code>=SUMME(B2:B9)</code>, <code>=WENN(A1&gt;100;"über Plan";"im Rahmen")</code>), deutsche und englische Namen. Σ setzt Auto-Summen; <code>.xlsx</code> aufs Board ziehen, CSV zurück.</li>
                <li><b>🗓️ Kalender:</b> Monat/Woche mit Aufgaben, Zeitplänen und Meilensteinen; eigene Termine per Klick auf den Tag; ICS-Import, -Abo und -Export. Google / Microsoft 365 unter ⚙ → Dienste (nur lesen).</li>
                <li><b>📊 Diagramm (Mermaid):</b> acht Vorlagen, alles direkt im Bild bearbeiten, die Werkzeuge schweben unter dem Diagramm; ✨ ändert es per Sprache.</li>
                <li><b>▢ Prozess-Formen:</b> Schritt, Entscheidung, Start/Ende; Doppelklick beschriftet.</li>
                <li><b>📎 Datei, Bild, PDF, E-Mail:</b> Vorschau statt Dateiname; ＋/−, Strg+Rad und Doppelklick zoomen. Der Inhalt liegt in der Ablage dieses Geräts, im Team-Projekt zusätzlich im Anlagen-Ordner. Doppelklick auf den Titel benennt um, der Dateiname bleibt.</li>
                <li><b>🧩 Eigene App (HTML):</b> läuft abgeschottet in der Karte, Start per ▶; Vollbild, eigener Tab und Speicherstand ins Team über das ⋮ der Karte. „App von URL" holt ein Tool aus dem Netz.</li>
                <li><b>📓 OneNote &amp; Word:</b> ⚙ → Daten holt Notizbücher aus Microsoft 365 (Notizbuch → Bereich, Abschnitt → Board, Seite → Notiz), das Konto steht unter ⚙ → Dienste. Ohne Konto die <code>.docx</code> aufs Board ziehen.</li>
                <li><b>Rahmen:</b> ＋ → Weitere Module → Rahmen. Er fängt Karten ein, deren Mittelpunkt in ihm liegt, und nimmt sie beim Ziehen mit.</li>
              </ul>
              <h4>🔗 Verbinden &amp; Präsentieren</h4>
              <ul>
                <li>Mit der Maus auf eine Karte zeigen (am Touchscreen: antippen) → die <b>＋-Punkte</b> am Rand ziehen und auf der Zielkarte loslassen. Klick auf die Linie: Beschriftung oder Pfeilart; Entf löscht.</li>
                <li>Verbindungen transportieren Daten: <b>Notiz / Zeitplan / Kanban → Kanban</b> sammelt offene Punkte als Tickets ein und hakt in beide Richtungen ab. <b>Modul → Kalender</b> zeigt nur Verbundenes, <b>Kanban → Zeitplan</b> zeigt Fristen als Meilensteine, <b>Wochenplan → Zeiterfassung</b> liefert das Soll, <b>Notiz → Diagramm</b> folgt der Checkliste.</li>
                <li><b>▶ Präsentation:</b> jede Karte eine Folie, Reihenfolge nach Verbindungen, live editierbar.</li>
              </ul>
              <h4>✏️ Zeichnen</h4>
              <ul>
                <li><b>✎</b> im Dock: Stift, Textmarker, Radierer; Esc zurück. Nach dem Zeichnen kurz halten macht Linien gerade und Kreise rund.</li>
                <li>Striche, die eine Karte überlappen, kleben an ihr und wandern mit. Lösen: ⋯ → „Markierungen lösen".</li>
              </ul>
              <h4>💡 Wissen</h4>
              <ul>
                <li><b>↩ Backlinks</b> unten rechts zeigen, wer auf dieses Board verweist.</li>
                <li><b>Eigenschaften</b> (⋯): schlüssel = wert, durchsuchbar und im Export. <b>Vorlagen:</b> jede Karte sichern, einfügen über ＋ → Weitere Module.</li>
                <li><b>Nachschlagen</b> (⋯): Wikipedia-Treffer zur ersten Zeile der Karte, dazu die Suchseiten von DuckDuckGo, Google, Bing und OpenStreetMap.</li>
                <li><b>🧠 Gehirn</b> (⚙ → Dienste): Suche nach Bedeutung, verwandte Karten im ↩-Panel, Themen-Inseln im Gehirn-Puls (✅), Verbindungs-Vorschläge im Netz, „Frag dein Gehirn" in der Suche. Ollama, im Browser oder Cloud — der Index bleibt lokal.</li>
              </ul>
              <h4>✨ KI</h4>
              <ul>
                <li><b>Anbieter</b> unter ⚙ → Dienste: Gratis, OpenRouter, eigener Schlüssel oder Ollama (alles lokal). Schlüssel bleiben auf dem Gerät.</li>
                <li>Dock ⋯ → <b>„KI-Assistent"</b> fürs Board, Auswahl ⋯ → <b>„KI-Aktionen"</b> für markierte Karten: Freitext, Themen clustern, Aufgaben extrahieren, Diagramm, Briefing, Text verbessern. Bild-Karten gehen als Foto mit, wenn das Modell Bilder versteht.</li>
                <li>Jede KI-Aktion ist ein einziger Strg+Z-Schritt.</li>
                <li>Bei Ollama liest PixiNotes die installierten Modelle aus. Antwortet der Server nicht, unterscheidet die App „läuft nicht" und „darf nicht" und zeigt die passende <code>OLLAMA_ORIGINS</code>-Anleitung.</li>
              </ul>
            </section>

            <section id="help-aufgaben">
              <h3>✅ Aufgaben &amp; Erinnerungen</h3>
              <ul>
                <li>Aufgaben entstehen überall: Kanban-Tickets, ☐-Checklisten in Notizen und Zeitplan-Vorgänge unter 100 %.</li>
                <li><b>✅ im Dock</b> sammelt alles boardübergreifend nach Frist: Überfällig · Heute · Diese Woche · Später · Ohne Frist. Abhaken, Frist ändern, +1T/+1W, Spalte umstellen, Kalender-Export.</li>
                <li>Die <b>Schnell-Eingabe</b> versteht „Bericht <b>bis Freitag @Anna #haushalt !!</b>": Frist, Person, Tag und Priorität (! niedrig · !! mittel · !!! hoch).</li>
                <li>Antippen klappt die Werkzeuge einer Zeile auf; <b>› Details</b> öffnet die Bearbeiten-Spalte.</li>
                <li><b>☀ Mein Tag:</b> handverlesene Fokusliste für heute. <b>Heute geschafft</b> protokolliert Abgehaktes mit Wochen-Balken.</li>
                <li><b>👥</b> gruppiert nach Person; Freitext und #Tags filtern.</li>
                <li><b>✨ Woche planen:</b> die KI fasst offene Aufgaben zu einem Briefing zusammen und legt es als Notiz ab.</li>
                <li><b>Erinnerungen:</b> Fälliges meldet sich beim Öffnen und regelmäßig, optional als System-Benachrichtigung. Fristen kommen vom Ticket (📅) oder aus „bis Freitag" im Text.</li>
              </ul>
            </section>

            <section id="help-daten">
              <h3>💾 Speichern, Sync &amp; Teilen</h3>
              <h4>Speichern</h4>
              <ul>
                <li>Alles speichert <b>automatisch lokal</b>. ⚙ → Daten → „Datei exportieren" für Backups; „Alles leeren" mit doppelter Bestätigung.</li>
                <li><b>Mehrere Fenster:</b> nur eines speichert, die anderen lesen mit und bieten „Hier weiterarbeiten".</li>
                <li><b>PWA:</b> „App installieren" macht PixiNotes zur Offline-App.</li>
              </ul>
              <h4>Sync</h4>
              <ul>
                <li><b>Sync-Ordner</b> (Nextcloud, OneDrive, Dropbox): PixiNotes schreibt dort automatisch; ein neuerer Stand wird übernommen, bei Konflikten fragt die App.</li>
                <li>Die <b>Wolke</b> oben zeigt den Stand: gespeichert, läuft, hakt. Durchgestrichen: Ordner-Freigabe nach dem Neustart erneut erteilen — ein Klick.</li>
                <li><b>WebDAV:</b> Ordner-URL und App-Passwort unter ⚙ → Synchronisation, auch am Handy. Nextcloud braucht eine CORS-Freigabe (z. B. App „WebAppPassword"); ein fertiger Text zum Kopieren liegt dort bereit.</li>
                <li><b>iPad / iPhone:</b> „Stand sichern → Dateien-App" und „Stand laden…" tauschen dieselbe <code>pixinotes-daten.json</code> wie der Sync-Ordner. Zum Home-Bildschirm installieren, sonst löscht Safari nach 7 Tagen.</li>
                <li><b>Team-Sync:</b> ein Projekt in einen eigenen Ordner spiegeln (⚙ → Synchronisation). „Einladen…" mailt die Anleitung, „Projekt beitreten…" nimmt sie an; die Ordner-Freigabe regelt den Zugang.</li>
                <li><b>Kommentare</b> (⋯ → Kommentar): Pins an der Karte mit Initialen, das Gespräch als Blase daneben; wandern im Team mit.</li>
              </ul>
              <h4>Teilen &amp; Export</h4>
              <ul>
                <li>Auswahl → <b>Teilen:</b> Übernahme-Link, WhatsApp, E-Mail, Drucken / PDF, formatiertes Kopieren für Outlook und Word.</li>
                <li><b>⧉</b> oben kopiert das ganze Board als Link; große Boards werden zur <code>.pixiboard.json</code>-Datei.</li>
                <li><b>Export:</b> ⚙ → Daten schreibt alle Boards als Markdown-Ordner (Obsidian). Dock ⋯ → „Als Bild exportieren" gibt das aktuelle Board als PNG, SVG oder PDF aus; .ics kommt aus Aufgaben und Kalender.</li>
                <li><b>Android:</b> das installierte PixiNotes steht im Teilen-Menü jeder App (Foto, Seite, PDF, Text). Fehlt es trotz Installation: deinstallieren und in Chrome neu installieren.</li>
                <li><b>iPhone / iPad:</b> „Kopieren" in Fotos, dann ＋ → Weitere Module → „Aus Zwischenablage einfügen".</li>
              </ul>
            </section>

            <section id="help-tasten">
              <h3>⌨️ Tastenkürzel</h3>
              <p className="legal-hint">
                Jedes Kürzel steht auch in der Sprechblase des passenden Knopfes — einfach mit der Maus darüber bleiben.
              </p>
              {(['Überall', 'Ansichten', 'Board', 'Karten', 'Text & Zeichnen'] as const).map((gruppe) => (
                <div key={gruppe}>
                  <h4>{gruppe}</h4>
                  <table className="help-keys">
                    <tbody>
                      {KUERZEL.filter((k) => k.gruppe === gruppe).map((k) => (
                        <tr key={k.id}>
                          <td>{taste(k.id).split('+').map((t, i) => (
                            <span key={i}>{i > 0 && '+'}<kbd>{t}</kbd></span>
                          ))}</td>
                          <td>{k.was}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </section>

            <section id="help-impressum">
              <h3>⚖️ Impressum</h3>
              <p className="legal-hint">Angaben gemäß § 5 DDG</p>
              <p>
                <b>Hannes Pix</b><br />
                Eisenbahnstraße 19<br />
                79241 Ihringen am Kaiserstuhl<br />
                Baden-Württemberg, Deutschland
              </p>
              <p>
                <b>Kontakt:</b> <MailLink /><br />
                <b>Website:</b>{' '}
                <a className="ent-link" href="https://pix-el.de" target="_blank" rel="noreferrer">pix-el.de</a><br />
                <b>Quellcode &amp; Projekt:</b>{' '}
                <a className="ent-link" href="https://github.com/hannespix/pixinotes" target="_blank" rel="noreferrer">github.com/hannespix/pixinotes</a>
              </p>
              <p>
                <b>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV:</b><br />
                Hannes Pix, Anschrift wie oben
              </p>
              <p>
                <b>EU-Streitschlichtung:</b> Die Europäische Kommission stellt eine Plattform zur
                Online-Streitbeilegung (OS) bereit:{' '}
                <a className="ent-link" href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noreferrer">ec.europa.eu/consumers/odr</a>.
                Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer
                Verbraucherschlichtungsstelle teilzunehmen.
              </p>
              <p>
                PixiNotes ist ein nicht-kommerzielles Werkzeug ohne Konto, ohne Bezahlfunktion und ohne
                redaktionelle Inhalte Dritter. Für extern verlinkte Seiten sind deren Betreiber verantwortlich;
                zum Zeitpunkt der Verlinkung waren keine Rechtsverstöße erkennbar.
              </p>
            </section>

            <section id="help-datenschutz">
              <h3>🔒 Datenschutzerklärung</h3>
              <p className="legal-hint">Stand: Juli 2026 · Verantwortlich: siehe Impressum</p>

              <h4>Das Wichtigste zuerst</h4>
              <ul>
                <li>PixiNotes arbeitet <b>komplett lokal in deinem Browser</b>. Es gibt keinen PixiNotes-Server, kein Konto, keine Registrierung.</li>
                <li>Die App setzt <b>keine Cookies</b>, nutzt <b>kein Tracking</b> und keine Analyse-Dienste.</li>
                <li>Alle Inhalte (Boards, Karten, Einstellungen) liegen ausschließlich im lokalen Speicher deines Browsers (localStorage/IndexedDB) und werden vom Betreiber <b>weder erhoben noch eingesehen</b>.</li>
              </ul>

              <h4>Hosting (GitHub Pages)</h4>
              <p>
                Die Web-Version wird über GitHub Pages (GitHub Inc., USA) ausgeliefert. Beim Abruf verarbeitet
                GitHub technisch notwendige Server-Logs (u. a. IP-Adresse) zur Bereitstellung und Sicherheit
                (Art. 6 Abs. 1 lit. f DSGVO). Details:{' '}
                <a className="ent-link" href="https://docs.github.com/site-policy/privacy-policies/github-privacy-statement" target="_blank" rel="noreferrer">GitHub Privacy Statement</a>.
                Die als Einzeldatei gespeicherte Version (file://) kommt ganz ohne Hosting aus.
              </p>

              <h4>Optionale Dienste — nur wenn DU sie aktivierst</h4>
              <p>Standardmäßig verlässt kein Inhalt dein Gerät. Erst wenn du in den Einstellungen einen Dienst einrichtest, fließen Daten dorthin:</p>
              <ul>
                <li><b>KI-Assistent:</b> Beim Ausführen einer KI-Aktion werden die Inhalte der betroffenen Karten an den von dir gewählten Anbieter gesendet (z. B. Pollinations, OpenRouter, Anthropic, OpenAI oder deinen eigenen Ollama-/Firmen-Server). Es gilt die Datenschutzerklärung des jeweiligen Anbieters; API-Schlüssel bleiben lokal.</li>
                <li><b>Kalender-Konten (Google/Microsoft 365):</b> Nur-Lese-Zugriff auf Termine per OAuth direkt zwischen deinem Browser und dem Anbieter. Zugangs-Tokens werden ausschließlich lokal gespeichert und landen nie in Sync-Dateien, Share-Links oder Exporten.</li>
                <li><b>Synchronisation (Sync-Ordner/WebDAV):</b> Deine Board-Daten werden in den von dir gewählten Ordner bzw. auf deinen eigenen Server geschrieben — ohne KI-Schlüssel und ohne Konto-Tokens.</li>
                <li><b>ICS-Abos:</b> Beim Aktualisieren ruft dein Browser die von dir eingetragene Kalender-URL direkt ab.</li>
                <li><b>Teilen-Links:</b> Der Board-Inhalt steckt komprimiert im Link selbst (hinter „#") und wird beim Öffnen nicht an einen Server übertragen — wer den Link hat, kann das geteilte Board lesen. Teile Links entsprechend bewusst.</li>
              </ul>

              <h4>Deine Rechte</h4>
              <p>
                Da die App selbst keine personenbezogenen Daten an den Betreiber übermittelt, liegen dort in der
                Regel keine Daten über dich vor. Für die Hosting-Logs gelten die Rechte aus Art. 15–21 DSGVO
                gegenüber GitHub. Fragen jederzeit an <MailLink />.
                Alle lokalen Daten löschst du selbst: ⚙️ → Daten → „Alles leeren" oder über die Website-Daten deines Browsers.
              </p>
              <p className="legal-hint">Dieses Muster ersetzt keine Rechtsberatung.</p>
            </section>

            <div className="help-foot">
              PixiNotes — lokal, offen, deins. Feedback jederzeit willkommen. 📌
              <br />
              <button className="link-btn help-neu-link" onClick={() => setSeite('neu')}>Was ist neu</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
