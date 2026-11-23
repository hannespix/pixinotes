// M469: Termine aus Kalender-Konten in der Aufgaben-Zentrale.
// M471: … mit Kennung, Ende, Ort und Web-Link, dazu die eigenen Termine der Kalender-Karten und ICS-Abos.
//
// Termine sind keine Aufgaben: Sie bekommen keinen Haken und keine Frist, sondern einen eigenen,
// ruhigen Abschnitt „Termine heute und morgen". Gelesen wird nur, was ein Abruf ohnehin schon
// geholt hat (gemerkteTermine() in calAccounts) bzw. was in den Kalender-Karten steht — beim Start
// gibt es keinen Netzverkehr (m446). Einzige Ausnahme (M471): Ist die Erinnerung eingeschaltet, holt
// termineHintergrund() Heute/Morgen sparsam nach (höchstens alle 15 Minuten), damit die Erinnerung
// auch neue Termine kennt.
import { anyAccountConnected, fetchAccountEvents, gemerkteTermine, TERMINE_FASSUNG, type CalAccountEvent } from './calAccounts';
import { tagLokal } from './tag';

/** Woher ein Termin stammt: Konto (Google/Outlook), eigener Termin einer Kalender-Karte oder ICS-Import/-Abo */
export type TerminQuelle = 'google' | 'ms' | 'eigen' | 'ics';

export interface ZentralTermin {
  /** stabil je Termin — Merker „schon erinnert" und Markierung in der Kalender-Karte */
  key: string;
  quelle: TerminQuelle;
  /** Tag, an dem der Termin in der Liste steht (bei Mehrtägigem auch ein Folgetag) */
  date: string;
  /** Starttag des Termins */
  beginn: string;
  title: string;
  /** hh:mm Beginn — nur am Starttag und nur bei Zeitterminen */
  time?: string;
  /** hh:mm Ende */
  end?: string;
  /** letzter Tag (inklusiv), wenn mehrtägig */
  endDate?: string;
  place?: string;
  /** Web-Adresse des Termins bei Google/Outlook (ungeprüft — beim Anzeigen durch fremdeWebAdresse) */
  link?: string;
  /** Kalender-Karte, in der ein eigener bzw. ICS-Termin steht */
  boardId?: string;
  nodeId?: string;
  /** Kennung des eigenen Termins (MyEvent.id) */
  eigenId?: string;
}

/** Kurzname der Quelle, wie ihn Nutzer kennen */
export function kontoKennung(q: TerminQuelle): string {
  return q === 'google' ? 'Google' : q === 'ms' ? 'Outlook' : q === 'eigen' ? 'Kalender' : 'Abo';
}

const norm = (s: string) => s.toLocaleLowerCase('de-DE').replace(/\s+/g, ' ').trim();

/**
 * M471: Schlüssel eines Termins — gleich in Zentrale und Kalender-Karte, damit ein Klick den richtigen Eintrag
 * markiert. Mit Kennung (Konto, eigener Termin) über sie; sonst wie in M469 aus Tag, Uhrzeit und Titel (alte
 * Merker „schon erinnert" bleiben gültig).
 */
export function terminSchluessel(quelle: TerminQuelle, t: { id?: string; beginn: string; time?: string; title: string }): string {
  if (t.id && quelle === 'eigen') return `eigen|${t.id}`;
  if (t.id && (quelle === 'google' || quelle === 'ms')) return `${quelle}|id:${t.id}`;
  if (t.id && quelle === 'ics') return `ics|uid:${t.id}|${t.beginn}`;
  return `${quelle}|${t.beginn}|${t.time ?? ''}|${norm(t.title)}`;
}

/** Konto-Termin → ZentralTermin für einen Tag (auch aus der Kalender-Karte gebraucht) */
export function ausKonto(ev: CalAccountEvent, tag = ev.date): ZentralTermin {
  const erster = tag === ev.date;
  return {
    key: terminSchluessel(ev.provider, { id: ev.id, beginn: ev.date, time: ev.time, title: ev.title }),
    quelle: ev.provider,
    date: tag,
    beginn: ev.date,
    title: ev.title,
    time: erster ? ev.time : undefined,
    end: ev.end,
    endDate: ev.endDate,
    place: ev.place,
    link: ev.link,
  };
}

/** Ganztägige (und Fortsetzungen) zuerst, dann nach Uhrzeit, dann nach Titel, bei Gleichstand Konto vor Eigenem vor Abo */
const RANG: Record<TerminQuelle, number> = { google: 0, ms: 1, eigen: 2, ics: 3 };
function folge(a: ZentralTermin, b: ZentralTermin): number {
  if (!a.time !== !b.time) return a.time ? 1 : -1;
  return (a.time ?? '').localeCompare(b.time ?? '') || a.title.localeCompare(b.title, 'de') || RANG[a.quelle] - RANG[b.quelle];
}

/** Nur was die Zentrale aus den Boards braucht */
export interface TerminBoard {
  id: string;
  nodes: Array<{ id: string; type?: string; archived?: boolean; data?: unknown }>;
}

interface EigenRoh { id?: string; date?: string; title?: string; time?: string; end?: string; endDate?: string; place?: string }
interface IcsRoh { title?: string; start?: string; end?: string; startTime?: string; endTime?: string; place?: string; uid?: string }

const istTag = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const istZeit = (s: unknown): s is string => typeof s === 'string' && /^\d{2}:\d{2}$/.test(s);

/** M471: eigene Termine und ICS-Termine aller Kalender-Karten, die an `tag` liegen */
function ausKarten(boards: TerminBoard[], tag: string): ZentralTermin[] {
  const aus: ZentralTermin[] = [];
  for (const b of boards) {
    for (const n of b.nodes) {
      if (n.type !== 'calendar' || n.archived) continue;
      const d = (n.data ?? {}) as { myEvents?: unknown; icsEvents?: unknown; show?: { ics?: boolean } };
      for (const ev of (Array.isArray(d.myEvents) ? d.myEvents : []) as EigenRoh[]) {
        if (!ev || !istTag(ev.date) || typeof ev.title !== 'string' || !ev.title.trim()) continue;
        const bis = istTag(ev.endDate) && ev.endDate > ev.date ? ev.endDate : ev.date;
        if (tag < ev.date || tag > bis) continue;
        aus.push({
          key: terminSchluessel('eigen', { id: ev.id, beginn: ev.date, time: ev.time, title: ev.title }),
          quelle: 'eigen', date: tag, beginn: ev.date, title: ev.title,
          time: tag === ev.date && istZeit(ev.time) ? ev.time : undefined,
          end: istZeit(ev.end) ? ev.end : undefined,
          endDate: bis > ev.date ? bis : undefined,
          place: typeof ev.place === 'string' && ev.place ? ev.place : undefined,
          boardId: b.id, nodeId: n.id, eigenId: ev.id,
        });
      }
      // Ausgeblendete ICS-Termine einer Karte bleiben auch hier draußen
      if (d.show?.ics === false) continue;
      for (const ev of (Array.isArray(d.icsEvents) ? d.icsEvents : []) as IcsRoh[]) {
        if (!ev || !istTag(ev.start) || typeof ev.title !== 'string' || !ev.title.trim()) continue;
        const bis = istTag(ev.end) && ev.end > ev.start ? ev.end : ev.start;
        if (tag < ev.start || tag > bis) continue;
        aus.push({
          key: terminSchluessel('ics', { id: ev.uid, beginn: ev.start, time: ev.startTime, title: ev.title }),
          quelle: 'ics', date: tag, beginn: ev.start, title: ev.title,
          time: tag === ev.start && istZeit(ev.startTime) ? ev.startTime : undefined,
          end: istZeit(ev.endTime) ? ev.endTime : undefined,
          endDate: bis > ev.start ? bis : undefined,
          place: typeof ev.place === 'string' && ev.place ? ev.place : undefined,
          boardId: b.id, nodeId: n.id,
        });
      }
    }
  }
  return aus;
}

/**
 * Die Termine von heute und morgen (Ortszeit) aus Konten, eigenen Terminen der Kalender-Karten und ICS-Abos.
 *
 * Nicht doppeln: Ein Termin, der in mehreren Quellen steht (gleicher Tag, Uhrzeit, Titel), erscheint einmal —
 * bevorzugt der aus dem Konto (er hat den Web-Link); fehlende Angaben (Ende, Ort) kommen aus den anderen. Ein
 * ICS-Eintrag ohne Uhrzeit (Import vor M471) entfällt, wenn derselbe Titel am Tag mit Uhrzeit dasteht. Ebenso
 * entfällt ein Termin, der schon als Aufgabe mit gleichem Titel am gleichen Tag in der Zentrale steht — vor allem
 * Vorgänge und Meilensteine aus dem Zeitplan, die dort mit Haken stehen.
 */
export function termineHeuteMorgen(
  aufgaben: Array<{ text: string; due?: string }>,
  jetzt: Date = new Date(),
  boards: TerminBoard[] = [],
): { heute: ZentralTermin[]; morgen: ZentralTermin[]; heuteIso: string; morgenIso: string; abgedeckt: boolean; stand: number } {
  const heuteIso = tagLokal(jetzt);
  const morgenIso = tagLokal(new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() + 1));
  const g = gemerkteTermine();
  const schonAufgabe = new Set(aufgaben.filter((a) => a.due).map((a) => `${a.due}|${norm(a.text)}`));
  const fuer = (tag: string): ZentralTermin[] => {
    const alle: ZentralTermin[] = [];
    for (const ev of g.tage[tag] ?? []) {
      if (!ev || typeof ev.title !== 'string' || !istTag(ev.date)) continue;
      alle.push(ausKonto(ev, tag));
    }
    alle.push(...ausKarten(boards, tag));
    alle.sort(folge);
    const mitZeit = new Set(alle.filter((t) => t.time).map((t) => norm(t.title)));
    const gesehen = new Map<string, ZentralTermin>();
    const aus: ZentralTermin[] = [];
    for (const t of alle) {
      const titel = norm(t.title);
      if (schonAufgabe.has(`${tag}|${titel}`)) continue;
      if (t.quelle === 'ics' && !t.time && t.beginn === tag && mitZeit.has(titel)) continue;
      const k = `${t.time ?? ''}|${titel}`;
      const da = gesehen.get(k);
      if (da) {
        // Doppel: nur fehlende Angaben übernehmen
        da.end ??= t.end; da.place ??= t.place; da.link ??= t.link; da.endDate ??= t.endDate;
        continue;
      }
      const kopie = { ...t };
      gesehen.set(k, kopie);
      aus.push(kopie);
    }
    return aus;
  };
  const konto = anyAccountConnected();
  return {
    heute: fuer(heuteIso),
    morgen: fuer(morgenIso),
    heuteIso,
    morgenIso,
    // Ohne Konto gibt es nichts nachzuladen — eigene und ICS-Termine stehen in den Karten
    abgedeckt: !konto || (Array.isArray(g.tage[heuteIso]) && Array.isArray(g.tage[morgenIso])),
    // M471: Ein Zwischenspeicher der Fassung 1 (ohne Ende, Ort, Link) zählt als alt — das Öffnen holt nach
    stand: g.v === TERMINE_FASSUNG ? g.stand : 0,
  };
}

/** Ist überhaupt ein Kalender-Konto verbunden? */
export const kontoVerbunden = anyAccountConnected;

/** M471: Zeile „09:30–10:30" / „ganztägig" / „bis 25.11." für einen Termin */
export function terminZeit(t: ZentralTermin): string {
  if (t.time) return t.end && t.end !== t.time ? `${t.time}–${t.end}` : t.time;
  if (t.endDate && t.date !== t.endDate) return `bis ${t.endDate.slice(8, 10)}.${t.endDate.slice(5, 7)}.`;
  return 'ganztägig';
}

// ---------- Erinnerung kurz vor Beginn (Einstellung, Standard aus) ----------
const ERINNERUNG_KEY = 'pixinotes-termin-erinnerung';
const ERINNERT_KEY = 'pixinotes:termin-erinnert';
/** So viele Minuten vorher meldet sich die Erinnerung (der Takt der Zentrale ist 5 Minuten) */
export const TERMIN_VORLAUF_MIN = 15;

export function terminErinnerungAn(): boolean {
  try { return localStorage.getItem(ERINNERUNG_KEY) === '1'; } catch { return false; }
}

export function setTerminErinnerung(an: boolean): void {
  try { localStorage.setItem(ERINNERUNG_KEY, an ? '1' : '0'); } catch { /* privates Fenster */ }
}

/** Termine, die in den nächsten TERMIN_VORLAUF_MIN Minuten beginnen und noch nicht gemeldet wurden — gleich vormerken */
export function termineZuErinnern(aufgaben: Array<{ text: string; due?: string }>, jetzt: Date = new Date(), boards: TerminBoard[] = []): ZentralTermin[] {
  if (!terminErinnerungAn()) return [];
  let erinnert: Set<string>;
  try { erinnert = new Set(JSON.parse(localStorage.getItem(ERINNERT_KEY) ?? '[]') as string[]); } catch { erinnert = new Set(); }
  const treffer = termineHeuteMorgen(aufgaben, jetzt, boards).heute.filter((t) => {
    if (!t.time || erinnert.has(t.key)) return false;
    const [h, m] = t.time.split(':').map(Number);
    const beginn = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate(), h, m);
    const minuten = (beginn.getTime() - jetzt.getTime()) / 60_000;
    return minuten > 0 && minuten <= TERMIN_VORLAUF_MIN;
  });
  if (treffer.length) {
    for (const t of treffer) erinnert.add(t.key);
    try { localStorage.setItem(ERINNERT_KEY, JSON.stringify([...erinnert].slice(-100))); } catch { /* Speicher voll */ }
  }
  return treffer;
}

// ---------- M471: sparsamer Hintergrund-Abruf, nur mit eingeschalteter Erinnerung ----------
const ABRUF_KEY = 'pixinotes:termin-abruf';
/** Höchstens so oft fragt der Hintergrund die Konten ab (auch über Neuladen hinweg) */
export const HINTERGRUND_MS = 15 * 60 * 1000;

/**
 * Holt Heute/Morgen still nach, wenn die Erinnerung an ist, ein Konto verbunden ist und das Gemerkte fehlt oder
 * älter als eine Viertelstunde ist. Ohne Erinnerung: kein Netz (m446, m469 A1). Gibt das Versprechen des Abrufs
 * zurück oder null, wenn nichts zu tun war. Ein abgelaufenes Google-Token wird dabei nicht erneuert (kein Fenster
 * ohne Nutzer-Geste) — Outlook erneuert über sein Refresh-Token ohne Fenster.
 */
export function termineHintergrund(jetzt: Date = new Date()): Promise<void> | null {
  if (!terminErinnerungAn() || !kontoVerbunden()) return null;
  const st = termineHeuteMorgen([], jetzt);
  if (st.abgedeckt && jetzt.getTime() - st.stand < HINTERGRUND_MS) return null;
  let letzter = 0;
  try { letzter = Number(localStorage.getItem(ABRUF_KEY)) || 0; } catch { /* privates Fenster */ }
  // Auch rückwärts gedrosselt: Eine zurückgestellte Uhr soll nicht jeden Takt abfragen lassen
  if (Math.abs(jetzt.getTime() - letzter) < HINTERGRUND_MS) return null;
  try { localStorage.setItem(ABRUF_KEY, String(jetzt.getTime())); } catch { /* Speicher voll */ }
  const morgen = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() + 1);
  return fetchAccountEvents(jetzt, morgen, false, { still: true }).then(() => undefined, () => undefined);
}
