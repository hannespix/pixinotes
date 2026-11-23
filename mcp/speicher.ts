// M443: Wo der MCP-Server die Boards liest und schreibt.
//
//   · Ordner/Datei — die Datei `pixinotes-daten.json`, die PixiNotes im Sync-Ordner führt (Einstellungen → Daten →
//     Synchronisation → Ordner). Die App beobachtet den Ordner und führt fremde Änderungen per Drei-Wege-Abgleich
//     zusammen; über Nextcloud, Dropbox oder OneDrive erreicht ein Stand so auch die anderen Geräte.
//   · PixiNotes-Konto — dieselbe Ablage wie die App (Tabelle konto_dateien: umgebung.json + board-<id>.json),
//     angemeldet mit E-Mail und Passwort. Geöffnete Apps bekommen die Änderung sofort (Realtime).
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Stand } from './motor';
import type { BoardDoc, Space } from './storeShim';

export const SYNC_DATEI = 'pixinotes-daten.json';

export interface Speicher {
  /** Kurz, für Meldungen: wohin geschrieben wird */
  name: string;
  laden(): Promise<Stand>;
  /** Schreibt den Stand. `geaendert` = Boards, deren Inhalt sich geändert hat. Wirft `Konflikt`, wenn inzwischen ein
   *  anderer geschrieben hat — dann lädt der Aufrufer neu und wiederholt. */
  sichern(stand: Stand, geaendert: Set<string>): Promise<void>;
}

export class Konflikt extends Error {}

/* ─────────────────────────── Ordner / Datei ─────────────────────────── */

export function dateiSpeicher(ort: string): Speicher {
  let pfad = ort;
  let rest: Record<string, unknown> = {};
  let gelesen = 0;
  const finden = async () => {
    try { if ((await fs.stat(ort)).isDirectory()) pfad = path.join(ort, SYNC_DATEI); } catch { /* neu */ }
  };
  return {
    name: `Datei ${ort}`,
    async laden() {
      await finden();
      try {
        const st = await fs.stat(pfad);
        gelesen = st.mtimeMs;
        const p = JSON.parse(await fs.readFile(pfad, 'utf8')) as Record<string, unknown>;
        if (p.app !== 'pixinotes' || !Array.isArray(p.boards)) throw new Error(`${pfad} ist kein PixiNotes-Stand.`);
        const { boards, spaces, activeId, ...uebrig } = p;
        rest = uebrig;
        return { boards: boards as BoardDoc[], spaces: (spaces as Space[]) ?? [], activeId: (activeId as string) ?? '' };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') { gelesen = 0; rest = { app: 'pixinotes', version: 2 }; return { boards: [], spaces: [], activeId: '' }; }
        throw e;
      }
    },
    async sichern(stand) {
      // Hat die App (oder der Cloud-Client) die Datei inzwischen geschrieben? Dann zuerst deren Stand einarbeiten
      try { if ((await fs.stat(pfad)).mtimeMs !== gelesen && gelesen !== 0) throw new Konflikt('Die Datei wurde inzwischen geändert.'); } catch (e) { if (e instanceof Konflikt) throw e; }
      const payload = { app: 'pixinotes', version: 2, ...rest, savedAt: new Date().toISOString(), boards: stand.boards, spaces: stand.spaces, activeId: stand.activeId };
      const tmp = `${pfad}.mcp-${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(payload), 'utf8');
      await fs.rename(tmp, pfad);
      gelesen = (await fs.stat(pfad)).mtimeMs;
    },
  };
}

/* ─────────────────────────── PixiNotes-Konto ─────────────────────────── */

/** Derselbe Stempel wie in der App (lib/kontoSync.ts) — ändert er sich, lädt die App das Board neu */
export function stempel(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${h.toString(16)}:${text.length}`;
}

interface Umgebung {
  app: 'pixinotes'; version: 1; savedAt: string; activeId: string; spaces: Space[]; reihe: string[];
  boards: Record<string, string>; dateien: Record<string, unknown>; basisEtag?: string | null;
}

export function kontoSpeicher(o: { url: string; key: string; email: string; passwort: string }): Speicher {
  const url = o.url.replace(/\/+$/, '');
  let token = ''; let userId = ''; let ablauf = 0;
  let umgebungEtag: string | null = null;
  let umgebung: Umgebung | null = null;
  const anmelden = async () => {
    if (token && Date.now() < ablauf) return;
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: o.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: o.email, password: o.passwort }),
    });
    const j = await res.json().catch(() => ({})) as { access_token?: string; expires_in?: number; user?: { id?: string }; error_description?: string; msg?: string };
    if (!res.ok || !j.access_token) throw new Error(`Anmeldung beim PixiNotes-Konto fehlgeschlagen: ${j.error_description ?? j.msg ?? res.status}`);
    token = j.access_token; userId = j.user?.id ?? ''; ablauf = Date.now() + ((j.expires_in ?? 3600) - 120) * 1000;
  };
  const kopf = () => ({ apikey: o.key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
  const tabelle = `${url}/rest/v1/konto_dateien`;
  const mein = () => `user_id=eq.${encodeURIComponent(userId)}`;
  const zeilen = async (res: Response) => { if (!res.ok) throw new Error(`PixiNotes-Konto: HTTP ${res.status} ${await res.text().catch(() => '')}`); return res.json() as Promise<Array<{ name: string; inhalt?: string; version?: number }>>; };
  return {
    name: `PixiNotes-Konto ${o.email}`,
    async laden() {
      await anmelden();
      const u = await zeilen(await fetch(`${tabelle}?select=inhalt,version&name=eq.umgebung.json&${mein()}`, { headers: kopf() }));
      if (!u.length) { umgebung = null; umgebungEtag = null; return { boards: [], spaces: [], activeId: '' }; }
      umgebung = JSON.parse(u[0].inhalt ?? '{}') as Umgebung;
      umgebungEtag = String(u[0].version);
      const z = await zeilen(await fetch(`${tabelle}?select=name,inhalt&name=like.board-*&${mein()}`, { headers: kopf() }));
      const nachId = new Map<string, BoardDoc>();
      for (const r of z) { try { const b = JSON.parse(r.inhalt ?? '') as BoardDoc; if (b?.id) nachId.set(b.id, b); } catch { /* beschädigte Zeile überspringen */ } }
      const reihe = umgebung.reihe ?? Object.keys(umgebung.boards ?? {});
      const boards = reihe.map((id) => nachId.get(id)).filter((b): b is BoardDoc => !!b);
      return { boards, spaces: umgebung.spaces ?? [], activeId: umgebung.activeId ?? boards[0]?.id ?? '' };
    },
    async sichern(stand, geaendert) {
      await anmelden();
      for (const b of stand.boards) {
        if (!geaendert.has(b.id)) continue;
        const text = JSON.stringify(b);
        const satz = JSON.stringify({ name: `board-${b.id}.json`, inhalt: text, mime: 'application/json', groesse: text.length });
        const res = await fetch(`${tabelle}?on_conflict=user_id,name`, { method: 'POST', headers: { ...kopf(), Prefer: 'resolution=merge-duplicates,return=minimal' }, body: satz });
        if (!res.ok) throw new Error(`PixiNotes-Konto: Board „${b.name}" nicht gespeichert (HTTP ${res.status}).`);
      }
      const alt = umgebung;
      const neu: Umgebung = {
        ...(alt ?? {}),
        app: 'pixinotes', version: 1, savedAt: new Date().toISOString(), activeId: stand.activeId,
        spaces: stand.spaces, reihe: stand.boards.map((b) => b.id),
        boards: Object.fromEntries(stand.boards.map((b) => [b.id, geaendert.has(b.id) ? stempel(JSON.stringify(b)) : (alt?.boards?.[b.id] ?? stempel(JSON.stringify(b)))])),
        dateien: alt?.dateien ?? {}, basisEtag: umgebungEtag,
      };
      const text = JSON.stringify(neu);
      const satz = JSON.stringify({ name: 'umgebung.json', inhalt: text, mime: 'application/json', groesse: text.length });
      if (umgebungEtag) {
        // Nur, wenn die Umgebung noch den gelesenen Stand hat — sonst hat ein Gerät inzwischen geschrieben
        const res = await fetch(`${tabelle}?name=eq.umgebung.json&${mein()}&version=eq.${encodeURIComponent(umgebungEtag)}`, { method: 'PATCH', headers: { ...kopf(), Prefer: 'return=representation' }, body: satz });
        const z = await zeilen(res);
        if (!z.length) throw new Konflikt('Ein anderes Gerät hat inzwischen geschrieben.');
        umgebungEtag = String(z[0].version);
      } else {
        const res = await fetch(tabelle, { method: 'POST', headers: { ...kopf(), Prefer: 'return=representation' }, body: satz });
        if (res.status === 409) throw new Konflikt('Ein anderes Gerät hat inzwischen geschrieben.');
        const z = await zeilen(res);
        umgebungEtag = String(z[0]?.version ?? 1);
      }
      umgebung = neu;
    },
  };
}
