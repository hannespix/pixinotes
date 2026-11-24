// M516: „Als App installieren" — Diagnose in Klartext, wenn der Browser gerade keinen Installations-Dialog anbietet.
// Wird erst geladen, wenn jemand den Eintrag wählt (⋯ der Leiste, Strg+K) und der Browser kein Angebot gemacht hat.
import { useEffect, useRef, useState } from 'react';
import { appInstallieren, installStand } from '../lib/appInstallieren';
import { useBoard } from '../store';
import { IX } from './Icons';

type Os = 'ios' | 'android' | 'windows' | 'mac' | 'linux' | 'anderes';
type Browser = 'chrome' | 'edge' | 'firefox' | 'safari' | 'samsung' | 'opera' | 'anderer';

/** Browser und System aus der Kennung — nur für die passende Anleitung, nie für Entscheidungen über Funktionen */
export function umgebungErkennen(ua: string, beruehrung: number): { os: Os; browser: Browser } {
  const os: Os = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && beruehrung > 1) ? 'ios'
    : /Android/.test(ua) ? 'android'
      : /Windows/.test(ua) ? 'windows'
        : /Macintosh|Mac OS X/.test(ua) ? 'mac'
          : /Linux|CrOS/.test(ua) ? 'linux' : 'anderes';
  const browser: Browser = /Firefox|FxiOS/.test(ua) ? 'firefox'
    : /SamsungBrowser/.test(ua) ? 'samsung'
      : /Edg\/|EdgA\/|EdgiOS\//.test(ua) ? 'edge'
        : /OPR\/|Opera/.test(ua) ? 'opera'
          : /Chrome\/|CriOS\/|Chromium\//.test(ua) ? 'chrome'
            : /Safari\//.test(ua) ? 'safari' : 'anderer';
  return { os, browser };
}

/** Läuft PixiNotes gerade als installierte App (eigenes Fenster, Home-Bildschirm)? */
export function laeuftAlsApp(): boolean {
  const mm = (q: string) => window.matchMedia?.(q).matches === true;
  return mm('(display-mode: standalone)') || mm('(display-mode: window-controls-overlay)') || mm('(display-mode: minimal-ui)')
    || mm('(display-mode: fullscreen)') || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

interface Anleitung { titel: string; schritte: string[] }

/** Wo im Browser „Installieren" steht */
function anleitung(os: Os, browser: Browser): Anleitung {
  if (os === 'ios') {
    return { titel: 'iPhone / iPad', schritte: [
      'Teilen-Knopf antippen (Quadrat mit Pfeil nach oben).',
      '„Zum Home-Bildschirm“ wählen und „Hinzufügen“ antippen.',
      'Das geht in Safari, seit iOS 16.4 auch in Chrome und Edge.',
    ] };
  }
  if (browser === 'firefox') {
    return os === 'android'
      ? { titel: 'Firefox (Android)', schritte: ['Menü ⋮ → „Installieren“ (bzw. „Zum Startbildschirm hinzufügen“).'] }
      : { titel: 'Firefox', schritte: ['Firefox installiert Web-Apps am Computer nicht.', 'Öffne PixiNotes in Chrome oder Edge und installiere es dort.'] };
  }
  if (browser === 'samsung') return { titel: 'Samsung Internet', schritte: ['Menü ≡ → „Seite hinzufügen zu“ → „Startbildschirm“.'] };
  if (browser === 'safari') {
    return { titel: 'Safari (Mac)', schritte: ['Menü „Ablage“ → „Zum Dock hinzufügen …“ (ab macOS Sonoma).'] };
  }
  if (os === 'android') {
    return { titel: browser === 'edge' ? 'Edge (Android)' : 'Chrome (Android)', schritte: ['Menü ⋮ → „App installieren“ (bzw. „Zum Startbildschirm hinzufügen“).'] };
  }
  if (browser === 'edge') {
    return { titel: 'Edge', schritte: [
      'Rechts in der Adressleiste auf das Symbol „App verfügbar“ klicken – oder:',
      'Menü … → „Apps“ → „Diese Website als App installieren“.',
      'Steht dort „PixiNotes öffnen“, ist die App schon installiert. Alle Apps: edge://apps',
    ] };
  }
  if (browser === 'chrome') {
    return { titel: 'Chrome', schritte: [
      'Rechts in der Adressleiste auf das Symbol „Installieren“ klicken (Bildschirm mit Pfeil) – fehlt es, dann:',
      'Menü ⋮ → „Speichern und teilen“ (bzw. „Streamen, speichern und teilen“) → „Seite als App installieren …“.',
      'Steht dort „PixiNotes öffnen“ oder „In App öffnen“, ist die App schon installiert. Alle Apps: chrome://apps',
    ] };
  }
  return { titel: 'Dieser Browser', schritte: ['Im Menü des Browsers nach „Installieren“ oder „Als App installieren“ suchen.', 'Sicher geht es in Chrome oder Edge.'] };
}

type Lage = 'app' | 'datei' | 'unsicher' | 'installiert' | 'bereit' | 'nicht';

export function AppInstallierenFenster({ onClose }: { onClose: () => void }) {
  const zu = useRef<HTMLButtonElement>(null);
  const [bereit, setBereit] = useState(() => installStand().bereit);
  const [installiert, setInstalliert] = useState(false);
  const [swAktiv, setSwAktiv] = useState(() => !!navigator.serviceWorker?.controller);
  const { os, browser } = umgebungErkennen(navigator.userAgent, navigator.maxTouchPoints ?? 0);
  const chromium = browser === 'chrome' || browser === 'edge' || browser === 'opera' || browser === 'samsung';

  useEffect(() => {
    zu.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    // Kommt das Angebot des Browsers, während das Fenster offen ist, steht der Knopf gleich da
    const angebot = () => setBereit(true);
    const fertig = () => onClose();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('beforeinstallprompt', angebot);
    window.addEventListener('appinstalled', fertig);
    // Ist die App auf diesem Browser schon installiert? (Chrome/Edge; braucht related_applications im Manifest)
    const nav = navigator as Navigator & { getInstalledRelatedApps?: () => Promise<Array<{ platform: string }>> };
    void nav.getInstalledRelatedApps?.().then((l) => { if (l.some((a) => a.platform === 'webapp')) setInstalliert(true); }).catch(() => {});
    void navigator.serviceWorker?.ready.then(() => setSwAktiv(!!navigator.serviceWorker.controller)).catch(() => {});
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('beforeinstallprompt', angebot);
      window.removeEventListener('appinstalled', fertig);
    };
  }, [onClose]);

  const lage: Lage = laeuftAlsApp() ? 'app'
    : location.protocol === 'file:' ? 'datei'
      : !window.isSecureContext ? 'unsicher'
        : installiert ? 'installiert'
          : bereit ? 'bereit' : 'nicht';
  const a = anleitung(os, browser);
  const stand = installStand();
  // Nie angeboten: weder vorher noch während das Fenster offen ist — und die Seite ist schon eine Weile geladen
  const nieAngeboten = !stand.angeboten && !bereit && performance.now() > 8000;

  const kopf: Record<Lage, string> = {
    app: 'PixiNotes läuft bereits als App.',
    datei: 'Die portable Datei lässt sich nicht installieren.',
    unsicher: 'Installieren geht nur über eine sichere Adresse (https).',
    installiert: 'PixiNotes ist auf diesem Browser schon installiert.',
    bereit: 'Der Browser bietet die Installation jetzt an.',
    nicht: 'Der Browser bietet die Installation gerade nicht von selbst an.',
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal app-installieren" role="dialog" aria-modal="true" aria-label="Als App installieren" data-taste="app-installieren" data-lage={lage} data-browser={browser} data-os={os} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Als App installieren</h2>
          <button ref={zu} className="modal-x" onClick={onClose} aria-label="Schließen"><IX size={16} /></button>
        </div>
        <div className="modal-body">
          <p className="app-installieren-lage" role="status" data-taste="app-installieren-lage"><b>{kopf[lage]}</b></p>
          {lage === 'app' && (
            <p className="modal-hint">Hier ist nichts mehr zu tun. Eine weitere Verknüpfung legst du im Browser-Fenster an, nicht in der App.</p>
          )}
          {lage === 'datei' && (
            <p className="modal-hint">Öffne PixiNotes unter <span translate="no">hannespix.github.io/pixinotes</span> und installiere es von dort. Deine Boards nimmst du mit Einstellungen → Daten → „Alles sichern“ mit.</p>
          )}
          {lage === 'installiert' && (
            <p className="modal-hint">Öffne sie über das Startmenü, den Schreibtisch oder das Dock – oder im Browser über das Symbol „In App öffnen“ rechts in der Adressleiste.</p>
          )}
          {lage === 'bereit' && (
            <div className="modal-buttons">
              <button className="primaer" data-taste="app-installieren-jetzt" onClick={() => { onClose(); void appInstallieren(); }}>Jetzt installieren</button>
            </div>
          )}
          {(lage === 'nicht' || lage === 'installiert') && (
            <>
              <h3 className="app-installieren-h">{`So geht es in ${a.titel}`}</h3>
              <ol className="app-installieren-schritte" data-taste="app-installieren-anleitung">
                {a.schritte.map((s) => <li key={s}>{s}</li>)}
              </ol>
            </>
          )}
          {lage === 'nicht' && (
            <>
              {nieAngeboten && (
                <p className="modal-hint" data-taste="app-installieren-nie">Seit dem Öffnen dieser Seite hat der Browser keine Installation angeboten.</p>
              )}
              <h3 className="app-installieren-h">Mögliche Gründe</h3>
              <ul className="app-installieren-gruende" data-taste="app-installieren-gruende">
                {chromium && os !== 'android' && <li data-grund="richtlinie"><b>Vom Arbeitgeber verwalteter Browser:</b> Steht ganz unten im Menü ⋮ „Von deiner Organisation verwaltet“ und fehlt „Seite als App installieren“, hat die IT das Installieren von Web-Apps abgeschaltet (Richtlinie <span translate="no">WebAppInstallByUserEnabled</span>). Nachsehen unter {browser === 'edge' ? 'edge://policy' : 'chrome://policy'}; freigeben kann es nur die IT.</li>}
                {chromium && <li data-grund="schon"><b>Schon installiert:</b> Dann bietet der Browser „In App öffnen“ bzw. „PixiNotes öffnen“ statt „Installieren“ an.</li>}
                {chromium && os !== 'android' && <li data-grund="symbol"><b>Symbol ausgeblendet:</b> Das Symbol in der Adressleiste fehlt manchmal – der Weg über das Menü geht trotzdem.</li>}
                {stand.abgelehnt && <li data-grund="abgelehnt"><b>Eben abgelehnt:</b> Der Browser fragt erst nach einer Weile wieder – über das Menü geht es sofort.</li>}
                {chromium && !stand.abgelehnt && <li data-grund="frueher"><b>Früher weggeklickt:</b> Dann wartet der Browser eine Weile, bevor er wieder fragt – über das Menü geht es sofort.</li>}
                <li data-grund="privat"><b>Privates Fenster:</b> Inkognito bzw. InPrivate kann nichts installieren.</li>
                {!swAktiv && <li data-grund="laden"><b>Noch nicht fertig geladen:</b> Der Offline-Teil läuft noch nicht – die Seite einmal neu laden.</li>}
              </ul>
              {chromium && os !== 'android' && (
                <>
                  <h3 className="app-installieren-h">Ausweg: eigenes Fenster ohne Installation</h3>
                  <ol className="app-installieren-schritte" data-taste="app-installieren-ausweg">
                    <li>{browser === 'edge'
                      ? 'Menü … → „Weitere Tools“ → „Verknüpfung erstellen …“.'
                      : 'Menü ⋮ → „Speichern und teilen“ → „Verknüpfung erstellen …“.'}</li>
                    <li>Häkchen bei „Als Fenster öffnen“ setzen und „Erstellen“ klicken.</li>
                    <li>PixiNotes startet dann vom Schreibtisch im eigenen Fenster. Fehlt das Häkchen, entsteht eine normale Verknüpfung, die im Browser öffnet.</li>
                  </ol>
                </>
              )}
            </>
          )}
          <div className="modal-buttons">
            <button className="link-btn" onClick={() => { onClose(); useBoard.getState().setHelpOpen(true, 'daten'); }}>Mehr in der Hilfe</button>
            <button onClick={onClose}>Schließen</button>
          </div>
        </div>
      </div>
    </div>
  );
}
