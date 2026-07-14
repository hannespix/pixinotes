import { useState, type CSSProperties } from 'react';

interface Props {
  value: string;
  onRename: (name: string) => void;
  className?: string;
  style?: CSSProperties;
  /** Kontrolliert (z. B. via ✏️-Button); ohne diese Props triggert Doppelklick */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
}

/**
 * Einheitliches Inline-Umbenennen (Audit H2 — vorher drei Implementierungen):
 * Doppelklick oder kontrolliertes editing → Input mit Vorauswahl,
 * Enter/Blur übernimmt (getrimmt), Escape bricht ab.
 */
export function InlineName({ value, onRename, className, style, editing, onEditingChange }: Props) {
  const [internalEditing, setInternalEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const isEditing = editing ?? internalEditing;
  const setEditing = (e: boolean) => {
    setInternalEditing(e);
    onEditingChange?.(e);
  };

  if (!isEditing) {
    return (
      <span
        className={`${className ?? ''} nodrag`}
        style={style}
        title="Doppelklick zum Umbenennen"
        onDoubleClick={(e) => {
          e.stopPropagation();
          setDraft(value);
          setEditing(true);
        }}
      >
        {value}
      </span>
    );
  }
  return (
    <input
      className={`${className ?? ''} inline-edit nodrag`}
      style={style}
      autoFocus
      value={draft}
      onFocus={(e) => e.target.select()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft.trim()) onRename(draft.trim());
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}
