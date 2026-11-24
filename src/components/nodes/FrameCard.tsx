import { useEffect, useRef, useState } from 'react';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { selectActiveBoard, useBoard } from '../../store';
import type { FrameNode } from '../../types';
import { frameMembers } from '../../lib/arrange';
import { zahlWort } from '../../lib/sprache';
import { rahmenReiseStarten } from '../../lib/rahmenReise';
import { overlayOffen } from '../../lib/overlay';

/**
 * Frame (M149/M150): benannter Rahmen-Bereich à la Miro. Liegt hinter allen
 * Karten, wird NUR an der Titel-Leiste gezogen und nimmt dabei seine
 * Mitglieder mit (Mittelpunkt-Regel, Logik in Board.tsx). Seit M150 eine
 * echte Struktur-Ebene: Verbindungspunkte an den Seiten (Rahmen lassen sich
 * wie Module verbinden), und das Board-Aufräumen behandelt Rahmen+Inhalt als
 * EIN Modul. Seit M181 trägt der Rahmenkopf KEINE eigenen Werkzeuge mehr —
 * Anordnen, Tönung, Umbenennen, Verschieben und Löschen leben gebündelt in
 * der Auswahl-Leiste (ein Menü statt zwei, User-Screenshot); hier bleibt nur
 * das Doppelklick-Umbenennen direkt am Titel.
 * M514: Der Doppelklick auf den Titel präsentiert jetzt den Rahmen (Rahmen-Reise, components/RahmenReise.tsx) —
 * Umbenennen bleibt im Rahmen-Menü (Rechtsklick oder Auswahl-Leiste) und mit F2 am gewählten Rahmen.
 */
export function FrameCard({ id, data, selected }: NodeProps<FrameNode>) {
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  // Mitglieder-Zähler in der Titel-Leiste — macht das „Einfangen" sichtbar
  const memberCount = useBoard((s) => {
    const b = selectActiveBoard(s);
    const me = b.nodes.find((n) => n.id === id);
    return me ? frameMembers(me, b.nodes).length : 0;
  });

  const tint = (data.color as string) || '';
  // M514: F2 am gewählten Rahmen benennt ihn direkt am Titel um (wie bisher der Doppelklick)
  useEffect(() => {
    if (!selected || editing) return;
    const taste = (e: KeyboardEvent) => {
      if (e.key !== 'F2' || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      // M521: Liegt ein Fenster darüber (Einstellungen, Hilfe, Suche), gehört die Taste ihm — sonst ging dahinter das
      // Namensfeld auf und zog den Fokus aus dem Fenster
      if (overlayOffen()) return;
      e.preventDefault();
      setDraft(data.name); setEditing(true);
    };
    window.addEventListener('keydown', taste);
    return () => window.removeEventListener('keydown', taste);
  }, [selected, editing, data.name]);
  // M514: Gewählt liegen die Anfass-Linien des Rahmens über dem Titel — im weiten Zoom ganz (der Titel ist dann nur
  // wenige Punkte hoch). Der Doppelklick landet so auf der Linie, nicht am Titel: am Ort des Titels trotzdem präsentieren.
  const kopfRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected || editing) return;
    const doppel = (e: MouseEvent) => {
      const k = kopfRef.current;
      if (!k || k.contains(e.target as Node)) return;
      if (!(e.target as Element | null)?.closest?.('.react-flow__resize-control')) return;
      const r = k.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      e.stopPropagation();
      rahmenReiseStarten(useBoard.getState().activeId, id);
    };
    window.addEventListener('dblclick', doppel, true);
    return () => window.removeEventListener('dblclick', doppel, true);
  }, [selected, editing, id]);
  const commit = () => {
    updateNodeData(id, { name: draft.trim() || 'Rahmen' });
    setEditing(false);
  };

  return (
    <div className={`frame-wrap ${selected ? 'selected' : ''}`}>
      {/* M152: Die Standard-Resizer-LINIEN sind eckig und ragen über die
          abgerundeten Rahmen-Ecken hinaus (User-Screenshot „Kanten nicht
          sauber") — unsichtbar schalten (ziehbar bleiben sie), die Auswahl
          zeigt der abgerundete Akzent-Rand des Rahmens selbst; Griffe als
          dezente runde Punkte im Karten-Stil */}
      <NodeResizer
        onResizeStart={() => useBoard.getState().pushHistory()}
        isVisible={selected}
        minWidth={260}
        minHeight={180}
        lineStyle={{ border: 'none' }}
        handleStyle={{
          width: 11, height: 11, borderRadius: 999,
          background: '#fff', border: '2px solid var(--accent)', boxShadow: '0 1px 3px rgba(22,25,30,.25)',
        }}
      />
      {/* Verbindungspunkte (M150): Rahmen lassen sich wie Module verbinden */}
      {[Position.Top, Position.Right, Position.Bottom, Position.Left].map((pos) => (
        <Handle key={pos} type="source" position={pos} id={pos} className="pn-handle frame-handle" />
      ))}
      <div
        ref={kopfRef}
        className="frame-head"
        title="Ziehen verschiebt den Rahmen samt Inhalt, Doppelklick präsentiert ab diesem Rahmen"
        onDoubleClick={(e) => {
          if (editing) return;
          e.stopPropagation();
          rahmenReiseStarten(useBoard.getState().activeId, id);
        }}
      >
        {editing ? (
          <input
            autoFocus
            className="frame-name-input nodrag"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          />
        ) : (
          <span className="frame-name" translate="no">
            {data.name}
          </span>
        )}
        {memberCount > 0 && <span className="frame-count" title={`${zahlWort(memberCount, 'Karte', 'Karten')} in diesem Rahmen – sie wandern mit dem Rahmen mit`}>{memberCount}</span>}
      </div>
      <div className="frame-body" style={tint ? { background: `${tint}55` } : undefined} />
    </div>
  );
}
