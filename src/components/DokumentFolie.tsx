// M363: Ein Dokument (PDF, Word, großes Bild) als Folie der Präsentation.
//
// Bisher stand von einer Datei-Karte im Vortrag nur der Dateiname — der Inhalt, um den es geht, fehlte. Jetzt
// zeigt die Folie die Seite selbst, so groß wie der Schirm es hergibt, samt den Anmerkungen (Stift, Textmarker),
// die auf dem Board darauf gemacht wurden:
//   · Blättern gehört zur Folienfolge: „Weiter" geht Seite für Seite durchs Dokument und erst danach zur
//     nächsten Folie (die Präsentation steuert `seite`, das Dokument meldet seine Seitenzahl).
//   · Lesbar auf jedem Schirm: „Ganze Seite" oder „Seitenbreite", stufenlos zoomen — zwei Finger, Doppeltipp,
//     Strg+Rad, + / − — und im vergrößerten Blatt mit dem Finger oder der Maus rollen.
//   · Am Telefon: Wischen blättert (solange das Blatt nicht seitlich überläuft), Tipp auf den Rand ebenso.
// Die Seite liegt in einem gewöhnlichen Scroll-Bereich: Rollen und Schwung macht der Browser, nur der Zoom
// (Breite des Blatts) wird hier gerechnet.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { selectActiveBoard, useBoard, type Stroke } from '../store';
import { loadFile, vorschauArt } from '../lib/fileStore';
import { kontoDateiNachladen } from '../lib/kontoSync';
import { pdfSeiteMasse, renderPdfPage } from '../lib/pdf';
import { MarkerGruppen, StrichPfad } from './StrichPfad';
import type { FileNode } from '../types';

export type DokumentArt = 'pdf' | 'word' | 'bild';

/** Lässt sich diese Datei-Karte als Dokument-Folie zeigen? */
export function dokumentArt(node: { type?: string; data?: unknown }): DokumentArt | null {
  if (node.type !== 'file') return null;
  const d = node.data as { name?: string; mime?: string };
  const name = d.name ?? '';
  if (name.toLowerCase().endsWith('.docx')) return 'word';
  const art = vorschauArt(name, d.mime);
  return art === 'pdf' ? 'pdf' : art === 'bild' ? 'bild' : null;
}

/** Inhalt der Datei: aus der Karte (kleine Dateien), der Geräte-Ablage oder dem Konto */
function useQuelle(id: string, dataUrl: string | undefined): { quelle: string | null; fehlt: boolean } {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [fehlt, setFehlt] = useState(false);
  useEffect(() => {
    if (dataUrl) return;
    let url: string | null = null; let weg = false;
    void (async () => {
      let b = await loadFile(id).catch(() => undefined);
      if (!b) { try { b = (await kontoDateiNachladen(id)) ?? undefined; } catch { b = undefined; } }
      if (weg) return;
      if (!b) { setFehlt(true); return; }
      url = URL.createObjectURL(b);
      setBlobUrl(url);
    })();
    return () => { weg = true; if (url) URL.revokeObjectURL(url); };
  }, [id, dataUrl]);
  return { quelle: dataUrl ?? blobUrl, fehlt };
}

const Z_MIN = 1;
const Z_MAX = 6;
/** So breit wird höchstens gerendert (Gerätepunkte) — darüber streckt der Browser; schont Speicher am Telefon */
const RENDER_MAX_PX = 2600;

/** In „Seitenbreite" wird das Blatt höchstens so breit — darüber wird Text nur riesig, nicht lesbarer */
const BREITE_MAX = 1180;
/** Passt die ganze Seite nur schmaler als das auf den Schirm, startet die Folie in „Seitenbreite" (lesbar statt winzig) */
const LESBAR_AB = 640;

export function DokumentFolie({ node, art, seite, onSeiten, schritt, geheZu, rollRef, ansichtMerker }: {
  node: FileNode; art: DokumentArt;
  /** Gewünschte Seite; -1 = die letzte (wer rückwärts in das Dokument blättert, landet am Ende) */
  seite: number;
  onSeiten: (n: number) => void;
  /** Eine Seite/Folie weiter (+1) oder zurück (−1) — die Präsentation entscheidet, ob Seite oder Folie */
  schritt: (d: 1 | -1) => void;
  /** Direkt zu einer Seite dieses Dokuments */
  geheZu: (seite: number) => void;
  /** Die Präsentation fragt vor jedem Schritt: Gibt es auf dieser Seite noch etwas zu rollen? (wie im PDF-Programm) */
  rollRef: { current: ((d: 1 | -1) => boolean) | null };
  /** Gewählte Ansicht je Dokument — sie bleibt, wenn man die Folie verlässt und wiederkommt */
  ansichtMerker: { current: Record<string, 'seite' | 'breite'> };
}) {
  const { quelle, fehlt } = useQuelle(node.id, node.data.dataUrl);
  const drawings = useBoard((s) => selectActiveBoard(s).drawings);
  const flaecheRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wordRef = useRef<HTMLDivElement>(null);
  const wordStilRef = useRef<HTMLDivElement>(null);
  const [seiten, setSeiten] = useState(1);
  /** Seitenmaß in Seitenpunkten (PDF-Punkte bzw. CSS-pt der Word-Seite; beim Bild Bildpunkte) */
  const [mass, setMass] = useState<{ b: number; h: number } | null>(null);
  const [platz, setPlatz] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [modus, setModusRoh] = useState<'seite' | 'breite'>(() => ansichtMerker.current[node.id] ?? 'seite');
  /** Hat der Mensch den Modus selbst gewählt? Dann bleibt er (sonst entscheidet die Lesbarkeit, einmal je Dokument) */
  const modusFest = useRef(!!ansichtMerker.current[node.id]);
  const modusRef = useRef(modus);
  modusRef.current = modus;
  /** Ansicht bewusst wählen (Knopf, B, 0): gilt ab jetzt für dieses Dokument */
  const waehleModus = useCallback((m: 'seite' | 'breite' | 'wechseln') => {
    const neu = m === 'wechseln' ? (modusRef.current === 'seite' ? 'breite' : 'seite') : m;
    modusFest.current = true;
    ansichtMerker.current[node.id] = neu;
    setModusRoh(neu);
  }, [ansichtMerker, node.id]);
  const [z, setZ] = useState(1);
  const [fehler, setFehler] = useState(false);
  const [wordFertig, setWordFertig] = useState(false);
  const nr = seite < 0 ? seiten : Math.min(Math.max(1, seite), seiten);

  // Platz der Folie messen
  useLayoutEffect(() => {
    const el = flaecheRef.current;
    if (!el) return;
    const messen = () => setPlatz({ w: el.clientWidth, h: el.clientHeight });
    messen();
    const ro = new ResizeObserver(messen);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- PDF: Maße und Seitenzahl ----
  useEffect(() => {
    if (art !== 'pdf' || !quelle) return;
    let weg = false;
    pdfSeiteMasse(quelle, nr).then((m) => {
      if (weg) return;
      setSeiten(m.seiten); onSeiten(m.seiten);
      setMass({ b: m.breite, h: m.hoehe });
    }).catch(() => { if (!weg) setFehler(true); });
    return () => { weg = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [art, quelle, nr]);

  // ---- Word: einmal aufbauen (alle Seiten), danach nur noch die sichtbare wählen ----
  useEffect(() => {
    if (art !== 'word' || !quelle) return;
    let weg = false;
    (async () => {
      try {
        const [{ renderAsync }, blob] = await Promise.all([import('docx-preview'), (await fetch(quelle)).blob()]);
        if (weg || !wordRef.current) return;
        wordRef.current.innerHTML = '';
        await renderAsync(blob, wordRef.current, wordStilRef.current ?? undefined, {
          inWrapper: false, breakPages: true, ignoreLastRenderedPageBreak: false, useBase64URL: true,
          renderHeaders: true, renderFooters: true, renderFootnotes: true, renderComments: false, className: 'docx',
        });
        if (weg) return;
        const n = Math.max(1, wordRef.current.querySelectorAll('section.docx').length);
        setSeiten(n); onSeiten(n); setWordFertig(true);
      } catch { if (!weg) setFehler(true); }
    })();
    return () => { weg = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [art, quelle]);
  /** Rohmaß der sichtbaren Word-Seite in CSS-Pixeln (vor dem Skalieren) */
  const [wordRoh, setWordRoh] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const inhalt = wordRef.current;
    if (art !== 'word' || !wordFertig || !inhalt) return;
    const abschnitte = [...inhalt.querySelectorAll<HTMLElement>('section.docx')];
    if (abschnitte.length === 0) return;
    abschnitte.forEach((a, i) => { a.style.display = i === nr - 1 ? '' : 'none'; });
    const akt = abschnitte[Math.min(nr, abschnitte.length) - 1];
    inhalt.style.transform = 'none';
    const breitePt = parseFloat(akt.style.width) || 595.3;
    const roh = akt.offsetWidth || breitePt * (96 / 72);
    const minH = (parseFloat(akt.style.minHeight) || 0) * (96 / 72);
    const rohH = Math.max(akt.offsetHeight || 0, minH) || roh * 1.414;
    setWordRoh({ w: roh, h: rohH });
    setMass({ b: breitePt, h: rohH * (breitePt / roh) });
  }, [art, wordFertig, nr]);

  // ---- Blattgröße: Grundmaß aus dem Modus, mal Zoom ----
  const verhaeltnis = mass ? mass.h / mass.b : 1.414;
  const grund = useMemo(() => {
    if (platz.w <= 0 || platz.h <= 0) return 0;
    const ganz = Math.min(platz.w, platz.h / verhaeltnis);
    return Math.max(80, Math.floor(modus === 'seite' ? ganz : Math.max(ganz, Math.min(platz.w, BREITE_MAX))));
  }, [platz, verhaeltnis, modus]);
  // Hochformat-Seite am Querformat-Schirm (Laptop, Telefon quer): Die ganze Seite wäre winzig — in Seitenbreite beginnen
  useEffect(() => {
    if (!mass || platz.w <= 0 || modusFest.current) return;
    const ganz = Math.min(platz.w, platz.h / verhaeltnis);
    modusFest.current = true;
    if (ganz < LESBAR_AB && ganz < platz.w * 0.7) setModusRoh('breite');
  }, [mass, platz, verhaeltnis]);
  // Leertaste/→ rollen erst die Seite zu Ende, dann blättern sie
  useEffect(() => {
    rollRef.current = (d) => {
      const el = flaecheRef.current;
      if (!el) return false;
      const max = el.scrollHeight - el.clientHeight;
      if (max < 12) return false;
      if (d === 1 && el.scrollTop < max - 6) { el.scrollBy({ top: el.clientHeight * 0.85, behavior: 'smooth' }); return true; }
      if (d === -1 && el.scrollTop > 6) { el.scrollBy({ top: -el.clientHeight * 0.85, behavior: 'smooth' }); return true; }
      return false;
    };
    return () => { rollRef.current = null; };
  }, [rollRef]);
  const breite = Math.round(grund * z);
  const hoehe = Math.round(breite * verhaeltnis);

  /** Zoom um einen Punkt: Was unter dem Finger/Zeiger liegt, bleibt dort */
  const anker = useRef<{ fx: number; fy: number; px: number; py: number } | null>(null);
  const zoomen = useCallback((neu: number, clientX?: number, clientY?: number) => {
    const el = flaecheRef.current;
    const blatt = el?.querySelector<HTMLElement>('.folie-dok-seite');
    const zNeu = Math.max(Z_MIN, Math.min(Z_MAX, neu));
    if (el && blatt) {
      const r = blatt.getBoundingClientRect();
      const fr = el.getBoundingClientRect();
      const px = clientX ?? fr.left + fr.width / 2;
      const py = clientY ?? fr.top + fr.height / 2;
      anker.current = { fx: (px - r.left) / Math.max(1, r.width), fy: (py - r.top) / Math.max(1, r.height), px: px - fr.left, py: py - fr.top };
    }
    setZ(zNeu);
  }, []);
  useLayoutEffect(() => {
    const el = flaecheRef.current; const a = anker.current;
    if (!el || !a) return;
    anker.current = null;
    // Das Blatt steht mittig, solange es kleiner als die Fläche ist — dann gibt es nichts zu rollen
    el.scrollLeft = Math.max(0, a.fx * breite - a.px);
    el.scrollTop = Math.max(0, a.fy * hoehe - a.py);
  }, [breite, hoehe]);
  // Neue Seite: oben anfangen
  useEffect(() => { const el = flaecheRef.current; if (el) { el.scrollTop = 0; el.scrollLeft = 0; } }, [nr]);

  // ---- PDF rendern: in der gezeigten Breite, entprellt (beim Zoomen streckt solange das alte Bild) ----
  useEffect(() => {
    if (art !== 'pdf' || !quelle || !canvasRef.current || breite <= 0) return;
    let aktiv = true; let h: { cancel: () => void } | null = null;
    const dpr = window.devicePixelRatio || 1;
    const t = setTimeout(() => {
      if (!canvasRef.current) return;
      const r = renderPdfPage(quelle, nr, canvasRef.current, Math.min(breite, RENDER_MAX_PX / dpr), false);
      h = r;
      r.promise.catch(() => { if (aktiv) setFehler(true); });
    }, canvasRef.current.width > 300 ? 160 : 0);
    return () => { aktiv = false; clearTimeout(t); h?.cancel(); };
  }, [art, quelle, nr, breite]);

  // ---- Gesten ----
  const pinch = useRef<{ d: number; z: number } | null>(null);
  const tipp = useRef<{ x: number; y: number; t: number; weg: boolean; sx: number } | null>(null);
  const letzterTipp = useRef<{ x: number; y: number; t: number } | null>(null);
  useEffect(() => {
    const el = flaecheRef.current;
    if (!el) return;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const start = (e: TouchEvent) => {
      if (e.touches.length === 2) { pinch.current = { d: dist(e.touches), z }; tipp.current = null; e.preventDefault(); return; }
      if (e.touches.length === 1) tipp.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now(), weg: false, sx: el.scrollLeft };
    };
    const zug = (e: TouchEvent) => {
      const p = pinch.current;
      if (p && e.touches.length === 2) {
        e.preventDefault();
        zoomen(p.z * (dist(e.touches) / p.d), (e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2);
        return;
      }
      const s = tipp.current;
      if (s && e.touches.length === 1 && Math.hypot(e.touches[0].clientX - s.x, e.touches[0].clientY - s.y) > 10) s.weg = true;
    };
    const ende = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch.current = null;
      const s = tipp.current;
      if (!s || e.touches.length > 0) return;
      tipp.current = null;
      const t = e.changedTouches[0];
      const dx = t.clientX - s.x; const dy = t.clientY - s.y;
      const dauer = performance.now() - s.t;
      // Wischen blättert — nur, wenn das Blatt seitlich nichts zu rollen hat (sonst rollt der Finger)
      const rollbar = el.scrollWidth > el.clientWidth + 2;
      if (s.weg && !rollbar && Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4 && dauer < 700) {
        e.preventDefault();
        schritt(dx < 0 ? 1 : -1);
        return;
      }
      if (s.weg || dauer > 350) return;
      // Doppeltipp: heran und wieder zurück
      const vor = letzterTipp.current;
      if (vor && performance.now() - vor.t < 320 && Math.hypot(vor.x - t.clientX, vor.y - t.clientY) < 40) {
        letzterTipp.current = null;
        e.preventDefault();
        zoomen(z > 1.05 ? 1 : 2.5, t.clientX, t.clientY);
        return;
      }
      letzterTipp.current = { x: t.clientX, y: t.clientY, t: performance.now() };
      // Einfacher Tipp auf den Rand blättert (kurz warten: es könnte ein Doppeltipp werden)
      const r = el.getBoundingClientRect();
      const anteil = (t.clientX - r.left) / r.width;
      if (anteil < 0.22 || anteil > 0.78) {
        const d: 1 | -1 = anteil > 0.5 ? 1 : -1;
        window.setTimeout(() => { if (letzterTipp.current && performance.now() - letzterTipp.current.t >= 300) schritt(d); }, 330);
      }
    };
    const rad = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomen(z * Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY);
    };
    el.addEventListener('touchstart', start, { passive: false });
    el.addEventListener('touchmove', zug, { passive: false });
    el.addEventListener('touchend', ende, { passive: false });
    el.addEventListener('touchcancel', ende, { passive: false });
    el.addEventListener('wheel', rad, { passive: false });
    return () => {
      el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', zug);
      el.removeEventListener('touchend', ende); el.removeEventListener('touchcancel', ende);
      el.removeEventListener('wheel', rad);
    };
  }, [z, zoomen, schritt]);

  // Tastatur: + / − / 0 zoomen (Pfeile und Leertaste gehören der Präsentation)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (e.key === '+' || e.key === '=') zoomen(z * 1.25);
      else if (e.key === '-') zoomen(z / 1.25);
      else if (e.key === '0') { setZ(1); waehleModus('seite'); }
      else if (e.key.toLowerCase() === 'b') { setZ(1); waehleModus('wechseln'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [z, zoomen, waehleModus]);

  // Anmerkungen dieser Seite (Seitenpunkte) — beim Bild keine
  const striche = useMemo(
    () => (art === 'bild' ? [] : (drawings ?? []).filter((s: Stroke) => s.anchor === node.id && s.seite === nr)),
    [drawings, node.id, nr, art],
  );
  const [eingabe, setEingabe] = useState('');

  if (fehlt || fehler) {
    return (
      <div className="folie-dok leer">
        <p>📎 <b>{node.data.titel?.trim() || node.data.name}</b></p>
        <p className="folie-dok-hinweis">{fehlt ? 'Der Inhalt dieser Datei liegt nicht auf diesem Gerät.' : 'Diese Datei lässt sich hier nicht darstellen.'}</p>
      </div>
    );
  }

  const wordS = art === 'word' && wordRoh ? breite / wordRoh.w : 1;
  return (
    <div className="folie-dok" data-art={art} data-seite={nr} data-seiten={seiten} data-zoom={z.toFixed(2)} data-modus={modus}>
      <div className="folie-dok-flaeche" ref={flaecheRef} tabIndex={-1}
        onDoubleClick={(e) => zoomen(z > 1.05 ? 1 : 2.5, e.clientX, e.clientY)}>
        <div className="folie-dok-seite" style={{ width: breite || undefined, height: mass ? hoehe : undefined }}>
          {art === 'pdf' && <canvas ref={canvasRef} />}
          {art === 'word' && (
            <div className="word-seite folie-word">
              {!wordFertig && <div className="word-laedt">Dokument wird aufgebaut …</div>}
              <div ref={wordStilRef} className="word-stile" />
              <div ref={wordRef} className="word-inhalt" style={{ transform: `scale(${wordS})`, transformOrigin: '0 0', width: wordRoh?.w }} />
            </div>
          )}
          {art === 'bild' && quelle && (
            <img src={quelle} alt={node.data.name} draggable={false}
              onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth) setMass({ b: i.naturalWidth, h: i.naturalHeight }); }} />
          )}
          {mass && striche.length > 0 && (
            <svg className="folie-dok-striche" viewBox={`0 0 ${mass.b} ${mass.h}`} preserveAspectRatio="none" aria-hidden="true">
              <MarkerGruppen eintraege={striche.filter((s) => s.tool === 'marker').map((s) => ({ s }))} />
              {striche.filter((s) => s.tool !== 'marker').map((s) => <StrichPfad key={s.id} s={s} />)}
            </svg>
          )}
          {!quelle && <div className="word-laedt">Datei wird geladen …</div>}
        </div>
      </div>
      <div className="folie-dok-leiste" role="toolbar" aria-label="Dokument">
        {art !== 'bild' && (
          <>
            <button onClick={() => schritt(-1)} aria-label="Vorherige Seite" title="Vorherige Seite (←)" data-taste="folie-zurueck">‹</button>
            <label className="folie-dok-nr">
              <span>Seite</span>
              <input inputMode="numeric" aria-label="Seite" value={eingabe || String(nr)} data-taste="folie-seite-nr"
                onFocus={() => setEingabe(String(nr))}
                onChange={(e) => setEingabe(e.target.value.replace(/[^0-9]/g, ''))}
                onBlur={() => { const zu = parseInt(eingabe, 10); setEingabe(''); if (zu) geheZu(Math.min(seiten, Math.max(1, zu))); }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
              <span>/ {seiten}</span>
            </label>
            <button onClick={() => schritt(1)} aria-label="Nächste Seite" title="Nächste Seite (→)" data-taste="folie-vor">›</button>
            <span className="folie-dok-trenner" aria-hidden="true" />
          </>
        )}
        <button onClick={() => zoomen(z / 1.25)} aria-disabled={z <= Z_MIN + 0.001} aria-label="Verkleinern" title="Verkleinern (−)" data-taste="folie-kleiner">−</button>
        <button className="folie-dok-modus" onClick={() => { setZ(1); if (z <= 1.001) waehleModus('wechseln'); }}
          title="Zwischen ganzer Seite und Seitenbreite wechseln (B) — bei Vergrößerung: zurück auf 100 %" data-taste="folie-modus">
          {z > 1.001 ? `${Math.round(z * 100)} %` : modus === 'seite' ? 'Ganze Seite' : 'Seitenbreite'}
        </button>
        <button onClick={() => zoomen(z * 1.25)} aria-disabled={z >= Z_MAX - 0.001} aria-label="Vergrößern" title="Vergrößern (+)" data-taste="folie-groesser">+</button>
      </div>
    </div>
  );
}
