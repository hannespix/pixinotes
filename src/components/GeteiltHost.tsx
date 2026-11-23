// M483: Was aus einer anderen App (Android, M290) oder der Browser-Erweiterung (M458) ankommt. Hier steht nur, was der
// Start braucht: nachsehen, ob etwas wartet, und auf die Erweiterung hören. Der Dialog (GeteiltDialog.tsx samt Notiz-
// und Board-Übernahme) lädt erst, wenn wirklich etwas angekommen ist.
import { lazy, Suspense, useEffect, useState } from 'react';
import { useBoard } from '../store';
import { geteiltMarkeAbholen, leseGeteiltes, loescheGeteiltes, type Geteiltes } from '../lib/geteilt';
import { erweiterungEingang } from '../lib/erweiterung';
import { eingangSammeln, geteiltesInEingang } from '../lib/eingang';
import { zahlWort } from '../lib/sprache';

const geteiltDialogLaden = () => import('./GeteiltDialog');
const GeteiltDialogSpaet = lazy(() => geteiltDialogLaden().then((m) => ({ default: m.GeteiltDialog })));

interface Wunsch { gabe: Geteiltes; ziel?: string; n: number }

export function GeteiltHost() {
  const [wunsch, setWunsch] = useState<Wunsch | null>(null);
  const zeigen = (gabe: Geteiltes, ziel?: string) => setWunsch((w) => ({ gabe, ziel, n: (w?.n ?? 0) + 1 }));

  /* Beim Start nachsehen, ob etwas im Eingang liegt. Der Umweg über die
     Adressmarke („?geteilt=1") ist Absicht: Ohne sie würde ein alter,
     liegengebliebener Eingang bei jedem Start wieder aufpoppen. */
  useEffect(() => {
    const marke = geteiltMarkeAbholen();
    void leseGeteiltes().then((g) => {
      if (!g) return;
      // Ohne Marke nur übernehmen, was frisch ist (max. 5 Minuten alt)
      const frisch = Date.now() - new Date(g.wann).getTime() < 5 * 60_000;
      if (!marke && !frisch) { void loescheGeteiltes(); return; }
      // M478: Mit „Eingehendes im Eingang sammeln" wartet es dort, statt mitten in der Arbeit nach dem Ziel zu fragen
      if (eingangSammeln()) void geteiltesInEingang(g, 'teilen').finally(() => void loescheGeteiltes());
      else zeigen(g);
    });
  }, []);

  /* M458: Browser-Erweiterung „An PixiNotes senden" — derselbe Dialog. Mit der Einstellung „ohne Rückfrage"
     landet das Gesendete gleich auf dem geöffneten Board, mit einer kurzen Meldung. */
  useEffect(() => erweiterungEingang(({ gabe: g, direkt }) => {
    const st = useBoard.getState();
    /* M478: „Ohne Rückfrage auf das geöffnete Board" ist ein gezieltes Ziel und bleibt direkt; alles andere wartet im
       Eingang (Einstellung, Vorgabe an) statt den Empfangs-Dialog mitten in die Arbeit zu stellen. */
    if (!direkt && eingangSammeln()) { void geteiltesInEingang(g, 'erweiterung'); return; }
    if (!direkt || !st.boards.some((b) => b.id === st.activeId)) { zeigen(g, st.activeId); return; }
    const ziel = st.activeId;
    st.setView('board');
    void geteiltDialogLaden().then((m) => m.aufsBoardLegen(g, ziel)).then((n) => useBoard.getState().showToast(n > 0
      ? `Aus dem Browser übernommen – ${zahlWort(n, 'Karte', 'Karten')} auf „${useBoard.getState().boards.find((b) => b.id === ziel)?.name}".`
      : 'Es war nichts Übernehmbares dabei.'));
  }), []);

  return wunsch
    ? <Suspense fallback={null}><GeteiltDialogSpaet key={wunsch.n} gabe={wunsch.gabe} ziel={wunsch.ziel} onClose={() => setWunsch(null)} /></Suspense>
    : null;
}
