// M458: Packt die Browser-Erweiterung (Ordner `erweiterung/`) als ZIP nach `release/pixinotes-erweiterung.zip`.
// `npm run build:erweiterung`. Ohne Abhängigkeit: ein kleiner ZIP-Schreiber mit zlib (Deflate) und CRC-32.
// Die Pages-Bereitstellung legt das ZIP zum Download neben die App; ins Repository gehört es nicht (.gitignore).
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const QUELLE = join(REPO, 'erweiterung');
const ZIEL = process.argv[2] ?? join(REPO, 'release', 'pixinotes-erweiterung.zip');

const TABELLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = TABELLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const dateien = [];
const sammeln = (ordner) => {
  for (const name of readdirSync(ordner).sort()) {
    if (name.startsWith('.')) continue;
    const pfad = join(ordner, name);
    if (statSync(pfad).isDirectory()) sammeln(pfad);
    else dateien.push(pfad);
  }
};
sammeln(QUELLE);

// Festes Datum (1.1.2026) – gleiche Quelle, gleiches ZIP
const ZEIT = 0;
const DATUM = ((2026 - 1980) << 9) | (1 << 5) | 1;

const teile = [];
const verzeichnis = [];
let versatz = 0;
for (const pfad of dateien) {
  const name = Buffer.from(relative(QUELLE, pfad).split(sep).join('/'), 'utf8');
  const roh = readFileSync(pfad);
  const gepackt = deflateRawSync(roh, { level: 9 });
  const crc = crc32(roh);
  const kopf = Buffer.alloc(30);
  kopf.writeUInt32LE(0x04034b50, 0); kopf.writeUInt16LE(20, 4); kopf.writeUInt16LE(0x0800, 6); kopf.writeUInt16LE(8, 8);
  kopf.writeUInt16LE(ZEIT, 10); kopf.writeUInt16LE(DATUM, 12); kopf.writeUInt32LE(crc, 14);
  kopf.writeUInt32LE(gepackt.length, 18); kopf.writeUInt32LE(roh.length, 22); kopf.writeUInt16LE(name.length, 26);
  teile.push(kopf, name, gepackt);
  const z = Buffer.alloc(46);
  z.writeUInt32LE(0x02014b50, 0); z.writeUInt16LE(20, 4); z.writeUInt16LE(20, 6); z.writeUInt16LE(0x0800, 8); z.writeUInt16LE(8, 10);
  z.writeUInt16LE(ZEIT, 12); z.writeUInt16LE(DATUM, 14); z.writeUInt32LE(crc, 16); z.writeUInt32LE(gepackt.length, 20);
  z.writeUInt32LE(roh.length, 24); z.writeUInt16LE(name.length, 28); z.writeUInt32LE(versatz, 42);
  verzeichnis.push(z, name);
  versatz += kopf.length + name.length + gepackt.length;
}
const verz = Buffer.concat(verzeichnis);
const ende = Buffer.alloc(22);
ende.writeUInt32LE(0x06054b50, 0); ende.writeUInt16LE(dateien.length, 8); ende.writeUInt16LE(dateien.length, 10);
ende.writeUInt32LE(verz.length, 12); ende.writeUInt32LE(versatz, 16);

mkdirSync(join(ZIEL, '..'), { recursive: true });
const zip = Buffer.concat([...teile, verz, ende]);
writeFileSync(ZIEL, zip);
const version = JSON.parse(readFileSync(join(QUELLE, 'manifest.json'), 'utf8')).version;
console.log(`Erweiterung ${version}: ${dateien.length} Dateien, ${(zip.length / 1024).toFixed(1)} KB → ${relative(REPO, ZIEL)}`);
