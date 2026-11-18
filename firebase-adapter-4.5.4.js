
const ROLE = "store";
const SDK_VERSION = "12.19.0";
const CONFIG = window.CRUZCLICK_FIREBASE_CONFIG || {};
const COLLECTIONS = window.CRUZCLICK_FIREBASE_COLLECTIONS || {};
const ADMIN_EMAIL = String(window.CRUZCLICK_FIREBASE_ADMIN_EMAIL || '').trim().toLowerCase();
const runtime = () => window.CruzClickRuntime || null;

const LOCAL_KEYS = Object.freeze({
  products:'jm_digital_v1_products',
  combos:'jm_digital_v1_bundles',
  faqs:'jm_digital_v1_faqs',
  settings:'jm_digital_v1_settings',
  users:'jm_digital_v1_users',
  orders:'jm_digital_v1_orders',
  session:'jm_digital_v1_session',
  activity:'jm_digital_v1_activity'
});

let sdk = null;
let app = null;
let auth = null;
let db = null;
let storage = null;
let ready = false;
let starting = null;
let suppressLocalWrites = false;
let currentFirebaseUser = null;
const pendingTimers = new Map();
const unsubscribers = [];

function dispatchStatus(status, detail={}){
  window.dispatchEvent(new CustomEvent('cruzclick:firebase-status',{detail:{status,role:ROLE,...detail}}));
}

function configured(){
  const required=['apiKey','authDomain','projectId','storageBucket','messagingSenderId','appId'];
  return required.every(k=>typeof CONFIG[k]==='string' && CONFIG[k].trim().length>4);
}

function clone(value){
  try{ return structuredClone(value); }catch(e){
    try{ return JSON.parse(JSON.stringify(value)); }catch(_){ return value; }
  }
}

function clean(value){
  if(Array.isArray(value)) return value.map(clean);
  if(value && typeof value==='object'){
    const out={};
    for(const [k,v] of Object.entries(value)){
      if(v===undefined) continue;
      out[k]=clean(v);
    }
    return out;
  }
  return value;
}

function safeId(value,fallback='item'){
  return String(value||fallback).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,160) || fallback;
}

async function loadSdk(){
  if(sdk) return sdk;
  const base=`https://www.gstatic.com/firebasejs/${SDK_VERSION}`;
  const [appMod,authMod,firestoreMod,storageMod] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
    import(`${base}/firebase-storage.js`)
  ]);
  sdk={...appMod,...authMod,...firestoreMod,...storageMod};
  return sdk;
}

function localSet(key,value){
  suppressLocalWrites=true;
  try{
    localStorage.setItem(key,JSON.stringify(value));
    const rt=runtime();
    const st=rt?.getState?.();
    if(st){
      if(key===LOCAL_KEYS.products) st.products=clone(value);
      else if(key===LOCAL_KEYS.users) st.users=clone(value);
      else if(key===LOCAL_KEYS.orders) st.orders=clone(value);
      else if(key===LOCAL_KEYS.settings) st.settings={...(st.settings||{}),...clone(value)};
      else if(key===LOCAL_KEYS.faqs) st.faqs=clone(value);
      else if(key===LOCAL_KEYS.combos) st.combos=clone(value);
      else if(key===LOCAL_KEYS.activity) st.activity=clone(value);
      else if(key===LOCAL_KEYS.session) st.session=clone(value);
    }
  }finally{
    suppressLocalWrites=false;
  }
  window.dispatchEvent(new CustomEvent('cruzclick:firebase-sync',{detail:{key,role:ROLE}}));
}

function rerenderAfterRemote(){
  const rt=runtime();
  if(!rt) return;
  try{ rt.renderHeader?.(); }catch(e){}
  if(ROLE==='store'){
    try{ rt.renderStore?.(); }catch(e){}
    try{ rt.renderAccount?.(); }catch(e){}
  }
}

async function dataUrlToStorageUrl(dataUrl,path){
  if(!storage || typeof dataUrl!=='string' || !dataUrl.startsWith('data:')) return dataUrl;
  const response=await fetch(dataUrl);
  const blob=await response.blob();
  const objectRef=sdk.ref(storage,path);
  await sdk.uploadBytes(objectRef,blob,{contentType:blob.type||'application/octet-stream'});
  return sdk.getDownloadURL(objectRef);
}

async function cloudSafeProduct(product){
  const p=clean(clone(product||{}));
  const id=safeId(p.id,'product');
  const fields=['image','image2'];
  for(const f of fields){
    if(typeof p[f]==='string' && p[f].startsWith('data:image/')){
      try{ p[f]=await dataUrlToStorageUrl(p[f],`products/${id}/${f}_${Date.now()}`); }catch(e){
        console.warn('Firebase product media upload',e);
        delete p[f];
      }
    }
  }
  if(Array.isArray(p.images)){
    const next=[];
    for(let i=0;i<p.images.length;i++){
      const img=p.images[i];
      if(typeof img==='string' && img.startsWith('data:image/')){
        try{ next.push(await dataUrlToStorageUrl(img,`products/${id}/gallery_${i}_${Date.now()}`)); }
        catch(e){ console.warn('Firebase gallery upload',e); }
      }else if(img) next.push(img);
    }
    p.images=next;
  }
  return p;
}

async function cloudSafeOrder(order){
  const o=clean(clone(order||{}));
  const id=safeId(o.id,'order');
  const receipt=o?.payment?.receiptDataUrl;
  if(typeof receipt==='string' && receipt.startsWith('data:image/')){
    try{
      const url=await dataUrlToStorageUrl(receipt,`receipts/${id}/${Date.now()}_${safeId(o?.payment?.receiptName||'receipt')}`);
      o.payment=o.payment||{};
      o.payment.receiptUrl=url;
      delete o.payment.receiptDataUrl;
    }catch(e){
      console.warn('Firebase receipt upload',e);
      if(o.payment) delete o.payment.receiptDataUrl;
    }
  }
  return o;
}

async function cloudSafeItem(collectionName,item){
  if(collectionName===COLLECTIONS.products) return cloudSafeProduct(item);
  if(collectionName===COLLECTIONS.orders) return cloudSafeOrder(item);
  return clean(clone(item));
}

async function syncArrayCollection(collectionName,array,{allowDelete=false,filter=null}={}){
  if(!ready || !db || !Array.isArray(array)) return false;
  let list=array;
  if(typeof filter==='function') list=array.filter(filter);

  const ids=new Set();
  for(const raw of list){
    const id=safeId(raw?.id || raw?.uid || crypto.randomUUID());
    ids.add(id);
    const payload=await cloudSafeItem(collectionName,{...raw,id});
    payload.updatedAtFirebase=sdk.serverTimestamp();
    await sdk.setDoc(sdk.doc(db,collectionName,id),payload,{merge:true});
  }

  if(allowDelete){
    const snap=await sdk.getDocs(sdk.collection(db,collectionName));
    for(const d of snap.docs){
      if(!ids.has(d.id)) await sdk.deleteDoc(d.ref);
    }
  }
  return true;
}

async function syncSettingsDoc(docId,value){
  if(!ready || !db) return false;
  await sdk.setDoc(
    sdk.doc(db,COLLECTIONS.settings,docId),
    {...clean(clone(value)),updatedAtFirebase:sdk.serverTimestamp()},
    {merge:true}
  );
  return true;
}

// Profile fields permitted by the Firestore rules. Never upload local password hashes,
// password salts, session tokens or administrative fields.
const PROFILE_FIELDS=Object.freeze(['fullName','username','phone','department','municipality','address','reference']);
function firebaseSafeProfile(user,uid,email){
  const out={id:uid,firebaseUid:uid,email:String(email||'').trim()};
  for(const key of PROFILE_FIELDS) out[key]=String(user?.[key]||'').trim();
  if(user?.createdAt) out.createdAt=user.createdAt;
  if(user?.updatedAt) out.updatedAt=user.updatedAt;
  return out;
}

function existingLocalAccount(identity){
  const st=runtime()?.getState?.();
  const key=String(identity||'').trim().toLowerCase();
  return Array.isArray(st?.users)?st.users.find(u=>
    String(u?.email||'').trim().toLowerCase()===key ||
    String(u?.username||'').trim().toLowerCase()===key
  ):null;
}

async function verifyLocalAccount(user,password){
  if(!user || !password) return false;
  if(typeof npVerifyUserPassword==='function'){
    return !!(await npVerifyUserPassword(user,password));
  }
  // Unknown password algorithm: fail closed instead of claiming the account.
  return false;
}

function currentLocalUser(){
  const st=runtime()?.getState?.();
  const uid=currentFirebaseUser?.uid;
  if(!st || !uid || !Array.isArray(st.users)) return null;
  return st.users.find(u=>u.id===uid || u.firebaseUid===uid || String(u.email||'').toLowerCase()===String(currentFirebaseUser.email||'').toLowerCase())||null;
}

async function syncKey(key,value){
  if(!ready || suppressLocalWrites) return false;

  if(ROLE==='panel'){
    if(key===LOCAL_KEYS.products) return syncArrayCollection(COLLECTIONS.products,value,{allowDelete:true});
    if(key===LOCAL_KEYS.orders) return syncArrayCollection(COLLECTIONS.orders,value,{allowDelete:true});
    if(key===LOCAL_KEYS.users) return syncArrayCollection(COLLECTIONS.users,value,{allowDelete:false});
    if(key===LOCAL_KEYS.settings) return syncSettingsDoc('store',value);
    if(key===LOCAL_KEYS.faqs) return syncSettingsDoc('faqs',{items:value});
    if(key===LOCAL_KEYS.combos) return syncSettingsDoc('combos',{items:value});
    if(key===LOCAL_KEYS.activity) return syncSettingsDoc('activityMirror',{items:Array.isArray(value)?value.slice(-300):[]});
    return false;
  }

  /* Tienda: nunca escribe catálogo/configuración. Solo cliente y sus pedidos. */
  if(ROLE==='store'){
    if(!currentFirebaseUser) return false;
    if(key===LOCAL_KEYS.users){
      const user=(Array.isArray(value)?value:[]).find(u=>u.id===currentFirebaseUser.uid || String(u.email||'').toLowerCase()===String(currentFirebaseUser.email||'').toLowerCase());
      if(!user) return false;
      return sdk.setDoc(sdk.doc(db,COLLECTIONS.users,currentFirebaseUser.uid),{...firebaseSafeProfile(user,currentFirebaseUser.uid,currentFirebaseUser.email),updatedAtFirebase:sdk.serverTimestamp()},{merge:true});
    }
    if(key===LOCAL_KEYS.orders){
      const uid=currentFirebaseUser.uid;
      return syncArrayCollection(COLLECTIONS.orders,value,{
        allowDelete:false,
        filter:o=>String(o?.userId||o?.firebaseUid||o?.customer?.userId||'')===uid || String(o?.customer?.email||'').toLowerCase()===String(currentFirebaseUser.email||'').toLowerCase()
      });
    }
  }
  return false;
}

function queueLocalWrite(key,value){
  if(!ready || suppressLocalWrites) return false;
  const k=String(key||'');
  clearTimeout(pendingTimers.get(k));
  const snapshot=clone(value);
  pendingTimers.set(k,setTimeout(()=>{
    pendingTimers.delete(k);
    syncKey(k,snapshot).catch(err=>console.warn('Firebase local sync',k,err));
  },650));
  return true;
}

function subscribeCollection(collectionName,localKey){
  const unsub=sdk.onSnapshot(
    sdk.collection(db,collectionName),
    snap=>{
      const rows=snap.docs.map(d=>({id:d.id,...d.data()}));
      localSet(localKey,rows);
      rerenderAfterRemote();
    },
    err=>console.warn('Firebase snapshot',collectionName,err)
  );
  unsubscribers.push(unsub);
}

function subscribeDoc(collectionName,docId,localKey,transform=v=>v){
  const unsub=sdk.onSnapshot(
    sdk.doc(db,collectionName,docId),
    snap=>{
      if(!snap.exists()) return;
      localSet(localKey,transform(snap.data()));
      rerenderAfterRemote();
    },
    err=>console.warn('Firebase document snapshot',docId,err)
  );
  unsubscribers.push(unsub);
}

function startRemoteListeners(){
  subscribeCollection(COLLECTIONS.products,LOCAL_KEYS.products);
  subscribeDoc(COLLECTIONS.settings,'store',LOCAL_KEYS.settings);
  subscribeDoc(COLLECTIONS.settings,'faqs',LOCAL_KEYS.faqs,d=>Array.isArray(d?.items)?d.items:[]);
  subscribeDoc(COLLECTIONS.settings,'combos',LOCAL_KEYS.combos,d=>Array.isArray(d?.items)?d.items:[]);

  if(ROLE==='panel'){
    subscribeCollection(COLLECTIONS.orders,LOCAL_KEYS.orders);
    subscribeCollection(COLLECTIONS.users,LOCAL_KEYS.users);
  }
}

async function loadCurrentFirebaseUserIntoLocal(user){
  if(!user || !db) return;
  const ref=sdk.doc(db,COLLECTIONS.users,user.uid);
  const snap=await sdk.getDoc(ref);
  const data=snap.exists()?snap.data():{};
  const existing=existingLocalAccount(user.email);
  const profile={
    id:user.uid,
    firebaseUid:user.uid,
    fullName:data.fullName||existing?.fullName||user.displayName||data.username||'Cliente',
    username:data.username||existing?.username||String(user.email||'cliente').split('@')[0],
    email:user.email||data.email||'',
    phone:data.phone||existing?.phone||'',
    department:data.department||existing?.department||'',
    municipality:data.municipality||existing?.municipality||'',
    address:data.address||existing?.address||'',
    reference:data.reference||existing?.reference||'',
    createdAt:data.createdAt||existing?.createdAt||new Date().toISOString(),
    updatedAt:new Date().toISOString()
  };
  const st=runtime()?.getState?.();
  if(st){
    const list=Array.isArray(st.users)?st.users.slice():[];
    const index=list.findIndex(u=>u.id===user.uid || String(u.email||'').toLowerCase()===String(profile.email||'').toLowerCase());
    if(index>=0) list[index]={...list[index],...profile};
    else list.unshift(profile);
    localSet(LOCAL_KEYS.users,list);
    st.session={role:'client',userId:user.uid,firebaseUid:user.uid,persistent:true,createdAt:new Date().toISOString()};
    localSet(LOCAL_KEYS.session,st.session);
  }
  await sdk.setDoc(ref,{...profile,updatedAtFirebase:sdk.serverTimestamp()},{merge:true});
  rerenderAfterRemote();
}

function installStoreAuthBridge(){
  if(ROLE!=='store') return;

  document.addEventListener('submit',async event=>{
    const form=event.target;
    if(!form || (form.id!=='loginForm' && form.id!=='registerForm')) return;
    if(!configured()) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    try{
      await initialize();
      if(form.id==='loginForm'){
        const identity=String(document.getElementById('loginIdentity')?.value||'').trim();
        const password=String(document.getElementById('loginPassword')?.value||'');
        if(!identity || !password) throw new Error('Escribe correo y contraseña.');
        const local=existingLocalAccount(identity);
        const email=local?.email || identity;
        let cred;
        try{
          cred=await sdk.signInWithEmailAndPassword(auth,email,password);
        }catch(signInError){
          // Explicitly prove possession of the legacy local password before
          // migrating the local account (never import a local password hash).
          const eligible=local && await verifyLocalAccount(local,password);
          if(!eligible || !['auth/invalid-credential','auth/user-not-found'].includes(signInError?.code)) throw signInError;
          try{ cred=await sdk.createUserWithEmailAndPassword(auth,email,password); }
          catch(createError){
            if(createError?.code==='auth/email-already-in-use') throw new Error('Este correo ya tiene una cuenta Firebase. Usa la contraseña de Firebase para acceder.');
            throw createError;
          }
          const profile=firebaseSafeProfile(local,cred.user.uid,cred.user.email);
          await sdk.setDoc(sdk.doc(db,COLLECTIONS.users,cred.user.uid),{...profile,updatedAtFirebase:sdk.serverTimestamp()},{merge:true});
        }
        await loadCurrentFirebaseUserIntoLocal(cred.user);
        runtime()?.closeAccount?.();
        runtime()?.toast?.('Cuenta conectada a Firebase.','success');
      }else{
        const email=String(document.getElementById('regEmail')?.value||'').trim();
        const password=String(document.getElementById('regPassword')?.value||'');
        const confirm=String(document.getElementById('regConfirm')?.value||'');
        if(!email || !password) throw new Error('Correo y contraseña son obligatorios.');
        if(password!==confirm) throw new Error('Las contraseñas no coinciden.');
        if(password.length<10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) throw new Error('Usa al menos 10 caracteres, una letra y un número.');
        if(!document.getElementById('regConsent')?.checked) throw new Error('Debes aceptar el uso de tus datos para registrar tu cuenta.');
        const source={};
        for(const key of PROFILE_FIELDS){
          const id='reg'+key.charAt(0).toUpperCase()+key.slice(1);
          source[key]=String(document.getElementById(id)?.value||'').trim();
        }
        if(!source.fullName || !source.username || !source.phone) throw new Error('Completa los campos obligatorios.');
        const cred=await sdk.createUserWithEmailAndPassword(auth,email,password);
        const stamp=new Date().toISOString();
        const profile=firebaseSafeProfile({...source,createdAt:stamp,updatedAt:stamp},cred.user.uid,cred.user.email);
        await sdk.setDoc(sdk.doc(db,COLLECTIONS.users,cred.user.uid),{...profile,updatedAtFirebase:sdk.serverTimestamp()},{merge:true});
        await loadCurrentFirebaseUserIntoLocal(cred.user);
        runtime()?.closeAccount?.();
        runtime()?.toast?.('Cuenta creada y conectada a Firebase.','success');
      }
    }catch(err){
      console.error('CRULOX Firebase auth',err);
      runtime()?.toast?.(err?.message||'No fue posible autenticar con Firebase.','error');
    }
  },true);

  document.addEventListener('click',event=>{
    const logout=event.target?.closest?.('#logoutClient');
    if(!logout || !configured()) return;
    sdk?.signOut?.(auth).catch(()=>{});
  },true);
}

function installExistingAccountMigration(){
  if(ROLE!=='store' || !configured()) return;
  const area=document.getElementById('accountBody');
  if(!area) return;
  const refresh=()=>{
    const st=runtime()?.getState?.();
    const local=st?.session?.role==='client' && Array.isArray(st?.users)
      ?st.users.find(u=>u.id===st.session.userId):null;
    const old=area.querySelector('#cruFirebaseLink');
    if(!local || local.firebaseUid || currentFirebaseUser){old?.remove();return;}
    if(!area.querySelector('.profile-card') || old) return;
    const host=document.createElement('div');
    host.id='cruFirebaseLink';
    host.style.cssText='margin-top:14px;padding:14px;border:1px solid rgba(0,217,255,.32);border-radius:16px;background:#0b2433;color:#d6f4ff';
    host.innerHTML='<b style="font-size:.87rem">Conecta tu cuenta a Firebase</b><p style="font-size:.75rem;margin:8px 0 12px;color:#aec8d7">Tu registro de este dispositivo todavía es local. Confirma tu contraseña para sincronizar tu cuenta; no perderás tus datos locales.</p><form id="cruFirebaseLinkForm"><label for="cruFirebaseLinkPassword" style="display:block;font-size:.72rem;margin-bottom:6px">Contraseña de tu cuenta</label><input id="cruFirebaseLinkPassword" type="password" autocomplete="current-password" required minlength="8" style="width:100%;padding:12px;background:#061625;border:1px solid #3b6b81;border-radius:12px;color:white"><button class="btn btn-primary btn-block" style="margin-top:10px" type="submit">Vincular con Firebase</button><p id="cruFirebaseLinkMessage" role="status" style="font-size:.72rem;margin-top:8px"></p></form>';
    area.appendChild(host);
  };
  const observer=new MutationObserver(()=>refresh());
  observer.observe(area,{childList:true});
  refresh();
  document.addEventListener('submit',async event=>{
    if(event.target?.id!=='cruFirebaseLinkForm') return;
    event.preventDefault();event.stopImmediatePropagation();
    const form=event.target,button=form.querySelector('button');
    const status=document.getElementById('cruFirebaseLinkMessage');
    const st=runtime()?.getState?.();
    const local=st?.session?.role==='client'?st.users?.find(u=>u.id===st.session.userId):null;
    const password=form.querySelector('#cruFirebaseLinkPassword')?.value||'';
    button.disabled=true;
    try{
      if(!local || !local.email || !await verifyLocalAccount(local,password)) throw new Error('Contraseña incorrecta o cuenta local no encontrada.');
      await initialize();
      let cred;
      try{ cred=await sdk.createUserWithEmailAndPassword(auth,local.email,password); }
      catch(e){
        if(e?.code!=='auth/email-already-in-use') throw e;
        // If the email is already registered, Firebase itself checks the password.
        cred=await sdk.signInWithEmailAndPassword(auth,local.email,password);
      }
      const ref=sdk.doc(db,COLLECTIONS.users,cred.user.uid);
      const snap=await sdk.getDoc(ref);
      if(!snap.exists()){
        const profile=firebaseSafeProfile(local,cred.user.uid,cred.user.email);
        await sdk.setDoc(ref,{...profile,updatedAtFirebase:sdk.serverTimestamp()},{merge:true});
      }
      await loadCurrentFirebaseUserIntoLocal(cred.user);
      if(status) status.textContent='Cuenta vinculada con Firebase.';
      runtime()?.toast?.('Cuenta sincronizada con Firebase.','success');
    }catch(e){
      console.warn('CRULOX account link',e?.code||e?.message);
      if(status) status.textContent=e?.message||'No fue posible vincular esta cuenta.';
    }finally{button.disabled=false;form.querySelector('#cruFirebaseLinkPassword').value='';refresh();}
  },true);
}

function installPanelAuthBridge(){
  if(ROLE!=='panel') return;

  document.addEventListener('submit',async event=>{
    const form=event.target;
    if(!form || form.id!=='loginForm' || !configured()) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const email=String(document.getElementById('loginIdentity')?.value||'').trim().toLowerCase();
    const password=String(document.getElementById('loginPassword')?.value||'');

    if(email!==ADMIN_EMAIL){
      runtime()?.toast?.('Este archivo admite únicamente la cuenta administradora autorizada.','error');
      return;
    }

    try{
      await initialize();
      const cred=await sdk.signInWithEmailAndPassword(auth,email,password);
      if(String(cred.user.email||'').toLowerCase()!==ADMIN_EMAIL) throw new Error('Cuenta administrativa no autorizada.');

      const st=runtime()?.getState?.();
      if(st){
        st.session={
          role:'admin',
          email:ADMIN_EMAIL,
          firebaseUid:cred.user.uid,
          ownerAuthVersion:'cruzclick-owner-v3718',
          persistent:true,
          firebaseAuth:true,
          createdAt:new Date().toISOString()
        };
        runtime()?.write?.(LOCAL_KEYS.session,st.session);
      }

      try{ if(typeof closeModal==='function') closeModal('accountModal'); }catch(e){}
      setTimeout(()=>{
        try{
          if(window.CRUZCLICK_V3718?.openAdmin) window.CRUZCLICK_V3718.openAdmin('home');
          else if(typeof window.openAdmin==='function') window.openAdmin('home');
        }catch(e){ console.error(e); }
      },50);

      runtime()?.toast?.('Panel conectado con Firebase Authentication.','success');
    }catch(err){
      console.error('CRULOX Firebase admin auth',err);
      runtime()?.toast?.('Credenciales administrativas no válidas en Firebase.','error');
    }
  },true);

  document.addEventListener('click',event=>{
    const logout=event.target?.closest?.('#cc378Logout,#adminLogout');
    if(!logout || !configured()) return;
    sdk?.signOut?.(auth).catch(()=>{});
  },true);
}

async function initialize(){
  if(ready) return api;
  if(starting) return starting;

  starting=(async()=>{
    if(!configured()){
      dispatchStatus('not-configured',{message:'Pega la configuración Web de Firebase para activar la conexión.'});
      return api;
    }

    dispatchStatus('connecting');
    await loadSdk();

    app=sdk.initializeApp(CONFIG);
    auth=sdk.getAuth(app);
    db=sdk.getFirestore(app);
    storage=sdk.getStorage(app);

    try{
      await sdk.enableIndexedDbPersistence(db);
    }catch(e){
      /* Puede fallar con varias pestañas o navegadores que no lo soportan. */
      console.info('Firebase offline persistence not enabled:',e?.code||e?.message||e);
    }

    sdk.onAuthStateChanged(auth,async user=>{
      currentFirebaseUser=user||null;

      if(ROLE==='panel' && user && String(user.email||'').toLowerCase()!==ADMIN_EMAIL){
        await sdk.signOut(auth);
        currentFirebaseUser=null;
        dispatchStatus('unauthorized');
        return;
      }

      if(ROLE==='store' && user){
        try{ await loadCurrentFirebaseUserIntoLocal(user); }catch(e){ console.warn(e); }
      }

      dispatchStatus(user?'authenticated':'anonymous',{uid:user?.uid||null,email:user?.email||null});
    });

    ready=true;
    startRemoteListeners();
    dispatchStatus('ready',{projectId:CONFIG.projectId});
    return api;
  })().catch(err=>{
    starting=null;
    ready=false;
    console.error('CRULOX Firebase initialization',err);
    dispatchStatus('error',{message:err?.message||String(err)});
    throw err;
  });

  return starting;
}

async function pushLocalSnapshot(){
  if(ROLE!=='panel') throw new Error('La migración local → Firebase solo está disponible desde el Panel.');
  await initialize();
  const st=runtime()?.getState?.();
  if(!st) throw new Error('No se pudo leer el estado local.');
  await syncArrayCollection(COLLECTIONS.products,st.products||[],{allowDelete:false});
  await syncArrayCollection(COLLECTIONS.orders,st.orders||[],{allowDelete:false});
  await syncArrayCollection(COLLECTIONS.users,st.users||[],{allowDelete:false});
  await syncSettingsDoc('store',st.settings||{});
  await syncSettingsDoc('faqs',{items:st.faqs||[]});
  await syncSettingsDoc('combos',{items:st.combos||[]});
  dispatchStatus('migration-complete');
  return true;
}

async function uploadReceipt(file,orderId){
  await initialize();
  if(!file) throw new Error('Archivo requerido.');
  const id=safeId(orderId,'order');
  const objectRef=sdk.ref(storage,`receipts/${id}/${Date.now()}_${safeId(file.name||'receipt')}`);
  await sdk.uploadBytes(objectRef,file,{contentType:file.type||'application/octet-stream'});
  return sdk.getDownloadURL(objectRef);
}

async function saveProduct(product){
  if(ROLE!=='panel') throw new Error('Operación administrativa no permitida desde la tienda.');
  await initialize();
  const id=safeId(product?.id||crypto.randomUUID(),'product');
  const payload=await cloudSafeProduct({...product,id});
  await sdk.setDoc(sdk.doc(db,COLLECTIONS.products,id),{...payload,updatedAtFirebase:sdk.serverTimestamp()},{merge:true});
  return id;
}

async function updateOrder(orderId,patch){
  if(ROLE!=='panel') throw new Error('Operación administrativa no permitida desde la tienda.');
  await initialize();
  await sdk.setDoc(sdk.doc(db,COLLECTIONS.orders,safeId(orderId,'order')),{...clean(clone(patch)),updatedAtFirebase:sdk.serverTimestamp()},{merge:true});
  return true;
}

async function signOutFirebase(){
  await initialize();
  return sdk.signOut(auth);
}

function readiness(){
  return {
    role:ROLE,
    configured:configured(),
    ready,
    projectId:CONFIG.projectId||'',
    sdkVersion:SDK_VERSION,
    services:['Authentication','Cloud Firestore','Cloud Storage'],
    collections:clone(COLLECTIONS)
  };
}

const api={
  version:'4.2.0',
  role:ROLE,
  configured,
  initialize,
  readiness,
  queueLocalWrite,
  pushLocalSnapshot,
  uploadReceipt,
  saveProduct,
  updateOrder,
  signOut:signOutFirebase,
  get auth(){return auth},
  get db(){return db},
  get storage(){return storage},
  get currentUser(){return currentFirebaseUser},
  get ready(){return ready}
};

window.CruzClickFirebase=api;

installStoreAuthBridge();
installPanelAuthBridge();
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installExistingAccountMigration,{once:true});
else installExistingAccountMigration();

if(configured()){
  initialize().catch(()=>{});
}else{
  dispatchStatus('not-configured',{message:'Firebase listo para configurar. Completa CRUZCLICK_FIREBASE_CONFIG.'});
}