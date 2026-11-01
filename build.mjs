// Assembles the single client artifact the Harness module loader accepts.
// Parts are plain browser JavaScript (no import/export, no JSX): they are placed
// inside the loader factory scope together with `React` and `h`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const parts = ['src/scene.js', 'src/hud.js', 'src/entry.js'];
const body = parts
  .map((p) => `// ==== ${p} ====\n${readFileSync(join(here, p), 'utf8')}`)
  .join('\n\n');

const out = `window.__ModuleLoader__.load({
  id: '@local/dsh-agent-ops',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
${body}
    return { inject, apply };
  },
});
`;

writeFileSync(join(here, 'client.js'), out, 'utf8');
console.log(`built client.js (${(Buffer.byteLength(out) / 1024).toFixed(1)} KiB)`);
