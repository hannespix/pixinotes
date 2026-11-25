// M529: „Speicher aufräumen" in den Konto-Einstellungen — zeigt Dateien im Konto, auf die nichts mehr verweist, und
// löscht sie erst nach Bestätigung (lib/kontoAufraeumen.ts). Nichts geschieht von selbst.
import { useState } from 'react';
import { useBoard } from '../store';
import { zahlWort } from '../lib/sprache';
import type { Aufraeumen } from '../lib/kontoAufraeumen';

const mb = (b: number): string => (b / (1024 * 1024)).toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export default function KontoAufraeumen() {
  const showToast = useBoard((s) => s.showToast);
  const [stand, setStand] = useState<Aufraeumen | null | 'fehler'>(null);
  const [laeuft, setLaeuft] = useState(false);

  const pruefen = async () => {
    setLaeuft(true);
    try { setStand((await (await import('../lib/kontoAufraeumen')).speicherPruefen()) ?? 'fehler'); } catch { setStand('fehler'); }
    setLaeuft(false);
  };
  const loeschen = async () => {
    if (!stand || stand === 'fehler' || !stand.leichen.length) return;
    if (!window.confirm(`${zahlWort(stand.leichen.length, 'Datei', 'Dateien')} (${mb(stand.groesse)} MB) im Konto löschen? Auf sie verweist keine Karte mehr. Das lässt sich nicht rückgängig machen.`)) return;
    setLaeuft(true);
    try {
      const n = await (await import('../lib/kontoAufraeumen')).speicherAufraeumen(stand);
      showToast(`${zahlWort(n, 'Datei', 'Dateien')} im Konto gelöscht.`);
      setStand((await (await import('../lib/kontoAufraeumen')).speicherPruefen()) ?? 'fehler');
    } catch (e) { showToast(`Aufräumen abgebrochen: ${(e as Error).message}`, false, 8000); }
    setLaeuft(false);
  };

  return (
    <details className="konto-aufraeumen" data-taste="konto-aufraeumen">
      <summary>Speicher aufräumen</summary>
      <div className="modal-note">
        Zeigt Dateien im Konto, auf die keine Karte mehr verweist (etwa nach einem Import). Gelöscht wird erst nach deiner Bestätigung; was jünger als 24 Stunden ist, bleibt.
      </div>
      <div className="modal-buttons">
        <button disabled={laeuft} onClick={() => void pruefen()} data-taste="konto-aufraeumen-pruefen">{laeuft ? '…' : 'Speicher prüfen'}</button>
        {stand && stand !== 'fehler' && stand.leichen.length > 0 && (
          <button disabled={laeuft} className="danger" onClick={() => void loeschen()} data-taste="konto-aufraeumen-loeschen">
            {zahlWort(stand.leichen.length, 'Datei', 'Dateien')} löschen
          </button>
        )}
      </div>
      {stand === 'fehler' && <div className="modal-error" role="alert">Der Speicher im Konto ließ sich gerade nicht vollständig lesen – nichts wird angeboten. Später noch einmal prüfen.</div>}
      {stand && stand !== 'fehler' && (
        <div className="modal-note" data-taste="konto-aufraeumen-stand" role="status">
          {stand.leichen.length
            ? `${zahlWort(stand.leichen.length, 'Datei', 'Dateien')} ohne Verweis, zusammen ${mb(stand.groesse)} MB.`
            : 'Nichts aufzuräumen – auf jede Datei im Konto verweist eine Karte.'}
          {stand.geschont > 0 ? ` ${zahlWort(stand.geschont, 'jüngere Datei bleibt', 'jüngere Dateien bleiben')} (unter 24 Stunden).` : ''}
        </div>
      )}
    </details>
  );
}
