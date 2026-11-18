/* CRULOX 4.5.8 — Checkout de navegación estrictamente lineal.
   Se reutilizan los elementos y manejadores de pedido ya existentes. */
(() => {
  'use strict';
  const D = document;
  const MODAL_ID = 'checkoutModal';
  const PREFERENCE_PREFIX = 'crulox.checkout.choices.v1.';
  const totalSteps = 3;
  const labels = ['Datos de activación', 'Pago y entrega', 'Revisar pedido'];
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
  function paymentFieldsValid() {
    const payment=D.getElementById('jmv2PaymentMethod');
    if (!payment || !String(payment.value || '').trim() || /coordinar por whatsapp/i.test(payment.value)) {
      showError('Selecciona un método de pago disponible.',payment?.closest('.np-custom-select')?.querySelector('button')||payment);return false;
    }
    const channel=D.getElementById('jmv2DeliveryChannel');
    if (!channel || !String(channel.value || '').trim() || /whatsapp/i.test(channel.value)) {
      showError('Selecciona la entrega y seguimiento dentro de CruLox.',channel?.closest('.np-custom-select')?.querySelector('button')||channel);return false;
    }
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
    const channel=D.getElementById('jmv2DeliveryChannel')?.value||'';
    const notes=D.getElementById('coNotes')?.value.trim()||'';
    const total=D.getElementById('cartTotal')?.textContent?.trim() || formatMoney(list.reduce((n,it)=>n+(Number(it.price)||0)*(Number(it.qty)||1),0));
    root.querySelector('#crxReview').innerHTML=`
      <div class="crx-review-block"><span class="crx-eyebrow">TU COMPRA</span><h3>Revisa antes de confirmar</h3><p>Comprueba los servicios y sus datos de activación.</p><div class="crx-review-list">${entries}</div></div>
      <div class="crx-review-block"><span class="crx-eyebrow">PAGO Y ENTREGA</span><div class="crx-review-detail"><span>Método de pago</span><b>${escapeHtml(payment)}</b></div>${ref?`<div class="crx-review-detail"><span>Referencia</span><b>${escapeHtml(ref)}</b></div>`:''}<div class="crx-review-detail"><span>Entrega y seguimiento</span><b>${escapeHtml(channel)}</b></div></div>
      <div class="crx-review-total"><div><small>TOTAL DEL PEDIDO</small><strong>${escapeHtml(total)}</strong></div><span>Pago pendiente de confirmación</span></div>
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
    root.querySelector('#crxFooterHint').textContent=current===totalSteps?'Comprueba la información antes de finalizar.':'Completa este paso para continuar.';
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
          <section class="crx-pane" data-crx-pane="2" hidden aria-hidden="true"><div class="crx-pane-intro"><span class="crx-eyebrow">PASO 02</span><h3>Pago y entrega</h3><p>Selecciona cómo realizarás el pago. Tu pedido se gestionará dentro de CruLox.</p></div><div id="crxPaymentSlot"></div><div id="crxNotesSlot"></div></section>
          <section class="crx-pane" data-crx-pane="3" hidden aria-hidden="true"><div id="crxReview"></div></section>
        </div>
        <div class="crx-step-footer"><p id="crxStepError" role="alert" hidden></p><div class="crx-footer-controls"><button id="crxBack" type="button" hidden>${icons.back}<span>Anterior</span></button><button id="crxNext" type="button"><span>Continuar</span>${icons.arrow}</button><div id="crxSubmitSlot"></div></div><small id="crxFooterHint">Completa este paso para continuar.</small></div>`;
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
    const payment=fields.querySelector('.jmv2-payment-box');
    root.querySelector('#crxPaymentSlot .jmv2-payment-box')?.remove();
    if(payment)root.querySelector('#crxPaymentSlot').appendChild(payment);
    const title=modal.querySelector('.modal-head h2');if(title)title.textContent='Finaliza tu compra';
    const notice=modal.querySelector('.checkout-safe-notice');if(notice)notice.textContent='Tu compra, tus datos y el seguimiento del pedido, en un solo lugar.';
    const submit=root.querySelector('.crx-submit-actions button[type="submit"]');
    if(submit)submit.textContent='Confirmar y enviar pedido';
    current=1;submitBusy=false;
    root.querySelectorAll('[data-crx-pane]').forEach(p=>{p.hidden=p.dataset.crxPane!=='1';p.setAttribute('aria-hidden',p.hidden?'true':'false')});
    root.querySelectorAll('.crx-tile').forEach(el=>delete el.dataset.rendered);
    restorePreferences();clearError();updateIndicator();
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
