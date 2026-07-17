import { useEffect, useRef, useState } from 'react';
import { useBoard } from '../store';
import { MailLink } from './MailLink';

/**
 * Die Hilfe-Seite (❓ im Dock): erklärt jede Funktion in Alltagssprache,
 * gegliedert mit Anker-Navigation. Vollständig offline — keine externen Links nötig.
 */
const SECTIONS = [
  { id: 'start', icon: '🚀', title: 'Erste Schritte' },
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
                <li><b>Klick-Zoom:</b> Anklicken fliegt sanft zur Karte, wenn sie klein/angeschnitten ist (⚙ → Design → Bedienung abschaltbar); <b>Esc</b> fliegt zurück. Dort auch „Mausrad zoomt" im Miro-Stil. Klick auf die <b>Minimap</b> springt an die Stelle, <b>F</b> passt die Auswahl ein.</li>
                <li><b>Strg+V</b> fügt Screenshots &amp; Bilder aus der Zwischenablage ein; E-Mails (.eml/.msg), Bilder, PDFs und Dateien einfach aufs Board ziehen.</li>
                <li>Überlappende Karten: Die <b>zuletzt angefasste Karte legt sich automatisch nach vorn</b> und bleibt dort — bis eine andere angeklickt wird (praktisch mit 🧲 Physik AUS).</li>
                <li><b>Strg+K</b> durchsucht alles — auch Ticket-Personen, Eigenschaften und #Tags.</li>
                <li><b>Strg+Z / Strg+Y</b>: Struktur-Änderungen rückgängig/wiederholen. Der 🧹-Button räumt das Board automatisch auf.</li>
                <li>Unter ⚙️ → Daten wartet die <b>Starter-Umgebung „Verwaltung"</b> — 14 Beispiel-Boards, die alles zeigen.</li>
              </ul>
            </section>

            <section id="help-ordnung">
              <h3>🗂️ Bereiche · Projekte · Boards</h3>
              <p>Drei Ebenen halten Ordnung: <b>Bereiche</b> (z. B. Arbeitsplatz, Wissen) bündeln <b>Projekte</b>, Projekte bündeln <b>Boards</b>.</p>
              <ul>
                <li>Die <b>Tab-Leiste</b> zeigt nur die Boards des aktiven Projekts; die <b>Brotkrume</b> „Bereich › Projekt" öffnet den Navigator über alles.</li>
                <li><b>🏠</b> öffnet die große Übersicht: Bereiche als farbige Zonen, Boards als Kacheln — Kacheln lassen sich per Drag in andere Projekte verschieben.</li>
                <li>Der Umschalter <b>Hierarchie ⇄ Netz</b> zeigt alternativ den Verknüpfungs-Graphen (Portale, [[Wikilinks]]) — zoombar wie das Board.</li>
                <li><b>Portale</b> sind Karten, die auf ein anderes Board verlinken — für Sprungmarken zwischen Themen.</li>
              </ul>
            </section>

            <section id="help-karten">
              <h3>🃏 Karten-Typen</h3>
              <ul>
                <li><b>📝 Notiz:</b> voller Block-Editor („/" öffnet Checklisten, Tabellen, Überschriften). Farbwechsel über den Punkt oben rechts.</li>
                <li><b>📋 Kanban:</b> Spalten frei benennbar (＋/✕). <b>Klick auf ein Ticket</b> öffnet Details: Beschreibung, Fälligkeit, Person, Board-Verknüpfung. ⤓ sammelt offene Aufgaben aus allen Boards ein, ⟳ hält das automatisch aktuell — erledigte Quellen haken ihre Tickets selbst ab.</li>
                <li><b>📅 Zeitplan (Gantt):</b> Balken ziehen/resizen, ◆ = Meilenstein (Balken auf Dauer 0), Pfeile = Abhängigkeiten mit Konflikt-Warnung und Ein-Klick-Auflösung, Personen, Zoom, „heute".</li>
                <li><b>🗓️ Kalender:</b> Monat/Woche, Quellen wählbar (Aufgaben, Zeitpläne, Meilensteine), ICS-Import/-Abo/-Export (Outlook, Google, Apple), .ics-Dateien einfach draufziehen. Über ⚙ → <b>Kalender</b> in den Einstellungen lassen sich Google Kalender und Microsoft 365 direkt verbinden (nur lesend, Zugangsdaten bleiben lokal).</li>
                <li><b>📊 Mermaid:</b> Diagramme aus Text (Flowchart, Mindmap, Sequenz …).</li>
                <li><b>▢ Prozess-Formen:</b> Schritt, Entscheidung, Start/Ende — Doppelklick beschriftet, Toolbar unter der Form wechselt Form/Farbe.</li>
                <li><b>📧 E-Mail/Datei/Bild/PDF:</b> per Drag aufs Board; Termine und Telefonnummern werden automatisch erkannt und klickbar.</li>
              </ul>
            </section>

            <section id="help-verbinden">
              <h3>🔗 Verbinden & Präsentieren</h3>
              <ul>
                <li>Vom <b>Rand einer Karte</b> ziehen und auf einer beliebigen Stelle der Zielkarte loslassen — die Verbindung dockt automatisch an der besten Seite an.</li>
                <li>Klick auf die Linie: <b>Label</b> vergeben (z. B. „blockiert") oder Pfeilart wechseln. Entf löscht (Strg+Z holt zurück).</li>
                <li><b>🧹 Aufräumen</b> ordnet das Board: Verbundenes wird als Fluss von links nach rechts gelegt, der Rest nach Modultyp gruppiert — mit Morph-Animation, ein Strg+Z stellt alles wieder her.</li>
                <li><b>▶ Präsentation:</b> jede Karte wird zur Folie, <b>live editierbar</b>. Die Reihenfolge folgt den Verbindungen; ▶ auf Kacheln/Portalen startet direkt beim jeweiligen Board.</li>
              </ul>
            </section>

            <section id="help-zeichnen">
              <h3>✏️ Zeichnen</h3>
              <ul>
                <li>✎ im Dock: <b>Stift</b>, <b>Neon-Textmarker</b>, <b>Radierer</b> — Esc zurück zur Auswahl.</li>
                <li><b>Formerkennung:</b> nach dem Zeichnen kurz gedrückt halten — wackelige Linien werden gerade, Kreise rund, Rechtecke eckig.</li>
                <li>Striche werden automatisch geglättet; Radieren wirkt pro Geste als ein Undo-Schritt.</li>
              </ul>
            </section>

            <section id="help-aufgaben">
              <h3>✅ Aufgaben & Erinnerungen</h3>
              <ul>
                <li>Aufgaben entstehen überall: Kanban-Tickets, ☐-Checklisten in Notizen, Zeitplan-Vorgänge.</li>
                <li>Die <b>✅-Zentrale</b> im Dock sammelt alles boardübergreifend: Filter (Heute/Überfällig/Board), Abhaken, Fälligkeit ändern, Schnell-Eingabe, Kalender-Export (.ics).</li>
                <li><b>Erinnerungen:</b> Fällige Aufgaben melden sich beim Öffnen und regelmäßig als Hinweis — optional als System-Benachrichtigung.</li>
                <li>Fälligkeiten am Ticket (📅) steuern alles; „morgen"/Datum im Notiztext wird automatisch als Frist-Chip erkannt.</li>
              </ul>
            </section>

            <section id="help-wissen">
              <h3>💡 Wissen & Verknüpfen</h3>
              <ul>
                <li><b>[[Wikilinks]]</b> im Notiztext verlinken Boards oder Karten — Chips unten an der Notiz springen hin; unbekannte Namen legen per Klick ein neues Board an.</li>
                <li><b>#Tags</b> einfach in den Text schreiben; Strg+K und „#" listet alle Themen.</li>
                <li><b>↩ Backlinks:</b> das Panel unten rechts zeigt, wer auf das aktuelle Board verweist.</li>
                <li><b>🏷 Eigenschaften:</b> Karte auswählen → 🏷 → schlüssel = wert (z. B. status = wartet) — durchsuchbar und im Export enthalten.</li>
                <li><b>🔖 Vorlagen:</b> jede Karte als Vorlage sichern, einfügen über ➕ → Vorlagen.</li>
                <li><b>🕘 Board-Verlauf:</b> Uhr-Symbol in der Kopfleiste — bis zu 3 Versionen pro Board sichern und wiederherstellen.</li>
              </ul>
            </section>

            <section id="help-ki">
              <h3>✨ KI-Assistent</h3>
              <ul>
                <li><b>Anbieter</b> unter ⚙️ → KI: „Gratis" (ohne Konto, langsam), OpenRouter (kostenloser Account, flott), eigene Schlüssel (Anthropic/OpenAI) oder <b>Ollama — dann bleibt alles auf deinem Rechner</b>. Schlüssel werden nur lokal gespeichert und gehen nie in Sync/Export/Teilen-Links.</li>
                <li><b>✨ im Dock</b> (ganzes Board): Freitext-Anweisung („Erstelle einen Wochenplan …"), Themen clustern, Aufgaben extrahieren, Workflow-Diagramm, Briefing, Verbindungen vorschlagen.</li>
                <li><b>✨ in der Auswahl-Leiste</b> (markierte Karten): dieselben Werkzeuge nur für die Auswahl, plus <b>Text verbessern</b> für Notizen — der Vorschlag erscheint daneben, das Original bleibt.</li>
                <li>Alle KI-Aktionen sind <b>nicht destruktiv</b> und ein einziges Strg+Z macht den kompletten Plan rückgängig.</li>
              </ul>
            </section>

            <section id="help-daten">
              <h3>💾 Speichern, Sync & Teilen</h3>
              <ul>
                <li>Alles speichert <b>automatisch lokal</b> im Browser. Zusätzlich: ⚙️ → Daten → „Datei exportieren" für Backups (USB-Stick, Mail, Netzlaufwerk).</li>
                <li><b>Sync-Ordner:</b> einen von Nextcloud/OneDrive/Dropbox synchronisierten Ordner verbinden — PixiNotes schreibt dort automatisch. Liegt beim Start (oder bei Fenster-Rückkehr) ein neuerer Stand im Ordner und du hast lokal nichts geändert, wird er <b>automatisch übernommen</b>; bei echten Konflikten fragt PixiNotes statt zu überschreiben.</li>
                <li><b>Sync-Status oben:</b> Das Wolken-Symbol in der Aktionsleiste zeigt live, ob gespeichert wurde (Häkchen-Wolke, Uhrzeit per Hover), gerade gespeichert wird (pulsierend) oder etwas hakt (amber). Eine <b>durchgestrichene Wolke</b> heißt: Der Browser hat die Ordner-Freigabe nach einem Neustart zurückgesetzt — ein Klick darauf genügt, und der Auto-Sync läuft weiter.</li>
                <li><b>WebDAV direkt:</b> ohne Desktop-Client (auch am Handy) — Ordner-URL + App-Passwort in ⚙ → Synchronisation. Zugangsdaten bleiben lokal. <b>Wichtig bei Nextcloud:</b> Browser-Zugriffe sind serverseitig erst nach CORS-Freigabe möglich — z. B. über die Nextcloud-App „WebAppPassword" (dort die PixiNotes-Adresse als erlaubte Origin eintragen) oder durch die IT. Ohne Freigabe den Sync-Ordner nutzen.</li>
                <li><b>Mehrere Fenster:</b> Läuft PixiNotes doppelt (z. B. installierte App + vergessener Browser-Tab), speichert nur <b>ein</b> Fenster — die anderen lesen live mit und zeigen ein Banner mit „Hier weiterarbeiten". So kann kein altes Fenster deine Änderungen überschreiben.</li>
                <li><b>Teilen:</b> Der ⧉-Button in der Kopfleiste kopiert einen Link, der das <b>komplette Board enthält</b> — serverlos. Große Boards werden als .pixiboard.json-Datei exportiert; Empfänger zieht sie einfach aufs Board.</li>
                <li><b>PWA:</b> Über „App installieren" im Browser wird PixiNotes zur eigenständigen App — läuft komplett offline.</li>
                <li><b>Export:</b> Markdown-Ordner (Obsidian-lesbar), PNG/SVG des Boards, .ics für Kalender.</li>
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
