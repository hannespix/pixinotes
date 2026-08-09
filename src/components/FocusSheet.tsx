import { useCallback, useEffect, useRef } from 'react';
import { useBoard } from '../store';
import { nodeToText } from '../lib/serialize';
import type { AppNode } from '../types';
import { IChevronL, IChevronR, IMore, IX } from './Icons';

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
  portal: 'Portal', frame: 'Rahmen',
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
  const setShareCards = useBoard((s) => s.setShareCards);
  const showToast = useBoard((s) => s.showToast);
  const touchRef = useRef<{ x: number; y: number } | null>(null);

  const board = boards.find((b) => b.id === activeId);
  const siblings = (board?.nodes ?? []).filter(focusable);
  const index = siblings.findIndex((n) => n.id === focusCard);
  const node = index >= 0 ? siblings[index] : undefined;

  const close = useCallback(() => setFocusCard(null), [setFocusCard]);

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

  // Esc schließt (Tastatur am iPad)
  useEffect(() => {
    if (!focusCard) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, [contenteditable="true"]')) return;
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
        <button className="focus-x" onClick={close} title="Zurück zum Board (oder nach unten wischen)" aria-label="Zurück zum Board">
          <IX size={16} />
        </button>
        <div className="focus-title">
          <b>{cardTitle(node)}</b>
          <span>{typeName}{siblings.length > 1 ? ` · ${index + 1} von ${siblings.length}` : ''}</span>
        </div>
        <button
          className="focus-more"
          title="Teilen, Drucken, PDF …"
          aria-label="Mehr"
          onClick={() => setShareCards([node.id])}
        >
          <IMore size={16} />
        </button>
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
          {ACTIONS[node.type ?? '']?.map((a) => (
            <button
              key={a.label}
              className="focus-act"
              title={a.hint}
              onClick={() => runAction(node, a.key)}
            >
              {a.label}
            </button>
          )) ?? <span className="focus-hint">Wischen blättert</span>}
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
