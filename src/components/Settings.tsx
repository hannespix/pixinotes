import { useState } from 'react';
import { selectActiveBoard, useBoard } from '../store';
import { exportToFolder, exportViewport } from '../lib/exporter';

const MODELS: Record<string, string[]> = {
  anthropic: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'],
  openai: ['gpt-4o', 'gpt-4o-mini'],
  ollama: ['llama3.1', 'mistral', 'qwen2.5', 'phi3'],
  custom: [''],
  none: [],
};
const DEFAULT_BASE: Record<string, string> = {
  ollama: 'http://localhost:11434',
  custom: 'http://localhost:8080/v1',
};
const NEEDS_KEY = new Set(['anthropic', 'openai', 'custom']);
const NEEDS_URL = new Set(['ollama', 'custom']);

/**
 * Einstellungen: KI-Anbindung (eigener Key, lokal gespeichert) und
 * Datenordner/Export. Bewusst schlicht — läuft auch aus der Single-HTML.
 */
export function Settings() {
  const open = useBoard((s) => s.settingsOpen);
  const setOpen = useBoard((s) => s.setSettingsOpen);
  const ai = useBoard((s) => s.ai);
  const updateAi = useBoard((s) => s.updateAi);
  const spaces = useBoard((s) => s.spaces);
  const boards = useBoard((s) => s.boards);
  const activeBoard = useBoard(selectActiveBoard);
  const showToast = useBoard((s) => s.showToast);
  const [busy, setBusy] = useState('');

  if (!open) return null;

  const doExport = async (fn: () => Promise<unknown>, label: string) => {
    setBusy(label);
    try { await fn(); } catch (e) { showToast(`Abgebrochen: ${String((e as Error).message)}`); }
    setBusy('');
  };

  const hasFolderApi = 'showDirectoryPicker' in window;

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Einstellungen" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>⚙️ Einstellungen</h2>
          <button className="modal-x" onClick={() => setOpen(false)} aria-label="Schließen">✕</button>
        </div>

        {/* ---- KI ---- */}
        <section className="modal-section">
          <h3>🤖 KI-Assistent</h3>
          <p className="modal-hint">
            KI-Funktionen (Textpolitur, E-Mail-Zusammenfassung, Auto-Clustering) laufen über einen
            Anbieter deiner Wahl. Cloud-Dienste nutzen deinen eigenen Schlüssel; mit <b>Ollama</b> oder
            einem selbstgehosteten Server bleibt <b>alles auf deinem Rechner</b>. Zugangsdaten werden
            nur lokal in diesem Browser gespeichert.
          </p>
          <label className="modal-row">
            <span>Anbieter</span>
            <select value={ai.provider} onChange={(e) => {
              const provider = e.target.value as typeof ai.provider;
              updateAi({ provider, model: MODELS[provider]?.[0] ?? '', baseUrl: DEFAULT_BASE[provider] ?? '' });
            }}>
              <option value="none">— aus —</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai">OpenAI</option>
              <option value="ollama">Ollama (lokal, selbstgehostet)</option>
              <option value="custom">Eigener Server (OpenAI-kompatibel)</option>
            </select>
          </label>
          {ai.provider !== 'none' && (
            <>
              <label className="modal-row">
                <span>Modell</span>
                {ai.provider === 'custom' ? (
                  <input type="text" placeholder="modellname" value={ai.model}
                    onChange={(e) => updateAi({ model: e.target.value })} />
                ) : (
                  <select value={ai.model} onChange={(e) => updateAi({ model: e.target.value })}>
                    {MODELS[ai.provider].map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                )}
              </label>
              {NEEDS_URL.has(ai.provider) && (
                <label className="modal-row">
                  <span>Server-URL</span>
                  <input type="text" placeholder="http://localhost:11434" value={ai.baseUrl}
                    onChange={(e) => updateAi({ baseUrl: e.target.value })} />
                </label>
              )}
              {NEEDS_KEY.has(ai.provider) && (
                <label className="modal-row">
                  <span>API-Schlüssel{ai.provider === 'custom' ? ' (optional)' : ''}</span>
                  <input type="password" placeholder="sk-…" value={ai.apiKey}
                    onChange={(e) => updateAi({ apiKey: e.target.value })} />
                </label>
              )}
              <div className="modal-note">
                {ai.provider === 'ollama'
                  ? '🖥️ Ollama muss lokal laufen (ollama serve). Für den Browser-Zugriff ggf. OLLAMA_ORIGINS setzen. Kein Schlüssel, keine Cloud.'
                  : (NEEDS_KEY.has(ai.provider) && !ai.apiKey)
                    ? 'Ohne Schlüssel bleiben die KI-Aktionen ausgeblendet.'
                    : '✅ Konfiguriert — KI-Aktionen erscheinen auf den Karten.'}
              </div>
            </>
          )}
        </section>

        {/* ---- Datenordner & Export ---- */}
        <section className="modal-section">
          <h3>📁 Datenordner &amp; Export</h3>
          <p className="modal-hint">
            {hasFolderApi
              ? 'Speichere alle Boards als echte Markdown-Dateien in einem Ordner deiner Wahl (Struktur: Bereich / Projekt / Board.md) — z. B. in OneDrive, versionierbar und in Obsidian lesbar.'
              : 'Dieser Browser unterstützt keine direkte Ordner-Anbindung (Chrome/Edge empfohlen). Der Export lädt stattdessen die Markdown-Dateien einzeln herunter.'}
          </p>
          <div className="modal-buttons">
            <button disabled={!!busy} onClick={() => doExport(async () => {
              const r = await exportToFolder(spaces, boards);
              showToast(r === 'ok' ? '📁 In Ordner gespeichert' : '⬇️ Markdown-Dateien heruntergeladen');
            }, 'folder')}>
              {busy === 'folder' ? '…' : hasFolderApi ? '📂 Ordner wählen & speichern' : '⬇️ Als Markdown exportieren'}
            </button>
            <button disabled={!!busy} onClick={() => doExport(() => exportViewport('png', activeBoard.name), 'png')}>
              {busy === 'png' ? '…' : '🖼️ Aktuelles Board als PNG'}
            </button>
            <button disabled={!!busy} onClick={() => doExport(() => exportViewport('svg', activeBoard.name), 'svg')}>
              {busy === 'svg' ? '…' : '✏️ Aktuelles Board als SVG'}
            </button>
          </div>
          <div className="modal-note">💡 Für PDF: PNG/SVG exportieren und über „Drucken → Als PDF speichern" ablegen.</div>
        </section>

        <div className="modal-foot">PixiNotes · lokale Daten, kein Konto nötig</div>
      </div>
    </div>
  );
}
