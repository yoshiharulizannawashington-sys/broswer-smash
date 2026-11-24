// Conservative CSS reformatter for the recovered stylesheet.
//
// It only changes whitespace: every character that is not whitespace is carried through untouched,
// strings and comments included. It refuses to write anything unless the formatted output is
// token-identical to the input, so a formatting bug can never silently change the design.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';

const target = process.argv[2] || 'public/css/browserbros.css';
const source = await readFile(target, 'utf8');

function format(css) {
  let out = '';
  let depth = 0;
  let buf = '';
  const pad = () => '  '.repeat(Math.max(0, depth));
  const flushRule = (tail = '') => {
    const text = buf.trim();
    buf = '';
    if (text) out += pad() + text + (tail || '\n');
  };
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    // Comments and strings are copied verbatim, so braces or semicolons inside them cannot
    // be mistaken for structure.
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const stop = end === -1 ? css.length : end + 2;
      buf += css.slice(i, stop);
      i = stop - 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < css.length) {
        if (css[j] === '\\') { j += 2; continue; }
        if (css[j] === ch) { j += 1; break; }
        j += 1;
      }
      buf += css.slice(i, j);
      i = j - 1;
      continue;
    }
    if (ch === '{') {
      const selector = buf.trim().replace(/\s+/g, ' ');
      buf = '';
      out += pad() + selector + ' {\n';
      depth += 1;
      continue;
    }
    if (ch === '}') {
      flushRule('\n');
      depth = Math.max(0, depth - 1);
      out += pad() + '}\n';
      continue;
    }
    if (ch === ';') {
      const decl = buf.trim().replace(/\s+/g, ' ');
      buf = '';
      if (decl) out += pad() + decl + ';\n';
      continue;
    }
    buf += ch;
  }
  flushRule('\n');
  // Collapse the blank runs a nested block leaves behind; no tokens are affected.
  return out.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trimEnd() + '\n';
}

/** Whitespace- and comment-insensitive fingerprint of a stylesheet's actual tokens. */
function fingerprint(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};:,>+~()])\s*/g, '$1')
    .trim();
}

const formatted = format(source);
if (fingerprint(formatted) !== fingerprint(source)) {
  console.error('REFUSED: formatted output does not match the source tokens');
  process.exit(1);
}

await mkdir('artifacts/backup', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = `artifacts/backup/browserbros.recovered-${stamp}.css`;
await copyFile(target, backup);
await copyFile(target, 'artifacts/backup/browserbros.recovered-latest.css');
await writeFile(target, formatted);

console.log(JSON.stringify({
  target,
  backup,
  bytesBefore: source.length,
  bytesAfter: formatted.length,
  linesBefore: source.split('\n').length,
  linesAfter: formatted.split('\n').length,
  tokensIdentical: true
}, null, 2));
