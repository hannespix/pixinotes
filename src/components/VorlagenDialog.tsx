// M379: Vorlage wählen — für ein neues Board oder für das leere Board, vor dem man gerade steht.
import { useEffect, useMemo, useRef } from 'react';
import { useBoard } from '../store';
import { skizzeVon, VORLAGEN, type Vorlage, type VorlagenWunsch } from '../lib/vorlagen';
import { IX } from './Icons';
import { t } from '../lib/sprache';

/** Kleine Skizze der Vorlage: ihre Karten als Flächen, so wie sie auf dem Board liegen */
function Skizze({ vorlage }: { vorlage: Vorlage }) {
  const { teile, verhaeltnis } = useMemo(() => skizzeVon(vorlage.bauen()), [vorlage]);
  // In ein 160×100-Feld einpassen (mit Rand), Seitenverhältnis der Vorlage bleibt
  const B = 160, H = 100, R = 8;
  const b = Math.min(B - 2 * R, (H - 2 * R) * verhaeltnis), hh = b / verhaeltnis;
  const x0 = (B - b) / 2, y0 = (H - hh) / 2;
  return (
    <svg className="vorlage-skizze" viewBox={`0 0 ${B} ${H}`} aria-hidden="true">
      {teile.map((t, i) => {
        const x = x0 + t.x * b, y = y0 + t.y * hh, w = Math.max(3, t.w * b), h = Math.max(3, t.h * hh);
        if (t.art === 'frame') return <rect key={i} x={x} y={y} width={w} height={h} rx={3} fill={t.farbe} className="sk-rahmen" />;
        if (t.art === 'bubbles') {
          const r = Math.min(w, h);
          return (
            <g key={i}>
              <rect x={x} y={y} width={w} height={h} rx={2.5} fill={t.farbe} className="sk-karte" />
              <circle cx={x + w * 0.34} cy={y + h * 0.52} r={r * 0.24} className="sk-blase b1" />
              <circle cx={x + w * 0.62} cy={y + h * 0.4} r={r * 0.17} className="sk-blase b2" />
              <circle cx={x + w * 0.66} cy={y + h * 0.72} r={r * 0.12} className="sk-blase b3" />
            </g>
          );
        }
        if (t.art === 'kanban') {
          return (
            <g key={i}>
              <rect x={x} y={y} width={w} height={h} rx={2.5} fill={t.farbe} className="sk-karte" />
              {[0, 1, 2].map((s) => <rect key={s} x={x + 2 + s * ((w - 4) / 3)} y={y + 5} width={(w - 4) / 3 - 1.5} height={Math.max(2, h - 8)} rx={1.5} className="sk-spalte" />)}
            </g>
          );
        }
        if (t.art === 'gantt') {
          return (
            <g key={i}>
              <rect x={x} y={y} width={w} height={h} rx={2.5} fill={t.farbe} className="sk-karte" />
              {[0, 1, 2].map((s) => <rect key={s} x={x + 4 + s * w * 0.24} y={y + 5 + s * (h - 8) / 3.4} width={w * 0.3} height={Math.max(1.5, (h - 10) / 5)} rx={1} className="sk-balken" />)}
            </g>
          );
        }
        return <rect key={i} x={x} y={y} width={w} height={h} rx={2.5} fill={t.farbe} className="sk-karte" />;
      })}
    </svg>
  );
}

export function VorlagenDialog({ wunsch, onClose }: { wunsch: VorlagenWunsch; onClose: () => void }) {
  const ziel = useBoard((s) => (wunsch.inBoard ? s.boards.find((b) => b.id === wunsch.inBoard) : undefined));
  const projekt = useBoard((s) => {
    const alle = s.spaces.flatMap((sp) => sp.projects);
    return (wunsch.projectId ? alle.find((p) => p.id === wunsch.projectId) : undefined) ?? alle[0];
  });
  const fuellen = !!ziel && !ziel.nodes.length;
  const erste = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    erste.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const nehmen = (v: Vorlage | null) => {
    const st = useBoard.getState();
    if (!v) {
      if (!fuellen) { st.addBoard(undefined, wunsch.projectId); st.showToast(`Neues Board in „${projekt?.name ?? 'Allgemein'}".`); }
      onClose();
      return;
    }
    st.boardAusVorlage(t(v.name), v.bauen(), fuellen ? { inBoard: ziel!.id } : { projectId: wunsch.projectId });
    window.dispatchEvent(new CustomEvent('pixinotes:einpassen'));
    st.showToast(fuellen ? `Vorlage „${v.name}" eingesetzt — Strg+Z nimmt sie zurück.` : `Board „${v.name}" aus Vorlage angelegt.`);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal vorlagen-dialog" role="dialog" aria-modal="true" aria-label="Vorlage wählen" data-taste="vorlagen-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{fuellen ? 'Vorlage für dieses Board' : 'Neues Board'} {!fuellen && projekt && <small>in „{projekt.name}"</small>}</h2>
          <button className="modal-x" onClick={onClose} aria-label="Schließen"><IX size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="vorlagen-gitter" role="list">
            <button ref={erste} className="vorlage leer" role="listitem" data-taste="vorlage" data-vorlage="leer" onClick={() => nehmen(null)}>
              <span className="vorlage-skizze leer" aria-hidden="true">＋</span>
              <b>{fuellen ? 'Leer lassen' : 'Leeres Board'}</b>
              <small>Ohne Vorgaben anfangen.</small>
            </button>
            {VORLAGEN.map((v) => (
              <button key={v.id} className="vorlage" role="listitem" data-taste="vorlage" data-vorlage={v.id} onClick={() => nehmen(v)}>
                <Skizze vorlage={v} />
                <b>{v.name}</b>
                <small>{v.text}</small>
              </button>
            ))}
          </div>
          <p className="vorlagen-fuss">Die Karten sind beschriftet, aber leer — nichts, was man erst wegräumen müsste.</p>
        </div>
      </div>
    </div>
  );
}
