// Only this module writes profiles. Firestore client rules remain unchanged.
const {parseReportRequest,listOrganizations,buildReport,parseEventListRequest,parseEventDetailRequest,listEvents,eventDetail}=require('./attendanceReport.cjs');
exports.makeHandler = ({db,auth,FieldValue,FieldPath,HttpsError}) => {
 const fail=(code,message)=>{throw new HttpsError(code,message);};
 const text=(v,max=128)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=max&&!/[\u0000-\u001f]/.test(v);
 const uidValid=v=>text(v)&&!v.includes('/');
 const roleValid=v=>['user','admin'].includes(v);
 async function adminInTransaction(tx,uid){const snap=await tx.get(db.doc(`users/${uid}`));if(snap.data()?.role!=='admin'||snap.data()?.deletionPending)fail('permission-denied','Yönetici erişimi gerekli.');}
 function audit(tx,actor,action,target){tx.create(db.collection('webAdminAudit').doc(),{actor,action,target,createdAt:FieldValue.serverTimestamp()});}
 return async request=>{
  if(!request.auth)fail('unauthenticated','Lütfen giriş yapın.');
  const actor=request.auth.uid;
  // Reject disabled/deleted users and revoked sessions, not only expired ID tokens.
  const bearer=request.rawRequest?.headers?.authorization;
  if(!bearer?.startsWith('Bearer '))fail('unauthenticated','Geçerli oturum gerekli.');
  try{const token=await auth.verifyIdToken(bearer.slice(7),true);if(token.uid!==actor)fail('unauthenticated','Geçersiz oturum.');}catch{fail('unauthenticated','Oturum geçersiz. Yeniden giriş yapın.');}
  const caller=await db.doc(`users/${actor}`).get();
  if(caller.data()?.role!=='admin'||caller.data()?.deletionPending)fail('permission-denied','Bu panel yalnızca uygulama yöneticileri içindir.');
  const data=request.data;
  if(!data||typeof data!=='object'||Array.isArray(data))fail('invalid-argument','Geçersiz istek.');
  const allowed={list:['action','cursor'],create:['action','requestId','name','email','password','role'],update:['action','uid','name','role'],delete:['action','uid'],reportOrganizations:['action'],attendanceReport:['action','organizationId','from','to'],events:['action','organizationId'],eventAttendees:['action','eventId']};
  if(!Object.hasOwn(allowed,data.action)||Object.keys(data).some(k=>!allowed[data.action].includes(k)))fail('invalid-argument','Geçersiz işlem veya alan.');
  // Shared per-actor throttle. No user details, passwords or tokens are logged.
  await db.runTransaction(async tx=>{const ref=db.doc(`webAdminLimits/${actor}`);const s=await tx.get(ref);const now=Date.now();const state=s.data();const same=state&&now-state.start<60000;const count=same?state.count+1:1;if(count>60)fail('resource-exhausted','Çok fazla istek. Bir dakika sonra tekrar deneyin.');tx.set(ref,{start:same?state.start:now,count});});
  if(data.action==='reportOrganizations')return {organizations:await listOrganizations(db),defaultOrganizationId:caller.data()?.organizationId??null};
  if(data.action==='attendanceReport'){
   const input=parseReportRequest(data,fail);
   const report=await buildReport({db,fail},input);
   // Contains phone/e-mail: record who exported what (no personal data in the audit entry).
   await db.collection('webAdminAudit').doc().set({actor,action:'export-attendance',target:input.organizationId,createdAt:FieldValue.serverTimestamp()});
   return report;
  }
  if(data.action==='events')return listEvents({db,fail},parseEventListRequest(data,fail));
  if(data.action==='eventAttendees'){
   const detail=await eventDetail({db,fail},parseEventDetailRequest(data,fail));
   // Attendee details include phone/e-mail: record the access without personal data.
   await db.collection('webAdminAudit').doc().set({actor,action:'view-event-attendees',target:detail.event.id,createdAt:FieldValue.serverTimestamp()});
   return detail;
  }
  if(data.action==='list'){
   if(data.cursor!==undefined&&!uidValid(data.cursor))fail('invalid-argument','Geçersiz sayfa.');
   let q=db.collection('users').orderBy(FieldPath.documentId()).limit(200);
   if(data.cursor)q=q.startAfter(data.cursor);
   const snap=await q.get();
   return {users:snap.docs.map(s=>{const u=s.data();return {id:s.id,name:typeof u.displayName==='string'?u.displayName:'İsimsiz kullanıcı',email:typeof u.email==='string'?u.email:'',role:roleValid(u.role)?u.role:'unknown',createdAt:u.createdAt?.toDate?.()?.toISOString()??null,deletionPending:u.deletionPending===true};}),cursor:snap.size===200?snap.docs.at(-1).id:null};
  }
  if(data.action==='create'){
   if(!text(data.name,100)||!text(data.email,254)||!/^\S+@\S+\.\S+$/.test(data.email)||!roleValid(data.role)||typeof data.password!=='string'||data.password.length<12||data.password.length>128||!(/^[a-f0-9-]{36}$/i.test(data.requestId??'')))fail('invalid-argument','Ad, e-posta, rol ve en az 12 karakterli şifre gerekli.');
   // A deterministic UID makes retries safe across Auth and Firestore.
   const uid=`web-${data.requestId}`,ref=db.doc(`users/${uid}`),email=data.email.trim().toLowerCase();
   let record;
   try{record=await auth.createUser({uid,email,password:data.password,displayName:data.name.trim(),disabled:true});}
   catch(e){if(e.code!=='auth/uid-already-exists'){if(e.code==='auth/email-already-exists')fail('already-exists','Bu e-posta adresi zaten kayıtlı.');if(e.code?.startsWith('auth/invalid')||e.code==='auth/password-does-not-meet-requirements')fail('invalid-argument','Hesap bilgileri veya şifre politikası geçersiz.');throw e;}record=await auth.getUser(uid);if(record.email!==email)fail('already-exists','İşlem kimliği başka hesap için kullanılmış.');}
   await db.runTransaction(async tx=>{await adminInTransaction(tx,actor);const existing=await tx.get(ref);if(existing.exists){if(existing.data().provisionedBy!==actor)fail('permission-denied','Bu işlem başka bir yöneticiye ait.');return;}tx.create(ref,{displayName:data.name.trim(),email,role:data.role,ancestorUserIds:[],createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),provisionedBy:actor,provisioningPending:true});audit(tx,actor,'create',uid);});
   // Accounts stay disabled until their profile is ready. No privacy consent is fabricated.
   if((await ref.get()).data()?.provisioningPending){await auth.updateUser(uid,{disabled:false});await ref.update({provisioningPending:FieldValue.delete()});}
   return {ok:true,uid};
  }
  if(!uidValid(data.uid))fail('invalid-argument','Geçersiz kullanıcı.');
  const target=db.doc(`users/${data.uid}`);
  if(data.action==='update'){
   if(!text(data.name,100)||!roleValid(data.role))fail('invalid-argument','Geçersiz ad veya rol.');
   if(data.uid===actor&&data.role!=='admin')fail('failed-precondition','Kendi yönetici yetkinizi kaldıramazsınız.');
   await db.runTransaction(async tx=>{await adminInTransaction(tx,actor);const s=await tx.get(target);if(!s.exists)fail('not-found','Kullanıcı bulunamadı.');if(s.data().deletionPending)fail('failed-precondition','Silme işlemi tamamlanmalı.');if(s.data().role==='admin'&&data.role!=='admin'){const admins=await tx.get(db.collection('users').where('role','==','admin').limit(2));if(admins.size<2)fail('failed-precondition','Son yönetici değiştirilemez.');}tx.update(target,{displayName:data.name.trim(),role:data.role,updatedAt:FieldValue.serverTimestamp()});audit(tx,actor,'update',data.uid);});
   return {ok:true};
  }
  if(data.uid===actor)fail('failed-precondition','Kendi hesabınızı silemezsiniz.');
  // Preserve historical attendance; do not orphan organization memberships/ownership.
  // Query failure also blocks deletion, rather than silently ignoring associations.
  const memberships=await db.collectionGroup('members').where('userId','==',data.uid).limit(1).get();
  if(!memberships.empty)fail('failed-precondition','Önce bu kullanıcının teşkilat üyeliğini iOS yönetiminden kaldırın.');
  await db.runTransaction(async tx=>{await adminInTransaction(tx,actor);const s=await tx.get(target);if(!s.exists)fail('not-found','Kullanıcı bulunamadı.');if(s.data().organizationId)fail('failed-precondition','Önce kullanıcının teşkilat üyeliğini kaldırın.');if(s.data().role==='admin'){const admins=await tx.get(db.collection('users').where('role','==','admin').limit(2));if(admins.size<2)fail('failed-precondition','Son yönetici silinemez.');}tx.update(target,{role:'unknown',deletionPending:true,updatedAt:FieldValue.serverTimestamp()});});
  try{await auth.updateUser(data.uid,{disabled:true});await auth.revokeRefreshTokens(data.uid);await auth.deleteUser(data.uid);}catch(e){if(e.code!=='auth/user-not-found')throw e;}
  await db.runTransaction(async tx=>{const s=await tx.get(target);if(!s.exists)return;if(!s.data().deletionPending)fail('failed-precondition','Kullanıcı durumu değişti.');tx.delete(target);audit(tx,actor,'delete',data.uid);});
  return {ok:true};
 };
};
