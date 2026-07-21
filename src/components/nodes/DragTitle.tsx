import { useState } from 'react';

/**
 * Karten-Titel nach der App-Konvention „Doppelklick benennt um" (wie Rahmen,
 * Formen und Mermaid-Schritte). Der entscheidende Unterschied zu einem
 * dauerhaften Eingabefeld: Als Text ist die Titelzeile ZIEHBAR — sie wird
 * damit auf jeder Karte die verlässliche Anfass-Fläche zum Verschieben
 * (M160: vorher fraßen die nodrag-Eingabefelder fast die ganze Kopfzeile).
 */
export function DragTitle({ value, onChange, className, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (editing) {
    const commit = () => { onChange(draft); setEditing(false); };
    return (
      <input
        autoFocus
        className={`${className ?? ''} nodrag`}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
      />
    );
  }
  return (
    <span
      className={`${className ?? ''} drag-title ${value ? '' : 'drag-title-empty'}`}
      title="Ziehen verschiebt die Karte · Doppelklick benennt um"
      onDoubleClick={(e) => { e.stopPropagation(); setDraft(value); setEditing(true); }}
    >
      {value || placeholder}
    </span>
  );
}
