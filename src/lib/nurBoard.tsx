// M510: „Oberfläche ausblenden" — nur das Board, für die Arbeit beim Teilen.
//
// Gewünscht: „Für die Sharing-Arbeit wäre manchmal praktisch, wenn man live das Board überträgt, aber das UI (Menüs,
// Rahmen mit Anfassern etc.) ausgeblendet werden kann – mit Shortcut oder einem dezenten Umschalter."
//
// Verwandt mit „Nur Inhalt" (M426, lib/reinAnsicht.tsx) — das gilt für Präsentation und Karten-Fokus und geht ins
// Vollbild. Hier bleibt man auf dem Board und arbeitet weiter: verschieben, zoomen, anklicken, schreiben. Nur sieht
// man (und wer den Bildschirm sieht) keine Leisten, Rahmen, Griffe, Anschlusspunkte, Modul-Knöpfe mehr.
//
// Ein Zustand, nur hier: Am Wurzelelement steht `data-nur-board`; das Stylesheet (styles/73-nur-board.css und der
// M421-Block in 99-bedienung-im-fokus.css) blendet damit aus. Kein Umbau des DOM — die Leisten bleiben eingehängt,
// das Umschalten kostet eine Stilrechnung, mehr nicht (M491). Der Zustand ist lokal: nicht im Speicher, nicht im
// Live-Kanal — Gäste sehen ihr Board wie immer. Nach dem Neuladen ist die Oberfläche wieder da.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useReactFlow } from '@xyflow/react';
import { overlayOffen } from './overlay';
import { taste } from './tasten';
import { IAppWindow } from '../components/Icons';

let an = false;
/** Wann eingeschaltet wurde — der Umschalter zeigt seine Beschriftung nur in den ersten Sekunden danach, auch wenn das
 *  Bauteil inzwischen neu eingehängt wurde (Import, neuer Board-Speicher) */
let seit = 0;
const hoerer = new Set<() => void>();
const melden = () => { for (const h of hoerer) h(); };

/** Ist „Oberfläche ausblenden" gerade an? */
export const istNurBoard = (): boolean => an;
/** Ein- oder ausschalten (Tastenkürzel, ⋯-Menü der Leiste, Suche, Umschalter in der Ecke) */
export function nurBoardSetzen(wert: boolean): void {
  if (an === wert) return;
  an = wert;
  if (wert) seit = Date.now();
  melden();
}
export const nurBoardUmschalten = (): void => nurBoardSetzen(!an);

function useNurBoard(): boolean {
  return useSyncExternalStore((h) => { hoerer.add(h); return () => { hoerer.delete(h); }; }, () => an);
}

function tippt(t: EventTarget | null): boolean {
  return t instanceof Element && !!t.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
}

/** Wie lange der Umschalter nach einer Bewegung stehen bleibt, bevor er verblasst */
const RUHE_MS = 1600;
/** So lange steht der Umschalter nach dem Einschalten mit Beschriftung da */
const EINFUEHRUNG_MS = 2600;

/**
 * Setzt die Markierung, hält das Board an seinem Platz, hört auf Esc und zeigt den dezenten Umschalter.
 * `moeglich`: Das Board ist zu sehen (keine Präsentation, kein Karten-Fokus, keine Aufgaben, keine Übersicht) —
 * sonst endet der Modus.
 */
export function NurBoard({ moeglich }: { moeglich: boolean }) {
  const aktiv = useNurBoard();
  const { getViewport, setViewport } = useReactFlow();
  const [da, setDa] = useState(false);
  const [lang, setLang] = useState(false);
  const uhr = useRef<number | undefined>(undefined);
  /** Ein Finger hat den Umschalter berührt, als er noch unsichtbar war: dieser Tipp zeigt ihn nur */
  const nurZeigen = useRef(false);

  useEffect(() => { if (!moeglich) nurBoardSetzen(false); }, [moeglich]);

  // Markierung — im Layout-Schritt, damit das Board an seiner Stelle bleibt: Die linke Spalte tritt zurück, die
  // Fläche wird breiter; ohne Ausgleich spränge alles um die Breite der Spalte nach links.
  useLayoutEffect(() => {
    const r = document.documentElement;
    // Steht die Markierung schon so (das Bauteil ist neu eingehängt worden, etwa nach einem Import), gibt es nichts
    // auszugleichen — sonst rückte das Board um die Breite der Spalte
    if (('nurBoard' in r.dataset) === aktiv) return;
    const wrap = () => document.querySelector('.board-wrap')?.getBoundingClientRect();
    const vorher = wrap();
    if (aktiv) r.dataset.nurBoard = ''; else delete r.dataset.nurBoard;
    const nachher = wrap();
    if (vorher && nachher) {
      const dx = vorher.left - nachher.left;
      const dy = vorher.top - nachher.top;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        const v = getViewport();
        void setViewport({ x: v.x + dx, y: v.y + dy, zoom: v.zoom });
      }
    }
    if (aktiv) {
      // Fokus aus Knöpfen der Leisten nehmen (die sind gleich weg) — in einer Notiz darf weitergeschrieben werden
      const f = document.activeElement as HTMLElement | null;
      if (f && !tippt(f) && f.closest('.topbar, .tabs, .dock, .sel-toolbar, .sel-toolbar-dock, .search-backdrop')) f.blur();
    }
  }, [aktiv, getViewport, setViewport]);
  // Kein Aufräumen beim Aushängen: Das Bauteil hängt immer in der App; wird es neu eingehängt (Import, neuer
  // Board-Speicher), gilt der Zustand weiter — ein Aufräumen nähme die Markierung weg, während der Schalter noch steht.

  // Esc beendet — außer beim Schreiben (dort führt Esc erst aus dem Text) und wenn ein Fenster offen ist
  useEffect(() => {
    if (!aktiv) return;
    const taste_ = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (tippt(e.target) || overlayOffen() || document.querySelector('[role="menu"]')) return;
      // M514: In der Rahmen-Reise beendet Esc die Reise (components/RahmenReise.tsx) — sie stellt den Modus danach zurück
      if (document.documentElement.hasAttribute('data-rahmen-reise')) return;
      e.preventDefault(); e.stopImmediatePropagation();
      nurBoardSetzen(false);
    };
    window.addEventListener('keydown', taste_, true);
    return () => window.removeEventListener('keydown', taste_, true);
  }, [aktiv]);

  // Der Umschalter: beim Einschalten kurz mit Beschriftung (so lernt man, wo er wohnt), danach nur bei Bewegung
  useEffect(() => {
    window.clearTimeout(uhr.current);
    if (!aktiv) { setDa(false); setLang(false); return; }
    const rest = EINFUEHRUNG_MS - (Date.now() - seit);
    if (rest > 0) {
      setDa(true); setLang(true);
      uhr.current = window.setTimeout(() => { setDa(false); setLang(false); }, rest);
    }
    const regt = (e: PointerEvent) => {
      // Ein Finger, der das Board verschiebt, soll den Knopf nicht jedes Mal aufblitzen lassen — Finger tippen in
      // die Ecke (siehe unten); die Maus zeigt ihn bei jeder Bewegung
      if (e.pointerType !== 'mouse') return;
      setDa(true);
      window.clearTimeout(uhr.current);
      uhr.current = window.setTimeout(() => { setDa(false); setLang(false); }, RUHE_MS);
    };
    window.addEventListener('pointermove', regt, { passive: true });
    return () => { window.removeEventListener('pointermove', regt); window.clearTimeout(uhr.current); };
  }, [aktiv]);

  if (!aktiv) return null;
  const kuerzel = taste('nurBoard');
  return (
    <div className="nur-board-ecke" data-taste="nur-board-ecke"
      onPointerDown={(e) => {
        // Finger: Der erste Tipp in die Ecke zeigt den Umschalter, erst der zweite schaltet
        nurZeigen.current = e.pointerType !== 'mouse' && !da;
        setDa(true);
        window.clearTimeout(uhr.current);
        uhr.current = window.setTimeout(() => { setDa(false); setLang(false); }, 3200);
      }}>
      <button
        className={`nur-board-knopf${da ? ' da' : ''}${lang ? ' lang' : ''}`}
        data-taste="nur-board-aus"
        onClick={() => { if (nurZeigen.current) { nurZeigen.current = false; return; } nurBoardSetzen(false); }}
        onFocus={() => setDa(true)}
        title={`Oberfläche einblenden (${kuerzel} oder Esc)`}
        aria-label="Oberfläche einblenden"
      >
        <IAppWindow size={16} />
        <span className="nur-board-text">Oberfläche einblenden <kbd>{kuerzel}</kbd></span>
      </button>
    </div>
  );
}
