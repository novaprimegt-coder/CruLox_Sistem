
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 const modal=$('cru443Search'),head=$('searchInput'),input=$('cru443Input'),results=$('cru443Results'),count=$('cru443Count'),caption=$('cru443ResultsTitle'),all=$('cru443All');
 if(!modal||!head||!input||!results)return;
 const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const clean=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const normalizeQuery=s=>clean(s).replace(/\bspoty\b/g,'spotify').replace(/\byt\b/g,'youtube');
 const prevFiltered=typeof filteredProducts==='function'?filteredProducts:null;
 const distance=(a,b,limit=2)=>{
  if(Math.abs(a.length-b.length)>limit)return limit+1;
  let prev=Array.from({length:b.length+1},(_,j)=>j);
  for(let i=1;i<=a.length;i++){
    const row=[i];let min=i;
    for(let j=1;j<=b.length;j++){const n=Math.min(row[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));row.push(n);if(n<min)min=n}
    if(min>limit)return limit+1;prev=row;
  }return prev[b.length];
 };
 const score=(p,q)=>{
  const name=clean(p.name),category=clean(p.category),platform=clean(p.platform),description=clean(p.description),kind=clean(p.digitalType),terms=q.split(' ').filter(Boolean);
  if(!q)return p.featured?20:1;
  if(name===q)return 1000;
  let value=0;
  if(name.startsWith(q))value=Math.max(value,630);
  if(name.includes(q))value=Math.max(value,540);
  if(platform===q)value=Math.max(value,500);
  else if(platform.includes(q))value=Math.max(value,330);
  if(category.includes(q))value=Math.max(value,250);
  if(kind.includes(q))value=Math.max(value,225);
  if(description.includes(q))value=Math.max(value,115);
  let hits=0;
  const nameWords=name.split(' ').filter(Boolean);
  const platformWords=platform.split(' ').filter(Boolean);
  for(const word of terms){
    if(nameWords.some(t=>t===word)){value+=120;hits++;continue}
    if(nameWords.some(t=>t.startsWith(word)||word.startsWith(t)&&t.length>=3)){value+=82;hits++;continue}
    if(platformWords.some(t=>t===word||t.startsWith(word))){value+=68;hits++;continue}
    if(category.split(' ').includes(word)){value+=42;hits++;continue}
    if(word.length>=4&&[...nameWords,...platformWords].some(t=>distance(t,word,word.length>=7?2:1)<=(word.length>=7?2:1))){value+=64;hits++;continue}
    if(description.includes(word)){value+=13;hits++;continue}
  }
  if(hits===terms.length)value+=110;
  if(value===0)return 0;
  if(terms.length>1&&hits===0&&value<180)return 0;
  if(terms.length>1&&hits<terms.length&&value<190)return 0;
  return value;
 };
 function search(query,limit=60){
  const q=normalizeQuery(query);
  let products=[];try{products=(typeof state!=='undefined'&&Array.isArray(state.products))?state.products:[]}catch(_){}
  const found=products.map((p,i)=>({p,i,n:score(p,q)})).filter(x=>x.n>0).sort((a,b)=>b.n-a.n||a.i-b.i).slice(0,limit).map(x=>x.p);
  return found;
 }
 // Solo mejora los resultados cuando se confirma una búsqueda; sin cambiar el catálogo normal.
 if(prevFiltered){
  try{filteredProducts=function(){
   if(!String(state?.query||'').trim())return prevFiltered();
   const found=search(state.query,1000);
   return found.filter(p=>state.category==='all'||p.category===state.category);
  }}catch(_){}
 }
 let active=false,previousFocus=null,found=[],current=-1,suppressHeaderFocus=false;
 // En los resultados del buscador solamente, representar cada familia
 // de opciones con una tarjeta; utiliza los mismos grupos del catálogo.
 function compactSearchResults(items){
   const api=window.JM_DIGITAL_STORE_V21,seen=new Set(),out=[];
   for(const p of items){
     let key='',members=[];
     try{
       key=api?.variantGroupKey?.(p)||'';
       if(key)members=api?.groupMembersByKey?.(key)||[];
     }catch(_){key='';members=[]}
     if(key&&members.length>1){
       if(seen.has(key))continue;
       seen.add(key);
       const rep=members.find(x=>x.image)||members[0];
       const category=String(rep.category||'').trim(),platform=String(rep.platform||'').trim();
       const title=clean(category).includes('diamante')&&platform?`Diamantes ${platform}`:
         (platform&&category&&clean(platform)!==clean(category)?`${category} ${platform}`:
         (platform||category||String(rep.name||'Opciones digitales')));
       const prices=members.map(x=>Number(x.price)).filter(Number.isFinite);
       const minPrice=prices.length?Math.min(...prices):Number(rep.price||0);
       out.push({p:rep,key,title,minPrice,amount:members.length});
     }else out.push({p,key:'',title:String(p.name||'Producto digital')});
   }
   return out;
 }
 function display(){
   const q=input.value.trim(),items=search(q,1000);found=items;current=-1;
   const grouped=compactSearchResults(items),view=grouped.slice(0,12);
   caption.textContent=q?'Resultados de la búsqueda':'Descubre nuestros productos';
   count.textContent=q?(items.length===1000?'1000 o más coincidencias':`${grouped.length} coincidencia${grouped.length===1?'':'s'}`):'Catálogo CruLox';
   all.disabled=items.length===0;
   all.textContent=q?'Ver resultados':'Explorar catálogo';
   results.innerHTML=view.length?view.map(entry=>{
     const p=entry.p,grouped=!!entry.key;
     const img=p.image||'',rawPrice=grouped?entry.minPrice:Number(p.price||0);
     const price=typeof money==='function'?money(rawPrice):`Q${rawPrice.toFixed(2)}`;
     const label=entry.title;
     const meta=grouped?[p.platform,`${entry.amount} opciones`].filter(Boolean).join(' · '):
       [p.platform,p.category,p.duration].map(x=>String(x||'').trim()).filter(Boolean).filter((x,i,a)=>a.findIndex(y=>clean(y)===clean(x))===i).slice(0,2).join(' · ');
     const target=grouped?`data-cru443-family="${escapeHTML(entry.key)}"`:`data-cru443-id="${escapeHTML(p.id)}"`;
     return `<button type="button" class="cru443-result" ${target} aria-label="${grouped?'Ver opciones de':'Ver detalles de'} ${escapeHTML(label)}"><img src="${escapeHTML(img)}" loading="lazy" decoding="async" alt=""><span class="cru443-info"><b>${escapeHTML(label)}</b><small>${escapeHTML(meta||'Producto digital')}</small></span><strong class="cru443-price">${grouped?'Desde ':''}${escapeHTML(price)}</strong></button>`;
   }).join(''):`<div class="cru443-empty">${q?'No hay coincidencias. Prueba con otro nombre, categoría o palabra similar.':'Todavía no hay productos disponibles.'}</div>`;
 }
 function open(){
   if(active||document.querySelector('#cru435Welcome.cru435-open,#adminOverlay.open'))return;
   active=true;previousFocus=document.activeElement;
   input.value=head.value||'';
   modal.classList.add('cru443-open');modal.setAttribute('aria-hidden','false');document.body.classList.add('cru443-search-active');
   head.setAttribute('aria-expanded','true');display();
   try{input.focus({preventScroll:true});input.setSelectionRange(input.value.length,input.value.length)}catch(_){}
 }
 function close(){
   if(!active)return;
   active=false;modal.classList.remove('cru443-open');modal.setAttribute('aria-hidden','true');document.body.classList.remove('cru443-search-active');head.setAttribute('aria-expanded','false');
   head.value=input.value.trim();$('searchClear')?.classList.toggle('show',!!head.value);
   if(previousFocus instanceof HTMLElement&&previousFocus.isConnected){
     suppressHeaderFocus=true;previousFocus.focus({preventScroll:true});setTimeout(()=>{suppressHeaderFocus=false},0);
   }
 }
 function product(id){
   const selected=found.find(p=>String(p.id)===String(id));if(!selected)return;
   close();try{if(typeof openDetail==='function')openDetail(selected.id)}catch(e){console.warn('CruLox búsqueda: detalles',e)}
 }
 function family(key){
   const choose=window.JM_DIGITAL_STORE_V22?.openVariantChooser;
   if(typeof choose!=='function')return;
   close();try{choose(key)}catch(e){console.warn('CruLox búsqueda: opciones',e)}
 }
 function showAll(){
   if(!found.length)return;
   const q=input.value.trim();close();
   try{
     state.category='all';state.query=q;
     if(typeof renderCategories==='function')renderCategories();
     if(typeof renderProducts==='function')renderProducts();
     document.getElementById('catalog')?.scrollIntoView({behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches?'auto':'smooth',block:'start'});
   }catch(e){console.warn('CruLox búsqueda: catálogo',e)}
 }
 head.readOnly=true;
 head.setAttribute('aria-label','Abrir búsqueda de productos');head.setAttribute('aria-haspopup','dialog');head.setAttribute('aria-controls','cru443Search');
 head.onfocus=()=>{if(!suppressHeaderFocus)open()};head.onclick=open;head.oninput=null;head.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open()}};
 // El desplegable anterior se desactiva solamente en la barra de la tienda.
 if($('suggestions'))$('suggestions').classList.remove('open');
 input.addEventListener('input',()=>{head.value=input.value;$('searchClear')?.classList.toggle('show',!!input.value);display()});
 input.addEventListener('keydown',e=>{
   const buttons=Array.from(results.querySelectorAll('[data-cru443-id],[data-cru443-family]'));
   if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();current=(current+(e.key==='ArrowDown'?1:-1)+buttons.length)%Math.max(1,buttons.length);buttons.forEach((b,i)=>b.classList.toggle('cru443-selected',i===current));buttons[current]?.scrollIntoView({block:'nearest'});return}
   if(e.key==='Enter'){e.preventDefault();if(current>=0&&buttons[current])buttons[current].click();else showAll()}
 });
 results.addEventListener('click',e=>{const b=e.target.closest('[data-cru443-id],[data-cru443-family]');if(!b)return;if(b.dataset.cru443Family)family(b.dataset.cru443Family);else product(b.dataset.cru443Id)});
 $('cru443Close').onclick=close;all.onclick=showAll;
 modal.addEventListener('click',e=>{if(e.target===modal)close()});
 document.addEventListener('keydown',e=>{
   if(!active)return;
   if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();return}
   if(e.key==='Tab'){
     const focusables=[...modal.querySelectorAll('input,button:not([disabled])')].filter(x=>x.offsetParent!==null);
     if(!focusables.length)return;
     if(e.shiftKey&&document.activeElement===focusables[0]){e.preventDefault();focusables[focusables.length-1].focus()}
     else if(!e.shiftKey&&document.activeElement===focusables[focusables.length-1]){e.preventDefault();focusables[0].focus()}
   }
 },true);
 const clear=$('searchClear');if(clear)clear.onclick=e=>{
   e.preventDefault();head.value='';input.value='';state.query='';
   clear.classList.remove('show');
   if(typeof renderProducts==='function')renderProducts();
   if(active)display();else open();
 };
 window.CruLoxSearchV443={search,open,close};
})();
