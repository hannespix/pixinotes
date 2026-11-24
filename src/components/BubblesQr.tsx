// M513: Mitmachen per QR an einer Ideabubbles-Karte — das große Fenster mit dem Code und der QR-Code auf der Bühne.
//
// Der Code führt NICHT ins Board, sondern auf die schlanke Teilnehmer-Seite (mitmachen.html) nur dieser Karte: Ideen
// einreichen, Punkte vergeben, Ergebnis sehen. Gedacht für große Runden, etwa im Teams-Meeting: Man scrollt per
// Bildschirmfreigabe über das Board, das Publikum scannt den Code und stimmt ab, ohne Gast im ganzen Board zu sein.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBoard } from '../store';
import { qrBild, type QrBild } from '../lib/qr';
import { hierGastgeber, MITMACHEN_EREIGNIS, mitmachenLink, mitmachenStand, type MitmachenKarte } from '../lib/mitmachen';
import { zahlWort } from '../lib/sprache';
import { IX } from './Icons';

/** Teilnehmerzahl und Verbindung einer Runde (live, vom Gastgeber dieses Geräts) */
export function useMitmachenStand(token: string | undefined): { dabei: number; verbunden: boolean } {
  const [s, setS] = useState(() => mitmachenStand(token));
  useEffect(() => {
    const auf = (e: Event) => { if (!token || (e as CustomEvent<{ token: string }>).detail?.token === token) setS(mitmachenStand(token)); };
    auf(new CustomEvent('x', { detail: { token } }));
    window.addEventListener(MITMACHEN_EREIGNIS, auf);
    return () => window.removeEventListener(MITMACHEN_EREIGNIS, auf);
  }, [token]);
  return s;
}

function useQr(url: string): { bild: QrBild | null; fehler: boolean } {
  const [bild, setBild] = useState<QrBild | null>(null);
  const [fehler, setFehler] = useState(false);
  useEffect(() => {
    let da = true;
    setBild(null); setFehler(false);
    qrBild(url).then((b) => { if (da) setBild(b); }).catch(() => { if (da) setFehler(true); });
    return () => { da = false; };
  }, [url]);
  return { bild, fehler };
}

function Code({ url, titel }: { url: string; titel: string }) {
  const { bild, fehler } = useQr(url);
  return (
    <div className="qr-code" data-taste="mit-qr-code" role="img" aria-label={`QR-Code: Mitmachen bei „${titel}"`}>
      {bild ? (
        // immer Schwarz auf Weiß, mit Ruhezone — unabhängig vom Farbschema, sonst liest ihn keine Kamera
        <svg viewBox={`0 0 ${bild.n} ${bild.n}`} shapeRendering="crispEdges" xmlns="http://www.w3.org/2000/svg">
          <rect width={bild.n} height={bild.n} fill="#fff" />
          <path d={bild.pfad} fill="#000" />
        </svg>
      ) : <span className="qr-warte">{fehler ? 'Der Code ließ sich nicht erzeugen.' : 'Code wird erzeugt …'}</span>}
    </div>
  );
}
const dabeiText = (n: number, verbunden: boolean, hier: boolean): string =>
  !hier ? 'Läuft auf einem anderen Gerät' : !verbunden ? 'Verbinde …' : n ? `${zahlWort(n, 'Person', 'Personen')} dabei` : 'Noch niemand dabei';

/** Das große Fenster: Code, Kurzlink, wer dabei ist, Bühne an/aus, Mitmachen beenden */
export function BubblesQr({ karte, titel, m, onClose, buehneSetzen, beenden }: {
  karte: string; titel: string; m: MitmachenKarte; onClose: () => void; buehneSetzen: (an: boolean) => void; beenden: () => void;
}) {
  const showToast = useBoard((s) => s.showToast);
  const url = mitmachenLink(m);
  const { dabei, verbunden } = useMitmachenStand(m.token);
  const hier = hierGastgeber(m.token, karte);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const kopieren = async () => {
    try { await navigator.clipboard.writeText(url); showToast('Link kopiert.'); }
    catch { showToast('Kopieren ging nicht – den Link unter dem Code markieren und kopieren.', false, 7000); }
  };
  return createPortal(
    <div className="qr-blende gross mit-blende" data-taste="mit-qr" role="dialog" aria-modal="true" aria-label="Mitmachen per QR" onClick={onClose}>
      <div className="qr-karte" onClick={(e) => e.stopPropagation()}>
        <div className="qr-kopf">
          <h2>Mitmachen per QR</h2>
          <button className="modal-x" onClick={onClose} aria-label="Schließen" data-taste="mit-qr-zu"><IX size={18} /></button>
        </div>
        <p className="qr-text">
          Code mit der Handy-Kamera scannen – Ideen einreichen und abstimmen bei {'„'}<b translate="no">{titel || 'Ideen'}</b>{'"'}.
          <span className="qr-konto"> Nur diese Karte, nicht das ganze Board. Ohne Konto.</span>
        </p>
        <Code url={url} titel={titel} />
        <div className="qr-adresse" translate="no" data-taste="mit-qr-adresse">{url}</div>
        <div className="qr-fuss">
          <span className="qr-dabei" data-taste="mit-qr-dabei" aria-live="polite">{dabeiText(dabei, verbunden, hier)}</span>
          <span className="qr-knoepfe">
            <button onClick={() => void kopieren()} data-taste="mit-qr-kopieren">Link kopieren</button>
            <button onClick={() => buehneSetzen(!m.buehne)} aria-pressed={!!m.buehne} data-taste="mit-qr-buehne"
              title="Den Code groß in der Karte zeigen – auf dem Board und in der Präsentation">{m.buehne ? 'Von der Bühne nehmen' : 'Groß auf der Bühne zeigen'}</button>
            <button className="mit-ende" onClick={beenden} data-taste="mit-qr-beenden" title="Der Link gilt danach nicht mehr – die Beiträge bleiben in der Karte">Mitmachen beenden</button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Der Code groß in der Karte (Bühne) — auf dem Board beim Teilen des Bildschirms und auf der Folie */
export function MitmachenBuehne({ karte, titel, m, zu }: { karte: string; titel: string; m: MitmachenKarte; zu?: () => void }) {
  const url = mitmachenLink(m);
  const { dabei, verbunden } = useMitmachenStand(m.token);
  const hier = hierGastgeber(m.token, karte);
  return (
    <div className="bub-mit-buehne" data-taste="bub-mit-buehne" onPointerDown={(e) => e.stopPropagation()}>
      <div className="bub-mit-buehne-text">
        <b>Mitmachen</b>
        <span>Code scannen, Ideen einreichen, abstimmen</span>
        <span className="bub-mit-buehne-zahl" data-taste="bub-mit-buehne-dabei" aria-live="polite">{dabeiText(dabei, verbunden, hier)}</span>
      </div>
      <Code url={url} titel={titel} />
      {zu && <button className="bub-mit-buehne-zu" onClick={zu} aria-label="Code von der Bühne nehmen" title="Code von der Bühne nehmen" data-taste="bub-mit-buehne-zu"><IX size={14} /></button>}
    </div>
  );
}
