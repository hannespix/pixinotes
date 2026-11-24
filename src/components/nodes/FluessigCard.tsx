import { useEffect, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { selectActiveBoard, useBoard } from '../../store';
import { FLUESSIG_MAX, fluessigDaten, fluessigText, type FluessigData, type FluessigZaeh } from '../../lib/fluessigDaten';
import type { FluessigNode } from '../../types';
import { CardShell } from './CardShell';

/**
 * M500: Flüssige Schrift — ein kurzer Text als schwarze (im Dunkeln helle) Flüssigkeit. Die Engine ist Liquid Type
 * von Hannes Pix (github.com/hannespix/liquidtype), übernommen nach src/lib/fluessig/.
 *
 * Die Maus über der Karte schubst die Flüssigkeit und zieht sie über der Schrift wie ein Magnet an. Ist die Karte
 * markiert (oder im Fokus, auf der Folie), zieht ein Druck die Flüssigkeit mit, gedrückt halten lässt sie platzen,
 * sie findet wieder zusammen. Unmarkiert zieht ein Druck wie überall die Karte. Beim Erscheinen setzt sich die
 * Schrift aus Tropfen zusammen.
 *
 * M506: Ruhend liegt die Karte rahmenlos auf dem Board (nur die Flüssigkeit) und fängt Zeiger nur über der Schrift
 * (.fl-treffer, Lage meldet der Motor) — die leere Kartenfläche gehört dem Board. Markiert/im Fokus die ganze Karte.
 *
 * Leistung: Die Engine kommt per import() erst, wenn die Karte sichtbar wird; sie rechnet nur, solange sich etwas
 * bewegt, und schläft danach (lib/fluessig/motor.ts). Ohne WebGL2 steht der Text als normale Schrift da.
 * Bedienung (Text, Zähigkeit, Farbe, Lebendig) nur im Fokus (M421, Listen in 99-bedienung-im-fokus.css).
 */

type Motor = typeof import('../../lib/fluessig/motor');
type Flaeche = import('../../lib/fluessig/motor').Flaeche;

let motorLaden: Promise<Motor> | null = null;
const motorHolen = () => (motorLaden ??= import('../../lib/fluessig/motor'));

export function FluessigBuehne({ data, greifbar, aussehen }: { data: Partial<FluessigData>; greifbar: boolean; aussehen: string }) {
  const d = fluessigDaten(data);
  const huelle = useRef<HTMLDivElement>(null);
  const trefferRef = useRef<HTMLDivElement>(null);
  const flaecheRef = useRef<HTMLCanvasElement>(null);
  const motorFlaeche = useRef<Flaeche | null>(null);
  const [stand, setStand] = useState<'warten' | 'laeuft' | 'ersatz'>('warten');
  const einstellung = { text: d.text, zaeh: d.zaeh, lebendig: d.lebendig, aussehen: `${d.farbe}|${aussehen}` };
  const einstellungRef = useRef(einstellung);
  einstellungRef.current = einstellung;
  const greifbarRef = useRef(greifbar);
  greifbarRef.current = greifbar;

  // Engine erst holen, wenn die Karte zum ersten Mal ins Bild kommt
  useEffect(() => {
    const el = huelle.current, canvas = flaecheRef.current;
    if (!el || !canvas) return;
    let aus = false, ro: ResizeObserver | null = null;
    const starten = () => {
      motorHolen().then((m) => {
        if (aus) return;
        const f = m.flaecheAnlegen(canvas, einstellungRef.current, el);
        if (!f) { setStand('ersatz'); return; }
        motorFlaeche.current = f;
        // M506: Die Klickfläche der rahmenlosen Karte folgt der Schrift (direkt am DOM, kein Render je Abtastung)
        f.umrissMelden = (u) => {
          const t = trefferRef.current;
          if (!t) return;
          t.style.inset = u ? `${u.o * 100}% ${(1 - u.r) * 100}% ${(1 - u.u) * 100}% ${u.l * 100}%` : '';
          if (u) t.dataset.umriss = ''; else delete t.dataset.umriss;
        };
        f.greifbar = greifbarRef.current;
        setStand('laeuft');
        const melden = () => f.groesse(el.clientWidth, el.clientHeight);
        melden();
        ro = new ResizeObserver(melden);
        ro.observe(el);
      }).catch(() => { if (!aus) setStand('ersatz'); });
    };
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { io?.disconnect(); io = null; starten(); } });
      io.observe(el);
    } else starten();
    return () => { aus = true; io?.disconnect(); ro?.disconnect(); motorFlaeche.current?.abmelden(); motorFlaeche.current = null; };
  }, []);

  // Text und Optionen weiterreichen — beim Tippen kurz gesammelt (wie im Original: 130 ms)
  const schluessel = `${einstellung.text}\u0000${einstellung.zaeh}\u0000${einstellung.lebendig}\u0000${einstellung.aussehen}`;
  useEffect(() => {
    const t = setTimeout(() => motorFlaeche.current?.einstellen(einstellungRef.current), 130);
    return () => clearTimeout(t);
  }, [schluessel]);

  useEffect(() => { if (motorFlaeche.current) motorFlaeche.current.greifbar = greifbar; }, [greifbar]);

  return (
    <div ref={huelle} className="fl-buehne" data-stand={stand}>
      {/* M506: Ruhend liegt die Karte rahmenlos auf dem Board und greift nur hier (Schrift + Magnet-Rand); ohne
          Schrift, ohne WebGL2 oder bis die Engine da ist: die ganze Karte. Markiert gehört der Druck wieder der Fläche. */}
      <div ref={trefferRef} className="fl-treffer" aria-hidden="true" />
      <canvas
        ref={flaecheRef}
        className={`fl-flaeche${greifbar ? ' nodrag nopan' : ''}`}
        role="img"
        aria-label={d.text ? `Flüssige Schrift: ${d.text}` : 'Flüssige Schrift, leer'}
        hidden={stand === 'ersatz'}
      />
      {stand === 'ersatz' && (
        <div className="fl-ersatz">
          <div className="fl-ersatz-text" translate="no">{d.text}</div>
          <p className="fl-hinweis">Flüssig nur mit WebGL2 – hier als normale Schrift.</p>
        </div>
      )}
      {!d.text.trim() && stand !== 'ersatz' && <p className="fl-leer">Noch kein Text – im Fokus eintragen.</p>}
    </div>
  );
}

const ZAEH: Array<[FluessigZaeh, string]> = [['fluessig', 'Flüssig'], ['mittel', 'Mittel'], ['zaeh', 'Zäh']];

export function FluessigCard({ id, data, selected }: NodeProps<FluessigNode>) {
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const nurLesen = useBoard((s) => selectActiveBoard(s)?.geteiltRolle === 'lesen');
  const imFokus = useBoard((s) => s.focusCard === id);
  const schrift = useBoard((s) => selectActiveBoard(s)?.nodes.find((n) => n.id === id)?.font ?? '');
  const d = fluessigDaten(data);
  const patch = (p: Partial<FluessigData>) => updateNodeData(id, p);
  // Die Werkzeuge liegen UNTER der Karte (CardShell `aussen`), nicht auf der Flüssigkeit — sonst verdeckten sie die
  // Schrift, gerade wenn man mit ihr spielt. Im Karten-Fokus rücken sie per CSS in die Karte.
  const werkzeuge = nurLesen ? null : (
    <div className="fl-werkzeuge nodrag" role="group" aria-label="Flüssige Schrift einstellen">
      <input
        className="fl-text"
        value={data.text ?? ''}
        maxLength={FLUESSIG_MAX}
        placeholder="Text"
        aria-label="Text der flüssigen Schrift"
        spellCheck={false}
        onChange={(e) => patch({ text: fluessigText(e.target.value) })}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }}
      />
      <div className="fl-wahl" role="radiogroup" aria-label="Zähigkeit">
        {ZAEH.map(([k, name]) => (
          <button key={k} role="radio" aria-checked={d.zaeh === k} className={d.zaeh === k ? 'aktiv' : ''} onClick={() => patch({ zaeh: k === 'mittel' ? undefined : k })}>{name}</button>
        ))}
      </div>
      <button className={`fl-schalter${d.farbe === 'akzent' ? ' aktiv' : ''}`} aria-pressed={d.farbe === 'akzent'} title="Flüssigkeit in der Akzentfarbe statt in der Schriftfarbe" onClick={() => patch({ farbe: d.farbe === 'akzent' ? undefined : 'akzent' })}>Akzent</button>
      <button className={`fl-schalter${d.lebendig ? ' aktiv' : ''}`} aria-pressed={d.lebendig} title="Tropfen fallen, die Oberfläche bewegt sich von selbst – kostet Rechenzeit, solange die Karte zu sehen ist" onClick={() => patch({ lebendig: d.lebendig ? undefined : true })}>Lebendig</button>
    </div>
  );
  return (
    <CardShell id={id} selected={selected} minWidth={160} minHeight={90} ruhig className={`fluessig-card fl-farbe-${d.farbe}`} aussen={werkzeuge}>
      <FluessigBuehne data={data} greifbar={!!selected || imFokus} aussehen={schrift} />
    </CardShell>
  );
}
