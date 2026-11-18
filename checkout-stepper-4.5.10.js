/* CRULOX 4.5.8 — Checkout de navegación estrictamente lineal.
   Se reutilizan los elementos y manejadores de pedido ya existentes. */
(() => {
  'use strict';
  const D = document;
  const MODAL_ID = 'checkoutModal';
  const PREFERENCE_PREFIX = 'crulox.checkout.choices.v1.';
  const totalSteps = 3;
  const labels = ['Datos de activación', 'Pago', 'Revisar pedido'];
  // Cuentas previamente publicadas en la sección 'Mis pedidos' de CruLox.
  // Las entidades sin instrucciones verificadas NO reciben datos ficticios.
  const bankAccounts = Object.freeze({
    banrural:{title:'Banco Banrural',holder:'José Manuel Cruz López',account:'04913601079212',type:'Ahorro'},
    azteca:{title:'Banco Azteca',holder:'José Manuel Cruz López',account:'02910121720810',type:'Guardadito / Ahorro'}
  });
  const bankForMethod = method => {
    const n=norm(method);
    if(n.includes('banrural'))return bankAccounts.banrural;
    if(n.includes('azteca'))return bankAccounts.azteca;
    return null;
  };
  let receipt=null;
  const receiptCap=22*1024*1024; // límite operativo para evitar agotar la memoria del móvil
  const receiptMaxData=760000; // una compra local no puede sobrepasar la cuota de almacenamiento

  const icons = {
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5m6-6-6 6 6 6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>'
  };
  const spring = 'linear(0, 0.0603, 0.2033, 0.3821, 0.5633, 0.7258, 0.8584, 0.9574, 1.0242, 1.0634, 1.0809, 1.0828, 1.0747, 1.0613, 1.046, 1.0313, 1.0186, 1.0085, 1.0012, 0.9965, 0.994, 0.9931, 0.9933, 0.9941, 0.9953, 0.9966, 0.9978, 0.9988, 1)';
  const reduceMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const linear = () => !!window.CSS?.supports?.('transition-timing-function', 'linear(0, 1)');
  const ease = () => linear() ? spring : 'cubic-bezier(.34,1.4,.64,1)';
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
  const formatMoney = value => new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ', minimumFractionDigits: 2 }).format(Number(value) || 0);
  const currentClient = () => { try { return typeof window.currentUser === 'function' ? window.currentUser() : null; } catch { return null; } };
  const currentItems = () => { try { return typeof window.cartDetails === 'function' ? window.cartDetails() || [] : []; } catch { return []; } };
  const prefKey = () => { const user = currentClient(); return user ? PREFERENCE_PREFIX + encodeURIComponent(String(user.firebaseUid || user.id || user.email || '')) : ''; };
  const loadPrefs = () => {
    try {
      const key = prefKey();
      if (!key) return {};
      const value = JSON.parse(localStorage.getItem(key) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch { return {}; }
  };
  const safeField = label => !/contrase(?:ñ|n)a|password|pin\b|c[oó]digo de seguridad|cvc|cvv|tarjeta|cuenta bancaria|clave|token|secreto/i.test(label);
  const fieldKey = (input, index) => {
    const section = input.closest('[data-jmv2-checkout-item]');
    const line = currentItems()[index] || {};
    const title = section?.querySelector('.jmv2-order-service-head b')?.textContent || line.name || '';
    const meta = section?.querySelector('.jmv2-order-service-head span')?.textContent?.split('·') || [];
    const platform = norm(meta[1] || line.platform || title);
    const label = String(input.closest('.field')?.querySelector('label')?.textContent || '').replace(/\s*\*\s*$/, '').trim();
    return {key: `${platform}::${norm(label)}`,label};
  };

  let current = 1;
  let isReady = false;
  let submitBusy = false;
  let transitionId = 0;
  let observer;
  const getModal = () => D.getElementById(MODAL_ID);
  const getRoot = () => D.getElementById('crxCheckoutStepper');
  const getPane = number => getRoot()?.querySelector(`[data-crx-pane="${number}"]`);
  const getNote = () => getRoot()?.querySelector('#crxStepError');
  const clearError = () => { const n=getNote(); if(n){n.hidden=true;n.textContent='';} D.querySelectorAll('#crxCheckoutStepper .crx-invalid').forEach(el=>el.classList.remove('crx-invalid')); };
  const showError = (message, field) => {
    const n=getNote(); if(n){n.textContent=message;n.hidden=false;}
    if (field) {
      field.classList.add('crx-invalid');
      if (!field.closest('[hidden]')) field.focus?.({preventScroll: true});
      field.scrollIntoView?.({behavior:reduceMotion()?'instant':'smooth',block:'nearest'});
    }
  };
  function requiredFieldsValid() {
    const root=getRoot(); if(!root) return false;
    const required=[...root.querySelectorAll('[data-crx-pane="1"] input[required]')];
    for (const input of required) {
      const label = input.closest('.field')?.querySelector('label')?.textContent?.replace('*','').trim() || 'los datos solicitados';
      if (!String(input.value || '').trim()) {showError(`Completa ${label} para continuar.`,input);return false;}
      if (input.type==='email' && !input.validity.valid) {showError(`Revisa el correo indicado en ${label}.`,input);return false;}
    }
    return true;
  }
  const receiptStatus = (message,fail=false) => {
    const node=getRoot()?.querySelector('#crxReceiptStatus');
    if(node){node.textContent=message;node.dataset.error=fail?'true':'false';}
  };
  function releaseReceipt(){
    if(receipt?.blobUrl)URL.revokeObjectURL(receipt.blobUrl);
    receipt=null;
    window.CruLoxCheckoutReceipt=null;
  }
  function paymentDetails(){
    const method=D.getElementById('jmv2PaymentMethod')?.value||'';
    return bankForMethod(method);
  }
  function updatePaymentDetails(){
    const root=getRoot(),panel=root?.querySelector('#crxBankDetails');if(!panel)return;
    const method=D.getElementById('jmv2PaymentMethod')?.value||'';
    const bank=paymentDetails();
    if(bank){
      panel.dataset.available='true';
      panel.innerHTML=`<div class="crx-bank-top"><span class="crx-bank-monogram">▦</span><div><small>DATOS PARA TU PAGO</small><h4>${escapeHtml(bank.title)}</h4><p>Depósito o transferencia bancaria</p></div><span class="crx-bank-verified">Cuenta disponible</span></div>
        <div class="crx-bank-grid"><div class="crx-bank-field"><small>Nombre del titular</small><strong>${escapeHtml(bank.holder)}</strong></div><div class="crx-bank-field"><small>Tipo de cuenta</small><strong>${escapeHtml(bank.type)}</strong></div><div class="crx-bank-field crx-bank-number"><small>Número de cuenta</small><strong>${escapeHtml(bank.account)}</strong><button type="button" data-crx-copy="${escapeHtml(bank.account)}" aria-label="Copiar número de cuenta">Copiar número</button></div></div>
        <p class="crx-bank-tip">Realiza el pago por el total indicado y conserva el comprobante. CruLox verificará la operación antes de entregar el servicio.</p>`;
    }else{
      panel.dataset.available='false';
      panel.innerHTML=`<div class="crx-bank-unavailable"><strong>${escapeHtml(method||'Elige un método de pago')}</strong><p>${method?'Este método todavía no tiene datos oficiales de recepción configurados. No realices transferencias a cuentas no indicadas por CruLox.':'Selecciona un banco para ver los datos de depósito o transferencia.'}</p></div>`;
    }
    const proof=root.querySelector('#crxReceiptArea');if(proof)proof.hidden=!bank;
  }
  const fileToData = blob => new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(new Error('No se pudo preparar el comprobante.'));reader.readAsDataURL(blob);});
  const canvasBlob = (canvas,q) => new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',q));
  async function prepareReceipt(file){
    if(!(file instanceof File)||!file.size||file.size>receiptCap)throw new Error('Selecciona una imagen JPG, PNG o WebP de hasta 22 MB.');
    if(!/^image\/(jpeg|png|webp)$/i.test(file.type))throw new Error('El comprobante debe ser JPG, PNG o WebP.');
    const objectUrl=URL.createObjectURL(file);
    let image;
    try{
      image=new Image();image.decoding='async';image.src=objectUrl;await image.decode();
      const w=image.naturalWidth,h=image.naturalHeight;
      if(!w||!h)throw new Error('La imagen no se puede leer.');
      // La vista previa siempre conserva el archivo ORIGINAL, sin recortarlo.
      // La copia del pedido se optimiza para no saturar el almacenamiento local.
      let dataUrl='';let savedWidth=0,savedHeight=0;
      const orientations=[[2600,.90],[2400,.88],[2200,.86],[2048,.85],[1920,.83],[1800,.82],[1600,.8],[1440,.78]];
      for(const [maxDim,quality] of orientations){
        const ratio=Math.min(1,maxDim/Math.max(w,h));
        const width=Math.max(1,Math.round(w*ratio)),height=Math.max(1,Math.round(h*ratio));
        const canvas=D.createElement('canvas');canvas.width=width;canvas.height=height;
        const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw new Error('No se puede procesar la imagen.');
        ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.imageSmoothingQuality='high';ctx.drawImage(image,0,0,width,height);
        const blob=await canvasBlob(canvas,quality);if(!blob)continue;
        if(blob.size*4/3 > receiptMaxData)continue;
        dataUrl=await fileToData(blob);if(dataUrl.length<=receiptMaxData){savedWidth=width;savedHeight=height;break;}
      }
      if(!dataUrl)throw new Error('La foto es demasiado grande para guardarla con calidad legible. Usa una imagen más ligera.');
      return {blobUrl:objectUrl,dataUrl,fileName:file.name.slice(0,120),originalWidth:w,originalHeight:h,savedWidth,savedHeight,size:file.size};
    }catch(error){URL.revokeObjectURL(objectUrl);throw error;}
  }
  async function receiveReceipt(file){
    receiptStatus('Verificando imagen y preparando comprobante…');
    try{
      const processed=await prepareReceipt(file);
      releaseReceipt();receipt=processed;
      window.CruLoxCheckoutReceipt={dataUrl:receipt.dataUrl,fileName:receipt.fileName};
      const img=getRoot()?.querySelector('#crxReceiptPreviewImage');
      if(img){img.src=receipt.blobUrl;img.alt='Comprobante seleccionado';}
      const meta=getRoot()?.querySelector('#crxReceiptPreviewMeta');
      if(meta)meta.textContent=`${receipt.originalWidth} × ${receipt.originalHeight} px · ${receipt.fileName}`;
      const frame=getRoot()?.querySelector('#crxReceiptPreview');if(frame)frame.hidden=false;
      const placeholder=getRoot()?.querySelector('#crxUploadPlaceholder');if(placeholder)placeholder.hidden=true;
      receiptStatus('Comprobante listo. Podrás revisarlo antes de confirmar tu pedido.');
      clearError();
    }catch(error){receiptStatus(error?.message||'No se pudo preparar el comprobante.',true);}
  }
  function hideRedundantPaymentFields(){
    const pane=getRoot()?.querySelector('#crxPaymentSlot .jmv2-payment-box');
    if(!pane)return;
    // El canal sigue existiendo para registrar pedidos; solo se retira el selector redundante.
    const delivery=D.getElementById('jmv2DeliveryChannel');
    if(delivery){
      const internal=[...delivery.options].find(option=>norm(option.value)==='plataforma crulox');
      if(internal && norm(delivery.value)!=='plataforma crulox')delivery.value=internal.value;
      const field=delivery.closest('.field');
      if(field){field.hidden=true;field.setAttribute('aria-hidden','true');field.style.setProperty('display','none','important');}
    }
    // El plazo ya pertenece a la ficha del producto.
    for(const field of pane.querySelectorAll('.field')){
      const label=norm(field.querySelector('label')?.textContent);
      if(label==='tiempo estimado'){
        field.hidden=true;field.setAttribute('aria-hidden','true');field.style.setProperty('display','none','important');
      }
    }
  }
  function initializePaymentArea(){
    const root=getRoot(),panel=root?.querySelector('#crxPaymentSlot');if(!panel||panel.querySelector('#crxBankDetails'))return;
    // Mantener el selector y sus manejadores originales del sistema.
    const info=D.createElement('section');info.className='crx-payment-showcase';
    info.innerHTML=`<div class="crx-payment-intro"><span class="crx-pay-icon">↗</span><div><small>PAGO VERIFICABLE</small><h4>Elige cómo pagar</h4><p>Selecciona tu banco y consulta los datos oficiales antes de transferir.</p></div></div><div id="crxBankDetails" class="crx-bank-details" aria-live="polite"></div>
    <div id="crxReceiptArea" class="crx-receipt-area" hidden><div class="crx-proof-heading"><span class="crx-proof-icon">▧</span><div><strong>Adjunta tu comprobante</strong><p>Obligatorio para avanzar. La fotografía se previsualiza completa y sin recortes.</p></div></div>
      <label class="crx-upload-target" for="crxReceiptInput" id="crxUploadTarget"><input id="crxReceiptInput" class="np-media-input" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Seleccionar fotografía de comprobante"/><span id="crxUploadPlaceholder"><span class="crx-upload-mark">＋</span><b>Seleccionar fotografía</b><small>JPG, PNG o WebP · Máximo 22 MB</small></span><span id="crxReceiptPreview" class="crx-receipt-preview" hidden><img id="crxReceiptPreviewImage" alt="Comprobante elegido"/><span id="crxReceiptPreviewMeta"></span><b>Toca para cambiar la foto</b></span></label>
      <button id="crxViewReceipt" class="crx-view-receipt" type="button">Ver foto completa y ampliar</button>
      <p id="crxReceiptStatus" class="crx-receipt-status" role="status" aria-live="polite"></p>
      <p class="crx-receipt-legal">Subir el comprobante no confirma el pago: el equipo revisará su validez antes de la entrega.</p>
    </div></section>`;
    panel.appendChild(info);
    const select=D.getElementById('jmv2PaymentMethod');
    select?.addEventListener('change',updatePaymentDetails);
    info.addEventListener('click',event=>{
      const copy=event.target.closest('[data-crx-copy]');
      if(copy){if(navigator.clipboard?.writeText){navigator.clipboard.writeText(copy.dataset.crxCopy).then(()=>{const orig=copy.textContent;copy.textContent='Copiado';setTimeout(()=>{copy.textContent=orig},1400)}).catch(()=>{copy.textContent='Selecciona el número para copiar';});}else{copy.textContent='Selecciona el número para copiar';}}
      if(event.target.closest('#crxViewReceipt')){
        if(!receipt?.blobUrl)return receiptStatus('Selecciona primero una fotografía.');
        openReceiptViewer(receipt.blobUrl);
      }
    });
    info.querySelector('#crxReceiptInput')?.addEventListener('change',event=>{const file=event.target.files?.[0];if(file)receiveReceipt(file);});
    updatePaymentDetails();
  }
  function openReceiptViewer(url){
    let viewer=D.getElementById('crxImageViewer');
    if(!viewer){viewer=D.createElement('div');viewer.id='crxImageViewer';viewer.className='crx-image-viewer';viewer.setAttribute('role','dialog');viewer.setAttribute('aria-modal','true');viewer.setAttribute('aria-label','Comprobante completo');viewer.hidden=true;
      viewer.innerHTML='<div class="crx-viewer-bar"><strong>Comprobante original · Vista completa</strong><button id="crxCloseImageViewer" type="button">Cerrar</button></div><div class="crx-viewer-canvas"><img alt="Comprobante original sin recortes"/></div>';
      D.body.appendChild(viewer);
      viewer.querySelector('#crxCloseImageViewer').onclick=()=>{viewer.hidden=true;};
      viewer.addEventListener('click',event=>{if(event.target===viewer)viewer.hidden=true;});
    }
    viewer.querySelector('img').src=url;viewer.hidden=false;viewer.querySelector('button')?.focus();
  }
  function paymentFieldsValid() {
    const payment=D.getElementById('jmv2PaymentMethod');
    if (!payment || !String(payment.value || '').trim() || /coordinar por whatsapp/i.test(payment.value)) {
      showError('Selecciona un método de pago disponible.',payment?.closest('.np-custom-select')?.querySelector('button')||payment);return false;
    }
    const channel=D.getElementById('jmv2DeliveryChannel');
    if (!channel || !String(channel.value || '').trim() || /whatsapp/i.test(channel.value)) {
      showError('Selecciona la entrega y seguimiento dentro de CruLox.',channel?.closest('.np-custom-select')?.querySelector('button')||channel);return false;
    }
    if(!paymentDetails()){
      showError('Este método de pago aún no tiene datos de recepción configurados. Elige uno de los bancos disponibles.',D.getElementById('jmv2PaymentMethod'));return false;
    }
    if(!receipt?.dataUrl){showError('Para continuar, sube una foto legible del comprobante de pago.',getRoot()?.querySelector('#crxUploadTarget'));return false;}
    return true;
  }
  function validate(number) {
    clearError();
    if (number === 1) return requiredFieldsValid();
    if (number === 2) return paymentFieldsValid();
    return false;
  }
  function collectAndStorePreferences() {
    const key=prefKey(); if (!key) return;
    const old=loadPrefs(); const choices={...(old.choices && typeof old.choices === 'object' ? old.choices : {})};
    D.querySelectorAll('#crxCheckoutStepper [data-jmv2-req]').forEach(input=>{
      const m=/^(\d+):\d+$/.exec(input.dataset.jmv2Req||'');
      if(!m)return;
      const f=fieldKey(input,Number(m[1]));
      if(!f.label || !safeField(f.label))return;
      const value=String(input.value||'').trim().slice(0,240);
      if(value)choices[f.key]=value;
    });
    const entries=Object.entries(choices).slice(-80);
    const payment=String(D.getElementById('jmv2PaymentMethod')?.value||'');
    const data={version:1,choices:Object.fromEntries(entries),method:payment.slice(0,100),savedAt:new Date().toISOString()};
    try {localStorage.setItem(key,JSON.stringify(data));} catch { /* storage unavailable; purchase continues */ }
  }
  function restorePreferences(){
    const prefs=loadPrefs();
    const choices=prefs.choices && typeof prefs.choices==='object' ? prefs.choices : {};
    D.querySelectorAll('#crxCheckoutStepper [data-jmv2-req]').forEach(input=>{
      if(String(input.value||'').trim())return; // preserve per-item prefill, including player ID
      const m=/^(\d+):\d+$/.exec(input.dataset.jmv2Req||''); if(!m)return;
      const f=fieldKey(input,Number(m[1]));
      if(safeField(f.label)&&typeof choices[f.key]==='string'&&choices[f.key].length<=240)input.value=choices[f.key];
    });
    const select=D.getElementById('jmv2PaymentMethod');
    if(select && typeof prefs.method==='string' && [...select.options].some(o=>o.value===prefs.method)){
      select.value=prefs.method;
      select.dispatchEvent(new Event('change',{bubbles:true}));
    }
    // Después de retirar las opciones externas en versiones anteriores,
    // repintar el selector personalizado para que no muestre un texto obsoleto.
    [D.getElementById('jmv2PaymentMethod'),D.getElementById('jmv2DeliveryChannel')].forEach(el=>{
      if(el){try{el.dispatchEvent(new Event('change',{bubbles:true}));}catch{}}
    });
  }
  function updateReview() {
    const root=getRoot(); if (!root) return;
    const list=currentItems();
    const entries=list.map((item,index)=>{
      const section=D.querySelector(`[data-jmv2-checkout-item="${index}"]`);
      const data=[...(section?.querySelectorAll('[data-jmv2-req]')||[])].map(input=>{
        const label=input.closest('.field')?.querySelector('label')?.textContent?.replace('*','').trim()||'Dato';
        const value=String(input.value||'').trim();
        return value?`<div class="crx-review-detail"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`:'';
      }).filter(Boolean).join('');
      return `<article class="crx-review-item"><div class="crx-review-line"><div><strong>${escapeHtml(item.name||'Servicio digital')}</strong><small>Cantidad: ${Number(item.qty)||1}</small></div><b>${formatMoney((Number(item.price)||0)*(Number(item.qty)||1))}</b></div>${data?`<div class="crx-review-data">${data}</div>`:''}</article>`;
    }).join('');
    const user=currentClient();
    const payment=D.getElementById('jmv2PaymentMethod')?.value || '';
    const ref=D.getElementById('jmv2PaymentReference')?.value.trim()||'';
    const notes=D.getElementById('coNotes')?.value.trim()||'';
    const total=D.getElementById('cartTotal')?.textContent?.trim() || formatMoney(list.reduce((n,it)=>n+(Number(it.price)||0)*(Number(it.qty)||1),0));
    root.querySelector('#crxReview').innerHTML=`
      <div class="crx-review-block"><span class="crx-eyebrow">TU COMPRA</span><h3>Revisa antes de confirmar</h3><p>Comprueba los servicios y sus datos de activación.</p><div class="crx-review-list">${entries}</div></div>
      <div class="crx-review-block"><span class="crx-eyebrow">PAGO</span><div class="crx-review-detail"><span>Método de pago</span><b>${escapeHtml(payment)}</b></div>${ref?`<div class="crx-review-detail"><span>Referencia</span><b>${escapeHtml(ref)}</b></div>`:''}</div>
      <div class="crx-review-proof"><div><span class="crx-eyebrow">COMPROBANTE ADJUNTO</span><strong>Fotografía lista para verificación</strong><p>${escapeHtml(receipt?.fileName||'Sin fotografía')}</p></div>${receipt?.blobUrl?`<img src="${receipt.blobUrl}" alt="Vista previa del comprobante"/>`:''}</div>
      <div class="crx-review-total"><div><small>TOTAL DEL PEDIDO</small><strong>${escapeHtml(total)}</strong></div><span>En espera de verificación de pago</span></div>
      ${notes?`<div class="crx-review-note"><small>Observaciones</small><p>${escapeHtml(notes)}</p></div>`:''}
      <p class="crx-review-foot">El pedido se registrará a nombre de ${escapeHtml(user?.fullName||'tu cuenta')} y podrás consultar su estado dentro de CruLox.</p>`;
  }
  function updateIndicator(){
    const root=getRoot(); if(!root)return;
    root.querySelector('#crxCurrentStep').textContent=String(current);
    root.querySelector('#crxProgressFill').style.width=`${((current-1)/(totalSteps-1))*100}%`;
    root.querySelectorAll('[data-crx-indicator]').forEach((marker,index)=>{
      const number=index+1,status=number<current?'complete':number===current?'active':'upcoming';
      marker.dataset.status=status;
      marker.setAttribute('aria-current',number===current?'step':'false');
      const tile=marker.querySelector('.crx-tile');
      if(tile?.dataset.rendered!==status){tile.dataset.rendered=status;tile.innerHTML=status==='complete'?icons.check:String(number)}
    });
    root.querySelector('#crxBack').hidden=current===1;
    root.querySelector('#crxNext').hidden=current===totalSteps;
    root.querySelector('#crxSubmitSlot').hidden=current!==totalSteps;
    const original=root.querySelector('.crx-submit-actions'); if(original)original.hidden=current!==totalSteps;
    root.querySelector('#crxFooterHint').textContent=current===totalSteps?'Comprueba la información antes de finalizar.':'Revisa la información y continúa en orden.';
    const glider=root.querySelector('.crx-glider');
    const track=root.querySelector('.crx-track');
    const marker=track?.querySelectorAll('[data-crx-indicator]')[current-1];
    if(glider&&marker){
      const rect=marker.getBoundingClientRect(),trackRect=track.getBoundingClientRect();
      glider.style.width=`${rect.width}px`;
      glider.style.height=`${rect.height}px`;
      glider.style.transform=`translate3d(${Math.round(rect.left-trackRect.left)}px,${Math.round(rect.top-trackRect.top)}px,0)`;
    }
  }
  function changeStep(target){
    if(!Number.isInteger(target)||target<1||target>totalSteps||Math.abs(target-current)>1)return false;
    if(target===current)return true;
    if(target>current){if(!validate(current))return false;collectAndStorePreferences();}
    const prev=current;
    const from=getPane(prev),to=getPane(target),viewport=getRoot()?.querySelector('.crx-viewport');
    if(!to||!viewport)return false;
    if(target===3)updateReview();
    const fromH=from?.offsetHeight||0;
    current=target;
    ++transitionId;
    getRoot()?.querySelectorAll('[data-crx-pane]').forEach(p=>{p.hidden=p!==to;p.setAttribute('aria-hidden',p===to?'false':'true')});
    updateIndicator();
    const checkoutTitle=getModal()?.querySelector('.modal-head h2');
    if(checkoutTitle)checkoutTitle.textContent='Finaliza tu compra';
    const checkoutNotice=getModal()?.querySelector('.checkout-safe-notice');
    if(checkoutNotice)checkoutNotice.textContent='Tu compra, tus datos y el seguimiento del pedido, en un solo lugar.';
    getModal()?.querySelector('.modal')?.scrollTo({top:0,behavior:reduceMotion()?'instant':'smooth'});
    if(!reduceMotion() && typeof to.animate==='function'){
      const direction=target>prev?1:-1;
      to.animate([{opacity:0,transform:`translateX(${direction*34}px)`},{opacity:1,transform:'translateX(0)'}],{duration:530,easing:ease()});
      const toH=to.offsetHeight;
      if(fromH>0&&Math.abs(toH-fromH)>2&&viewport.animate){
        viewport.animate([{minHeight:`${fromH}px`},{minHeight:`${toH}px`}],{duration:560,easing:ease()});
      }
    }
    return true;
  }
  function install(){
    const modal=getModal(),form=D.getElementById('checkoutForm'),fields=D.getElementById('checkoutFields');
    if(!modal?.classList.contains('open')||!form||!fields)return;
    let root=getRoot();
    const notes=D.getElementById('coNotes')?.closest('.field');
    if(!root){
      root=D.createElement('div');root.id='crxCheckoutStepper';root.className='crx-stepper';
      root.innerHTML=`
        <div class="crx-track-wrap"><div class="crx-progress-label"><span>COMPRA SEGURA</span><strong>Paso <span id="crxCurrentStep">1</span> de 3</strong></div>
          <div class="crx-track" role="list" aria-label="Progreso de compra"><span class="crx-glider" aria-hidden="true"></span>
            ${labels.map((l,i)=>`<div role="listitem" class="crx-segment" data-crx-indicator="${i+1}" data-status="${i?'upcoming':'active'}" aria-current="${i?'false':'step'}"><span class="crx-tile" aria-hidden="true">${i+1}</span><span class="crx-step-title">${escapeHtml(l)}</span></div>`).join('')}
          </div><div class="crx-progress"><span id="crxProgressFill"></span></div></div>
        <div class="crx-viewport" aria-live="polite"><section class="crx-pane" data-crx-pane="1" aria-hidden="false"><div class="crx-pane-intro"><span class="crx-eyebrow">PASO 01</span><h3>Datos de activación</h3><p>Revisa tu cuenta e indica los datos necesarios para cada servicio.</p></div><div id="crxServiceSlot"></div></section>
          <section class="crx-pane" data-crx-pane="2" hidden aria-hidden="true"><div class="crx-pane-intro"><span class="crx-eyebrow">PASO 02</span><h3>Pago</h3><p>Consulta la cuenta oficial, realiza el pago y adjunta la fotografía de tu comprobante.</p></div><div id="crxPaymentSlot"></div><div id="crxNotesSlot"></div></section>
          <section class="crx-pane" data-crx-pane="3" hidden aria-hidden="true"><div id="crxReview"></div></section>
        </div>
        <div class="crx-step-footer"><p id="crxStepError" role="alert" hidden></p><div class="crx-footer-controls"><button id="crxBack" type="button" hidden>${icons.back}<span>Anterior</span></button><button id="crxNext" type="button"><span>Continuar pedido</span>${icons.arrow}</button><div id="crxSubmitSlot"></div></div><small id="crxFooterHint">Revisa la información y continúa en orden.</small></div>`;
      form.appendChild(root);
      root.querySelector('#crxServiceSlot').appendChild(fields);
      if(notes)root.querySelector('#crxNotesSlot').appendChild(notes);
      const action=form.querySelector(':scope > .form-actions');
      if(action){action.classList.add('crx-submit-actions');root.querySelector('#crxSubmitSlot').appendChild(action)}
      root.querySelector('#crxBack').addEventListener('click',()=>changeStep(current-1));
      root.querySelector('#crxNext').addEventListener('click',()=>changeStep(current+1));
      root.addEventListener('input',()=>clearError());
      root.addEventListener('change',()=>clearError());
      const formListener=e=>{
        if(!getModal()?.classList.contains('open'))return;
        if(current!==3){e.preventDefault();e.stopImmediatePropagation();showError('Debes completar los tres pasos en orden antes de confirmar.');return;}
        if(!requiredFieldsValid()){e.preventDefault();e.stopImmediatePropagation();changeStep(2);changeStep(1);showError('Revisa los datos de activación del primer paso.');return;}
        if(!paymentFieldsValid()){e.preventDefault();e.stopImmediatePropagation();changeStep(2);showError('Revisa el método de pago y entrega del segundo paso.');return;}
        if(submitBusy){e.preventDefault();e.stopImmediatePropagation();return;}
        collectAndStorePreferences();submitBusy=true;
        setTimeout(()=>{submitBusy=false;},1400);
      };
      form.addEventListener('submit',formListener,true);
      if(typeof ResizeObserver==='function'){
        observer=new ResizeObserver(()=>updateIndicator());observer.observe(root);
      }
    }
    const summary=fields.querySelector('.jmv2-checkout-summary');
    if(summary&&!summary.dataset.crxStyled){
      summary.dataset.crxStyled='1';
      const user=currentClient(),items=currentItems();
      summary.innerHTML=`<div class="crx-order-badge"><span class="crx-order-badge-icon">✓</span><span>PROCESO PROTEGIDO</span></div><h3>Continuar pedido</h3><p>${escapeHtml(user?.fullName||'Tu cuenta')} · ${items.length} ${items.length===1?'servicio':'servicios'} digitales</p>`;
    }
    fields.querySelectorAll('.jmv2-order-service').forEach((block,index)=>{
      if(block.dataset.crxStyled)return;block.dataset.crxStyled='1';
      const head=block.querySelector('.jmv2-order-service-head');if(head){const badge=D.createElement('span');badge.className='crx-item-badge';badge.textContent=String(index+1).padStart(2,'0');head.insertBefore(badge,head.firstChild);}
    });
    const payment=fields.querySelector('.jmv2-payment-box');
    root.querySelector('#crxPaymentSlot .jmv2-payment-box')?.remove();
    if(payment)root.querySelector('#crxPaymentSlot').appendChild(payment);
    hideRedundantPaymentFields();
    const title=modal.querySelector('.modal-head h2');if(title)title.textContent='Finaliza tu compra';
    const notice=modal.querySelector('.checkout-safe-notice');if(notice)notice.textContent='Tu compra, tus datos y el seguimiento del pedido, en un solo lugar.';
    const submit=root.querySelector('.crx-submit-actions button[type="submit"]');
    if(submit)submit.textContent='Confirmar y enviar pedido';
    current=1;submitBusy=false;
    root.querySelectorAll('[data-crx-pane]').forEach(p=>{p.hidden=p.dataset.crxPane!=='1';p.setAttribute('aria-hidden',p.hidden?'true':'false')});
    root.querySelectorAll('.crx-tile').forEach(el=>delete el.dataset.rendered);
    initializePaymentArea();releaseReceipt();
    const inp=root.querySelector('#crxReceiptInput');if(inp)inp.value='';
    const proof=root.querySelector('#crxReceiptPreview');if(proof)proof.hidden=true;
    const placeholder=root.querySelector('#crxUploadPlaceholder');if(placeholder)placeholder.hidden=false;
    receiptStatus('');
    restorePreferences();updatePaymentDetails();clearError();updateIndicator();
    requestAnimationFrame(()=>updateIndicator());
    isReady=true;form.classList.add('crx-ready');
  }
  function init(){
    const previous=window.openCheckout;
    if(typeof previous!=='function'||window.__CRX_STEPPER_INSTALLED__)return;
    window.__CRX_STEPPER_INSTALLED__=true;
    window.openCheckout=function(...args){
      const r=previous.apply(this,args);
      const form=D.getElementById('checkoutForm');if(form)form.classList.remove('crx-ready');
      // La versión anterior configura las opciones de pago y rellenos poco después de abrir.
      setTimeout(install,70);
      return r;
    };
    try{openCheckout=window.openCheckout}catch{}
    const trigger=D.getElementById('checkoutBtn');if(trigger)trigger.onclick=window.openCheckout;
    window.CruLoxCheckoutStepper={getStep:()=>current,getReady:()=>isReady,next:()=>changeStep(current+1),back:()=>changeStep(current-1)};
  }
  if(D.readyState==='loading')D.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
