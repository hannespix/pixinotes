/**
 * K2-Schutz: Bilder vor dem Einbetten verkleinern. Große Fotos (Handy!)
 * würden als Base64 den localStorage sprengen und jede Interaktion bremsen.
 */
const MAX_RAW_BYTES = 400_000;   // darunter: Bytes unkritisch
const MAX_DIMENSION = 1600;      // längste Kante nach Skalierung
const HARD_DIMENSION = 2400;     // darüber wird immer skaliert (auch bei kleinen Dateien)

export async function imageFileToDataUrl(file: File): Promise<string> {
  const raw = await readFileAsDataUrl(file);
  const img = await loadImage(raw).catch(() => null);
  if (!img) return raw;
  const maxSide = Math.max(img.width, img.height);
  if (file.size <= MAX_RAW_BYTES && maxSide <= HARD_DIMENSION) return raw;

  const scale = Math.min(1, MAX_DIMENSION / maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return raw;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const jpeg = canvas.toDataURL('image/jpeg', 0.85);
  // JPEG nur nehmen, wenn es wirklich kleiner ist (z. B. nicht bei Grafiken mit Transparenz)
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
