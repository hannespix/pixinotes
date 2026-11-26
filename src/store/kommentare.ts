/**
 * Kommentar-Pins (M148) und Nachschlagen.
 *
 * M480: aus src/store.ts herausgelöst (reiner Umbau) – src/store.ts bleibt der Einstieg und exportiert alles weiter.
 */
import { uid } from '../types';
import { offeneSeite } from '../lib/pdfSeiten';
import type { BoardState, Setzen, Holen, AufsOffene } from './typen';
import { selectActiveBoard } from './selektoren';
import { lageSetzen, lageVon } from './verlauf';


/** M480: Teil des Board-Speichers – Kommentar-Pins (M148) und Nachschlagen. */
export function kommentareScheibe(set: Setzen, get: Holen, patchActive: AufsOffene) {
  return {
    // ---------- Kommentar-Pins (M148) ----------
    commentOpen: null,
    commentOrt: null,
    setCommentOpen: (id, ort) => set({ commentOpen: id, commentOrt: ort ?? null }),
    lookup: null,
    setLookup: (q) => set({ lookup: q }),

    addCommentMsg: (target, author, text) => {
      const msg = { author: author.trim().slice(0, 40) || 'Anonym', text: text.trim(), at: new Date().toISOString() };
      if (!msg.text) return null;
      let threadId: string | null = null;
      patchActive((b) => {
        const comments = [...(b.comments ?? [])];
        if (target.threadId) {
          const i = comments.findIndex((c) => c.id === target.threadId);
          if (i < 0) return {};
          threadId = target.threadId;
          comments[i] = { ...comments[i], resolved: false, msgs: [...comments[i].msgs, msg] };
        } else if (target.nodeId) {
          threadId = uid();
          let ort: { seite: number; px: number; py: number } | Record<string, never> = target.seite != null && target.px != null && target.py != null
            ? { seite: target.seite, px: target.px, py: target.py } : {};
          // M336: Liegt die Karte als PDF-Seite offen, gehört auch ein Kommentar ohne Stelle zu DIESER
          // Seite — am rechten Rand, untereinander gestapelt, damit er beim Blättern mitgeht
          const g = !('seite' in ort) ? offeneSeite(target.nodeId) : undefined;
          if (g) {
            const dort = comments.filter((c) => c.nodeId === target.nodeId && c.seite === g.seite).length;
            ort = { seite: g.seite, px: Math.round(g.breite - 40), py: Math.round(Math.min(g.hoehe - 30, 36 + dort * 34)) };
          }
          comments.push({ id: threadId, nodeId: target.nodeId, ...ort, msgs: [msg] });
        }
        return { comments };
      });
      return threadId;
    },

    editCommentMsg: (threadId, at, author, text) => {
      const neu = text.trim();
      if (!neu) return;
      patchActive((b) => {
        const alt = (b.comments ?? []).find((c) => c.id === threadId)?.msgs.find((m) => m.at === at && m.author === author);
        if (!alt || alt.text === neu) return {};
        return {
          comments: (b.comments ?? []).map((c) => (c.id === threadId
            ? { ...c, msgs: c.msgs.map((m) => (m === alt ? { ...m, text: neu, bearbeitet: new Date().toISOString() } : m)) }
            : c)),
        };
      });
    },

    removeCommentMsg: (threadId, at, author) => {
      const thread = (selectActiveBoard(get()).comments ?? []).find((c) => c.id === threadId);
      if (!thread) return;
      const rest = thread.msgs.filter((m) => !(m.at === at && m.author === author));
      if (rest.length === thread.msgs.length) return;
      if (rest.length === 0) { get().removeCommentThread(threadId); return; }
      patchActive((b) => ({ comments: (b.comments ?? []).map((c) => (c.id === threadId ? { ...c, msgs: rest } : c)) }));
    },

    toggleCommentResolved: (threadId) =>
      patchActive((b) => ({
        comments: (b.comments ?? []).map((c) => (c.id === threadId ? { ...c, resolved: !c.resolved } : c)),
      })),

    /**
     * M546: Pin bzw. Blase eines Gesprächs verschieben. Ein Rückgängig-Schritt je Verschieben — der Schritt merkt sich
     * die Lage davor (`kommentarOrte`), weil Gespräche sonst nicht zum Verlauf gehören (M388). Zahlen auf Zehntel
     * (Seitenpunkte) bzw. Tausendstel (Anteile an der Karte) gerundet, wie beim Setzen eines Pins (FileCard).
     */
    setCommentLage: (threadId, lage) => {
      const alt = (selectActiveBoard(get()).comments ?? []).find((c) => c.id === threadId);
      if (!alt) return;
      const rund: typeof lage = {};
      for (const [k, v] of Object.entries(lage) as [keyof typeof lage, number | null | undefined][]) {
        if (v === null || v === undefined) rund[k] = null;
        else if (Number.isFinite(v)) rund[k] = k === 'kx' || k === 'ky' ? Math.round(v * 1000) / 1000 : Math.round(v * 10) / 10;
      }
      const neu = lageSetzen(alt, rund);
      if (neu === alt) return;
      const vorher = get().past;
      get().pushHistory();
      const past = get().past;
      if (past !== vorher && past.length) set({ past: [...past.slice(0, -1), { ...past[past.length - 1], kommentarOrte: { [threadId]: lageVon(alt) } }] });
      patchActive((b) => ({ comments: (b.comments ?? []).map((c) => (c.id === threadId ? lageSetzen(c, rund) : c)) }));
    },

    removeCommentThread: (threadId) => {
      patchActive((b) => ({ comments: (b.comments ?? []).filter((c) => c.id !== threadId) }));
      set({ commentOpen: null });
    },
  } satisfies Partial<BoardState>;
}
