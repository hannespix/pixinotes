// M469: „Termine heute und morgen" in der Aufgaben-Zentrale.
//
// Ein eigener, ruhiger Abschnitt über der Aufgabenliste: Termine aus den verbundenen Kalender-Konten
// (Google, Outlook) mit Uhrzeit, Titel und Konto — ohne Haken, denn Termine sind keine Aufgaben.
// Ein Klick führt zur Kalender-Karte (auf den Tag des Termins gestellt). Ohne verbundenes Konto
// erscheint der Abschnitt gar nicht.
import { useEffect, useState } from 'react';
import { mutedHistory, useBoard } from '../store';
import { fetchAccountEvents, TERMINE_EREIGNIS } from '../lib/calAccounts';
import { kontoKennung, kontoVerbunden, setTerminErinnerung, TERMIN_VORLAUF_MIN, terminErinnerungAn, termineHeuteMorgen, type ZentralTermin } from '../lib/termineZentrale';
import { makeCalendar } from '../lib/nodes';
import { sprache, zahlWort } from '../lib/sprache';
import { ICalendar } from './Icons';

/** Nach so langer Zeit holt das Öffnen der Zentrale Heute/Morgen frisch (sonst reicht das Gemerkte) */
const FRISCH_MS = 15 * 60 * 1000;

export function TermineAbschnitt({ aufgaben, offen, schliessen }: {
  aufgaben: Array<{ text: string; due?: string }>;
  offen: boolean;
  schliessen: () => void;
}) {
  const [, neu] = useState(0);
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState('');
  const [erinnern, setErinnern] = useState(terminErinnerungAn);
  const verbunden = kontoVerbunden();

  useEffect(() => {
    const auf = () => neu((n) => n + 1);
    window.addEventListener(TERMINE_EREIGNIS, auf);
    window.addEventListener('pixinotes-cal-accounts', auf);
    return () => { window.removeEventListener(TERMINE_EREIGNIS, auf); window.removeEventListener('pixinotes-cal-accounts', auf); };
  }, []);

  // Beim Öffnen der Zentrale (Nutzer-Aktion, nicht beim App-Start): Heute/Morgen nachholen, wenn das
  // Gemerkte fehlt oder älter als eine Viertelstunde ist. Derselbe Abruf wie in der Kalender-Karte.
  useEffect(() => {
    if (!offen || !kontoVerbunden()) return;
    const st = termineHeuteMorgen([]);
    if (st.abgedeckt && Date.now() - st.stand < FRISCH_MS) return;
    let weg = false;
    const heute = new Date();
    setLaedt(true);
    fetchAccountEvents(heute, new Date(heute.getFullYear(), heute.getMonth(), heute.getDate() + 1))
      .then(({ errors }) => { if (!weg) setFehler(errors.join(' · ')); })
      .catch((e: Error) => { if (!weg) setFehler(e.message); })
      .finally(() => { if (!weg) setLaedt(false); });
    return () => { weg = true; };
  }, [offen]);

  if (!verbunden) return null;
  const t = termineHeuteMorgen(aufgaben);
  const anzahl = t.heute.length + t.morgen.length;

  /** Zur Kalender-Karte springen (aktives Board zuerst) — gibt es keine, legt der Klick eine an */
  const zumKalender = (ev: ZentralTermin) => {
    const st = useBoard.getState();
    const tagDaten = ev.date === t.heuteIso
      ? { month: undefined, anchor: undefined }
      : { month: ev.date.slice(0, 7), anchor: ev.date };
    const reihe = [...st.boards].sort((a, b) => (a.id === st.activeId ? -1 : b.id === st.activeId ? 1 : 0));
    for (const b of reihe) {
      const karte = b.nodes.find((n) => n.type === 'calendar');
      if (!karte) continue;
      mutedHistory(() => st.updateNodeDataOnBoard(b.id, karte.id, tagDaten));
      schliessen();
      st.openBoard(b.id);
      st.focusNode(b.id, karte.id);
      return;
    }
    const karte = makeCalendar({ x: 120, y: 120 });
    if (ev.date !== t.heuteIso) karte.data = { month: ev.date.slice(0, 7), anchor: ev.date };
    st.addNode(karte);
    schliessen();
    st.focusNode(st.activeId, karte.id);
    st.showToast('Kalender-Karte angelegt – dort stehen die Termine deiner Konten.');
  };

  const datum = (iso: string) => new Date(`${iso}T12:00:00`)
    .toLocaleDateString(sprache() === 'en' ? 'en-GB' : 'de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });

  const liste = (termine: ZentralTermin[]) => (
    <ul>
      {termine.map((ev) => (
        <li key={ev.key}>
          <button className="th-termin" onClick={() => zumKalender(ev)} title="In der Kalender-Karte zeigen">
            <span className="th-termin-zeit">{ev.time ?? 'ganztägig'}</span>
            <span className="th-termin-titel" translate="no">{ev.title}</span>
            <span className="th-termin-konto">{kontoKennung(ev.provider)}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <section className="th-termine" aria-label="Termine heute und morgen">
      <div className="th-termine-kopf">
        <ICalendar size={13} />
        <span>Termine heute und morgen</span>
        {anzahl > 0 && <span className="th-group-count" title={zahlWort(anzahl, 'Termin', 'Termine')}>{anzahl}</span>}
        <label className="th-termine-erinnern" title={`Kurz vor Beginn (bis ${TERMIN_VORLAUF_MIN} Minuten vorher) eine Erinnerung zeigen`}>
          <input
            type="checkbox"
            checked={erinnern}
            onChange={(e) => { setTerminErinnerung(e.target.checked); setErinnern(e.target.checked); }}
          />
          Vorher erinnern
        </label>
      </div>
      {!t.abgedeckt && laedt ? (
        <div className="th-termine-leer">Termine werden geladen …</div>
      ) : !t.abgedeckt && fehler ? (
        <div className="th-termine-leer">Termine nicht abrufbar: {fehler}</div>
      ) : anzahl === 0 ? (
        <div className="th-termine-leer">Heute und morgen keine Termine.</div>
      ) : (
        <>
          {t.heute.length > 0 && <div className="th-termine-tag"><span>Heute</span> · {datum(t.heuteIso)}</div>}
          {t.heute.length > 0 && liste(t.heute)}
          {t.morgen.length > 0 && <div className="th-termine-tag"><span>Morgen</span> · {datum(t.morgenIso)}</div>}
          {t.morgen.length > 0 && liste(t.morgen)}
        </>
      )}
      {anzahl > 0 && t.abgedeckt && fehler && <div className="th-termine-leer">Nicht alle Konten erreichbar: {fehler}</div>}
    </section>
  );
}
