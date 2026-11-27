import { useState, type DragEvent } from 'react';
import { useBoard } from '../store';

type Ebene = 'bereich' | 'projekt' | 'board';
type Zeile = { art: Ebene; id: string; elternId?: string };
type Seite = 'vor' | 'nach' | 'hinein';

function zielSeite(quelle: Zeile, ziel: Zeile, e: DragEvent): Seite | undefined {
  if (quelle.art === ziel.art) {
    if (quelle.id === ziel.id) return;
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? 'vor' : 'nach';
  }
  if ((quelle.art === 'projekt' && ziel.art === 'bereich') ||
      (quelle.art === 'board' && ziel.art === 'projekt')) return 'hinein';
}

/** Gleichrangige Zeilen nehmen vor/nach auf, die Kopfzeile der Elternebene am Ende. */
function ablegen(quelle: Zeile, ziel: Zeile, seite: Seite) {
  const store = useBoard.getState();
  const { spaces } = store;
  if (seite === 'hinein') {
    if (quelle.art === 'projekt') store.moveProject(quelle.id, ziel.id);
    if (quelle.art === 'board' && store.boards.some((b) => b.id === quelle.id)) store.moveBoard(quelle.id, ziel.id);
    return;
  }

  // Den aktuellen Nachbarn erst beim Loslassen bestimmen – auch wenn zwischenzeitlich synchronisiert wurde.
  const bereich = spaces.find((sp) => sp.id === ziel.elternId);
  const projekt = quelle.art === 'board' ? spaces.flatMap((sp) => sp.projects).find((p) => p.id === ziel.elternId) : undefined;
  const ids = quelle.art === 'bereich' ? spaces.map((sp) => sp.id)
    : quelle.art === 'projekt' ? bereich?.projects.map((p) => p.id) : projekt?.boardIds;
  const index = ids?.indexOf(ziel.id) ?? -1;
  if (!ids || index < 0) return;
  const vor = ids[index + (seite === 'nach' ? 1 : 0)];
  if (vor === quelle.id) return;
  if (quelle.art === 'bereich') store.moveSpace(quelle.id, vor);
  if (quelle.art === 'projekt' && bereich) store.moveProject(quelle.id, bereich.id, vor);
  if (quelle.art === 'board' && projekt && store.boards.some((b) => b.id === quelle.id)) {
    if (projekt.sortierung && projekt.sortierung !== 'manuell') store.setProjektSortierung(projekt.id, 'manuell');
    store.moveBoard(quelle.id, projekt.id, vor);
  }
}

export function useBaumZiehen() {
  const [quelle, setQuelle] = useState<Zeile | null>(null);
  const [ziel, setZiel] = useState<(Zeile & { seite: Seite }) | null>(null);
  function beenden() { setQuelle(null); setZiel(null); }

  return (zeile: Zeile, klasse: string, erlaubt = true) => {
    const hier = ziel?.id === zeile.id && ziel.art === zeile.art;
    const aktiv = quelle?.id === zeile.id && quelle.art === zeile.art;
    return {
      className: klasse + (aktiv ? ' zieht' : '') + (hier ? ' ziel-' + ziel.seite : ''),
      draggable: erlaubt,
      onDragStart(e: DragEvent) {
        if (!erlaubt) return;
        e.dataTransfer.setData('text/x-pixinotes-' + zeile.art, zeile.id);
        e.dataTransfer.effectAllowed = 'move';
        setQuelle(zeile);
      },
      onDragEnd: beenden,
      onDragOver(e: DragEvent) {
        const seite = erlaubt && quelle && zielSeite(quelle, zeile, e);
        if (!seite) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!hier || ziel.seite !== seite) setZiel({ ...zeile, seite });
      },
      onDragLeave(e: DragEvent) {
        if (hier && !(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setZiel(null);
      },
      onDrop(e: DragEvent) {
        const seite = erlaubt && quelle && zielSeite(quelle, zeile, e);
        if (!seite || !quelle) return;
        e.preventDefault();
        ablegen(quelle, zeile, seite);
        beenden();
      },
    };
  };
}
