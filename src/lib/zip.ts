// M476: Minimaler ZIP-Schreiber — das Gegenstück zu lib/unzip.ts, ohne Bibliothek.
//
// Gebraucht für die Sicherung (.pixinotes): Anhänge, PDFs und Bilder reisen als echte Binärdaten statt als
// Base64 in einer JSON-Datei — ein Drittel kleiner, und eine 50-MB-Datei muss nicht erst in einen
// 70-MB-Text verwandelt werden. Geschrieben wird bewusst UNKOMPRIMIERT („stored", Verfahren 0): Bilder,
// PDFs und Office-Dateien sind schon gepackt, und so bleibt der Schreiber klein und in jedem Browser
// lauffähig (auch dort, wo CompressionStream fehlt). Jedes ZIP-Programm öffnet die Datei.

let tabelle: Uint32Array | null = null;
function crcTabelle(): Uint32Array {
  if (tabelle) return tabelle;
  tabelle = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabelle[n] = c >>> 0;
  }
  return tabelle;
}

/** CRC-32 (wie ZIP und gzip sie verlangen) */
export function crc32(daten: Uint8Array): number {
  const t = crcTabelle();
  let c = 0xffffffff;
  for (let i = 0; i < daten.length; i++) c = t[(c ^ daten[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEintrag { name: string; daten: Uint8Array }

/** DOS-Zeitstempel (Datum, Uhrzeit) — ZIP kennt nichts anderes */
function dosZeit(d: Date): { zeit: number; datum: number } {
  return {
    zeit: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    datum: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Ein ZIP-Archiv aus den Einträgen — als Blob, damit große Dateien nicht in einen Puffer kopiert werden */
export function zipBauen(eintraege: ZipEintrag[], jetzt = new Date()): Blob {
  const enc = new TextEncoder();
  const { zeit, datum } = dosZeit(jetzt);
  const teile: BlobPart[] = [];
  const zentral: Uint8Array[] = [];
  let pos = 0;
  for (const e of eintraege) {
    const name = enc.encode(e.name);
    const crc = crc32(e.daten);
    const groesse = e.daten.length;
    const kopf = new Uint8Array(30 + name.length);
    const k = new DataView(kopf.buffer);
    k.setUint32(0, 0x04034b50, true);
    k.setUint16(4, 20, true);          // benötigte Version 2.0
    k.setUint16(6, 0x0800, true);      // Bit 11: Namen in UTF-8
    k.setUint16(8, 0, true);           // Verfahren 0 = gespeichert
    k.setUint16(10, zeit, true);
    k.setUint16(12, datum, true);
    k.setUint32(14, crc, true);
    k.setUint32(18, groesse, true);
    k.setUint32(22, groesse, true);
    k.setUint16(26, name.length, true);
    k.setUint16(28, 0, true);
    kopf.set(name, 30);
    teile.push(kopf, e.daten as BlobPart);

    const z = new Uint8Array(46 + name.length);
    const v = new DataView(z.buffer);
    v.setUint32(0, 0x02014b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 20, true);
    v.setUint16(8, 0x0800, true);
    v.setUint16(10, 0, true);
    v.setUint16(12, zeit, true);
    v.setUint16(14, datum, true);
    v.setUint32(16, crc, true);
    v.setUint32(20, groesse, true);
    v.setUint32(24, groesse, true);
    v.setUint16(28, name.length, true);
    v.setUint32(42, pos, true);        // Lage des lokalen Kopfes
    z.set(name, 46);
    zentral.push(z);
    pos += kopf.length + groesse;
  }
  const zentralGroesse = zentral.reduce((s, z) => s + z.length, 0);
  const ende = new Uint8Array(22);
  const w = new DataView(ende.buffer);
  w.setUint32(0, 0x06054b50, true);
  w.setUint16(8, eintraege.length, true);
  w.setUint16(10, eintraege.length, true);
  w.setUint32(12, zentralGroesse, true);
  w.setUint32(16, pos, true);
  return new Blob([...teile, ...zentral as BlobPart[], ende], { type: 'application/zip' });
}
