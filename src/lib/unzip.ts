// M184: Minimaler ZIP-Leser — ohne jede externe Bibliothek.
//
// Gebraucht wird er für den Word-Import (.docx ist ein ZIP mit XML darin) und
// perspektivisch für jedes andere Office-Format. Statt eine mehrere hundert
// Kilobyte große Bibliothek ins Einzeldatei-Bundle zu ziehen, nutzen wir das,
// was der Browser längst mitbringt: `DecompressionStream('deflate-raw')`
// (Chrome 103+, Firefox 113+, Safari 16.4+) erledigt das Auspacken, hier steht
// nur das Lesen der ZIP-Wegweiser (Central Directory).
//
// Bewusst gelesen wird IMMER aus dem Central Directory am Dateiende, nie aus
// den lokalen Kopfdaten: Word schreibt dort die Größen gelegentlich als 0 und
// schiebt sie in einen „Data Descriptor" hinter die Daten (Flag-Bit 3) — das
// Verzeichnis am Ende ist die verlässliche Quelle.

const SIG_EOCD = 0x06054b50;      // End of Central Directory
const SIG_EOCD64 = 0x06064b50;    // Zip64 End of Central Directory
const SIG_EOCD64_LOC = 0x07064b50; // Zip64 EOCD Locator
const SIG_CENTRAL = 0x02014b50;   // Central Directory File Header
const SIG_LOCAL = 0x04034b50;     // Local File Header

interface ZipEntry {
  name: string;
  /** 0 = unkomprimiert, 8 = Deflate — mehr unterstützen wir nicht (und .docx braucht auch nicht mehr) */
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  /** Position des lokalen Kopfsatzes in der Datei */
  localOffset: number;
}

export class ZipArchive {
  private constructor(
    private readonly buf: ArrayBuffer,
    private readonly entries: Map<string, ZipEntry>,
  ) {}

  /** Alle Einträge (Pfade) im Archiv */
  get names(): string[] {
    return [...this.entries.keys()];
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** Archiv einlesen — wirft mit Klartext, wenn es kein brauchbares ZIP ist */
  static async open(data: ArrayBuffer): Promise<ZipArchive> {
    if (data.byteLength < 22) throw new Error('Datei ist zu klein für ein ZIP-Archiv.');
    const view = new DataView(data);

    // EOCD rückwärts suchen (ein ZIP-Kommentar darf bis 64 KB dahinter stehen)
    const maxBack = Math.min(data.byteLength, 0xffff + 22);
    let eocd = -1;
    for (let i = data.byteLength - 22; i >= data.byteLength - maxBack; i--) {
      if (view.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Kein ZIP-Verzeichnis gefunden — Datei ist beschädigt oder kein ZIP/DOCX.');

    let count = view.getUint16(eocd + 10, true);
    let cdOffset = view.getUint32(eocd + 16, true);

    // Zip64: Bei sehr großen/vielen Einträgen stehen hier Platzhalter (0xFFFF…),
    // die echten Werte liegen im Zip64-Verzeichnis davor.
    if (count === 0xffff || cdOffset === 0xffffffff) {
      const locator = eocd - 20;
      if (locator >= 0 && view.getUint32(locator, true) === SIG_EOCD64_LOC) {
        const z64 = Number(view.getBigUint64(locator + 8, true));
        if (z64 >= 0 && z64 + 56 <= data.byteLength && view.getUint32(z64, true) === SIG_EOCD64) {
          count = Number(view.getBigUint64(z64 + 32, true));
          cdOffset = Number(view.getBigUint64(z64 + 48, true));
        }
      }
    }

    const dec = new TextDecoder('utf-8');
    const entries = new Map<string, ZipEntry>();
    let p = cdOffset;
    for (let i = 0; i < count; i++) {
      if (p + 46 > data.byteLength || view.getUint32(p, true) !== SIG_CENTRAL) break;
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const name = dec.decode(new Uint8Array(data, p + 46, nameLen));
      entries.set(name, {
        name,
        method: view.getUint16(p + 10, true),
        compressedSize: view.getUint32(p + 20, true),
        uncompressedSize: view.getUint32(p + 24, true),
        localOffset: view.getUint32(p + 42, true),
      });
      p += 46 + nameLen + extraLen + commentLen;
    }
    if (entries.size === 0) throw new Error('ZIP-Archiv enthält keine lesbaren Einträge.');
    return new ZipArchive(data, entries);
  }

  /** Einen Eintrag entpacken — null, wenn es ihn nicht gibt */
  async bytes(name: string): Promise<Uint8Array | null> {
    const e = this.entries.get(name);
    if (!e) return null;
    const view = new DataView(this.buf);
    if (view.getUint32(e.localOffset, true) !== SIG_LOCAL) {
      throw new Error(`ZIP-Eintrag „${name}" ist beschädigt.`);
    }
    // Die Längenangaben im LOKALEN Kopf sind unzuverlässig (s. o.) — aber die
    // Namens-/Extra-Längen brauchen wir, um den Datenanfang zu finden.
    const nameLen = view.getUint16(e.localOffset + 26, true);
    const extraLen = view.getUint16(e.localOffset + 28, true);
    const start = e.localOffset + 30 + nameLen + extraLen;
    const raw = new Uint8Array(this.buf, start, Math.min(e.compressedSize, this.buf.byteLength - start));

    if (e.method === 0) return raw.slice();
    if (e.method !== 8) throw new Error(`ZIP-Eintrag „${name}" nutzt ein nicht unterstütztes Packverfahren (${e.method}).`);
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Dieser Browser kann ZIP-Inhalte nicht entpacken (DecompressionStream fehlt) — bitte einen aktuellen Browser verwenden.');
    }
    // slice() ist nötig: Der Blob darf keine Sicht auf den Gesamtpuffer halten
    const stream = new Blob([raw.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** Einen Eintrag als Text (UTF-8) — null, wenn es ihn nicht gibt */
  async text(name: string): Promise<string | null> {
    const b = await this.bytes(name);
    return b ? new TextDecoder('utf-8').decode(b) : null;
  }

  /** Einen Eintrag als data:-URL (für eingebettete Bilder) */
  async dataUrl(name: string, mime: string): Promise<string | null> {
    const b = await this.bytes(name);
    if (!b) return null;
    let bin = '';
    // In Häppchen, sonst sprengt ein großes Bild den Argument-Stack von apply()
    for (let i = 0; i < b.length; i += 0x8000) {
      bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
    }
    return `data:${mime};base64,${btoa(bin)}`;
  }
}
