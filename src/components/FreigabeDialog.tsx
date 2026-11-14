// M330: Ein Board für ein anderes PixiNotes-Konto freigeben.
//
// Der Besitzer trägt die E-Mail des Gasts ein. Sobald sich der Gast mit dieser
// E-Mail in PixiNotes anmeldet, erscheint das Board bei ihm unter „Geteilt mit
// mir" und beide arbeiten live auf demselben Stand. Für den Gast zeigt der
// Dialog den Besitzer und bietet „Freigabe verlassen" (das Board bleibt dann als
// eigene Kopie auf dem Gerät).
import { useEffect, useState } from 'react';
import { useBoard } from '../store';
import { freigabeAnlegen, freigabeEntfernen, freigabenDesBoards, freigabeRolleSetzen, freigabeVerlassen, loadKonto, type Freigabe, type FreigabeRolle } from '../lib/kontoSync';
import { einladungDesBoards, einladungLoeschen, EinladungNichtEingerichtet, einladungSetzen, einladungUrl, type Einladung } from '../lib/einladung';
import { gastVerlassen, kontoKanaele } from '../lib/gastSync';
import { IX } from './Icons';

/** M360: Rolle wählen — überall dieselben zwei Wörter */
function RollenWahl({ wert, onChange, disabled, taste, label }: { wert: FreigabeRolle; onChange: (r: FreigabeRolle) => void; disabled?: boolean; taste?: string; label: string }) {
  return (
    <select className="freigabe-rolle" value={wert} disabled={disabled} aria-label={label} data-taste={taste}
      onChange={(e) => onChange(e.target.value === 'lesen' ? 'lesen' : 'bearbeiten')}>
      <option value="bearbeiten">darf bearbeiten</option>
      <option value="lesen">darf nur lesen</option>
    </select>
  );
}

export function FreigabeDialog({ boardId, onClose }: { boardId: string; onClose: () => void }) {
  const board = useBoard((s) => s.boards.find((b) => b.id === boardId));
  const showToast = useBoard((s) => s.showToast);
  const [liste, setListe] = useState<Freigabe[] | null>(null);
  const [mail, setMail] = useState('');
  // M360: Rolle der nächsten Einladung; Einladungslink des Boards (undefined = lädt, null = keiner, 'fehlt' = Server kennt ihn nicht)
  const [rolle, setRolle] = useState<FreigabeRolle>('bearbeiten');
  const [link, setLink] = useState<Einladung | null | undefined | 'fehlt'>(undefined);
  const [linkRolle, setLinkRolle] = useState<FreigabeRolle>('bearbeiten');
  // M364: Der Link lässt auch Leute ohne Konto mitarbeiten
  const [ohneKonto, setOhneKonto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState('');
  const eigenesKonto = loadKonto();
  const gast = !!board?.geteiltVon;
  const perLink = !!board?.gastLink;   // M364: ohne Konto per Link eingewählt
  const nurLesen = board?.geteiltRolle === 'lesen';
  const mailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.trim());

  const laden = async () => {
    try { setListe(await freigabenDesBoards(boardId)); setFehler(''); } catch (e) { setFehler((e as Error).message); setListe([]); }
  };
  useEffect(() => {
    if (!gast) {
      void laden();
      einladungDesBoards(boardId).then((e) => { setLink(e); if (e) { setLinkRolle(e.rolle === 'lesen' ? 'lesen' : 'bearbeiten'); setOhneKonto(!!e.ohne_konto); } })
        .catch((e) => setLink(e instanceof EinladungNichtEingerichtet ? 'fehlt' : null));
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  if (!board) return null;

  const einladen = async () => {
    if (!mailOk || busy) return;
    setBusy(true); setFehler('');
    try {
      await freigabeAnlegen(boardId, mail.trim(), rolle);
      setMail('');
      await laden();
      void kontoKanaele();   // M364: Live-Kanal für dieses Board
      showToast(`✅ „${board.name}" ist für ${mail.trim()} ${rolle === 'lesen' ? 'zum Lesen ' : ''}freigegeben — sobald sich die Person mit dieser E-Mail anmeldet, sieht sie das Board.`, false, 8000);
    } catch (e) { setFehler((e as Error).message); } finally { setBusy(false); }
  };
  const entfernen = async (f: Freigabe) => {
    if (busy) return;
    setBusy(true); setFehler('');
    try { await freigabeEntfernen(f.id); await laden(); showToast(`Freigabe für ${f.gast_email} entfernt.`); } catch (e) { setFehler((e as Error).message); } finally { setBusy(false); }
  };
  // M360: Rolle einer bestehenden Freigabe wechseln — wirkt beim Gast sofort
  const rolleAendern = async (f: Freigabe, r: FreigabeRolle) => {
    if (busy || f.rolle === r) return;
    setBusy(true); setFehler('');
    try { await freigabeRolleSetzen(f.id, r); await laden(); showToast(`${f.gast_email} ${r === 'lesen' ? 'darf jetzt nur noch lesen' : 'darf jetzt bearbeiten'}.`); } catch (e) { setFehler((e as Error).message); } finally { setBusy(false); }
  };
  // M360: Einladungslink
  const kopieren = async (u: string) => {
    try { await navigator.clipboard.writeText(u); showToast('Einladungslink kopiert.'); } catch { window.prompt('Link zum Kopieren (Strg+C):', u); }
  };
  const linkAnlegen = async (r: FreigabeRolle, neu: boolean) => {
    if (busy) return;
    setBusy(true); setFehler('');
    try {
      const e = await einladungSetzen(boardId, r, neu ? ohneKonto : undefined);
      setLink(e); setLinkRolle(r);
      if (neu) await kopieren(einladungUrl(e.token));
      else showToast(`Wer dem Link ab jetzt folgt, ${r === 'lesen' ? 'darf nur lesen' : 'darf bearbeiten'}.`);
    } catch (e) { if (e instanceof EinladungNichtEingerichtet) setLink('fehlt'); else setFehler((e as Error).message); } finally { setBusy(false); }
  };
  // M364: „Auch ohne Konto" an- oder abschalten — wirkt sofort, der Link bleibt derselbe
  const ohneKontoSetzen = async (an: boolean) => {
    if (!link || link === 'fehlt') { setOhneKonto(an); return; }
    if (busy) return;
    setBusy(true); setFehler('');
    try {
      const e = await einladungSetzen(boardId, linkRolle, an);
      setLink(e); setOhneKonto(!!e.ohne_konto);
      showToast(an ? 'Wer den Link öffnet, ist jetzt sofort dabei — auch ohne Konto.' : 'Der Link verlangt jetzt wieder ein PixiNotes-Konto. Gäste ohne Konto sind draußen.', false, 7000);
    } catch (e) { setFehler((e as Error).message); } finally { setBusy(false); }
  };
  const linkWeg = async () => {
    if (busy) return;
    if (!window.confirm('Den Einladungslink widerrufen? Er funktioniert danach nicht mehr. Wer mit Konto beigetreten ist, bleibt in der Liste und lässt sich dort entfernen; Gäste ohne Konto sind sofort draußen.')) return;
    setBusy(true); setFehler('');
    try { await einladungLoeschen(boardId); setLink(null); showToast('Einladungslink widerrufen.'); } catch (e) { setFehler((e as Error).message); } finally { setBusy(false); }
  };
  const linkSenden = async (u: string) => {
    try { await navigator.share({ title: board.name, text: `Einladung zum PixiNotes-Board „${board.name}"`, url: u }); } catch { /* abgebrochen */ }
  };
  const verlassen = async () => {
    if (busy) return;
    if (!window.confirm(`${perLink ? 'Das gemeinsame Board' : 'Die Freigabe von'} „${board.name}" verlassen? Das Board bleibt als eigene Kopie hier, Änderungen der anderen kommen nicht mehr an.`)) return;
    if (perLink) { gastVerlassen(boardId); showToast('Verlassen — das Board ist jetzt eine eigene Kopie.'); onClose(); return; }
    setBusy(true); setFehler('');
    try { await freigabeVerlassen(boardId); showToast('Freigabe verlassen — das Board ist jetzt eine eigene Kopie.'); onClose(); } catch (e) { setFehler((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal freigabe-dialog" role="dialog" aria-modal="true" aria-label="Board freigeben" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>👥 {gast ? 'Geteiltes Board' : 'Gemeinsam bearbeiten'}</h2>
          <button className="modal-x" onClick={onClose} aria-label="Schließen"><IX size={16} /></button>
        </div>
        <div className="modal-body">
          <section className="modal-section">
            {gast ? (
              <>
                {perLink ? (
                  <p className="modal-hint" data-taste="freigabe-per-link">Du bist per <b>Einladungslink</b> in „{board.name}" — ohne Konto. {nurLesen
                    ? <>Du liest live mit, kannst aber nichts ändern.</>
                    : <>Alle arbeiten live im selben Board. Eine Karte gehört dem, der sie gerade bearbeitet — die anderen lesen mit und kommen dran, sobald sie frei ist.</>} Deinen Namen änderst du oben rechts am ersten Kürzel.</p>
                ) : nurLesen ? (
                  <p className="modal-hint" data-taste="freigabe-nur-lesen">„{board.name}" gehört <b>{board.geteiltVonName ?? 'einem anderen Konto'}</b> und ist für dich <b>zum Lesen</b> freigegeben. Du siehst Änderungen live, kannst aber selbst nichts ändern. Für eigene Notizen: Board-Menü → <b>Duplizieren</b> — die Kopie gehört dir.</p>
                ) : (
                  <p className="modal-hint">„{board.name}" gehört <b>{board.geteiltVonName ?? 'einem anderen Konto'}</b> und ist für dich freigegeben. Ihr arbeitet live auf demselben Stand; gleichzeitige Änderungen werden zusammengeführt.</p>
                )}
                <div className="modal-buttons">
                  <button disabled={busy} onClick={verlassen} data-taste="freigabe-verlassen">{busy ? '…' : perLink ? 'Board verlassen' : 'Freigabe verlassen'}</button>
                </div>
              </>
            ) : (
              <>
                <p className="modal-hint">
                  Gemeinsam an „{board.name}" arbeiten: Alle sehen Änderungen live, und eine Karte gehört dem, der sie gerade bearbeitet.
                  Mit dem Einladungslink ist man <b>mit Konto</b> dabei (das Board liegt dann unter <b>Geteilt mit mir</b>) — oder, wenn du es erlaubst,
                  <b> ganz ohne Konto</b>: Link öffnen, Namen sagen, mitmachen. Du legst fest, wer bearbeiten und wer nur lesen darf.
                </p>
                {link !== 'fehlt' && (
                  <div className="freigabe-block" data-taste="einladung">
                    <div className="freigabe-titel">Einladungslink</div>
                    {link === undefined ? (
                      <div className="modal-note">Lade …</div>
                    ) : link ? (
                      <>
                        <div className="link-zeile">
                          <input readOnly value={einladungUrl(link.token)} onFocus={(e) => e.currentTarget.select()} aria-label="Einladungslink" data-taste="einladung-adresse" />
                          <button onClick={() => void kopieren(einladungUrl(link.token))} data-taste="einladung-kopieren">Kopieren</button>
                          {typeof navigator.share === 'function' && <button onClick={() => void linkSenden(einladungUrl(link.token))}>Senden …</button>}
                        </div>
                        <div className="freigabe-zeile">
                          <span>Wer dem Link folgt,</span>
                          <RollenWahl wert={linkRolle} disabled={busy} label="Rolle des Einladungslinks" taste="einladung-rolle" onChange={(r) => void linkAnlegen(r, false)} />
                          <button className="link-weg" disabled={busy} onClick={() => void linkWeg()} data-taste="einladung-weg">Link widerrufen</button>
                        </div>
                        <label className="freigabe-schalter">
                          <input type="checkbox" checked={ohneKonto} disabled={busy} onChange={(e) => void ohneKontoSetzen(e.target.checked)} data-taste="einladung-ohne-konto" />
                          <span><b>Auch ohne Konto</b> — wer den Link öffnet, ist sofort dabei (Gruppenarbeit, Unterricht, Workshop)</span>
                        </label>
                      </>
                    ) : (
                      <div className="freigabe-zeile">
                        <span>Wer dem Link folgt,</span>
                        <RollenWahl wert={linkRolle} disabled={busy} label="Rolle des Einladungslinks" taste="einladung-rolle" onChange={setLinkRolle} />
                        <button disabled={busy || !eigenesKonto} onClick={() => void linkAnlegen(linkRolle, true)} data-taste="einladung-anlegen">{busy ? '…' : 'Link erstellen und kopieren'}</button>
                        <label className="freigabe-schalter">
                          <input type="checkbox" checked={ohneKonto} disabled={busy} onChange={(e) => setOhneKonto(e.target.checked)} data-taste="einladung-ohne-konto" />
                          <span><b>Auch ohne Konto</b> — wer den Link öffnet, ist sofort dabei (Gruppenarbeit, Unterricht, Workshop)</span>
                        </label>
                      </div>
                    )}
                  </div>
                )}
                <div className="freigabe-block">
                  <div className="freigabe-titel">{link === 'fehlt' ? 'Person einladen' : 'Oder eine Person per E-Mail einladen'}</div>
                  <div className="freigabe-zeile">
                    <input type="email" autoComplete="off" placeholder="kollegin@example.de" value={mail} onChange={(e) => setMail(e.target.value)} aria-label="E-Mail"
                      onKeyDown={(e) => { if (e.key === 'Enter') void einladen(); }} data-taste="freigabe-email" />
                    <RollenWahl wert={rolle} disabled={busy} label="Rolle der eingeladenen Person" taste="freigabe-rolle" onChange={setRolle} />
                    <button disabled={!mailOk || busy || !eigenesKonto} onClick={einladen} data-taste="freigabe-einladen">{busy ? '…' : 'Freigeben'}</button>
                  </div>
                </div>
                {liste === null ? (
                  <div className="modal-note">Lade Freigaben …</div>
                ) : liste.length === 0 ? (
                  <div className="modal-note">Noch für niemanden freigegeben.</div>
                ) : (
                  <ul className="freigabe-liste" data-taste="freigabe-liste">
                    {liste.map((f) => (
                      <li key={f.id}>
                        <span className="freigabe-mail">{f.gast_email}</span>
                        <span className={`freigabe-stand ${f.gast_id ? 'an' : ''}`}>{f.gast_id ? 'angenommen' : 'wartet auf Anmeldung'}</span>
                        <RollenWahl wert={f.rolle === 'lesen' ? 'lesen' : 'bearbeiten'} disabled={busy} label={`Rolle von ${f.gast_email}`} onChange={(r) => void rolleAendern(f, r)} />
                        <button className="freigabe-weg" disabled={busy} onClick={() => void entfernen(f)} title="Freigabe entfernen" aria-label={`Freigabe für ${f.gast_email} entfernen`}><IX size={13} /></button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="modal-note">
                  Gäste ohne Konto bekommen auch die Anhänge des Boards (PDF, Bilder) zum Ansehen; bei Gästen mit Konto wandern Anhänge noch nicht mit —
                  Notizen, Karten, Verbindungen und Zeichnungen immer. Wer den Link ohne Konto hat, kann ihn weitergeben: Widerrufen beendet den Zugang für alle.
                  Bei der E-Mail-Einladung braucht die Person ein PixiNotes-Konto mit genau dieser E-Mail. Eine Kopie ohne Konto weitergeben: Board-Menü → <b>Per Link teilen</b>.
                </div>
              </>
            )}
            {fehler && <div className="modal-error" role="alert">⚠️ {fehler}</div>}
          </section>
        </div>
      </div>
    </div>
  );
}
