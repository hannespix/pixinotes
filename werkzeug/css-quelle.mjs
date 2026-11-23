// M475: Das Stylesheet liegt in Teildateien (src/styles/*.css), src/index.css bindet sie per @import ein.
// Prüfreihen, die Regeln im Quelltext suchen, lesen hierüber den ganzen Text – in der Reihenfolge der @imports,
// also genau so, wie Vite ihn zusammensetzt.
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Liste der Teildateien (relativ zum Repository) in der Reihenfolge der @import-Zeilen in src/index.css */
export function cssTeile(repo) {
  const index = readFileSync(path.join(repo, 'src/index.css'), 'utf8');
  return [...index.matchAll(/@import\s+['"]\.\/([^'"]+)['"]\s*;/g)].map((m) => `src/${m[1]}`);
}

/** Der ganze Stylesheet-Quelltext: alle Teildateien hintereinander */
export function cssQuelle(repo) {
  return cssTeile(repo).map((t) => readFileSync(path.join(repo, t), 'utf8')).join('\n');
}
