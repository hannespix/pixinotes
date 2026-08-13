import { useEffect, useMemo, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import type { PartialBlock } from '@blocknote/core';
import { de as blockNoteDe } from '@blocknote/core/locales';
import { useBoard } from '../../store';
import { STICKY_COLORS, uid, type MinutesData, type MinutesNode } from '../../types';
import { allDecisions, buildEntry, currentEntry, entryLabel, nextDate, sortEntries } from '../../lib/minutes';
import { repairBlocks } from '../../lib/htmlBlocks';
import { useAndroidBackspaceFix } from '../../lib/blocknoteAndroidFix';
import { NoteToolbar, noteSchema } from '../NoteTypo';
import { CardShell } from './CardShell';
import { DragTitle } from './DragTitle';
import { IChevronL, IChevronR, IPlus, ISettings, IX } from '../Icons';

/**
 * Protokoll-Reihe (M186): eine Karte für eine ganze Besprechungsserie.
 *
 * Angezeigt wird immer genau EINE Sitzung — geblättert wird mit ◀ ▶ oder über
 * die Datumsliste. Der Editor wird bewusst bei jedem Sitzungswechsel neu
 * aufgebaut (key={entry.id}): BlockNote liest seinen Inhalt nur beim Mount,
 * sonst zeigte das Blättern hartnäckig die vorige Sitzung.
 */
export function MinutesCard({ id, data, selected }: NodeProps<MinutesNode>) {
  const m = data as MinutesData;
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const showToast = useBoard((s) => s.showToast);
  const [setupOpen, setSetupOpen] = useState(false);
  // M187: Zugriff auf den LEBENDEN Editor der angezeigten Sitzung. Ein TOP wird
  // von ihm selbst eingefügt statt über den Speicher — sonst überholt der
  // Editor beim nächsten Neuaufbau die Änderung mit seinem alten Stand.
  const editorRef = useRef<{ document: unknown[]; insertBlocks: (b: unknown[], ref: unknown, pos: string) => void } | null>(null);
  const [decisionText, setDecisionText] = useState('');

  const sorted = useMemo(() => sortEntries(m.entries ?? []), [m.entries]);
  const entry = currentEntry(m);
  const idx = entry ? sorted.findIndex((e) => e.id === entry.id) : -1;

  const patch = (next: Partial<MinutesData>) => updateNodeData(id, next);
  const patchEntry = (entryId: string, next: Partial<typeof sorted[number]>) =>
    patch({ entries: (m.entries ?? []).map((e) => (e.id === entryId ? { ...e, ...next } : e)) });

  /** Neue Sitzung: Tagesordnung + offene Punkte der letzten Sitzung */
  const addEntry = () => {
    const date = nextDate(m);
    const fresh = buildEntry(m, date);
    const carried = (fresh.blocks ?? []).filter((b) => (b as { type?: string })?.type === 'checkListItem').length;
    patch({ entries: [...(m.entries ?? []), fresh], current: fresh.id });
    showToast(carried > 0
      ? `Neue Sitzung angelegt — ${carried} offene(r) Punkt(e) aus der letzten Sitzung übernommen.`
      : 'Neue Sitzung angelegt.');
  };

  const removeEntry = (entryId: string) => {
    const e = (m.entries ?? []).find((x) => x.id === entryId);
    if (e && !window.confirm(`Sitzung „${entryLabel(e)}" mit ihrem gesamten Protokoll löschen?`)) return;
    const rest = (m.entries ?? []).filter((x) => x.id !== entryId);
    patch({ entries: rest, current: sortEntries(rest)[0]?.id });
  };

  const go = (delta: number) => {
    if (sorted.length === 0) return;
    const next = sorted[Math.min(sorted.length - 1, Math.max(0, idx + delta))];
    if (next) patch({ current: next.id });
  };

  const addDecision = () => {
    const text = decisionText.trim();
    if (!text || !entry) return;
    patchEntry(entry.id, { decisions: [...(entry.decisions ?? []), { id: uid(), text }] });
    setDecisionText('');
  };

  const decisions = useMemo(() => allDecisions(m), [m]);

  /** M187: Farbe wie bei der Notiz-Karte — Punkt schaltet die Palette weiter */
  const cycleColor = () => {
    const cur = m.color ?? 'white';
    const next = STICKY_COLORS[(STICKY_COLORS.indexOf(cur) + 1) % STICKY_COLORS.length];
    patch({ color: next, hex: undefined });   // zurück zur Palette
  };

  /**
   * M187: Tagesordnungspunkt NUR für diese Sitzung. Der Punkt landet direkt
   * als Überschrift im Protokoll — bewusst ohne zweite Datenhaltung: Die TOPs
   * einer Sitzung leben in ihrem Text. So lassen sie sich im Editor frei
   * umbenennen, verschieben und löschen, ohne dass zwei Listen auseinanderlaufen.
   */
  const addTop = () => {
    if (!entry) return;
    const name = window.prompt('Tagesordnungspunkt für diese Sitzung:');
    if (!name?.trim()) return;
    const fresh = [
      { type: 'heading', props: { level: 3 }, content: name.trim() },
      { type: 'paragraph', content: '' },
    ];
    const ed = editorRef.current;
    if (ed && ed.document.length > 0) {
      // Der Editor fügt selbst ein; sein onChange schreibt in den Speicher
      ed.insertBlocks(fresh, ed.document[ed.document.length - 1], 'after');
    } else {
      patchEntry(entry.id, { blocks: [...((entry.blocks as unknown[]) ?? []), ...fresh] });
    }
    showToast(`TOP „${name.trim()}" angelegt — gilt nur für diese Sitzung.`);
  };

  /** TOPs der laufenden Sitzung: aus den Überschriften abgeleitet (eine Wahrheit) */
  const tops = useMemo(() => {
    const out: string[] = [];
    for (const b of ((entry?.blocks as Array<Record<string, unknown>>) ?? [])) {
      if (b?.type !== 'heading') continue;
      const c = b.content;
      const t = typeof c === 'string' ? c : Array.isArray(c) ? c.map((s) => (s as { text?: string })?.text ?? '').join('') : '';
      if (t.trim()) out.push(t.trim());
    }
    return out;
  }, [entry]);

  return (
    <CardShell
      id={id}
      selected={selected}
      minWidth={320}
      minHeight={300}
      className={`minutes-card sticky-${m.color ?? 'white'}`}
      style={m.hex ? { background: m.hex } : undefined}
    >
      <div className="minutes-head">
        <DragTitle
          value={m.title}
          onChange={(title: string) => patch({ title })}
          className="minutes-title"
          placeholder="Besprechungsreihe"
        />
        <button className="color-dot minutes-dot nodrag" title="Kartenfarbe wechseln (Palette)" onClick={cycleColor} />
        <input
          type="color"
          className="pn-colorpick minutes-colorpick nodrag"
          title="Eigene Kartenfarbe wählen"
          value={m.hex ?? '#ffffff'}
          onChange={(e) => patch({ hex: e.target.value })}
        />
        <button className="minutes-setup-btn nodrag" title="Reihe einrichten: feste Tagesordnung, Rhythmus, Wiedervorlage" onClick={() => setSetupOpen((o) => !o)}>
          <ISettings size={12} />
        </button>
        <button className="minutes-new nodrag" title="Neue Sitzung anlegen (übernimmt offene Punkte)" onClick={addEntry}>
          <IPlus size={12} />
        </button>
      </div>

      {setupOpen && (
        <div className="minutes-setup nodrag">
          <label>
            <span>Rhythmus</span>
            <select value={m.rhythm ?? ''} onChange={(e) => patch({ rhythm: e.target.value as MinutesData['rhythm'] })}>
              <option value="">frei</option>
              <option value="woche">wöchentlich</option>
              <option value="zweiwochen">14-tägig</option>
              <option value="monat">monatlich</option>
              <option value="quartal">vierteljährlich</option>
            </select>
          </label>
          <label className="minutes-carry">
            <input
              type="checkbox"
              checked={m.carryOpen !== false}
              onChange={(e) => patch({ carryOpen: e.target.checked })}
            />
            <span>Offene Punkte in die neue Sitzung übernehmen</span>
          </label>
          <div className="minutes-agenda">
            <b>Feste Tagesordnung</b>
            {(m.agenda ?? []).map((top, i) => (
              <div key={i} className="minutes-top">
                <input
                  value={top}
                  placeholder="TOP …"
                  onChange={(e) => patch({ agenda: (m.agenda ?? []).map((t, j) => (j === i ? e.target.value : t)) })}
                />
                <button title="Punkt entfernen" onClick={() => patch({ agenda: (m.agenda ?? []).filter((_, j) => j !== i) })}>
                  <IX size={10} />
                </button>
              </div>
            ))}
            <button className="minutes-add-top" onClick={() => patch({ agenda: [...(m.agenda ?? []), ''] })}>
              ＋ Tagesordnungspunkt
            </button>
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="minutes-empty">
          Noch keine Sitzung.
          <button className="nodrag" onClick={addEntry}>Erste Sitzung anlegen</button>
        </div>
      ) : (
        <>
          <div className="minutes-nav nodrag">
            <button disabled={idx >= sorted.length - 1} title="Ältere Sitzung" onClick={() => go(1)}><IChevronL size={12} /></button>
            <select
              value={entry?.id ?? ''}
              title="Sitzung auswählen"
              onChange={(e) => patch({ current: e.target.value })}
            >
              {sorted.map((e) => (
                <option key={e.id} value={e.id}>{entryLabel(e)}</option>
              ))}
            </select>
            <button disabled={idx <= 0} title="Neuere Sitzung" onClick={() => go(-1)}><IChevronR size={12} /></button>
            <span className="minutes-count" title="Diese Sitzung von insgesamt">
              {sorted.length - idx}/{sorted.length}
            </span>
            {entry && (
              <button className="minutes-del" title="Diese Sitzung löschen" onClick={() => removeEntry(entry.id)}>
                <IX size={11} />
              </button>
            )}
          </div>

          {entry && (
            <div className="minutes-meta nodrag">
              <input
                type="date"
                value={entry.date}
                title="Datum der Sitzung"
                onChange={(e) => patchEntry(entry.id, { date: e.target.value })}
              />
              <input
                type="text"
                placeholder="Teilnehmende …"
                value={entry.attendees ?? ''}
                title="Wer war dabei? (Freitext)"
                onChange={(e) => patchEntry(entry.id, { attendees: e.target.value || undefined })}
              />
            </div>
          )}

          {/* M187: Tagesordnung DIESER Sitzung — die feste Reihen-Vorlage im
              ⚙-Menü gilt für alle künftigen, hier kommt der Punkt dazu, den es
              nur heute braucht. */}
          {entry && (
            <div className="minutes-tops nodrag">
              {tops.map((t, i) => (
                <span key={i} className="minutes-top-chip" title="Tagesordnungspunkt dieser Sitzung (Überschrift im Protokoll)">{t}</span>
              ))}
              <button className="minutes-top-add" title="Tagesordnungspunkt nur für diese Sitzung anhängen" onClick={addTop}>
                ＋ TOP
              </button>
            </div>
          )}

          {entry && <EntryEditor key={entry.id} nodeId={id} entryId={entry.id} blocks={entry.blocks} editorRef={editorRef} />}

          {entry && (
            <div className="minutes-decisions nodrag">
              <b title="Beschlüsse sind Festlegungen, keine Aufgaben — sie bleiben dauerhaft nachschlagbar">
                Beschlüsse dieser Sitzung
              </b>
              {(entry.decisions ?? []).map((d) => (
                <div key={d.id} className="minutes-decision">
                  <span>§ {d.text}</span>
                  <button
                    title="Beschluss entfernen"
                    onClick={() => patchEntry(entry.id, { decisions: (entry.decisions ?? []).filter((x) => x.id !== d.id) })}
                  ><IX size={10} /></button>
                </div>
              ))}
              <input
                className="minutes-decision-add"
                placeholder="+ Beschluss festhalten…"
                value={decisionText}
                onChange={(e) => setDecisionText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addDecision(); }}
                onBlur={addDecision}
              />
              {decisions.length > (entry.decisions?.length ?? 0) && (
                <details className="minutes-all-decisions">
                  <summary>Beschlusslage der ganzen Reihe ({decisions.length})</summary>
                  {decisions.map((d, i) => (
                    <div key={i} className="minutes-decision old">
                      <span>§ {d.text}</span>
                      <em>{d.date}</em>
                    </div>
                  ))}
                </details>
              )}
            </div>
          )}
        </>
      )}
    </CardShell>
  );
}

/**
 * Protokolltext einer Sitzung. Eigene Komponente, damit der `key`-Wechsel
 * beim Blättern den Editor sauber neu aufbaut (BlockNote liest nur beim Mount).
 */
function EntryEditor({ nodeId, entryId, blocks, editorRef }: {
  nodeId: string; entryId: string; blocks?: unknown[];
  editorRef?: { current: unknown };
}) {
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const [initialContent] = useState<PartialBlock[] | undefined>(() => {
    const safe = repairBlocks(blocks) as PartialBlock[];
    return safe.length > 0 ? safe : undefined;
  });
  const editor = useCreateBlockNote({ schema: noteSchema, initialContent: initialContent as never, dictionary: blockNoteDe });
  useAndroidBackspaceFix(editor);
  if (editorRef) editorRef.current = editor;

  // Beim Verlassen der Sitzung (Blättern) den letzten Stand sichern —
  // onChange feuert nicht mehr, wenn die Komponente schon abgebaut wird
  const latest = useRef(editor);
  latest.current = editor;
  useEffect(() => () => {
    try {
      const st = useBoard.getState();
      const board = st.boards.find((b) => b.nodes.some((n) => n.id === nodeId));
      const node = board?.nodes.find((n) => n.id === nodeId);
      const cur = (node?.data as MinutesData | undefined)?.entries ?? [];
      if (!cur.some((e) => e.id === entryId)) return;   // Sitzung wurde gelöscht
      st.updateNodeData(nodeId, {
        entries: cur.map((e) => (e.id === entryId ? { ...e, blocks: latest.current.document } : e)),
      });
    } catch { /* Karte gerade im Abbau */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="minutes-body nodrag">
      {/* M267: dieselbe Formatier-Leiste wie in der Notiz-Karte. Das Schema
          kennt textSize/textFont schon länger — nur die Knöpfe fehlten hier,
          also stellte das Protokoll gestylten Text dar, ließ ihn aber nicht
          setzen oder zurücknehmen. */}
      <BlockNoteView
        editor={editor}
        theme="light"
        className="note-editor"
        formattingToolbar={false}
        onChange={() => {
          const st = useBoard.getState();
          const board = st.boards.find((b) => b.nodes.some((n) => n.id === nodeId));
          const cur = ((board?.nodes.find((n) => n.id === nodeId)?.data as MinutesData | undefined)?.entries) ?? [];
          updateNodeData(nodeId, {
            entries: cur.map((e) => (e.id === entryId ? { ...e, blocks: editor.document } : e)),
          });
        }}
      >
        <NoteToolbar />
      </BlockNoteView>
    </div>
  );
}
