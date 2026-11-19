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

// CruLox V4.5.11: suspender temporalmente PayPal sin alterar pedidos históricos.
for(const [before,after,required] of [["const methods=String(state.settings.paymentMethods||'').split(',').map(x=>x.trim()).filter(Boolean);","const methods=String(state.settings.paymentMethods||'').split(',').map(x=>x.trim()).filter(m=>m&&!/^paypal$/i.test(m));",1],["Banrural, Industrial, Azteca, PayPal, Remesas","Banrural, Industrial, Azteca, Remesas",6],["Banrural · Industrial · Azteca · PayPal · Remesas","Banrural · Industrial · Azteca · Remesas",1],["Banrural · BI · Azteca · PayPal · Remesas","Banrural · BI · Azteca · Remesas",1],["Banrural, Banco Industrial, Banco Azteca, PayPal y remesas.","Banrural, Banco Industrial, Banco Azteca y remesas.",1],["'Métodos de pago','5'","'Métodos de pago','4'",1],["<div class=\"faq-a\">${esc(f.a)}</div>","<div class=\"faq-a\">${esc(/m[eé]todos de pago/i.test(f.q)?String(f.a).replace(/,\\s*PayPal(?=\\s+y\\b)/gi,'').replace(/\\bPayPal\\b\\s*,?\\s*/gi,''):f.a)}</div>",1]]){
  const found=html.split(before).length-1;
  if(found!==required)throw Error('Payment availability baseline mismatch: '+before.slice(0,80));
  html=html.split(before).join(after);
}
const baseline11='9bce448e834a20b84d4982745b32eb07bb0a7fe6974b40290411b9b7b8e5bf8b';
if(sha(Buffer.from(html,'utf8'))!==baseline11)throw Error('Stable V4.5.11 checksum mismatch');

// CruLox V4.5.12: etiquetas de países sin inventar ubicaciones y cabecera visual del menú.
const regionCss=readFileSync('availability-regions-4.5.12.css','utf8');
const regionJs=readFileSync('availability-regions-4.5.12.js','utf8');
if(html.split('</body>').length!==2||html.includes('crx-country-4512-script'))throw Error('Country module injection mismatch');
html=html.replace('</body>', `<style id="crx-country-4512-style">\n${regionCss}</style>\n<script id="crx-country-4512-script">\n${regionJs}</script>\n</body>`);
const output=Buffer.from(html,'utf8');
const expected='dcb920eb039c3fac74042364a8b3eb7f0728dffeab3fedd8fe64d8d35dbaceb5';
if(sha(output)!==expected)throw Error(`Built HTML hash mismatch: ${sha(output)}`);
mkdirSync('dist',{recursive:true});
writeFileSync('dist/index.html',output);
console.log(`CruLox V4.5.13 generated, ${output.length} bytes, SHA-256 ${expected}`);
