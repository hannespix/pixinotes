// M529 (M522 O2): Rettungskopie eines unlesbaren gespeicherten Stands — nur sichtbar, wenn es eine gibt
import { useEffect, useState } from 'react';
import { RETTUNG_EREIGNIS, rettungen, rettungHerunterladen, rettungVerwerfen, type Rettung } from '../lib/rettung';

export default function RettungsKopie() {
  const [liste, setListe] = useState<Rettung[]>([]);
  useEffect(() => {
    const laden = () => { void rettungen().then(setListe).catch(() => setListe([])); };
    laden();
    window.addEventListener(RETTUNG_EREIGNIS, laden);
    return () => window.removeEventListener(RETTUNG_EREIGNIS, laden);
  }, []);
  const r = liste.at(-1);
  if (!r) return null;
  return (
    <section className="modal-section" data-taste="rettungskopie">
      <h3>Rettungskopie</h3>
      <p className="modal-hint">
        Der gespeicherte Stand vom {new Date(r.am).toLocaleString('de-DE')} war nicht lesbar. PixiNotes hat ihn aufgehoben, bevor es neu gespeichert hat.
      </p>
      <div className="modal-buttons">
        <button onClick={() => void rettungHerunterladen()} data-taste="rettung-laden">Herunterladen</button>
        <button onClick={() => { if (window.confirm('Rettungskopie endgültig verwerfen?')) void rettungVerwerfen(); }}>Verwerfen</button>
      </div>
    </section>
  );
}
