import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NodeProps } from '@xyflow/react';
import { useBoard } from '../../store';
import type { SheetData, SheetNode } from '../../types';
import { CardShell } from './CardShell';
import { DragTitle } from './DragTitle';
import { indexZuAdresse, rechneBlatt, zeigeWert } from '../../lib/formel';
import { alsCsv } from '../../lib/xlsx';
import { IPlus, ISigma, IDownload, IFilter, ICheck, IArrowUp, IArrowDown, IPen } from '../Icons';
import { ersteZeile, gezeigteZeilen, hyperlinkZiel, sichererLink, spaltenWerte } from '../../lib/tabellenAnsicht';
import { MenuHuelle } from '../EbenenMenu';
import { loadFile } from '../../lib/fileStore';
import { triggerDownload } from '../../lib/download';

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
export function SheetBody({ id, data }: { id: string; data: SheetData }) {
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const showToast = useBoard((s) => s.showToast);
  const cells = useMemo(() => data.cells ?? {}, [data.cells]);
  const cols = Math.max(1, data.cols ?? 5);
  const rows = Math.max(1, data.rows ?? 8);
  /** Welche Zelle wird gerade bearbeitet — dort steht die Formel, nicht das Ergebnis */
  const [edit, setEdit] = useState<string | null>(null);
  const [entwurf, setEntwurf] = useState('');
  const eingabe = useRef<HTMLInputElement | null>(null);

  /** Ein Durchgang für die ganze Tabelle — Zellen dürfen aufeinander zeigen */
  const werte = useMemo(() => rechneBlatt(cells), [cells]);

  /**
   * M407: Datentabelle. Mit eingeschaltetem Filter trägt die Kopfzeile je Spalte einen Knopf zum Sortieren und
   * Auswählen; beides ist eine Ansicht (lib/tabellenAnsicht.ts) – die Zellen bleiben an ihrem Platz, Formeln rechnen
   * unverändert, die Zeilennummern am Rand bleiben die echten.
   */
  const kopf = Math.min(Math.max(1, data.kopf ?? ersteZeile(cells, rows)), rows);
  const filterAn = !!data.filterAn;
  const text = useCallback((adr: string) => zeigeWert(werte[adr] ?? null), [werte]);
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
  const linkVon = (adr: string, roh: string, anzeige: string): string | null => {
    const fest = data.links?.[adr];
    if (fest) return sichererLink(fest);
    if (roh.startsWith('=')) { const h = hyperlinkZiel(roh); return h ? sichererLink(h.adresse ?? String(werte[h.zelle ?? ''] ?? '')) : null; }
    return sichererLink(anzeige);
  };

  const oeffne = (adr: string) => {
    setEdit(adr);
    setEntwurf(cells[adr] ?? '');
    setLinkEntwurf(data.links?.[adr] ?? '');
    requestAnimationFrame(() => eingabe.current?.select());
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
    updateNodeData(id, { cells: neu, ...(linksGeaendert ? { links: Object.keys(links).length ? links : undefined } : {}) });
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
              <button role="menuitem" onClick={() => { updateNodeData(id, { cols: Math.min(26, cols + 1) }); zu(); }} aria-label="Spalte anhängen">
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

      <div className="sheet-scroll nodrag">
        <table className={`sheet-grid${filterAn ? ' datentabelle' : ''}`}>
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
                  <th key={s} className="sheet-kopf">
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
                <th className={`sheet-kopf sheet-zeilenkopf${gefiltert && ansicht && zeile >= ansicht.bereich.von && zeile <= ansicht.bereich.bis ? ' gefiltert' : ''}`}>{z + 1}</th>
                {Array.from({ length: cols }, (_, s) => {
                  const adr = indexZuAdresse(s, z);
                  const roh = cells[adr] ?? '';
                  const wert = werte[adr];
                  const anzeige = zeigeWert(wert ?? null);
                  const fehler = anzeige.startsWith('#');
                  const zahl = typeof wert === 'number';
                  const spalte = adr.replace(/\d+/g, '');
                  const link = edit === adr || fehler || anzeige === '' ? null : linkVon(adr, roh, anzeige);
                  const spalteAktiv = istKopf && (!!data.filter?.[spalte] || data.sort?.spalte === spalte);
                  return (
                    <td key={s} className={`sheet-zelle${zahl ? ' zahl' : ''}${fehler ? ' fehler' : ''}${link ? ' mit-link' : ''}${istKopf ? ' mit-filter' : ''}`}
                      onClick={() => edit !== adr && oeffne(adr)}>
                      {edit === adr ? (
                        <input
                          ref={eingabe}
                          className="sheet-eingabe"
                          value={entwurf}
                          onChange={(e) => setEntwurf(e.target.value)}
                          onBlur={(e) => { if (!(e.relatedTarget as HTMLElement | null)?.closest?.('.sheet-link-feld')) uebernimm(); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); uebernimm('runter'); }
                            else if (e.key === 'Tab') { e.preventDefault(); uebernimm('rechts'); }
                            else if (e.key === 'Escape') { e.preventDefault(); setEdit(null); }
                          }}
                          // Eigene Tastenkürzel der App sollen beim Tippen ruhen
                          onKeyUp={(e) => e.stopPropagation()}
                          autoFocus
                        />
                      ) : link ? (
                        <>
                          <span translate="no">
                            <a className="sheet-link" href={link} target="_blank" rel="noopener noreferrer" data-taste="sheet-link" title={link}
                              onClick={(e) => e.stopPropagation()}>{anzeige}</a>
                          </span>
                          {/* der Text ist der Link – bearbeitet wird über den Stift (oder einen Klick daneben) */}
                          <button className="sheet-link-stift" data-taste="sheet-link-stift" title="Zelle und Link bearbeiten" aria-label="Zelle und Link bearbeiten"
                            onClick={(e) => { e.stopPropagation(); oeffne(adr); }}><IPen size={11} /></button>
                        </>
                      ) : (
                        <span translate="no" title={roh.startsWith('=') ? roh : undefined}>{anzeige}</span>
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
              <input value={linkEntwurf} placeholder="https://… (optional)" data-taste="sheet-link-feld" aria-label="Link dieser Zelle" spellCheck={false} inputMode="url"
                onChange={(e) => setLinkEntwurf(e.target.value)}
                onBlur={(e) => { if (!(e.relatedTarget as HTMLElement | null)?.classList?.contains('sheet-eingabe')) uebernimm(); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); uebernimm(); } else if (e.key === 'Escape') { e.preventDefault(); setEdit(null); } e.stopPropagation(); }}
                onKeyUp={(e) => e.stopPropagation()} />
            </label>
          </>
        ) : gefiltert && ansicht ? (
          <>
            <span className="sheet-fuss-text" data-taste="sheet-filter-stand">{`${ansicht.gezeigt} von ${ansicht.daten} Zeilen`}</span>
            <button className="sheet-filter-weg nodrag" data-taste="sheet-filter-weg" onClick={() => updateNodeData(id, { filter: undefined, sort: undefined })}>Filter aufheben</button>
          </>
        ) : <>Zelle antippen zum Bearbeiten · <code>=</code> beginnt eine Formel · Σ setzt Summen</>}
      </div>
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
