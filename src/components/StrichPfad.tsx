// M339: Ein Strich als SVG-Pfad — gemeinsam für die Zeichenebene über dem Board und für
// Striche, die auf dem Text einer Notiz liegen und IN der Notiz gezeichnet werden.
import { memo } from 'react';
import { getStroke } from 'perfect-freehand';
import type { Stroke } from '../store';

export const PEN = { width: 2.5, opacity: 1 };
export const MARKER = { width: 16, opacity: 0.5 };

/**
 * M319: Strichkontur mit perfect-freehand — druckempfindlich, geglättet,
 * sauber verjüngt. `size` ist der Durchmesser bei mittlerem Druck; dünne
 * Stellen bei leichtem Druck, kräftige bei festem. Ohne Drucksensor (Maus,
 * Finger) simuliert die Geschwindigkeit den Druck: schnell = dünn.
 */
export function strichKontur(s: Stroke, laufend: boolean): string {
  const punkte = s.druck && s.druck.length === s.points.length
    ? s.points.map((p, i) => [p[0], p[1], s.druck![i]])
    : s.points.map((p) => [p[0], p[1], 0.5]);
  const kontur = getStroke(punkte, {
    size: s.width * 1.4,
    thinning: 0.55,
    smoothing: 0.55,
    streamline: 0.45,
    simulatePressure: !s.druck,
    start: { taper: 2, cap: true },
    end: { taper: s.points.length > 6 ? 8 : 0, cap: true },
    last: !laufend,
  });
  if (kontur.length === 0) return '';
  const d: string[] = ['M', kontur[0][0].toFixed(1), kontur[0][1].toFixed(1), 'Q'];
  for (let i = 0; i < kontur.length; i += 1) {
    const [x0, y0] = kontur[i];
    const [x1, y1] = kontur[(i + 1) % kontur.length];
    d.push(x0.toFixed(1), y0.toFixed(1), ((x0 + x1) / 2).toFixed(1), ((y0 + y1) / 2).toFixed(1));
  }
  d.push('Z');
  return d.join(' ');
}
/** Fertige Striche ändern sich nie — ihre Kontur wird einmal gerechnet */
const konturCache = new WeakMap<Stroke, string>();

export const konturFuer = (s: Stroke): string => {
  let k = konturCache.get(s);
  if (!k) { k = strichKontur(s, false); konturCache.set(s, k); }
  return k;
};

const toPath = (s: Stroke) =>
  s.points.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');

/**
 * Eingerastete Formen (Linie, Pfeil, Rechteck, Dreieck: wenige Punkte) und Textmarker bleiben
 * Linien — die Freihand-Kontur würde ihre Ecken runden. Alles andere ist eine gefüllte Kontur.
 */
export const StrichPfad = memo(function StrichPfad({ s, dx = 0, dy = 0, dim = false, laufend = false }: { s: Stroke; dx?: number; dy?: number; dim?: boolean; laufend?: boolean }) {
  const transform = dx || dy ? `translate(${dx},${dy})` : undefined;
  if (s.tool === 'marker' || s.points.length <= 6) {
    return (
      <path
        d={toPath(s)}
        transform={transform}
        fill="none"
        stroke={s.color}
        strokeWidth={s.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={(s.tool === 'marker' ? MARKER.opacity : PEN.opacity) * (dim ? 0.35 : 1)}
        // Multiply lässt den Text unter dem Marker durchscheinen — wie beim echten Leuchtstift
        style={s.tool === 'marker' ? { mixBlendMode: 'multiply' } : undefined}
      />
    );
  }
  return (
    <path
      className="strich"
      d={laufend ? strichKontur(s, true) : konturFuer(s)}
      transform={transform}
      fill={s.color}
      stroke="none"
      opacity={PEN.opacity * (dim ? 0.35 : 1)}
    />
  );
});
