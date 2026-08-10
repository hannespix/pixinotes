import { useEffect, useRef, useState } from 'react';
import { useBoard } from '../store';
import { wurzelZoom } from './anzeige';

/**
 * M243: Die Bearbeiten-Leiste an eine andere Stelle schieben — und dort lassen.
 *
 * Der Befund: „Der Platz des Bearbeiten-Menüs ist immer irgendwie überlagernd,
 * oft an unpassender Stelle." Das liegt in der Natur einer Leiste, die an der
 * Auswahl klebt: Über einer Karte am oberen Bildrand ist kein Platz, über einer
 * breiten Karte deckt sie den Inhalt zu, den man gerade bearbeitet. Eine
 * Automatik, die immer die richtige Ecke findet, gibt es nicht — die richtige
 * Ecke hängt davon ab, worauf gerade jemand schaut.
 *
 * Also: selbst hinschieben dürfen. Drei Entscheidungen dahinter:
 *
 *  1. Gemerkt wird ein VERSATZ, keine Bildschirmposition. „Ein Stück weiter
 *     oben rechts" lässt sich auf die nächste Karte übertragen, „bei 840/210"
 *     nicht. Genau danach war gefragt: „alle entsprechenden Menüs an denselben
 *     Fokus-Modulen an der selben gemerkten Position starten".
 *  2. Gezogen wird an einem sichtbaren Anfasser, nicht an der ganzen Leiste.
 *     Die Leiste besteht aus Knöpfen; wer sie irgendwo anfassen könnte, würde
 *     beim Zielen ständig aus Versehen etwas auslösen.
 *  3. Der Versatz wird beim Ziehen ins Fenster geklemmt. Eine Leiste, die man
 *     aus dem Bild schieben kann, wäre eine Falle — sie käme nie zurück.
 *     Doppelklick auf den Anfasser setzt außerdem alles zurück.
 */

const RAND = 6;              // Mindestabstand zum Fensterrand (Bildpunkte)
const SCHWELLE = 3;          // ab hier gilt es als Ziehen, nicht als Klick

export type LeistenOrt = 'board' | 'fokus';

/**
 * @param ort    getrennt gemerkt für Board und Fokus
 * @param leiste CSS-Wähler der Leiste, die der Anfasser bewegt. Bewusst ein
 *   Wähler statt eines `ref`: React Flows NodeToolbar reicht keinen ref durch,
 *   und ein zusätzlicher Hüll-Container zwischen Leiste und Knöpfen würde
 *   Hintergrund und Polsterung vom Inhalt trennen.
 */
export function useLeisteZiehen(ort: LeistenOrt, leiste: string) {
  const gemerkt = useBoard((s) => s.leisteVersatz[ort]);
  const setVersatz = useBoard((s) => s.setLeisteVersatz);
  const showToast = useBoard((s) => s.showToast);

  const zug = useRef<{
    id: number; sx: number; sy: number;
    start: { x: number; y: number };
    grenze: { minDx: number; maxDx: number; minDy: number; maxDy: number };
    bewegt: boolean;
  } | null>(null);
  // Während des Ziehens läuft der Wert lokal — jeder Pixel in den Store zu
  // schreiben würde die ganze Oberfläche pro Mausbewegung neu zeichnen
  // (und den Verlauf zumüllen). Erst beim Loslassen wird gemerkt.
  const [live, setLive] = useState<{ x: number; y: number } | null>(null);
  const versatz = live ?? gemerkt ?? { x: 0, y: 0 };

  /**
   * Sicherheitsnetz gegen mitgereiste Werte.
   *
   * Der Versatz wird synchronisiert. Wer die Leiste am 27-Zoll-Schirm weit
   * nach rechts schiebt, hätte sie am Telefon außerhalb des Bildes — und damit
   * keine Bearbeiten-Leiste mehr, ohne zu ahnen, warum.
   *
   * Ein fester Deckel (etwa „höchstens eine halbe Fensterbreite") hilft hier
   * nicht: Ob die Leiste aus dem Bild ragt, hängt nicht am Versatz allein,
   * sondern daran, wo die Karte gerade liegt. Also wird EINMAL nachgemessen,
   * sobald die Leiste im Layout steht, und der gemerkte Wert um genau den
   * Überstand zurückgenommen — nie über den Nullpunkt hinaus. Danach steht sie
   * im Bild, die Messung ergibt keinen Überstand mehr, und nichts schwingt.
   */
  const geprueft = useRef(false);
  useEffect(() => {
    if (geprueft.current) return;
    const id = requestAnimationFrame(() => {
      const bar = document.querySelector(leiste);
      if (!bar) return;                       // noch keine Auswahl — später erneut
      geprueft.current = true;
      const v = useBoard.getState().leisteVersatz[ort];
      if (!v || (v.x === 0 && v.y === 0)) return;
      const r = bar.getBoundingClientRect();
      const z = wurzelZoom();
      /** Wie weit muss die Kante geschoben werden, damit beide Ränder passen?
       *  Ragt sie links heraus, geht es nach rechts (positiv) — und umgekehrt. */
      const rein = (vorn: number, hinten: number, platz: number) =>
        (vorn < RAND ? RAND - vorn : hinten > platz - RAND ? platz - RAND - hinten : 0);
      const dx = rein(r.left, r.right, window.innerWidth) / z;
      const dy = rein(r.top, r.bottom, window.innerHeight) / z;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      setVersatz(ort, {
        x: Math.round(zumNull(v.x, dx)),
        y: Math.round(zumNull(v.y, dy)),
      });
    });
    return () => cancelAnimationFrame(id);
  });

  const anfasser = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const bar = (e.currentTarget as HTMLElement).closest(leiste);
      if (!bar) return;
      const r = bar.getBoundingClientRect();
      /**
       * Die Klemmgrenzen werden EINMAL beim Anfassen gerechnet, aus dem Rechteck
       * zu diesem Zeitpunkt. Fortlaufend nachmessen wäre falsch: Die Leiste
       * bewegt sich ja gerade, jede Messung enthielte den eigenen Versatz schon
       * und die Grenze liefe mit dem Finger davon.
       */
      zug.current = {
        id: e.pointerId,
        sx: e.clientX, sy: e.clientY,
        start: { x: versatz.x, y: versatz.y },
        grenze: {
          minDx: RAND - r.left, maxDx: window.innerWidth - RAND - r.right,
          minDy: RAND - r.top, maxDy: window.innerHeight - RAND - r.bottom,
        },
        bewegt: false,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    },
    onPointerMove: (e: React.PointerEvent) => {
      const z = zug.current;
      if (!z || z.id !== e.pointerId) return;
      const dx = klemme(e.clientX - z.sx, z.grenze.minDx, z.grenze.maxDx);
      const dy = klemme(e.clientY - z.sy, z.grenze.minDy, z.grenze.maxDy);
      if (!z.bewegt && Math.hypot(dx, dy) < SCHWELLE) return;
      z.bewegt = true;
      /**
       * Geteilt durch den Wurzel-Zoom (Anzeigegröße A− / A+, M224). Die
       * Zeigerkoordinaten sind Schirmpunkte, `translate` rechnet in
       * Layout-Punkten. Ohne die Division liefe die Leiste bei 175 % dem
       * Finger um drei Viertel voraus.
       */
      const z0 = wurzelZoom();
      setLive({ x: z.start.x + dx / z0, y: z.start.y + dy / z0 });
      e.preventDefault();
    },
    onPointerUp: (e: React.PointerEvent) => {
      const z = zug.current;
      if (!z || z.id !== e.pointerId) return;
      zug.current = null;
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* schon weg */ }
      setLive((l) => {
        if (l && z.bewegt) setVersatz(ort, { x: Math.round(l.x), y: Math.round(l.y) });
        return null;
      });
    },
    onPointerCancel: () => {
      zug.current = null;
      setLive(null);
    },
    onDoubleClick: (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setLive(null);
      setVersatz(ort, { x: 0, y: 0 });
      showToast('Leiste wieder an ihrem Standardplatz.');
    },
    // Der Anfasser ist ein Griff, kein Knopf: kein Text-Markieren beim Ziehen,
    // und Touch soll schieben statt die Seite zu scrollen.
    style: { touchAction: 'none' as const },
    title: 'Leiste verschieben — die Stelle wird gemerkt · Doppelklick setzt zurück',
    'aria-label': 'Leiste verschieben',
    'data-leiste-griff': ort,
  };

  const verschoben = Math.abs(versatz.x) > 1 || Math.abs(versatz.y) > 1;
  return { versatz, anfasser, verschoben, ziehtGerade: live !== null };
}

/** `v` um `weg` zurücknehmen, aber höchstens bis auf 0 */
function zumNull(v: number, weg: number) {
  const neu = v + weg;
  return v > 0 ? Math.max(0, neu) : v < 0 ? Math.min(0, neu) : 0;
}

function klemme(v: number, min: number, max: number) {
  // Bei sehr kleinen Fenstern kann max unter min rutschen — dann gewinnt min,
  // sonst spränge die Leiste beim Anfassen an eine unerwartete Stelle.
  return Math.max(min, Math.min(Math.max(min, max), v));
}
