import { folgeNachbar, kartenFolge } from '../lib/kartenFolge';
import { overlayOffen } from '../lib/overlay';
import { tagLokal } from '../lib/tag';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBoard, type Tool } from '../store';
import { DOKUMENT_BEFEHL, SEITEN_EREIGNIS, seiteVon, type DokumentBefehl } from '../lib/pdfSeiten';
import { nodeToText } from '../lib/serialize';
import { vorWann, zeitLang, zeitVon } from '../lib/kartenZeit';
import type { AppNode } from '../types';
import { ICheck, IChevronL, IChevronR, IComment, IEraser, IFit, IHighlighter, IMaximize, IPen, IPlay, IX } from './Icons';
import { istRein, ReinRand, useReinAnsicht } from '../lib/reinAnsicht';
import { FOKUS_ANSICHTEN, FOKUS_ZOOM_EREIGNIS, FOKUS_ANSICHT_EREIGNIS, fokusAnsicht, fokusAnsichtSetzen, fokusStufe, fokusStufeMal, type FokusAnsicht } from '../lib/fokusAnsicht';

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
 * React-Flow-Baum. M333: Sie wird auch nicht mehr formatfüllend gestellt;
 * die Kamera fährt auf sie (Board.tsx, fokusZoomen), der Rest des Boards
 * tritt zurück. Hier liegen nur Rahmen und Bedienung: Kopfzeile, Blättern,
 * Schließen. Stift und Finger erreichen die Karte wie jede andere.
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
  portal: 'Portal', frame: 'Rahmen', sheet: 'Rechen-Tabelle', bubbles: 'Bubbles',
  kontakt: 'Kontakt',
  fluessig: 'Flüssige Schrift',
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
  week: [{ label: '＋ Block', hint: 'Neuen Block anlegen – Zeit und Text danach in der Karte', key: 'week-entry' }],
  time: [{ label: '＋ Zeit', hint: 'Arbeitszeit für heute nacherfassen', key: 'time-seg' }],
  sheet: [{ label: '＋ Zeile', hint: 'Eine Zeile an die Rechen-Tabelle anhängen', key: 'sheet-row' }],
};

/**
 * M363: Die offene Seite eines Dokuments (PDF, Word) im Fokus — oder nichts. Die Fußleiste wird damit zur
 * Dokument-Leiste: Die Pfeile an den Rändern blättern SEITEN (statt Karten), dazwischen liegen Stift, Textmarker,
 * Radierer und „Kommentar an eine Stelle" in Daumen-Größe. Auf der Karte selbst sind diese Knöpfe am Telefon
 * winzig (die Seite ist auf Schirmbreite verkleinert), und Zeichenwerkzeuge gab es im Fokus gar nicht.
 */
function useOffeneSeite(id: string | null): { seite: number; seiten: number } | null {
  const [, takt] = useState(0);
  useEffect(() => {
    const auf = () => takt((n) => n + 1);
    window.addEventListener(SEITEN_EREIGNIS, auf);
    return () => window.removeEventListener(SEITEN_EREIGNIS, auf);
  }, []);
  const g = id ? seiteVon(id) : undefined;
  return g ? { seite: g.seite, seiten: g.seiten } : null;
}
const dokumentBefehl = (id: string, was: DokumentBefehl['was'], zu?: number) =>
  window.dispatchEvent(new CustomEvent<DokumentBefehl>(DOKUMENT_BEFEHL, { detail: { id, was, zu } }));

export function focusable(node: AppNode | undefined): boolean {
  return !!node && !NO_FOCUS.has(node.type ?? '') && !node.archived;
}

/** Fußleisten-Aktion ausführen — schreibt in denselben Datenformen wie die
 *  Module selbst, damit deren Anzeige und Rück-Sync unverändert greifen. */
function runAction(node: AppNode, key: string) {
  const st = useBoard.getState();
  const d = node.data as Record<string, unknown>;
  const id = () => Math.random().toString(36).slice(2, 10);
  const today = tagLokal();
  st.pushHistory();
  if (key === 'ticket') {
    const items = (d.items as Array<Record<string, unknown>>) ?? [];
    st.updateNodeData(node.id, { items: [...items, { id: id(), text: 'Neues Ticket', col: 0 }] });
    st.showToast('＋ Ticket angelegt – Text antippen zum Ändern.');
  } else if (key === 'gantt-row') {
    const rows = (d.rows as Array<Record<string, unknown>>) ?? [];
    const end = tagLokal(new Date(Date.now() + 4 * 864e5));
    st.updateNodeData(node.id, {
      rows: [...rows, { id: id(), name: `Vorgang ${rows.length + 1}`, start: today, end }],
    });
    st.showToast('＋ Vorgang angelegt – Name und Zeitraum in der Karte anpassen.');
  } else if (key === 'week-entry') {
    const entries = (d.entries as Array<Record<string, unknown>>) ?? [];
    // Beginn: Anfang des Rasters, Dauer eine Einheit — Feinheiten in der Karte
    const from = typeof d.from === 'number' ? d.from : 480;
    st.updateNodeData(node.id, {
      entries: [...entries, { id: id(), day: 0, start: from, dur: 60, text: 'Neuer Block' }],
    });
    st.showToast('＋ Block angelegt – antippen für Zeit, Tag und Text.');
  } else if (key === 'sheet-row') {
    const rows = typeof d.rows === 'number' ? d.rows : 8;
    st.updateNodeData(node.id, { rows: rows + 1 });
    st.showToast('＋ Zeile angehängt – Zelle antippen zum Ausfüllen.');
  } else if (key === 'time-seg') {
    const segs = (d.segs as Array<Record<string, unknown>>) ?? [];
    st.updateNodeData(node.id, {
      segs: [...segs, { id: id(), date: today, start: 8 * 60, end: 9 * 60, kind: 'arbeit' }],
    });
    st.showToast('＋ Stunde für heute erfasst – Zeiten in der Karte anpassen.');
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
  /* M413: Geblättert wird in derselben Reihenfolge wie im Vortrag (lib/kartenFolge.ts): Verbundenes am Stück und
     den Pfeilen nach, Rahmen als Abschnitte, sonst Lesefolge. Gerechnet über alle Karten – Formen eines Ablaufs
     geben die Richtung mit vor, auch wenn der Fokus sie überspringt. (M390: reine Lesefolge.) */
  const siblings = useMemo(() => kartenFolge((board?.nodes ?? []).filter((n) => !n.archived), board?.edges ?? []).filter(focusable), [board?.nodes, board?.edges]);
  const index = siblings.findIndex((n) => n.id === focusCard);
  const node = index >= 0 ? siblings[index] : undefined;

  /**
   * M227/M333: Beim Schließen fährt die Kamera zur vorherigen Ansicht zurück
   * (Board.tsx) — die Karte selbst hat sich nie bewegt.
   * M285: Zurück, wo man herkam: aus der Übersicht geöffnet → Übersicht.
   */
  const close = useCallback(() => {
    const herkunft = useBoard.getState().focusHerkunft;
    setFocusCard(null);
    if (herkunft === 'overview') useBoard.getState().setView('overview');
  }, [setFocusCard]);

  const step = useCallback((dir: -1 | 1) => {
    if (siblings.length < 2 || index < 0) return;
    const next = (index + dir + siblings.length) % siblings.length;
    setFocusCard(siblings[next].id);
  }, [siblings, index, setFocusCard]);

  // M344: Alt+↓ / Alt+↑ blättert zur nächsten bzw. vorigen Karte — auch mitten im Schreiben
  useEffect(() => {
    if (!focusCard) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey) return;
      // M413: Strg+→ / Strg+← wie im Vortrag (M405) – außer beim Schreiben, dort springt das wortweise
      const strg = (e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')
        && !(e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]'));
      const alt = e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp');
      if (!strg && !alt) return;
      e.preventDefault(); e.stopPropagation();
      step(e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [focusCard, step]);

  // Android-Zurücktaste: Ohne eigenen History-Eintrag schlösse die Systemgeste
  // die ganze PWA statt nur das Blatt — genau das erwartet dort niemand.
  // WICHTIG: nur am OFFEN/ZU hängen, nicht an der Karten-ID. Sonst räumt das
  // Cleanup beim Blättern seinen eigenen Eintrag ab, das löst popstate aus —
  // und der Fokus schlösse sich beim Weiterblättern von selbst.
  const isOpen = !!focusCard;
  // M426: Nur Inhalt – Vollbild ohne Kopf- und Fußleiste, ohne Rahmen und Bedienung (F, Esc)
  const reinAnsicht = useReinAnsicht('fokus', isOpen);
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
      if (istRein()) return;   // M426: Esc führt erst aus „Nur Inhalt" zurück (reinAnsicht.tsx)
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, [contenteditable="true"]')) return;
      // Esc räumt IMMER das Oberste ab. Steht ein Menü, ein Dialog oder das
      // Slash-Menü offen, gehört der Druck dem — sonst verschwände plötzlich
      // die ganze Karte, obwohl man nur ein Menü wegklicken wollte.
      // M388: … auch Ticket-Fenster, Bild-Lupe und offene Menüs: Vorher schloss Esc den Fokus und ließ das Fenster stehen.
      // (Ein offenes Gespräch NEBEN der Karte zählt nicht dazu — es ist kein Fenster über ihr und bleibt beim Verlassen stehen.)
      if (document.querySelector('.sel-menu-fixed, .modal, .nav-panel, .bn-suggestion-menu, .ov-graph-ctx, [role="menu"], .dock-menu') || overlayOffen()) return;
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
    // M333: Nur ein kurzer TIPP neben die Karte schließt. Ein Stift-Strich, ein
    // Schwenken oder ein Pinch auf der Fläche gehört zum Arbeiten im Zoom.
    let start: { x: number; y: number; t: number } | null = null;
    const onDown = (e: PointerEvent) => {
      start = null;
      const t = e.target as HTMLElement | null;
      if (!t || t.closest('.pn-focused, .focus-head, .focus-nav')) return;
      if (!t.closest('.react-flow__pane')) return;
      start = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    const onUp = (e: PointerEvent) => {
      const s0 = start; start = null;
      if (!s0) return;
      if (performance.now() - s0.t > 450 || Math.hypot(e.clientX - s0.x, e.clientY - s0.y) > 8) return;
      if (document.body.dataset.stiftZug === '1') return;
      if (istRein()) return;   // M426: in „Nur Inhalt" ist neben der Karte nichts zum Wegklicken
      close();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('pointerup', onUp, true); };
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

  const dok = useOffeneSeite(focusCard);

  /**
   * M441: Im Vollbild („Nur Inhalt" oder Browser-Vollbild) wischt man am Telefon zur nächsten Karte — Kopf und Fuß, an
   * denen das Wischen sonst hängt, sind dort ausgeblendet. Nach links: nächste Karte, nach rechts: vorige; in einem
   * Dokument blättert der Wisch erst die Seiten, am Ende geht es zur Nachbarkarte. Vorrang haben: was seitlich rollen
   * kann (Tabelle, Kanban), eine Textauswahl, Eingabefelder, Zwei-Finger-Gesten und eine hineingezoomte Karte (dort
   * schiebt der Finger das Blatt).
   */
  const wischRef = useRef({ step, dok, id: focusCard });
  wischRef.current = { step, dok, id: focusCard };
  const vollbild = reinAnsicht.rein;
  useEffect(() => {
    if (!focusCard) return;
    let start: { x: number; y: number; t: number; roll: HTMLElement | null; links: number; seite: boolean } | null = null;
    const rollbarSeitlich = (el: Element | null): HTMLElement | null => {
      for (let e = el as HTMLElement | null; e && e !== document.body; e = e.parentElement) {
        if (e.scrollWidth > e.clientWidth + 2) {
          const ox = getComputedStyle(e).overflowX;
          if (ox === 'auto' || ox === 'scroll') return e;
        }
      }
      return null;
    };
    const anDerReihe = () => vollbild || !!document.fullscreenElement;
    const beginn = (e: TouchEvent) => {
      if (!anDerReihe() || e.touches.length !== 1) { start = null; return; }
      const t = e.touches[0];
      const ziel = e.target as Element | null;
      if (ziel?.closest?.('input, textarea, select, .rein-rand, .bn-toolbar, .mantine-Popover-dropdown')) { start = null; return; }
      const roll = rollbarSeitlich(ziel);
      // Hineingezoomt (die Karte ist breiter als der Schirm) schiebt der Finger das Blatt — kein Blättern
      const karte = document.querySelector('.react-flow__node.pn-focused')?.getBoundingClientRect();
      if (karte && karte.width > window.innerWidth + 4) { start = null; return; }
      start = { x: t.clientX, y: t.clientY, t: performance.now(), roll, links: roll?.scrollLeft ?? 0, seite: !!ziel?.closest?.('.pdf-seite') };
    };
    const zug = (e: TouchEvent) => { if (start && e.touches.length > 1) start = null; };
    const ende = (e: TouchEvent) => {
      const s0 = start; start = null;
      if (!s0 || !anDerReihe()) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - s0.x; const dy = t.clientY - s0.y;
      if (performance.now() - s0.t > 650 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      if (s0.roll) {
        if (Math.abs(s0.roll.scrollLeft - s0.links) > 2) return;   // der Finger hat seitlich gerollt
        // Kann der Inhalt in Wischrichtung noch weiter, gehört der Wisch ihm — erst am Anschlag wird geblättert
        const max = s0.roll.scrollWidth - s0.roll.clientWidth;
        if (dx < 0 ? s0.roll.scrollLeft < max - 2 : s0.roll.scrollLeft > 2) return;
      }
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) return;
      const { step: schritt, dok: d, id } = wischRef.current;
      const vor = dx < 0;
      const nochSeiten = !!d && (vor ? d.seite < d.seiten : d.seite > 1);
      if (nochSeiten) {
        // Auf der Seite selbst blättert schon das Board (Board.tsx, M363) — daneben übernimmt dieser Wisch das Blättern
        if (!s0.seite && id) dokumentBefehl(id, vor ? 'vor' : 'zurueck');
        return;
      }
      schritt(vor ? 1 : -1);
    };
    // In der Capture-Phase: Die Board-Gesten (Rollen, Schwenken im Fokus) halten die Ereignisse sonst an
    window.addEventListener('touchstart', beginn, { passive: true, capture: true });
    window.addEventListener('touchmove', zug, { passive: true, capture: true });
    window.addEventListener('touchend', ende, { capture: true });
    return () => {
      window.removeEventListener('touchstart', beginn, true);
      window.removeEventListener('touchmove', zug, true);
      window.removeEventListener('touchend', ende, true);
    };
  }, [focusCard, vollbild]);
  const tool = useBoard((s) => s.tool);
  const setTool = useBoard((s) => s.setTool);
  // Der Kommentar-Modus lebt in der Karte — hier nur gespiegelt, damit der Knopf zeigt, dass er an ist
  const [pinAn, setPinAn] = useState(false);
  const [seitenEingabe, setSeitenEingabe] = useState('');
  // M413: Am Telefon ist die Fußleiste zu schmal für Seiten- UND Karten-Knöpfe (siehe unten)
  const [eng, setEng] = useState(() => window.matchMedia('(max-width: 560px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 560px)');
    const f = () => setEng(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  // M424: Darstellung im Fokus — gewählte Ansicht, aktuelle Stufe der Kamera, Menü offen?
  const [ansicht, setAnsicht] = useState<FokusAnsicht>(() => fokusAnsicht());
  const [zoom, setZoom] = useState(1);
  const [stufe, setStufe] = useState(1);
  const [ansichtMenu, setAnsichtMenu] = useState(false);
  const ansichtHuelle = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    // Die Meldung nennt das Ziel der Kamerafahrt; fährt die Kamera danach nach (Karte wächst, Rand klemmt), zählt
    // der tatsächliche Stand — er wird nach der Fahrt abgelesen
    let nach: ReturnType<typeof setTimeout> | undefined;
    const ist = () => { const m = /scale\(([\d.]+)\)/.exec((document.querySelector('.react-flow__viewport') as HTMLElement | null)?.style.transform ?? ''); if (m) setZoom(Number(m[1])); };
    const z = (e: Event) => {
      const d = (e as CustomEvent<{ zoom: number }>).detail;
      if (d && Number.isFinite(d.zoom)) setZoom(d.zoom);
      clearTimeout(nach); nach = setTimeout(ist, 700);
    };
    const a = () => { setAnsicht(fokusAnsicht()); setStufe(fokusStufe()); };
    window.addEventListener(FOKUS_ZOOM_EREIGNIS, z);
    window.addEventListener(FOKUS_ANSICHT_EREIGNIS, a);
    return () => { clearTimeout(nach); window.removeEventListener(FOKUS_ZOOM_EREIGNIS, z); window.removeEventListener(FOKUS_ANSICHT_EREIGNIS, a); };
  }, []);
  useEffect(() => { setStufe(1); setAnsichtMenu(false); }, [focusCard]);
  useEffect(() => {
    if (!ansichtMenu) return;
    const weg = (e: PointerEvent) => { if (!ansichtHuelle.current?.contains(e.target as Node)) setAnsichtMenu(false); };
    const taste = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setAnsichtMenu(false); } };
    window.addEventListener('pointerdown', weg, true);
    window.addEventListener('keydown', taste, true);
    return () => { window.removeEventListener('pointerdown', weg, true); window.removeEventListener('keydown', taste, true); };
  }, [ansichtMenu]);
  useEffect(() => {
    if (!focusCard) { setPinAn(false); return; }
    const t = setInterval(() => setPinAn(!!document.querySelector(`.react-flow__node[data-id="${focusCard}"] .pdf-seite.pin-modus`)), 250);
    return () => clearInterval(t);
  }, [focusCard]);

  if (!focusCard || !node) return null;
  const werkzeug = (t: Tool) => setTool(tool === t ? 'select' : t);

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
  const zeit = zeitVon(node);
  const vorige = folgeNachbar(siblings, board?.edges ?? [], node.id, false);
  const naechste = folgeNachbar(siblings, board?.edges ?? [], node.id, true);

  // M413: Die Seiten-Bausteine. Ab Tablet-Breite stehen sie als Gruppe in der Mitte; am Telefon stehen die beiden
  // Knöpfe außen in der Leiste (dort ist für zwei Paare kein Platz) und die Karten-Knöpfe im Kopf.
  const seiteZurueck = dok && (
    <button className="focus-seite-knopf" onClick={() => dokumentBefehl(node.id, 'zurueck')} aria-disabled={dok.seite <= 1} title="Vorherige Seite (oder über die Seite wischen)" aria-label="Vorherige Seite" data-taste="fokus-seite-zurueck">
      <IChevronL size={eng ? 18 : 15} />
    </button>
  );
  const seiteVor = dok && (
    <button className="focus-seite-knopf" onClick={() => dokumentBefehl(node.id, 'vor')} aria-disabled={dok.seite >= dok.seiten} title="Nächste Seite (oder über die Seite wischen)" aria-label="Nächste Seite" data-taste="fokus-seite-vor">
      <IChevronR size={eng ? 18 : 15} />
    </button>
  );
  // Seitenzahl zum Antippen: direkt zu einer Seite springen (das Feld auf der Karte ist am Telefon winzig)
  const seitenFeld = dok && (
    <label className="focus-seite" data-taste="fokus-seite">
      <input inputMode="numeric" aria-label={`Seite (${dok.seite} von ${dok.seiten})`} value={seitenEingabe || String(dok.seite)} data-taste="fokus-seite-nr"
        onFocus={(e) => { setSeitenEingabe(String(dok.seite)); e.currentTarget.select(); }}
        onChange={(e) => setSeitenEingabe(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={() => { const zu = parseInt(seitenEingabe, 10); setSeitenEingabe(''); if (zu) dokumentBefehl(node.id, 'gehe', Math.min(dok.seiten, Math.max(1, zu))); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      <span>/ {dok.seiten}</span>
    </label>
  );

  return (
    <>
      <ReinRand an={reinAnsicht.rein} onAus={reinAnsicht.aus} />
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
          <b translate="no">{cardTitle(node)}</b>
          <span>{typeName}{siblings.length > 1 ? ` · ${index + 1} von ${siblings.length}` : ''}{dok ? ` · Seite ${dok.seite} von ${dok.seiten}` : ''}{zeit !== undefined && (
            // M453: ruhig in der Unterzeile — wann die Karte zuletzt inhaltlich geändert wurde (Lage/Größe zählen nicht)
            <> · <time className="focus-zeit" dateTime={new Date(zeit).toISOString()} title={`Zuletzt geändert: ${zeitLang(zeit)}`}>{`Geändert ${vorWann(zeit)}`}</time></>
          )}{zeit === undefined && <span className="focus-zeit" title="Zuletzt geändert: unbekannt – die Karte stammt aus einem älteren Stand"> · Änderung unbekannt</span>}
          {/* M463: dezent – die Karte ist vom „Nach Themen ordnen" ausgenommen (Eigenschaft im ⋯) */}
          {node.ohneOrdnen && <span className="focus-zeit focus-ohne-ordnen" title="„Nach Themen ordnen“ lässt diese Karte liegen – ändern im ⋯ der Karte"> · ordnet nicht mit</span>}</span>
        </div>
        {/* M424: Darstellung wie in der Präsentation — ein kleines Symbol; wer die Stufe verstellt hat, sieht dort die Prozent */}
        <span className="focus-ansicht" ref={ansichtHuelle}>
          <button className={`focus-ansicht-knopf ${ansichtMenu ? 'an' : ''}`} data-taste="fokus-ansicht" aria-haspopup="menu" aria-expanded={ansichtMenu}
            title={`Darstellung: ${FOKUS_ANSICHTEN.find((x) => x.id === ansicht)?.name ?? ''} · ${Math.round(zoom * 100)} %`} aria-label="Darstellung der Karte"
            onClick={() => setAnsichtMenu((v) => !v)}>
            {stufe !== 1 || ansicht !== 'auto' ? <span translate="no">{Math.round(zoom * 100)} %</span> : <IFit size={16} />}
          </button>
          {ansichtMenu && (
            <div className="focus-ansicht-menu" role="menu" data-taste="fokus-ansicht-menu">
              <div className="focus-ansicht-stufe">
                <button data-taste="fokus-kleiner" aria-label="Verkleinern" title="Verkleinern" onClick={() => fokusStufeMal(1 / 1.25)}>−</button>
                <span translate="no" data-taste="fokus-stufe">{Math.round(zoom * 100)} %</span>
                <button data-taste="fokus-groesser" aria-label="Vergrößern" title="Vergrößern" onClick={() => fokusStufeMal(1.25)}>+</button>
              </div>
              {FOKUS_ANSICHTEN.map((a) => (
                <button key={a.id} role="menuitemradio" aria-checked={ansicht === a.id} className={ansicht === a.id ? 'an' : ''} data-taste="fokus-ansicht-wahl" data-ansicht={a.id} title={a.hinweis}
                  onClick={() => { fokusAnsichtSetzen(a.id); setAnsichtMenu(false); }}>
                  <span className="focus-ansicht-haken" aria-hidden="true">{ansicht === a.id && <ICheck size={14} />}</span>{a.name}
                </button>
              ))}
              <button className="rein-wahl" data-taste="fokus-rein-wahl" onClick={() => { setAnsichtMenu(false); reinAnsicht.umschalten(); }}>
                <span className="focus-ansicht-haken" aria-hidden="true"><IMaximize size={14} /></span>Nur Inhalt<kbd>F</kbd>
              </button>
            </div>
          )}
        </span>
        <button className="focus-rein-knopf" data-taste="fokus-rein" onClick={reinAnsicht.umschalten}
          title="Nur Inhalt – Vollbild ohne Bedienung (F)" aria-label="Nur Inhalt (Vollbild ohne Bedienung)">
          <IMaximize size={16} />
        </button>
        {/* M413: Am Telefon ist unten kein Platz für Seiten UND Karten. Bei einem Dokument blättern die Knöpfe unten
            dort weiter die Seiten (hineingezoomt schiebt der Finger das Blatt – ohne sie käme man nicht weiter);
            zur nächsten Karte führen diese beiden hier oben. Ab Tablet-Breite steht alles unten. */}
        {eng && dok && siblings.length > 1 && vorige && naechste && (
          <span className="focus-kopf-karten" role="group" aria-label="Karten">
            <button onClick={() => step(-1)} title={`Vorige Karte: ${cardTitle(vorige.karte)} (Alt+↑)`} aria-label="Vorige Karte" data-taste="fokus-kopf-karte-zurueck"><IChevronL size={18} /></button>
            <button onClick={() => step(1)} title={`Nächste Karte: ${cardTitle(naechste.karte)} (Alt+↓)`} aria-label="Nächste Karte" data-taste="fokus-kopf-karte-vor"><IChevronR size={18} /></button>
          </span>
        )}
      </div>
      <div className={`focus-nav ${dok ? 'dokument' : ''}`} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {/* M413: Außen steht IMMER die Karte – bei jedem Kartentyp an derselben Stelle. Die Seiten eines Dokuments
            blättert die Gruppe um die Seitenzahl (und ein Wisch über die Seite). Vorher blätterten diese Knöpfe bei
            einem Dokument dessen Seiten, und zur nächsten Karte führte dort kein Knopf. */}
        {eng && dok ? seiteZurueck : siblings.length > 1 && vorige ? (
          <button className="focus-karte" onClick={() => step(-1)} title={`Vorige Karte: ${cardTitle(vorige.karte)} (Alt+↑)`} aria-label="Vorige Karte" data-taste="fokus-karte-zurueck">
            <IChevronL size={18} />
          </button>
        ) : <span className="focus-nav-gap" />}
        {/* M214: Was in der Mitte steht, hängt am Modultyp — beim Planer ein
            Block, beim Kanban ein Ticket, bei der Notiz das Textformat. Alles,
            was NICHT zum Modul gehört (Verbinden, Anordnen, Archivieren),
            bleibt bewusst draußen: Das sind Board-Tätigkeiten. */}
        <div className="focus-acts">
          {dok && (
            <>
              {/* Seitenzahl zum Antippen: direkt zu einer Seite springen (das Feld auf der Karte ist am Telefon winzig) */}
              {eng ? seitenFeld : <span className="focus-seiten" role="group" aria-label="Seiten">{seiteZurueck}{seitenFeld}{seiteVor}</span>}
              <button className={`focus-werkzeug ${tool === 'pen' ? 'on' : ''}`} onClick={() => werkzeug('pen')} aria-pressed={tool === 'pen'} title="Stift – auf die Seite schreiben" aria-label="Stift" data-taste="fokus-stift"><IPen size={18} /></button>
              <button className={`focus-werkzeug ${tool === 'marker' ? 'on' : ''}`} onClick={() => werkzeug('marker')} aria-pressed={tool === 'marker'} title="Textmarker" aria-label="Textmarker" data-taste="fokus-marker"><IHighlighter size={18} /></button>
              <button className={`focus-werkzeug ${tool === 'eraser' ? 'on' : ''}`} onClick={() => werkzeug('eraser')} aria-pressed={tool === 'eraser'} title="Radierer" aria-label="Radierer" data-taste="fokus-radierer"><IEraser size={18} /></button>
              <button className={`focus-werkzeug ${pinAn ? 'on' : ''}`} onClick={() => { setTool('select'); dokumentBefehl(node.id, 'pin'); }} aria-pressed={pinAn}
                title="Kommentar an eine Stelle – danach auf die Stelle tippen" aria-label="Kommentar an eine Stelle" data-taste="fokus-kommentar"><IComment size={18} /></button>
            </>
          )}
          {/* M228: Die Brücke zum Vortrag. Fokus und Präsentation sind bewusst
              NICHT derselbe Modus — der eine ist zum Arbeiten, der andere zum
              Zeigen (feste Folienfolge, keine Werkzeuge, Beamer-tauglich).
              Damit man trotzdem nicht sucht, führt von hier ein Weg dorthin,
              und zwar ab GENAU dieser Karte. */}
          <button
            className={`focus-act ${dok ? 'nur-zeichen' : ''}`}
            aria-label="Ab dieser Karte präsentieren"
            title="Ab dieser Karte präsentieren – Vollbild, Folienfolge aus den Verbindungen"
            onClick={() => {
              const st = useBoard.getState();
              st.setPresentFrom(node.id);
              setFocusCard(null);
              st.setPresenting(true);
            }}
          >
            <IPlay size={dok ? 16 : 12} /> {dok ? null : 'Präsentieren'}
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
        {eng && dok ? seiteVor : siblings.length > 1 && naechste ? (
          <button className="focus-karte" onClick={() => step(1)} title={`Nächste Karte: ${cardTitle(naechste.karte)} (Alt+↓)`} aria-label="Nächste Karte" data-taste="fokus-karte-vor">
            <IChevronR size={18} />
          </button>
        ) : <span className="focus-nav-gap" />}
      </div>
    </>
  );
}
