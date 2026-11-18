import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Rebuild the approved, byte-identical CruLox V4.5.2 HTML.
const parts = Array.from({ length: 18 }, (_, i) => readFileSync(`source/${String(i).padStart(2, '0')}.bin`));
const html = Buffer.concat(parts);
const digest = createHash('sha256').update(html).digest('hex');
const expected = '339ae3ac66ddd4444d1ab3ccd437d41043f4b4e3d3a0ea91042da689824da2bc';
if (digest !== expected) throw new Error(`Source integrity failed: ${digest}`);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
console.log(`CruLox V4.5.2 generated, ${html.length} bytes, SHA-256 ${digest}`);
