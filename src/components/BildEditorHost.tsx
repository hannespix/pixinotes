// M395: Öffnet den Bild-Editor für eine Karte — von überall per Ereignis (Knopf am Bild, ⋯-Menü, Rechtsklick).
//
// Der Editor selbst wird erst geladen, wenn man ihn braucht. Hier liegt, was mit dem Ergebnis geschieht:
//   · eingebettetes Bild (Karte „image"): die Daten der Karte werden ersetzt;
//   · Bild aus der Geräte-Ablage (Karte „file"): Das neue Bild wird unter einer NEUEN Kennung abgelegt und die
//     Karte dorthin umgezogen — der Inhalt hängt an der Kennung, und nur so reist er beim Abgleich als neue Datei
//     mit (Konto, Team, Gäste). Das alte Bild bleibt bis zum nächsten Start liegen: Rückgängig findet es.
import { lazy, Suspense, useEffect, useState } from 'react';
import { karteFest, selectActiveBoard, selectNurLesen, useBoard } from '../store';
import { loadFile, saveFile, vorschauArt } from '../lib/fileStore';
import { canEmbed } from '../lib/nodes';
import { MAX_EMBED_BYTES } from '../lib/parseEmail';
import { blobAlsDataUrl, nameMitEndung } from '../lib/bildBearbeiten';
import { uid, type AppNode } from '../types';
import type { BildErgebnis } from './BildEditor';

const showToast = (text: string, undo = false, ms?: number) => useBoard.getState().showToast(text, undo, ms);

export const BILD_BEARBEITEN = 'pixinotes:bild-bearbeiten';
export const bildBearbeiten = (id: string) => window.dispatchEvent(new CustomEvent(BILD_BEARBEITEN, { detail: id }));

/** Lässt sich diese Karte als Bild bearbeiten? */
export function istBildKarte(n: { type?: string; data?: unknown } | undefined): boolean {
  if (!n) return false;
  if (n.type === 'image') return typeof (n.data as { src?: unknown }).src === 'string';
  if (n.type !== 'file') return false;
  const d = n.data as { name?: string; mime?: string };
  return vorschauArt(String(d.name ?? ''), d.mime) === 'bild' && !/svg/i.test(`${d.mime ?? ''} ${d.name ?? ''}`);
}
/** … und darf ich das hier? (nur lesen, Karten anderer in der Gruppe) */
export function bildBearbeitbar(n: AppNode | undefined): boolean {
  const st = useBoard.getState();
  return istBildKarte(n) && !selectNurLesen(st) && !karteFest(st.activeId, (n!.data as { von?: string }).von);
}

const BildEditorLazy = lazy(() => import('./BildEditor').then((m) => ({ default: m.BildEditor })));

interface Offen { id: string; quelle: string; name: string; mime: string; frei?: () => void }

export function BildEditorHost() {
  const [offen, setOffen] = useState<Offen | null>(null);
  useEffect(() => {
    const auf = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const n = selectActiveBoard(useBoard.getState())?.nodes.find((k) => k.id === id);
      if (!n || !bildBearbeitbar(n)) return;
      if (n.type === 'image') {
        const d = n.data as { src: string; name?: string; titel?: string };
        setOffen({ id, quelle: d.src, name: d.titel?.trim() || d.name || 'Bild', mime: /^data:([^;,]+)/.exec(d.src)?.[1] ?? 'image/png' });
        return;
      }
      const d = n.data as { name: string; titel?: string; mime?: string; dataUrl?: string };
      const name = d.titel?.trim() || d.name;
      if (d.dataUrl) { setOffen({ id, quelle: d.dataUrl, name, mime: d.mime ?? /^data:([^;,]+)/.exec(d.dataUrl)?.[1] ?? 'image/jpeg' }); return; }
      void loadFile(id).then((b) => {
        if (!b) { showToast('Das Bild liegt nicht auf diesem Gerät – zum Bearbeiten erst laden.'); return; }
        const url = URL.createObjectURL(b);
        setOffen({ id, quelle: url, name, mime: b.type || d.mime || 'image/jpeg', frei: () => URL.revokeObjectURL(url) });
      });
    };
    window.addEventListener(BILD_BEARBEITEN, auf);
    return () => window.removeEventListener(BILD_BEARBEITEN, auf);
  }, []);
  const zu = () => { offen?.frei?.(); setOffen(null); };
  if (!offen) return null;

  const fertig = async (e: BildErgebnis) => {
    const st = useBoard.getState();
    const n = selectActiveBoard(st)?.nodes.find((k) => k.id === offen.id);
    if (!n || !bildBearbeitbar(n)) { zu(); return; }
    const verhaeltnis = e.hoehe / e.breite;
    if (n.type === 'image') {
      const d = n.data as { src: string; name?: string };
      const src = await blobAlsDataUrl(e.blob);
      if (src.length > d.src.length && !canEmbed(src.length - d.src.length)) {
        showToast('Speicher fast voll – das bearbeitete Bild ist größer als vorher und passt nicht mehr ins Board.', false, 7000);
        return;
      }
      st.bildErsetzen(offen.id, { src, ...(d.name ? { name: nameMitEndung(d.name, e.mime) } : {}) }, verhaeltnis);
    } else {
      const d = n.data as { name: string; dataUrl?: string };
      const neu = uid();
      try { await saveFile(neu, e.blob); } catch { showToast('Das Bild ließ sich auf diesem Gerät nicht ablegen.'); return; }
      // klein genug und Platz im Board: Das Bild reist dann auch im Board selbst mit (Teilen-Link, Export)
      let dataUrl: string | undefined;
      if (e.blob.size <= MAX_EMBED_BYTES) {
        const kandidat = await blobAlsDataUrl(e.blob);
        if (canEmbed(Math.max(0, kandidat.length - (d.dataUrl?.length ?? 0)))) dataUrl = kandidat;
      }
      st.bildErsetzen(offen.id, { name: nameMitEndung(d.name, e.mime), mime: e.mime, size: e.blob.size, lokal: true, dataUrl, ref: undefined }, verhaeltnis, neu);
    }
    zu();
  };
  return (
    <Suspense fallback={null}>
      <BildEditorLazy quelle={offen.quelle} name={offen.name} mime={offen.mime} onFertig={fertig} onAbbruch={zu} />
    </Suspense>
  );
}
