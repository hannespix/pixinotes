// M364: Live-Kanal für ein geteiltes Board — „es hat sich etwas geändert" und „wer ist gerade dabei".
//
// Supabase Realtime kann neben Datenbank-Änderungen (M328, nur für Angemeldete) auch Broadcast und Presence:
// Nachrichten zwischen den Teilnehmern eines Kanals, ohne Tabelle. Der Kanal heißt nach dem Token des
// Einladungslinks — wer den Link hat, kennt ihn; ein Konto braucht es dafür nicht (öffentlicher Kanal, der
// öffentliche Schlüssel genügt).
//   · Broadcast „stand": Jemand hat geschrieben → die anderen holen den neuen Stand sofort (sonst erst der
//     nächste Blick alle paar Sekunden).
//   · Broadcast frei (Ereignisname + Inhalt): für „Folgt mir" in der Präsentation.
//   · Presence: Name und Farbe jedes Teilnehmers — die Anzeige „wer ist dabei".
// Fällt der Kanal aus (Netz, Einstellung des Servers), bleibt der regelmäßige Blick: Der Abgleich hängt nie
// am Kanal, er wird mit ihm nur schneller. Kein Fehler nach außen.
import type { SupabaseKonfig } from './kontoSupabase';

/** `karte`: die Karte, die dieser Teilnehmer gerade bearbeitet (und damit hält); `seit`: seit wann (für „wer war zuerst") */
export interface Teilnehmer { id: string; name: string; farbe: string; karte?: string; seit?: number }
export interface LiveKanal {
  stop(): void;
  /** Nachricht an alle anderen im Kanal */
  senden(ereignis: string, inhalt?: unknown): void;
  /** Eigenen Namen/Farbe (neu) anmelden — z. B. nachdem der Name eingegeben wurde */
  ich(t: Teilnehmer): void;
  readonly verbunden: boolean;
  readonly teilnehmer: Teilnehmer[];
}

export function liveKanal(
  k: SupabaseKonfig, name: string, ich: Teilnehmer,
  auf: { nachricht: (ereignis: string, inhalt: unknown) => void; teilnehmer: (liste: Teilnehmer[]) => void },
  /** Nutzer-Token, falls angemeldet — ohne nimmt der Server den öffentlichen Schlüssel */
  token?: string,
): LiveKanal {
  let ws: WebSocket | null = null;
  let aktiv = true, verbunden = false, ref = 0, pause = 1000, joinRef = '';
  let herz: ReturnType<typeof setInterval> | undefined;
  let neuTimer: ReturnType<typeof setTimeout> | undefined;
  let selbst = ich;
  /** Schlüssel → Angaben (Presence-Zustand, vom Server geführt) */
  const da = new Map<string, Teilnehmer>();
  const topic = `realtime:pn-${name}`;
  const liste = (): Teilnehmer[] => [...da.values()].sort((a, b) => a.name.localeCompare(b.name, 'de') || a.id.localeCompare(b.id));
  const melden = () => auf.teilnehmer(liste());
  const roh = (ev: string, payload: unknown, t = topic) => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    ref += 1;
    ws.send(JSON.stringify({ topic: t, event: ev, payload, ref: String(ref), ...(t === topic ? { join_ref: ev === 'phx_join' ? String(ref) : joinRef } : {}) }));
    if (ev === 'phx_join') joinRef = String(ref);
  };
  const anmelden = () => roh('presence', { type: 'presence', event: 'track', payload: { id: selbst.id, name: selbst.name, farbe: selbst.farbe, karte: selbst.karte ?? null, seit: selbst.seit ?? null } });
  const metas = (wert: unknown): Teilnehmer | null => {
    // Mehrere Einträge je Schlüssel (erneutes Anmelden): der letzte gilt
    const alle = (wert as { metas?: Array<{ id?: string; name?: string; farbe?: string; karte?: string | null; seit?: number | null }> } | undefined)?.metas;
    const m = alle?.[alle.length - 1];
    if (!m || typeof m.name !== 'string') return null;
    return {
      id: String(m.id ?? ''), name: m.name.slice(0, 40), farbe: typeof m.farbe === 'string' ? m.farbe : '#6b7280',
      ...(typeof m.karte === 'string' && m.karte ? { karte: m.karte, seit: typeof m.seit === 'number' ? m.seit : 0 } : {}),
    };
  };
  const verbinden = () => {
    if (!aktiv || typeof WebSocket === 'undefined' || !k.url || !k.key) return;
    const url = `${k.url.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(k.key)}&vsn=1.0.0`;
    try { ws = new WebSocket(url); } catch { return; }
    ws.onopen = () => {
      pause = 1000;
      roh('phx_join', {
        config: { broadcast: { ack: false, self: false }, presence: { enabled: true, key: selbst.id }, postgres_changes: [], private: false },
        ...(token ? { access_token: token } : {}),
      });
      clearInterval(herz);
      herz = setInterval(() => roh('heartbeat', {}, 'phoenix'), 20_000);
    };
    ws.onmessage = (m) => {
      try {
        const j = JSON.parse(String(m.data)) as { topic?: string; event?: string; payload?: Record<string, unknown> & { status?: string; event?: string; payload?: unknown } };
        if (j.topic !== topic) return;
        if (j.event === 'phx_reply' && j.payload?.status === 'ok' && !verbunden) { verbunden = true; anmelden(); return; }
        if (j.event === 'broadcast' && typeof j.payload?.event === 'string') { auf.nachricht(j.payload.event, j.payload.payload); return; }
        if (j.event === 'presence_state') {
          da.clear();
          for (const [key, wert] of Object.entries(j.payload ?? {})) { const t = metas(wert); if (t) da.set(key, t); }
          melden();
          return;
        }
        if (j.event === 'presence_diff') {
          const d = j.payload as { joins?: Record<string, unknown>; leaves?: Record<string, unknown> };
          for (const key of Object.keys(d.leaves ?? {})) da.delete(key);
          for (const [key, wert] of Object.entries(d.joins ?? {})) { const t = metas(wert); if (t) da.set(key, t); }
          melden();
        }
      } catch { /* egal */ }
    };
    ws.onclose = () => {
      verbunden = false;
      clearInterval(herz);
      da.clear(); melden();
      if (!aktiv) return;
      neuTimer = setTimeout(verbinden, pause);
      pause = Math.min(pause * 2, 60_000);
    };
    ws.onerror = () => { try { ws?.close(); } catch { /* egal */ } };
  };
  verbinden();
  return {
    stop() { aktiv = false; clearInterval(herz); clearTimeout(neuTimer); try { ws?.close(); } catch { /* egal */ } ws = null; },
    senden(ereignis, inhalt) { if (verbunden) roh('broadcast', { type: 'broadcast', event: ereignis, payload: inhalt ?? {} }); },
    ich(t) { selbst = t; if (verbunden) anmelden(); },
    get verbunden() { return verbunden; },
    get teilnehmer() { return liste(); },
  };
}
