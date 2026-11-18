
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
let accountDeletionInProgress = false;
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
const AVATAR_LIMIT_BYTES=100*1024*1024; // 100 MB input, optimized for fast profile synchronization.
const AVATAR_MAX_TEXT=200000;
function firebaseSafeProfile(user,uid,email){
  const out={id:uid,firebaseUid:uid,email:String(email||'').trim()};
  for(const key of PROFILE_FIELDS) out[key]=String(user?.[key]||'').trim();
  if(user?.createdAt) out.createdAt=user.createdAt;
  if(user?.updatedAt) out.updatedAt=user.updatedAt;
  if(typeof user?.avatarDataUrl==='string' && (user.avatarDataUrl==='' || (user.avatarDataUrl.startsWith('data:image/jpeg;base64,') && user.avatarDataUrl.length<=AVATAR_MAX_TEXT))) out.avatarDataUrl=user.avatarDataUrl;
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
  if(!ready || suppressLocalWrites || accountDeletionInProgress) return false;

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
  if(!ready || suppressLocalWrites || accountDeletionInProgress) return false;
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
  if(!user || !db || accountDeletionInProgress) return;
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
    avatarDataUrl:(typeof data.avatarDataUrl==='string'?data.avatarDataUrl:existing?.avatarDataUrl||''),
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
            if(createError?.code==='auth/email-already-in-use') throw new Error('Este correo ya está registrado. Inicia sesión con la contraseña de tu cuenta.');
            throw createError;
          }
          const profile=firebaseSafeProfile(local,cred.user.uid,cred.user.email);
          await sdk.setDoc(sdk.doc(db,COLLECTIONS.users,cred.user.uid),{...profile,updatedAtFirebase:sdk.serverTimestamp()},{merge:true});
        }
        await loadCurrentFirebaseUserIntoLocal(cred.user);
        runtime()?.closeAccount?.();
        runtime()?.toast?.('Cuenta vinculada correctamente.','success');
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
        runtime()?.toast?.('Cuenta creada y vinculada correctamente.','success');
      }
    }catch(err){
      console.error('CRULOX Firebase auth',err);
      runtime()?.toast?.(err?.message||'No fue posible acceder a tu cuenta.','error');
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
    host.innerHTML='<b style="font-size:.87rem">Protege y sincroniza tu cuenta</b><p style="font-size:.75rem;margin:8px 0 12px;color:#aec8d7">Confirma tu contraseña para sincronizar los datos de tu perfil. Conservaremos tu información actual.</p><form id="cruFirebaseLinkForm"><label for="cruFirebaseLinkPassword" style="display:block;font-size:.72rem;margin-bottom:6px">Contraseña de tu cuenta</label><input id="cruFirebaseLinkPassword" type="password" autocomplete="current-password" required minlength="8" style="width:100%;padding:12px;background:#061625;border:1px solid #3b6b81;border-radius:12px;color:white"><button class="btn btn-primary btn-block" style="margin-top:10px" type="submit">Sincronizar mi perfil</button><p id="cruFirebaseLinkMessage" role="status" style="font-size:.72rem;margin-top:8px"></p></form>';
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
      if(status) status.textContent='Perfil sincronizado correctamente.';
      runtime()?.toast?.('Perfil sincronizado correctamente.','success');
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

      runtime()?.toast?.('Acceso administrativo verificado.','success');
    }catch(err){
      console.error('CRULOX Firebase admin auth',err);
      runtime()?.toast?.('Credenciales administrativas no válidas.','error');
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
      dispatchStatus('not-configured',{message:'Sincronización no disponible por el momento.'});
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
      if(accountDeletionInProgress) return;

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
  if(ROLE!=='panel') throw new Error('La migración de datos solo está disponible desde el panel.');
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
  dispatchStatus('not-configured',{message:'Sincronización no disponible por el momento.'});
}


/* CruLox V4.5.6 — ventana de cuenta, foto de perfil y eliminación voluntaria.
   Ninguna dependencia extra ni cambio en catálogo, pedidos o navegación. */
function accountStateUser(){
  const st=runtime()?.getState?.();
  return st?.session?.role==='client' && Array.isArray(st.users)
    ?st.users.find(u=>String(u.id)===String(st.session.userId))||null:null;
}
function checkedAvatar(value){
  return typeof value==='string' && value.startsWith('data:image/jpeg;base64,') && value.length<=AVATAR_MAX_TEXT?value:'';
}
function accountStatus(element,message,problem=false){
  if(!element)return;
  element.textContent=message;
  element.dataset.error=problem?'true':'false';
}
function accountFriendlyError(error,action){
  const code=error?.code||'';
  if(error?.message==='La contraseña no es correcta.')return 'La contraseña no es correcta.';
  if(error?.message==='Inicia sesión nuevamente para eliminar tu cuenta.')return 'Inicia sesión nuevamente para eliminar tu cuenta.';
  if(error?.message==='Inicia sesión nuevamente antes de actualizar la foto.')return 'Inicia sesión nuevamente antes de actualizar la foto.';
  if(code==='permission-denied' || code==='storage/unauthorized')return 'La configuración de privacidad todavía no permite esta operación. No se han eliminado tus datos.';
  if(code==='auth/wrong-password'||code==='auth/invalid-credential')return 'La contraseña no es correcta.';
  if(code==='auth/requires-recent-login')return 'Vuelve a iniciar sesión e intenta nuevamente.';
  if(code==='auth/network-request-failed'||code==='unavailable')return 'No hay conexión. Intenta nuevamente cuando recuperes internet.';
  return action==='delete'?'No se pudo eliminar la cuenta. No se cerró tu sesión.':'No se pudo guardar la fotografía. Intenta nuevamente.';
}
async function resizeAvatar(file){
  if(!(file instanceof File) || file.size<=0 || file.size>AVATAR_LIMIT_BYTES)throw new Error('Selecciona una imagen de hasta 100 MB.');
  if(!/^image\/(jpeg|png|webp|gif)$/i.test(file.type))throw new Error('Elige una imagen JPG, PNG, WebP o GIF.');
  let bmp=null,objectUrl='',img=null;
  try{
    if(typeof createImageBitmap==='function'){
      try{bmp=await createImageBitmap(file,{resizeWidth:512,resizeHeight:512,resizeQuality:'high'});}catch(_){}
    }
    if(!bmp){
      objectUrl=URL.createObjectURL(file);
      img=new Image();
      await new Promise((res,rej)=>{img.onload=res;img.onerror=()=>rej(new Error('No se pudo leer la imagen.'));img.src=objectUrl;});
    }
    const w=bmp?.width||img?.naturalWidth||0,h=bmp?.height||img?.naturalHeight||0;
    if(!w||!h)throw new Error('La imagen seleccionada no es válida.');
    for(const side of [512,384,320,256]){
      const canvas=document.createElement('canvas');canvas.width=side;canvas.height=side;
      const context=canvas.getContext('2d',{alpha:false});
      if(!context)throw new Error('Este dispositivo no permite preparar la foto.');
      const source=bmp||img;const crop=Math.min(w,h);const x=(w-crop)/2,y=(h-crop)/2;
      context.fillStyle='#081522';context.fillRect(0,0,side,side);
      context.drawImage(source,x,y,crop,crop,0,0,side,side);
      for(const quality of [.83,.69,.53]){
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
        if(!blob)continue;
        if(blob.size>130000)continue;
        const value=await new Promise((resolve,reject)=>{
          const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);
        });
        if(checkedAvatar(value))return value;
      }
    }
    throw new Error('La imagen es demasiado compleja para optimizarla.');
  }finally{bmp?.close?.();if(objectUrl)URL.revokeObjectURL(objectUrl);}
}
async function updateAccountAvatar(user,value){
  const current=accountStateUser();if(!current || current.id!==user.id)throw new Error('La sesión ha cambiado.');
  const online=!!(user.firebaseUid || currentFirebaseUser);
  if(online){
    await initialize();
    const fu=auth?.currentUser;
    if(!fu || fu.uid!==String(user.firebaseUid||user.id))throw new Error('Inicia sesión nuevamente antes de actualizar la foto.');
    const doc=sdk.doc(db,COLLECTIONS.users,fu.uid);
    await sdk.setDoc(doc,{...firebaseSafeProfile({...user,avatarDataUrl:value},fu.uid,fu.email),updatedAtFirebase:sdk.serverTimestamp()},{merge:true});
  }
  user.avatarDataUrl=value;
  const st=runtime()?.getState?.();
  runtime()?.write?.(LOCAL_KEYS.users,st.users);
  renderAccountPhotoInHeader(user);
  return online;
}
function renderAccountPhotoInHeader(user){
  const badge=document.getElementById('profileDot');
  if(!badge)return;
  const image=checkedAvatar(user?.avatarDataUrl);
  if(image){
    let img=badge.querySelector('img.cru-account-icon');
    if(!img){badge.textContent='';img=document.createElement('img');img.className='cru-account-icon';img.alt='';badge.appendChild(img);}
    if(img.src!==image)img.src=image;
    badge.classList.add('cru-has-photo');
  }else{
    badge.querySelector('img.cru-account-icon')?.remove();
    badge.classList.remove('cru-has-photo');
    badge.textContent=String(user?.fullName||user?.username||'P').trim().charAt(0).toUpperCase()||'P';
  }
}
function clearAccountLocal(user){
  const st=runtime()?.getState?.();if(!st)return;
  st.session=null;
  runtime()?.write?.(LOCAL_KEYS.session,null);
  st.users=(st.users||[]).filter(u=>u.id!==user.id && (!user.firebaseUid||u.firebaseUid!==user.firebaseUid));
  runtime()?.write?.(LOCAL_KEYS.users,st.users);
  renderAccountPhotoInHeader(null);
  runtime()?.renderHeader?.();runtime()?.renderAccount?.();
}
async function removeAccountCompletely(user,password){
  const st=runtime()?.getState?.();
  if(!st || st.session?.role!=='client'||st.session.userId!==user.id)throw new Error('La sesión no está disponible.');
  const cloud=!!(user.firebaseUid || currentFirebaseUser);
  if(!cloud){
    if(!await verifyLocalAccount(user,password))throw new Error('La contraseña no es correcta.');
    clearAccountLocal(user);
    return;
  }
  await initialize();
  const fu=auth?.currentUser;
  if(!fu || fu.uid!==String(user.firebaseUid||user.id) || String(fu.email||'').toLowerCase()!==String(user.email||'').toLowerCase()){
    throw new Error('Inicia sesión nuevamente para eliminar tu cuenta.');
  }
  await sdk.reauthenticateWithCredential(fu,sdk.EmailAuthProvider.credential(fu.email,password));
  accountDeletionInProgress=true;
  const profileRef=sdk.doc(db,COLLECTIONS.users,fu.uid);
  let previous=null,profileWasDeleted=false;
  try{
    const snapshot=await sdk.getDoc(profileRef);
    previous=snapshot.exists()?snapshot.data():null;
    if(previous){await sdk.deleteDoc(profileRef);profileWasDeleted=true;}
    try{await sdk.deleteUser(fu);}catch(error){
      if(profileWasDeleted && previous){
        try{await sdk.setDoc(profileRef,previous);}catch(recoveryError){console.error('CRULOX account rollback',recoveryError);}
      }
      throw error;
    }
    clearAccountLocal(user);
  }finally{accountDeletionInProgress=false;}
}
function installAccountProfileControls(){
  if(ROLE!=='store')return;
  const host=document.getElementById('accountBody');if(!host)return;
  const style=document.createElement('style');style.id='cru456-account-styles';
  style.textContent=`
  #accountModal .modal{width:min(640px,calc(100vw - 20px))!important;max-height:min(91dvh,920px)!important;overflow-y:auto!important;background:linear-gradient(163deg,#0a2537,#061523 65%,#05101d)!important;border:1px solid rgba(70,220,255,.22)!important;box-shadow:0 30px 80px rgba(0,0,0,.5)!important;border-radius:25px!important}
  #accountModal .modal-head{padding-bottom:16px!important;border-bottom:1px solid rgba(157,217,242,.12)!important}
  #accountModal .profile-card.cru-managed-profile{padding:0!important;background:none!important;border:0!important;box-shadow:none!important}
  #accountModal .cru-managed-profile>h3,#accountModal .cru-managed-profile>.section-kicker{display:none!important}
  #accountModal .cru-profile-hero{display:flex;gap:16px;align-items:center;margin:4px 0 18px;padding:16px;border:1px solid rgba(45,214,249,.21);border-radius:20px;background:radial-gradient(circle at top left,rgba(10,183,225,.14),transparent 70%),#0c2233}
  #accountModal .cru-avatar-round{width:90px;height:90px;flex:0 0 90px;display:grid;place-items:center;border-radius:26px;border:2px solid rgba(58,224,255,.66);overflow:hidden;background:linear-gradient(135deg,#073952,#06243f);color:#92f3ff;font-size:2rem;font-weight:800;box-shadow:0 10px 30px rgba(0,203,238,.12)}
  #accountModal .cru-avatar-round img{width:100%;height:100%;object-fit:cover;display:block}
  #accountModal .cru-profile-identity{flex:1;min-width:0}
  #accountModal .cru-profile-eyebrow{display:block;color:#54dff5;font-size:.65rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase;margin-bottom:6px}
  #accountModal .cru-profile-name{font-weight:850;font-size:clamp(1rem,3.6vw,1.32rem);line-height:1.22;overflow-wrap:anywhere;color:#f2fcff}
  #accountModal .cru-profile-help{display:block;margin-top:8px;font-size:.69rem;color:#a1bfd3;line-height:1.5}
  #accountModal .cru-avatar-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 0}
  #accountModal .cru-avatar-actions button{display:inline-flex;align-items:center;justify-content:center;cursor:pointer;min-height:38px;border-radius:11px;padding:7px 12px;background:#0e3448;border:1px solid rgba(62,214,248,.3);font-size:.73rem;color:#d7f9ff;font-weight:750}
  #accountModal .cru-avatar-actions button{background:#122535;color:#adc8d9}
  #accountModal #cruAvatarInput{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none;display:none!important}
  #accountModal #cruProfileHero .np-generic-file{display:none!important}
  #accountModal .cru-avatar-status{min-height:0;color:#8ceec8;font-size:.69rem;margin-top:7px;line-height:1.45}
  #accountModal .cru-avatar-status[data-error='true']{color:#ff98a9}
  #accountModal .cru-managed-profile .profile-grid{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px!important;margin-bottom:16px!important}
  #accountModal .cru-managed-profile .profile-info{min-width:0!important;background:#0c2132!important;border:1px solid rgba(139,204,230,.10)!important;border-radius:14px!important;padding:13px 14px!important}
  #accountModal .cru-managed-profile .profile-info small{display:block!important;color:#92aebf!important;font-size:.69rem!important;margin-bottom:5px!important}
  #accountModal .cru-managed-profile .profile-info b{font-size:.84rem!important;overflow-wrap:anywhere!important;color:#f0f8ff!important}
  #accountModal .cru-managed-profile .form-actions{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px!important}
  #accountModal .cru-managed-profile .form-actions button{min-height:46px!important;border-radius:13px!important;font-size:.78rem!important}
  #accountModal .cru-managed-profile #logoutClient{grid-column:1/-1;justify-self:stretch;background:#152437!important;border-color:rgba(179,198,218,.14)!important;color:#e9eef5!important}
  #accountModal .cru-account-danger{margin-top:17px;padding:14px;border-top:1px solid rgba(255,114,132,.14);border-radius:14px;background:rgba(65,20,34,.12)}
  #accountModal .cru-danger-trigger{width:100%;min-height:44px;color:#ffc4cb;border:1px solid rgba(255,116,132,.32);background:rgba(241,73,97,.06);border-radius:12px;font-size:.77rem;font-weight:750;cursor:pointer}
  #accountModal .cru-delete-form{display:grid;gap:11px;margin-top:14px}
  #accountModal .cru-delete-form label{display:grid;gap:5px;font-size:.73rem;color:#bfd2e2}
  #accountModal .cru-delete-form input{width:100%!important;min-height:44px!important;padding:10px 12px!important;background:#061622!important;border:1px solid rgba(255,148,157,.3)!important;border-radius:11px!important;color:#f7fbff!important;font-size:16px!important}
  #accountModal .cru-delete-form p{font-size:.72rem;line-height:1.55;color:#c1aab3;margin:0}
  #accountModal .cru-delete-submit{min-height:45px;border-radius:12px;border:0;background:#cb394f;color:white;font-size:.79rem;font-weight:800;cursor:pointer}
  #accountModal .cru-delete-submit:disabled{opacity:.5;cursor:wait}
  #accountModal .cru-delete-cancel{min-height:40px;border-radius:11px;border:1px solid rgba(207,216,224,.16);background:transparent;color:#cbd7e2;cursor:pointer}
  #accountModal .cru-delete-status{font-size:.71rem;color:#ff9fac;line-height:1.5}
  #profileDot.cru-has-photo{display:block!important;overflow:hidden;padding:0!important}
  #profileDot.cru-has-photo img.cru-account-icon{display:block;width:100%;height:100%;object-fit:cover;border-radius:inherit}
  @media(max-width:440px){#accountModal .cru-profile-hero{padding:13px;gap:12px}#accountModal .cru-avatar-round{width:72px;height:72px;flex-basis:72px;border-radius:21px}#accountModal .cru-managed-profile .profile-grid{grid-template-columns:1fr!important}}
  `;
  document.head.appendChild(style);
  function refresh(){
    const user=accountStateUser();
    renderAccountPhotoInHeader(user);
    const card=host.querySelector('.profile-card');
    if(!user||!card||card.querySelector('#cruProfileHero'))return;
    card.classList.add('cru-managed-profile');
    const hero=document.createElement('div');hero.id='cruProfileHero';hero.className='cru-profile-hero';
    hero.innerHTML=`<div class="cru-avatar-round" id="cruAvatarDisplay" aria-label="Foto del perfil"><span id="cruAvatarFallback"></span></div><div class="cru-profile-identity"><span class="cru-profile-eyebrow">Mi cuenta</span><div id="cruProfileName" class="cru-profile-name"></div><span class="cru-profile-help">Foto de perfil · Hasta 100 MB por archivo</span><div class="cru-avatar-actions"><button id="cruAvatarChoose" type="button">Elegir foto</button><button id="cruAvatarClear" type="button" hidden>Quitar foto</button><input id="cruAvatarInput" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></div><p class="cru-avatar-status" id="cruAvatarStatus" role="status"></p></div>`;
    card.insertBefore(hero,card.querySelector('.profile-grid')||card.firstChild);
    hero.querySelector('#cruProfileName').textContent=user.fullName||user.username||'Mi cuenta';
    const img=checkedAvatar(user.avatarDataUrl);
    if(img){const el=document.createElement('img');el.src=img;el.alt='Foto de perfil';hero.querySelector('#cruAvatarDisplay').appendChild(el);hero.querySelector('#cruAvatarFallback').textContent='';hero.querySelector('#cruAvatarClear').hidden=false;}
    else hero.querySelector('#cruAvatarFallback').textContent=(user.fullName||user.username||'C').charAt(0).toUpperCase();
    const danger=document.createElement('div');danger.className='cru-account-danger';danger.id='cruAccountDanger';
    danger.innerHTML=`<button class="cru-danger-trigger" type="button" id="cruDeleteTrigger">Eliminar mi cuenta</button><div id="cruDeleteContents" hidden></div>`;
    card.appendChild(danger);
  }
  new MutationObserver(refresh).observe(host,{childList:true});
  refresh();
  document.addEventListener('change',async event=>{
    if(event.target?.id!=='cruAvatarInput')return;
    const input=event.target,file=input.files?.[0],user=accountStateUser();
    const status=document.getElementById('cruAvatarStatus');
    if(!user||!file)return;
    input.disabled=true;
    accountStatus(status,'Preparando foto…');
    try{
      const image=await resizeAvatar(file);
      accountStatus(status,'Guardando fotografía…');
      const online=await updateAccountAvatar(user,image);
      runtime()?.renderAccount?.();
      const fresh=document.getElementById('cruAvatarStatus');
      accountStatus(fresh,online?'Foto actualizada y sincronizada.':'Foto guardada en este dispositivo.');
    }catch(error){accountStatus(status,error.message?.startsWith('Selecciona')||error.message?.startsWith('Elige')||error.message?.startsWith('La imagen')?error.message:accountFriendlyError(error,'avatar'),true);}
    finally{input.disabled=false;input.value='';}
  },true);
  document.addEventListener('click',async event=>{
    if(event.target?.id==='cruAvatarChoose'){document.getElementById('cruAvatarInput')?.click();return;}
    if(event.target?.id==='cruAvatarClear'){
      const btn=event.target,user=accountStateUser(),status=document.getElementById('cruAvatarStatus');
      if(!user)return;btn.disabled=true;
      try{const online=await updateAccountAvatar(user,'');runtime()?.renderAccount?.();accountStatus(document.getElementById('cruAvatarStatus'),online?'Foto eliminada del perfil.':'Foto quitada de este dispositivo.');}
      catch(e){accountStatus(status,accountFriendlyError(e,'avatar'),true);}finally{btn.disabled=false;}
    }
    if(event.target?.id!=='cruDeleteTrigger')return;
    const destination=document.getElementById('cruDeleteContents');
    if(!destination)return;
    destination.hidden=false;
    destination.innerHTML=`<form id="cruDeleteAccountForm" class="cru-delete-form"><p>Esta acción es definitiva. Se eliminarán tu acceso y los datos de tu perfil. Los registros de pedidos pueden conservarse por obligaciones de atención y contabilidad.</p><label>Contraseña actual<input id="cruDeletePassword" type="password" autocomplete="current-password" required minlength="8"></label><label>Escribe ELIMINAR para confirmar<input id="cruDeleteConfirmation" type="text" autocomplete="off" required></label><button class="cru-delete-submit" type="submit">Eliminar mi cuenta definitivamente</button><button class="cru-delete-cancel" type="button" id="cruDeleteCancel">Cancelar</button><p class="cru-delete-status" id="cruDeleteMessage" role="alert"></p></form>`;
    event.target.hidden=true;
  },true);
  document.addEventListener('click',event=>{
    if(event.target?.id!=='cruDeleteCancel')return;
    const area=document.getElementById('cruDeleteContents');
    if(area){area.textContent='';area.hidden=true;}
    const trigger=document.getElementById('cruDeleteTrigger');if(trigger)trigger.hidden=false;
  },true);
  document.addEventListener('submit',async event=>{
    if(event.target?.id!=='cruDeleteAccountForm')return;
    event.preventDefault();event.stopImmediatePropagation();
    const form=event.target,btn=form.querySelector('[type="submit"]');
    const status=form.querySelector('#cruDeleteMessage'),user=accountStateUser();
    if(!user)return accountStatus(status,'Debes iniciar sesión.',true);
    if(form.querySelector('#cruDeleteConfirmation')?.value!=='ELIMINAR')return accountStatus(status,'Escribe exactamente ELIMINAR para continuar.',true);
    const password=form.querySelector('#cruDeletePassword')?.value||'';
    if(!password)return accountStatus(status,'Confirma tu contraseña.',true);
    btn.disabled=true;
    accountStatus(status,'Verificando y eliminando cuenta…');
    try{
      await removeAccountCompletely(user,password);
      runtime()?.toast?.('Tu cuenta fue eliminada.','success');
    }catch(error){
      accountStatus(status,accountFriendlyError(error,'delete'),true);
    }finally{btn.disabled=false;form.querySelector('#cruDeletePassword').value='';}
  },true);
  window.addEventListener('cruzclick:firebase-sync',()=>{const u=accountStateUser();if(u)renderAccountPhotoInHeader(u);});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installAccountProfileControls,{once:true});
else installAccountProfileControls();

/* CruLox V4.5.9: reponer la fotografía en la cabecera desde la sesión ya disponible. */
(()=>{
  let refreshPending=false;
  const show=()=>{
    if(refreshPending)return;
    refreshPending=true;
    queueMicrotask(()=>{
      refreshPending=false;
      const user=accountStateUser();
      if(user)renderAccountPhotoInHeader(user);
    });
  };
  const boot=()=>{
    const badge=document.getElementById('profileDot');
    if(badge&&typeof MutationObserver==='function')new MutationObserver(show).observe(badge,{childList:true});
    show();
    // Se carga la sesión y el perfil de forma asíncrona; sincronizar también al regresar a la app.
    [300,850,2100,5000].forEach(ms=>setTimeout(show,ms));
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.addEventListener('pageshow',show);
  window.addEventListener('focus',show);
  window.addEventListener('cruzclick:firebase-sync',show);
  window.addEventListener('cruzclick:firebase-status',show);
})();
