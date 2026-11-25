// M330: Ein Board für ein anderes PixiNotes-Konto freigeben.
//
// Der Besitzer trägt die E-Mail des Gasts ein. Sobald sich der Gast mit dieser
// E-Mail in PixiNotes anmeldet, erscheint das Board bei ihm unter „Geteilt mit
// mir" und beide arbeiten live auf demselben Stand. Für den Gast zeigt der
// Dialog den Besitzer und bietet „Freigabe verlassen" (das Board bleibt dann als
// eigene Kopie auf dem Gerät).
import { QR_EREIGNIS } from '../lib/qr';
import { useEffect, useRef, useState } from 'react';
import { fensterDarueber } from '../lib/overlay';
import { useBoard } from '../store';
import { freigabeAnlegen, freigabeEntfernen, freigabenDesBoards, freigabeRolleSetzen, freigabeVerlassen, kontoIstEigenes, loadKonto, type Freigabe, type FreigabeRolle } from '../lib/kontoSync';
import { einladungDesBoards, einladungLoeschen, EinladungNichtEingerichtet, einladungSetzen, einladungUrl, type Einladung } from '../lib/einladung';
import { gastVerlassen, kontoKanaele, rechtAus, sicherungVon, sicherungZurueck } from '../lib/gastSync';
import { gruppeVon, type GastRecht } from '../store';
import { IX } from './Icons';
import { eigenerLook, eigenerLookSetzen, lookAktiv, lookAusUi, lookWort } from '../lib/boardLook';

// M459: Ereignis und Host liegen in FreigabeHost.tsx (im Start), dieser Dialog kommt beim ersten Öffnen
export { FREIGABE_OEFFNEN, FreigabeHost } from './FreigabeHost';

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
  const huelle = useRef<HTMLDivElement>(null);   // M530: das eigene Fenster für fensterDarueber
  const [liste, setListe] = useState<Freigabe[] | null>(null);
  const [mail, setMail] = useState('');
  // M360: Rolle der nächsten Einladung; Einladungslink des Boards (undefined = lädt, null = keiner, 'fehlt' = Server kennt ihn nicht)
  const [rolle, setRolle] = useState<FreigabeRolle>('bearbeiten');
  const [link, setLink] = useState<Einladung | null | undefined | 'fehlt'>(undefined);
  const [linkRolle, setLinkRolle] = useState<FreigabeRolle>('bearbeiten');
  // M364: Der Link lässt auch Leute ohne Konto mitarbeiten
  // M391: Vorgabe ist der unkomplizierte Weg — Link öffnen, Namen sagen, mitmachen. Ein Konto verlangt, wer es will.
  const [ohneKonto, setOhneKonto] = useState(true);
  // M365: Was Gäste dürfen; Sicherung von vor der Gruppenarbeit (Zeitpunkt)
  const [recht, setRecht] = useState<GastRecht>('alles');
  const [sicherung, setSicherung] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState('');
  const eigenesKonto = kontoIstEigenes() ? loadKonto() : null;
  const andererWeg = !eigenesKonto && !!loadKonto();   // mit Google/Microsoft-Ablage angemeldet
  const gast = !!board?.geteiltVon;
  const perLink = !!board?.gastLink;   // M364: ohne Konto per Link eingewählt
  const nurLesen = board?.geteiltRolle === 'lesen';
  const mailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.trim());
  // M509: Look des Boards — der Teilende gibt seinen mit (Vorgabe an), Gäste können für sich darauf verzichten
  const ui = useBoard((s) => s.ui);
  const setBoardLook = useBoard((s) => s.setBoardLook);
  const [eigenLook, setEigenLook] = useState(() => eigenerLook(boardId));
  const lookAn = !board?.look?.aus;
  const geteiltWird = !!link && link !== 'fehlt' || !!liste?.length;
  useEffect(() => {
    // Beim Erstellen/Öffnen einer Freigabe: den aktuellen Look mitgeben (oder auffrischen), außer er ist abgeschaltet
    if (gast || !eigenesKonto || !board || board.look?.aus || !geteiltWird) return;
    const neu = lookAusUi(ui);
    const l = board.look;
    if (!l || l.theme !== neu.theme || l.design !== neu.design || l.accent !== neu.accent) setBoardLook(boardId, neu);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geteiltWird, boardId]);

  const laden = async () => {
    try { setListe(await freigabenDesBoards(boardId)); setFehler(''); } catch (e) { setFehler((e as Error).message); setListe([]); }
  };
  useEffect(() => {
    if (!gast && eigenesKonto) {
      void laden();
      void sicherungVon(boardId).then((z) => setSicherung(z));
      einladungDesBoards(boardId).then((e) => { setLink(e); if (e) { setLinkRolle(e.rolle === 'lesen' ? 'lesen' : 'bearbeiten'); setOhneKonto(!!e.ohne_konto); setRecht(rechtAus(e.optionen)); } })
        .catch((e) => setLink(e instanceof EinladungNichtEingerichtet ? 'fehlt' : null));
    }
    // M530: Esc gehört dem obersten Fenster (lib/overlay.ts)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !fensterDarueber(huelle.current, e)) onClose(); };
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
      showToast(`„${board.name}" ist für ${mail.trim()} ${rolle === 'lesen' ? 'zum Lesen ' : ''}freigegeben – sobald sich die Person mit dieser E-Mail anmeldet, sieht sie das Board.`, false, 8000);
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
      const e = await einladungSetzen(boardId, r, neu ? ohneKonto : undefined, neu ? recht : undefined);
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
      showToast(an ? 'Wer den Link öffnet, ist jetzt sofort dabei – auch ohne Konto.' : 'Der Link verlangt jetzt wieder ein PixiNotes-Konto. Gäste ohne Konto sind draußen.', false, 7000);
    } catch (e) { setFehler((e as Error).message); } finally { setBusy(false); }
  };
  // M365: Rechte der Gäste umstellen — wirkt sofort bei allen, die über den Link dabei sind
  const rechtSetzen = async (r: GastRecht) => {
    if (!link || link === 'fehlt') { setRecht(r); return; }
    if (busy || r === recht) return;
    setBusy(true); setFehler('');
    try {
      const e = await einladungSetzen(boardId, linkRolle, undefined, r);
      setLink(e); setRecht(rechtAus(e.optionen));
      showToast(r === 'alles' ? 'Gäste dürfen jetzt alles bearbeiten und löschen.' : r === 'eigenes-loeschen' ? 'Gäste dürfen jetzt alles bearbeiten, aber nur Eigenes löschen.' : 'Gäste dürfen jetzt nur noch ihre eigenen Karten ändern und löschen.', false, 6000);
    } catch (e) { setFehler((e as Error).message); } finally { setBusy(false); }
  };
  const zurueckZurSicherung = async () => {
    if (!window.confirm('Den Stand von vor der Gruppenarbeit wiederherstellen? Alles, was seitdem dazukam oder geändert wurde, fällt weg – für alle. Mit Strg+Z holst du es zurück.')) return;
    if (await sicherungZurueck(boardId)) { showToast('Stand von vor der Gruppenarbeit wiederhergestellt – Strg+Z nimmt das zurück.', false, 8000); onClose(); }
    else setFehler('Die Sicherung ließ sich nicht laden.');
  };
  const rechtWahl = (
    <label className="freigabe-schalter recht">
      <span>Gäste dürfen</span>
      <select className="freigabe-rolle" value={recht} disabled={busy || linkRolle === 'lesen'} aria-label="Was Gäste dürfen" data-taste="einladung-recht"
        onChange={(e) => void rechtSetzen(e.target.value as GastRecht)}>
        <option value="alles">alles bearbeiten und löschen</option>
        <option value="eigenes-loeschen">alles bearbeiten, nur Eigenes löschen</option>
        <option value="eigenes">nur eigene Karten ändern und löschen</option>
      </select>
    </label>
  );
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
    if (perLink) { gastVerlassen(boardId); showToast('Verlassen – das Board ist jetzt eine eigene Kopie.'); onClose(); return; }
    setBusy(true); setFehler('');
    try { await freigabeVerlassen(boardId); showToast('Freigabe verlassen – das Board ist jetzt eine eigene Kopie.'); onClose(); } catch (e) { setFehler((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" ref={huelle} onClick={onClose}>
      <div className="modal freigabe-dialog" role="dialog" aria-modal="true" aria-label="Board freigeben" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{gast ? 'Geteiltes Board' : 'Gemeinsam bearbeiten'}</h2>
          <button className="modal-x" onClick={onClose} aria-label="Schließen"><IX size={16} /></button>
        </div>
        <div className="modal-body">
          <section className="modal-section">
            {gast ? (
              <>
                {perLink ? (
                  <p className="modal-hint" data-taste="freigabe-per-link">Du bist per <b>Einladungslink</b> in „<span translate="no">{board.name}</span>" – ohne Konto. {nurLesen
                    ? <>Du liest live mit, kannst aber nichts ändern.</>
                    : <>Alle arbeiten live im selben Board. Eine Karte gehört dem, der sie gerade bearbeitet – die anderen lesen mit und kommen dran, sobald sie frei ist.</>} {gruppeVon(boardId)?.recht === 'eigenes' ? 'Der Besitzer hat festgelegt: Ändern und löschen kannst du nur deine eigenen Karten – neue anlegen geht immer. '
                    : gruppeVon(boardId)?.recht === 'eigenes-loeschen' ? 'Der Besitzer hat festgelegt: Löschen kannst du nur, was du selbst angelegt hast. ' : ''}Strg+Z nimmt nur deine eigenen Schritte zurück. Deinen Namen änderst du oben rechts am ersten Kürzel.</p>
                ) : nurLesen ? (
                  <p className="modal-hint" data-taste="freigabe-nur-lesen">„<span translate="no">{board.name}</span>" gehört <b translate={board.geteiltVonName ? 'no' : undefined}>{board.geteiltVonName ?? 'einem anderen Konto'}</b> und ist für dich <b>zum Lesen</b> freigegeben. Du siehst Änderungen live, kannst aber selbst nichts ändern. Für eigene Notizen: Board-Menü → <b>Duplizieren</b> – die Kopie gehört dir.</p>
                ) : (
                  <p className="modal-hint">„<span translate="no">{board.name}</span>" gehört <b translate={board.geteiltVonName ? 'no' : undefined}>{board.geteiltVonName ?? 'einem anderen Konto'}</b> und ist für dich freigegeben. Ihr arbeitet live auf demselben Stand; gleichzeitige Änderungen werden zusammengeführt.</p>
                )}
                {lookAktiv(board.look) && (
                  <div className="freigabe-zeile look" data-taste="look-gast">
                    <span>{eigenLook ? 'Du siehst das Board in deinem eigenen Look.' : <>Das Board zeigt den Look des Teilenden: <span className="look-wort">{lookWort(board.look)}</span>.</>}</span>
                    <button onClick={() => { eigenerLookSetzen(boardId, !eigenLook); setEigenLook(!eigenLook); }} data-taste="look-eigen">{eigenLook ? 'Look des Boards verwenden' : 'Eigenen Look verwenden'}</button>
                  </div>
                )}
                <div className="modal-buttons">
                  <button disabled={busy} onClick={verlassen} data-taste="freigabe-verlassen">{busy ? '…' : perLink ? 'Board verlassen' : 'Freigabe verlassen'}</button>
                </div>
              </>
            ) : !eigenesKonto ? (
              <>
                {/* M391: Ohne Konto war der Menüpunkt unsichtbar — jetzt sagt der Dialog, was fehlt, und führt hin */}
                <p className="modal-hint" data-taste="freigabe-ohne-konto">
                  <b translate="no">{board.name}</b>: Andere öffnen einen Link und arbeiten live mit – ohne Konto. Nur du brauchst ein kostenloses PixiNotes-Konto, damit das Board einen gemeinsamen Ort hat.
                  {andererWeg && <> Dein Abgleich über Google oder Microsoft bleibt davon unberührt, kann aber nicht live teilen.</>}
                </p>
                <div className="modal-buttons">
                  <button className="primaer" data-taste="freigabe-anmelden" onClick={() => { onClose(); useBoard.getState().setSettingsOpen(true, 'konto'); }}>Anmelden oder Konto anlegen</button>
                </div>
              </>
            ) : (
              <>
                {link !== 'fehlt' && (
                  <div data-taste="einladung">
                    {link === undefined ? (
                      <div className="modal-note">Lade …</div>
                    ) : link ? (
                      <>
                        <div className="link-zeile">
                          <input readOnly value={einladungUrl(link.token)} onFocus={(e) => e.currentTarget.select()} aria-label="Einladungslink" data-taste="einladung-adresse" />
                          <button className="primaer" onClick={() => void kopieren(einladungUrl(link.token))} data-taste="einladung-kopieren">Kopieren</button>
                          {/* M385: groß zum Scannen — für alle im Raum */}
                          <button data-taste="einladung-qr" title="Den Link als QR-Code einblenden – zum Scannen vom Beamer oder Bildschirm"
                            onClick={() => { window.dispatchEvent(new CustomEvent(QR_EREIGNIS, { detail: { boardId, url: einladungUrl(link.token), ohneKonto } })); onClose(); }}>QR-Code</button>
                          {typeof navigator.share === 'function' && <button onClick={() => void linkSenden(einladungUrl(link.token))}>Senden …</button>}
                        </div>
                        {/* Ein Satz sagt, was der Link gerade kann — die Schalter dazu stehen unter „Optionen" */}
                        <p className="modal-hint freigabe-satz" data-taste="einladung-satz">
                          Wer den Link öffnet, <b>{ohneKonto ? 'ist sofort dabei – ohne Konto' : 'meldet sich mit seinem PixiNotes-Konto an'}</b> {linkRolle === 'lesen' ? 'und liest mit.'
                            : recht === 'eigenes' ? 'und arbeitet live mit (ändert nur eigene Karten).'
                            : recht === 'eigenes-loeschen' ? 'und arbeitet live mit (löscht nur Eigenes).' : 'und arbeitet live mit.'}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="modal-hint freigabe-satz">
                          <b translate="no">{board.name}</b>: Link öffnen, Namen sagen, mitmachen – alle sehen Änderungen live.
                        </p>
                        <div className="modal-buttons">
                          <button className="primaer" disabled={busy} onClick={() => void linkAnlegen(linkRolle, true)} data-taste="einladung-anlegen">{busy ? '…' : 'Einladungslink erstellen'}</button>
                        </div>
                      </>
                    )}
                    {link !== undefined && (
                      <details className="freigabe-mehr" data-taste="einladung-optionen">
                        <summary>Optionen</summary>
                        <div className="freigabe-zeile">
                          <span>Wer dem Link folgt,</span>
                          <RollenWahl wert={linkRolle} disabled={busy} label="Rolle des Einladungslinks" taste="einladung-rolle" onChange={link ? (r) => void linkAnlegen(r, false) : setLinkRolle} />
                        </div>
                        {rechtWahl}
                        <label className="freigabe-schalter">
                          <input type="checkbox" checked={ohneKonto} disabled={busy} onChange={(e) => void ohneKontoSetzen(e.target.checked)} data-taste="einladung-ohne-konto" />
                          <span><b>Mitmachen ohne Konto</b> – ausgeschaltet braucht jeder Gast ein PixiNotes-Konto</span>
                        </label>
                        {link && sicherung && (
                          <div className="freigabe-zeile sicherung" data-taste="sicherung">
                            <span>Stand von vor der Gruppenarbeit ({new Date(sicherung).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })})</span>
                            <button disabled={busy} onClick={() => void zurueckZurSicherung()} data-taste="sicherung-zurueck">Wiederherstellen</button>
                          </div>
                        )}
                        {link && (
                          <div className="freigabe-zeile sicherung">
                            <span>Zugang für alle beenden, die den Link haben</span>
                            <button className="link-weg" disabled={busy} onClick={() => void linkWeg()} data-taste="einladung-weg">Link widerrufen</button>
                          </div>
                        )}
                      </details>
                    )}
                  </div>
                )}
                {/* M509: erst sichtbar, wenn geteilt wird — vorher bleibt der Dialog bei einem Knopf (M391) */}
                {geteiltWird && <label className="freigabe-schalter look" data-taste="look-mitgeben">
                  <input type="checkbox" checked={lookAn} onChange={(e) => setBoardLook(boardId, e.target.checked ? lookAusUi(ui) : { aus: true })} data-taste="look-mitgeben-schalter" />
                  <span><b>Look mitgeben</b> – Gäste sehen das Board in <span className="look-wort" data-taste="look-wort">{lookWort(lookAn && board.look && lookAktiv(board.look) ? board.look : lookAusUi(ui))}</span>{lookAn ? '' : ' nur, wenn du es einschaltest'}</span>
                </label>}
                <details className="freigabe-mehr" data-taste="freigabe-person" open={link === 'fehlt' || !!liste?.length || undefined}>
                  <summary>{liste?.length ? `Einzelne Personen (${liste.length})` : 'Einzelne Person per E-Mail einladen'}</summary>
                  <div className="freigabe-zeile">
                    <input type="email" autoComplete="off" placeholder="kollegin@example.de" value={mail} onChange={(e) => setMail(e.target.value)} aria-label="E-Mail"
                      onKeyDown={(e) => { if (e.key === 'Enter') void einladen(); }} data-taste="freigabe-email" />
                    <RollenWahl wert={rolle} disabled={busy} label="Rolle der eingeladenen Person" taste="freigabe-rolle" onChange={setRolle} />
                    <button disabled={!mailOk || busy} onClick={einladen} data-taste="freigabe-einladen">{busy ? '…' : 'Freigeben'}</button>
                  </div>
                  {liste === null ? (
                    <div className="modal-note">Lade Freigaben …</div>
                  ) : liste.length > 0 && (
                    <ul className="freigabe-liste" data-taste="freigabe-liste">
                      {liste.map((f) => (
                        <li key={f.id}>
                          <span className="freigabe-mail" translate="no">{f.gast_email}</span>
                          <span className={`freigabe-stand ${f.gast_id ? 'an' : ''}`}>{f.gast_id ? 'angenommen' : 'wartet auf Anmeldung'}</span>
                          <RollenWahl wert={f.rolle === 'lesen' ? 'lesen' : 'bearbeiten'} disabled={busy} label={`Rolle von ${f.gast_email}`} onChange={(r) => void rolleAendern(f, r)} />
                          <button className="freigabe-weg" disabled={busy} onClick={() => void entfernen(f)} title="Freigabe entfernen" aria-label={`Freigabe für ${f.gast_email} entfernen`}><IX size={13} /></button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="modal-note">
                    Die Person braucht ein PixiNotes-Konto mit genau dieser E-Mail; das Board liegt bei ihr dann unter <b>Geteilt mit mir</b>.
                    Anhänge (PDF, Bilder) sehen bisher nur Gäste per Link.
                  </div>
                </details>
              </>
            )}
            {fehler && <div className="modal-error" role="alert">{fehler}</div>}
          </section>
        </div>
      </div>
    </div>
  );
}
