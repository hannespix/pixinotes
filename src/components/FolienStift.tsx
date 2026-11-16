// M394: Stift, Textmarker und Radierer in der Präsentation.
//
// Während der Präsentation gibt es das Board nicht (es ist ausgehängt) — und damit auch nicht seine Zeichenebene.
// Diese Schicht liegt als Geschwister über der Folie (wie der Laser) und misst sich an ihr aus:
//
//   · Dokument-Folie (PDF, Word): Gezeichnet wird in SEITENPUNKTEN, genau wie auf der aufgeklappten Karte. Die
//     Striche sind gewöhnliche Seiten-Anmerkungen — sie stehen danach auch auf dem Board an der Seite, und die
//     Folie malt sie selbst (DokumentFolie). Hier entstehen nur der laufende Strich und die Eingabe.
//   · Jede andere Folie (Notiz, Modul, Bild, Tool): Die Folie setzt den Inhalt anders um als die Karte (breiter,
//     größere Schrift) — eine Stelle auf der Folie hat auf der Karte kein Gegenstück. Solche Striche gehören der
//     FOLIE: Sie hängen an der Karte (`anchor`), tragen die Seite FOLIEN_SEITE und liegen in Tausendsteln der
//     Inhaltsbreite. Das Board zeigt sie nicht (eine „Seite −1" ist nie offen), sie kommen aber mit dem Board
//     überall an — beim Team, beim nächsten Vortrag.
//
// Alle Maße sind Verhältnisse (Zeiger zu Fläche): Anzeigegröße, Zoom der Seite und Rollstand rechnen sich heraus.
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { FOLIEN_SEITE, selectActiveBoard, useBoard, type Stroke } from '../store';
import { uid } from '../types';
import { finalizeStroke } from '../lib/strokeShapes';
import { seitenKommentare } from '../lib/pdfSeiten';
import { wurzelZoom } from '../lib/anzeige';
import { MarkerGruppen, StrichPfad } from './StrichPfad';
import { FOLIE_ZOOM, type FolieZoom, type FolienWerkzeug } from '../lib/folienWerkzeug';

/** Die Inhaltsbreite einer Folie in Einheiten der Folien-Striche */
const EINHEIT = 1000;
/** Strichstärken in Schirmpunkten */
const DICKE = { pen: 3.2, marker: 18 };
const RADIUS = 11;
const STIFT_KEY = 'pixinotes-stift';

interface Lage {
  /** Kasten der Folie in der Bühne (Layout-Punkte) */
  left: number; top: number; width: number; height: number;
  /** Größe der Folie in Schirmpunkten — das Koordinatensystem der Schicht */
  w: number; h: number;
  /** Ecke der Zeichenfläche in der Schicht (Rollstand schon abgezogen) und Schirmpunkte je Einheit */
  fx: number; fy: number; k: number;
  /** Sichtbarer Kasten der Fläche, wenn sie in sich rollt (dann wird darauf beschnitten) */
  clip: { x: number; y: number; w: number; h: number } | null;
  seite: number;
  /** Seitenmaß (nur Dokument) */
  mass: { b: number; h: number } | null;
}

function messen(): { lage: Lage; flaeche: HTMLElement; blatt: HTMLElement } | null {
  const buehne = document.querySelector('.presenter') as HTMLElement | null;
  const blatt = buehne?.querySelector('.presenter-slide') as HTMLElement | null;
  if (!buehne || !blatt) return null;
  const dok = blatt.querySelector('.folie-dok') as HTMLElement | null;
  const blattSeite = blatt.querySelector('.folie-dok-seite') as HTMLElement | null;
  const massRoh = blattSeite?.dataset.mass?.split(' ').map(Number);
  const istSeite = !!dok && dok.dataset.art !== 'bild' && !!massRoh && massRoh[0] > 0 && massRoh[1] > 0;
  const flaeche = blattSeite ?? (blatt.firstElementChild as HTMLElement | null) ?? blatt;
  const B = buehne.getBoundingClientRect(); const b = blatt.getBoundingClientRect(); const f = flaeche.getBoundingClientRect();
  if (b.width < 8 || f.width < 8) return null;
  const z = wurzelZoom();
  // Schirmpunkte je Layout-Punkt der Fläche (Anzeigegröße) — der Rollstand zählt in Layout-Punkten
  const jeLayout = flaeche.offsetWidth ? f.width / flaeche.offsetWidth : 1;
  const rolltInnen = flaeche !== blatt && flaeche.scrollHeight > flaeche.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(flaeche).overflowY);
  const roll = (rolltInnen || flaeche === blatt ? flaeche.scrollTop : 0) * jeLayout;
  const rollX = (rolltInnen || flaeche === blatt ? flaeche.scrollLeft : 0) * jeLayout;
  const einheit = istSeite ? massRoh![0] : EINHEIT;
  const breite = flaeche === blatt ? flaeche.scrollWidth * jeLayout : f.width;
  const lage: Lage = {
    left: (b.left - B.left) / z, top: (b.top - B.top) / z, width: b.width / z, height: b.height / z,
    w: b.width, h: b.height,
    fx: f.left - b.left - rollX, fy: f.top - b.top - roll, k: breite / einheit,
    clip: rolltInnen ? { x: f.left - b.left, y: f.top - b.top, w: f.width, h: f.height } : null,
    seite: istSeite ? Number(dok!.dataset.seite) || 1 : FOLIEN_SEITE,
    mass: istSeite ? { b: massRoh![0], h: massRoh![1] } : null,
  };
  return { lage, flaeche, blatt };
}
const gleich = (a: Lage | null, b: Lage | null) => !!a && !!b
  && Math.abs(a.left - b.left) < 0.3 && Math.abs(a.top - b.top) < 0.3 && Math.abs(a.w - b.w) < 0.3 && Math.abs(a.h - b.h) < 0.3
  && Math.abs(a.fx - b.fx) < 0.3 && Math.abs(a.fy - b.fy) < 0.3 && Math.abs(a.k - b.k) < 0.0005 && a.seite === b.seite
  && (a.clip?.y ?? 0) === (b.clip?.y ?? 0) && (a.clip?.h ?? 0) === (b.clip?.h ?? 0) && (a.clip?.x ?? 0) === (b.clip?.x ?? 0) && (a.clip?.w ?? 0) === (b.clip?.w ?? 0);

/** Trifft der Radierer (Kreis um x/y, Einheiten des Strichs) diesen Strich? */
function trifft(s: Stroke, x: number, y: number, r: number): boolean {
  const rr = r + s.width / 2;
  const p = s.points;
  if (p.length === 1) return Math.hypot(p[0][0] - x, p[0][1] - y) < rr;
  for (let i = 1; i < p.length; i++) {
    const [ax, ay] = p[i - 1]; const [bx, by] = p[i];
    const dx = bx - ax; const dy = by - ay; const l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0;
    if (Math.hypot(ax + t * dx - x, ay + t * dy - y) < rr) return true;
  }
  return false;
}

export function FolienStift({ folie, werkzeug, farbe, darf, onPin, onWisch }: {
  /** Karte der Folie */
  folie: string;
  werkzeug: FolienWerkzeug | null;
  farbe: string;
  /** false: nur ansehen (Board „nur lesen") */
  darf: boolean;
  /** Tipp auf einen Kommentar-Pin der Seite */
  onPin: (threadId: string) => void;
  /** M396: schneller Wisch zur Seite mit einem Finger (Stiftgeräte) — blättern: +1 weiter, −1 zurück */
  onWisch?: (richtung: 1 | -1) => void;
}) {
  const drawings = useBoard((s) => selectActiveBoard(s).drawings);
  const comments = useBoard((s) => selectActiveBoard(s).comments);
  const addStrokeFertig = useBoard((s) => s.addStrokeFertig);
  const eraseStrokesById = useBoard((s) => s.eraseStrokesById);
  const beginEraseGesture = useBoard((s) => s.beginEraseGesture);
  const [lage, setLage] = useState<Lage | null>(null);
  const lageRef = useRef<Lage | null>(null);
  const [laufend, setLaufend] = useState<Stroke | null>(null);
  const zug = useRef<{
    id: number; art: 'strich' | 'radieren' | 'schieben' | 'zwei'; tool: 'pen' | 'marker'; punkte: [number, number][]; druck: number[]; stift: boolean;
    x: number; y: number; x0: number; y0: number; t0: number; sl0: number;
  } | null>(null);
  /** M396: aufliegende Finger, die Mitte/der Abstand zweier Finger, und Berührungen während eines Stift-Zugs (Handballen) */
  const finger = useRef<Map<number, { x: number; y: number }>>(new Map());
  const zwei = useRef<{ mx: number; my: number; d: number } | null>(null);
  const stumm = useRef<Set<number>>(new Set());
  const bild = useRef(0);

  // Die Folie lebt: Sie rollt, zoomt, blättert, baut sich um. Statt jedem Auslöser nachzulaufen, wird je Bild
  // einmal gemessen (ein Rechteck lesen) — gesetzt wird nur, wenn sich etwas geändert hat.
  useEffect(() => {
    let lauf = 0;
    const takt = () => {
      const m = messen()?.lage ?? null;
      if (!(m === null && lageRef.current === null) && !gleich(m, lageRef.current)) { lageRef.current = m; setLage(m); }
      lauf = requestAnimationFrame(takt);
    };
    takt();
    return () => cancelAnimationFrame(lauf);
  }, []);
  // andere Folie, andere Seite: ein angefangener Strich gehört nicht dorthin
  useEffect(() => { zug.current = null; finger.current.clear(); zwei.current = null; stumm.current.clear(); delete document.body.dataset.stiftZug; setLaufend(null); }, [folie, lage?.seite, werkzeug]);
  useEffect(() => () => { delete document.body.dataset.stiftZug; }, []);

  const folienStriche = useMemo(
    () => (drawings ?? []).filter((s) => s.anchor === folie && s.seite === FOLIEN_SEITE),
    [drawings, folie],
  );
  const pins = useMemo(
    () => (lage?.mass ? seitenKommentare(comments, folie, lage.seite).filter((c) => c.px != null && c.py != null) : []),
    [comments, folie, lage?.mass, lage?.seite],
  );

  if (!lage) return null;
  const aktiv = !!werkzeug && darf;
  const seitenModus = lage.seite !== FOLIEN_SEITE;
  if (!aktiv && folienStriche.length === 0 && pins.length === 0) return null;

  /** Zeiger → Einheiten der Zeichenfläche */
  const ort = (e: { clientX: number; clientY: number }, el: Element): [number, number] => {
    const r = el.getBoundingClientRect(); const l = lageRef.current ?? lage;
    return [(e.clientX - r.left - l.fx) / l.k, (e.clientY - r.top - l.fy) / l.k];
  };
  const radieren = (x: number, y: number) => {
    const l = lageRef.current ?? lage;
    const r = RADIUS / l.k;
    const treffer = (useBoard.getState().boards.find((b) => b.id === useBoard.getState().activeId)?.drawings ?? [])
      .filter((s) => s.anchor === folie && s.seite === l.seite && trifft(s, x, y, r)).map((s) => s.id);
    if (treffer.length) eraseStrokesById(treffer);
  };
  const zeichnen = () => {
    const z = zug.current;
    if (!z || z.art !== 'strich') return;
    const l = lageRef.current ?? lage;
    setLaufend({ id: 'laufend', tool: z.tool, color: farbe, width: DICKE[z.tool] / l.k, points: z.punkte.slice(), druck: z.stift ? z.druck.slice() : undefined });
  };

  /** Was rollt, wenn die Folie geschoben wird: das Blatt des Dokuments, sonst die Fläche, die in sich rollt, sonst die Folie */
  const roller = (): HTMLElement | null => {
    const m = messen();
    return (m?.blatt.querySelector('.folie-dok-flaeche') as HTMLElement | null) ?? (m && m.flaeche.scrollHeight > m.flaeche.clientHeight + 2 ? m.flaeche : m?.blatt ?? null);
  };
  const mitteUndAbstand = () => {
    const [a, b] = Array.from(finger.current.values());
    return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.hypot(b.x - a.x, b.y - a.y) };
  };
  /** Ein Stift-Zug läuft: Die Tipp-Gesten (lib/tippGesten.ts) halten dann jede Berührung für die aufgelegte Hand */
  const stiftMelden = (an: boolean) => { if (an) document.body.dataset.stiftZug = '1'; else delete document.body.dataset.stiftZug; };
  const verwerfen = () => {
    if (bild.current) { cancelAnimationFrame(bild.current); bild.current = 0; }
    setLaufend(null);
  };

  const runter = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!aktiv || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const z0 = zug.current;
    if (e.pointerType === 'touch') {
      // M396: Der Stift schreibt gerade — das ist die aufgelegte Hand
      if (z0?.stift) { stumm.current.add(e.pointerId); return; }
      if (z0 && z0.art !== 'zwei' && !finger.current.has(z0.id)) return;          // die Maus zeichnet gerade
      finger.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* Zeiger schon fort — dann ohne Fang */ }
      e.preventDefault();
      if (finger.current.size >= 2) {
        // M396: zweiter Finger — ein eben begonnener Finger-Strich war keiner; ab jetzt schieben und kneifen zwei Finger
        verwerfen();
        zug.current = { id: -1, art: 'zwei', tool: 'pen', punkte: [], druck: [], stift: false, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), sl0: 0 };
        zwei.current = finger.current.size === 2 ? mitteUndAbstand() : null;
        return;
      }
    } else if (z0) {
      // Der Stift geht vor: Er übernimmt, auch wenn gerade ein Finger schiebt
      if (e.pointerType !== 'pen' || z0.stift) return;
      verwerfen(); finger.current.clear(); zwei.current = null; zug.current = null;
    }
    let hatStift = false;
    try { if (e.pointerType === 'pen') localStorage.setItem(STIFT_KEY, '1'); hatStift = !!localStorage.getItem(STIFT_KEY); } catch { /* dann zeichnet auch der Finger */ }
    const [x, y] = ort(e, e.currentTarget);
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* Zeiger schon fort — dann ohne Fang */ }
    e.preventDefault();
    const grund = { id: e.pointerId, tool: 'pen' as 'pen' | 'marker', punkte: [] as [number, number][], druck: [] as number[], stift: e.pointerType === 'pen', x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), sl0: 0 };
    // Auf Geräten mit Stift schreibt der Stift — der Finger schiebt die Folie (wie auf dem Board)
    if (e.pointerType === 'touch' && hatStift) { zug.current = { ...grund, art: 'schieben', sl0: roller()?.scrollLeft ?? 0 }; return; }
    if (e.pointerType === 'pen') stiftMelden(true);
    // Radierer — auch das Radier-Ende eines Stifts
    if (werkzeug === 'eraser' || (e.pointerType === 'pen' && (e.buttons & 32) !== 0)) {
      beginEraseGesture();
      zug.current = { ...grund, art: 'radieren' };
      radieren(x, y);
      return;
    }
    zug.current = { ...grund, art: 'strich', tool: werkzeug as 'pen' | 'marker', punkte: [[x, y]], druck: [e.pressure || 0.5] };
    zeichnen();
  };
  const bewegt = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') {
      if (stumm.current.has(e.pointerId)) return;
      const f = finger.current.get(e.pointerId);
      if (f) { f.x = e.clientX; f.y = e.clientY; }
    }
    const z = zug.current;
    if (!z) return;
    if (z.art === 'zwei') {
      // zwei Finger: die Folie folgt der Mitte; kneifen zoomt die Dokument-Seite um diese Mitte
      const alt = zwei.current;
      if (finger.current.size !== 2 || !alt) return;
      const neu = mitteUndAbstand();
      roller()?.scrollBy({ left: (alt.mx - neu.mx) / wurzelZoom(), top: (alt.my - neu.my) / wurzelZoom() });
      if (alt.d > 24 && neu.d > 24 && Math.abs(neu.d / alt.d - 1) > 0.004) {
        window.dispatchEvent(new CustomEvent<FolieZoom>(FOLIE_ZOOM, { detail: { faktor: neu.d / alt.d, x: neu.mx, y: neu.my } }));
        zwei.current = neu;
      } else zwei.current = { ...neu, d: alt.d };
      return;
    }
    if (z.id !== e.pointerId) return;
    if (z.art === 'schieben') {
      roller()?.scrollBy({ left: (z.x - e.clientX) / wurzelZoom(), top: (z.y - e.clientY) / wurzelZoom() });
      z.x = e.clientX; z.y = e.clientY;
      return;
    }
    const el = e.currentTarget;
    const roh = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [];
    for (const c of roh.length ? roh : [e.nativeEvent as PointerEvent]) {
      const [x, y] = ort(c, el);
      if (z.art === 'radieren') { radieren(x, y); continue; }
      const letzter = z.punkte[z.punkte.length - 1];
      if (Math.hypot(x - letzter[0], y - letzter[1]) * (lageRef.current ?? lage).k < 0.7) continue;
      z.punkte.push([x, y]); z.druck.push(c.pressure || 0.5);
    }
    if (z.art === 'strich' && !bild.current) bild.current = requestAnimationFrame(() => { bild.current = 0; zeichnen(); });
  };
  const hoch = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') {
      if (stumm.current.delete(e.pointerId)) return;
      finger.current.delete(e.pointerId);
    }
    const z = zug.current;
    if (!z) return;
    if (z.art === 'zwei') {
      // erst wenn alle Finger oben sind, ist die Geste vorbei — ein liegengebliebener Finger zeichnet nicht weiter
      zwei.current = null;
      if (finger.current.size === 0) zug.current = null;
      return;
    }
    if (z.id !== e.pointerId) return;
    zug.current = null;
    if (z.stift) stiftMelden(false);
    verwerfen();
    if (z.art === 'schieben') {
      // M396: ein schneller Wisch zur Seite blättert — wie ohne Stift (nicht, wenn das Blatt selbst seitlich gerollt ist)
      const dx = e.clientX - z.x0; const dy = e.clientY - z.y0;
      if (e.type !== 'pointercancel' && Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4 && performance.now() - z.t0 < 700
        && Math.abs((roller()?.scrollLeft ?? 0) - z.sl0) < 2) onWisch?.(dx < 0 ? 1 : -1);
      return;
    }
    if (z.art !== 'strich' || e.type === 'pointercancel') return;
    const l = lageRef.current ?? lage;
    // ein Tipp ist ein Punkt
    let punkte: [number, number][] = z.punkte.length === 1 ? [z.punkte[0], [z.punkte[0][0] + 0.4 / l.k, z.punkte[0][1]]] : z.punkte;
    let druck: number[] | undefined = z.stift && z.punkte.length > 1 ? z.druck : undefined;
    if (punkte.length > 2) {
      const glatt = finalizeStroke(punkte);
      if (glatt.length !== punkte.length) druck = undefined;
      punkte = glatt;
    }
    const rund = (n: number) => Math.round(n * 100) / 100;
    addStrokeFertig({
      id: uid(), tool: z.tool, color: farbe, width: rund(DICKE[z.tool] / l.k),
      points: punkte.map((p) => [rund(p[0]), rund(p[1])] as [number, number]),
      ...(druck ? { druck: druck.map((d) => Math.round(d * 100) / 100) } : {}),
      anchor: folie, seite: l.seite, seitenBreite: true,
    });
  };
  /** Das Rad rollt weiter die Folie — die Schicht liegt nur darüber */
  const rad = (e: ReactWheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) return;
    roller()?.scrollBy({ left: e.deltaX, top: e.deltaY });
  };

  const marker = folienStriche.filter((s) => s.tool === 'marker');
  const stifte = folienStriche.filter((s) => s.tool !== 'marker');
  return (
    <div
      className={`folien-stift${aktiv ? ` an ${werkzeug}` : ''}`} data-taste="folien-stift" data-werkzeug={aktiv ? werkzeug : undefined}
      data-seite={seitenModus ? lage.seite : undefined} data-striche={folienStriche.length}
      style={{ left: lage.left, top: lage.top, width: lage.width, height: lage.height }}
      onPointerDown={aktiv ? runter : undefined} onPointerMove={aktiv ? bewegt : undefined}
      onPointerUp={aktiv ? hoch : undefined} onPointerCancel={aktiv ? hoch : undefined} onWheel={aktiv ? rad : undefined}
    >
      <svg viewBox={`0 0 ${lage.w} ${lage.h}`} preserveAspectRatio="none" aria-hidden={pins.length === 0 || undefined}>
        {lage.clip && <clipPath id="folien-stift-clip"><rect x={lage.clip.x} y={lage.clip.y} width={lage.clip.w} height={lage.clip.h} /></clipPath>}
        <g clipPath={lage.clip ? 'url(#folien-stift-clip)' : undefined}>
          <g transform={`translate(${lage.fx},${lage.fy}) scale(${lage.k})`}>
            {!seitenModus && <MarkerGruppen eintraege={marker.map((s) => ({ s }))} />}
            {!seitenModus && stifte.map((s) => <StrichPfad key={s.id} s={s} />)}
            {laufend && <StrichPfad s={laufend} laufend />}
          </g>
        </g>
        {/* Kommentare der Seite: Pins an ihrer Stelle — ein Tipp öffnet das Gespräch */}
        {pins.map((c, i) => (
          <g key={c.id} className={`folien-pin${c.resolved ? ' erledigt' : ''}`} data-taste="folien-pin" role="button" tabIndex={0}
            aria-label={`Kommentar ${i + 1} öffnen`}
            transform={`translate(${lage.fx + c.px! * lage.k},${lage.fy + c.py! * lage.k})`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onPin(c.id); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onPin(c.id); } }}>
            <circle r={12 * wurzelZoom()} />
            <text textAnchor="middle" dominantBaseline="central" fontSize={12 * wurzelZoom()}>{i + 1}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
