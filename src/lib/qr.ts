// M385: QR-Code zum Mitmachen — der Einladungslink eines Boards als Code, den das Publikum vom Beamer scannt.
//
// Der Code entsteht hier im Browser (kleine Bibliothek, erst beim Aufruf geladen). Der Link geht dafür an
// keinen fremden Dienst: Er IST der Zugang zum Board.
import { useBoard } from '../store';
import { einladungVon } from './gastSync';
import { einladungUrl } from './einladung';

export const QR_EREIGNIS = 'pixinotes:qr';
export interface QrWunsch { boardId: string; url: string; ohneKonto: boolean }

/** Der Einladungslink dieses Boards als Wunsch für die Einblendung — `null`: Das Board hat (noch) keinen Link */
export function qrWunschFuer(boardId: string): QrWunsch | null {
  const e = einladungVon(boardId);
  return e ? { boardId, url: einladungUrl(e.token), ohneKonto: e.ohneKonto } : null;
}
/** Die Einblendung öffnen. Liefert false, wenn das Board keinen Einladungslink hat. */
export function qrZeigen(boardId: string = useBoard.getState().activeId): boolean {
  const w = qrWunschFuer(boardId);
  if (!w) return false;
  window.dispatchEvent(new CustomEvent<QrWunsch>(QR_EREIGNIS, { detail: w }));
  return true;
}

export interface QrBild { n: number; pfad: string }
/**
 * Den Code rechnen: `n` = Kantenlänge in Feldern samt Ruhezone (vier Felder ringsum, wie die Norm sie verlangt),
 * `pfad` = alle dunklen Felder als ein SVG-Pfad. Fehlerkorrektur M: verträgt Reflexe auf der Leinwand.
 */
export async function qrBild(text: string): Promise<QrBild> {
  const { default: qrcode } = await import('qrcode-generator');
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const m = qr.getModuleCount();
  const RAND = 4;
  let pfad = '';
  for (let y = 0; y < m; y += 1) {
    // zusammenhängende dunkle Felder einer Zeile als ein Rechteck — der Pfad bleibt kurz
    for (let x = 0; x < m; x += 1) {
      if (!qr.isDark(y, x)) continue;
      let w = 1;
      while (x + w < m && qr.isDark(y, x + w)) w += 1;
      pfad += `M${x + RAND} ${y + RAND}h${w}v1h-${w}z`;
      x += w - 1;
    }
  }
  return { n: m + 2 * RAND, pfad };
}
