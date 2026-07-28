// M159: EINE Import-Pipeline für lokale Dateien — gefüttert vom Drag & Drop
// aufs Board UND vom „Datei einfügen"-Dialog im ＋-Menü (am Smartphone gibt es
// kein Drag & Drop). Die Weiche kennt alle integrierbaren Typen: Kalender
// (.ics), Board-/Voll-Exporte (.json), E-Mails (.eml/.msg), eigene Apps
// (.html), Bilder — und alles andere als Datei-Karte (PDF mit Vorschau).
// Jede LOKALE Datei wird zusätzlich in den Team-Ordner gespiegelt, wenn das
// aktive Board zu einem verbundenen Team-Projekt gehört (attachments.ts).
import { mutedHistory, useBoard, selectActiveBoard } from '../store';
import { guessMime, MAX_EMBED_BYTES, parseEml, parseMsg } from './parseEmail';
import { imageFileToDataUrl, readFileAsDataUrl } from './image';
import { canEmbed, makeCalendar, makeEmail, makeFile, makeHtmlApp, makeImage, makeNote } from './nodes';
// M184: statisch importiert (kein dynamic import) — vite-plugin-singlefile
// backt alles in EINE Datei; ein nachgeladener Zusatz-Brocken wäre dort nach
// dem Deploy nicht auffindbar (dieselbe Falle wie beim Mermaid-Modul, M90).
import { docxToBlocks } from './docx';
import { cloneSharedBoard, parseBoardPayload } from './share';
import { mergeEvents, parseIcs, type IcsEvent } from './ics';
import { saveHtml } from './htmlStore';
import { mirrorAttachment } from './attachments';
import type { AppNode } from '../types';

/** Kopie in den Team-Ordner legen und den Pfad an der Karte vermerken —
 *  bewusst fire-and-forget: der Import wartet nicht auf den Cloud-Ordner */
function mirror(file: File, nodeId: string | null, note: { done: boolean }): void {
  void mirrorAttachment(file)
    .then((ref) => {
      if (!ref) return;
      // ohne Undo-Schritt: der Pfad-Vermerk ist Buchhaltung, keine Bearbeitung
      if (nodeId) mutedHistory(() => useBoard.getState().updateNodeData(nodeId, { ref }));
      if (!note.done) {
        note.done = true;
        useBoard.getState().showToast(`Kopie im Team-Ordner abgelegt (${ref.split('/').slice(0, -1).join('/')}/)`);
      }
    })
    .catch(() => {});
}

/**
 * M164: HTML-App von einer URL holen. Zwei Wege, automatisch gewählt:
 * - KOPIE: Die Quelle erlaubt browserübergreifendes Lesen (CORS — z. B.
 *   GitHub Raw, Gists, CDNs) → die App wird eine ganz normale lokale
 *   App-Karte (offline, Team-Spiegel, Speicherstand); die URL bleibt als
 *   Quelle vermerkt („Von der Quelle neu laden").
 * - LIVE: Die Quelle verweigert das Lesen → die Karte bettet die URL direkt
 *   ein (iframe). Immer aktuell, braucht aber Internet; die Seite läuft
 *   unter IHRER Herkunft — die Browser-Same-Origin-Policy hält sie von
 *   PixiNotes fern. Adressen mit PixiNotes' EIGENER Herkunft werden
 *   abgelehnt (sie bekämen sonst im Live-Modus unseren Speicher zu sehen).
 */
export async function importHtmlAppFromUrl(rawUrl: string, pos: { x: number; y: number }): Promise<'kopie' | 'live' | null> {
  const { addNode, showToast } = useBoard.getState();
  let u: URL;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    showToast('Das ist keine gültige Adresse (URL).');
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    showToast('Nur http(s)-Adressen sind möglich.');
    return null;
  }
  const last = decodeURIComponent(u.pathname.split('/').pop() ?? '');
  const name = /\.html?$/i.test(last) ? last : (last || u.hostname);
  try {
    const res = await fetch(u.href, { mode: 'cors' });
    if (!res.ok) throw new Error(String(res.status));
    const text = await res.text();
    if (!/<[a-z!]/i.test(text)) throw new Error('kein HTML');
    const node = makeHtmlApp(pos, { name, size: text.length });
    (node.data as { url?: string }).url = u.href;
    await saveHtml(node.id, text);
    addNode(node);
    showToast(`„${name}" von der Adresse kopiert — mit ▶ starten (läuft auch offline).`);
    mirror(new File([text], name, { type: 'text/html' }), node.id, { done: false });
    return 'kopie';
  } catch {
    // M165: GLEICHE Herkunft wie PixiNotes (z. B. eigene GitHub-Pages-Seite
    // neben der PixiNotes-Instanz) darf zwar KOPIERT werden (oben — dort
    // greift die strikte Sandbox), aber nie LIVE eingebettet: mit
    // allow-same-origin sähe sie unseren Speicher. Scheitert hier also
    // ausgerechnet der Kopier-Weg, gibt es keinen sicheren Live-Ausweg.
    if (u.origin === window.location.origin) {
      showToast('Diese Adresse liegt unter derselben Herkunft wie PixiNotes und war nicht kopierbar — Live-Einbettung ist dafür aus Sicherheitsgründen nicht möglich.');
      return null;
    }
    const node = makeHtmlApp(pos, { name, size: 0 });
    Object.assign(node.data, { url: u.href, live: true });
    addNode(node);
    showToast('Die Quelle erlaubt kein Kopieren (CORS) — die App wird LIVE eingebettet und braucht dafür Internet.');
    return 'live';
  }
}

/** Dateien importieren; gibt die Zahl der angelegten/verarbeiteten Karten zurück */
export async function importFilesToBoard(files: File[], basePos: { x: number; y: number }): Promise<number> {
  const { addNode, showToast } = useBoard.getState();
  const mirrorNote = { done: false };
  let offset = 0;
  let placed = 0;

  for (const file of files) {
    const pos = { x: basePos.x + offset, y: basePos.y + offset };
    offset += 36;
    const ext = file.name.split('.').pop()?.toLowerCase();

    try {
      if (ext === 'ics') {
        // Outlook/Google/Apple-Kalender: Termine in die Kalender-Karte mergen
        const events = parseIcs(await file.text());
        if (events.length === 0) { showToast('Keine Termine in der .ics-Datei gefunden.'); continue; }
        const st = useBoard.getState();
        let cal: AppNode | undefined = selectActiveBoard(st).nodes.find((n) => n.type === 'calendar');
        if (!cal) { cal = makeCalendar(pos); st.addNode(cal); }
        const cur = (cal.data.icsEvents as IcsEvent[] | undefined) ?? [];
        st.updateNodeData(cal.id, { icsEvents: mergeEvents(cur, events) });
        showToast(`${events.length} Termin(e) in die Kalender-Karte importiert`);
        placed++;
        continue;
      }
      if (ext === 'json') {
        // Geteiltes Board (.pixiboard.json) oder Voll-Export importieren
        const text = await file.text();
        const shared = parseBoardPayload(text);
        if (shared) {
          useBoard.getState().importBoard(cloneSharedBoard(shared));
          showToast(`Geteiltes Board „${shared.name}" importiert`);
          placed++;
          continue;
        }
        const full = JSON.parse(text);
        if (full?.app === 'pixinotes' && Array.isArray(full.boards) && full.boards.length > 0) {
          if (window.confirm(`Kompletten Stand vom ${full.savedAt ? new Date(full.savedAt).toLocaleString('de-DE') : '?'} laden? Die aktuellen Boards werden ersetzt.`)) {
            useBoard.getState().importSync(full.boards, full.spaces ?? [], full.activeId ?? full.boards[0].id);
            showToast('Stand aus Datei geladen');
          }
          placed++;
          continue;
        }
        showToast('JSON erkannt, aber keine PixiNotes-Datei — als Datei-Karte abgelegt.');
      }
      if (ext === 'docx') {
        // M184: Word-Dokument → Notiz-Karte. Das ist zugleich der kontofreie
        // OneNote-Weg: „Datei → Exportieren → Word" und die Datei hier ablegen.
        const res = await docxToBlocks(file);
        if (res.blocks.length === 0) { showToast(`„${file.name}" enthält keinen lesbaren Text.`); continue; }
        const note = makeNote(pos, { blocks: res.blocks });
        note.width = 340;
        addNode(note);
        let imgOffset = 0;
        for (const img of res.images.slice(0, 8)) {
          imgOffset += 1;
          if (!canEmbed(img.src.length)) break;
          addNode(makeImage({ x: pos.x + 380, y: pos.y + (imgOffset - 1) * 220 }, img.src, img.alt ?? file.name));
        }
        showToast(`📄 „${res.title || file.name}" als Notiz übernommen${res.images.length ? ` (+ ${Math.min(res.images.length, 8)} Bild(er))` : ''}.`);
        mirror(file, note.id, mirrorNote);
        placed++;
        continue;
      }
      if (ext === 'html' || ext === 'htm') {
        // Eigene App (M158): Quelltext nach IndexedDB — NICHT ins Board
        // (mehrere MB würden den localStorage-Stand sprengen, s. canEmbed)
        const node = makeHtmlApp(pos, { name: file.name, size: file.size });
        await saveHtml(node.id, await file.text());
        addNode(node);
        showToast(`„${file.name}" als App-Karte abgelegt — mit ▶ starten.`);
        mirror(file, node.id, mirrorNote);
        placed++;
        continue;
      }
      if (ext === 'eml' || file.type === 'message/rfc822') {
        const email = await parseEml(await file.arrayBuffer());
        addNode(makeEmail(pos, email));
        showToast(`📧 „${email.subject}" importiert — ${email.attachments.length} Anhänge als Chips`);
        mirror(file, null, mirrorNote);
      } else if (ext === 'msg') {
        const email = await parseMsg(await file.arrayBuffer());
        addNode(makeEmail(pos, email));
        showToast(`📧 Outlook-Mail „${email.subject}" importiert`);
        mirror(file, null, mirrorNote);
      } else if (file.type.startsWith('image/')) {
        const src = await imageFileToDataUrl(file);
        if (!canEmbed(src.length)) {
          // Zu groß fürs Board: als Datei-Karte MIT Team-Pfad ablegen statt
          // gar nicht (M159) — über den Ordner bleibt das Bild erreichbar
          const node = makeFile(pos, { name: file.name, size: file.size, mime: file.type });
          addNode(node);
          showToast('⚠️ Speicher fast voll — Bild als Datei-Karte abgelegt (nicht eingebettet).');
          mirror(file, node.id, mirrorNote);
        } else {
          const node = makeImage(pos, src, file.name);
          addNode(node);
          mirror(file, node.id, mirrorNote);
        }
      } else {
        let dataUrl = file.size <= MAX_EMBED_BYTES ? await readFileAsDataUrl(file) : undefined;
        if (dataUrl && !canEmbed(dataUrl.length)) {
          dataUrl = undefined;
          showToast('⚠️ Speicher fast voll — Datei nur als Verweis abgelegt. Exportiere in den Datenordner (⚙️).');
        }
        const node = makeFile(pos, { name: file.name, size: file.size, mime: file.type || guessMime(file.name), dataUrl });
        addNode(node);
        mirror(file, node.id, mirrorNote);
      }
      placed++;
    } catch (err) {
      console.error('Import fehlgeschlagen:', err);
      showToast(`⚠️ „${file.name}" konnte nicht gelesen werden`);
    }
  }
  return placed;
}
