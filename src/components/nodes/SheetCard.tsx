import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NodeProps } from '@xyflow/react';
import { mutedHistory, useBoard } from '../../store';
import { useKartenAnsicht } from '../../lib/kartenAnsicht';
import type { SheetData, SheetNode, ZellStil } from '../../types';
import { formatiereZahl } from '../../lib/zahlFormat';
import { CardShell } from './CardShell';
import { DragTitle } from './DragTitle';
import { adresseZuIndex, indexZuAdresse, rechneBlattMitLinks, zeigeWert } from '../../lib/formel';
// M528: ganze Spalten/Zeilen, Datumsrechnung, Bezüge umschreiben — kommt mit der Tabelle, nicht ins Start-Paket
import { bezuegeVerlegen, bezuegeVerschieben, tageVon, ZEILEN_MAX } from '../../lib/formelPlus';
import { tsvLesen, tsvSchreiben, umbauAnwenden, umbauNeu } from '../../lib/tabellenUmbau';
import { useEscSchliesst } from '../../lib/useEscSchliesst';
import { IPlus, ISigma, IDownload, IFilter, ICheck, IArrowUp, IArrowDown, IPen, IChevronL, IChevronR, ITrash } from '../Icons';
import { alsCsv, ersteZeile, gezeigteZeilen, sichererLink, spaltenName, spaltenWerte } from '../../lib/tabellenAnsicht';

/** M409: Breite einer Spalte, für die nichts festgelegt ist – darunter wird sie nicht gequetscht */
const SPALTE_STD = 84;
import { insBild, MenuHuelle } from '../EbenenMenu';
import { loadFile } from '../../lib/fileStore';
import { triggerDownload } from '../../lib/download';
import { zahlWort } from '../../lib/sprache';

/**
 * M256: Rechen-Tabelle — „Autosummen direkt in den Notizen".
 *
 * Die Zellen liegen als „A1" → Rohtext im Karten-Zustand; gerechnet wird beim
 * Anzeigen. Angezeigt wird deshalb IMMER das Ergebnis, bearbeitet dagegen die
 * Formel — genau wie in Excel: Man sieht 1.234, und beim Hineinklicken steht
 * dort =SUMME(B2:B9).
 *
 * Bewusst eine eigene Karte statt Formeln in den Notiz-Tabellen: In einer
 * Notiz ist eine Tabellenzelle ein Stück Fließtext mit Fett, Farbe und
 * Verlinkung. Dort ein Rechenwerk einzuhängen hieße, jede Texteingabe zu
 * überwachen — fehleranfällig und langsam. Die Rechen-Tabelle ist ein Raster,
 * und ein Raster darf rechnen.
 */
export function SheetCard({ id, data, selected }: NodeProps<SheetNode>) {
  return (
    <CardShell id={id} selected={selected} minWidth={260} minHeight={160} className="sheet-card">
      <SheetBody id={id} data={data} />
    </CardShell>
  );
}

/** M380: Der Inhalt ohne Kartenhülle — derselbe auf dem Board und als Folie in der Präsentation */
/**
 * M528: Auswahl, Zwischenablage, Zeilen und Spalten einfügen/löschen.
 * Eine Auswahl entsteht mit Umschalt+Klick, Ziehen über Zellen, Klick auf einen Spalten- oder Zeilenkopf oder Esc aus
 * dem Bearbeiten. Dann hat ein unsichtbares Textfeld (`sheet-ablage`) den Fokus: Es nimmt Pfeiltasten, Entf, Tippen
 * und — als echtes Textfeld — Strg+C/X/V samt der Ereignisse der Zwischenablage, auch aus Excel, LibreOffice und
 * Google Sheets (Tabulator-Text). Kopiert wird, was man sieht; innerhalb von PixiNotes reisen die Formeln mit (relative
 * Bezüge wandern, $-Bezüge nicht).
 */
type Rechteck = { s0: number; s1: number; z0: number; z1: number };
type Punkt = [number, number];
const rechteck = (a: Punkt, b: Punkt): Rechteck => ({ s0: Math.min(a[0], b[0]), s1: Math.max(a[0], b[0]), z0: Math.min(a[1], b[1]), z1: Math.max(a[1], b[1]) });
const drin = (r: Rechteck | null, s: number, z: number): boolean => !!r && s >= r.s0 && s <= r.s1 && z >= r.z0 && z <= r.z1;
/** Was zuletzt in einer Rechen-Tabelle kopiert wurde — mit Formeln, Links und Aussehen (die Zwischenablage hält nur Text) */
let zwischen: { text: string; quelle: string; r: Rechteck; roh: string[][]; links: (string | undefined)[][]; stile: (ZellStil | undefined)[][]; schnitt: boolean } | null = null;
/** Mehr Spalten legt die Tabelle von sich aus nicht an (A bis Z; aus Excel kann es mehr geben) */
const SPALTEN_GRENZE = 26;
const nurZeilenumbruch = (t: string): string => t.replace(/\r\n?/g, '\n').replace(/\n$/, '');

/** M520: nur Ansicht (Filter, Sortierung, Spaltenbreite) — gilt in einem Board, das man nicht ändern darf, lokal (lib/kartenAnsicht.ts) */
const TABELLE_ANSICHT = ['filterAn', 'filter', 'sort', 'kopf', 'bis', 'colW'] as const;
export function SheetBody({ id, data: daten }: { id: string; data: SheetData }) {
  const [data, updateNodeData] = useKartenAnsicht(id, daten, TABELLE_ANSICHT);
  const showToast = useBoard((s) => s.showToast);
  const cells = useMemo(() => data.cells ?? {}, [data.cells]);
  const cols = Math.max(1, data.cols ?? 5);
  const rows = Math.max(1, data.rows ?? 8);
  /** Welche Zelle wird gerade bearbeitet — dort steht die Formel, nicht das Ergebnis */
  const [edit, setEdit] = useState<string | null>(null);
  const [entwurf, setEntwurf] = useState('');
  const eingabe = useRef<HTMLInputElement | null>(null);

  /** Ein Durchgang für die ganze Tabelle — Zellen dürfen aufeinander zeigen */
  const { werte, links: formelLinks } = useMemo(() => rechneBlattMitLinks(cells), [cells]);

  /**
   * M407: Datentabelle. Mit eingeschaltetem Filter trägt die Kopfzeile je Spalte einen Knopf zum Sortieren und
   * Auswählen; beides ist eine Ansicht (lib/tabellenAnsicht.ts) – die Zellen bleiben an ihrem Platz, Formeln rechnen
   * unverändert, die Zeilennummern am Rand bleiben die echten.
   */
  const kopf = Math.min(Math.max(1, data.kopf ?? ersteZeile(cells, rows)), rows);
  const filterAn = !!data.filterAn;
  /** M409: Aussehen einer Zelle (aus Excel übernommen) und ihr Anzeigetext nach ihrem Zahlenformat */
  const stilVon = useCallback((adr: string): ZellStil | undefined => {
    const nr = data.stile?.[adr];
    return nr === undefined ? undefined : data.stilListe?.[nr];
  }, [data.stile, data.stilListe]);
  const anzeigeVon = useCallback((adr: string): { text: string; farbe?: string } => {
    const v = werte[adr] ?? null;
    const z = typeof v === 'number' ? stilVon(adr)?.z : undefined;
    const nachFormat = z ? formatiereZahl(v as number, z) : null;
    if (nachFormat) return nachFormat;
    /* M411: Eine Zahl, die ein Link ist, ist eine Kennung (Ticket 4711, Rechnung 100234) – sie steht da wie in
       Excel, ohne Tausenderpunkt. Vorher stand dort „4.711". */
    if (typeof v === 'number' && Number.isFinite(v) && (data.links?.[adr] || formelLinks[adr])) return { text: String(Math.round(v * 1e10) / 1e10).replace('.', ',') };
    return { text: zeigeWert(v) };
  }, [werte, stilVon, data.links, formelLinks]);
  const text = useCallback((adr: string) => anzeigeVon(adr).text, [anzeigeVon]);
  /** M409: verbundene Zellen – die Ankerzelle spannt, die übrigen des Bereichs entfallen */
  const verbund = useMemo(() => {
    const anker = new Map<string, { cs: number; rs: number }>(); const bedeckt = new Map<string, { anker: string; gleicheZeile: boolean }>();
    for (const ref of data.verbunden ?? []) {
      const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
      if (!m) continue;
      const nr = (b: string) => [...b].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
      const s0 = nr(m[1]), s1 = Math.min(nr(m[3]), cols - 1), z0 = Number(m[2]), z1 = Math.min(Number(m[4]), rows);
      if (s1 < s0 || z1 < z0 || (s1 === s0 && z1 === z0)) continue;
      const a = indexZuAdresse(s0, z0 - 1);
      anker.set(a, { cs: s1 - s0 + 1, rs: z1 - z0 + 1 });
      for (let z = z0; z <= z1; z += 1) for (let sp = s0; sp <= s1; sp += 1) if (z !== z0 || sp !== s0) bedeckt.set(indexZuAdresse(sp, z - 1), { anker: a, gleicheZeile: z === z0 });
    }
    return { anker, bedeckt };
  }, [data.verbunden, cols, rows]);
  // Höhe der Buchstabenzeile: darunter bleibt die Kopfzeile der Datentabelle beim Rollen stehen
  const rollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = rollRef.current; const kopfzeile = el?.querySelector('thead') as HTMLElement | null;
    if (el && kopfzeile) el.style.setProperty('--sheet-kopf-h', `${kopfzeile.offsetHeight}px`);
  });
  const ansicht = useMemo(
    () => (filterAn ? gezeigteZeilen({ kopf, bis: data.bis, filter: data.filter, sort: data.sort }, cells, cols, rows, (a) => werte[a], text) : null),
    [filterAn, kopf, data.bis, data.filter, data.sort, cells, cols, rows, werte, text],
  );
  const reihen = useMemo(() => ansicht?.zeilen ?? Array.from({ length: rows }, (_, i) => i + 1), [ansicht, rows]);
  const gefiltert = !!ansicht && (Object.keys(data.filter ?? {}).length > 0 || !!data.sort);
  const [filterAuf, setFilterAuf] = useState<{ spalte: string; x: number; y: number } | null>(null);
  useEffect(() => { if (!filterAn) setFilterAuf(null); }, [filterAn]);

  /** M407: Link einer Zelle – in Excel angehängt, als =HYPERLINK(…) geschrieben oder einfach eine Adresse im Text */
  const [linkEntwurf, setLinkEntwurf] = useState('');
  const linkVon = (adr: string, anzeige: string): string | null => {
    const fest = data.links?.[adr];
    if (fest) return sichererLink(fest);
    // M411: bei =HYPERLINK(…) die Adresse, die die Formel AUSRECHNET (lib/formel.ts) – auch eine zusammengesetzte
    if (formelLinks[adr]) return sichererLink(formelLinks[adr]);
    return sichererLink(anzeige);
  };

  /** M528: Die Auswahl (Anker → anderes Ende, Spalte/Zeile ab 0); beim Bearbeiten ist sie die bearbeitete Zelle */
  const [auswahl, setAuswahl] = useState<{ a: Punkt; b: Punkt } | null>(null);
  const r = auswahl ? rechteck(auswahl.a, auswahl.b) : null;
  const [schnitt, setSchnitt] = useState<Rechteck | null>(null);
  const [menue, setMenue] = useState<{ art: 'z' | 's' | 'zelle'; x: number; y: number } | null>(null);
  const ablage = useRef<HTMLTextAreaElement | null>(null);
  /** Wurde gerade gezogen oder mit Umschalt erweitert, öffnet der Klick danach keine Zelle */
  const gezogen = useRef(false);
  const ablageFokus = () => requestAnimationFrame(() => {
    const t = ablage.current;
    if (!t) return;
    t.value = ' ';
    t.focus({ preventScroll: true });
    t.select();
  });

  const oeffne = (adr: string, anfang?: string) => {
    setEdit(adr);
    setEntwurf(anfang ?? cells[adr] ?? '');
    setLinkEntwurf(data.links?.[adr] ?? '');
    const p = adresseZuIndex(adr);
    if (p) setAuswahl({ a: [p.spalte, p.zeile], b: [p.spalte, p.zeile] });
    requestAnimationFrame(() => {
      const el = eingabe.current;
      if (!el) return;
      // M528: Wer in der Auswahl lostippt, ersetzt den Inhalt (wie Excel) — der Cursor steht hinter dem Getippten
      if (anfang !== undefined) el.setSelectionRange(el.value.length, el.value.length); else el.select();
    });
  };

  const uebernimm = (weiter?: 'runter' | 'rechts') => {
    if (!edit) return;
    const neu = { ...cells };
    if (entwurf.trim() === '') delete neu[edit]; else neu[edit] = entwurf;
    // der Link der Zelle: leer = keiner; angenommen wird nur, was sich gefahrlos öffnen lässt
    const ziel = linkEntwurf.trim();
    const links = { ...(data.links ?? {}) };
    if (!ziel) delete links[edit];
    else if (sichererLink(ziel)) links[edit] = ziel;
    else showToast('Als Link gehen nur Web-, Mail- und Telefon-Adressen – der Link wurde nicht übernommen.');
    const linksGeaendert = JSON.stringify(links) !== JSON.stringify(data.links ?? {});
    // M520: Nur schreiben, wenn sich etwas geändert hat. Vorher legte schon das Hinein- und wieder Herausklicken
    // einen Rückgängig-Schritt an — Strg+Z tat danach scheinbar nichts.
    const zelleGeaendert = (cells[edit] ?? '') !== (neu[edit] ?? '');
    if (zelleGeaendert || linksGeaendert) updateNodeData(id, { cells: neu, ...(linksGeaendert ? { links: Object.keys(links).length ? links : undefined } : {}) });
    const sp = edit.replace(/\d+/g, '');
    const z = Number(edit.replace(/\D+/g, ''));
    let spIdx = 0;
    for (const c of sp) spIdx = spIdx * 26 + (c.charCodeAt(0) - 64);
    spIdx -= 1;
    // „runter" folgt der gezeigten Reihenfolge – gefiltert und sortiert ist die nächste Zeile nicht z + 1
    const naechste = reihen[reihen.indexOf(z) + 1];
    if (weiter === 'runter' && naechste) oeffne(indexZuAdresse(spIdx, naechste - 1));
    else if (weiter === 'rechts' && spIdx + 1 < cols) oeffne(indexZuAdresse(spIdx + 1, z - 1));
    else setEdit(null);
  };

  // ───────── M528: Auswahl, Zwischenablage, Umbau ─────────
  const editRef = useRef(edit); editRef.current = edit;
  const uebernimmRef = useRef(uebernimm); uebernimmRef.current = uebernimm;
  /** Eine Änderung als eigener Rückgängig-Schritt (nicht mit dem Tippen davor gebündelt) */
  const schreiben = (patch: Record<string, unknown>) => {
    useBoard.getState().pushHistory();
    mutedHistory(() => useBoard.getState().updateNodeData(id, patch));
  };
  const maxSpalten = Math.max(cols, SPALTEN_GRENZE);

  /** Klick daneben (außerhalb der Karte und ihrer Menüs) hebt die Auswahl auf */
  useEffect(() => {
    if (!auswahl || edit) return;
    const weg = (e: PointerEvent) => {
      const t = e.target as Element | null;
      const wurzel = rollRef.current?.parentElement;
      if (!t || wurzel?.contains(t) || t.closest?.('.ebenen-menu')) return;
      setAuswahl(null); setMenue(null);
    };
    window.addEventListener('pointerdown', weg, true);
    return () => window.removeEventListener('pointerdown', weg, true);
  }, [auswahl, edit]);

  const zelleUnter = (x: number, y: number): Punkt | null => {
    const el = document.elementFromPoint(x, y)?.closest?.('td[data-zelle]') as HTMLElement | null;
    if (!el || !rollRef.current?.contains(el)) return null;
    const p = adresseZuIndex(el.dataset.zelle ?? '');
    return p ? [p.spalte, p.zeile] : null;
  };
  const zelleRunter = (e: React.PointerEvent, s: number, z: number) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('input, a, button')) return;
    gezogen.current = false;
    if (e.shiftKey) {
      e.preventDefault();
      gezogen.current = true;
      const anker = auswahl?.a ?? [s, z];
      if (edit) uebernimm();
      setAuswahl({ a: anker, b: [s, z] });
      ablageFokus();
      return;
    }
    if (e.pointerType === 'touch') return;   // am Finger rollt Ziehen die Tabelle
    const start: Punkt = [s, z];
    const zieh = (ev: PointerEvent) => {
      const p = zelleUnter(ev.clientX, ev.clientY);
      if (!p || (!gezogen.current && p[0] === s && p[1] === z)) return;
      if (!gezogen.current) {
        gezogen.current = true;
        if (editRef.current) uebernimmRef.current();
        window.getSelection()?.removeAllRanges();
      }
      setAuswahl({ a: start, b: p });
    };
    const ende = () => {
      window.removeEventListener('pointermove', zieh);
      window.removeEventListener('pointerup', ende);
      window.removeEventListener('pointercancel', ende);
      if (gezogen.current) ablageFokus();
    };
    window.addEventListener('pointermove', zieh);
    window.addEventListener('pointerup', ende);
    window.addEventListener('pointercancel', ende);
  };
  /** Klick auf einen Spalten- oder Zeilenkopf wählt die ganze Spalte bzw. Zeile (mit Umschalt: bis dorthin) */
  const kopfRunter = (e: React.MouseEvent, art: 'z' | 's', i: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (edit) uebernimm();
    const von = e.shiftKey && auswahl ? (art === 's' ? auswahl.a[0] : auswahl.a[1]) : i;
    setAuswahl(art === 's' ? { a: [von, 0], b: [i, rows - 1] } : { a: [0, von], b: [cols - 1, i] });
    ablageFokus();
  };
  /** Rechtsklick auf Kopf oder Zelle: Menü zum Einfügen und Löschen; liegt die Stelle außerhalb der Auswahl, gilt sie allein */
  const kontext = (e: React.MouseEvent, art: 'z' | 's' | 'zelle', s: number, z: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (edit) uebernimm();
    if (!drin(r, art === 'z' ? (r?.s0 ?? 0) : s, art === 's' ? (r?.z0 ?? 0) : z)) {
      setAuswahl(art === 's' ? { a: [s, 0], b: [s, rows - 1] } : art === 'z' ? { a: [0, z], b: [cols - 1, z] } : { a: [s, z], b: [s, z] });
    }
    setMenue({ art, x: e.clientX, y: e.clientY });
  };
  /** Was das Menü einfügt bzw. löscht: die Zeilen/Spalten der Auswahl */
  const spanne = (a: 'z' | 's'): { bei: number; n: number } => (r ? (a === 'z' ? { bei: r.z0, n: r.z1 - r.z0 + 1 } : { bei: r.s0, n: r.s1 - r.s0 + 1 }) : { bei: 0, n: 1 });

  /**
   * Zeilen oder Spalten einfügen (n > 0) bzw. löschen (n < 0) — alles, was an Adressen hängt, wandert mit, Formeln
   * passen ihre Bezüge an (lib/tabellenUmbau.ts). Ein Schritt für Strg+Z.
   */
  const umbauen = (a: 'z' | 's', bei: number, n: number) => {
    setMenue(null);
    if (edit) uebernimm();
    if (n < 0 && -n >= (a === 'z' ? rows : cols)) { showToast(a === 'z' ? 'Mindestens eine Zeile bleibt stehen.' : 'Mindestens eine Spalte bleibt stehen.'); return; }
    if (a === 's' && n > 0 && cols + n > maxSpalten) {
      // Platz nur, wenn die Spalten, die hinten hinausfielen, leer sind
      const frei = Object.keys(cells).every((k) => (adresseZuIndex(k)?.spalte ?? 0) < maxSpalten - n);
      if (!frei) { showToast(`Mehr als ${maxSpalten} Spalten (A bis ${indexZuAdresse(maxSpalten - 1, 0).replace(/\d+/g, '')}) fasst die Tabelle nicht.`); return; }
    }
    const inhalt = n < 0 && Object.keys(cells).some((k) => {
      const p = adresseZuIndex(k);
      const x = p ? (a === 'z' ? p.zeile : p.spalte) : -1;
      return x >= bei && x < bei - n;
    });
    const patch = umbauAnwenden(data as SheetData, umbauNeu(a, bei, n));
    if (a === 's' && patch.cols !== undefined) patch.cols = Math.min(patch.cols, maxSpalten);
    schreiben(patch as Record<string, unknown>);
    // die Auswahl bleibt bei den eingefügten Zeilen/Spalten bzw. rückt an die Stelle der gelöschten
    const ende = Math.max(0, (a === 'z' ? (patch.rows ?? rows) : (patch.cols ?? cols)) - 1);
    const lo = Math.min(bei, ende), hi = Math.min(bei + Math.max(n, 1) - 1, ende);
    setAuswahl(a === 'z' ? { a: [0, lo], b: [(patch.cols ?? cols) - 1, hi] } : { a: [lo, 0], b: [hi, (patch.rows ?? rows) - 1] });
    setSchnitt(null);
    if (inhalt) showToast(a === 'z' ? `${zahlWort(-n, 'Zeile', 'Zeilen')} gelöscht.` : `${zahlWort(-n, 'Spalte', 'Spalten')} gelöscht.`, 'schritt');
    ablageFokus();
  };

  const zellenDerAuswahl = (q: Rechteck, fn: (adr: string, s: number, z: number) => void) => {
    for (let z = q.z0; z <= q.z1; z += 1) for (let sp = q.s0; sp <= q.s1; sp += 1) fn(indexZuAdresse(sp, z), sp, z);
  };
  /** Strg+C / Strg+X: sichtbarer Text als Tabulator-Text (für Excel & Co.), Formeln merkt sich die Tabelle selbst */
  const kopieren = (dt: DataTransfer, ausschneiden: boolean) => {
    if (!r) return;
    const roh: string[][] = [], anz: string[][] = [], li: (string | undefined)[][] = [], st: (ZellStil | undefined)[][] = [];
    for (let z = r.z0; z <= r.z1; z += 1) {
      roh.push([]); anz.push([]); li.push([]); st.push([]);
      for (let sp = r.s0; sp <= r.s1; sp += 1) {
        const adr = indexZuAdresse(sp, z);
        roh[roh.length - 1].push(cells[adr] ?? '');
        anz[anz.length - 1].push(text(adr));
        li[li.length - 1].push(data.links?.[adr]);
        st[st.length - 1].push(stilVon(adr));
      }
    }
    const tsv = tsvSchreiben(anz);
    dt.setData('text/plain', tsv);
    zwischen = { text: tsv, quelle: id, r, roh, links: li, stile: st, schnitt: ausschneiden };
    setSchnitt(ausschneiden ? r : null);
  };
  /** Ein Aussehen aus einer anderen Tabelle in die eigene Stil-Liste übernehmen */
  const stilNummer = (liste: ZellStil[], stil: ZellStil): number => {
    const t = JSON.stringify(stil);
    const i = liste.findIndex((x) => JSON.stringify(x) === t);
    if (i >= 0) return i;
    liste.push(stil);
    return liste.length - 1;
  };
  /** Strg+V: an den Anfang der Auswahl; ein einzelner Wert füllt die ganze Auswahl. Formeln aus PixiNotes wandern mit */
  const einfuegen = (roherText: string) => {
    if (!r) return;
    const intern = zwischen && nurZeilenumbruch(zwischen.text) === nurZeilenumbruch(roherText) ? zwischen : null;
    const block = intern ? intern.roh : tsvLesen(roherText);
    if (!block.length) return;
    const h = block.length, w = Math.max(...block.map((x) => x.length));
    const fuellen = h === 1 && w === 1 && (r.s1 > r.s0 || r.z1 > r.z0);
    const ziel: Rechteck = fuellen ? r : { s0: r.s0, z0: r.z0, s1: r.s0 + w - 1, z1: r.z0 + h - 1 };
    let gekappt = false;
    if (ziel.s1 >= maxSpalten) { ziel.s1 = maxSpalten - 1; gekappt = true; }
    if (ziel.z1 >= ZEILEN_MAX) { ziel.z1 = ZEILEN_MAX - 1; gekappt = true; }
    const neu = { ...cells };
    const links: Record<string, string> = { ...(data.links ?? {}) };
    const stile: Record<string, number> = { ...(data.stile ?? {}) };
    const stilListe = [...(data.stilListe ?? [])];
    let stileAnders = false;
    const verlegen = !!intern?.schnitt && intern.quelle === id;
    if (verlegen && intern) zellenDerAuswahl(intern.r, (adr) => { delete neu[adr]; delete links[adr]; if (adr in stile) { delete stile[adr]; stileAnders = true; } });
    zellenDerAuswahl(ziel, (adr, sp, z) => {
      const i = fuellen ? 0 : z - ziel.z0, j = fuellen ? 0 : sp - ziel.s0;
      let v = block[i]?.[j] ?? '';
      // kopiert: relative Bezüge wandern um den Abstand zur Herkunft; ausgeschnitten: die Formel bleibt, wie sie ist
      if (intern && !intern.schnitt && v.startsWith('=')) v = bezuegeVerschieben(v, z - (intern.r.z0 + i), sp - (intern.r.s0 + j));
      if (v === '') delete neu[adr]; else neu[adr] = v;
      const link = intern?.links[i]?.[j];
      if (link) links[adr] = link; else delete links[adr];
      if (intern) {
        const stil = intern.stile[i]?.[j];
        if (stil) { stile[adr] = stilNummer(stilListe, stil); stileAnders = true; } else if (adr in stile) { delete stile[adr]; stileAnders = true; }
      }
    });
    // ausgeschnitten und in derselben Tabelle eingefügt: Bezüge auf die verschobenen Zellen folgen ihnen (wie Excel)
    if (verlegen && intern) {
      for (const [k, v] of Object.entries(neu)) if (v.startsWith('=')) neu[k] = bezuegeVerlegen(v, intern.r, ziel.z0 - intern.r.z0, ziel.s0 - intern.r.s0);
    }
    const patch: Record<string, unknown> = { cells: neu, links: Object.keys(links).length ? links : undefined };
    if (stileAnders) { patch.stile = Object.keys(stile).length ? stile : undefined; patch.stilListe = stilListe.length ? stilListe : undefined; }
    if (ziel.z1 + 1 > rows) patch.rows = ziel.z1 + 1;
    if (ziel.s1 + 1 > cols) patch.cols = ziel.s1 + 1;
    schreiben(patch);
    setAuswahl({ a: [ziel.s0, ziel.z0], b: [ziel.s1, ziel.z1] });
    if (intern?.schnitt) {
      // aus einer anderen Tabelle ausgeschnitten: dort leeren (eigener Schritt)
      if (!verlegen) {
        const quelle = useBoard.getState().boards.flatMap((b) => b.nodes).find((n) => n.id === intern.quelle);
        const qd = quelle?.data as SheetData | undefined;
        if (qd?.cells) {
          const qc = { ...qd.cells }; const ql = { ...(qd.links ?? {}) };
          zellenDerAuswahl(intern.r, (adr) => { delete qc[adr]; delete ql[adr]; });
          useBoard.getState().pushHistory();
          mutedHistory(() => useBoard.getState().updateNodeData(intern.quelle, { cells: qc, links: Object.keys(ql).length ? ql : undefined }));
        }
      }
      zwischen = null;
      setSchnitt(null);
    }
    if (gekappt) showToast(`Nicht alles passt hinein: Die Tabelle fasst höchstens ${maxSpalten} Spalten – der Rest wurde weggelassen.`);
  };
  /** Entf: Inhalt der Auswahl leeren (Aussehen bleibt) */
  const leeren = () => {
    if (!r) return;
    const neu = { ...cells }; const links = { ...(data.links ?? {}) };
    let anders = false;
    zellenDerAuswahl(r, (adr) => { if (adr in neu || adr in links) anders = true; delete neu[adr]; delete links[adr]; });
    if (anders) schreiben({ cells: neu, links: Object.keys(links).length ? links : undefined });
  };
  /** Tasten im unsichtbaren Feld der Auswahl */
  const ablageTaste = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    if (!auswahl || e.nativeEvent.isComposing) return;
    const strg = e.ctrlKey || e.metaKey;
    const st = useBoard.getState();
    if (strg && !e.altKey && /^[zy]$/i.test(e.key)) { e.preventDefault(); if (e.key.toLowerCase() === 'y' || e.shiftKey) st.redo(); else st.undo(); return; }
    if (strg && e.key.toLowerCase() === 'a') { e.preventDefault(); setAuswahl({ a: [0, 0], b: [cols - 1, rows - 1] }); return; }
    if (strg) return;                                   // Strg+C/X/V: die Ereignisse der Zwischenablage
    const schritt: Record<string, Punkt> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], Tab: [e.shiftKey ? -1 : 1, 0] };
    if (schritt[e.key]) {
      e.preventDefault();
      const [ds, dz] = schritt[e.key];
      const von = e.shiftKey && e.key !== 'Tab' ? auswahl.b : auswahl.a;
      const p: Punkt = [Math.max(0, Math.min(cols - 1, von[0] + ds)), Math.max(0, Math.min(rows - 1, von[1] + dz))];
      setAuswahl(e.shiftKey && e.key !== 'Tab' ? { a: auswahl.a, b: p } : { a: p, b: p });
      rollRef.current?.querySelector(`[data-zelle="${indexZuAdresse(p[0], p[1])}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); leeren(); return; }
    if (e.key === 'Escape') { e.preventDefault(); if (schnitt) { setSchnitt(null); zwischen = null; } else { setAuswahl(null); ablage.current?.blur(); } return; }
    if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); oeffne(indexZuAdresse(auswahl.a[0], auswahl.a[1])); return; }
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const el = rollRef.current?.querySelector(`[data-zelle="${indexZuAdresse(auswahl.a[0], auswahl.a[1])}"]`)?.getBoundingClientRect();
      setMenue({ art: r && r.s0 === 0 && r.s1 === cols - 1 ? 'z' : r && r.z0 === 0 && r.z1 === rows - 1 ? 's' : 'zelle', x: el ? el.left + 8 : 0, y: el ? el.bottom : 0 });
      return;
    }
    // Lostippen ersetzt den Inhalt der Zelle (wie Excel)
    if (e.key.length === 1 && !e.altKey) { e.preventDefault(); oeffne(indexZuAdresse(auswahl.a[0], auswahl.a[1]), e.key); }
  };

  /**
   * Auto-Summe: unter jede Spalte mit Zahlen eine Summenzeile setzen.
   *
   * Gesucht wird je Spalte der zusammenhängende Zahlenblock von unten — genau
   * das tut Excel beim Klick auf Σ, und es trifft fast immer das Gemeinte.
   */
  const autoSumme = () => {
    const neu = { ...cells };
    let gesetzt = 0;
    for (let s = 0; s < cols; s += 1) {
      let unten = 0;
      for (let z = rows; z >= 1; z -= 1) {
        const w = werte[indexZuAdresse(s, z - 1)];
        if (typeof w === 'number') { unten = z; break; }
        if (w !== null && w !== undefined && w !== '') break;
      }
      if (!unten) continue;
      // M390: Steht unten schon eine Summe, ist die Spalte summiert — der zweite Klick summierte sie sonst mit (126 → 252)
      if (/^=\s*SUMME\(/i.test(String(cells[indexZuAdresse(s, unten - 1)] ?? ''))) continue;
      let oben = unten;
      while (oben > 1 && typeof werte[indexZuAdresse(s, oben - 2)] === 'number') oben -= 1;
      if (unten - oben < 1) continue;                  // eine einzelne Zahl summiert niemand
      const ziel = indexZuAdresse(s, unten);           // die Zeile darunter
      if (neu[ziel]) continue;                          // nichts überschreiben
      neu[ziel] = `=SUMME(${indexZuAdresse(s, oben - 1)}:${indexZuAdresse(s, unten - 1)})`;
      gesetzt += 1;
    }
    if (!gesetzt) { showToast('Keine Zahlenspalte gefunden, unter die eine Summe passt.'); return; }
    const brauchtZeile = Object.keys(neu).some((a) => Number(a.replace(/\D+/g, '')) > rows);
    updateNodeData(id, { cells: neu, ...(brauchtZeile ? { rows: rows + 1 } : {}) });
    showToast(`Σ ${gesetzt} Summe${gesetzt > 1 ? 'n' : ''} eingetragen.`);
  };

  /**
   * Spaltenbreite ziehen.
   *
   * Der Zoom des Boards muss herausgerechnet werden: Bei 50 % Zoom entspricht
   * ein Mauszentimeter zwei Zentimetern Tabelle — sonst liefe der Griff dem
   * Zeiger davon (dieselbe Regel wie beim Ziehen der Seitenleiste, M250).
   */
  const breiteZiehen = (e: React.PointerEvent, spalte: string) => {
    e.preventDefault();
    e.stopPropagation();
    const kopf = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
    const start = e.clientX;
    const anfang = kopf.offsetWidth;
    const zoom = kopf.getBoundingClientRect().width / anfang || 1;
    // Am Fenster lauschen, nicht am Griff: Der Zeiger verlässt beim Ziehen die
    // 7 Pixel breite Leiste sofort, und React ersetzt bei jedem Zwischenstand
    // die Kopfzeile — eine Zeigerfassung am Element geht dabei verloren.
    const zieh = (ev: PointerEvent) => {
      const breit = Math.max(48, Math.round(anfang + (ev.clientX - start) / zoom));
      updateNodeData(id, { colW: { ...(data.colW ?? {}), [spalte]: breit } });
    };
    const ende = () => {
      window.removeEventListener('pointermove', zieh);
      window.removeEventListener('pointerup', ende);
      window.removeEventListener('pointercancel', ende);
    };
    window.addEventListener('pointermove', zieh);
    window.addEventListener('pointerup', ende);
    // iOS bricht Zeigerfolgen ab (Anruf, Gesten-Wechsel) — sonst klebt der Griff
    window.addEventListener('pointercancel', ende);
  };

  const csv = () => {
    const text: Record<string, string> = {};
    for (const [a, v] of Object.entries(werte)) text[a] = zeigeWert(v);
    const blob = new Blob([alsCsv(cells, text, cols, rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(data.title || 'Tabelle').replace(/[^\w äöüÄÖÜß-]/g, '')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 20_000);
  };

  /**
   * M406: Die eingefügte Excel-Datei wieder herunterladen – unverändert, wie sie hereinkam (die Tabelle hier ist
   * eine Arbeitskopie: „Als CSV speichern" gibt ihren jetzigen Stand). Der Inhalt steht im Board, liegt in der
   * Geräte-Ablage oder – bei großen Dateien auf einem anderen Gerät – im Konto.
   */
  const [holt, setHolt] = useState(false);
  const original = async () => {
    if (!data.datei || holt) return;
    setHolt(true);
    try {
      let blob: Blob | undefined;
      if (data.dataUrl) blob = await (await fetch(data.dataUrl)).blob();
      if (!blob) blob = await loadFile(id).catch(() => undefined);
      if (!blob) blob = (await import('../../lib/kontoSync').then((m) => m.kontoDateiNachladen(id)).catch(() => null)) ?? undefined;
      if (!blob) { useBoard.getState().showToast('Die Excel-Datei liegt nicht auf diesem Gerät – sie wurde auf einem anderen eingefügt.'); return; }
      const url = URL.createObjectURL(data.mime && blob.type !== data.mime ? new Blob([blob], { type: data.mime }) : blob);
      triggerDownload(url, data.datei);
      setTimeout(() => URL.revokeObjectURL(url), 20_000);
    } finally { setHolt(false); }
  };

  return (
    <>
      <div className="sheet-head">
        <DragTitle
          value={data.title ?? 'Rechen-Tabelle'}
          onChange={(t) => updateNodeData(id, { title: t })}
        />
        <div className="sheet-tools nodrag">
          {/* M313: Das Häufigste sichtbar (Zeile), der Rest im ⋯ */}
          <button onClick={() => updateNodeData(id, { rows: rows + 1 })} title="Zeile anhängen" aria-label="Zeile anhängen">
            <IPlus size={13} /> Zeile
          </button>
          <MenuHuelle titel="Mehr: Spalte, Auto-Summe, CSV" klasse="kopf-mehr" kinder={(zu) => (
            <>
              {/* M528: mit einer Auswahl — dieselben Schritte wie im Rechtsklick-Menü der Köpfe */}
              {r && (
                <>
                  <div className="ebenen-menu-titel">Zeilen und Spalten</div>
                  <button role="menuitem" data-taste="sheet-zeile-einfuegen" onClick={() => { const x = spanne('z'); umbauen('z', x.bei, x.n); zu(); }}><IArrowUp size={14} /> Zeile oberhalb einfügen</button>
                  <button role="menuitem" data-taste="sheet-zeile-loeschen" onClick={() => { const x = spanne('z'); umbauen('z', x.bei, -x.n); zu(); }}><ITrash size={14} /> Zeile löschen</button>
                  <button role="menuitem" data-taste="sheet-spalte-einfuegen" onClick={() => { const x = spanne('s'); umbauen('s', x.bei, x.n); zu(); }}><IChevronL size={14} /> Spalte links einfügen</button>
                  <button role="menuitem" data-taste="sheet-spalte-loeschen" onClick={() => { const x = spanne('s'); umbauen('s', x.bei, -x.n); zu(); }}><ITrash size={14} /> Spalte löschen</button>
                  <div className="ebenen-menu-titel">Mehr</div>
                </>
              )}
              {/* M520: bei 26 Spalten (A bis Z) ist Schluss — der Knopf sagt es, statt nichts zu tun */}
              <button role="menuitem" onClick={() => { if (cols >= 26) showToast('Mehr als 26 Spalten (A bis Z) fasst die Tabelle nicht.'); else updateNodeData(id, { cols: cols + 1 }); zu(); }} aria-label="Spalte anhängen">
                <IPlus size={14} /> Spalte anhängen
              </button>
              <button role="menuitem" onClick={() => { autoSumme(); zu(); }} title="Schreibt unter jede Zahlenspalte =SUMME(…)" aria-label="Auto-Summe">
                <ISigma size={14} /> Auto-Summe
              </button>
              {/* M407: Datentabelle – Filterknöpfe in der Kopfzeile */}
              <button role="menuitemcheckbox" aria-checked={filterAn} data-taste="sheet-filter-an" title="Kopfzeile mit Knöpfen zum Sortieren und Auswählen"
                onClick={() => { updateNodeData(id, filterAn ? { filterAn: false, filter: undefined, sort: undefined } : { filterAn: true, kopf }); zu(); }}>
                {filterAn ? <ICheck size={14} /> : <IFilter size={14} />} Filtern und sortieren
              </button>
              {filterAn && (
                <>
                  <button role="menuitem" data-taste="sheet-kopf-runter" aria-disabled={kopf >= rows - 1} onClick={() => { if (kopf < rows - 1) updateNodeData(id, { kopf: kopf + 1, bis: undefined, filter: undefined, sort: undefined }); }}>
                    <IArrowDown size={14} /> Kopfzeile eine Zeile tiefer
                  </button>
                  <button role="menuitem" data-taste="sheet-kopf-hoch" aria-disabled={kopf <= 1} onClick={() => { if (kopf > 1) updateNodeData(id, { kopf: kopf - 1, bis: undefined, filter: undefined, sort: undefined }); }}>
                    <IArrowUp size={14} /> Kopfzeile eine Zeile höher
                  </button>
                </>
              )}
              <div className="ebenen-menu-titel">Weitergeben</div>
              <button role="menuitem" onClick={() => { csv(); zu(); }} title="Öffnet sich in Excel, LibreOffice und Numbers" aria-label="Als CSV speichern">
                <IDownload size={14} /> Als CSV speichern
              </button>
              {data.datei && (
                <button role="menuitem" data-taste="sheet-original-menu" onClick={() => { void original(); zu(); }} title="Die eingefügte Datei, unverändert" aria-label="Excel-Datei herunterladen">
                  <IDownload size={14} /> Excel-Datei herunterladen
                </button>
              )}
            </>
          )} />
        </div>
      </div>

      {data.quelle && (
        <div className="sheet-quelle">
          <span className="sheet-quelle-text">Quelle: <b translate="no">{data.quelle}</b> – Formeln übernommen, Änderungen bleiben hier</span>
          {/* M406: das Original bleibt bei der Tabelle */}
          {data.datei && (
            <button className="sheet-original nodrag" data-taste="sheet-original" onClick={() => void original()} aria-busy={holt}
              title="Die eingefügte Excel-Datei herunterladen – unverändert" aria-label="Excel-Datei herunterladen">
              <IDownload size={13} /> Original
            </button>
          )}
        </div>
      )}

      <div className="sheet-scroll nodrag" ref={rollRef}>
        {/* M409: Spalten behalten eine lesbare Breite – passt nicht alles in die Karte, rollt die Tabelle seitwärts
            (statt jede Spalte auf wenige Zeichen zu quetschen) */}
        {/* M528: hält den Fokus, solange Zellen ausgewählt sind — Tasten und Zwischenablage der Auswahl */}
        <textarea ref={ablage} className="sheet-ablage" aria-label={r ? `Auswahl ${indexZuAdresse(r.s0, r.z0)}${r.s1 > r.s0 || r.z1 > r.z0 ? `:${indexZuAdresse(r.s1, r.z1)}` : ''}` : 'Auswahl'}
          tabIndex={-1} inputMode="none" spellCheck={false} data-rechtschreibung="aus" autoComplete="off" readOnly={false}
          onKeyDown={ablageTaste} onKeyUp={(e) => e.stopPropagation()}
          onCopy={(e) => { e.preventDefault(); kopieren(e.clipboardData, false); }}
          onCut={(e) => { e.preventDefault(); kopieren(e.clipboardData, true); }}
          onPaste={(e) => { e.preventDefault(); e.stopPropagation(); einfuegen(e.clipboardData.getData('text/plain')); }}
          onContextMenu={(e) => e.preventDefault()} />
        <table data-eigenes-menue className={`sheet-grid${filterAn ? ' datentabelle' : ''}${auswahl && !edit ? ' mit-auswahl' : ''}`} style={{ minWidth: 34 + Array.from({ length: cols }, (_, s) => data.colW?.[spaltenName(s)] ?? SPALTE_STD).reduce((x, y) => x + y, 0) }}>
          <colgroup>
            <col style={{ width: 34 }} />
            {Array.from({ length: cols }, (_, s) => (
              <col key={s} style={{ width: data.colW?.[indexZuAdresse(s, 0).replace(/\d+/, '')] }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="sheet-eck" />
              {Array.from({ length: cols }, (_, s) => {
                const name = indexZuAdresse(s, 0).replace(/\d+/, '');
                return (
                  <th key={s} className={`sheet-kopf${r && s >= r.s0 && s <= r.s1 ? ' gewaehlt' : ''}`} data-spalte={name}
                    onMouseDown={(e) => kopfRunter(e, 's', s)} onContextMenu={(e) => kontext(e, 's', s, 0)}>
                    {name}
                    {/* Spaltenbreite ziehen — bei importierten Listen stehen in
                        einer Spalte gern lange Texte, in der nächsten nur Zahlen */}
                    <span
                      className="sheet-breite"
                      title={`Breite der Spalte ${name} ziehen`}
                      onPointerDown={(e) => breiteZiehen(e, name)}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {reihen.map((zeile) => { const z = zeile - 1; const istKopf = filterAn && zeile === kopf; return (
              <tr key={z} className={istKopf ? 'sheet-kopfzeile' : filterAn && ansicht && zeile >= ansicht.bereich.von && zeile <= ansicht.bereich.bis ? 'sheet-datenzeile' : undefined} data-zeile={zeile}>
                <th className={`sheet-kopf sheet-zeilenkopf${gefiltert && ansicht && zeile >= ansicht.bereich.von && zeile <= ansicht.bereich.bis ? ' gefiltert' : ''}${r && z >= r.z0 && z <= r.z1 ? ' gewaehlt' : ''}`}
                  onMouseDown={(e) => kopfRunter(e, 'z', z)} onContextMenu={(e) => kontext(e, 'z', 0, z)}>{z + 1}</th>
                {Array.from({ length: cols }, (_, s) => {
                  const adr = indexZuAdresse(s, z);
                  // M409: Teil einer verbundenen Zelle – entfällt (über mehrere Zeilen nur, solange nicht gefiltert oder sortiert ist)
                  const decke = verbund.bedeckt.get(adr);
                  if (decke && (decke.gleicheZeile || !gefiltert)) return null;
                  const spanne = verbund.anker.get(adr);
                  const roh = cells[adr] ?? '';
                  const wert = werte[adr];
                  const gezeigt = anzeigeVon(adr);
                  const anzeige = gezeigt.text;
                  const fehler = anzeige.startsWith('#');
                  // M528: ein ausgerechnetes Datum steht rechtsbündig wie eine Zahl
                  const zahl = typeof wert === 'number' || (roh.startsWith('=') && tageVon(wert ?? null) !== null);
                  const stil = stilVon(adr);
                  const linie = (l: string | undefined, x: number, y: number) => (l ? `inset ${x * (parseInt(l, 10) || 1)}px ${y * (parseInt(l, 10) || 1)}px 0 ${l.split(' ').slice(2).join(' ') || 'currentColor'}` : '');
                  const zellStil: React.CSSProperties | undefined = stil ? {
                    ...(stil.bg ? { background: stil.bg, color: stil.fa ?? '#1b1e24' } : stil.fa ? { color: stil.fa } : {}),
                    ...(stil.a ? { textAlign: stil.a === 'm' ? 'center' : stil.a === 'r' ? 'right' : 'left' } : {}),
                    ...(stil.v ? { verticalAlign: stil.v === 'o' ? 'top' : 'middle' } : stil.um ? { verticalAlign: 'top' } : {}),
                    ...(stil.rr ? { borderRight: stil.rr } : {}), ...(stil.ru ? { borderBottom: stil.ru } : {}),
                    ...(stil.ro || stil.rl ? { boxShadow: [linie(stil.ro, 0, 1), linie(stil.rl, 1, 0)].filter(Boolean).join(', ') } : {}),
                  } : undefined;
                  const textStil: React.CSSProperties | undefined = stil || gezeigt.farbe ? {
                    ...(stil?.f ? { fontWeight: 700 } : {}), ...(stil?.k ? { fontStyle: 'italic' } : {}),
                    ...(stil?.u || stil?.d ? { textDecoration: [stil.u ? 'underline' : '', stil.d ? 'line-through' : ''].filter(Boolean).join(' ') } : {}),
                    ...(stil?.g ? { fontSize: `${Math.max(0.75, Math.min(2.2, stil.g / 11))}em` } : {}),
                    ...(gezeigt.farbe ? { color: gezeigt.farbe } : {}),
                  } : undefined;
                  const spalte = adr.replace(/\d+/g, '');
                  const link = edit === adr || fehler || anzeige === '' ? null : linkVon(adr, anzeige);
                  const spalteAktiv = istKopf && (!!data.filter?.[spalte] || data.sort?.spalte === spalte);
                  return (
                    <td key={s} className={`sheet-zelle${zahl ? ' zahl' : ''}${fehler ? ' fehler' : ''}${link ? ` mit-link${(stil?.a ? stil.a === 'r' : zahl) ? ' stift-links' : ''}` : ''}${istKopf ? ' mit-filter' : ''}${stil?.um ? ' umbruch' : ''}${stil?.bg ? ' gefuellt' : ''}${drin(r, s, z) && !edit ? ' gewaehlt' : ''}${auswahl && !edit && auswahl.a[0] === s && auswahl.a[1] === z ? ' anker' : ''}${drin(schnitt, s, z) ? ' ausgeschnitten' : ''}`}
                      style={zellStil} colSpan={spanne && spanne.cs > 1 ? spanne.cs : undefined} rowSpan={spanne && spanne.rs > 1 && !gefiltert ? spanne.rs : undefined}
                      data-zelle={adr} onPointerDown={(e) => zelleRunter(e, s, z)} onContextMenu={(e) => kontext(e, 'zelle', s, z)}
                      onClick={() => { if (gezogen.current) { gezogen.current = false; return; } if (edit !== adr) oeffne(adr); }}>
                      {edit === adr ? (
                        <input
                          ref={eingabe}
                          className="sheet-eingabe"
                          // M482: Text in der Zelle wird geprüft, Formeln und Zahlen nicht
                          data-rechtschreibung="formel"
                          value={entwurf}
                          onChange={(e) => setEntwurf(e.target.value)}
                          onBlur={(e) => { if (!(e.relatedTarget as HTMLElement | null)?.closest?.('.sheet-link-feld')) uebernimm(); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); uebernimm('runter'); }
                            else if (e.key === 'Tab') { e.preventDefault(); uebernimm('rechts'); }
                            else if (e.key === 'Escape') { e.preventDefault(); setEdit(null); ablageFokus(); }
                          }}
                          // Eigene Tastenkürzel der App sollen beim Tippen ruhen
                          onKeyUp={(e) => e.stopPropagation()}
                          autoFocus
                        />
                      ) : link ? (
                        <>
                          <span translate="no" style={textStil}>
                            <a className="sheet-link" href={link} target="_blank" rel="noopener noreferrer" data-taste="sheet-link" title={link}
                              onClick={(e) => e.stopPropagation()}>{anzeige}</a>
                          </span>
                          {/* der Text ist der Link – bearbeitet wird über den Stift (oder einen Klick daneben) */}
                          <button className="sheet-link-stift" data-taste="sheet-link-stift" title="Zelle und Link bearbeiten" aria-label="Zelle und Link bearbeiten"
                            onClick={(e) => { e.stopPropagation(); oeffne(adr); }}><IPen size={11} /></button>
                        </>
                      ) : (
                        <span translate="no" style={textStil} title={roh.startsWith('=') ? roh : undefined}>{anzeige}</span>
                      )}
                      {istKopf && edit !== adr && (
                        <button className={`sheet-filter-knopf${spalteAktiv ? ' an' : ''}`} data-taste="sheet-filter" data-spalte={spalte} aria-haspopup="dialog" aria-expanded={filterAuf?.spalte === spalte}
                          title="Sortieren und auswählen" aria-label={`Spalte ${spalte} sortieren und auswählen`}
                          onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setFilterAuf(filterAuf?.spalte === spalte ? null : { spalte, x: r.left, y: r.bottom + 4 }); }}>
                          {data.sort?.spalte === spalte ? (data.sort.ab ? <IArrowDown size={11} /> : <IArrowUp size={11} />) : <IFilter size={11} />}
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ); })}
          </tbody>
        </table>
      </div>

      <div className="sheet-fuss">
        {edit ? (
          <>
            <span className="sheet-fuss-text"><b>{edit}</b> – Formeln beginnen mit <code>=</code>, z. B. <code>=SUMME(A1:A5)</code>. Enter übernimmt.</span>
            {/* M407: der Link dieser Zelle */}
            <label className="sheet-link-feld nodrag">
              <span>Link</span>
              <input value={linkEntwurf} placeholder="https://… (optional)" data-taste="sheet-link-feld" aria-label="Link dieser Zelle" spellCheck={false} data-rechtschreibung="aus" inputMode="url"
                onChange={(e) => setLinkEntwurf(e.target.value)}
                onBlur={(e) => { if (!(e.relatedTarget as HTMLElement | null)?.classList?.contains('sheet-eingabe')) uebernimm(); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); uebernimm(); } else if (e.key === 'Escape') { e.preventDefault(); setEdit(null); } e.stopPropagation(); }}
                onKeyUp={(e) => e.stopPropagation()} />
            </label>
          </>
        ) : gefiltert && ansicht ? (
          <>
            <span className="sheet-fuss-text" data-taste="sheet-filter-stand">{`${ansicht.gezeigt} von ${zahlWort(ansicht.daten, 'Zeile', 'Zeilen')}`}</span>
            <button className="sheet-filter-weg nodrag" data-taste="sheet-filter-weg" onClick={() => updateNodeData(id, { filter: undefined, sort: undefined })}>Filter aufheben</button>
          </>
        ) : r ? (
          <span className="sheet-fuss-text" data-taste="sheet-auswahl-stand">{`${indexZuAdresse(r.s0, r.z0)}${r.s1 > r.s0 || r.z1 > r.z0 ? `:${indexZuAdresse(r.s1, r.z1)}` : ''} · Strg+C, Strg+X, Strg+V · Rechtsklick: Zeilen und Spalten`}</span>
        ) : <>Zelle antippen zum Bearbeiten · <code>=</code> beginnt eine Formel · Σ setzt Summen</>}
      </div>
      {menue && r && createPortal(
        <UmbauMenue x={menue.x} y={menue.y} zu={() => setMenue(null)}
          zeilen={menue.art !== 's' ? spanne('z') : null} spalten={menue.art !== 'z' ? spanne('s') : null} umbauen={umbauen} />,
        document.body,
      )}
      {filterAuf && ansicht && createPortal(
        <SpaltenFilter
          spalte={filterAuf.spalte} x={filterAuf.x} y={filterAuf.y}
          werte={spaltenWerte(filterAuf.spalte, ansicht.bereich, (a) => werte[a], text)}
          gewaehlt={data.filter?.[filterAuf.spalte] ?? null}
          sort={data.sort?.spalte === filterAuf.spalte ? (data.sort.ab ? 'ab' : 'auf') : null}
          onSort={(r) => updateNodeData(id, { sort: r ? { spalte: filterAuf.spalte, ab: r === 'ab' } : undefined })}
          onFilter={(liste) => { const f = { ...(data.filter ?? {}) }; if (liste) f[filterAuf.spalte] = liste; else delete f[filterAuf.spalte]; updateNodeData(id, { filter: Object.keys(f).length ? f : undefined }); }}
          zu={() => setFilterAuf(null)} />,
        document.body,
      )}
    </>
  );
}

/**
 * M528: Rechtsklick auf einen Zeilen- oder Spaltenkopf (oder eine Zelle): einfügen und löschen. Sind mehrere
 * Zeilen/Spalten ausgewählt, gilt der Schritt für alle („3 Zeilen oberhalb einfügen").
 */
function UmbauMenue({ x, y, zu, zeilen, spalten, umbauen }: {
  x: number; y: number; zu: () => void;
  zeilen: { bei: number; n: number } | null; spalten: { bei: number; n: number } | null;
  umbauen: (a: 'z' | 's', bei: number, n: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const zuRef = useRef(zu); zuRef.current = zu;
  useLayoutEffect(() => { insBild(box.current); box.current?.querySelector('button')?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const raus = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) zuRef.current(); };
    window.addEventListener('pointerdown', raus, true);
    return () => window.removeEventListener('pointerdown', raus, true);
  }, []);
  useEscSchliesst(true, zu);
  const wie = (n: number, eins: string, viele: string, rest: string): string => (n === 1 ? `${eins} ${rest}` : `${zahlWort(n, eins, viele)} ${rest}`);
  const eintrag = (taste: string, icon: React.ReactNode, text: string, tun: () => void) => (
    <button role="menuitem" data-taste={taste} onClick={() => { tun(); zu(); }}>{icon} {text}</button>
  );
  return (
    <div ref={box} className="ebenen-menu" role="menu" data-taste="sheet-umbau-menu" style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()} onKeyUp={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const k = [...(box.current?.querySelectorAll('button') ?? [])];
        const i = k.indexOf(document.activeElement as HTMLButtonElement);
        k[(i + (e.key === 'ArrowDown' ? 1 : -1) + k.length) % k.length]?.focus();
      }}>
      {zeilen && (
        <>
          {eintrag('sheet-zeile-oben', <IArrowUp size={14} />, wie(zeilen.n, 'Zeile', 'Zeilen', 'oberhalb einfügen'), () => umbauen('z', zeilen.bei, zeilen.n))}
          {eintrag('sheet-zeile-unten', <IArrowDown size={14} />, wie(zeilen.n, 'Zeile', 'Zeilen', 'unterhalb einfügen'), () => umbauen('z', zeilen.bei + zeilen.n, zeilen.n))}
          {eintrag('sheet-zeile-weg', <ITrash size={14} />, wie(zeilen.n, 'Zeile', 'Zeilen', 'löschen'), () => umbauen('z', zeilen.bei, -zeilen.n))}
        </>
      )}
      {zeilen && spalten && <div className="ebenen-menu-titel" />}
      {spalten && (
        <>
          {eintrag('sheet-spalte-links', <IChevronL size={14} />, wie(spalten.n, 'Spalte', 'Spalten', 'links einfügen'), () => umbauen('s', spalten.bei, spalten.n))}
          {eintrag('sheet-spalte-rechts', <IChevronR size={14} />, wie(spalten.n, 'Spalte', 'Spalten', 'rechts einfügen'), () => umbauen('s', spalten.bei + spalten.n, spalten.n))}
          {eintrag('sheet-spalte-weg', <ITrash size={14} />, wie(spalten.n, 'Spalte', 'Spalten', 'löschen'), () => umbauen('s', spalten.bei, -spalten.n))}
        </>
      )}
    </div>
  );
}

/**
 * M407: Das Fenster am Filterknopf einer Spalte – sortieren (auf, ab, aufheben) und Werte auswählen.
 * Jede Änderung wirkt sofort; es schließt beim Klick daneben oder mit Esc.
 */
function SpaltenFilter({ spalte, x, y, werte, gewaehlt, sort, onSort, onFilter, zu }: {
  spalte: string; x: number; y: number;
  werte: Array<{ text: string; zahl: number }>;
  /** null = alle */
  gewaehlt: string[] | null;
  sort: 'auf' | 'ab' | null;
  onSort: (r: 'auf' | 'ab' | null) => void;
  onFilter: (liste: string[] | null) => void;
  zu: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [suche, setSuche] = useState('');
  const zuRef = useRef(zu); zuRef.current = zu;
  useEffect(() => {
    const raus = (e: PointerEvent) => {
      const z = e.target as Element | null;
      if (z && (box.current?.contains(z) || z.closest?.('.sheet-filter-knopf'))) return;
      zuRef.current();
    };
    const taste = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); zuRef.current(); } };
    window.addEventListener('pointerdown', raus, true);
    window.addEventListener('keydown', taste, true);
    return () => { window.removeEventListener('pointerdown', raus, true); window.removeEventListener('keydown', taste, true); };
  }, []);
  // ganz ins Bild rücken
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) el.style.left = `${Math.max(8, window.innerWidth - 8 - r.width)}px`;
    if (r.bottom > window.innerHeight - 8) el.style.top = `${Math.max(8, window.innerHeight - 8 - r.height)}px`;
  }, [x, y]);
  const menge = new Set(gewaehlt ?? werte.map((w) => w.text));
  const sichtbar = werte.filter((w) => !suche.trim() || w.text.toLowerCase().includes(suche.trim().toLowerCase()));
  const setze = (neu: Set<string>) => onFilter(werte.every((w) => neu.has(w.text)) ? null : werte.filter((w) => neu.has(w.text)).map((w) => w.text));
  return (
    <div ref={box} className="ebenen-menu sheet-filter-menu" role="dialog" aria-label={`Spalte ${spalte} sortieren und auswählen`} data-taste="sheet-filter-menu" style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} onKeyUp={(e) => e.stopPropagation()}>
      <button role="menuitemradio" aria-checked={sort === 'auf'} data-taste="sheet-sort-auf" onClick={() => onSort(sort === 'auf' ? null : 'auf')}>
        <IArrowUp size={14} /> Aufsteigend sortieren{sort === 'auf' && <span className="sheet-filter-haken"><ICheck size={13} /></span>}
      </button>
      <button role="menuitemradio" aria-checked={sort === 'ab'} data-taste="sheet-sort-ab" onClick={() => onSort(sort === 'ab' ? null : 'ab')}>
        <IArrowDown size={14} /> Absteigend sortieren{sort === 'ab' && <span className="sheet-filter-haken"><ICheck size={13} /></span>}
      </button>
      <div className="ebenen-menu-titel">Auswählen</div>
      {werte.length > 8 && (
        <input className="sheet-filter-suche" value={suche} placeholder="Suchen …" aria-label="Werte suchen" data-taste="sheet-filter-suche" onChange={(e) => setSuche(e.target.value)} />
      )}
      <div className="sheet-filter-zeile">
        <button data-taste="sheet-filter-alle" onClick={() => { const n = new Set(menge); for (const w of sichtbar) n.add(w.text); setze(n); }}>Alle</button>
        <button data-taste="sheet-filter-keine" onClick={() => { const n = new Set(menge); for (const w of sichtbar) n.delete(w.text); setze(n); }}>Keine</button>
      </div>
      <div className="sheet-filter-liste" role="group" aria-label="Werte">
        {sichtbar.slice(0, 300).map((w) => (
          <label key={w.text} data-taste="sheet-filter-wert" data-wert={w.text}>
            <input type="checkbox" checked={menge.has(w.text)} onChange={() => { const n = new Set(menge); if (n.has(w.text)) n.delete(w.text); else n.add(w.text); setze(n); }} />
            <span className="sheet-filter-text" translate={w.text === '' ? undefined : 'no'}>{w.text === '' ? '(Leer)' : w.text}</span>
            <span className="sheet-filter-zahl">{w.zahl}</span>
          </label>
        ))}
        {sichtbar.length > 300 && <div className="sheet-filter-mehr">{`${sichtbar.length - 300} weitere – mit der Suche eingrenzen`}</div>}
        {sichtbar.length === 0 && <div className="sheet-filter-mehr">Nichts gefunden</div>}
      </div>
    </div>
  );
}
