import { useState } from 'react';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { selectActiveBoard, useBoard } from '../../store';
import type { FrameNode } from '../../types';
import { frameMembers } from '../../lib/arrange';

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
  const commit = () => {
    updateNodeData(id, { name: draft.trim() || 'Bereich' });
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
        isVisible={selected}
        minWidth={260}
        minHeight={180}
        lineStyle={{ border: 'none' }}
        handleStyle={{
          width: 11, height: 11, borderRadius: 999,
          background: '#fff', border: '2px solid var(--accent)', boxShadow: '0 1px 3px rgba(50,40,20,.25)',
        }}
      />
      {/* Verbindungspunkte (M150): Rahmen lassen sich wie Module verbinden */}
      {[Position.Top, Position.Right, Position.Bottom, Position.Left].map((pos) => (
        <Handle key={pos} type="source" position={pos} id={pos} className="pn-handle frame-handle" />
      ))}
      <div className="frame-head" title="Ziehen verschiebt den Rahmen SAMT Inhalt · Doppelklick benennt um · Aktionen (Anordnen, Tönung, Verschieben …) in der Auswahl-Leiste">
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
          <span className="frame-name" onDoubleClick={() => { setDraft(data.name); setEditing(true); }}>
            {data.name}
          </span>
        )}
        {memberCount > 0 && <span className="frame-count" title={`${memberCount} Karte(n) in diesem Rahmen — sie wandern mit dem Rahmen mit`}>{memberCount}</span>}
      </div>
      <div className="frame-body" style={tint ? { background: `${tint}55` } : undefined} />
    </div>
  );
}
