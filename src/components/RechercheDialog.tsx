/**
 * M274: Der Recherche-Dialog — Auftrag, Rückfragen, Fortschritt.
 *
 * Der Ablauf spiegelt die Pipeline aus lib/recherche.ts:
 *   Auftrag eintippen → die KI stellt (höchstens drei) Rückfragen →
 *   beantworten oder überspringen → Quellen werden geholt → die Antwort
 *   entsteht als Notiz auf dem Board.
 *
 * Die Rückfragen sind bewusst ÜBERSPRINGBAR: Ein Dialog, der Antworten
 * erzwingt, ist eine Schranke — einer, der gute Fragen stellt, ein Angebot.
 */
import { useEffect, useRef, useState } from 'react';
import { useBoard } from '../store';
import { aiReady } from '../lib/ai';
import { fuehreRechercheAus, planeRecherche, type RecherchePlan } from '../lib/recherche';
import { nodesToText } from '../lib/serialize';
import { selectActiveBoard } from '../store';
import { IX } from './Icons';

type Phase = 'eingabe' | 'plane' | 'fragen' | 'laeuft';

export function RechercheDialog() {
  const offen = useBoard((s) => s.rechercheOpen);
  const schliessen = () => useBoard.getState().setRechercheOpen(false);
  const showToast = useBoard((s) => s.showToast);
  const ai = useBoard((s) => s.ai);
  const [phase, setPhase] = useState<Phase>('eingabe');
  const [auftrag, setAuftrag] = useState('');
  const [plan, setPlan] = useState<RecherchePlan | null>(null);
  const [antworten, setAntworten] = useState<string[]>([]);
  const [schritt, setSchritt] = useState('');
  const [fehler, setFehler] = useState('');
  const laeuft = useRef(false);

  useEffect(() => {
    if (offen) { setPhase('eingabe'); setFehler(''); setSchritt(''); setPlan(null); }
  }, [offen]);

  if (!offen) return null;

  const starten = async () => {
    if (!auftrag.trim() || laeuft.current) return;
    setFehler('');
    setPhase('plane');
    laeuft.current = true;
    try {
      const st = useBoard.getState();
      const sel = selectActiveBoard(st).nodes.filter((n) => n.selected && n.type !== 'frame');
      const kontext = sel.length ? nodesToText(sel) : '';
      const p = await planeRecherche(auftrag.trim(), kontext);
      setPlan(p);
      setAntworten(p.fragen.map(() => ''));
      if (p.fragen.length > 0) {
        setPhase('fragen');
        laeuft.current = false;
        return;
      }
      await ausfuehren(p, []);
    } catch (e) {
      setFehler((e as Error).message);
      setPhase('eingabe');
      laeuft.current = false;
    }
  };

  const ausfuehren = async (p: RecherchePlan, a: string[]) => {
    setPhase('laeuft');
    laeuft.current = true;
    try {
      const erg = await fuehreRechercheAus(auftrag.trim(), p, a, setSchritt);
      showToast(erg.quellen
        ? `🔎 Recherche fertig — Notiz mit ${erg.quellen} Quelle(n) liegt auf dem Board. Strg+Z entfernt sie.`
        : '🔎 Recherche fertig — keine Quelle erreichbar, die Notiz sagt ehrlich, was offen blieb.', false, 8000);
      schliessen();
    } catch (e) {
      setFehler((e as Error).message);
      setPhase(p.fragen.length ? 'fragen' : 'eingabe');
    } finally {
      laeuft.current = false;
    }
  };

  return (
    <div className="modal-backdrop nodrag" onClick={(e) => { if (e.target === e.currentTarget && phase !== 'laeuft') schliessen(); }}>
      <div className="modal recherche-modal" role="dialog" aria-label="Recherche mit Quellen">
        <div className="modal-head">
          <h2>🔎 Recherche mit echten Quellen</h2>
          <button className="modal-x" title="Schließen" onClick={schliessen}><IX size={16} /></button>
        </div>
        <div className="modal-body">
          {!aiReady(ai) && (
            <div className="modal-note">Zuerst in ⚙️ → KI einen Anbieter wählen — „Gratis" geht ohne Schlüssel.</div>
          )}
          {phase === 'eingabe' && (
            <>
              <p className="modal-hint">
                Die KI plant die Suche, stellt bei Bedarf <b>Rückfragen</b>, holt dann echtes Material
                aus <b>Wikipedia</b>, <b>Wikivoyage</b> und der <b>Open-Meteo-Wettervorhersage</b> und
                antwortet nur daraus — mit Quellenliste. Was die Quellen nicht hergeben (z. B.
                Öffnungszeiten), steht ehrlich als Lücke da. Ausgewählte Karten zählen als Kontext.
              </p>
              <textarea
                autoFocus
                rows={3}
                className="recherche-auftrag"
                placeholder={'z. B. „Ausflugsziele rund um Ihringen am Kaiserstuhl fürs Wochenende, mit Wetter"'}
                value={auftrag}
                onChange={(e) => setAuftrag(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void starten(); } }}
              />
              {fehler && <div className="cal-menu-err">⚠️ {fehler}</div>}
              <div className="modal-buttons">
                <button disabled={!auftrag.trim() || !aiReady(ai)} onClick={() => void starten()}>Recherche starten</button>
              </div>
            </>
          )}
          {phase === 'plane' && <div className="recherche-schritt">Die KI plant die Suche und überlegt Rückfragen…</div>}
          {phase === 'fragen' && plan && (
            <>
              <p className="modal-hint">
                <b>Rückfragen der KI</b> — Antworten schärfen das Ergebnis, alles ist freiwillig.
              </p>
              {plan.fragen.map((f, i) => (
                <label key={i} className="recherche-frage">
                  <span>{f}</span>
                  <input
                    autoFocus={i === 0}
                    value={antworten[i] ?? ''}
                    placeholder="(leer lassen = überspringen)"
                    onChange={(e) => setAntworten((a) => a.map((x, j) => (j === i ? e.target.value : x)))}
                    onKeyDown={(e) => { if (e.key === 'Enter') void ausfuehren(plan, antworten); }}
                  />
                </label>
              ))}
              {fehler && <div className="cal-menu-err">⚠️ {fehler}</div>}
              <div className="modal-buttons">
                <button onClick={() => void ausfuehren(plan, antworten)}>Mit diesen Antworten recherchieren</button>
                <button onClick={() => void ausfuehren(plan, [])}>Ohne Antworten loslegen</button>
              </div>
            </>
          )}
          {phase === 'laeuft' && (
            <div className="recherche-schritt">
              <span className="recherche-spinner" aria-hidden />
              {schritt || 'Recherche läuft…'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
