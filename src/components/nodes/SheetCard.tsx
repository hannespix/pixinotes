import { useMemo, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useBoard } from '../../store';
import type { SheetNode } from '../../types';
import { CardShell } from './CardShell';
import { DragTitle } from './DragTitle';
import { indexZuAdresse, rechneBlatt, zeigeWert } from '../../lib/formel';
import { alsCsv } from '../../lib/xlsx';
import { IPlus, ISigma, IDownload, IX } from '../Icons';

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

  const setzeZelle = (adr: string, roh: string) => {
    const neu = { ...cells };
    if (roh.trim() === '') delete neu[adr]; else neu[adr] = roh;
    updateNodeData(id, { cells: neu });
  };

  const oeffne = (adr: string) => {
    setEdit(adr);
    setEntwurf(cells[adr] ?? '');
    requestAnimationFrame(() => eingabe.current?.select());
  };

  const uebernimm = (weiter?: 'runter' | 'rechts') => {
    if (!edit) return;
    setzeZelle(edit, entwurf);
    const sp = edit.replace(/\d+/g, '');
    const z = Number(edit.replace(/\D+/g, ''));
    let spIdx = 0;
    for (const c of sp) spIdx = spIdx * 26 + (c.charCodeAt(0) - 64);
    spIdx -= 1;
    if (weiter === 'runter' && z < rows) oeffne(indexZuAdresse(spIdx, z));
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

  return (
    <CardShell id={id} selected={selected} minWidth={260} minHeight={160} className="sheet-card">
      <div className="sheet-head">
        <DragTitle
          value={data.title ?? 'Rechen-Tabelle'}
          onChange={(t) => updateNodeData(id, { title: t })}
        />
        <div className="sheet-tools nodrag">
          <button onClick={autoSumme} title="Auto-Summe: schreibt unter jede Zahlenspalte =SUMME(…)" aria-label="Auto-Summe">
            <ISigma size={14} />
          </button>
          <button onClick={() => updateNodeData(id, { rows: rows + 1 })} title="Zeile anhängen" aria-label="Zeile anhängen">
            <IPlus size={13} /> Zeile
          </button>
          <button onClick={() => updateNodeData(id, { cols: Math.min(26, cols + 1) })} title="Spalte anhängen" aria-label="Spalte anhängen">
            <IPlus size={13} /> Spalte
          </button>
          <button onClick={csv} title="Als CSV speichern — öffnet sich in Excel, LibreOffice und Numbers" aria-label="Als CSV speichern">
            <IDownload size={14} />
          </button>
        </div>
      </div>

      {data.quelle && (
        <div className="sheet-quelle">
          aus <b>{data.quelle}</b> — Formeln übernommen, Änderungen bleiben hier
        </div>
      )}

      <div className="sheet-scroll nodrag">
        <table className="sheet-grid">
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
            {Array.from({ length: rows }, (_, z) => (
              <tr key={z}>
                <th className="sheet-kopf sheet-zeilenkopf">{z + 1}</th>
                {Array.from({ length: cols }, (_, s) => {
                  const adr = indexZuAdresse(s, z);
                  const roh = cells[adr] ?? '';
                  const wert = werte[adr];
                  const anzeige = zeigeWert(wert ?? null);
                  const fehler = anzeige.startsWith('#');
                  const zahl = typeof wert === 'number';
                  return (
                    <td key={s} className={`sheet-zelle${zahl ? ' zahl' : ''}${fehler ? ' fehler' : ''}`}
                      onClick={() => edit !== adr && oeffne(adr)}>
                      {edit === adr ? (
                        <input
                          ref={eingabe}
                          className="sheet-eingabe"
                          value={entwurf}
                          onChange={(e) => setEntwurf(e.target.value)}
                          onBlur={() => uebernimm()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); uebernimm('runter'); }
                            else if (e.key === 'Tab') { e.preventDefault(); uebernimm('rechts'); }
                            else if (e.key === 'Escape') { e.preventDefault(); setEdit(null); }
                          }}
                          // Eigene Tastenkürzel der App sollen beim Tippen ruhen
                          onKeyUp={(e) => e.stopPropagation()}
                          autoFocus
                        />
                      ) : (
                        <span title={roh.startsWith('=') ? roh : undefined}>{anzeige}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sheet-fuss">
        {edit
          ? <><b>{edit}</b> — Formeln beginnen mit <code>=</code>, z. B. <code>=SUMME(A1:A5)</code>. Enter übernimmt.</>
          : <>Zelle antippen zum Bearbeiten · <code>=</code> beginnt eine Formel · Σ setzt Summen</>}
      </div>
    </CardShell>
  );
}
