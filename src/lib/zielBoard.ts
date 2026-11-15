// M388: Was länger dauert, landet dort, wo es begonnen hat.
//
// KI-Aktionen und die Handschrift-Erkennung warten auf eine Antwort (Sekunden bis eine halbe Minute) und schreiben
// ihr Ergebnis danach auf „das Board". Wechselte man in der Wartezeit das Board, erschien die Zusammenfassung auf
// dem falschen, und die Änderungen an den ursprünglichen Karten verpufften. Jetzt geht es vor dem Schreiben
// zurück auf das Board, auf dem die Aktion gestartet wurde.
import { useBoard } from '../store';

export async function aufDemselbenBoard<T>(fn: () => Promise<T>): Promise<T> {
  const start = useBoard.getState().activeId;
  const r = await fn();
  const st = useBoard.getState();
  if (st.activeId !== start && st.boards.some((b) => b.id === start)) {
    st.openBoard(start);
    st.showToast('↩ Zurück auf dem Board, auf dem die Aktion begonnen hat — dort liegt das Ergebnis.', false, 5000);
  }
  return r;
}
