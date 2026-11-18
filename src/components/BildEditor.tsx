// M395: Bild bearbeiten — zuschneiden, drehen, spiegeln, gerade richten, Helligkeit/Kontrast/Sättigung, verpixeln.
//
// Eine Fläche, eine Leiste. Der Zuschneiderahmen liegt von Anfang an auf dem Bild (das ist, was man am häufigsten
// will); alles andere sind einzelne Knöpfe. Gerechnet wird in lib/bildBearbeiten.ts — hier an einer kleinen
// Arbeitsfassung für die Vorschau, beim Bestätigen am Original.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  NEIGUNG_MAX, OHNE, alsDatei, ansichtWenden, ausgerichtetMasse, autoWerte, eckenInAnsicht, kastenNachQuelle, rechnen,
  schnittMitFormat, unveraendert, type BildSchritte, type Kasten,
} from '../lib/bildBearbeiten';
import { IDrehLinks, IDrehRechts, ISonne, ISpiegeln, IVerpixeln, IWand } from './Icons';

/** Kantenlänge der Arbeitsfassung (Vorschau) und Obergrenze des Ergebnisses */
const VORSCHAU = 1400;
const HOECHSTENS = 3200;
const MIN = 0.04;
const FORMATE: Array<{ name: string; f: number | null | 'original' }> = [
  { name: 'Frei', f: null }, { name: 'Original', f: 'original' }, { name: '1:1', f: 1 }, { name: '4:3', f: 4 / 3 }, { name: '16:9', f: 16 / 9 },
];
type Griff = 'n' | 's' | 'o' | 'w' | 'no' | 'nw' | 'so' | 'sw' | 'innen' | 'neu';
const klemme = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export interface BildErgebnis { blob: Blob; mime: string; breite: number; hoehe: number }

export function BildEditor({ quelle, name, mime, onFertig, onAbbruch }: {
  quelle: string;
  name: string;
  mime: string;
  onFertig: (e: BildErgebnis) => void | Promise<void>;
  onAbbruch: () => void;
}) {
  const [bild, setBild] = useState<HTMLImageElement | null>(null);
  const [kaputt, setKaputt] = useState(false);
  const [s, setS] = useState<BildSchritte>(OHNE);
  /** festes Seitenverhältnis des Ausschnitts (Breite : Höhe) — null = frei */
  const [format, setFormat] = useState<number | null>(null);
  const [modus, setModus] = useState<'schnitt' | 'pixel'>('schnitt');
  const [anpassenAuf, setAnpassenAuf] = useState(false);
  const [zieht, setZieht] = useState(false);
  const [entwurf, setEntwurf] = useState<Kasten | null>(null);     // Rechteck, das gerade zum Verpixeln gezogen wird
  const [arbeitet, setArbeitet] = useState(false);
  const [platz, setPlatz] = useState({ w: 0, h: 0 });
  const buehne = useRef<HTMLDivElement | null>(null);
  const blatt = useRef<HTMLDivElement | null>(null);
  const flaeche = useRef<HTMLCanvasElement | null>(null);
  const zug = useRef<{ id: number; griff: Griff; x: number; y: number; r: Kasten } | null>(null);
  const sRef = useRef(s); sRef.current = s;

  // Bild laden; für die Vorschau reicht eine kleine Arbeitsfassung
  useEffect(() => {
    let weg = false;
    const i = new Image();
    i.onload = () => { if (!weg) { if (i.naturalWidth > 0 && i.naturalHeight > 0) setBild(i); else setKaputt(true); } };
    i.onerror = () => { if (!weg) setKaputt(true); };
    i.src = quelle;
    return () => { weg = true; };
  }, [quelle]);
  const arbeit = useMemo(() => {
    if (!bild) return null;
    const k = Math.min(1, VORSCHAU / Math.max(bild.naturalWidth, bild.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bild.naturalWidth * k)); c.height = Math.max(1, Math.round(bild.naturalHeight * k));
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bild, 0, 0, c.width, c.height);
    return c;
  }, [bild]);
  const bw = bild?.naturalWidth ?? 1; const bh = bild?.naturalHeight ?? 1;
  const ansicht = ausgerichtetMasse(bw, bh, s);

  // Platz der Bühne
  useLayoutEffect(() => {
    const el = buehne.current;
    if (!el) return;
    const messen = () => setPlatz({ w: el.clientWidth, h: el.clientHeight });
    messen();
    const ro = new ResizeObserver(messen);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const mass = useMemo(() => {
    const pw = Math.max(40, platz.w - 32); const ph = Math.max(40, platz.h - 32);
    const k = Math.min(pw / ansicht.w, ph / ansicht.h);
    return { w: Math.max(20, Math.floor(ansicht.w * k)), h: Math.max(20, Math.floor(ansicht.h * k)) };
  }, [platz, ansicht.w, ansicht.h]);

  // Vorschau: das ausgerichtete, angepasste Bild OHNE Zuschnitt — der Rahmen liegt darüber
  useEffect(() => {
    if (!arbeit || !flaeche.current) return;
    const bildNr = requestAnimationFrame(() => {
      const c = rechnen(arbeit, arbeit.width, arbeit.height, s, VORSCHAU, false);
      const ziel = flaeche.current;
      if (!ziel) return;
      ziel.width = c.width; ziel.height = c.height;
      ziel.getContext('2d')!.drawImage(c, 0, 0);
    });
    return () => cancelAnimationFrame(bildNr);
    // der Ausschnitt ändert die Vorschau nicht
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arbeit, s.dreh, s.spiegel, s.neigung, s.pixel, s.hell, s.kontrast, s.saettigung]);

  const geaendert = !unveraendert(s);
  const fertig = useCallback(async () => {
    if (!bild || arbeitet) return;
    const jetzt = sRef.current;
    if (unveraendert(jetzt)) { onAbbruch(); return; }
    setArbeitet(true);
    try {
      // einen Moment Luft, damit „Wird gespeichert …" zu sehen ist, bevor die Rechnung den Faden belegt
      await new Promise((r) => setTimeout(r, 30));
      const c = rechnen(bild, bild.naturalWidth, bild.naturalHeight, jetzt, HOECHSTENS);
      const d = await alsDatei(c, mime);
      await onFertig({ blob: d.blob, mime: d.mime, breite: c.width, hoehe: c.height });
    } finally { setArbeitet(false); }
  }, [bild, arbeitet, mime, onFertig, onAbbruch]);

  // Tasten: als Erste (Fangphase) — Esc schließt nur den Editor, nicht auch den Karten-Fokus darunter
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const imFeld = e.target instanceof HTMLElement && e.target.matches('input, textarea, select');
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onAbbruch(); return; }
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); e.stopPropagation(); void fertig(); return; }
      if (e.key === 'Tab') return;
      if (!imFeld && (e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); wendeRef.current(e.shiftKey ? 'links' : 'rechts'); }
      // das Board darunter bekommt keine Tasten (Entf löschte sonst die Karte)
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onAbbruch, fertig]);

  /** Drehen/Spiegeln: das feste Format dreht mit (aus 4:3 wird 3:4) */
  const wende = (art: 'rechts' | 'links' | 'spiegeln') => {
    if (art !== 'spiegeln') setFormat((f) => (f ? 1 / f : f));
    setS((v) => ansichtWenden(v, art));
  };
  const wendeRef = useRef(wende); wendeRef.current = wende;

  /** Verhältnis des Ausschnitts in Bruchteilen der Ansicht (Breite/Höhe) */
  const bruch = (f: number) => (f * ansicht.h) / ansicht.w;
  const waehleFormat = (roh: number | null | 'original') => {
    if (roh === null) { setFormat(null); return; }
    let f = roh === 'original' ? ansicht.w / ansicht.h : roh;
    // der gewählte Knopf noch einmal: quer ↔ hoch
    if (format && Math.abs(format - f) < 0.01 && Math.abs(f - 1) > 0.01) f = 1 / f;
    else if (roh !== 'original' && roh !== 1 && s.schnitt.h * ansicht.h > s.schnitt.w * ansicht.w * 1.05) f = 1 / f;   // hochkant bleibt hochkant
    setFormat(f);
    setS((v) => ({ ...v, schnitt: schnittMitFormat(v.schnitt, f, ansicht) }));
  };
  const istGewaehlt = (roh: number | null | 'original') => {
    if (roh === null) return format === null;
    if (format === null) return false;
    const f = roh === 'original' ? ansicht.w / ansicht.h : roh;
    const original = Math.abs(format - ansicht.w / ansicht.h) < 0.01;
    if (roh === 'original') return original;
    return !original || roh === 1 ? Math.abs(format - f) < 0.01 || Math.abs(format - 1 / f) < 0.01 : false;
  };
  const beschriftung = (f0: { name: string; f: number | null | 'original' }) =>
    (typeof f0.f === 'number' && f0.f !== 1 && format && Math.abs(format - 1 / f0.f) < 0.01 ? f0.name.split(':').reverse().join(':') : f0.name);

  // ---------- Zeiger: Rahmen ziehen, verschieben, neu aufziehen; im Verpixel-Modus Rechtecke ----------
  const ort = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = blatt.current!.getBoundingClientRect();
    return [klemme((e.clientX - r.left) / r.width, 0, 1), klemme((e.clientY - r.top) / r.height, 0, 1)];
  };
  const runter = (e: ReactPointerEvent<HTMLElement>, griff: Griff) => {
    if (!bild || arbeitet || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault(); e.stopPropagation();
    const [x, y] = ort(e);
    if (modus === 'pixel') {
      // Tipp auf ein verpixeltes Rechteck nimmt es wieder weg
      const treffer = s.pixel.findIndex((p) => imVieleck([x, y], eckenInAnsicht(p, bw, bh, s)));
      if (treffer >= 0) { setS((v) => ({ ...v, pixel: v.pixel.filter((_, i) => i !== treffer) })); return; }
      zug.current = { id: e.pointerId, griff: 'neu', x, y, r: { x, y, w: 0, h: 0 } };
      setEntwurf({ x, y, w: 0, h: 0 });
    } else {
      zug.current = { id: e.pointerId, griff, x, y, r: griff === 'neu' ? { x, y, w: 0, h: 0 } : s.schnitt };
    }
    try { blatt.current?.setPointerCapture(e.pointerId); } catch { /* Zeiger schon fort */ }
    setZieht(true);
  };
  const bewegt = (e: ReactPointerEvent<HTMLElement>) => {
    const z = zug.current;
    if (!z || z.id !== e.pointerId) return;
    const [x, y] = ort(e);
    if (modus === 'pixel') { setEntwurf({ x: Math.min(z.x, x), y: Math.min(z.y, y), w: Math.abs(x - z.x), h: Math.abs(y - z.y) }); return; }
    const dx = x - z.x; const dy = y - z.y;
    const r0 = z.r;
    if (z.griff === 'innen') {
      setS((v) => ({ ...v, schnitt: { ...r0, x: klemme(r0.x + dx, 0, 1 - r0.w), y: klemme(r0.y + dy, 0, 1 - r0.h) } }));
      return;
    }
    const fr = format ? bruch(format) : 0;
    let neu: Kasten;
    if (z.griff === 'neu') {
      // frisch aufziehen: vom Startpunkt zur Zeigerstelle
      let w = Math.abs(dx); let h = Math.abs(dy);
      if (fr) { const maxW = dx >= 0 ? 1 - z.x : z.x; const maxH = dy >= 0 ? 1 - z.y : z.y; w = Math.min(Math.max(w, h * fr), maxW, maxH * fr); h = w / fr; }
      neu = { x: dx >= 0 ? z.x : z.x - w, y: dy >= 0 ? z.y : z.y - h, w, h };
      if (neu.w < MIN / 2 || neu.h < MIN / 2) return;     // erst ab einer Mindestgröße — ein Tipp daneben ändert nichts
    } else {
      const li = z.griff.includes('w'); const re = z.griff.includes('o'); const ob = z.griff.includes('n'); const un = z.griff.includes('s');
      let x0 = r0.x; let y0 = r0.y; let x1 = r0.x + r0.w; let y1 = r0.y + r0.h;
      if (li) x0 = klemme(x0 + dx, 0, x1 - MIN); if (re) x1 = klemme(x1 + dx, x0 + MIN, 1);
      if (ob) y0 = klemme(y0 + dy, 0, y1 - MIN); if (un) y1 = klemme(y1 + dy, y0 + MIN, 1);
      if (fr) {
        if ((li || re) && (ob || un)) {
          // Ecke: die gegenüberliegende Ecke steht fest
          const maxW = li ? x1 : 1 - x0; const maxH = ob ? y1 : 1 - y0;
          const w = Math.min(Math.max(x1 - x0, (y1 - y0) * fr), maxW, maxH * fr); const h = w / fr;
          if (li) x0 = x1 - w; else x1 = x0 + w;
          if (ob) y0 = y1 - h; else y1 = y0 + h;
        } else if (li || re) {
          // Seite: die Höhe folgt, um die Mitte
          const m = r0.y + r0.h / 2; const maxH = 2 * Math.min(m, 1 - m);
          const w = Math.min(x1 - x0, maxH * fr); const h = w / fr;
          if (li) x0 = x1 - w; else x1 = x0 + w;
          y0 = m - h / 2; y1 = m + h / 2;
        } else {
          const m = r0.x + r0.w / 2; const maxW = 2 * Math.min(m, 1 - m);
          const h = Math.min(y1 - y0, maxW / fr); const w = h * fr;
          if (ob) y0 = y1 - h; else y1 = y0 + h;
          x0 = m - w / 2; x1 = m + w / 2;
        }
      }
      neu = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    setS((v) => ({ ...v, schnitt: neu }));
  };
  const hoch = (e: ReactPointerEvent<HTMLElement>) => {
    const z = zug.current;
    if (!z || z.id !== e.pointerId) return;
    zug.current = null; setZieht(false);
    if (modus === 'pixel') {
      const r = entwurf; setEntwurf(null);
      if (r && r.w > 0.015 && r.h > 0.015 && e.type !== 'pointercancel') {
        const q = kastenNachQuelle(r, bw, bh, sRef.current);
        if (q.w > 0.004 && q.h > 0.004) setS((v) => ({ ...v, pixel: [...v.pixel, q] }));
      }
    }
  };

  const regler = (taste: string, etikett: string, wert: number, setze: (n: number) => void, min = -100, max = 100) => (
    <label className="be-regler">
      <span>{etikett}</span>
      <input type="range" min={min} max={max} step={1} value={wert} data-taste={taste} aria-label={etikett}
        onChange={(e) => setze(Number(e.target.value))} onDoubleClick={() => setze(0)} />
      <output>{wert > 0 ? `+${wert}` : wert}</output>
    </label>
  );
  const r = s.schnitt;
  const kErg = Math.min(1, HOECHSTENS / Math.max(ansicht.w, ansicht.h));
  const ergebnis = { w: Math.max(1, Math.round(r.w * ansicht.w * kErg)), h: Math.max(1, Math.round(r.h * ansicht.h * kErg)) };

  return createPortal(
    <div className={`bild-editor nodrag ${modus === 'pixel' ? 'pixel' : ''} ${zieht ? 'zieht' : ''}`} role="dialog" aria-modal="true" aria-label="Bild bearbeiten" data-taste="bild-editor">
      <div className="be-kopf">
        <button className="be-abbruch" data-taste="be-abbrechen" onClick={onAbbruch}>Abbrechen</button>
        <span className="be-titel"><b translate="no">{name}</b>{bild && <span className="be-masse" data-taste="be-masse">{ergebnis.w} × {ergebnis.h}</span>}</span>
        {geaendert && <button className="be-zurueck" data-taste="be-zuruecksetzen" onClick={() => { setS(OHNE); setFormat(null); }} title="Alle Änderungen verwerfen – das Bild wie zu Beginn">Zurücksetzen</button>}
        <button className="be-fertig" data-taste="be-fertig" disabled={!bild || arbeitet} onClick={() => void fertig()}>{arbeitet ? 'Wird gespeichert …' : 'Fertig'}</button>
      </div>
      <div className="be-buehne" ref={buehne}>
        {kaputt ? <p className="be-hinweis">Dieses Bild lässt sich hier nicht bearbeiten.</p> : !bild ? <p className="be-hinweis">Bild wird geladen …</p> : (
          <div className="be-blatt" ref={blatt} style={{ width: mass.w, height: mass.h }} data-taste="be-blatt"
            onPointerDown={(e) => runter(e, 'neu')} onPointerMove={bewegt} onPointerUp={hoch} onPointerCancel={hoch}>
            <canvas ref={flaeche} />
            <svg className="be-schicht" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
              {modus === 'schnitt' && <path className="be-dunkel" fillRule="evenodd" d={`M0 0H1V1H0Z M${r.x} ${r.y}V${r.y + r.h}H${r.x + r.w}V${r.y}Z`} />}
              {modus === 'pixel' && s.pixel.map((p, i) => <polygon key={i} className="be-pixel" data-taste="be-pixel" points={eckenInAnsicht(p, bw, bh, s).map((e) => e.join(',')).join(' ')} />)}
              {entwurf && <rect className="be-entwurf" x={entwurf.x} y={entwurf.y} width={entwurf.w} height={entwurf.h} />}
            </svg>
            {modus === 'schnitt' && (
              <div className="be-rahmen" data-taste="be-rahmen" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
                onPointerDown={(e) => runter(e, 'innen')}>
                <span className="be-drittel" aria-hidden="true" />
                {(['nw', 'n', 'no', 'o', 'so', 's', 'sw', 'w'] as Griff[]).map((g) => (
                  <span key={g} className={`be-griff ${g}`} data-griff={g} onPointerDown={(e) => runter(e, g)} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {anpassenAuf && (
        <div className="be-anpassen" data-taste="be-anpassen-feld">
          {regler('be-hell', 'Helligkeit', s.hell, (n) => setS((v) => ({ ...v, hell: n })))}
          {regler('be-kontrast', 'Kontrast', s.kontrast, (n) => setS((v) => ({ ...v, kontrast: n })))}
          {regler('be-saettigung', 'Sättigung', s.saettigung, (n) => setS((v) => ({ ...v, saettigung: n })))}
          <button className="be-auto" data-taste="be-auto" title="Helligkeit und Kontrast passend zum Bild wählen"
            onClick={() => { if (!arbeit) return; const a = autoWerte(rechnen(arbeit, arbeit.width, arbeit.height, { ...s, hell: 0, kontrast: 0, saettigung: 0 }, 480)); setS((v) => ({ ...v, ...a })); }}>
            <IWand size={15} /> Automatisch
          </button>
        </div>
      )}
      <div className="be-leiste" role="toolbar" aria-label="Bild bearbeiten">
        <span className="be-gruppe be-formate" role="group" aria-label="Seitenverhältnis des Ausschnitts">
          {FORMATE.map((f) => (
            <button key={f.name} className={istGewaehlt(f.f) ? 'an' : ''} aria-pressed={istGewaehlt(f.f)} data-taste="be-format" data-format={f.name}
              title={f.f === null ? 'Ausschnitt frei ziehen' : f.f === 'original' ? 'Seitenverhältnis des Bildes behalten' : 'Festes Seitenverhältnis – noch einmal tippen: hoch statt quer'}
              onClick={() => { setModus('schnitt'); waehleFormat(f.f); }}>{beschriftung(f)}</button>
          ))}
        </span>
        <span className="be-gruppe" role="group" aria-label="Drehen und spiegeln">
          <button data-taste="be-links" title="Nach links drehen (Umschalt+R)" aria-label="Nach links drehen" onClick={() => wende('links')}><IDrehLinks size={17} /></button>
          <button data-taste="be-rechts" title="Nach rechts drehen (R)" aria-label="Nach rechts drehen" onClick={() => wende('rechts')}><IDrehRechts size={17} /></button>
          <button data-taste="be-spiegeln" title="Spiegeln – links und rechts tauschen" aria-label="Spiegeln" onClick={() => wende('spiegeln')}><ISpiegeln size={17} /></button>
        </span>
        <label className="be-gruppe be-gerade" title="Gerade richten – schiefen Horizont oder schräg fotografiertes Blatt ausgleichen (Doppelklick: zurück auf 0)">
          <span>Gerade</span>
          <input type="range" min={-NEIGUNG_MAX} max={NEIGUNG_MAX} step={0.5} value={s.neigung} data-taste="be-neigung" aria-label="Gerade richten"
            onChange={(e) => setS((v) => ({ ...v, neigung: Number(e.target.value) }))} onDoubleClick={() => setS((v) => ({ ...v, neigung: 0 }))} />
          <output>{s.neigung > 0 ? '+' : ''}{s.neigung.toFixed(1).replace('.', ',')}°</output>
        </label>
        <span className="be-gruppe" role="group" aria-label="Weitere Werkzeuge">
          <button className={anpassenAuf ? 'an' : ''} aria-pressed={anpassenAuf} data-taste="be-anpassen" title="Helligkeit, Kontrast, Sättigung" aria-label="Helligkeit, Kontrast, Sättigung"
            onClick={() => setAnpassenAuf((v) => !v)}><ISonne size={17} /></button>
          <button className={modus === 'pixel' ? 'an' : ''} aria-pressed={modus === 'pixel'} data-taste="be-verpixeln"
            title="Verpixeln – Rechteck über Namen, Gesichter oder Nummern ziehen; ein Tipp darauf nimmt es wieder weg" aria-label="Verpixeln"
            onClick={() => setModus((m) => (m === 'pixel' ? 'schnitt' : 'pixel'))}><IVerpixeln size={17} /></button>
        </span>
      </div>
    </div>,
    document.body,
  );
}

/** Liegt der Punkt im (konvexen) Viereck? */
function imVieleck(p: [number, number], e: [number, number][]): boolean {
  let drin = false;
  for (let i = 0, j = e.length - 1; i < e.length; j = i++) {
    if ((e[i][1] > p[1]) !== (e[j][1] > p[1]) && p[0] < ((e[j][0] - e[i][0]) * (p[1] - e[i][1])) / (e[j][1] - e[i][1]) + e[i][0]) drin = !drin;
  }
  return drin;
}
