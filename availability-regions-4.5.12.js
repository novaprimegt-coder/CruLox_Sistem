/* CruLox V4.5.12 — ubicación comercial por producto y cabecera lateral.
   No introduce países, restricciones comerciales ni cambios de pedidos. */
(()=>{
  'use strict';
  const D=document;
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  // Configuración controlada por CruLox. Agregar países solo cuando el propietario los indique.
  // Claves admitidas: identificador exacto o nombre exacto del producto.
  const COVERAGE_BY_PRODUCT=Object.freeze({});
  const countriesOf=product=>{
    const originalName=String(product?.name??'');
    const groupedName=originalName.replace(/^\s*\d+\s+/, '').trim();
    const configured=COVERAGE_BY_PRODUCT[String(product?.id??'')]??COVERAGE_BY_PRODUCT[originalName]??COVERAGE_BY_PRODUCT[groupedName]??[];
    const original=(Array.isArray(product?.availableCountries)&&product.availableCountries.length) ? product.availableCountries : configured;
    const raw=Array.isArray(original)?original:String(original||'').split(/[,;\n]+/);
    const out=[],seen=new Set();
    for(const item of raw){
      const name=String(item||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,65);
      const key=name.toLocaleLowerCase('es');
      if(name&&!seen.has(key)){seen.add(key);out.push(name);}
      if(out.length>=50)break;
    }
    return out;
  };
  const regionMarkup=(product,detail=false)=>{
    const countries=countriesOf(product);
    const icon='<span class="crx-region-globe" aria-hidden="true">◎</span>';
    if(!countries.length){
      return `<div class="crx-availability-locations${detail?' crx-region-detail':''}" aria-label="Países aún no configurados">${icon}<span class="crx-region-muted">Países por definir</span></div>`;
    }
    return `<div class="crx-availability-locations${detail?' crx-region-detail':''}">${icon}<span class="crx-region-label">Disponible en</span><span class="crx-region-countries">${countries.map(country=>`<span class="crx-region-chip">${escapeHtml(country)}</span>`).join('')}</span></div>`;
  };
  const oldProductCard=window.productCard;
  if(typeof oldProductCard==='function'){
    const withRegions=function(product){
      const card=String(oldProductCard.apply(this,arguments));
      const availability=/<span class="(?:jm-product-availability|jmv2-stock)\b[^>]*>[^<]*<\/span>/;
      return availability.test(card)
        ?card.replace(availability,part=>part+regionMarkup(product))
        :card.replace('<div class="product-actions">',regionMarkup(product)+'<div class="product-actions">');
    };
    window.productCard=withRegions;
    try{productCard=withRegions;}catch(_error){}
  }
  const oldOpenDetail=window.openDetail;
  if(typeof oldOpenDetail==='function'){
    const withDetail=function(id){
      const result=oldOpenDetail.apply(this,arguments);
      try{
        const product=state.products.find(item=>String(item.id)===String(id));
        const detail=D.querySelector('#detailBody .product-detail');
        const actions=detail?.querySelector('.form-actions');
        if(product&&actions&&!detail.querySelector('.crx-detail-regions')){
          const section=D.createElement('section');section.className='crx-detail-regions';
          section.innerHTML=`<h4>Disponibilidad por país</h4>${regionMarkup(product,true)}`;
          actions.parentElement.insertBefore(section,actions);
        }
      }catch(_error){}
      return result;
    };
    window.openDetail=withDetail;
    try{openDetail=withDetail;}catch(_error){}
  }
  // El buscador agrupa ciertas variantes con una tarjeta propia (no usa productCard).
  // Completar únicamente esos resultados, conservando su selector y su comportamiento.
  function decorateGroupedCards(){
    const grid=D.getElementById('productsGrid');
    if(!grid||typeof state==='undefined')return;
    for(const card of grid.querySelectorAll('.product[data-product]')){
      if(card.querySelector('.crx-availability-locations'))continue;
      const item=state.products.find(p=>String(p.id)===String(card.dataset.product));
      if(!item)continue;
      const wrap=D.createElement('div');
      wrap.innerHTML=regionMarkup(item);
      const node=wrap.firstElementChild;
      const anchor=card.querySelector('.jmv2-stock, .jm-product-availability, .stock');
      if(anchor)anchor.after(node);
      else card.querySelector('.product-actions')?.before(node);
    }
  }
  function enhanceDrawer(){
    const drawer=D.getElementById('drawer');
    const brand=drawer?.querySelector('.jmv24-drawer-head .jmv24-drawer-brand');
    if(!brand||brand.classList.contains('crx-brand-ready'))return;
    const image=brand.querySelector('img');
    if(!image)return;
    brand.classList.add('crx-brand-ready');
    brand.textContent='';
    const emblem=D.createElement('span');emblem.className='crx-brand-emblem';
    emblem.appendChild(image);
    const copy=D.createElement('span');copy.className='crx-brand-copy';
    const name=D.createElement('strong');name.textContent='CRULOX';
    const tagline=D.createElement('small');tagline.textContent='Plataformas Digitales';
    copy.append(name,tagline);
    brand.append(emblem,copy);
  }
  function init(){
    enhanceDrawer();
    const drawer=D.getElementById('drawer');
    if(drawer){
      new MutationObserver(()=>enhanceDrawer()).observe(drawer,{childList:true,subtree:true});
    }
    if(typeof renderProducts==='function')renderProducts();
    decorateGroupedCards();
    const grid=D.getElementById('productsGrid');
    if(grid)new MutationObserver(()=>decorateGroupedCards()).observe(grid,{childList:true,subtree:true});
  }
  if(D.readyState==='loading')D.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
