const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {initializeApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore,FieldValue,FieldPath}=require('firebase-admin/firestore');
const {HttpsError}=require('firebase-functions/v2/https');
const {makeHandler}=require('../management.cjs');
if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST)throw Error('Tests require local Auth and Firestore emulators. Never run against production.');
initializeApp({projectId:'demo-yeniparti-web'});
const auth=getAuth(),db=getFirestore(),handler=makeHandler({auth,db,FieldValue,FieldPath,HttpsError});
const password='Emulator-only-Password-42';
async function fixture(role){const uid=randomUUID(),email=`${uid}@example.com`;await auth.createUser({uid,email,password});await db.doc(`users/${uid}`).set({role,displayName:'Test',email,createdAt:FieldValue.serverTimestamp()});const r=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});const result=await r.json();assert.ok(result.idToken);return {uid,token:result.idToken};}
const call=(actor,data)=>handler({auth:actor?{uid:actor.uid}:null,rawRequest:{headers:{authorization:actor?`Bearer ${actor.token}`:''}},data});
test('real emulator account management and authorization',async t=>{
 const admin=await fixture('admin'),member=await fixture('user');
 await t.test('unauthenticated and normal user cannot list or mutate',async()=>{await assert.rejects(call(null,{action:'list'}),{code:'unauthenticated'});await assert.rejects(call(member,{action:'list'}),{code:'permission-denied'});await assert.rejects(call(member,{action:'update',uid:member.uid,name:'Test',role:'admin'}),{code:'permission-denied'});});
 await t.test('reject unexpected fields, invalid UID and invalid roles',async()=>{await assert.rejects(call(admin,{action:'list',role:'admin'}),{code:'invalid-argument'});await assert.rejects(call(admin,{action:'update',uid:'a/b',name:'Test',role:'user'}),{code:'invalid-argument'});await assert.rejects(call(admin,{action:'update',uid:member.uid,name:'Test',role:'owner'}),{code:'invalid-argument'});});
 await t.test('cannot self-delete or self-demote',async()=>{await assert.rejects(call(admin,{action:'delete',uid:admin.uid}),{code:'failed-precondition'});await assert.rejects(call(admin,{action:'update',uid:admin.uid,name:'Test',role:'user'}),{code:'failed-precondition'});});
 const requestId=randomUUID(),email=`${requestId}@example.com`;
 await t.test('create is retry-safe and does not fabricate consent',async()=>{const input={action:'create',requestId,name:'Yeni Test',email,password,role:'user'};const first=await call(admin,input),second=await call(admin,input);assert.equal(first.uid,second.uid);assert.equal((await auth.getUser(first.uid)).disabled,false);const profile=(await db.doc(`users/${first.uid}`).get()).data();assert.equal(profile.role,'user');assert.equal(profile.privacyAcceptedAt,undefined);assert.equal(profile.provisioningPending,undefined);await assert.rejects(call(admin,{...input,requestId:randomUUID()}),{code:'already-exists'});});
 const target=`web-${requestId}`;
 await t.test('role update is authoritative, list returns safe fields',async()=>{await call(admin,{action:'update',uid:target,name:'Yeni İsim',role:'admin'});assert.equal((await db.doc(`users/${target}`).get()).data().role,'admin');const result=await call(admin,{action:'list'});const found=result.users.find(u=>u.id===target);assert.equal(found.name,'Yeni İsim');assert.equal(found.password,undefined);});
 await t.test('memberships prevent deletion',async()=>{const ref=db.doc(`organizationMemberships/test/members/${target}`);await ref.set({userId:target,role:'owner',status:'approved'});await assert.rejects(call(admin,{action:'delete',uid:target}),{code:'failed-precondition'});assert.ok((await db.doc(`users/${target}`).get()).exists);await ref.delete();});
 await t.test('delete removes Auth and profile but retains historical attendance',async()=>{const history=db.doc(`events/history/attendances/${target}`);await history.set({userId:target});await call(admin,{action:'delete',uid:target});assert.equal((await db.doc(`users/${target}`).get()).exists,false);await assert.rejects(auth.getUser(target),{code:'auth/user-not-found'});assert.equal((await history.get()).exists,true);});
 await t.test('revoked or disabled sessions are rejected',async()=>{await auth.updateUser(admin.uid,{disabled:true});await assert.rejects(call(admin,{action:'list'}),{code:'unauthenticated'});});
});
