/**
 * M466: Fenster „Outlook" — die letzten Mails des Posteingangs (oder eine Suche) aus Microsoft 365, je Mail ein Knopf
 * „Aufs Board". Ein Einstieg: Strg+K „Outlook" oder ＋ → Einfügen → Outlook. Wird erst beim ersten Aufruf geladen.
 *
 * Nur lesen. Die Anmeldung ist dieselbe Microsoft-Verbindung wie für Kalender und OneNote (lib/calAccounts.ts) —
 * wer schon für den Kalender verbunden ist, schaltet hier mit einem Bestätigen das Postfach frei.
 */
import { useCallback, useEffect, useState } from 'react';
import { useBoard, selectActiveBoard } from '../store';
import { findFreeSpot } from '../lib/arrange';
import { makeEmail } from '../lib/nodes';
import { karteEntschaerfen } from '../lib/sicher';
import { patchCalAccounts, loadCalAccounts } from '../lib/calAccounts';
import { outlookAbmelden, outlookAnmelden, outlookClientId, outlookListe, outlookMail, outlookStand, outlookTenant, outlookVorgabe, type OutlookMail } from '../lib/outlook';
import { IMail, IPaperclip, IReload, ISearch, IX } from './Icons';
import { zahlWort } from '../lib/sprache';
import { inEingangLegen } from '../lib/eingang';

/** Mitte des sichtbaren Ausschnitts in Board-Koordinaten (ohne React-Flow-Kontext: aus der Transformation) */
function sichtMitte(w: number, h: number): { x: number; y: number } {
  const vp = document.querySelector('.react-flow__viewport') as HTMLElement | null;
  const flaeche = document.querySelector('.react-flow') as HTMLElement | null;
  if (!vp || !flaeche) return { x: 120, y: 120 };
  const m = new DOMMatrixReadOnly(getComputedStyle(vp).transform);
  const r = flaeche.getBoundingClientRect();
  const z = m.a || 1;
  return { x: (r.width / 2 - m.e) / z - w / 2, y: (r.height / 2 - m.f) / z - h / 2 };
}

const datumText = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  const heute = new Date();
  return d.toDateString() === heute.toDateString()
    ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: d.getFullYear() === heute.getFullYear() ? undefined : '2-digit' });
};

export function OutlookFenster({ onClose }: { onClose: () => void }) {
  const showToast = useBoard((s) => s.showToast);
  const boards = useBoard((s) => s.boards);
  const [stand, setStand] = useState(outlookStand);
  const [mails, setMails] = useState<OutlookMail[] | null>(null);
  const [suche, setSuche] = useState('');
  const [gesucht, setGesucht] = useState('');
  const [busy, setBusy] = useState('');
  const [fehler, setFehler] = useState('');
  const [mitAnhaengen, setMitAnhaengen] = useState(false);
  const [mail, setMail] = useState('');
  const [appId, setAppId] = useState(() => loadCalAccounts().ms?.clientId ?? '');
  const [tenant, setTenant] = useState(() => loadCalAccounts().ms?.tenant ?? '');

  // Verbinden/Trennen anderswo (Einstellungen) schlägt sofort hierher durch
  useEffect(() => {
    const auf = () => setStand(outlookStand());
    window.addEventListener('pixinotes-cal-accounts', auf);
    return () => window.removeEventListener('pixinotes-cal-accounts', auf);
  }, []);

  const laden = useCallback(async (q: string) => {
    setBusy('liste'); setFehler('');
    try {
      setMails(await outlookListe(q));
      setGesucht(q);
    } catch (e) {
      setFehler((e as Error).message);
    } finally { setBusy(''); }
  }, []);

  useEffect(() => {
    if (stand === 'bereit' && mails === null) void laden('');
    if (stand !== 'bereit') setMails(null);
  }, [stand, mails, laden]);

  // Welche Mails liegen schon auf einem Board? (Merker outlookId an der Karte)
  const schonDa = new Set<string>();
  for (const b of boards) for (const n of b.nodes) {
    const oid = n.type === 'email' ? (n.data as { outlookId?: unknown }).outlookId : undefined;
    if (typeof oid === 'string') schonDa.add(oid);
  }

  const anmelden = async () => {
    setBusy('anmelden'); setFehler('');
    try {
      const id = outlookVorgabe() ? outlookClientId() : appId.trim() || outlookClientId();
      if (!outlookVorgabe() && appId.trim()) patchCalAccounts({ ms: { ...(loadCalAccounts().ms ?? {}), clientId: appId.trim(), tenant: tenant.trim() || 'common' } });
      const name = await outlookAnmelden(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.trim()) ? mail.trim() : undefined, id, outlookVorgabe() ? outlookTenant() : tenant.trim() || outlookTenant());
      setStand(outlookStand());
      showToast(`Outlook verbunden: ${name}`);
    } catch (e) {
      setFehler((e as Error).message);
    } finally { setBusy(''); }
  };

  const abmelden = () => {
    outlookAbmelden();
    setMails(null);
    setStand(outlookStand());
    showToast('Von Microsoft abgemeldet – Zugangsdaten auf diesem Gerät gelöscht.');
  };

  const holen = async (m: OutlookMail) => {
    setBusy(m.id); setFehler('');
    try {
      const daten = await outlookMail(m.id, mitAnhaengen);
      const st = useBoard.getState();
      if (st.view !== 'board') st.setView('board');
      const lage = findFreeSpot(selectActiveBoard(useBoard.getState()).nodes, sichtMitte(340, 260), { w: 340, h: 260 });
      const karte = karteEntschaerfen(makeEmail(lage, daten));
      useBoard.getState().addNode(karte);
      useBoard.getState().focusNode(useBoard.getState().activeId, karte.id);
      showToast(`„${daten.subject}" aufs Board geholt${daten.attachments.length ? ` – ${zahlWort(daten.attachments.length, 'Anhang', 'Anhänge')}` : ''}.`);
    } catch (e) {
      setFehler((e as Error).message);
    } finally { setBusy(''); }
  };

  /** M478: „Später" — die Mail wartet im Eingang, bis man sie einsortiert (das offene Board bleibt unberührt) */
  const spaeter = async (m: OutlookMail) => {
    setBusy(m.id); setFehler('');
    try {
      const daten = await outlookMail(m.id, mitAnhaengen);
      inEingangLegen([karteEntschaerfen(makeEmail({ x: 0, y: 0 }, daten))], 'outlook');
      showToast(`„${daten.subject}" liegt im Eingang – einsortieren über „Eingang" in der Spalte.`);
    } catch (e) {
      setFehler((e as Error).message);
    } finally { setBusy(''); }
  };

  return (
    <div className="modal-backdrop nodrag" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="modal outlook-modal" role="dialog" aria-modal="true" aria-label="Outlook"
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
      >
        <div className="modal-head">
          <h2><IMail size={16} /> Outlook</h2>
          <button className="modal-x" title="Schließen" onClick={onClose}><IX size={16} /></button>
        </div>
        <div className="modal-body">
          <p className="modal-hint">Mails aus Microsoft 365 als E-Mail-Karte aufs Board holen. Gelesen wird nur – im Postfach ändert sich nichts. Die Termine erscheinen in der Kalender-Karte.</p>

          {stand === 'ohne-web' && (
            <div className="modal-note" data-taste="outlook-ohne-web">Das Anmelden braucht die gehostete App (http/https), nicht die Einzeldatei. Ohne Anmeldung: Mail in Outlook als .eml oder .msg speichern und aufs Board ziehen.</div>
          )}

          {stand === 'ohne-id' && (
            <>
              <div className="modal-note" data-taste="outlook-nicht-eingerichtet">Die Microsoft-Anmeldung ist auf dieser Installation noch nicht eingerichtet. Bis dahin: Mail in Outlook als .eml oder .msg speichern und aufs Board ziehen.</div>
              {!outlookVorgabe() && (
                <details className="modal-details" data-taste="outlook-betreiber">
                  <summary>Für Betreiber: Microsoft-Anmeldung einrichten</summary>
                  <label className="modal-row">
                    <span>App-ID (Client)</span>
                    <input type="text" placeholder="00000000-0000-0000-0000-000000000000" value={appId} onChange={(e) => setAppId(e.target.value)} />
                  </label>
                  <label className="modal-row">
                    <span>Tenant (optional)</span>
                    <input type="text" placeholder="common (oder eure Tenant-ID)" value={tenant} onChange={(e) => setTenant(e.target.value)} />
                  </label>
                  <div className="modal-buttons">
                    <button disabled={!appId.trim()} onClick={() => { patchCalAccounts({ ms: { ...(loadCalAccounts().ms ?? {}), clientId: appId.trim(), tenant: tenant.trim() || 'common' } }); setStand(outlookStand()); }}>Übernehmen</button>
                  </div>
                  <div className="modal-note">
                    Einmalig in Microsoft Entra ID: App-Registrierung als „Single-Page-Anwendung" mit der Umleitungs-URI <code>{location.origin + location.pathname}</code>,
                    delegierte Berechtigungen Mail.Read, Calendars.Read, User.Read, offline_access. Am besten als Repository-Variable <code>VITE_MS_CLIENT_ID</code>
                    (und <code>VITE_MS_TENANT</code>) hinterlegen – dann sieht kein Nutzer diese Felder.
                  </div>
                </details>
              )}
            </>
          )}

          {(stand === 'abgemeldet' || stand === 'ohne-postfach') && (
            <>
              {stand === 'abgemeldet' && (
                <label className="modal-row">
                  <span>Microsoft-Konto</span>
                  <input type="email" autoComplete="email" placeholder="name@firma.de (optional)" value={mail} onChange={(e) => setMail(e.target.value)} data-taste="outlook-mail" />
                </label>
              )}
              <div className="modal-buttons">
                <button disabled={busy === 'anmelden'} onClick={() => void anmelden()} data-taste="outlook-anmelden">
                  {busy === 'anmelden' ? '…' : stand === 'abgemeldet' ? 'Mit Microsoft anmelden' : 'Postfach freischalten'}
                </button>
              </div>
              <div className="modal-note">
                {stand === 'abgemeldet'
                  ? 'Microsoft öffnet ein kleines Fenster: Konto bestätigen, Lesen von Mails und Kalender erlauben – fertig.'
                  : 'Das Microsoft-Konto ist für den Kalender verbunden, aber noch ohne Postfach. Einmal bestätigen genügt.'}
              </div>
            </>
          )}

          {stand === 'bereit' && (
            <>
              <form className="outlook-suche" onSubmit={(e) => { e.preventDefault(); void laden(suche.trim()); }}>
                <ISearch size={14} />
                <input
                  type="search" value={suche} placeholder="Postfach durchsuchen …" aria-label="Postfach durchsuchen"
                  onChange={(e) => setSuche(e.target.value)} data-taste="outlook-suche"
                />
                <button type="submit" disabled={busy === 'liste'}>Suchen</button>
                <button type="button" title="Posteingang neu laden" aria-label="Posteingang neu laden" disabled={busy === 'liste'} onClick={() => { setSuche(''); void laden(''); }}>
                  <IReload size={14} />
                </button>
              </form>
              <label className="modal-row modal-row-check">
                <span>Anhänge mitholen</span>
                <input type="checkbox" checked={mitAnhaengen} onChange={(e) => setMitAnhaengen(e.target.checked)} data-taste="outlook-anhaenge" />
              </label>
              <div className="outlook-kopf">
                {busy === 'liste' ? 'Lade …' : mails ? (gesucht ? `${zahlWort(mails.length, 'Treffer', 'Treffer')} für „${gesucht}"` : `Posteingang · ${zahlWort(mails.length, 'Mail', 'Mails')}`) : ''}
              </div>
              <ul className="outlook-liste" data-taste="outlook-liste">
                {(mails ?? []).map((m) => (
                  <li key={m.id} className={m.gelesen ? 'outlook-mail' : 'outlook-mail ungelesen'}>
                    <div className="outlook-text">
                      <div className="outlook-zeile1">
                        <b translate="no">{m.vonName}</b>
                        <span className="outlook-datum">{datumText(m.datum)}</span>
                      </div>
                      <div className="outlook-betreff" translate="no">{m.anhaenge && <IPaperclip size={12} />} {m.betreff}</div>
                      <div className="outlook-vorschau" translate="no">{m.vorschau}</div>
                    </div>
                    <button className="outlook-spaeter" disabled={busy === m.id} onClick={() => void spaeter(m)} data-taste="outlook-spaeter" title="In den Eingang legen und später einsortieren">Später</button>
                    <button disabled={busy === m.id} onClick={() => void holen(m)} data-taste="outlook-holen" title={schonDa.has(m.id) ? 'Liegt schon auf einem Board – noch einmal holen' : 'Als E-Mail-Karte aufs Board legen'}>
                      {busy === m.id ? '…' : schonDa.has(m.id) ? 'Noch einmal' : 'Aufs Board'}
                    </button>
                  </li>
                ))}
                {mails && mails.length === 0 && busy !== 'liste' && <li className="outlook-leer">Keine Mails gefunden.</li>}
              </ul>
              <div className="modal-buttons">
                <span className="outlook-konto" translate="no">{loadCalAccounts().ms?.connectedAs ?? ''}</span>
                <button onClick={abmelden} data-taste="outlook-abmelden" title="Trennt das Microsoft-Konto auf diesem Gerät – auch Kalender und OneNote">Abmelden</button>
              </div>
            </>
          )}

          {fehler && <div className="modal-error">{fehler}</div>}
        </div>
      </div>
    </div>
  );
}
