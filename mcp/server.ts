// M443: PixiNotes als MCP-Server — KI-Modelle von außen (Claude Desktop, Claude Code, Cursor, …) legen Boards an,
// lesen und füllen sie, mit allen Modulen der App: Notiz, Kanban, Zeitplan, Rechen-Tabelle, Wochenplaner,
// Protokoll, Zeiterfassung, Ideen-Bubbles, Diagramm, Kontakt (M454), Formen, Rahmen, Pfeile.
//
// Start:  node pixinotes-mcp.mjs --ordner "<Sync-Ordner von PixiNotes>"
//    oder PIXINOTES_EMAIL=… PIXINOTES_PASSWORT=… node pixinotes-mcp.mjs --konto
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ausfuehren, boardAnlegen, boardFinden, boardLesen, opsBeschreibung, uebersicht, type Stand } from './motor';
import { dateiSpeicher, Konflikt, kontoSpeicher, type Speicher } from './speicher';
import type { AiOp } from '../src/lib/kiPlan';

const VERSION = '1.0.0';
/** Öffentliche Kennung des gehosteten PixiNotes-Kontos (wie in der App; der Schlüssel ist öffentlich, die Daten schützt RLS) */
const KONTO_URL = 'https://dckzqvbrffmemdzamtqr.supabase.co';
const KONTO_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRja3pxdmJyZmZtZW1kemFtdHFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5ODc2NDIsImV4cCI6MjEwOTU2MzY0Mn0.KWHKi9w2CSrszq3xtQlMOCnyFlwO26QTXwnLWwUKBHs';

function speicherAusArgumenten(argv: string[], env: NodeJS.ProcessEnv): Speicher {
  const wert = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const ort = wert('--ordner') ?? wert('--datei') ?? env.PIXINOTES_ORDNER ?? env.PIXINOTES_DATEI;
  if (ort) return dateiSpeicher(ort);
  if (argv.includes('--konto') || env.PIXINOTES_EMAIL) {
    const email = env.PIXINOTES_EMAIL ?? ''; const passwort = env.PIXINOTES_PASSWORT ?? '';
    if (!email || !passwort) throw new Error('Für das PixiNotes-Konto PIXINOTES_EMAIL und PIXINOTES_PASSWORT setzen.');
    return kontoSpeicher({ url: env.PIXINOTES_KONTO_URL ?? KONTO_URL, key: env.PIXINOTES_KONTO_KEY ?? KONTO_KEY, email, passwort });
  }
  throw new Error('Wohin schreiben? --ordner "<Sync-Ordner>" (Datei pixinotes-daten.json) oder --konto mit PIXINOTES_EMAIL/PIXINOTES_PASSWORT.');
}

/**
 * Lesen → ändern → schreiben. Schreibt inzwischen jemand anderes (die App, ein anderes Gerät), wird neu gelesen und
 * die Änderung auf dem frischen Stand wiederholt — so geht nichts verloren.
 */
async function aendern<T>(sp: Speicher, fn: (s: Stand) => Promise<{ stand: Stand; geaendert: Set<string>; wert: T }>): Promise<T> {
  for (let versuch = 0; ; versuch += 1) {
    const s = await sp.laden();
    const r = await fn(s);
    try { await sp.sichern(r.stand, r.geaendert); return r.wert; } catch (e) {
      if (e instanceof Konflikt && versuch < 4) { await new Promise((ok) => setTimeout(ok, 250 * (versuch + 1))); continue; }
      throw e;
    }
  }
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const fehler = (t: string) => ({ content: [{ type: 'text' as const, text: t }], isError: true });

export function serverBauen(sp: Speicher): McpServer {
  const server = new McpServer({ name: 'pixinotes', version: VERSION }, {
    instructions: 'PixiNotes ist ein Whiteboard mit Karten (Notizen und Modulen) auf einer Leinwand, gegliedert in Bereiche → Projekte → Boards. '
      + 'Arbeitsweise: pixinotes_uebersicht zeigt alle Boards; pixinotes_board_lesen liefert den Inhalt eines Boards samt Kennungen der Karten und ihrer Teile (Ticket, Vorgang, Zeile …); '
      + 'pixinotes_board_anlegen legt ein Board an; pixinotes_bearbeiten führt Operationen aus (Karten und Module anlegen, füllen, ändern, verbinden). '
      + 'Bevorzuge passende Module statt langer Notizen: Aufgaben → kanban, Termine/Phasen → gantt, Zahlen/Listen → sheet, Abläufe → mermaid, Wochenpläne → week, Besprechungen → minutes, Ideen sammeln → bubbles, Ansprechpartner → kontakt. '
      + 'Ändere Vorhandenes, statt Doppeltes anzulegen. Keine Emojis in Titeln und Texten.',
  });

  server.registerTool('pixinotes_uebersicht', {
    title: 'Boards auflisten',
    description: 'Alle Bereiche, Projekte und Boards mit Kennung, Kartenzahl und Modularten.',
    annotations: { readOnlyHint: true },
  }, async () => text(uebersicht(await sp.laden())));

  server.registerTool('pixinotes_board_lesen', {
    title: 'Board lesen',
    description: 'Den vollständigen Inhalt eines Boards lesen: jede Karte mit Kennung, Art, Lage und Inhalt (Tabellen mit Zellen und Formeln, Kanban mit Tickets, Zeitplan mit Vorgängen …) sowie die Pfeile. Die Kennungen in [eckigen Klammern] braucht pixinotes_bearbeiten.',
    inputSchema: { board: z.string().describe('Kennung oder Name des Boards') },
    annotations: { readOnlyHint: true },
  }, async ({ board }) => {
    const s = await sp.laden();
    const b = boardFinden(s, board);
    return b ? text(boardLesen(s, b)) : fehler(`Kein Board „${board}". Verfügbar:\n${uebersicht(s)}`);
  });

  server.registerTool('pixinotes_board_anlegen', {
    title: 'Board anlegen',
    description: 'Ein neues, leeres Board anlegen – optional in einem Bereich und Projekt (werden angelegt, wenn es sie noch nicht gibt). Gibt die Kennung zurück; danach mit pixinotes_bearbeiten füllen.',
    inputSchema: {
      name: z.string().describe('Name des Boards'),
      bereich: z.string().optional().describe('Name des Bereichs (z. B. „Arbeit")'),
      projekt: z.string().optional().describe('Name des Projekts im Bereich'),
    },
  }, async ({ name, bereich, projekt }) => {
    const b = await aendern(sp, async (s) => { const r = boardAnlegen(s, name, bereich, projekt); return { stand: r.stand, geaendert: new Set([r.board.id]), wert: r.board }; });
    return text(`Board „${b.name}" angelegt: [${b.id}]. Jetzt mit pixinotes_bearbeiten füllen.`);
  });

  server.registerTool('pixinotes_bearbeiten', {
    title: 'Board bearbeiten',
    description: `Operationen auf einem Board ausführen – der Reihe nach, in einem Zug. Neue Karten legen sich unter den vorhandenen Inhalt. Nutze nur Kennungen aus pixinotes_board_lesen. Erlaubte Operationen (JSON-Objekte):\n${opsBeschreibung()}`,
    inputSchema: {
      board: z.string().describe('Kennung oder Name des Boards'),
      ops: z.array(z.record(z.string(), z.unknown())).min(1).max(80).describe('Liste von Operationen, z. B. [{"op":"note","title":"…","text":"…"}]'),
    },
  }, async ({ board, ops }) => {
    try {
      const erg = await aendern(sp, async (s) => {
        const b = boardFinden(s, board);
        if (!b) throw new Error(`Kein Board „${board}". Verfügbar:\n${uebersicht(s)}`);
        const r = await ausfuehren(s, b.id, ops as AiOp[]);
        return { stand: r.stand, geaendert: new Set([b.id]), wert: { ...r.ergebnis, name: b.name, id: b.id } };
      });
      const zeilen = [`${erg.erledigt} von ${ops.length} Operationen ausgeführt auf „${erg.name}" [${erg.id}].`];
      if (erg.neu.length) zeilen.push(`Neu: ${erg.neu.map((n) => `[${n.id}] ${n.type}`).join(', ')}`);
      if (erg.abgelehnt.length) zeilen.push(`Nicht ausgeführt:\n- ${erg.abgelehnt.join('\n- ')}`);
      if (erg.antworten.length) zeilen.push(erg.antworten.join('\n'));
      return text(zeilen.join('\n'));
    } catch (e) { return fehler((e as Error).message); }
  });

  server.registerTool('pixinotes_board_umbenennen', {
    title: 'Board umbenennen',
    description: 'Einem Board einen neuen Namen geben.',
    inputSchema: { board: z.string().describe('Kennung oder Name'), name: z.string().describe('neuer Name') },
  }, async ({ board, name }) => {
    try {
      const b = await aendern(sp, async (s) => {
        const alt = boardFinden(s, board);
        if (!alt) throw new Error(`Kein Board „${board}".`);
        const neu = { ...alt, name: name.trim().slice(0, 80) || alt.name };
        return { stand: { ...s, boards: s.boards.map((x) => (x.id === alt.id ? neu : x)) }, geaendert: new Set([alt.id]), wert: neu };
      });
      return text(`Umbenannt: [${b.id}] „${b.name}".`);
    } catch (e) { return fehler((e as Error).message); }
  });

  return server;
}

async function start() {
  const sp = speicherAusArgumenten(process.argv.slice(2), process.env);
  const server = serverBauen(sp);
  await server.connect(new StdioServerTransport());
  process.stderr.write(`PixiNotes-MCP ${VERSION} bereit – ${sp.name}\n`);
}

start().catch((e) => { process.stderr.write(`PixiNotes-MCP: ${(e as Error).message}\n`); process.exit(1); });
