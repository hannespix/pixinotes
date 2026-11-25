// M529: Was ein eigenes Tool selbst speichert (sein „localStorage", lib/htmlStore.ts), reist mit dem PixiNotes-Konto.
//
// Bisher reiste nur der Quelltext eines Tools; seinen Speicherstand behielt jedes Gerät für sich. Auf dem zweiten
// Gerät sah dasselbe Tool deshalb aus wie „Stand weg" (M524, „Grenzen"). Jetzt liegt der Stand je Tool als
// `<Nutzer>/zustand-<Kennung>` im Dateispeicher des Kontos — neben Anhängen und Tool-Quelltexten:
//
//   { app: 'pixinotes-appzustand', version: 1, savedAt, data: { Schlüssel: Text, … } }
//
// Hochgeladen wird nur, wenn sich der Stand geändert hat (Prüfsumme), und höchstens alle zehn Sekunden je Tool — ein
// Tool, das bei jedem Bild speichert, schickt nicht jedes Bild. Beim Start eines Tools gilt der neuere Stand (wie beim
// Team-Ordner, M162); ob es im Konto überhaupt einen gibt, sagt das Verzeichnis des Dateispeichers (eine Anfrage,
// kurz gemerkt) — so entsteht für Tools ohne Stand keine fehlschlagende Anfrage. Was hereinkommt, prüft
// lib/sicher.ts (nur Texte, höchstens 5 MB). Nur eigene Boards: Geteilte gehören einem anderen Konto.
import { useBoard } from '../store';
import { kontoAnfrage, kontoObjekte, loadKonto, stempel } from './kontoSync';
import { toolSpeicherVonAussen } from './sicherGestalt';
import { idbGet, idbSet } from './syncFolder';

export const ZUSTAND_PREFIX = 'zustand-';
const MERK = (id: string) => `happ-konto:${id}`;
const ABSTAND_MS = 10_000;

const adresse = (id: string, lesen = false): string => {
  const s = loadKonto();
  return `${s?.url ?? ''}/storage/v1/object/${lesen ? 'authenticated/' : ''}pixinotes/${encodeURIComponent(s?.userId ?? '')}/${ZUSTAND_PREFIX}${encodeURIComponent(id)}`;
};
/** Gehört das Tool zu einem eigenen Board (nicht geteilt von jemand anderem)? */
function eigenesTool(id: string): boolean {
  for (const b of useBoard.getState().boards) {
    if (!b.nodes.some((n) => n.id === id)) continue;
    return !b.geteiltVon && !b.gastLink;
  }
  return false;
}
const kontoDa = (): boolean => { const s = loadKonto(); return s?.anbieter === 'supabase' && !!s.userId; };

/** Messwerte für die Prüfreihe */
export const zustandZaehler = { hochgeladen: 0, uebersprungen: 0, geholt: 0 };
if (typeof window !== 'undefined') (window as unknown as { pixinotesToolZustand?: typeof zustandZaehler }).pixinotesToolZustand = zustandZaehler;

const offen = new Map<string, Record<string, string>>();
const timer = new Map<string, ReturnType<typeof setTimeout>>();
const zuletzt = new Map<string, number>();

/** Ein Tool hat gespeichert — höchstens alle ABSTAND_MS, nur bei Änderung, ins Konto */
export function zustandMelden(id: string, data: Record<string, string>): void {
  if (!kontoDa() || !eigenesTool(id)) return;
  offen.set(id, data);
  if (timer.has(id)) return;
  const warte = Math.max(1500, (zuletzt.get(id) ?? 0) + ABSTAND_MS - Date.now());
  timer.set(id, setTimeout(() => { timer.delete(id); void hochladen(id).catch(() => {}); }, warte));
}

async function hochladen(id: string): Promise<void> {
  const data = offen.get(id);
  offen.delete(id);
  if (!data || !kontoDa()) return;
  const text = JSON.stringify(data);
  const pruef = stempel(text);
  const merk = await idbGet<{ pruef: string; savedAt: string }>(MERK(id)).catch(() => undefined);
  if (merk?.pruef === pruef) { zustandZaehler.uebersprungen += 1; return; }
  zuletzt.set(id, Date.now());
  const savedAt = new Date().toISOString();
  const res = await kontoAnfrage(adresse(id), {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-upsert': 'true' },
    body: JSON.stringify({ app: 'pixinotes-appzustand', version: 1, savedAt, data }),
  });
  if (!res.ok) return;   // beim nächsten Speichern des Tools wieder
  zustandZaehler.hochgeladen += 1;
  verzeichnis = null;
  await idbSet(MERK(id), { pruef, savedAt }).catch(() => {});
}

let verzeichnis: { am: number; objekte: Promise<Map<string, { groesse: number; am: string }> | null> } | null = null;
/**
 * Der Stand im Konto, wenn er NEUER ist als `hierAm` (Zeitpunkt des Stands auf diesem Gerät). `null`: keiner, älter,
 * nicht lesbar oder kein eigenes Board.
 */
export async function zustandHolen(id: string, hierAm?: string): Promise<{ data: Record<string, string>; savedAt: string } | null> {
  if (!kontoDa() || !eigenesTool(id)) return null;
  if (!verzeichnis || Date.now() - verzeichnis.am > 30_000) verzeichnis = { am: Date.now(), objekte: kontoObjekte() };
  const o = (await verzeichnis.objekte)?.get(`${ZUSTAND_PREFIX}${id}`);
  if (!o) return null;
  const merk = await idbGet<{ pruef: string; savedAt: string }>(MERK(id)).catch(() => undefined);
  // Das Objekt ist der eigene, zuletzt hochgeladene Stand: nichts zu holen
  if (merk && o.am && Date.parse(o.am) <= Date.parse(merk.savedAt) + 2000 && hierAm && hierAm >= merk.savedAt) return null;
  const res = await kontoAnfrage(adresse(id, true), { cache: 'no-store' });
  if (!res.ok) return null;
  let roh: unknown;
  try { roh = await res.json(); } catch { return null; }
  const p = roh as { app?: unknown; savedAt?: unknown; data?: unknown } | null;
  if (!p || p.app !== 'pixinotes-appzustand' || typeof p.savedAt !== 'string') return null;
  const data = toolSpeicherVonAussen(p.data);
  if (!data) return null;
  if (hierAm && p.savedAt <= hierAm) return null;
  zustandZaehler.geholt += 1;
  // so gilt er als bekannt: derselbe Stand geht nicht wieder hinauf
  await idbSet(MERK(id), { pruef: stempel(JSON.stringify(data)), savedAt: p.savedAt }).catch(() => {});
  return { data, savedAt: p.savedAt };
}
