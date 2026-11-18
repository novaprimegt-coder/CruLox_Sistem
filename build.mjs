import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Rebuild approved CruLox V4.5.2 as immutable baseline.
const parts=Array.from({length:18},(_,i)=>readFileSync(`source/${String(i).padStart(2,'0')}.bin`));
const source=Buffer.concat(parts);
const sha=buf=>createHash('sha256').update(buf).digest('hex');
if(sha(source)!=='339ae3ac66ddd4444d1ab3ccd437d41043f4b4e3d3a0ea91042da689824da2bc')throw Error('Baseline integrity failed');
let html=source.toString('utf8');
// Permit only the official Firebase SDK domain in the existing CSP.
const cspOld="script-src 'self' 'unsafe-inline' blob:;";
const cspNew="script-src 'self' 'unsafe-inline' blob: https://www.gstatic.com;";
if(html.split(cspOld).length!==2)throw Error('CSP baseline mismatch');
html=html.replace(cspOld,cspNew);
// Surgical replacement of existing scripts; all other scripts stay unchanged.
for(const [id,file] of [
 ['cruzclick-firebase-config-v420','firebase-config-4.5.4.js'],
 ['cruzclick-firebase-adapter-v420','firebase-adapter-4.5.6.js'],
 ['cru443-search-engine','search-engine-4.5.7.js']
]){
 const start=html.search(new RegExp(`<script\\b[^>]*\\bid="${id}"[^>]*>`));
 if(start<0)throw Error(`Missing ${id}`);
 const contentStart=html.indexOf('>',start)+1;
 const contentEnd=html.indexOf('</script>',contentStart);
 if(contentEnd<0)throw Error(`Unclosed ${id}`);
 html=html.slice(0,contentStart)+readFileSync(file,'utf8')+html.slice(contentEnd);
}
const stepperCss=readFileSync('checkout-stepper-4.5.8.css','utf8');
const stepperJs=readFileSync('checkout-stepper-4.5.8.js','utf8');
if(!html.includes('</body>')||html.includes('crx-checkout-stepper-v458'))throw Error('Checkout injection point mismatch');
html=html.replace('</body>', `<style id="crx-checkout-stepper-v458-style">\n${stepperCss}\n</style><script id="crx-checkout-stepper-v458">\n${stepperJs}\n</script>\n</body>`);
const output=Buffer.from(html,'utf8');
const expected='97bae6c4bb588e70cc53100d1788a555eaacbd2579a784b3d2647a82dcd6bf02';
if(sha(output)!==expected)throw Error(`Built HTML hash mismatch: ${sha(output)}`);
mkdirSync('dist',{recursive:true});
writeFileSync('dist/index.html',output);
console.log(`CruLox V4.5.8 generated, ${output.length} bytes, SHA-256 ${expected}`);
