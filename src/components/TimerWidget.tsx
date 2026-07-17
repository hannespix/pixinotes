import { useEffect, useRef, useState } from 'react';
import { useBoard } from '../store';
import { IX } from './Icons';

/**
 * Besprechungs-Timer (M88, inspiriert vom Nextcloud-Whiteboard): Countdown
 * mit Presets fürs Timeboxing oder Stoppuhr (Start ohne Vorgabe). Schwebt
 * links unter dem Logo und bleibt auch im Präsentationsmodus sichtbar.
 * Läuft über einen Zeitstempel (endsAt/startedAt) statt Tick-Zählung —
 * bleibt damit auch bei gedrosselten Hintergrund-Intervallen exakt.
 */
export function TimerWidget() {
  const open = useBoard((s) => s.timerOpen);
  const setOpen = useBoard((s) => s.setTimerOpen);
  const showToast = useBoard((s) => s.showToast);
  const [running, setRunning] = useState(false);
  const [totalMs, setTotalMs] = useState(0);      // 0 = Stoppuhr
  const [elapsedMs, setElapsedMs] = useState(0);  // aufgelaufene Zeit (inkl. Pausen)
  const [customMin, setCustomMin] = useState('');
  const startRef = useRef(0);                     // Startzeitpunkt des laufenden Abschnitts
  const warnedRef = useRef(false);

  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => {
      setElapsedMs((prev) => {
        const now = Date.now();
        const total = prev + (now - startRef.current);
        startRef.current = now;
        return total;
      });
    }, 250);
    return () => clearInterval(iv);
  }, [running]);

  const remaining = totalMs > 0 ? totalMs - elapsedMs : elapsedMs;
  const overtime = totalMs > 0 && remaining < 0;

  useEffect(() => {
    if (overtime && !warnedRef.current) {
      warnedRef.current = true;
      showToast('⏱ Die Zeit ist um!', false, 6000);
    }
  }, [overtime, showToast]);

  if (!open) return null;

  const startWith = (minutes: number) => {
    setTotalMs(minutes * 60_000);
    setElapsedMs(0);
    warnedRef.current = false;
    startRef.current = Date.now();
    setRunning(true);
  };

  const toggle = () => {
    if (!running) startRef.current = Date.now();
    setRunning((r) => !r);
  };

  const reset = () => {
    setRunning(false);
    setElapsedMs(0);
    warnedRef.current = false;
  };

  const ms = Math.abs(remaining);
  const mm = String(Math.floor(ms / 60_000)).padStart(2, '0');
  const ss = String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0');

  return (
    <div className={`timer-widget ${overtime ? 'overtime' : ''}`} role="timer">
      <div className="timer-row">
        <span className="timer-readout">{overtime ? '+' : ''}{mm}:{ss}</span>
        <button className="timer-btn" onClick={toggle} title={running ? 'Pause' : 'Start'}>
          {running ? '❚❚' : '▶'}
        </button>
        <button className="timer-btn" onClick={reset} title="Zurücksetzen">↺</button>
        <button className="timer-btn timer-x" onClick={() => { reset(); setOpen(false); }} title="Timer schließen" aria-label="Timer schließen">
          <IX size={12} />
        </button>
      </div>
      <div className="timer-row timer-presets">
        {[5, 10, 15, 25].map((m) => (
          <button key={m} className="timer-btn" onClick={() => startWith(m)} title={`${m}-Minuten-Countdown starten`}>{m}′</button>
        ))}
        <input
          className="timer-input"
          type="number" min={1} max={999} placeholder="min"
          value={customMin}
          onChange={(e) => setCustomMin(e.target.value)}
          onKeyDown={(e) => {
            const v = Number(customMin);
            if (e.key === 'Enter' && v >= 1) { startWith(v); setCustomMin(''); }
          }}
          aria-label="Eigene Minuten"
        />
        <button
          className="timer-btn"
          title="Stoppuhr: von 00:00 hochzählen"
          onClick={() => { setTotalMs(0); setElapsedMs(0); warnedRef.current = false; startRef.current = Date.now(); setRunning(true); }}
        >⏱</button>
      </div>
    </div>
  );
}
