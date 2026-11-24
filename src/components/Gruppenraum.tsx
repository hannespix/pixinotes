// M376: Reaktionen und gemeinsamer Timer — die Anzeige (Regeln und Kanal: lib/gruppenraum.ts)
//
//   · ReaktionsKnopf     – 😀 mit der kleinen Auswahl (Live-Leiste und Kopf der Präsentation)
//   · TimerZeile         – Schnellwahl und freie Eingabe (M512: „90", „1h30", „45s") in der Liste der Gruppe
//   · GruppenraumSchicht – über allem: aufsteigende Reaktionen und die laufende Uhr (Board und Präsentation)
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { useBoard } from '../store';
import {
  REAKTION_EREIGNIS, REAKTIONEN, reagieren, TIMER_EREIGNIS, timerRest, timerStart, timerStartMs, timerStopp, timerText, timerVergessen, timerVon,
  type Reaktion,
} from '../lib/gruppenraum';
import { ich } from '../lib/liveStand';
import { ITimer, IX, ILaecheln } from './Icons';
import { zahlWort } from '../lib/sprache';
import { timerDauerLesen } from '../lib/timerDauer';

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
        title="Reagieren – das Symbol steigt bei allen kurz auf" onClick={() => setOffen((o) => !o)}><ILaecheln size={16} /></button>
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

/** M512: Schnellwahl um halbe und ganze Stunde ergänzt; alles andere über das freie Feld */
const ZEITEN = [1, 2, 3, 5, 10, 15, 30, 60];
/** M391: Timer stellen — eine Zeile in der Liste der Gruppe (vorher ein eigener Knopf in der Leiste) */
export function TimerZeile({ boardId, fertig }: { boardId: string; fertig: () => void }) {
  const [, takt] = useState(0);
  const [eingabe, setEingabe] = useState('');
  const [fehler, setFehler] = useState('');
  useEffect(() => {
    const auf = () => takt((n) => n + 1);
    window.addEventListener(TIMER_EREIGNIS, auf);
    return () => window.removeEventListener(TIMER_EREIGNIS, auf);
  }, []);
  const laeuft = !!timerVon(boardId);
  const gelesen = eingabe.trim() ? timerDauerLesen(eingabe) : null;
  // M512: frei eingegebene Dauer — Enter oder „Start"; ungültig bleibt die Liste offen, mit einem Satz darunter
  const frei = (e: FormEvent) => {
    e.preventDefault();
    const d = timerDauerLesen(eingabe);
    if (d.fehler !== undefined) { setFehler(d.fehler); return; }
    timerStartMs(boardId, d.ms); setEingabe(''); setFehler(''); fertig();
  };
  return (
    <div className="timer-zeile" role="group" aria-label="Timer für alle stellen" data-taste="timer-wahl">
      <span className="timer-zeile-titel" title="Einer stellt die Uhr, alle sehen sie ablaufen"><ITimer size={15} /> Timer für alle</span>
      <span className="timer-zeile-zeiten">
        {ZEITEN.map((m) => (
          <button key={m} data-taste="timer-min" data-min={m} title={zahlWort(m, 'Minute', 'Minuten')} aria-label={zahlWort(m, 'Minute', 'Minuten')} onClick={() => { timerStart(boardId, m); fertig(); }}>{m}</button>
        ))}
        <span className="timer-zeile-einheit">min</span>
        {laeuft && <button className="stopp" data-taste="timer-stopp" onClick={() => { timerStopp(boardId); fertig(); }}>Anhalten</button>}
      </span>
      <form className="timer-frei" onSubmit={frei} data-taste="timer-frei" noValidate>
        {/* Zahlentastatur: eine Zahl sind Minuten („90"); am PC versteht das Feld auch 1h30, 1:30, 1,5 h, 45s */}
        <input type="text" inputMode="numeric" enterKeyHint="go" autoComplete="off" spellCheck={false} maxLength={24}
          value={eingabe} placeholder="Eigene Dauer, z. B. 90" aria-label="Eigene Dauer: Minuten oder z. B. 1h30, 1:30, 45s"
          aria-invalid={!!fehler} aria-describedby="timer-frei-info" data-taste="timer-eingabe"
          onChange={(e) => { setEingabe(e.target.value); setFehler(''); }}
          onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation(); }} />
        <button type="submit" data-taste="timer-frei-start" disabled={!eingabe.trim()}>Start</button>
        <span id="timer-frei-info" className={`timer-frei-info${fehler ? ' fehler' : ''}`} role={fehler ? 'alert' : undefined} data-taste="timer-frei-info">
          {fehler || (gelesen?.ms !== undefined ? `= ${timerText(gelesen.ms)}` : 'Minuten, oder 1h30 · 1:30 · 45s')}
        </span>
      </form>
    </div>
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

  // Die Uhr: M512 — genau dann nachsehen, wenn die Anzeige umspringt (höchstens einmal je Sekunde). Ein verdeckter
  // Tab rechnet nicht mit: nur ein Wecker zum Ende (Ton beim Starter); beim Zurückkehren kommt die Restzeit aus dem Ende.
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
    let wecker = 0;
    const nachsehen = () => {
      const jetzt = timerVon(boardId);
      if (!jetzt) return;
      if (timerRest(jetzt) <= 0) {
        if (umSeit.current?.lauf !== jetzt.lauf) {
          umSeit.current = { lauf: jetzt.lauf, seit: Date.now() };
          if (jetzt.von === ich().id) ton();
        } else if (Date.now() - umSeit.current.seit > 8000) timerVergessen(boardId, jetzt.lauf);   // Schlussmeldung stand acht Sekunden
      }
      takt((n) => n + 1);
    };
    const planen = () => {
      window.clearTimeout(wecker);
      const jetzt = timerVon(boardId);
      if (!jetzt) return;
      const rest = timerRest(jetzt);
      // Anzeige rundet auf ganze Sekunden auf: sie springt, wenn der Rest die nächste volle Sekunde unterschreitet
      const warte = rest <= 0 ? 1000 : document.hidden ? rest : (rest % 1000 || 1000);
      wecker = window.setTimeout(() => { nachsehen(); planen(); }, warte + 15);
    };
    const sicht = () => { nachsehen(); planen(); };
    nachsehen(); planen();
    document.addEventListener('visibilitychange', sicht);
    return () => { window.clearTimeout(wecker); document.removeEventListener('visibilitychange', sicht); };
  }, [t?.lauf, t?.ende, boardId]);   // eslint-disable-line react-hooks/exhaustive-deps

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
