export function patchOrbit(html){
 const open='<script id="crulox-orbit-v431">',close='</script>';
 const begin=html.indexOf(open);
 if(begin<0||html.indexOf(open,begin+open.length)>=0)throw Error("No se encuentra una única órbita V4.3.1.");
 const end=html.indexOf(close,begin+open.length);
 if(end<0)throw Error("La órbita original no está cerrada.");
 const before=` function pickProducts(){
   const found=[],images=new Set();
   for(const p of allProducts()){
     if(!p||typeof p!=='object'||!p.id||!validImage(p.image))continue;
     const src=p.image.trim();
     if(images.has(src))continue;
     images.add(src);found.push({id:String(p.id),name:String(p.name||p.platform||'Producto CruLox'),src});
     if(found.length===8)break;
   }
   return found;
 }`;
 const after=` // Solo la órbita: cinco productos diferentes elegidos en cada entrada.
 const ORBIT_COUNT=5;
 const ORBIT_LAST_KEY='crulox.orbit.last-products.v1';
 function orbitShuffle(list){
   const result=list.slice();
   for(let i=result.length-1;i>0;i--){
     const j=Math.floor(Math.random()*(i+1));
     [result[i],result[j]]=[result[j],result[i]];
   }
   return result;
 }
 function pickProducts(){
   const found=[],ids=new Set();
   for(const p of allProducts()){
     if(!p||typeof p!=='object'||p.id==null||!validImage(p.image))continue;
     const id=String(p.id).trim(),src=p.image.trim();
     if(!id||ids.has(id))continue;
     ids.add(id);
     found.push({id,name:String(p.name||p.platform||'Producto CruLox'),src});
   }
   if(!found.length){st.promoIds=[];return []}
   const byId=new Map(found.map(p=>[p.id,p]));
   const count=Math.min(ORBIT_COUNT,found.length);
   if(!Array.isArray(st.promoIds)||st.promoIds.length!==count||st.promoIds.some(id=>!byId.has(id))){
     let last=[];
     try{
       const stored=JSON.parse(window.localStorage.getItem(ORBIT_LAST_KEY)||'[]');
       if(Array.isArray(stored))last=stored.filter(id=>typeof id==='string');
     }catch(_error){}
     // Procurar cinco imágenes diferentes; usar variantes solo si faltan imágenes únicas.
     const distinct=[],variants=[],images=new Set();
     for(const product of orbitShuffle(found)){
       if(images.has(product.src))variants.push(product);
       else{images.add(product.src);distinct.push(product)}
     }
     const chosen=distinct.concat(variants).slice(0,count);
     // Si hay más opciones, la nueva entrada no repite exactamente los mismos cinco IDs.
     if(found.length>count&&last.length&&chosen.every(p=>last.includes(p.id))){
       const alternatives=orbitShuffle(found.filter(p=>!chosen.some(x=>x.id===p.id)&&!last.includes(p.id)));
       const substitute=alternatives.find(p=>chosen.some(x=>x.src===p.src))||alternatives[0];
       if(substitute){
         const matchingImage=chosen.findIndex(p=>p.src===substitute.src);
         chosen[matchingImage>=0?matchingImage:count-1]=substitute;
       }
     }
     st.promoIds=chosen.map(p=>p.id);
     if(chosen.length===ORBIT_COUNT){
       try{window.localStorage.setItem(ORBIT_LAST_KEY,JSON.stringify(st.promoIds))}catch(_error){}
     }
   }
   return st.promoIds.map(id=>byId.get(id)).filter(Boolean);
 }`;
 const old=html.slice(begin,end);
 if(old.split(before).length!==2)throw Error("La lógica original de selección ha cambiado: NO se modifica.");
 const updated=old.replace(before,after);
 if(!updated.includes("const ORBIT_COUNT=5;"))throw Error("No se insertó la selección de cinco productos.");
 const output=html.slice(0,begin)+updated+html.slice(end);
 if(output.length-html.length!==after.length-before.length)throw Error("Cambio no localizado.");
 return output;
}
