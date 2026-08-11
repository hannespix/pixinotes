/**
 * K2-Schutz: Bilder vor dem Einbetten verkleinern. Große Fotos (Handy!)
 * würden als Base64 den localStorage sprengen und jede Interaktion bremsen.
 */
const MAX_RAW_BYTES = 400_000;   // darunter: Bytes unkritisch
const MAX_DIMENSION = 1600;      // längste Kante nach Skalierung
const HARD_DIMENSION = 2400;     // darüber wird immer skaliert (auch bei kleinen Dateien)

/**
 * Formate, die zwar Bilder sind, aber nicht überall angezeigt werden können.
 *
 * M254: Ein iPhone speichert Fotos als HEIC. Safari zeigt das anmutig an,
 * Chrome und Firefox nicht. Würden wir ein HEIC unverändert einbetten, sähe
 * die Karte auf dem iPad gut aus und am PC kaputt — und synchronisiert wird ja
 * beides. Solche Formate werden deshalb IMMER über die Zeichenfläche nach JPEG
 * umgewandelt, auch wenn die Datei klein ist.
 */
const NICHT_UEBERALL = /^image\/(heic|heif|avif|tiff?|bmp|x-icon)$/i;

/**
 * Bild einlesen und einbettbar machen — oder `null`, wenn dieser Browser das
 * Format gar nicht dekodieren kann. `null` heißt für den Aufrufer: als
 * Datei-Karte ablegen und ehrlich sagen, warum.
 */
export async function imageFileToDataUrl(file: File, mime = file.type): Promise<string | null> {
  const raw = await readFileAsDataUrl(file);
  const img = await loadImage(raw).catch(() => null);
  if (!img) return null;
  const maxSide = Math.max(img.width, img.height);
  const umwandeln = NICHT_UEBERALL.test(mime || '');
  if (!umwandeln && file.size <= MAX_RAW_BYTES && maxSide <= HARD_DIMENSION) return raw;

  const scale = Math.min(1, MAX_DIMENSION / maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return umwandeln ? null : raw;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const jpeg = canvas.toDataURL('image/jpeg', 0.85);
  // Bei HEIC & Co. führt kein Weg am JPEG vorbei — sonst zeigt es nur Safari.
  if (umwandeln) return jpeg;
  // Sonst JPEG nur nehmen, wenn es wirklich kleiner ist (z. B. nicht bei
  // Grafiken mit Transparenz)
  return jpeg.length < raw.length ? jpeg : raw;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
