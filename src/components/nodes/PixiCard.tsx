import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useBoard, useKarteFest } from '../../store';
import type { PixiNode } from '../../types';
import { ANSICHT, AUGEN, AUGEN_MITTE, MUNDFORMEN, PIXI_FARBEN, TEILE, VIEWBOX, pixiFarbe } from '../../lib/pixiBild';
import {
  BLICK_RUHE_NACH, PixiHirn, blickZu, istKitzeln, istKreisen, istPloetzlichNah, type Blick, type ZeigerPunkt,
} from '../../lib/pixiVerhalten';
import { zeigerAbonnieren } from '../../lib/pixiZeiger';
import { istHell } from '../../lib/lesbareSchrift';
import { CardShell } from './CardShell';
import { DragTitle } from './DragTitle';
import { IMond } from '../Icons';

/**
 * M501: Pixi, das Maskottchen, als Karte.
 *
 * „Es soll mit seinen Augen Maus/Touch verfolgen und lustige kleine abwechslungsreiche Animationen ausführen, dass es nie
 * langweilig wird es anzuschauen." Figur aus pix-el (lib/pixiBild.ts), Verhalten als Zustandsmaschine
 * (lib/pixiVerhalten.ts). Hier nur die Verbindung zum DOM:
 *  - React zeichnet das SVG EINMAL (alle Augen-, Mund-, Arm- und Effektformen liegen bereit). Was gerade gilt, steht als
 *    data-Attribut an der Wurzel (`data-anim`, `data-augen`, `data-mund`, `data-arme`, `data-effekt`); das Stylesheet
 *    blendet passend ein und spielt die Bewegung als CSS-Animation in Pixel-Schritten (`steps`). Kein Neuzeichnen
 *    durch React je Animation, kein Ein- oder Aushängen von Knoten (M491).
 *  - Der Blick: ein gemeinsamer Zeiger-Beobachter (lib/pixiZeiger.ts) ruft je Bild nach einer Bewegung; die Augen-Gruppe
 *    bekommt ein `transform`-Attribut, nur wenn es sich ändert.
 *  - Zeitgeber: genau ein setTimeout bis zum nächsten Wechsel. Außerhalb des Sichtfelds (IntersectionObserver) und bei
 *    verdecktem Tab steht alles (auch die CSS-Animationen, `data-ruht`).
 *  - „Bewegung reduzieren": nur Blinzeln und Blick, keine Sprünge, kein Einschlafen.
 */

interface Beleber {
  tippen: () => void;
  optionen: (schlafen: boolean) => void;
  weg: () => void;
}

function beleben(wurzel: HTMLElement, svg: SVGSVGElement, blickG: SVGGElement, schlafen: boolean): Beleber {
  const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let sichtbar = true;
  let timer = 0;
  let letzterZeiger = -Infinity;
  let ziel: Blick = { dx: 0, dy: 0 };
  let gesetzt = '';
  let gestenAb = 0;
  let ruheTimer = 0;
  const aktiv = () => sichtbar && !document.hidden;

  const blickSetzen = () => {
    const d = hirn.def;
    const eigen = d?.eigenerBlick;
    const b: Blick = hirn.schlaeft ? { dx: 0, dy: 0 }
      : eigen ? (eigen === true ? { dx: 0, dy: 0 } : eigen)
        : performance.now() - letzterZeiger > BLICK_RUHE_NACH ? hirn.ruheBlick : ziel;
    const s = `translate(${b.dx} ${b.dy})`;
    if (s !== gesetzt) { blickG.setAttribute('transform', s); gesetzt = s; }
  };

  const zeigen = () => {
    const d = hirn.def;
    const ds = wurzel.dataset;
    ds.anim = hirn.anim ?? '';
    ds.augen = d?.augen ?? 'offen';
    ds.mund = d?.mund ?? 'laecheln';
    ds.arme = d?.arme ?? '';
    ds.effekt = d?.effekt ?? '';
    ds.schlaf = hirn.schlaf;
    if (d && Number.isFinite(d.dauer)) wurzel.style.setProperty('--pixi-d', `${d.dauer}ms`);
    blickSetzen();
  };

  const hirn = new PixiHirn(() => performance.now(), Math.random, { reduziert: !!mq?.matches, schlafen }, zeigen);

  const plane = () => {
    window.clearTimeout(timer);
    timer = 0;
    if (!aktiv()) return;
    const ms = hirn.schritt();
    if (Number.isFinite(ms)) timer = window.setTimeout(plane, Math.max(30, ms));
  };

  /** Nach einer Weile ohne Zeiger schaut Pixi selbst irgendwohin (ruheBlick) */
  const ruhePlanen = () => {
    window.clearTimeout(ruheTimer);
    ruheTimer = window.setTimeout(() => { ruheTimer = 0; if (aktiv()) blickSetzen(); }, BLICK_RUHE_NACH + 50);
  };

  const rahmen = (punkte: readonly ZeigerPunkt[]) => {
    const p = punkte[punkte.length - 1];
    if (!p) return;
    const r = svg.getBoundingClientRect();
    if (!r.width) return;
    const s = r.width / ANSICHT.w;
    const mitte = { x: r.left + (AUGEN_MITTE.x - ANSICHT.x) * s, y: r.top + (AUGEN_MITTE.y - ANSICHT.y) * s };
    const groesse = 32 * s;
    const jetzt = performance.now();
    hirn.aktivitaet();
    letzterZeiger = jetzt;
    ruhePlanen();
    ziel = blickZu(p.x - mitte.x, p.y - mitte.y, groesse);
    let neu = false;
    if (Math.hypot(p.x - mitte.x, p.y - mitte.y) < groesse * 2.5) neu = hirn.nah();
    if (!neu && jetzt >= gestenAb) {
      const frisch = punkte.filter((q) => q.t >= gestenAb);
      const links = r.left + (0 - ANSICHT.x) * s; const oben = r.top + (0 - ANSICHT.y) * s;
      const drin = (q: ZeigerPunkt) => q.x >= links && q.x <= links + 32 * s && q.y >= oben && q.y <= oben + 30 * s;
      if (istPloetzlichNah(frisch, mitte, groesse)) neu = hirn.reaktion('erschrecken');
      else if (istKitzeln(frisch, drin, jetzt)) neu = hirn.reaktion('kichern');
      else if (istKreisen(frisch, mitte, groesse, jetzt)) neu = hirn.reaktion('schwindelig');
      if (neu) gestenAb = jetzt + (hirn.def?.dauer ?? 0);
    }
    if (neu) plane();
    else blickSetzen();
  };

  const abmelden = zeigerAbonnieren({ aktiv: () => aktiv(), rahmen });

  const sichtWechsel = () => {
    const ruht = !aktiv();
    if (ruht) {
      wurzel.dataset.ruht = '';
      window.clearTimeout(timer); timer = 0;
    } else {
      delete wurzel.dataset.ruht;
      hirn.aktivitaet();   // wer zurückkommt, findet keinen gähnenden Pixi vor, nur weil er weg war
      plane();
    }
  };
  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((e) => { sichtbar = e.some((x) => x.isIntersecting); sichtWechsel(); })
    : null;
  io?.observe(wurzel);
  document.addEventListener('visibilitychange', sichtWechsel);
  const bewegungWechsel = () => hirn.optionen({ ...hirn.opt, reduziert: !!mq?.matches });
  mq?.addEventListener?.('change', bewegungWechsel);

  zeigen();
  plane();

  return {
    tippen: () => {
      letzterZeiger = performance.now();
      hirn.tippen();
      gestenAb = performance.now() + (hirn.def?.dauer ?? 0);
      plane();
    },
    optionen: (schlafenNeu) => { hirn.optionen({ ...hirn.opt, schlafen: schlafenNeu }); plane(); },
    weg: () => {
      abmelden();
      io?.disconnect();
      document.removeEventListener('visibilitychange', sichtWechsel);
      mq?.removeEventListener?.('change', bewegungWechsel);
      window.clearTimeout(timer);
      window.clearTimeout(ruheTimer);
    },
  };
}

/** Die lebende Figur — auf dem Board und auf der Folie */
export function PixiFigur({ farbe, schlafen = true, name }: { farbe?: string; schlafen?: boolean; name?: string }) {
  const wurzel = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const blick = useRef<SVGGElement>(null);
  const beleber = useRef<Beleber | null>(null);
  const druck = useRef<{ x: number; y: number } | null>(null);
  const [px, setPx] = useState(0);

  useEffect(() => {
    if (!wurzel.current || !svg.current || !blick.current) return;
    const b = beleben(wurzel.current, svg.current, blick.current, schlafen);
    beleber.current = b;
    return () => { b.weg(); beleber.current = null; };
  }, []);
  useEffect(() => { beleber.current?.optionen(schlafen); }, [schlafen]);

  // Pixel-Raster: Die Figur steht in einem Vielfachen von 48 Bildschirm-Pixeln (ganze Pixel je Rasterpunkt)
  useLayoutEffect(() => {
    const el = wurzel.current;
    if (!el) return;
    const messen = () => {
      const m = Math.min(el.clientWidth, el.clientHeight);
      setPx(m >= ANSICHT.w ? Math.floor(m / ANSICHT.w) * ANSICHT.w : Math.max(0, m));
    };
    messen();
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(messen);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const f = pixiFarbe(farbe);
  const stil = (f ? { '--pixi-koerper': f, '--pixi-tinte': istHell(f) ? 'var(--pixi-tinte-auf-hell)' : 'var(--pixi-tinte-auf-dunkel)' } : undefined) as CSSProperties | undefined;
  const titel = name?.trim();

  return (
    <div
      ref={wurzel}
      className="pixi"
      style={stil}
      data-anim=""
      data-augen="offen"
      data-mund="laecheln"
      onPointerDown={(e) => { druck.current = { x: e.clientX, y: e.clientY }; }}
      onClick={(e) => {
        const d = druck.current;
        if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;   // war ein Ziehen, kein Tipp
        beleber.current?.tippen();
      }}
    >
      <svg
        ref={svg}
        className="pixi-svg"
        viewBox={VIEWBOX}
        width={px || undefined}
        height={px || undefined}
        shapeRendering="crispEdges"
        role="img"
        aria-label={titel ? `Pixi „${titel}“, das Maskottchen` : 'Pixi, das Maskottchen'}
      >
        <path className="pixi-schatten" d={TEILE.schatten} />
        <g className="pixi-koerper">
          <g className="pixi-arm pixi-arm-r">
            <path className="pixi-arm-a" d={TEILE.arme.rechtsSchraeg} />
            <path className="pixi-arm-b" d={TEILE.arme.rechtsGerade} />
            <path className="pixi-arm-c" d={TEILE.arme.rechtsUnten} />
          </g>
          <g className="pixi-arm pixi-arm-l">
            <path className="pixi-arm-a" d={TEILE.arme.linksSchraeg} />
            <path className="pixi-arm-b" d={TEILE.arme.linksGerade} />
            <path className="pixi-arm-c" d={TEILE.arme.linksUnten} />
          </g>
          <path className="pixi-fill" d={TEILE.fill} />
          <path className="pixi-ink" d={TEILE.kontur} />
          <path className="pixi-wangen" d={TEILE.wangen} />
          <path className="pixi-spitze" d={TEILE.spitze} />
          <g className="pixi-blick" ref={blick}>
            <g className="pixi-augen">
              <rect className="pixi-anker" x={8} y={10} width={16} height={4} fill="none" />
              {AUGEN.map((a) => <path key={a} className={`pixi-a pixi-a-${a}`} d={TEILE.augen[a]} />)}
              {Object.entries(TEILE.glanz).map(([a, d]) => <path key={a} className={`pixi-glanz pixi-g-${a}`} d={d} />)}
            </g>
          </g>
          {MUNDFORMEN.map((m) => <path key={m} className={`pixi-m pixi-m-${m}`} d={TEILE.muender[m]} />)}
        </g>
        <g className="pixi-effekte">
          {Object.entries(TEILE.effekte).map(([k, d]) => <path key={k} className={`pixi-e pixi-e-${k}`} d={d} />)}
        </g>
      </svg>
    </div>
  );
}

export function PixiCard({ id, data, selected }: NodeProps<PixiNode>) {
  const fest = useKarteFest((data as { von?: string }).von);
  const name = typeof data.name === 'string' ? data.name : '';
  const farbe = pixiFarbe(data.farbe);
  const schlafen = data.schlafen !== false;
  const setzen = (neu: Partial<PixiNode['data']>) => useBoard.getState().updateNodeData(id, neu);
  const unten = (
    <div className="pixi-unten">
      {(name || selected) && (
        <div className="meta pixi-name">
          <DragTitle className="pixi-titel" value={name} placeholder="Pixi benennen" onChange={(v) => setzen({ name: v.trim() || undefined })} />
        </div>
      )}
      {!fest && (
        <div className="pixi-tools nodrag" role="group" aria-label="Pixi einstellen">
          <button
            className={`pixi-farbe pixi-farbe-standard${!farbe ? ' gewaehlt' : ''}`}
            aria-pressed={!farbe}
            aria-label="Standardfarbe"
            title="Standardfarbe"
            onClick={(e) => { e.stopPropagation(); setzen({ farbe: undefined }); }}
          />
          {PIXI_FARBEN.map((c) => (
            <button
              key={c.hex}
              className={`pixi-farbe${farbe === c.hex ? ' gewaehlt' : ''}`}
              style={{ background: c.hex }}
              aria-pressed={farbe === c.hex}
              aria-label={c.name}
              title={c.name}
              onClick={(e) => { e.stopPropagation(); setzen({ farbe: c.hex }); }}
            />
          ))}
          <button
            className={`pixi-schlaf${schlafen ? ' gewaehlt' : ''}`}
            aria-pressed={schlafen}
            aria-label="Schlafen erlauben"
            title={schlafen ? 'Schläft nach langer Ruhe ein – klicken: bleibt immer wach' : 'Bleibt immer wach – klicken: darf nach langer Ruhe einschlafen'}
            onClick={(e) => { e.stopPropagation(); setzen({ schlafen: schlafen ? false : undefined }); }}
          ><IMond size={14} /></button>
        </div>
      )}
    </div>
  );
  return (
    <CardShell id={id} selected={selected} minWidth={48} minHeight={48} seitenverhaeltnis ruhig className="pixi-karte" aussen={unten}>
      <PixiFigur farbe={farbe} schlafen={schlafen} name={name} />
    </CardShell>
  );
}
