import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { wurzelZoom } from '../lib/anzeige';
import { timerText, type GruppenTimer } from '../lib/gruppenraum';
import { ich } from '../lib/liveStand';
import { IGriff, IMaximize, IMinimize, IX } from './Icons';

interface Props {
  timer: GruppenTimer;
  rest: number;
  imVortrag: boolean;
  stoppen: () => void;
}

// M558: Nur die Anzeige gehört dem einzelnen Teilnehmer. Der gemeinsame Lauf tickt in GruppenTimer weiter.
export function GruppenTimerAnzeige({ timer, rest, imVortrag, stoppen }: Props) {
  const [klein, setKlein] = useState(false);
  const [lage, setLage] = useState<{ x: number; y: number } | null>(null);
  const zeitId = useId();
  const uhr = useRef<HTMLDivElement>(null);
  const griffKnopf = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const knopf = griffKnopf.current;
    // M558: Ein schneller Fingerzug gilt in Chromium sonst als Scrollgeste, deren Ende den
    // nächsten Tipp auf „Minimieren“ verschluckt. Nur der Griff übernimmt diese Bewegung.
    const fingerZieht = (e: TouchEvent) => { if (e.cancelable) e.preventDefault(); };
    knopf?.addEventListener('touchmove', fingerZieht, { passive: false });
    return () => knopf?.removeEventListener('touchmove', fingerZieht);
  }, []);
  const griff = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const greifen = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || !e.isPrimary || !uhr.current) return;
    const r = uhr.current.getBoundingClientRect();
    griff.current = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const setzen = (x: number, y: number) => {
    const zoom = wurzelZoom();
    setLage({ x: x / zoom, y: y / zoom });
  };
  const ziehen = (e: PointerEvent<HTMLButtonElement>) => {
    const g = griff.current;
    if (g?.id === e.pointerId) setzen(e.clientX - g.dx, e.clientY - g.dy);
  };
  const loslassen = (e: PointerEvent<HTMLButtonElement>) => {
    if (griff.current?.id === e.pointerId) griff.current = null;
  };
  const mitPfeil = (e: KeyboardEvent<HTMLButtonElement>) => {
    const schritt = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[e.key];
    if (!schritt || !uhr.current) return;
    e.preventDefault();
    e.stopPropagation();
    const r = uhr.current.getBoundingClientRect();
    setzen(r.left + schritt[0], r.top + schritt[1]);
  };

  const klappen = klein ? 'Timer wiederherstellen' : 'Timer minimieren';
  const um = rest <= 0;
  const klasse = ['gruppen-timer', klein && 'klein', lage && 'frei', imVortrag && 'im-vortrag',
    um ? 'um' : rest <= 10_000 && 'knapp'].filter(Boolean).join(' ');
  const stil = {
    '--anteil': `${Math.max(0, Math.min(1, rest / Math.max(1, timer.dauer))) * 100}%`,
    ...(lage && { '--timer-x': `${lage.x}px`, '--timer-y': `${lage.y}px` }),
  } as CSSProperties;
  const zeit = <span id={zeitId} className="gruppen-timer-zeit" data-taste="timer-zeit">{um ? 'Zeit ist um' : timerText(rest)}</span>;

  return (
    <div ref={uhr} className={klasse} style={stil} data-taste="timer-chip" role="timer" aria-live="off"
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') e.stopPropagation(); }}>
      <button ref={griffKnopf} type="button" className="timer-griff" data-taste="timer-griff" aria-label="Timer verschieben"
        title="Ziehen oder mit den Pfeiltasten verschieben" onKeyDown={mitPfeil} onPointerDown={greifen}
        onPointerMove={ziehen} onPointerUp={loslassen} onPointerCancel={loslassen} onLostPointerCapture={loslassen}>
        <IGriff size={15} />
      </button>
      {!klein && zeit}
      {!klein && <span className="gruppen-timer-von" translate="no">{timer.von === ich().id ? 'von dir' : `von ${timer.name}`}</span>}
      <button type="button" className="timer-klapp" data-taste="timer-klapp" aria-expanded={!klein} aria-label={klappen} aria-describedby={klein ? zeitId : undefined}
        title={klappen} onClick={() => setKlein(!klein)}>
        {klein ? <>{zeit}<IMaximize size={13} /></> : <IMinimize size={13} />}
      </button>
      {!klein && <button type="button" onClick={stoppen} title={um ? 'Schließen' : 'Timer für alle anhalten'}
        aria-label={um ? 'Schließen' : 'Timer anhalten'} data-taste="timer-zu"><IX size={12} /></button>}
    </div>
  );
}
