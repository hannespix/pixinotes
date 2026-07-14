import { useEffect, useMemo, useState } from 'react';
import { detectDates, downloadIcs, formatDue } from '../../lib/dates';
import { useBoard } from '../../store';

/**
 * Fristen-Chips unter einer Karte: automatisch erkannte Datumsangaben
 * mit Countdown-Färbung. Klick → .ics-Kalendereintrag.
 */
export function DueChips({ text, context }: { text: string; context: string }) {
  const showToast = useBoard((s) => s.showToast);
  // Countdown bleibt aktuell, auch wenn die App lange offen ist (N5)
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNowTick((x) => x + 1), 10 * 60 * 1000);
    return () => clearInterval(t);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dates = useMemo(() => detectDates(text), [text, nowTick]);
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
