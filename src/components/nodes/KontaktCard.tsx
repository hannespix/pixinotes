import { useEffect, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useBoard } from '../../store';
import { kontaktBild, fremdeWebAdresse } from '../../lib/sicher';
import { kontaktDaten, telAdresse, vcardDateiname, vcardSchreiben } from '../../lib/vcard';
import { triggerDownload } from '../../lib/download';
import { warEbenAngelegt } from '../../lib/nodes';
import type { KontaktData, KontaktNode, KontaktTelefon } from '../../types';
import { ICheck, IDownload, IGlobe, IMail, IOrt, IPen, IPerson, IPlus, ITelefon, IX } from '../Icons';
import { CardShell } from './CardShell';

/**
 * M450: Kontakt-Karte — Name, Funktion/Firma, Rufnummern, E-Mail, Anschrift, Notiz, Foto.
 *
 * In Ruhe ist die Karte eine Visitenkarte: Rufnummern als tel:-Links (ein Klick wählt über Softphone, Teams oder
 * Handy), E-Mail als mailto:, die Anschrift mit einem schlichten Link zur Karte von OpenStreetMap — bewusst nur
 * ein Link, nichts eingebettet (eine eingebettete Karte fragte bei jedem Anzeigen einen fremden Server an).
 * Bearbeitet wird in Feldern, die erst mit „Bearbeiten“ erscheinen; eine leere Karte öffnet sie von selbst.
 * Die Bedienung (Bearbeiten, vCard) steht nur im Fokus (M421, Listen in src/styles/99-bedienung-im-fokus.css).
 */

/** Anfangsbuchstaben für den Platz des Fotos */
function initialen(name: string): string {
  const w = name.replace(/,/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '';
  return (w.length === 1 ? w[0].slice(0, 2) : `${w[0][0]}${w[w.length - 1][0]}`).toUpperCase();
}

/** Webadresse auch ohne „https://“ anklickbar (nur http/https — lib/sicher.ts) */
function webAdresse(roh: string): string | null {
  const t = roh.trim();
  if (!t) return null;
  return fremdeWebAdresse(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`);
}

/** Foto klein rechnen: ein Kreis von 48 Punkten braucht keine 12 Megapixel im Board-Stand */
async function fotoVerkleinern(datei: File): Promise<string | null> {
  const url = URL.createObjectURL(datei);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fehl) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fehl; i.src = url; });
    const seite = 192;
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement('canvas');
    c.width = seite; c.height = seite;
    const ctx = c.getContext('2d');
    if (!ctx || !s) return null;
    // quadratischer Ausschnitt aus der Mitte
    ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, seite, seite);
    return kontaktBild(c.toDataURL('image/jpeg', 0.85));
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}

export function KontaktCard({ id, data, selected }: NodeProps<KontaktNode>) {
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const showToast = useBoard((s) => s.showToast);
  const nurLesen = useBoard((s) => s.boards.find((b) => b.id === s.activeId)?.geteiltRolle === 'lesen');
  const k = kontaktDaten(data);
  // M519: „leer" heißt wirklich leer — eine Karte nur mit Anschrift, Funktion, Webseite, Notiz oder Foto stand sonst
  // bei jedem Öffnen des Boards im Bearbeiten-Formular und trug den Hinweis „Noch leer" über ihrem Inhalt
  const leer = !k.name && !k.firma && !k.telefone.length && !k.emails.length
    && !k.funktion?.trim() && !k.adresse?.trim() && !k.web?.trim() && !k.notiz?.trim() && !k.foto;
  const [bearbeiten, setBearbeiten] = useState(leer && !nurLesen);
  const nameRef = useRef<HTMLInputElement>(null);
  const fotoRef = useRef<HTMLInputElement>(null);
  const patch = (p: Partial<KontaktData>) => updateNodeData(id, p);

  // Eben aus der Palette gelegt: gleich den Namen tippen (nie beim bloßen Öffnen eines Boards, M388)
  useEffect(() => {
    if (!bearbeiten || !warEbenAngelegt(id)) return;
    // React Flow zeigt die Karte erst, wenn sie vermessen ist — bis dahin nimmt das Feld keinen Fokus an
    let n = 0;
    const t = setInterval(() => {
      const f = nameRef.current;
      if (f && document.activeElement !== f) f.focus({ preventScroll: true });
      if ((f && document.activeElement === f) || ++n > 12) clearInterval(t);
    }, 60);
    return () => clearInterval(t);
  }, []);

  const exportieren = () => {
    const url = URL.createObjectURL(new Blob([vcardSchreiben(k)], { type: 'text/vcard;charset=utf-8' }));
    triggerDownload(url, vcardDateiname(k));
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const fertig = () => {
    // leere Zeilen räumen, sobald die Bearbeitung endet (nur wenn es welche gibt — sonst kein Schritt im Verlauf)
    const telefone = k.telefone.filter((t) => t.nummer.trim());
    const emails = k.emails.filter((m) => m.trim());
    if (telefone.length !== k.telefone.length || emails.length !== k.emails.length) patch({ telefone, emails });
    setBearbeiten(false);
  };
  // M531: Klick daneben oder Fokus woandershin beendet das Bearbeiten wie „Fertig" — die Eingaben sind ohnehin schon
  // gespeichert (jedes Feld schreibt sofort). Vorher blieb die Karte im Formular, bis jemand „Fertig" fand.
  const kopfRef = useRef<HTMLDivElement>(null);
  const fertigRef = useRef(fertig);
  fertigRef.current = fertig;
  useEffect(() => {
    if (!bearbeiten) return;
    const wurzel = () => kopfRef.current?.closest('.react-flow__node, .card-shell') ?? null;
    const daneben = (ziel: EventTarget | null) => ziel instanceof Node && ziel.isConnected && !wurzel()?.contains(ziel);
    const druck = (e: PointerEvent) => { if (daneben(e.target)) fertigRef.current(); };
    const fokus = (e: FocusEvent) => { if (e.relatedTarget && daneben(e.relatedTarget)) fertigRef.current(); };
    document.addEventListener('pointerdown', druck, true);
    const w = wurzel();
    w?.addEventListener('focusout', fokus as EventListener);
    return () => { document.removeEventListener('pointerdown', druck, true); w?.removeEventListener('focusout', fokus as EventListener); };
  }, [bearbeiten]);

  const setTelefon = (i: number, t: Partial<KontaktTelefon>) => patch({ telefone: k.telefone.map((x, j) => (j === i ? { ...x, ...t } : x)) });
  const setEmail = (i: number, m: string) => patch({ emails: k.emails.map((x, j) => (j === i ? m : x)) });

  const fotoWaehlen = async (datei: File | undefined) => {
    if (!datei) return;
    const bild = await fotoVerkleinern(datei);
    if (bild) patch({ foto: bild });
    else showToast('Dieses Bild lässt sich nicht als Foto verwenden.');
  };

  const unter = [k.funktion, k.firma].filter((x) => x?.trim()).join(' · ');
  const karte = k.adresse?.trim() ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(k.adresse.replace(/\s*\n\s*/g, ', '))}` : null;
  const web = webAdresse(k.web ?? '');

  return (
    <CardShell id={id} selected={selected} minWidth={220} minHeight={110} className="kontakt-card">
      <div className="kontakt-kopf" ref={kopfRef}>
        <div className="kontakt-foto" aria-hidden="true">
          {k.foto ? <img src={k.foto} alt="" draggable={false} /> : (initialen(k.name) || <IPerson size={20} />)}
        </div>
        <div className="kontakt-titel">
          <div className="kontakt-name" translate="no">{k.name || (bearbeiten ? 'Neuer Kontakt' : k.firma || 'Kontakt')}</div>
          {unter && !bearbeiten && <div className="kontakt-unter" translate="no">{unter}</div>}
        </div>
        {!nurLesen && (
          <div className="kontakt-tools">
            {bearbeiten ? (
              <button className="kontakt-knopf nodrag" onClick={fertig} title="Bearbeitung beenden" aria-label="Fertig"><ICheck size={15} /></button>
            ) : (
              <button className="kontakt-knopf nodrag" onClick={() => setBearbeiten(true)} title="Kontakt bearbeiten" aria-label="Bearbeiten"><IPen size={14} /></button>
            )}
            <button className="kontakt-knopf nodrag" onClick={exportieren} title="Als vCard (.vcf) herunterladen – für Outlook, Telefon, Adressbuch" aria-label="Als vCard herunterladen"><IDownload size={15} /></button>
          </div>
        )}
      </div>

      {bearbeiten ? (
        <div className="kontakt-form nodrag nowheel">
          <input ref={nameRef} className="kontakt-feld" value={k.name} placeholder="Name" aria-label="Name" onChange={(e) => patch({ name: e.target.value })} />
          <input className="kontakt-feld" value={k.funktion} placeholder="Funktion" aria-label="Funktion" onChange={(e) => patch({ funktion: e.target.value })} />
          <input className="kontakt-feld" value={k.firma} placeholder="Firma oder Behörde" aria-label="Firma" onChange={(e) => patch({ firma: e.target.value })} />
          <div className="kontakt-gruppe">
            {k.telefone.map((t, i) => (
              <div className="kontakt-zeile-feld" key={`t${i}`}>
                <input className="kontakt-feld kontakt-art" value={t.art ?? ''} placeholder="Art" aria-label="Art der Rufnummer" list="kontakt-arten" onChange={(e) => setTelefon(i, { art: e.target.value || undefined })} />
                <input className="kontakt-feld" type="tel" inputMode="tel" value={t.nummer} placeholder="Rufnummer" aria-label="Rufnummer" onChange={(e) => setTelefon(i, { nummer: e.target.value })} />
                <button className="kontakt-weg" onClick={() => patch({ telefone: k.telefone.filter((_, j) => j !== i) })} title="Rufnummer entfernen" aria-label="Rufnummer entfernen"><IX size={13} /></button>
              </div>
            ))}
            <button className="kontakt-dazu" onClick={() => patch({ telefone: [...k.telefone, { nummer: '' }] })}><IPlus size={13} /> Rufnummer</button>
          </div>
          <div className="kontakt-gruppe">
            {k.emails.map((m, i) => (
              <div className="kontakt-zeile-feld" key={`m${i}`}>
                <input className="kontakt-feld" type="email" inputMode="email" value={m} placeholder="E-Mail" aria-label="E-Mail" onChange={(e) => setEmail(i, e.target.value)} />
                <button className="kontakt-weg" onClick={() => patch({ emails: k.emails.filter((_, j) => j !== i) })} title="E-Mail entfernen" aria-label="E-Mail entfernen"><IX size={13} /></button>
              </div>
            ))}
            <button className="kontakt-dazu" onClick={() => patch({ emails: [...k.emails, ''] })}><IPlus size={13} /> E-Mail</button>
          </div>
          <textarea className="kontakt-feld" rows={3} value={k.adresse} placeholder="Anschrift" aria-label="Anschrift" onChange={(e) => patch({ adresse: e.target.value })} />
          <input className="kontakt-feld" inputMode="url" data-rechtschreibung="aus" value={k.web} placeholder="Webseite" aria-label="Webseite" onChange={(e) => patch({ web: e.target.value })} />
          <textarea className="kontakt-feld" rows={2} value={k.notiz} placeholder="Notiz" aria-label="Notiz" onChange={(e) => patch({ notiz: e.target.value })} />
          <div className="kontakt-foto-zeile">
            <button className="kontakt-dazu" onClick={() => fotoRef.current?.click()}>{k.foto ? 'Foto ändern' : 'Foto wählen'}</button>
            {k.foto && <button className="kontakt-dazu" onClick={() => patch({ foto: undefined })}>Foto entfernen</button>}
            <input ref={fotoRef} type="file" accept="image/*" hidden onChange={(e) => { void fotoWaehlen(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          <datalist id="kontakt-arten">
            <option value="Mobil" /><option value="Dienstlich" /><option value="Privat" /><option value="Fax" />
          </datalist>
        </div>
      ) : (
        <div className="kontakt-inhalt">
          {k.telefone.filter((t) => t.nummer.trim()).map((t, i) => {
            const href = telAdresse(t.nummer);
            return (
              <div className="kontakt-zeile" key={`t${i}`}>
                <ITelefon size={14} />
                {href ? <a className="kontakt-link nodrag" href={href} translate="no">{t.nummer}</a> : <span translate="no">{t.nummer}</span>}
                {t.art && <span className="kontakt-art-text">{t.art}</span>}
              </div>
            );
          })}
          {k.emails.filter((m) => m.trim()).map((m, i) => (
            <div className="kontakt-zeile" key={`m${i}`}>
              <IMail size={14} />
              {/* M519: die Adresse ganz kodieren (nur „@" bleibt) — sonst hängte eine Adresse aus einer fremden vCard
                  wie „a@b.de?bcc=…&body=…" dem Mail-Programm stille Empfänger und Text an (wie SEC-2 bei der Mail-Karte) */}
              <a className="kontakt-link nodrag" href={`mailto:${encodeURIComponent(m.trim()).replace(/%40/g, '@')}`} translate="no">{m.trim()}</a>
            </div>
          ))}
          {k.adresse?.trim() && (
            <div className="kontakt-zeile">
              <IOrt size={14} />
              <span className="kontakt-adresse" translate="no">
                {k.adresse.trim()}
                {karte && <> <a className="kontakt-link kontakt-karte nodrag" href={karte} target="_blank" rel="noopener noreferrer">Karte</a></>}
              </span>
            </div>
          )}
          {web && (
            <div className="kontakt-zeile">
              <IGlobe size={14} />
              <a className="kontakt-link nodrag" href={web} target="_blank" rel="noopener noreferrer" translate="no">{(k.web ?? '').trim().replace(/^https?:\/\//i, '')}</a>
            </div>
          )}
          {k.notiz?.trim() && <p className="kontakt-notiz">{k.notiz.trim()}</p>}
          {leer && <p className="kontakt-leer">Noch leer – mit dem Stift ausfüllen oder eine .vcf-Datei aufs Board ziehen.</p>}
        </div>
      )}
    </CardShell>
  );
}
