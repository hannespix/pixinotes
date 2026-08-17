import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useBoard } from '../store';
import { nodeToText } from '../lib/serialize';
import type { AppNode } from '../types';
import { IChevronL, IChevronR, IPlay, IX } from './Icons';
import { flaecheVon, fliege, letzterKasten, merkeKasten, type Kasten } from '../lib/fokusFlug';

/**
 * M212: „Karte im Fokus" — am Handy füllt ein angetipptes Modul den Schirm.
 *
 * Der Grund ist nicht Schönheit, sondern Bedienbarkeit: Die Module sind kleine
 * Anwendungen (Wochenplan mit Stundenraster, Kanban mit Spalten, Protokoll mit
 * Sitzungen). Auf 390 Punkten Breite IM Canvas ist eine Karte 200 Punkte breit
 * und eine Rasterzelle 15 — das kann man nicht treffen. Dazu kam, dass
 * gleichzeitig Canvas-Bedienung UND Modul-Bedienung angeboten wurden; genau
 * das ließ die Ansicht so voll wirken.
 *
 * Diese Komponente rendert die Karte NICHT selbst — sie bleibt im
 * React-Flow-Baum (sonst verlören Handle/NodeResizer ihren Kontext) und wird
 * per CSS formatfüllend gestellt. Hier liegen nur Rahmen und Bedienung:
 * Kopfzeile, Blättern, Schließen.
 */

/** Kurzer, sprechender Name der Karte für die Kopfzeile */
function cardTitle(node: AppNode): string {
  const first = nodeToText(node).trim().split('\n').map((l) => l.trim()).find(Boolean);
  if (first) return first.replace(/^#+\s*/, '').slice(0, 60);
  return TYPE_LABEL[node.type ?? ''] ?? 'Karte';
}

const TYPE_LABEL: Record<string, string> = {
  note: 'Notiz', kanban: 'Kanban', gantt: 'Zeitplan', calendar: 'Kalender',
  week: 'Planer', minutes: 'Protokoll', time: 'Zeiterfassung', mermaid: 'Diagramm',
  image: 'Bild', file: 'Datei', email: 'E-Mail', htmlapp: 'App', shape: 'Form',
  portal: 'Portal', frame: 'Rahmen', sheet: 'Rechen-Tabelle',
};

/** Karten, die im Fokus nichts gewinnen — sie bleiben Board-Sache */
const NO_FOCUS = new Set(['portal', 'frame', 'shape']);

/**
 * M214: Was die Fußleiste je Modultyp anbietet.
 *
 * Bewusst EINE Sache pro Typ, nämlich die, die man am Handy am häufigsten
 * will: etwas hinzufügen. Alles Weitere steht in der Karte selbst (deren
 * Werkzeuge im Fokus mitlaufen) oder gehört aufs Board.
 */
interface FocusAction { label: string; hint: string; key: string }
const ACTIONS: Record<string, FocusAction[]> = {
  kanban: [{ label: '＋ Ticket', hint: 'Neues Ticket in der ersten Spalte anlegen', key: 'ticket' }],
  gantt: [{ label: '＋ Vorgang', hint: 'Neuen Vorgang ab heute anlegen', key: 'gantt-row' }],
  week: [{ label: '＋ Block', hint: 'Neuen Block anlegen — Zeit und Text danach in der Karte', key: 'week-entry' }],
  time: [{ label: '＋ Zeit', hint: 'Arbeitszeit für heute nacherfassen', key: 'time-seg' }],
  sheet: [{ label: '＋ Zeile', hint: 'Eine Zeile an die Rechen-Tabelle anhängen', key: 'sheet-row' }],
};

export function focusable(node: AppNode | undefined): boolean {
  return !!node && !NO_FOCUS.has(node.type ?? '') && !node.archived;
}

/** Fußleisten-Aktion ausführen — schreibt in denselben Datenformen wie die
 *  Module selbst, damit deren Anzeige und Rück-Sync unverändert greifen. */
function runAction(node: AppNode, key: string) {
  const st = useBoard.getState();
  const d = node.data as Record<string, unknown>;
  const id = () => Math.random().toString(36).slice(2, 10);
  const today = new Date().toISOString().slice(0, 10);
  st.pushHistory();
  if (key === 'ticket') {
    const items = (d.items as Array<Record<string, unknown>>) ?? [];
    st.updateNodeData(node.id, { items: [...items, { id: id(), text: 'Neues Ticket', col: 0 }] });
    st.showToast('＋ Ticket angelegt — Text antippen zum Ändern.');
  } else if (key === 'gantt-row') {
    const rows = (d.rows as Array<Record<string, unknown>>) ?? [];
    const end = new Date(Date.now() + 4 * 864e5).toISOString().slice(0, 10);
    st.updateNodeData(node.id, {
      rows: [...rows, { id: id(), name: `Vorgang ${rows.length + 1}`, start: today, end }],
    });
    st.showToast('＋ Vorgang angelegt — Name und Zeitraum in der Karte anpassen.');
  } else if (key === 'week-entry') {
    const entries = (d.entries as Array<Record<string, unknown>>) ?? [];
    // Beginn: Anfang des Rasters, Dauer eine Einheit — Feinheiten in der Karte
    const from = typeof d.from === 'number' ? d.from : 480;
    st.updateNodeData(node.id, {
      entries: [...entries, { id: id(), day: 0, start: from, dur: 60, text: 'Neuer Block' }],
    });
    st.showToast('＋ Block angelegt — antippen für Zeit, Tag und Text.');
  } else if (key === 'sheet-row') {
    const rows = typeof d.rows === 'number' ? d.rows : 8;
    st.updateNodeData(node.id, { rows: rows + 1 });
    st.showToast('＋ Zeile angehängt — Zelle antippen zum Ausfüllen.');
  } else if (key === 'time-seg') {
    const segs = (d.segs as Array<Record<string, unknown>>) ?? [];
    st.updateNodeData(node.id, {
      segs: [...segs, { id: id(), date: today, start: 8 * 60, end: 9 * 60, kind: 'arbeit' }],
    });
    st.showToast('＋ Stunde für heute erfasst — Zeiten in der Karte anpassen.');
  }
}

export function FocusSheet() {
  const focusCard = useBoard((s) => s.focusCard);
  const setFocusCard = useBoard((s) => s.setFocusCard);
  const boards = useBoard((s) => s.boards);
  const activeId = useBoard((s) => s.activeId);
  const touchRef = useRef<{ x: number; y: number } | null>(null);

  const zurueckZurUebersicht = useBoard((s) => s.focusHerkunft === 'overview');
  const board = boards.find((b) => b.id === activeId);
  const siblings = (board?.nodes ?? []).filter(focusable);
  const index = siblings.findIndex((n) => n.id === focusCard);
  const node = index >= 0 ? siblings[index] : undefined;

  /**
   * M227: Beim Schließen fliegt die Karte an ihren Platz auf dem Board zurück —
   * und das Board rückt sie so ins Bild, dass sie GANZ zu sehen ist. Vorher
   * landete man irgendwo im Canvas und musste erst suchen, wo man war.
   */
  const vollbildKasten = useRef<Kasten | null>(null);
  const close = useCallback(() => {
    const el = flaecheVon(document.querySelector('.react-flow__node.pn-focused'));
    if (el) {
      const b = el.getBoundingClientRect();
      vollbildKasten.current = { x: b.x, y: b.y, w: b.width, h: b.height };
    }
    const id = focusCard;
    /**
     * M285: Zurück, wo man herkam.
     *
     * Wer die Karte aus der Übersicht geöffnet hat, will nach dem Schließen
     * wieder die Übersicht sehen — nicht das Board, das er nie besucht hat.
     * Damit fühlt sich das eine Blatt in jeder Ansicht wie „an Ort und
     * Stelle" an, statt wie ein Sprung ins Ungewisse.
     */
    const herkunft = useBoard.getState().focusHerkunft;
    setFocusCard(null);
    if (herkunft === 'overview') useBoard.getState().setView('overview');
    if (id) window.dispatchEvent(new CustomEvent('pixinotes:fokus-zurueck', { detail: id }));
  }, [setFocusCard, focusCard]);

  const step = useCallback((dir: -1 | 1) => {
    if (siblings.length < 2 || index < 0) return;
    const next = (index + dir + siblings.length) % siblings.length;
    setFocusCard(siblings[next].id);
  }, [siblings, index, setFocusCard]);

  // Android-Zurücktaste: Ohne eigenen History-Eintrag schlösse die Systemgeste
  // die ganze PWA statt nur das Blatt — genau das erwartet dort niemand.
  // WICHTIG: nur am OFFEN/ZU hängen, nicht an der Karten-ID. Sonst räumt das
  // Cleanup beim Blättern seinen eigenen Eintrag ab, das löst popstate aus —
  // und der Fokus schlösse sich beim Weiterblättern von selbst.
  const isOpen = !!focusCard;
  useEffect(() => {
    if (!isOpen) return;
    history.pushState({ pnFocus: true }, '');
    const onPop = () => setFocusCard(null);
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // Beim Schließen über ✕/Wischen den eigenen Eintrag wieder abräumen,
      // sonst sammeln sich tote Schritte im Verlauf. Kam das Schließen von
      // der Zurück-Taste, ist er schon weg — der Guard verhindert den
      // Schritt zu weit zurück.
      if (history.state?.pnFocus) history.back();
    };
  }, [isOpen, setFocusCard]);

  /**
   * Hinflug: Die Karte startet dort, wo sie auf dem Board lag, und wächst ins
   * Vollbild. Beim Blättern wird NICHT geflogen — dort wäre die Bewegung eine
   * Behauptung („kommt von dort"), die nicht stimmt; ein Wisch ist die Geste.
   */
  useLayoutEffect(() => {
    if (!focusCard) return;
    const von = letzterKasten();
    if (!von) return;
    // React Flow führt die Knoten in einem EIGENEN Zustand: Die Klasse
    // `pn-focused` steht erst nach dessen Durchlauf im DOM, nicht schon in
    // unserem Layout-Effekt. Darum ein paar Frames lang nachsehen, statt den
    // Flug stillschweigend ausfallen zu lassen.
    let versuche = 0;
    let raf = 0;
    const suche = () => {
      const el = flaecheVon(document.querySelector('.react-flow__node.pn-focused'));
      if (el && el.getBoundingClientRect().width > 2) {
        fliege(el, von);
        merkeKasten(null);
        return;
      }
      if (versuche++ < 8) raf = requestAnimationFrame(suche);
      else merkeKasten(null);
    };
    suche();
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [focusCard]);

  /** Rückflug: vom Vollbild auf den Board-Platz — und die Karte ganz ins Bild */
  useEffect(() => {
    const zurueck = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const von = vollbildKasten.current;
      vollbildKasten.current = null;
      requestAnimationFrame(() => {
        const el = flaecheVon(document.querySelector(`.react-flow__node[data-id="${id}"]`));
        if (el && von) fliege(el, von, 300);
      });
    };
    window.addEventListener('pixinotes:fokus-zurueck', zurueck);
    return () => window.removeEventListener('pixinotes:fokus-zurueck', zurueck);
  }, []);

  /**
   * Esc schließt — und zwar beim ERSTEN Druck.
   *
   * M239: Vorher hing der Handler in der Bubble-Phase. Bis er dran war, hatte
   * schon jemand anderes zugegriffen: Das Board hat einen eigenen Esc (Rückflug
   * aus dem Klick-Zoom), das Dock einen für seine Menüs. Man drückte zweimal
   * und wusste nicht, wofür das erste Mal gut war. Jetzt in der Capture-Phase
   * mit stopPropagation: Solange eine Karte im Fokus steht, gehört Esc IHR.
   * Nur ein Textfeld darf vorgehen — dort bricht Esc eine Eingabe ab.
   */
  useEffect(() => {
    if (!focusCard) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, [contenteditable="true"]')) return;
      // Esc räumt IMMER das Oberste ab. Steht ein Menü, ein Dialog oder das
      // Slash-Menü offen, gehört der Druck dem — sonst verschwände plötzlich
      // die ganze Karte, obwohl man nur ein Menü wegklicken wollte.
      if (document.querySelector('.sel-menu-fixed, .modal, .nav-panel, .bn-suggestion-menu, .ov-graph-ctx')) return;
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [focusCard, close]);

  /**
   * M239: Ein Klick NEBEN die Karte schließt den Fokus.
   *
   * Das ist die Geste, die jeder von Dialogen kennt — und seit die Karte am
   * PC als Blatt über dem gedimmten Board schwebt, ist der Bereich daneben
   * sichtbar genug, um ihn zu treffen. Bewusst eng gefasst: Es zählt nur der
   * Klick auf die Board-Fläche selbst. Werkzeugleisten, Menüs, Dialoge und
   * die Fokus-Leisten liegen zwar auch „neben" der Karte, sind aber
   * Bedienung — wer dort klickt, will etwas tun, nicht schließen.
   */
  useEffect(() => {
    if (!focusCard) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest('.pn-focused, .focus-head, .focus-nav')) return;
      // Nur die FREIE Board-Fläche zählt. Bewusst nicht der ganze Renderer:
      // Der enthält auch die zurückgetretenen Karten und alles, was React Flow
      // sonst noch aufspannt — ein Treffer dort ist kein „daneben".
      if (!t.closest('.react-flow__pane')) return;
      close();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [focusCard, close]);

  /**
   * M225: Die fokussierte Karte ist auch die AUSGEWÄHLTE Karte.
   *
   * Daran hängt die Auswahl-Leiste mit allem, was eine Karte kann — KI,
   * Nachschlagen, Schrift, Farbe, Eigenschaften, Teilen. Vorher war sie im
   * Fokus ausgeblendet: Wer am Handy die KI auf eine Notiz loslassen wollte,
   * musste erst zurück aufs Board, herauszoomen und die Karte dort treffen.
   * Genauso wichtig ist die Kopplung beim BLÄTTERN: Ohne sie zeigte die
   * Leiste weiter auf die vorige Karte und hätte auf der falschen gearbeitet.
   */
  useEffect(() => {
    if (!focusCard) return;
    const st = useBoard.getState();
    const board = st.boards.find((b) => b.id === st.activeId);
    if (!board) return;
    const aendern = board.nodes
      .filter((n) => (n.id === focusCard) !== !!n.selected)
      .map((n) => ({ id: n.id, type: 'select' as const, selected: n.id === focusCard }));
    if (aendern.length) st.onNodesChange(aendern);
  }, [focusCard]);

  /**
   * M233: Die Karte im Fokus gibt es nicht mehr — gelöscht, archiviert oder
   * auf ein anderes Board geschoben.
   *
   * Ohne Ausstieg blieb der Fokus-Modus an: Das Blatt rendert nichts mehr,
   * aber die Klasse hält den Canvas weiter im Vollbild — man saß in einer
   * leeren Fläche fest, ohne ✕ und ohne Wisch-Ziel (User-Report). Also
   * zurück aufs Board.
   *
   * Bewusst NICHT zur Nachbarkarte weiterblättern: Wer löscht, will die
   * Karte weghaben, nicht die nächste aufgedrängt bekommen — und ein
   * stillschweigender Wechsel sähe aus, als wäre die falsche gelöscht worden.
   *
   * Kein Rückflug: Er zeigt auf einen Platz, an dem nichts mehr liegt. Das
   * Board steht ohnehin noch so, wie man es verlassen hat — der Fokus ändert
   * den Ausschnitt nicht.
   */
  useEffect(() => {
    if (!focusCard || node) return;
    setFocusCard(null);
  }, [focusCard, node, setFocusCard]);

  if (!focusCard || !node) return null;

  // Wischen: waagerecht blättert, nach unten schließt. Bewusst nur am RAHMEN
  // ausgewertet (Kopf/Fuß), nicht auf der Karte — dort scrollt und tippt man.
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
    else if (dy > 70 && Math.abs(dy) > Math.abs(dx)) close();
  };

  const typeName = TYPE_LABEL[node.type ?? ''] ?? 'Karte';

  return (
    <>
      <div
        className="focus-head"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* M285: Der Knopf sagt, wohin er führt. Seit die Karte auch aus der
            Übersicht geöffnet werden kann, wäre „Zurück zum Board" dort
            schlicht falsch — und Beschriftungen, die nicht stimmen, sind
            schlimmer als gar keine. */}
        <button
          className="focus-x"
          onClick={close}
          title={zurueckZurUebersicht
            ? 'Zurück zur Übersicht (oder nach unten wischen)'
            : 'Zurück zum Board (oder nach unten wischen)'}
          aria-label={zurueckZurUebersicht ? 'Zurück zur Übersicht' : 'Zurück zum Board'}
        >
          <IX size={16} />
        </button>
        {/* M227: Hier stand ein zweites ⋮. Es löste seit M226 exakt dasselbe
            Ereignis aus wie das ⋯ in der Auswahl-Leiste unten und öffnete
            damit dasselbe Menü an derselben Stelle — zwei Knöpfe, ein
            Ergebnis. Geblieben ist der untere: Er liegt am Daumen und steht
            ohnehin bei allen Karten-Werkzeugen. */}
        <div className="focus-title">
          <b>{cardTitle(node)}</b>
          <span>{typeName}{siblings.length > 1 ? ` · ${index + 1} von ${siblings.length}` : ''}</span>
        </div>
      </div>
      <div className="focus-nav" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {siblings.length > 1 ? (
          <button onClick={() => step(-1)} title="Vorige Karte (oder nach rechts wischen)" aria-label="Vorige Karte">
            <IChevronL size={16} />
          </button>
        ) : <span className="focus-nav-gap" />}
        {/* M214: Was in der Mitte steht, hängt am Modultyp — beim Planer ein
            Block, beim Kanban ein Ticket, bei der Notiz das Textformat. Alles,
            was NICHT zum Modul gehört (Verbinden, Anordnen, Archivieren),
            bleibt bewusst draußen: Das sind Board-Tätigkeiten. */}
        <div className="focus-acts">
          {/* M228: Die Brücke zum Vortrag. Fokus und Präsentation sind bewusst
              NICHT derselbe Modus — der eine ist zum Arbeiten, der andere zum
              Zeigen (feste Folienfolge, keine Werkzeuge, Beamer-tauglich).
              Damit man trotzdem nicht sucht, führt von hier ein Weg dorthin,
              und zwar ab GENAU dieser Karte. */}
          <button
            className="focus-act"
            title="Ab dieser Karte präsentieren — Vollbild, Folienfolge aus den Verbindungen"
            onClick={() => {
              const st = useBoard.getState();
              st.setPresentFrom(node.id);
              setFocusCard(null);
              st.setPresenting(true);
            }}
          >
            <IPlay size={12} /> Präsentieren
          </button>
          {ACTIONS[node.type ?? '']?.map((a) => (
            <button
              key={a.label}
              className="focus-act"
              title={a.hint}
              onClick={() => runAction(node, a.key)}
            >
              {a.label}
            </button>
          ))}
        </div>
        {siblings.length > 1 ? (
          <button onClick={() => step(1)} title="Nächste Karte (oder nach links wischen)" aria-label="Nächste Karte">
            <IChevronR size={16} />
          </button>
        ) : <span className="focus-nav-gap" />}
      </div>
    </>
  );
}
