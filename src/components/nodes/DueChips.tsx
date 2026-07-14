import { useMemo } from 'react';
import { detectDates, downloadIcs, formatDue } from '../../lib/dates';
import { useBoard } from '../../store';

/**
 * Fristen-Chips unter einer Karte: automatisch erkannte Datumsangaben
 * mit Countdown-Färbung. Klick → .ics-Kalendereintrag.
 */
export function DueChips({ text, context }: { text: string; context: string }) {
  const showToast = useBoard((s) => s.showToast);
  const dates = useMemo(() => detectDates(text), [text]);
  if (dates.length === 0) return null;

  return (
    <div className="due-chips">
      {dates.map((d, i) => (
        <button
          key={i}
          className={`due-chip due-${d.urgency} nodrag`}
          title={`„${d.label}" erkannt — Klick erstellt Kalendereintrag (.ics)`}
          onClick={() => {
            downloadIcs(context, d.date);
            showToast('📅 Kalendereintrag erstellt — in Outlook öffnen und speichern');
          }}
        >
          📅 {formatDue(d)}
        </button>
      ))}
    </div>
  );
}
