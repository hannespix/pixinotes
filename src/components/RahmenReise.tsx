// M514: Rahmen für Rahmen präsentieren — direkt auf dem Board.
//
// Die Kamera fährt auf der echten Fläche zum Rahmen und passt ihn bildschirmfüllend ein; die Oberfläche tritt zurück
// („Oberfläche ausblenden", M510 `lib/nurBoard.tsx`; dazu `html[data-rahmen-reise]`, 35-rahmen-reise.css), unten steht eine leise Leiste „‹ 3 / 8 Titel ›", die verblasst.
// Weiter geht es mit →, Leertaste, Bild↓ (Präsentations-Klicker), Wischen nach links (Finger, Trackpad) oder dem Knopf;
// zurück mit ←, Umschalt+Leertaste, Bild↑, Wischen nach rechts. Pos1/Ende springen zum ersten/letzten Rahmen, Esc
// beendet und stellt die Ansicht von vorher wieder her. Die Reihenfolge folgt den Rahmenpfeilen (lib/rahmenReise.ts).
//
// Die Karten bleiben echte Karten: Wer in eine Notiz tippt, eine Idee abstimmt oder einen Timer startet, bedient sie
// wie immer — Tasten in Feldern und im Text gehören dem Feld, nicht der Reise.
//
// Live (M367/M387): Wer vorführt, nimmt den Rahmen mit (lib/vorfuehren.ts `rahmenMelden`); wer folgt, reist mit
// (Vorfuehren.tsx). Beginnt die Reise auf dem eigenen Board, während andere dabei sind, führt sie von selbst vor —
// wie die Präsentation — und endet die Vorführung mit ihr.
//
// Leistung (M491): Die Leiste steht von Anfang an; während des Flugs ändert sich im DOM nichts außer der Kamera. Der
// Flug ist React Flows zeitbasierte Kamerafahrt (d3, ein Ziel je Schritt) — bei reduzierter Bewegung springt sie.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useReactFlow, useStore as useRfStore, type Viewport } from '@xyflow/react';
import { selectActiveBoard, useBoard } from '../store';
import { rahmenReise, rahmenReiseBeenden, reiseAbo, reiseLoesen, reiseRahmenSetzen, reiseStand } from '../lib/rahmenReise';
import { overlayOffen } from '../lib/overlay';
import { folgeIch, folgenSetzen, rahmenMelden, vorfuehrenMitVortrag, vortragZuEnde, werFuehrtVor } from '../lib/vorfuehren';
import { ich, liveVerbunden, teilnehmerVon } from '../lib/liveStand';
import { istNurBoard, nurBoardSetzen } from '../lib/nurBoard';
import type { AppNode } from '../types';
import { IChevronL, IChevronR, IX } from './Icons';

/** Platz über dem Rahmen für seinen Titel (die Titel-Leiste sitzt 30 Punkte über der Fläche, 30-zeichnen…css) */
const KOPF = 34;
/** Nach so langer Ruhe verblasst die Leiste */
const BLASS_NACH = 2500;
const ruhig = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const imFeld = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]');

export default function RahmenReise() {
  const stand = useSyncExternalStore(reiseAbo, reiseStand);
  const boardId = useBoard((s) => s.activeId);
  const nodes = useBoard((s) => selectActiveBoard(s).nodes);
  const edges = useBoard((s) => selectActiveBoard(s).edges);
  // Die Reihenfolge hängt nur an den Rahmen und den Verbindungen — nicht an jeder Karte, die sich bewegt
  const rahmenSchluessel = useMemo(() => nodes.filter((n) => n.type === 'frame' && !n.archived)
    .map((n) => `${n.id}:${Math.round(n.position.x)},${Math.round(n.position.y)},${n.width ?? n.measured?.width},${n.height ?? n.measured?.height}`).join('|'), [nodes]);
  const nodesRef = useRef(nodes); nodesRef.current = nodes;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reise = useMemo(() => rahmenReise(nodesRef.current, edges), [rahmenSchluessel, edges]);
  const rahmenId = stand?.rahmen ?? '';
  const idx = reise.findIndex((f) => f.id === rahmenId);
  const aktuell: AppNode | undefined = reise[idx];
  const { setViewport, getViewport, getInternalNode } = useReactFlow();
  const breite = useRfStore((s) => s.width);
  const hoehe = useRfStore((s) => s.height);
  const minZoom = useRfStore((s) => s.minZoom);
  const maxZoom = useRfStore((s) => s.maxZoom);

  /* ---------- Beginn und Ende: Oberfläche zurücktreten lassen, Ansicht von vorher merken ---------- */
  const vorher = useRef<Viewport | null>(null);
  const zurueck = useRef(true);
  useEffect(() => {
    vorher.current = getViewport();
    const st = useBoard.getState();
    // Eine offene Karte (Fokus) schließt; Auswahl weg — sonst stünden Griffe und Auswahl-Leiste im Bild
    if (st.focusCard) st.setFocusCard(null);
    const gewaehlt = selectActiveBoard(st).nodes.filter((n) => n.selected);
    if (gewaehlt.length) st.onNodesChange(gewaehlt.map((n) => ({ id: n.id, type: 'select' as const, selected: false })));
    (document.activeElement as HTMLElement | null)?.blur?.();
    document.documentElement.setAttribute('data-rahmen-reise', '');
    // Die Oberfläche tritt zurück wie bei „Oberfläche ausblenden" (M510) — war die schon an, bleibt sie es danach
    const nurVorher = istNurBoard();
    nurBoardSetzen(true);
    return () => {
      document.documentElement.removeAttribute('data-rahmen-reise');
      document.documentElement.removeAttribute('data-reise-flug');
      if (!nurVorher) nurBoardSetzen(false);
      // Erst wenn die Oberfläche wieder steht (die linke Spalte nimmt Platz, nurBoard gleicht die Kamera aus), zurück
      // zur Ansicht von vorher — sonst überschriebe der Ausgleich die Rückfahrt
      const v = vorher.current;
      if (zurueck.current && v) requestAnimationFrame(() => requestAnimationFrame(() => { void setViewport(v, { duration: ruhig() ? 0 : 420 }); }));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Eine Karte im Fokus beendet „Oberfläche ausblenden" (M510) — danach steht wieder der Rahmen da, ohne Oberfläche
  const fokus = useBoard((s) => s.focusCard);
  useEffect(() => { if (!fokus) nurBoardSetzen(true); }, [fokus]);
  // Anderes Board: Die Reise gehört zum Board, auf dem sie begann
  useEffect(() => {
    if (stand && stand.boardId !== boardId) { zurueck.current = false; rahmenReiseBeenden(); }
  }, [stand, boardId]);
  // Der Rahmen ist weg (gelöscht, archiviert): beim ersten weitermachen — ohne Rahmen endet die Reise
  useEffect(() => {
    if (!stand || idx >= 0) return;
    if (reise.length) reiseRahmenSetzen(reise[0].id); else rahmenReiseBeenden();
  }, [stand, idx, reise]);

  /* ---------- Kamera ---------- */
  const flug = useRef(0);
  const fliegen = useCallback((dauer?: number) => {
    const id = reiseStand()?.rahmen;
    const f = id ? getInternalNode(id) : undefined;
    if (!f || !(breite > 0) || !(hoehe > 0)) return;
    const w = f.measured?.width ?? f.width ?? 0; const h = f.measured?.height ?? f.height ?? 0;
    if (!(w > 0) || !(h > 0)) return;
    const pos = f.internals.positionAbsolute;
    const rand = Math.round(Math.max(12, Math.min(40, Math.min(breite, hoehe) * 0.03)));
    let zoom = Math.min((breite - 2 * rand) / w, (hoehe - 2 * rand) / (h + KOPF));
    zoom = Math.max(minZoom, Math.min(maxZoom, zoom));
    const x = (breite - w * zoom) / 2 - pos.x * zoom;
    const y = (hoehe - (h + KOPF) * zoom) / 2 - (pos.y - KOPF) * zoom;
    const v = getViewport();
    const ms = ruhig() ? 0 : dauer ?? Math.round(Math.min(900, 420 + 90 * Math.log2(1 + Math.hypot(x - v.x, y - v.y) / Math.max(breite, hoehe)) + 120 * Math.abs(Math.log2(zoom / v.zoom))));
    const nr = ++flug.current;
    if (ms > 0) document.documentElement.setAttribute('data-reise-flug', '');
    void Promise.resolve(setViewport({ x, y, zoom }, { duration: ms })).then(() => {
      if (nr === flug.current) document.documentElement.removeAttribute('data-reise-flug');
    });
  }, [getInternalNode, getViewport, setViewport, breite, hoehe, minZoom, maxZoom]);
  // Zum Rahmen fliegen, sobald er wechselt (der erste Flug wartet, bis die Oberfläche weg ist und die Fläche steht)
  const erster = useRef(true);
  useEffect(() => {
    if (!aktuell) return;
    if (!erster.current) { fliegen(); return; }
    erster.current = false;
    const offen = !!useBoard.getState().focusCard;
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => fliegen()); });
    // Kam die Reise aus dem Fokus einer Karte, fährt dessen Rückweg erst noch zurück
    const t = offen ? window.setTimeout(() => fliegen(), 480) : undefined;
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aktuell?.id]);
  // Fenster anders groß, Telefon gedreht, Rahmen größer gezogen: neu einpassen
  const massRahmen = aktuell ? `${aktuell.width ?? aktuell.measured?.width}x${aktuell.height ?? aktuell.measured?.height}` : '';
  const ersterMass = useRef(true);
  useEffect(() => {
    if (ersterMass.current) { ersterMass.current = false; return; }
    const t = window.setTimeout(() => fliegen(ruhig() ? 0 : 200), 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breite, hoehe, massRahmen]);

  /* ---------- Blättern ---------- */
  const schritt = useCallback((ziel: number | 'erster' | 'letzter') => {
    const r = reiseStand();
    if (!r || !reise.length) return;
    const i = reise.findIndex((f) => f.id === r.rahmen);
    const j = ziel === 'erster' ? 0 : ziel === 'letzter' ? reise.length - 1 : Math.max(0, Math.min(reise.length - 1, i + ziel));
    // Wer folgt und selbst blättert, löst sich und reist ab hier allein weiter
    if (r.gefolgt) { folgenSetzen(r.boardId, false); reiseLoesen(); }
    if (j === i) { fliegen(); return; }    // am Ende: nur zurechtrücken
    reiseRahmenSetzen(reise[j].id);
  }, [reise, fliegen]);
  const beenden = useCallback(() => { if (reiseStand()?.gefolgt) folgenSetzen(reiseStand()!.boardId, false); rahmenReiseBeenden(); }, []);

  // Tasten: in der Erfassungsphase, damit Board (Pfeile verschieben Karten, Pos1/Ende wählen) und Leertaste (Schwenken)
  // nicht mitreden — außer jemand tippt gerade, ein Fenster liegt darüber oder eine Karte ist im Fokus.
  useEffect(() => {
    const taste = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
      const st = useBoard.getState();
      if (st.focusCard || st.presenting || overlayOffen() || imFeld(e.target)) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('[role="menu"], [role="dialog"], .dock-menu, .sel-more-menu, .kontext-menue, .modal')) return;
      const knopf = !!t?.closest?.('button, a, [role="button"], summary');
      const k = e.key;
      let tun: (() => void) | null = null;
      if (k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && !e.shiftKey && !knopf)) tun = () => schritt(1);
      else if (k === 'ArrowLeft' || k === 'PageUp' || (k === ' ' && e.shiftKey && !knopf)) tun = () => schritt(-1);
      else if (k === 'Home') tun = () => schritt('erster');
      else if (k === 'End') tun = () => schritt('letzter');
      else if (k === 'Escape') tun = beenden;
      if (!tun) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (!e.repeat || k !== 'Escape') tun();
    };
    // Leertaste loslassen: React Flow hat das Schwenken (panActivationKeyCode) gar nicht erst begonnen — nichts zu tun
    window.addEventListener('keydown', taste, true);
    return () => window.removeEventListener('keydown', taste, true);
  }, [schritt, beenden]);

  // Wischen: Trackpad (waagerechtes Rad, zwei Finger) und Finger auf der Fläche
  useEffect(() => {
    let summe = 0; let zuletzt = 0; let sperre = 0;
    const rad = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.2) return;
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.('.react-flow') || imFeld(t)) return;
      // In einer Karte, die selbst waagerecht rollt (Kanban, Tabelle), gehört die Geste der Karte
      const karte = t.closest('.react-flow__node:not(.react-flow__node-frame)');
      if (karte && [...karte.querySelectorAll('*')].some((el) => el.scrollWidth > el.clientWidth + 2 && /(auto|scroll)/.test(getComputedStyle(el).overflowX))) return;
      e.preventDefault(); e.stopPropagation();
      const jetzt = performance.now();
      if (jetzt - zuletzt > 220) summe = 0;
      zuletzt = jetzt;
      if (jetzt < sperre) return;            // der Rest derselben Geste (Nachlauf des Trackpads)
      summe += e.deltaX;
      if (Math.abs(summe) > 70) { schritt(summe > 0 ? 1 : -1); summe = 0; sperre = jetzt + 650; }
    };
    let ab: { x: number; y: number; t: number; id: number } | null = null;
    const runter = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !e.isPrimary) { ab = null; return; }
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.('.react-flow') || imFeld(t) || t.closest('button, a, input')) { ab = null; return; }
      ab = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    };
    const hoch = (e: PointerEvent) => {
      const a = ab; ab = null;
      if (!a || a.id !== e.pointerId) return;
      const dx = e.clientX - a.x; const dy = e.clientY - a.y;
      if (performance.now() - a.t > 700 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      schritt(dx < 0 ? 1 : -1);
    };
    const weg = () => { ab = null; };
    window.addEventListener('wheel', rad, { capture: true, passive: false });
    window.addEventListener('pointerdown', runter, true);
    window.addEventListener('pointerup', hoch, true);
    window.addEventListener('pointercancel', weg, true);
    return () => {
      window.removeEventListener('wheel', rad, true);
      window.removeEventListener('pointerdown', runter, true);
      window.removeEventListener('pointerup', hoch, true);
      window.removeEventListener('pointercancel', weg, true);
    };
  }, [schritt]);

  /* ---------- Live: den Rahmen mitnehmen ---------- */
  const gefolgt = !!stand?.gefolgt;
  useEffect(() => {
    if (gefolgt) return;
    const b = selectActiveBoard(useBoard.getState());
    const teamDa = liveVerbunden(b.id) && teilnehmerVon(b.id).some((t) => t.id !== ich().id);
    // Wie die Präsentation (M387): auf dem eigenen Board, mit anderen dabei, führt die Reise von selbst vor
    if (teamDa && !b.geteiltVon && !werFuehrtVor(b.id) && !folgeIch(b.id)) vorfuehrenMitVortrag(b.id);
    return () => { rahmenMelden(b.id, null); vortragZuEnde(b.id); };
  }, [gefolgt]);
  useEffect(() => {
    if (!gefolgt && rahmenId) rahmenMelden(boardId, rahmenId);
  }, [gefolgt, rahmenId, boardId]);

  /* ---------- Leiste: steht, verblasst in Ruhe ---------- */
  const [blass, setBlass] = useState(false);
  useEffect(() => {
    let t = window.setTimeout(() => setBlass(true), BLASS_NACH);
    const wach = () => { setBlass(false); clearTimeout(t); t = window.setTimeout(() => setBlass(true), BLASS_NACH); };
    window.addEventListener('pointermove', wach, { passive: true });
    window.addEventListener('keydown', wach, true);
    return () => { clearTimeout(t); window.removeEventListener('pointermove', wach); window.removeEventListener('keydown', wach, true); };
  }, []);

  if (!stand || !aktuell) return null;
  const name = (aktuell.data as { name?: string }).name || 'Rahmen';
  return (
    <div className="rahmen-reise-leiste" role="toolbar" aria-label="Rahmen-Reise" data-blass={blass ? '' : undefined} data-taste="rahmen-reise">
      <button onClick={() => schritt(-1)} disabled={idx <= 0} aria-label="Vorheriger Rahmen" title="Vorheriger Rahmen (←)" data-taste="reise-zurueck"><IChevronL size={18} /></button>
      <span className="rr-zahl" aria-live="polite" data-taste="reise-zahl">{idx + 1} / {reise.length}</span>
      <span className="rr-titel" translate="no">{name}</span>
      <button onClick={() => schritt(1)} disabled={idx >= reise.length - 1} aria-label="Nächster Rahmen" title="Nächster Rahmen (→)" data-taste="reise-weiter"><IChevronR size={18} /></button>
      <button className="rr-ende" onClick={beenden} aria-label="Rahmen-Reise beenden" title="Beenden (Esc)" data-taste="reise-ende"><IX size={15} /></button>
    </div>
  );
}
