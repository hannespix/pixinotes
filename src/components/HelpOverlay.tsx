import { useEffect, useRef, useState } from 'react';
import { useBoard } from '../store';

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
] as const;

export function HelpOverlay() {
  const open = useBoard((s) => s.helpOpen);
  const setOpen = useBoard((s) => s.setHelpOpen);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState<string>('start');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

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
          <button className="modal-x" onClick={() => setOpen(false)} aria-label="Schließen">✕</button>
        </div>
        <div className="help-layout">
          <nav className="help-nav">
            {SECTIONS.map((s) => (
              <button key={s.id} className={active === s.id ? 'on' : ''} onClick={() => jump(s.id)}>
                <span>{s.icon}</span> {s.title}
              </button>
            ))}
          </nav>
          <div className="help-body" ref={bodyRef}>

            <section id="help-start">
              <h3>🚀 Erste Schritte</h3>
              <p>PixiNotes ist ein Whiteboard: eine unendliche Fläche voller Karten. Alles bleibt <b>lokal in deinem Browser</b> — kein Konto, kein Server.</p>
              <ul>
                <li><b>Doppelklick</b> auf die Fläche legt eine Notiz an, <b>➕</b> im Dock alle anderen Module.</li>
                <li>Karten <b>ziehen</b> (Griff-Pill oben oder Karte fassen), am Rand <b>resizen</b>, mit Schwung werfen 🚀.</li>
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
                <li><b>Sync-Ordner:</b> einen von Nextcloud/OneDrive/Dropbox synchronisierten Ordner verbinden — PixiNotes schreibt dort automatisch; andere Geräte verbinden denselben Ordner. Bei Konflikten warnt PixiNotes statt zu überschreiben.</li>
                <li><b>WebDAV direkt:</b> ohne Desktop-Client (auch am Handy) — Ordner-URL + App-Passwort in ⚙ → Synchronisation. Zugangsdaten bleiben lokal; der Server braucht CORS-Freigabe (IT), sonst den Sync-Ordner nutzen.</li>
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
                  <tr><td><kbd>Entf</kbd></td><td>Auswahl/Verbindung löschen</td></tr>
                  <tr><td><kbd>Esc</kbd></td><td>Menüs/Overlays schließen · Zeichenmodus beenden</td></tr>
                  <tr><td><kbd>←</kbd> <kbd>→</kbd> / <kbd>Leertaste</kbd></td><td>Präsentation blättern</td></tr>
                  <tr><td><kbd>/</kbd></td><td>Block-Menü im Notiz-Editor</td></tr>
                </tbody>
              </table>
            </section>

            <div className="help-foot">PixiNotes — lokal, offen, deins. Feedback jederzeit willkommen. 📌</div>
          </div>
        </div>
      </div>
    </div>
  );
}
