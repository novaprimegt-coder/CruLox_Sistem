import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const parts=Array.from({length:18},(_,i)=>readFileSync(`source/${String(i).padStart(2,'0')}.bin`));
const source=Buffer.concat(parts);
const sha=buf=>createHash('sha256').update(buf).digest('hex');
if(sha(source)!=='339ae3ac66ddd4444d1ab3ccd437d41043f4b4e3d3a0ea91042da689824da2bc')throw Error('Baseline integrity failed');
let html=source.toString('utf8');
const cspOld="script-src 'self' 'unsafe-inline' blob:;";
const cspNew="script-src 'self' 'unsafe-inline' blob: https://www.gstatic.com;";
if(html.split(cspOld).length!==2)throw Error('CSP baseline mismatch');
html=html.replace(cspOld,cspNew);
for(const [id,file] of [
 ['cruzclick-firebase-config-v420','firebase-config-4.5.4.js'],
 ['cruzclick-firebase-adapter-v420','firebase-adapter-4.5.9.js'],
 ['cru443-search-engine','search-engine-4.5.7.js']
]){
 const start=html.search(new RegExp(`<script\\b[^>]*\\bid="${id}"[^>]*>`));
 if(start<0)throw Error(`Missing ${id}`);
 const contentStart=html.indexOf('>',start)+1;
 const contentEnd=html.indexOf('</script>',contentStart);
 if(contentEnd<0)throw Error(`Unclosed ${id}`);
 html=html.slice(0,contentStart)+readFileSync(file,'utf8')+html.slice(contentEnd);
}
const originalPayment="payment:{method:String($('jmv2PaymentMethod')?.value||'Coordinar por WhatsApp'),reference:String($('jmv2PaymentReference')?.value||'').trim().slice(0,80),status:'Pendiente',confirmedAt:null}";
const updatedPayment="payment:{method:String($('jmv2PaymentMethod')?.value||'Coordinar por WhatsApp'),reference:String($('jmv2PaymentReference')?.value||'').trim().slice(0,80),status:'Comprobante enviado',confirmedAt:null,receiptDataUrl:String(window.CruLoxCheckoutReceipt?.dataUrl||''),receiptName:String(window.CruLoxCheckoutReceipt?.fileName||'').slice(0,120),receiptUploadedAt:new Date().toISOString()}";
if(html.split(originalPayment).length!==2)throw Error('Original payment contract changed');
html=html.replace(originalPayment,updatedPayment);
const oldSave='state.orders.unshift(order);safeWrite(KEYS.orders,state.orders);';
const safeSave="state.orders.unshift(order);if(!safeWrite(KEYS.orders,state.orders)){state.orders.shift();restoreReservation(order,'storage-failed');throw new Error('No fue posible guardar el pedido y el comprobante en este dispositivo.');}";
if(html.split(oldSave).length!==2)throw Error('Original order storage contract changed');
html=html.replace(oldSave,safeSave);
const stepperCss=readFileSync('checkout-stepper-4.5.10.css','utf8');
const stepperJs=readFileSync('checkout-stepper-4.5.10.js','utf8');
if(!html.includes('</body>')||html.includes('crx-checkout-stepper-v4510'))throw Error('Checkout injection point mismatch');
html=html.replace('</body>', `<style id="crx-checkout-stepper-v4510-style">\n${stepperCss}\n</style><script id="crx-checkout-stepper-v4510">\n${stepperJs}\n</script>\n</body>`);
const output=Buffer.from(html,'utf8');
const expected='524431c6b6494f339fdd9ac7c689c7501a1cb3884724476717b72216fdbbe4aa';
if(sha(output)!==expected)throw Error(`Built HTML hash mismatch: ${sha(output)}`);
mkdirSync('dist',{recursive:true});
writeFileSync('dist/index.html',output);
console.log(`CruLox V4.5.10 generated, ${output.length} bytes, SHA-256 ${expected}`);
