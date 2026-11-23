// M493: Die Beschlüsse einer gemeinsam geöffneten Protokoll-Sitzung — die leichte Brücke zwischen der Karte
// (MinutesCard, zeigt und ändert Beschlüsse) und der nachgeladenen Yjs-Sitzung (lib/notizGemeinsamKern.ts).
//
// Warum über Yjs? Gemeinsam sichert genau EIN Gerät (der Schreiber) die ganze Sitzung bei jedem Tastendruck. Schrieb
// ein anderer einen Beschluss am Speicher vorbei, nahm der Schutz (store/schutz.ts) ihn zurück oder der nächste
// Sicherungsstand des Schreibers überschrieb ihn — beim Knopf „§ Beschluss" verschwand die Zeile dann aus dem Text,
// ohne als Beschluss anzukommen. Jetzt liegen die Beschlüsse im selben Y-Dokument wie der Text; der Schreiber sichert
// sie mit. Ohne Live-Kanal bleibt alles beim Speicher (diese Brücke ist dann leer).
//
// Ohne Abhängigkeiten — liegt im Paket der Karte, nie im Start, und zieht kein Yjs nach.

/** M497: `top`/`topText` — Zuordnung zum TOP (siehe types.ts MinutesEntry.decisions) */
export interface Beschluss { id: string; text: string; top?: string; topText?: string }
/** M497: Zuordnung eines Beschlusses zu einem TOP (`top: ''` = bewusst ohne TOP) */
export interface TopZuordnung { top: string; topText?: string }
export interface ProtokollLive {
  beschluesse(): Beschluss[];
  /** Text ändern; `null` entfernt den Beschluss */
  beschlussSetzen(id: string, text: string | null): void;
  /** Neuer Beschluss am Ende (M497: mit TOP) */
  beschlussDazu(text: string, top?: TopZuordnung): void;
  /** M497: Beschluss einem TOP zuordnen bzw. lösen (`top: ''`) */
  beschlussZuordnen(id: string, top: TopZuordnung): void;
  /** M497: TOPs „nur Info" der Sitzung (Schlüssel wie MinutesEntry.infoTops) */
  infoTops(): string[];
  infoTopSetzen(schluessel: string, an: boolean): void;
  /** Rückruf bei jeder Änderung der Beschlüsse oder Info-TOPs (hier oder bei anderen) — gibt das Abmelden zurück */
  beiBeschluessen(cb: () => void): () => void;
}

/** Ereignis: eine Sitzung ist gemeinsam geöffnet oder wieder zu (detail: Schlüssel `Karte:Sitzungstermin`) */
export const PROTOKOLL_LIVE = 'pixinotes:protokoll-live';
const offen = new Map<string, ProtokollLive>();

export function protokollLiveSetzen(schluessel: string, s: ProtokollLive | null): void {
  if (s) offen.set(schluessel, s); else offen.delete(schluessel);
  window.dispatchEvent(new CustomEvent(PROTOKOLL_LIVE, { detail: schluessel }));
}
export const protokollLive = (schluessel: string): ProtokollLive | null => offen.get(schluessel) ?? null;
