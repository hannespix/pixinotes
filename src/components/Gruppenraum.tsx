// M376: Reaktionen und gemeinsamer Timer — die Anzeige (Regeln und Kanal: lib/gruppenraum.ts)
//
//   · ReaktionsKnopf     – 😀 mit der kleinen Auswahl (Live-Leiste und Kopf der Präsentation)
//   · TimerKnopf         – ⏱ mit den Zeiten (Live-Leiste)
//   · GruppenraumSchicht – über allem: aufsteigende Reaktionen und die laufende Uhr (Board und Präsentation)
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useBoard } from '../store';
import {
  REAKTION_EREIGNIS, REAKTIONEN, reagieren, TIMER_EREIGNIS, timerRest, timerStart, timerStopp, timerText, timerVergessen, timerVon,
  type Reaktion,
} from '../lib/gruppenraum';
import { ich } from '../lib/gastSync';
import { ITimer, IX } from './Icons';

/** Aufklappen mit Schließen bei Klick daneben und Esc */
function useAufklappen(wurzel: string): [boolean, (an: boolean | ((o: boolean) => boolean)) => void] {
  const [offen, setOffen] = useState(false);
  useEffect(() => {
    if (!offen) return;
    const zu = (e: Event) => { if (!(e.target as HTMLElement | null)?.closest?.(wurzel)) setOffen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOffen(false); e.stopPropagation(); } };
    window.addEventListener('pointerdown', zu, true);
    window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('pointerdown', zu, true); window.removeEventListener('keydown', esc, true); };
  }, [offen, wurzel]);
  return [offen, setOffen];
}

export function ReaktionsKnopf({ boardId, klasse = 'live-zeig' }: { boardId: string; klasse?: string }) {
  const [offen, setOffen] = useAufklappen('.reakt-wrap');
  return (
    <span className="reakt-wrap">
      <button className={`${klasse} reakt-knopf${offen ? ' an' : ''}`} data-taste="reakt-auf" aria-expanded={offen} aria-haspopup="true"
        title="Reagieren — das Symbol steigt bei allen kurz auf" onClick={() => setOffen((o) => !o)}>😀</button>
      {offen && (
        <span className="reakt-wahl" role="group" aria-label="Reaktion wählen" data-taste="reakt-wahl">
          {REAKTIONEN.map((z) => (
            <button key={z} data-taste="reakt" data-zeichen={z} aria-label={`Mit ${z} reagieren`} onClick={() => { reagieren(boardId, z); }}>{z}</button>
          ))}
        </span>
      )}
    </span>
  );
}

const ZEITEN = [1, 2, 3, 5, 10, 15];
export function TimerKnopf({ boardId }: { boardId: string }) {
  const [offen, setOffen] = useAufklappen('.timer-wrap');
  const [, takt] = useState(0);
  useEffect(() => {
    const auf = () => takt((n) => n + 1);
    window.addEventListener(TIMER_EREIGNIS, auf);
    return () => window.removeEventListener(TIMER_EREIGNIS, auf);
  }, []);
  const laeuft = !!timerVon(boardId);
  return (
    <span className="timer-wrap">
      <button className={`live-zeig timer-knopf${laeuft || offen ? ' an' : ''}`} data-taste="timer-auf" aria-expanded={offen} aria-haspopup="true"
        title={laeuft ? 'Timer läuft — neu stellen oder anhalten' : 'Timer für alle: Einer stellt die Uhr, alle sehen sie ablaufen'}
        onClick={() => setOffen((o) => !o)}><ITimer size={14} /></button>
      {offen && (
        <span className="timer-wahl" role="group" aria-label="Timer stellen" data-taste="timer-wahl">
          <span className="timer-wahl-titel">Timer für alle</span>
          {ZEITEN.map((m) => (
            <button key={m} data-taste="timer-min" data-min={m} onClick={() => { timerStart(boardId, m); setOffen(false); }}>{m} min</button>
          ))}
          {laeuft && <button className="stopp" data-taste="timer-stopp" onClick={() => { timerStopp(boardId); setOffen(false); }}>Anhalten</button>}
        </span>
      )}
    </span>
  );
}

interface Flug extends Reaktion { k: number; links: number; drift: number }
let flugNr = 0;
/** Kurzer Ton, wenn die Zeit um ist (nur beim Starter — dreißig Telefone im Raum sollen nicht piepen) */
function ton(): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ac = new AC();
    const o = ac.createOscillator(); const g = ac.createGain();
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, ac.currentTime + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.9);
    o.connect(g); g.connect(ac.destination);
    o.start(); o.stop(ac.currentTime + 0.95);
    o.onended = () => { void ac.close(); };
  } catch { /* kein Ton — die Anzeige genügt */ }
}

export function GruppenraumSchicht() {
  const boardId = useBoard((s) => s.activeId);
  const imVortrag = useBoard((s) => s.presenting);
  const [fluege, setFluege] = useState<Flug[]>([]);
  useEffect(() => {
    const auf = (e: Event) => {
      const r = (e as CustomEvent<Reaktion>).detail;
      if (r.boardId !== useBoard.getState().activeId) return;
      const f: Flug = { ...r, k: ++flugNr, links: 50 + (Math.random() - 0.5) * 34, drift: (Math.random() - 0.5) * 60 };
      setFluege((alt) => [...alt.slice(-39), f]);
      window.setTimeout(() => setFluege((alt) => alt.filter((x) => x.k !== f.k)), 2900);
    };
    window.addEventListener(REAKTION_EREIGNIS, auf);
    return () => window.removeEventListener(REAKTION_EREIGNIS, auf);
  }, []);

  // Die Uhr: viermal je Sekunde nachsehen, solange sie läuft
  const [, takt] = useState(0);
  const t = timerVon(boardId);
  const umSeit = useRef<{ lauf: number; seit: number } | null>(null);
  useEffect(() => {
    const auf = () => takt((n) => n + 1);
    window.addEventListener(TIMER_EREIGNIS, auf);
    return () => window.removeEventListener(TIMER_EREIGNIS, auf);
  }, []);
  useEffect(() => {
    if (!t) { umSeit.current = null; return; }
    const uhr = window.setInterval(() => {
      const jetzt = timerVon(boardId);
      if (!jetzt) return;
      if (timerRest(jetzt) <= 0) {
        if (umSeit.current?.lauf !== jetzt.lauf) {
          umSeit.current = { lauf: jetzt.lauf, seit: Date.now() };
          if (jetzt.von === ich().id) ton();
        } else if (Date.now() - umSeit.current.seit > 8000) timerVergessen(boardId, jetzt.lauf);   // Schlussmeldung stand acht Sekunden
      }
      takt((n) => n + 1);
    }, 250);
    return () => window.clearInterval(uhr);
  }, [t?.lauf, boardId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const rest = timerRest(t);
  const um = !!t && rest <= 0;
  return (
    <>
      {t && (
        <div className={`gruppen-timer${um ? ' um' : ''}${rest > 0 && rest <= 10_000 ? ' knapp' : ''}${imVortrag ? ' im-vortrag' : ''}`} role="timer" aria-live="off" data-taste="timer-chip"
          style={{ '--anteil': `${Math.max(0, Math.min(1, rest / Math.max(1, t.dauer))) * 100}%` } as CSSProperties}>
          <ITimer size={14} />
          <span className="gruppen-timer-zeit" data-taste="timer-zeit">{um ? 'Zeit ist um' : timerText(rest)}</span>
          <span className="gruppen-timer-von" translate="no">{t.von === ich().id ? 'von dir' : `von ${t.name}`}</span>
          <button onClick={() => timerStopp(boardId)} title={um ? 'Schließen' : 'Timer für alle anhalten'} aria-label={um ? 'Schließen' : 'Timer anhalten'} data-taste="timer-zu"><IX size={12} /></button>
        </div>
      )}
      {fluege.length > 0 && (
        <div className="reakt-schicht" aria-hidden="true">
          {fluege.map((f) => (
            <span key={f.k} className={`reakt-flug${f.ich ? ' ich' : ''}`} data-taste="reakt-flug" data-zeichen={f.zeichen} data-name={f.name}
              style={{ left: `${f.links}%`, '--drift': `${f.drift}px`, '--farbe': f.farbe } as CSSProperties}>
              <span className="reakt-zeichen">{f.zeichen}</span>
              <span className="reakt-name" translate="no">{f.ich ? 'du' : f.name}</span>
            </span>
          ))}
        </div>
      )}
    </>
  );
}
