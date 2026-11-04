const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {initializeApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore,FieldValue,FieldPath,Timestamp}=require('firebase-admin/firestore');
const {HttpsError}=require('firebase-functions/v2/https');
const {makeHandler}=require('../management.cjs');
if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST)throw Error('Tests require local Auth and Firestore emulators. Never run against production.');
initializeApp({projectId:'demo-yeniparti-web'},'report');
const app=require('firebase-admin/app').getApp('report');
const auth=getAuth(app),db=getFirestore(app),handler=makeHandler({auth,db,FieldValue,FieldPath,HttpsError});
const password='Emulator-only-Password-42';
async function fixture(role){const uid=randomUUID(),email=`${uid}@example.com`;await auth.createUser({uid,email,password});await db.doc(`users/${uid}`).set({role,displayName:'Test',email,createdAt:FieldValue.serverTimestamp()});const r=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});const result=await r.json();assert.ok(result.idToken);return {uid,token:result.idToken};}
const call=(actor,data)=>handler({auth:actor?{uid:actor.uid}:null,rawRequest:{headers:{authorization:actor?`Bearer ${actor.token}`:''}},data});
test('attendance report: authorization, range, rates and contact details',async t=>{
 const admin=await fixture('admin'),user=await fixture('user');
 const org=`org-${randomUUID()}`,ms=d=>Date.parse(`${d}T09:00:00+03:00`);
 await db.doc(`organizations/${org}`).set({name:'Test Teşkilatı',isActive:true});
 const people=[['m1','Ayşe','Yılmaz','+905550000001','ayse@example.com'],['m2','Ali','Kaya','+905550000002','ali@example.com']];
 for(const [id,f,l,phone,email] of people){await db.doc(`users/${id}-${org}`).set({firstName:f,lastName:l,phoneNumber:phone,email,role:'user'});await db.doc(`organizationMemberships/${org}/members/${id}-${org}`).set({userId:`${id}-${org}`,organizationId:org,status:'approved',role:'member'});}
 await db.doc(`organizationMemberships/${org}/members/pending`).set({userId:'pending',organizationId:org,status:'pending',role:'member'});
 const mk=async(id,status,date)=>db.doc(`events/${id}`).set({title:id,organizationId:org,status,locationName:'Yer',startTime:Timestamp.fromMillis(ms(date)),endTime:Timestamp.fromMillis(ms(date)+3600000)});
 await mk(`${org}-e1`,'completed','2026-01-10');await mk(`${org}-e2`,'active','2026-02-10');await mk(`${org}-e3`,'draft','2026-02-11');await mk(`${org}-e4`,'cancelled','2026-02-12');
 await db.doc(`events/${org}-e1/attendances/m1-${org}`).set({userId:`m1-${org}`,checkedInAt:Timestamp.fromMillis(ms('2026-01-10')),distanceMeters:12});
 await db.doc(`events/${org}-e1/attendances/m2-${org}`).set({userId:`m2-${org}`,checkedInAt:Timestamp.fromMillis(ms('2026-01-10')+60000),distanceMeters:30});
 await db.doc(`events/${org}-e2/attendances/m1-${org}`).set({userId:`m1-${org}`,checkedInAt:Timestamp.fromMillis(ms('2026-02-10')),distanceMeters:5});
 await t.test('normal users and anonymous callers are rejected',async()=>{
  await assert.rejects(call(user,{action:'attendanceReport',organizationId:org}),{code:'permission-denied'});
  await assert.rejects(call(null,{action:'reportOrganizations'}),{code:'unauthenticated'});
 });
 await t.test('invalid input is rejected',async()=>{
  for(const bad of [{organizationId:'a/b'},{organizationId:org,from:'x'},{organizationId:org,from:5,to:1},{organizationId:org,extra:1},{}])await assert.rejects(call(admin,{action:'attendanceReport',...bad}),{code:'invalid-argument'});
  await assert.rejects(call(admin,{action:'attendanceReport',organizationId:'missing'}),{code:'not-found'});
 });
 await t.test('whole history counts only active and completed events',async()=>{
  const r=await call(admin,{action:'attendanceReport',organizationId:org});
  assert.equal(r.organization.memberCount,2);assert.deepEqual(r.events.map(e=>e.id),[`${org}-e1`,`${org}-e2`]);
  assert.deepEqual(r.events.map(e=>e.rate),[1,0.5]);
  const ayse=r.members.find(m=>m.email==='ayse@example.com');assert.equal(ayse.rate,1);assert.equal(ayse.phone,'+905550000001');
  assert.equal(r.members.find(m=>m.name==='Ali Kaya').rate,0.5);
  assert.equal(r.events[0].records.length,2);assert.equal(r.events[0].records[0].email.includes('@'),true);
 });
 await t.test('date range limits events and rates',async()=>{
  const r=await call(admin,{action:'attendanceReport',organizationId:org,from:ms('2026-02-01'),to:ms('2026-02-28')});
  assert.deepEqual(r.events.map(e=>e.id),[`${org}-e2`]);assert.equal(r.members.find(m=>m.name==='Ali Kaya').rate,0);
 });
 await t.test('export is recorded without personal data',async()=>{
  const logs=await db.collection('webAdminAudit').where('action','==','export-attendance').where('target','==',org).get();
  assert.ok(logs.size>=2);assert.deepEqual(Object.keys(logs.docs[0].data()).sort(),['action','actor','createdAt','target']);
 });
 await t.test('organizations list is admin only',async()=>{
  assert.ok((await call(admin,{action:'reportOrganizations'})).organizations.some(o=>o.id===org));
  await assert.rejects(call(user,{action:'reportOrganizations'}),{code:'permission-denied'});
 });
});

test('event list and attendee detail: all statuses, contact details, admin only, audited',async t=>{
 const admin=await fixture('admin'),user=await fixture('user');
 const org=`org-${randomUUID()}`,now=Date.now();
 await db.doc(`organizations/${org}`).set({name:'T',isActive:true});
 const mk=(id,status,start)=>db.doc(`events/${org}-${id}`).set({title:id,organizationId:org,status,locationName:'Yer',startTime:Timestamp.fromMillis(start),endTime:Timestamp.fromMillis(start+3600000)});
 await mk('now','active',now-1000);await mk('old','completed',now-86400000);await mk('draft','draft',now+86400000);await mk('cancelled','cancelled',now-172800000);
 await db.doc(`users/p1-${org}`).set({firstName:'Ayşe',lastName:'Yılmaz',phoneNumber:'+905550000001',email:'a@example.com',role:'user'});
 await db.doc(`events/${org}-now/attendances/p1-${org}`).set({userId:`p1-${org}`,checkedInAt:Timestamp.fromMillis(now),distanceMeters:7});
 await t.test('admin only and strict input',async()=>{
  await assert.rejects(call(user,{action:'events',organizationId:org}),{code:'permission-denied'});
  await assert.rejects(call(user,{action:'eventAttendees',eventId:`${org}-now`}),{code:'permission-denied'});
  await assert.rejects(call(admin,{action:'events',organizationId:'a/b'}),{code:'invalid-argument'});
  await assert.rejects(call(admin,{action:'eventAttendees',eventId:`${org}-now`,x:1}),{code:'invalid-argument'});
  await assert.rejects(call(admin,{action:'eventAttendees',eventId:'missing'}),{code:'not-found'});
 });
 await t.test('list returns every status, newest first, with counts',async()=>{
  const r=await call(admin,{action:'events',organizationId:org});
  assert.deepEqual(r.events.map(e=>e.status),['draft','active','completed','cancelled']);
  assert.equal(r.events.find(e=>e.status==='active').attendedCount,1);
 });
 await t.test('detail lists attendees with contact info and is audited',async()=>{
  const r=await call(admin,{action:'eventAttendees',eventId:`${org}-now`});
  assert.equal(r.attendees.length,1);assert.deepEqual([r.attendees[0].name,r.attendees[0].phone,r.attendees[0].email],['Ayşe Yılmaz','+905550000001','a@example.com']);
  const logs=await db.collection('webAdminAudit').where('action','==','view-event-attendees').where('target','==',`${org}-now`).get();
  assert.equal(logs.size,1);assert.deepEqual(Object.keys(logs.docs[0].data()).sort(),['action','actor','createdAt','target']);
 });
});
