import { useEffect, useRef, useState } from 'react';
import { useBoard } from '../store';
import { MailLink } from './MailLink';

/**
 * Die Hilfe-Seite (❓ im Dock): erklärt jede Funktion in Alltagssprache,
 * gegliedert mit Anker-Navigation. Vollständig offline — keine externen Links nötig.
 */
const SECTIONS = [
  { id: 'start', icon: '🚀', title: 'Erste Schritte' },
  { id: 'neu', icon: '🆕', title: 'Was ist neu' },
  { id: 'ordnung', icon: '🗂️', title: 'Bereiche · Projekte · Boards' },
  { id: 'karten', icon: '🃏', title: 'Karten-Typen' },
  { id: 'verbinden', icon: '🔗', title: 'Verbinden & Präsentieren' },
  { id: 'zeichnen', icon: '✏️', title: 'Zeichnen' },
  { id: 'aufgaben', icon: '✅', title: 'Aufgaben & Erinnerungen' },
  { id: 'wissen', icon: '💡', title: 'Wissen & Verknüpfen' },
  { id: 'ki', icon: '✨', title: 'KI-Assistent' },
  { id: 'daten', icon: '💾', title: 'Speichern, Sync & Teilen' },
  { id: 'tasten', icon: '⌨️', title: 'Tastenkürzel' },
  { id: 'impressum', icon: '⚖️', title: 'Impressum' },
  { id: 'datenschutz', icon: '🔒', title: 'Datenschutz' },
] as const;

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
  const [query, setQuery] = useState('');
  // Treffer pro Sektion (null = keine Suche aktiv). Der Text wird aus dem
  // gerenderten DOM gelesen — so bleibt die Suche automatisch vollständig,
  // egal was in den Sektionen steht (kein doppelt gepflegter Suchindex).
  const [hits, setHits] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    if (!open) return;
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
    for (const s of SECTIONS) {
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
  }, [query, open]);

  // Direktsprung (z. B. „Impressum" aus dem Einstellungs-Fuß)
  useEffect(() => {
    if (!open || !helpSection) return;
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
          </nav>
          <div className="help-body" ref={bodyRef}>

            <section id="help-start">
              <h3>🚀 Erste Schritte</h3>
              <p>PixiNotes ist ein Whiteboard: eine unendliche Fläche voller Karten. Alles bleibt <b>lokal in deinem Browser</b> — kein Konto, kein Server.</p>
              <ul>
                <li><b>Doppelklick</b> auf die Fläche legt eine Notiz an, <b>➕</b> im Dock alle anderen Module.</li>
                <li>Karten <b>ziehen</b> (Griff-Pill oben oder Karte fassen), am Rand <b>resizen</b>, mit Schwung werfen 🚀.</li>
                <li><b>Klick-Zoom:</b> Anklicken fliegt sanft zur Karte, wenn sie klein/angeschnitten ist (⚙ → Design → Bedienung abschaltbar); <b>Esc</b> fliegt zurück. Dort auch „Mausrad zoomt" im Miro-Stil. <b>Zoomen funktioniert auch mitten über einer Karte:</b> Strg+Rad, Trackpad-Pinch und der Zwei-Finger-Pinch greifen aufs Board durch — normales Scrollen im Karteninhalt bleibt davon unberührt. Auch <b>Ein-Finger-Schwenken</b> geht mitten über einer Karte: einfach auf einer freien Stelle des Karteninhalts losziehen (Griff-Pill verschiebt weiter die Karte, ein kurzer Tipp bleibt ein Tipp, scrollbarer Inhalt scrollt zuerst selbst). Klick auf die <b>Minimap</b> springt an die Stelle, <b>F</b> passt die Auswahl ein.</li>
                <li><b>Strg+V</b> fügt Screenshots &amp; Bilder aus der Zwischenablage ein; E-Mails (.eml/.msg), Bilder, PDFs und Dateien einfach aufs Board ziehen.</li>
                <li>Überlappende Karten: Die <b>zuletzt angefasste Karte legt sich automatisch nach vorn</b> und bleibt dort — bis eine andere angeklickt wird (praktisch mit 🧲 Physik AUS — im Dock unter ⋯ „Mehr").</li>
                <li><b>Auto-Größe:</b> Karten wachsen automatisch mit ihrem Inhalt (standardmäßig aktiv; gedrosselt, offene Menüs bleiben ungestört, nie schrumpfend). <b>Manuelles Ziehen gewinnt immer:</b> es schaltet die Automatik für diese Karte ab, deine Größe wird nie von selbst geändert. Läuft der Inhalt später über, erscheint nur ein dezenter ⤢-Chip an der Karte als <b>Angebot</b> — ein Klick passt die Höhe einmalig an. Dauerhaft wieder einschalten: Karte auswählen → ⋯-Menü → „Auto-Größe".</li>
                <li><b>Einzelne Karten teilen:</b> Karte(n) auswählen → ⋯-Menü → <b>„Teilen &amp; Export"</b> — ein Dialog mit allen Wegen: <b>Übernahme-Link</b> (serverlos, die Karten stecken komplett im Link — wer ihn öffnet, übernimmt sie als eigenes Board in PixiNotes), <b>WhatsApp</b>, <b>E-Mail</b>, <b>Drucken</b> (dort auch „als PDF sichern"), fertige <b>PDF-Datei</b> zum Herunterladen und formatiertes <b>Kopieren</b> für Outlook/Word.</li>
                <li><b>Weniger Knöpfe, alles noch da (⋯ „Mehr"):</b> Auswahl-Leiste und Dock zeigen nur noch die häufigsten Aktionen — alles Weitere bündelt jeweils das <b>⋯-Menü</b>: in der Auswahl-Leiste E-Mail, Nachschlagen, Eigenschaften, Vorlage, Kommentar, KI, Ausrichten, Auto-Größe und Archiv; im Dock KI-Assistent, Aufräumen &amp; Anordnen, Physik und Archiv.</li>
                <li><b>Schrift &amp; Textgröße pro Karte:</b> Karte(n) auswählen → ⋯-Menü → „Schrift &amp; Größe" — kuratierte Schriften (Standard, Serifen, <b>„Sehr gut lesbar"</b> = die für Sehschwäche entworfene Atkinson Hyperlegible, Handschrift, Monospace) und Textgrößen S/M/L/XL. Gilt für die ganze Karte, funktioniert offline (Schriften sind eingebettet) und lässt sich jederzeit auf Standard zurücksetzen.</li>
                <li><b>Text in Notizen formatieren:</b> Text markieren → in der schwebenden Leiste gibt es neben Fett/Kursiv/Farben jetzt <b>A₋ / A₊ / A₊₊</b> (Textgröße nur für die Markierung) und <b>Aa</b> (Schrift der Markierung wechseln: Serifen → Sehr gut lesbar → Handschrift → Monospace → Standard).</li>
                <li><b>📏 Ausrichten &amp; Verteilen:</b> Mehrere Karten auswählen → ⋯-Menü der Auswahl-Leiste → „Ausrichten &amp; Verteilen" — links/oben ausrichten, zentrieren, gleichmäßig verteilen, gleiche Breite (wie in PowerPoint).</li>
                <li><b>Archivieren:</b> Karte(n) auswählen → ⋯-Menü → „Archivieren" — die Karte gilt als erledigt, verschwindet vom Board und aus Aufgaben/Erinnerungen (eingesammelte Tickets werden als erledigt abgeglichen). Im Dock blendet ⋯ „Mehr" → „Archiv einblenden" Archiviertes gedimmt ein; dort auswählen → Zurückholen. Die Suche findet Archiviertes weiterhin.</li>
                <li><b>Rahmen (Bereiche):</b> Über ＋ → „Rahmen (Bereich)" — ein benannter Rahmen <b>fängt</b> alle Karten ein, deren Mittelpunkt in ihm liegt (Zähler in der Titel-Leiste). An der <b>Titel-Leiste ziehen</b> verschiebt den Rahmen SAMT Inhalt, Doppelklick benennt um. Alle weiteren Aktionen bündelt der <b>„Rahmen"-Knopf in der Auswahl-Leiste</b> (Rahmen anklicken): Umbenennen, Tönung und <b>Inhalt anordnen</b> — Fluss/Raster/Kompakt sortiert NUR den Inhalt, der Rahmen wächst bei Bedarf mit. Beim <b>Board-Aufräumen</b> gilt der Rahmen samt Inhalt als EIN Modul und die innere Ordnung bleibt erhalten. Rahmen haben eigene Verbindungspunkte und lassen sich wie Karten <b>verbinden</b>; im Präsentationsmodus wird der Name zur Abschnitts-Folie.</li>
                <li><b>Board-Optionen:</b> Alles im Aufräumen-Menü des Docks (⋯ „Mehr" → „Aufräumen &amp; anordnen") — dort gibt die Farb-Reihe jedem Board eine eigene <b>Hintergrund-Tönung</b>, und <b>„Gitter &amp; Raster-Fang"</b> schaltet ein Linien-Gitter ein, an dem Karten beim Verschieben einrasten.</li>
                <li><b>Strg+K</b> durchsucht alles — auch Ticket-Personen, Eigenschaften und #Tags.</li>
                <li><b>Strg+Z / Strg+Y</b>: Struktur-Änderungen rückgängig/wiederholen. Aufräumen (Dock: ⋯ „Mehr" → „Aufräumen & anordnen") ordnet das Board automatisch an.</li>
                <li>Unter ⚙️ → Daten wartet die <b>Starter-Umgebung „Verwaltung"</b> — 14 Beispiel-Boards, die alles zeigen.</li>
              </ul>
            </section>

            {/* M210: Kurzer Überblick über die jüngsten Ausbaustufen — erreichbar
                über das Logo („Über PixiNotes" → Was ist neu). Bewusst knapp und
                in Alltagssprache: wer alle Einzelheiten will, liest die
                Fachabschnitte darunter. */}
            <section id="help-neu">
              <h3>🆕 Was ist neu</h3>
              <p>Die letzten Ausbaustufen in Kürze. Welche Fassung gerade läuft, steht im <b>Logo-Menü</b> oben links.</p>
              <ul>
                <li><b>🧠 Das Gehirn</b> — der größte Umbau: PixiNotes versteht deine Karten jetzt nach <b>Bedeutung</b>, nicht nur nach Wortlaut. Daraus folgen vier Dinge: Die Suche findet Verwandtes („Kita" findet „Betreuungszeiten"), das ↩-Panel zeigt <b>verwandte Karten</b> aus anderen Boards, das Netz <b>schlägt fehlende Verbindungen vor</b>, und du kannst <b>Fragen an deine eigene Wissensbasis</b> stellen (mit Quellenangabe, ohne Erfinden). Einschalten in ⚙️ → KI; alles kann komplett lokal laufen.</li>
                <li><b>🧠 Gehirn-Puls &amp; Auto-Struktur</b> — die Aufgaben-Zentrale zeigt, was das Gehirn im Wissensnetz sieht: Themen-Inseln über Board-Grenzen, Knotenpunkte, offene Vorschläge. Aus einer Themen-Insel heraus kannst du alle Karten <b>als Thema markieren</b> oder dir eine <b>Übersichts-Notiz</b> bauen lassen.</li>
                <li><b>🖼️ Die KI sieht Bilder</b> — Screenshots und Fotos gehen jetzt als echte Bild-Anhänge an die KI. Aus einem abfotografierten Zettel wird so direkt eine Einkaufsliste oder ein Kanban.</li>
                <li><b>🔤 Schrift &amp; Größe</b> — pro Karte und sogar für einzelne markierte Textstellen, inklusive der für Sehschwäche entworfenen Schrift „Sehr gut lesbar".</li>
                <li><b>📤 Karten einzeln teilen</b> — ein Dialog mit allen Wegen: Übernahme-Link, WhatsApp, E-Mail, Drucken, PDF, formatiertes Kopieren.</li>
                <li><b>🧹 Weniger Knöpfe</b> — Dock und Auswahl-Leiste zeigen nur noch das Häufigste, alles Weitere liegt im ⋯-Menü. Alle Bedienelemente sind jetzt auch am Finger sicher zu treffen.</li>
                <li><b>⚡ Netz-Ansicht flüssig</b> — das Ruckeln beim Ziehen ist weg, auch auf dem Handy.</li>
                <li><b>🗺 Die Gliederung als Landkarte:</b> Im <b>Netz</b> liegen deine Boards jetzt auf weichen, eingefärbten Flächen — eine je Bereich, feinere je Projekt. Bereiche und Projekte werden also <b>nicht</b> zu weiteren Punkten im Netz (drei Knotenarten würden nur um Aufmerksamkeit kämpfen), sondern zum Untergrund, auf dem alles liegt. Ein <b>abgeschaltetes Sub-Brain</b> erscheint dabei als graue, gestrichelte Region mit dem Zusatz „schläft" — ein Klick auf ihren Rand schaltet sie wieder ein. Über die Ebene <b>„Gliederung"</b> oben im Netz lässt sich das Gelände ausblenden.</li>
                <li><b>🔭 Der Zoom wechselt die Ebene:</b> Ziehst du das Netz weit heraus, treten die einzelnen Boards zurück und die <b>Bereiche</b> übernehmen — als Kontinente mit großer Beschriftung. Dazwischen liegen die <b>Projekte</b>, ganz nah wieder die Boards. Nichts springt dabei, die Ebenen blenden ineinander. Weit draußen fasst PixiNotes außerdem alle Verbindungen zwischen zwei Bereichen zu einem <b>Band</b> zusammen und schreibt die Anzahl daran — so siehst du auf einen Blick, wie eng Dienstliches und Privates tatsächlich verwoben sind, statt hundert Einzellinien zu zählen.</li>
                <li><b>🧠 Sub-Brains — Bereiche einzeln abschalten:</b> In ⚙️ → KI legst du fest, <b>welche Bereiche zum Gehirn gehören</b>. Wer „Privat" abschaltet, hält Privates aus dienstlichen KI-Antworten heraus: keine Bedeutungssuche, keine Vorschläge, kein Puls. Wichtig dabei — die bereits berechneten Vektoren werden <b>gelöscht</b>, nicht bloß ausgeblendet. Jederzeit umschaltbar, der Index baut sich beim Einschalten neu auf.</li>
                <li><b>🎫 Kanban-Tickets ziehen — jetzt auch mit dem Finger:</b> Zwischen Spalten UND innerhalb einer Spalte umsortieren. Am Handy kurz halten, dann ziehen (so bleibt das Scrollen der Spalte möglich); mit der Maus einfach losziehen. Eine Marke zeigt, wo das Ticket landet. WIP-Limits und Abhängigkeiten bremsen wie gewohnt.</li>
                <li><b>⌘ Befehle in der Suche:</b> Strg+K findet nicht nur, sondern <b>handelt</b> auch. Tippe „notiz", „kanban", „übersicht", „aufgaben", „netz", „einstellungen" — passende Befehle stehen über den Treffern und legen an oder wechseln die Ansicht.</li>
                <li><b>🛟 Kaputte Karte reißt nichts mehr mit:</b> Stolpert ein Modul über beschädigte Daten, erscheint an seiner Stelle eine Meldung statt einer weißen Seite. Der Rest des Boards arbeitet weiter, und die Daten bleiben unangetastet.</li>
                <li><b>📱 Karte im Fokus (Handy):</b> Ein Tipp auf eine Karte öffnet sie <b>formatfüllend</b> — mit Titel und ✕ oben, Blättern unten. Der Grund: Die Module sind kleine Anwendungen, und ein Stundenraster oder Kanban im Canvas auf Handy-Breite zu bedienen ist ein Kampf, den man nicht gewinnt. Im Fokus gibt es nur, was zu diesem Modul gehört; Verbinden, Anordnen und Archivieren bleiben Board-Sache. <b>Wischen</b> blättert zur Nachbarkarte, <b>nach unten wischen</b>, das <b>✕</b> oder die <b>Zurück-Taste</b> führen aufs Board. Abschaltbar unter ⚙️ → Design → Bedienung.</li>
                <li><b>📱 Ruhe am Handy, wenn die Tastatur kommt</b> — sobald du tippst, weicht alles, was gerade nicht hilft: Das Dock fährt weg, Zoom-Knöpfe und Fußzeile blenden aus, und die Eingabe-Blasen von Planer und Kalender docken als Blatt direkt über der Tastatur an, statt das Modul zu verdecken, in das du schreibst. Ist etwas ausgewählt, übernimmt die Auswahl-Leiste die Dock-Zeile — eine Leiste statt zweier gestapelter, und nie mehr zweireihig.</li>
              </ul>
            </section>

            <section id="help-ordnung">
              <h3>🗂️ Bereiche · Projekte · Boards</h3>
              <p>Drei Ebenen halten Ordnung: <b>Bereiche</b> (z. B. Arbeitsplatz, Wissen) bündeln <b>Projekte</b>, Projekte bündeln <b>Boards</b>.</p>
              <ul>
                <li>Die <b>Tab-Leiste</b> zeigt nur die Boards des aktiven Projekts; die <b>Brotkrume</b> „Bereich › Projekt" öffnet den <b>Navigator</b> — ein zentrales Fenster über alle Ebenen: Bereiche (Klick öffnet die große Übersicht), Projekte (Klick öffnet ihr erstes Board), Boards und per ▸ sogar die <b>Karten jedes Boards</b> — ein Klick springt direkt zur Karte.</li>
                <li><b>🏠</b> öffnet die große Übersicht: Bereiche als farbige Zonen, Boards als Kacheln — Kacheln lassen sich per Drag in andere Projekte verschieben.</li>
                <li>Der Umschalter <b>Hierarchie ⇄ Netz</b> zeigt alternativ den Verknüpfungs-Graphen (Portale, [[Wikilinks]]) — zoombar wie das Board.</li>
                <li><b>Portale</b> sind Karten, die auf ein anderes Board verlinken — für Sprungmarken zwischen Themen.</li>
              </ul>
            </section>

            <section id="help-karten">
              <h3>🃏 Karten-Typen</h3>
              <ul>
                <li><b>📝 Notiz:</b> voller Block-Editor („/" öffnet Checklisten, Tabellen, Überschriften). Farbwechsel über den Punkt oben rechts.</li>
                <li><b>Wochenplan / Planer (Raster):</b> Über ＋ → „Wochenplan (Stunden)" — ein universelles Raster aus Spalten × Zeilen. Spalten sind Wochentage (Mo–Fr/Mo–So) ODER <b>frei benennbar</b> (Personen, Räume, Maschinen — beliebig ergänzen/entfernen); Zeilen sind Uhrzeiten ODER <b>eigene Einheiten</b> (Schulstunden, Schichten …). Klick auf einen freien Slot legt einen Block an, Klick auf einen Block öffnet den Editor: Text, optionales <b>Label/Person als Badge</b>, Spalte, Von/Bis, Farbe, Löschen. Überlappende Blöcke stellen sich automatisch nebeneinander — so wird aus EINER Karte Stundenplan, Arbeitswoche, Dienstplan, Raum- oder Schichtplan.</li>
                <li><b>Zeiterfassung:</b> Über ＋ → „Zeiterfassung" — Arbeitszeit mit einem Klick: <b>Arbeit / Pause</b> starten, ein Klick auf die andere Art wechselt nahtlos (Arbeit → Pause → Arbeit), „Stop" beendet. Jede Zeile hat Bemerkung und ist <b>direkt editierbar</b> (native Zeitfelder) — so geht auch Nacherfassen und Korrigieren ohne Umwege; Besonderheiten wie Ortstermine oder Fahrten gehören in die Bemerkung. Tages-Navigation mit Summen je Art plus Tages-/Wochensumme ohne Pausen. <b>Ansichten:</b> Tag (Protokoll) / Woche (Tageszeilen mit Aufteilung) / Monat (Kalenderraster mit Tagessummen) / Jahr (Monatssummen) — Klick auf einen Tag oder Monat springt eine Ebene tiefer, die Erfassungs-Knöpfe bleiben überall verfügbar.</li>
                <li><b>📋 Kanban:</b> Spalten frei benennbar (＋/✕). <b>Klick auf ein Ticket öffnet das große Ticket-Fenster</b> (Trello-Stil): Beschreibung, Frist, Person, Priorität, <b>Checkliste mit Fortschrittsbalken</b>, <b>Abhängigkeiten</b> („erst Schritt 1, dann Schritt 2" — blockierte Tickets zeigen 🔒 und lassen sich erst weiterschieben, wenn alle Vorgänger erledigt sind; in die Erledigt-Spalte erst mit kompletter Checkliste) und <b>Verknüpfungen zu vorhandenen Karten/Modulen</b> aller Boards (🔗, mit Sprung). ⤓ sammelt offene Aufgaben aus allen Boards ein, ⟳ hält das automatisch aktuell — erledigte Quellen haken ihre Tickets selbst ab. Im Einsammel-Panel wählst du die Quell-Boards — und über ▸ an jedem Board sogar die <b>einzelnen Quellen-Karten</b> (bestimmte Checklisten-Notizen, Kanbans, Zeitpläne) einzeln ab, wenn nicht alles mitkommen soll.</li>
                <li><b>📅 Zeitplan (Gantt):</b> Zeit-Skala umschaltbar (Tage / Wochen mit KW-Raster / Monate / <b>Jahre</b>). Die <b>Jahres-Skala</b> ist für Mehrjahres-Vorhaben gedacht: Die Kopfzeile zeigt dann Jahreszahlen statt Monatskürzel, Quartals-Striche gliedern dazwischen, und auch kurze Vorgänge bleiben sichtbar und anklickbar. Der Zoom arbeitet dort in feinen Schritten, weil ein ganzer Pixel pro Tag in dieser Ansicht schon ein Riesensprung wäre. Balken ziehen/resizen, ◆ = Meilenstein (Balken auf Dauer 0), Pfeile = Abhängigkeiten mit Konflikt-Warnung und Ein-Klick-Auflösung, Personen, Zoom, „heute".</li>
                <li><b>📋 Protokoll-Reihe:</b> Für <b>wiederkehrende Besprechungen</b> — eine einzige Karte hält die ganze Serie, angezeigt wird immer nur eine Sitzung (◀ ▶ oder Datumsliste). Das löst das übliche Dilemma: weder eine meterlange Notiz noch hundert Einzelnotizen. <b>Der Kern ist die Wiedervorlage:</b> „＋ Neue Sitzung" übernimmt automatisch alle noch <b>offenen</b> Punkte der letzten Sitzung — mit Vermerk „(offen seit …)", der das Ursprungsdatum behält und sich beim erneuten Vertagen nicht stapelt. Erledigtes bleibt im alten Protokoll stehen, denn ein Protokoll wird nicht rückwirkend umgeschrieben. Im ⚙-Menü der Karte stellst du <b>Rhythmus</b> (wöchentlich bis vierteljährlich — schlägt das nächste Datum vor) und eine <b>feste Tagesordnung</b> ein, die jede neue Sitzung vorstrukturiert. Braucht eine einzelne Sitzung darüber hinaus einen Punkt, hängt ihn <b>„＋ TOP"</b> über dem Protokoll an — er gilt nur für diese Sitzung und taucht in späteren nicht auf. Die TOP-Chips über dem Text zeigen die Tagesordnung der laufenden Sitzung; sie folgen den Überschriften im Protokoll, lassen sich dort also frei umbenennen oder löschen. Die <b>Kartenfarbe</b> wählst du wie bei einer Notiz — Farbpunkt für die Palette, daneben der Wähler für einen beliebigen Ton. <b>Beschlüsse</b> werden getrennt von Aufgaben festgehalten; aufgeklappt zeigt „Beschlusslage der ganzen Reihe" alle Festlegungen über sämtliche Sitzungen hinweg. Offene Punkte der <b>neuesten</b> Sitzung landen automatisch in der Aufgaben-Zentrale (bewusst nur die neueste — sonst stünde ein vertagter Punkt dort so oft, wie er schon verschoben wurde) und lassen sich per Pfeil in ein Kanban einsammeln. Die Suche (Strg+K) und der Export finden <b>alle</b> Sitzungen, auch die gerade nicht sichtbaren.</li>
                <li><b>🗓️ Kalender:</b> Monat/Woche, Quellen wählbar (Aufgaben, Zeitpläne, Meilensteine), ICS-Import/-Abo/-Export (Outlook, Google, Apple), .ics-Dateien einfach draufziehen. <b>Eigene Termine:</b> Klick auf einen Tag öffnet den Tages-Editor — Titel (+ optionale Uhrzeit) eintragen, fertig; ★-Einträge erscheinen im Raster und wandern beim Export mit. <b>Klick auf einen Termin = bearbeiten:</b> Von-/Bis-Uhrzeit, Bis-Datum (mehrtägig = farbiger Streifen), Ort, Notiz und Farbe im Detail-Editor — der Tooltip des ★-Chips zeigt die Details. <b>Karten verknüpfen:</b> Im Editor eine Karte oder ein Board suchen und anheften (↗ springt hin); „📎 Karte als Termin" übernimmt den Kartentitel gleich mit. <b>Richtung Google/Outlook:</b> Jeder eigene Termin hat „→G" (öffnet Google Kalender mit vorausgefülltem Termin — ein Klick zum Speichern, ganz ohne Schreib-Zugriff auf dein Konto) und „.ics" für Outlook/Apple. <b>Richtung PixiNotes:</b> Über ⚙ → <b>Kalender</b> in den Einstellungen Google/Microsoft 365 verbinden (liest live) oder eine ICS-URL abonnieren. Einen automatischen Schreib-Sync in dein Konto gibt es bewusst nicht — dafür wären weitreichende Schreibrechte auf deinen kompletten Kalender nötig.</li>
                <li><b>📊 Diagramm (Mermaid):</b> liegt rahmenlos direkt auf der Fläche — alle Werkzeuge schweben als Leiste unterm Diagramm, sobald die Karte ausgewählt ist. 8 Vorlagen (Flow, Sequenz, Gantt, Mindmap, Kreis, Status, Zeitstrahl, Quadrant); Farbschema-Punkte, ✏️ Handschrift-Look und ⇄ Richtung liegen direkt in der Leiste — die Farbschemata färben alle Diagrammtypen (auch Kreis, Zeitstrahl, Quadrant, Gantt). ALLE Vorlagen bearbeitest du <b>direkt im Bild</b> — Flowchart: Schritte (Form ▭ ▢ ◇ ◯ ⬡ ⧉, Füllfarbe, „→ Verbinden") und Pfeile (beschriften, Linienstil ─ ┄ ━). Sequenz: Nachrichten (Text, Pfeilart, 🗒 Notiz), Personen, № Autonummerierung. Gantt: Balken (±1 Tag, ✓ erledigt / ▶ laufend / ⚠ kritisch), Abschnitte. Mindmap: Punkte (＋ Unterpunkt, Teilbaum entfernen). Kreis: Legende (Wert ±5). Status: Zustände umbenennen, „→ Übergang" ziehen, Übergänge beschriften. Zeitstrahl: Perioden und Ereignisse. Quadrant: Punkte verschieben (◀▶▲▼), Quadranten- und Achsen-Beschriftungen. Titel per „✎ Titel"; Doppelklick = überall direkt umbenennen. Beim Laden einer Vorlage oder eines KI-Diagramms passt sich die Karte einmalig der Diagrammgröße an; „⤢ Einpassen" in der Leiste macht das jederzeit auf Klick — ansonsten bleibt die Größe genau so, wie du sie ziehst. Die ✨-Zeile in der Leiste erzeugt oder ändert das Diagramm aus normaler Sprache; der Code bleibt für Profis hinter ‹/›.</li>
                <li><b>▢ Prozess-Formen:</b> Schritt, Entscheidung, Start/Ende — Doppelklick beschriftet, Toolbar unter der Form wechselt Form/Farbe.</li>
                <li><b>📓 OneNote &amp; Word übernehmen:</b> Über <b>⚙ → Daten</b> lassen sich OneNote-Notizbücher direkt aus Microsoft 365 holen: <b>Notizbuch → Bereich</b>, <b>Abschnitt → Board</b>, <b>Seite → Notiz-Karte</b>. Aufgabenkästchen (To-Do-Kategorie) werden zu echten <b>Checklisten</b> und tauchen damit in der Aufgaben-Zentrale und in verbundenen Kanbans auf; Tabellen, Listen und Bilder kommen mit. Gelesen wird nur — in OneNote ändert sich nichts. Da der Import ganze Bereiche anlegt (was Strg+Z nicht abdeckt), gibt es an derselben Stelle <b>„Letzten Import zurücknehmen“</b>. <b>Ohne Microsoft-Konto</b> geht es über Word: in OneNote „Datei → Exportieren → Word“, dann die <code>.docx</code> aufs Board ziehen — Überschriften, Listen (auch verschachtelt), Tabellen und eingebettete Bilder werden übernommen, ganz ohne Internet.</li>
                <li><b>📧 E-Mail/Datei/Bild/PDF:</b> per Drag aufs Board <b>oder über ＋ → „Datei einfügen"</b> (Datei-Dialog, auch mehrere auf einmal — der Weg fürs Smartphone). Termine und Telefonnummern werden automatisch erkannt und klickbar. <b>Team-Anlagen:</b> Gehört das Board zu einem Team-Projekt mit Sync-Ordner, legt PixiNotes von jeder eingefügten Datei automatisch eine Kopie im Ordner ab — sauber strukturiert unter <code>pixinotes-anlagen/&lt;Board&gt;/&lt;Kategorie&gt;/</code> (Bilder, PDFs, E-Mails, Apps, Dokumente …). Dateien, die zu groß fürs Einbetten ins Board sind, holen Teammitglieder per Klick („Aus Team-Ordner laden") direkt von dort; eigene Apps laden ihren Quelltext auf anderen Geräten automatisch nach.</li>
                <li><b>🔗 Verbindungen als Daten-Abos:</b> Ein Pfeil zwischen Karten transportiert Daten. <b>Notiz/Zeitplan/Kanban → Kanban:</b> Die offenen Punkte der verbundenen Karte werden automatisch als Tickets eingesammelt — auch ohne den ⟳-Schalter und unabhängig von der Board-Auswahl. Bei verbundenen Notizen zählen neben Checklisten auch <b>Aufzählungs- und nummerierte Listen</b> als Aufgaben. Abwählen geht jederzeit: im Einsammeln-Panel (⚙) den Haken der Quelle entfernen (Quellen mit Pfeil tragen dort ein „⇢ Abo"-Kennzeichen) oder einfach den Pfeil löschen. <b>Und zurück:</b> Wanderst du ein eingesammeltes Ticket in die Erledigt-Spalte, wird der Checklisten-Punkt in der Quell-Notiz automatisch abgehakt (Listen-Punkte werden dabei zum abgehakten Checklisten-Punkt, Zeitplan-Vorgänge springen auf 100 %, Quell-Tickets wandern in ihre Erledigt-Spalte); in Zwischenspalten bekommt der Punkt einen Vermerk wie „(→ In Arbeit)", der beim Zurückschieben wieder verschwindet. <b>Der Abgleich läuft in beide Richtungen:</b> Wird die Quelle wieder geöffnet (Punkt aufgehakt, Vorgang unter 100 %, Quell-Ticket zurückgeschoben), kommt auch das eingesammelte Ticket aus „Erledigt" zurück. Eingesammelte Tickets folgen ihrer Quelle außerdem bei Text, Frist, Person und Priorität — sie frieren nicht mehr auf dem Stand des Einsammelns ein. <b>Modul → Kalender:</b> Der Kalender springt auf den Bereich „Verbunden" und zeigt nur noch Termine, Fristen und Zeitplan-Balken der angeschlossenen Karten — der Bereich-Schalter in der Kopfzeile (Alle Boards / Dieses Board / Verbunden) stellt jederzeit um. <b>Kanban → Zeitplan:</b> Tickets mit Frist erscheinen im verbundenen Zeitplan als gestrichelte Abo-Meilensteine (nur Anzeige — die Frist wird am Ticket gepflegt). <b>Wochenplan → Zeiterfassung:</b> Die geplanten Blöcke sind das Soll — Tag- und Wochenansicht zeigen Soll und Differenz zur erfassten Zeit. <b>Zeiterfassung → Notiz/Kanban:</b> Die verbundene Karte trägt einen ⏱-Chip mit der Arbeitszeit von heute und dieser Woche. <b>Notiz → Diagramm:</b> Ein leeres bzw. Vorlagen-Diagramm folgt automatisch der Checkliste der verbundenen Notiz (Erledigtes grün); hat das Diagramm eigenen Inhalt, schaltet der „⇢ Abo"-Chip im Diagramm das Abo bewusst zu — der eigene Code bleibt dabei erhalten und kommt beim Pausieren zurück. <b>Eigene App → Notiz:</b> Die Notiz zeigt den Speicherstand der verbundenen App als lesbaren Auszug, live bei jedem Speichern.</li>
                <li><b>Nachschlagen:</b> Karte auswählen → ⋯-Menü → „Nachschlagen". <b>Wikipedia wird fein durchsucht</b> (echte Such-API, mehrere Treffer mit Beschreibung, Sprache DE/EN umschaltbar) — die Artikel-Links sind stabil. <b>Andere Quellen bewusst nur grob:</b> Links öffnen deren Suchseite mit deinem Begriff (DuckDuckGo, Google, Bing, OpenStreetMap, Wikipedia-Volltext) — geratene Tief-Links, die oft in 404 enden, gibt es absichtlich nicht. Der Begriff kommt aus der ersten Zeile der Karte und ist im Panel änderbar.</li>
                <li><b>Verschieben & Umbenennen:</b> Jede Karte lässt sich am schwebenden <b>Griff</b> über der Oberkante ziehen — und zusätzlich an ihrer <b>Titelzeile</b> (bzw. bei Notizen/Bildern an der freien Fläche). <b>Doppelklick auf den Titel benennt um</b> — dieselbe Regel wie bei Rahmen, Formen und Diagrammen. <b>In ein anderes Board:</b> Karte(n) auswählen → in der Auswahl-Leiste das Ordner-Symbol mit Pfeil → Ziel-Board wählen. Verbindungen zwischen den verschobenen Karten, Kommentar-Pins und geankerte Markierungen wandern mit; Rahmen nehmen ihren kompletten Inhalt mit — einfach den Rahmen anklicken und über die Auswahl-Leiste verschieben; auch gemischte Auswahl aus Karten und Rahmen wandert komplett. Strg+Z macht den ganzen Umzug rückgängig.</li>
                <li><b>Eigene App (HTML):</b> Eine HTML-Datei (z. B. ein selbst gebautes Ein-Datei-Tool) aufs Board ziehen oder über ＋ → „Eigene App" wählen — sie läuft als <b>eigene, abgeschottete Instanz</b> direkt in der Karte, mit vollem JavaScript. Gestartet wird bewusst erst per ▶ (so bremsen zehn Apps auf dem Board weder Start noch Akku), Stop hält an, ⟳ startet frisch. Der Vollbild-Knopf nutzt echtes Browser-Vollbild — <b>die App läuft dabei ununterbrochen weiter</b> (Esc führt zurück). Speichert die App etwas (localStorage), landet das in einer eigenen Schublade pro Karte — sie kann PixiNotes-Daten weder lesen noch löschen. Zum Bedienen die Karte zuerst anklicken (vorher gehören Klicks dem Board); ziehen an der Kopfleiste. Die HTML-Datei selbst bleibt auf diesem Gerät (IndexedDB) und wandert nicht in Sync-Dateien oder Team-Pakete — auf einem anderen Gerät bietet die Karte an, die Datei erneut zu laden (bzw. holt sie automatisch aus dem Team-Ordner, siehe Team-Anlagen). Über ＋ → „App von URL" holst du ein Tool direkt von einer Internet-Adresse: Erlaubt die Quelle das Kopieren (z. B. GitHub, Gists, CDNs), wird daraus eine ganz normale lokale App-Karte (läuft offline, „Von der Quelle neu laden" im ⋮-Menü) — sonst wird die Seite <b>live eingebettet</b> (immer aktuell, braucht Internet; sie läuft unter ihrer eigenen Herkunft und kommt nicht an PixiNotes-Daten). Das ⋮-Menü der Karte bietet außerdem: <b>Im eigenen Browser-Tab öffnen</b> (volle Fläche, gleiche Abschottung — Gespeichertes fließt in die Karte zurück, solange PixiNotes offen ist), <b>HTML-Datei herunterladen</b> und <b>Speicherstand im Team-Ordner sichern</b>. Gehört das Board zu einem Team-Projekt, wird der Speicherstand der App (das, was sie selbst speichert) ohnehin automatisch als kleine Datei unter <code>pixinotes-anlagen/…/Apps/</code> abgelegt — beim Start gewinnt der neuere Stand (Team oder lokal), so wandert der App-Fortschritt zwischen deinen Geräten und ins Team.</li>
              </ul>
            </section>

            <section id="help-verbinden">
              <h3>🔗 Verbinden & Präsentieren</h3>
              <ul>
                <li>Karte anklicken/antippen — dann erscheinen die <b>＋-Verbindungspunkte</b> an den Rändern. Von dort ziehen und auf einer beliebigen Stelle der Zielkarte loslassen; während des Ziehens leuchten die Anschlüsse aller Karten als Ziele auf, die Verbindung dockt automatisch an der besten Seite an.</li>
                <li>Klick auf die Linie: <b>Label</b> vergeben (z. B. „blockiert") oder Pfeilart wechseln. Entf löscht (Strg+Z holt zurück).</li>
                <li><b>Aufräumen</b> (im Dock: ⋯ „Mehr" → „Aufräumen &amp; anordnen") ordnet das Board — mit Morph-Animation, ein Strg+Z stellt alles wieder her; doppelte Verbindungen werden dabei automatisch zusammengefasst. Modi: <b>Fluss</b> (horizontal oder vertikal), <b>Metro-Grid</b> (festes Raster + rechtwinklige Verbindungen), <b>Raster</b>, <b>Kompakt packen</b> (minimale Fläche, ideal vor dem Export), <b>Schwimmbahnen</b> (eine Bahn pro Person — aus der Eigenschaft {'„wer"'} oder den Personen in Tickets/Zeitplänen), <b>Zeitstrahl</b> (Fristen chronologisch), <b>Quadrant</b> (sortiert die Karten in VIER benannte Rahmen — Titel per Doppelklick frei umbenennbar, beim nächsten Quadrant-Aufräumen werden sie wiederverwendet), Kreis-Bündel und Stapeln.</li>
                <li><b>▶ Präsentation:</b> jede Karte wird zur Folie, <b>live editierbar</b>. Die Reihenfolge folgt den Verbindungen; ▶ auf Kacheln/Portalen startet direkt beim jeweiligen Board.</li>
              </ul>
            </section>

            <section id="help-zeichnen">
              <h3>✏️ Zeichnen</h3>
              <ul>
                <li>✎ im Dock: <b>Stift</b>, <b>Neon-Textmarker</b>, <b>Radierer</b> — Esc zurück zur Auswahl.</li>
                <li><b>Formerkennung:</b> nach dem Zeichnen kurz gedrückt halten — wackelige Linien werden gerade, Kreise rund, Rechtecke eckig.</li>
                <li><b>Markierungen kleben an Karten:</b> Ein Strich, der eine Karte überlappt — schon eine kleine Überlappung genügt —, wird beim Absetzen an sie geankert (die Karte blitzt kurz auf) und wandert beim Verschieben, Aufräumen und Archivieren mit; beim Löschen der Karte verschwindet er mit (Strg+Z holt beides zurück). Bei mehreren Karten gewinnt die größte Schnittmenge; sich berührende Striche (z. B. ein Pfeil aus mehreren Zügen) entscheiden gemeinsam, damit nichts zerrissen wird. Nur wer gar keine Karte berührt, bleibt frei. Lösen: Karte auswählen → ⋯-Menü → „Markierungen lösen".</li>
                <li>Striche werden automatisch geglättet; Radieren wirkt pro Geste als ein Undo-Schritt.</li>
              </ul>
            </section>

            <section id="help-aufgaben">
              <h3>✅ Aufgaben & Erinnerungen</h3>
              <ul>
                <li>Aufgaben entstehen überall: Kanban-Tickets, ☐-Checklisten in Notizen und <b>Zeitplan-Vorgänge</b> (alles unter 100 % zählt als offen, Frist = Balken-Ende).</li>
                <li>Die <b>✅-Zentrale</b> im Dock sammelt alles boardübergreifend, <b>gruppiert nach Frist</b> (Überfällig · Heute · Diese Woche · Später · Ohne Frist, Abschnitte einklappbar): Abhaken (Gantt = Fortschritt 100 %), Fälligkeit ändern, <b>+1T/+1W schlummern</b>, Schnell-Eingabe, Kalender-Export (.ics).</li>
                <li><b>Wer macht was:</b> Personen aus Tickets und Zeitplan-Ressourcen lassen sich filtern oder per 👥 als Gruppierung anzeigen.</li>
                <li><b>Schnell-Eingabe versteht Kurzzeichen:</b> „Bericht ans RP <b>bis Freitag @Anna #haushalt !!</b>" setzt Frist, Person und Priorität automatisch (! niedrig · !! mittel · !!! hoch); das Ziel-Board ist wählbar. <b>Prioritäten</b> sortieren vor und lassen sich per Klick auf das !-Zeichen an der Zeile durchschalten.</li>
                <li><b>Suchen & Filtern:</b> Freitext-Suche und #Tag-Chips direkt in der Zentrale; Kanban-Tickets zeigen ihre Priorität auch auf dem Board.</li>
                <li><b>Spalte direkt umstellen:</b> „To Do → In Arbeit" gleich aus der Liste — die letzte Spalte erledigt das Ticket.</li>
                <li><b>Heute geschafft:</b> unten sammelt ein Protokoll alles, was du in der Zentrale abhakst — mit Wochen-Balken der letzten 7 Tage.</li>
                <li><b>☀ Mein Tag:</b> Aufgaben per ☀ handverlesen für heute vornehmen — der Filter „Mein Tag" zeigt nur diese Fokusliste (leert sich am nächsten Tag von selbst).</li>
                <li><b>Aufgeräumte Zeilen:</b> Jede Aufgabe zeigt kompakt nur Titel, Priorität, Frist und Person — <b>Antippen klappt die Werkzeuge auf</b> (Spalte, Frist, +1T/+1W, ☀ Mein Tag, ↗ Karte, › Details).</li>
                <li><b>› Details:</b> öffnet die Bearbeiten-Spalte rechts — Titel, Beschreibung, Person, Frist, Priorität (Tickets) bzw. Start/Ende/Fortschritt (Zeitplan) direkt ändern, ohne die Zentrale zu verlassen.</li>
                <li><b>✨ Woche planen:</b> die KI fasst alle offenen Aufgaben zu einem Wochen-Briefing zusammen (Was zuerst? Welche Fristen? Wo nachhaken?) und legt es als Notiz aufs aktive Board.</li>
                <li><b>Erinnerungen:</b> Fällige Aufgaben melden sich beim Öffnen und regelmäßig als Hinweis — optional als System-Benachrichtigung.</li>
                <li>Fälligkeiten am Ticket (📅) steuern alles; „bis Freitag"/Datum im Text zählt auch bei Checklisten-Punkten als Frist.</li>
              </ul>
            </section>

            <section id="help-wissen">
              <h3>💡 Wissen & Verknüpfen</h3>
              <ul>
                <li><b>[[Wikilinks]]</b> im Notiztext verlinken Boards oder Karten — Chips unten an der Notiz springen hin; unbekannte Namen legen per Klick ein neues Board an.</li>
                <li><b>#Tags</b> einfach in den Text schreiben; Strg+K und „#" listet alle Themen.</li>
                <li><b>↩ Backlinks:</b> das Panel unten rechts zeigt, wer auf das aktuelle Board verweist.</li>
                <li><b>🧠 Gehirn-Puls:</b> In der <b>Aufgaben-Zentrale</b> (✅ im Dock) zeigt ein aufklappbarer Abschnitt, was das Gehirn gerade im Wissensnetz sieht: <b>Themen-Inseln</b> (Karten, die inhaltlich zusammengehören — auch über Board-Grenzen hinweg), <b>Knotenpunkte</b> (Boards, an denen besonders viel hängt) und offene <b>Verknüpfungs-Vorschläge</b>. Eine Zeile anklicken springt zum Board. Läuft rein rechnerisch aus dem Index — keine KI-Anfrage, keine Kosten.</li>
                <li><b>🧠 Auto-Struktur (aus einer Themen-Insel heraus):</b> Jede Themen-Zeile im Gehirn-Puls bietet zwei Knöpfe an. <b>🏷 Als Thema markieren</b> schreibt allen Karten der Insel die Eigenschaft <code>thema = &lt;Schlagwort&gt;</code> — danach findet die Suche (Strg+K) sie als Gruppe, und die <b>Schwimmbahnen</b> beim Anordnen können danach sortieren. <b>📝 Übersichts-Notiz anlegen</b> baut auf dem aktuellen Board eine Zusammenfassungs-Karte: Überschrift, ein Abschnitt je beteiligtem Board mit <b>[[Wikilink]]</b> und eine <b>Checkliste</b> aller Karten des Themas — eine ganz normale Notiz, die du beliebig weiterschreiben kannst. Beides ist ein einziger Schritt und mit <b>Strg+Z</b> komplett rückgängig, auch über mehrere Boards hinweg.</li>
                <li><b>🧠 Frag dein Gehirn:</b> Mit eingeschaltetem Gehirn UND konfigurierter KI erscheint in der Suche (Strg+K) ein Knopf „Frag dein Gehirn" (oder <b>Strg+Enter</b>). Dann wird die Frage <b>aus deinen eigenen Karten</b> beantwortet: Das Gehirn sucht die passenden Karten heraus, die KI formuliert daraus die Antwort — mit nummerierten <b>Quellen-Chips</b>, die per Klick zur Karte springen. Steht die Antwort nirgends, sagt das Tool das ehrlich, statt etwas zu erfinden; ohne Treffer wird die KI gar nicht erst gefragt.</li>
                <li><b>🧠 Vorschläge (Synapsen):</b> Ist das Gehirn an, schlägt das <b>Netz</b> Verbindungen vor, die noch fehlen: gestrichelte, sanft pulsierende Linien zwischen Boards, die sich inhaltlich sehr nahe sind, aber weder Portal noch Wikilink teilen. Ein Klick auf die Linie zeigt die Nähe in Prozent und bietet <b>„Verknüpfen"</b> (legt ein echtes Portal an — Strg+Z macht es rückgängig) oder <b>„Passt nicht"</b> (dieses Paar wird nie wieder vorgeschlagen). Die Ebene lässt sich oben im Netz abschalten.</li>
                <li><b>🧠 Gehirn (semantischer Index):</b> In ⚙️ → KI einschalten — dann übersetzt PixiNotes jede Karte in einen Bedeutungs-Vektor (Embedding). Die Suche (Strg+K) findet ab dann auch <b>nach Bedeutung</b> („Kita" findet „Betreuungszeiten"), und das ↩-Panel zeigt zusätzlich <b>verwandte Karten</b> aus anderen Boards, die noch niemand verlinkt hat. Drei Wege: <b>Ollama</b> (alles bleibt lokal, Modell: <code>ollama pull nomic-embed-text</code>), <b>„Im Browser"</b> (lädt einmalig ein ~30-MB-Modell, danach offline — der Weg für iPhone/iPad) oder <b>Cloud</b> (OpenAI/OpenRouter-Schlüssel). Der Index bleibt lokal in diesem Browser und ist nie Teil von Sync, Export oder Teilen-Links.</li>
                <li><b>🏷 Eigenschaften:</b> Karte auswählen → 🏷 → schlüssel = wert (z. B. status = wartet) — durchsuchbar und im Export enthalten.</li>
                <li><b>🔖 Vorlagen:</b> jede Karte als Vorlage sichern, einfügen über ➕ → Vorlagen.</li>
              </ul>
            </section>

            <section id="help-ki">
              <h3>✨ KI-Assistent</h3>
              <ul>
                <li><b>Anbieter</b> unter ⚙️ → KI: „Gratis" (ohne Konto, langsam), OpenRouter (kostenloser Account, flott), eigene Schlüssel (Anthropic/OpenAI) oder <b>Ollama — dann bleibt alles auf deinem Rechner</b>. Schlüssel werden nur lokal gespeichert und gehen nie in Sync/Export/Teilen-Links.</li>
                <li><b>✨ KI-Assistent</b> (Dock: ⋯ „Mehr" → „KI-Assistent", ganzes Board): Freitext-Anweisung („Erstelle einen Wochenplan …"), Themen clustern, Aufgaben extrahieren, Workflow-Diagramm, Briefing, Verbindungen vorschlagen.</li>
                <li><b>✨ in der Auswahl-Leiste</b> (⋯-Menü → „KI-Aktionen", markierte Karten): dieselben Werkzeuge nur für die Auswahl, plus <b>Text verbessern</b> für Notizen — der Vorschlag erscheint daneben, das Original bleibt. <b>Abgeleitete Module werden automatisch verknüpft:</b> Entsteht aus wenigen ausgewählten Karten ein Diagramm, Kanban oder Briefing, zieht das Board Pfeile von den Quell-Karten zum neuen Modul (auch E-Mail → Zusammenfassung/Anhang, Notiz → Vorschlag, und die KI setzt beim Freitext-Kommando Bezüge selbst).</li>
                <li><b>Die KI sieht Bilder:</b> Bild-Karten (Screenshots, fotografierte Zettel und Tafeln) werden bei Freitext-Kommando, Aufgaben-Extraktion, Workflow und Briefing als <b>Foto mitgeschickt</b> — „extrahiere die Einkaufsliste aus dem Screenshot" funktioniert also direkt. Voraussetzung ist ein Modell mit Bildverständnis (Anthropic, OpenAI, OpenRouter oder ein multimodales Ollama-Modell wie llava); die Gratis-KI kann keine Bilder und arbeitet dann nur mit dem Text. Bilder werden vor dem Versand automatisch verkleinert; es gehen maximal 4 Bilder pro Anfrage mit.</li>
                <li>Alle KI-Aktionen sind <b>nicht destruktiv</b> und ein einziges Strg+Z macht den kompletten Plan rückgängig.</li>
              </ul>
            </section>

            <section id="help-daten">
              <h3>💾 Speichern, Sync & Teilen</h3>
              <ul>
                <li>Alles speichert <b>automatisch lokal</b> im Browser. Zusätzlich: ⚙️ → Daten → „Datei exportieren" für Backups (USB-Stick, Mail, Netzlaufwerk).</li>
                <li><b>Seitenleiste (Überblick neben der Arbeit):</b> Der Knopf neben der Suche in der Kopfleiste fährt rechts eine Leiste aus — wahlweise als <b>Hierarchie-Baum</b> (Bereich › Projekt › Board, aufklappbar bis zur einzelnen Karte, mit Suchfeld) oder als <b>Netz</b>. Klick springt direkt hin, die Leiste bleibt dabei offen. Breite am linken Rand ziehbar; offen/zu, Ansicht und Breite bleiben gespeichert.</li>
                <li><b>Netz lebt (Physik):</b> Das Netz schwingt sich wie in Obsidian von selbst ein — Boards stoßen sich ab, Verbindungen ziehen zusammen, und <b>Boards desselben Projekts clustern</b> sich zu Themen-Inseln. Knoten lassen sich <b>anfassen und werfen</b>, die Nachbarn reagieren. <b>Rechtsklick</b> (am Tablet: langes Drücken) auf einen Knoten öffnet ein Menü: Board öffnen · <b>Verknüpfen mit …</b> (legt ein echtes Portal an, Strg+Z macht es rückgängig) · Hierher zoomen · Netz neu ausschwingen. Wer Ruhe will: Ebenen-Schalter „Physik" aus — die Wahl bleibt gespeichert.</li>
                <li><b>Netz-Ansicht (Gesamtüberblick):</b> Über den <b>Navigator</b> in der Kopfleiste → „Netz" aus <b>jeder Ansicht</b> erreichbar. Boards sind Kreise (Größe = Kartenzahl), Linien sind Portale und [[Wikilinks]]. Das Board, in dem du gerade bist, trägt einen <b>Ring</b> — und die Ansicht startet dort, statt dich in der Ecke abzusetzen. Die Ebenen <b>Karten · Portale · Wikilinks</b> bleiben eingeschaltet, bis du sie wieder abschaltest (auch nach dem Neustart). <b>Suchfeld:</b> hebt Boards und Karten hervor, statt den Rest wegzuwerfen — so siehst du, <i>wo</i> ein Thema überall auftaucht. <b>„Nur dieses Projekt"</b> reduziert das Netz auf die Umgebung, in der du arbeitest.</li>
                <li><b>Sync-Ordner:</b> einen von Nextcloud/OneDrive/Dropbox synchronisierten Ordner verbinden — PixiNotes schreibt dort automatisch. Liegt beim Start (oder bei Fenster-Rückkehr) ein neuerer Stand im Ordner und du hast lokal nichts geändert, wird er <b>automatisch übernommen</b>; bei echten Konflikten fragt PixiNotes statt zu überschreiben.</li>
                <li><b>Sync-Status oben:</b> Das Wolken-Symbol in der Aktionsleiste zeigt live, ob gespeichert wurde (Häkchen-Wolke, Uhrzeit per Hover), gerade gespeichert wird (pulsierend) oder etwas hakt (amber). Eine <b>durchgestrichene Wolke</b> heißt: Der Browser hat die Ordner-Freigabe nach einem Neustart zurückgesetzt — ein Klick darauf genügt, und der Auto-Sync läuft weiter.</li>
                <li><b>Team-Sync (Projekte teilen):</b> Jedes <b>Projekt</b> lässt sich zusätzlich in einen <b>eigenen</b> Sync-Ordner spiegeln (⚙ → Synchronisation → „Team-Sync") — so arbeitest du mit mehreren Teams in einer Umgebung, ohne alles preiszugeben. Ablauf: Ordner im Cloud-Speicher fürs Team freigeben, Projekt verbinden, Kollegen mit „Einladen…" die Anleitung mailen — sie treten über „Projekt beitreten…" bei. Wer mitmachen darf, regelt <b>allein die Ordner-Freigabe</b>; Einladungen enthalten keine Passwörter, KI-Schlüssel und Zugangsdaten landen nie im Projekt-Paket.</li>
                <li><b>Kommentare:</b> Karte auswählen → ⋯-Menü → „Kommentar" — Kommentar-Pins hängen an der Karte, zeigen die Initialen des Verfassers und wandern im Sync/Team-Projekt mit. Antworten, „Erledigt" und Löschen direkt im Panel; dein Anzeigename wird nur lokal gespeichert.</li>
                <li><b>WebDAV direkt:</b> ohne Desktop-Client (auch am Handy) — Ordner-URL + App-Passwort in ⚙ → Synchronisation. Zugangsdaten bleiben lokal. <b>Wichtig bei Nextcloud:</b> Browser-Zugriffe sind serverseitig erst nach CORS-Freigabe möglich — z. B. über die Nextcloud-App „WebAppPassword" (dort die PixiNotes-Adresse als erlaubte Origin eintragen) oder durch die IT. In ⚙ → Synchronisation liegt dafür ein <b>fertiger Text zum Kopieren</b> (nennt Herkunft und benötigte Header, enthält keine Zugangsdaten). Das betrifft <b>jeden Browser gleich</b> — es ist keine iPad-Eigenheit.</li>
                <li><b>iPad &amp; iPhone — Sync über die Dateien-App:</b> Auf iOS/iPadOS darf keine Webseite auf Ordner zugreifen (Apple erlaubt es in keinem Browser). Deshalb gibt es dort in ⚙ → Synchronisation <b>„Stand sichern → Dateien-App"</b> und <b>„Stand laden…"</b>. Gesichert wird <b>exakt dieselbe <code>pixinotes-daten.json</code></b> wie beim Sync-Ordner: legst du sie in den Nextcloud-Ordner, den dein Rechner spiegelt, übernimmt der Rechner den Stand automatisch — und umgekehrt. Das <b>Wolken-Symbol</b> oben wird dabei zum Sicherungs-Knopf: Sobald es ungesicherte Änderungen gibt, zeigt es einen Pfeil nach oben, ein Tipp öffnet direkt das Teilen-Blatt. <b>Tipp:</b> PixiNotes über „Teilen → Zum Home-Bildschirm" installieren — sonst löscht Safari die Daten von Webseiten, die 7 Tage nicht benutzt wurden.</li>
                <li><b>Mehrere Fenster:</b> Läuft PixiNotes doppelt (z. B. installierte App + vergessener Browser-Tab), speichert nur <b>ein</b> Fenster — die anderen lesen live mit und zeigen ein Banner mit „Hier weiterarbeiten". So kann kein altes Fenster deine Änderungen überschreiben.</li>
                <li><b>Teilen:</b> Der ⧉-Button in der Kopfleiste kopiert einen Link, der das <b>komplette Board enthält</b> — serverlos. Große Boards werden als .pixiboard.json-Datei exportiert; Empfänger zieht sie einfach aufs Board.</li>
                <li><b>PWA:</b> Über „App installieren" im Browser wird PixiNotes zur eigenständigen App — läuft komplett offline.</li>
                <li><b>Export:</b> Markdown-Ordner (Obsidian-lesbar), Bild-Export des Boards (PNG/SVG/PDF-Druck) — automatisch auf den Inhalt zugeschnitten, mit wählbarer Auflösung (1–3×), Hintergrund (Beige/Weiß/Transparent), Kopfzeile (Board + Datum) und optional nur der Auswahl. Dazu .ics für Kalender.</li>
                <li><b>Frischer Start:</b> ⚙️ → Daten → „Alles leeren" (mit doppelter Bestätigung).</li>
              </ul>
            </section>

            <section id="help-tasten">
              <h3>⌨️ Tastenkürzel</h3>
              <table className="help-keys">
                <tbody>
                  <tr><td><kbd>Strg</kbd>+<kbd>K</kbd></td><td>Suche über alles</td></tr>
                  <tr><td><kbd>Strg</kbd>+<kbd>Z</kbd> / <kbd>Strg</kbd>+<kbd>Y</kbd></td><td>Rückgängig / Wiederholen</td></tr>
                  <tr><td><kbd>N</kbd></td><td>Neue Notiz (auf dem Board)</td></tr>
                  <tr><td><kbd>Strg</kbd>+<kbd>V</kbd></td><td>Screenshot/Bild einfügen</td></tr>
                  <tr><td><kbd>F</kbd></td><td>Auswahl einpassen (ohne Auswahl: alles)</td></tr>
                  <tr><td><kbd>Leertaste</kbd> halten + ziehen</td><td>Ansicht verschieben (auch über Karten)</td></tr>
                  <tr><td><kbd>Esc</kbd> nach Klick-Zoom</td><td>zurück zur vorherigen Position</td></tr>
                  <tr><td><kbd>Entf</kbd></td><td>Auswahl/Verbindung löschen</td></tr>
                  <tr><td><kbd>Esc</kbd></td><td>Menüs/Overlays schließen · Zeichenmodus beenden</td></tr>
                  <tr><td><kbd>←</kbd> <kbd>→</kbd> / <kbd>Leertaste</kbd></td><td>Präsentation blättern</td></tr>
                  <tr><td><kbd>/</kbd></td><td>Block-Menü im Notiz-Editor</td></tr>
                </tbody>
              </table>
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

            <div className="help-foot">PixiNotes — lokal, offen, deins. Feedback jederzeit willkommen. 📌</div>
          </div>
        </div>
      </div>
    </div>
  );
}
