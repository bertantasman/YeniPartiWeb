// Yalnızca yerel kullanım içindir: dist/ dosyalarını sunar. /api/* istekleri Firebase ID token'ı ve
// users/{uid}.role == 'admin' kontrolü ister; yalnızca rol değişiklikleri (genel ve teşkilat) yazılabilir. Kimlik bilgisi: gcloud Application Default Credentials.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const fnRequire = require('node:module').createRequire(path.join(__dirname, 'functions', 'index.cjs'));
const {initializeApp} = fnRequire('firebase-admin/app');
const {getFirestore, FieldPath, FieldValue} = fnRequire('firebase-admin/firestore');
const {getAuth} = fnRequire('firebase-admin/auth');
const {parseReportRequest, listOrganizations, buildReport, parseEventListRequest, parseEventDetailRequest, listEvents, eventDetail} = require('./functions/attendanceReport.cjs');

initializeApp({projectId: 'bertantasman-yeniparti'});
const db = getFirestore();
const auth = getAuth();
const dist = path.join(__dirname, 'dist');
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png'};
const roleValid = v => ['user', 'admin'].includes(v);

async function listUsers() {
  const users = [];
  let cursor;
  do {
    let q = db.collection('users').orderBy(FieldPath.documentId()).limit(200);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    for (const s of snap.docs) {
      const u = s.data();
      users.push({id: s.id, name: typeof u.displayName === 'string' ? u.displayName : 'İsimsiz kullanıcı', email: typeof u.email === 'string' ? u.email : '', role: roleValid(u.role) ? u.role : 'unknown', createdAt: u.createdAt?.toDate?.()?.toISOString() ?? null, deletionPending: u.deletionPending === true});
    }
    cursor = snap.size === 200 ? snap.docs.at(-1).id : null;
  } while (cursor);
  const [orgs, members] = await Promise.all([db.collection('organizations').get(), db.collectionGroup('members').get()]);
  const orgNames = new Map(orgs.docs.map(d => [d.id, typeof d.data().name === 'string' ? d.data().name : 'Teşkilat']));
  const byUser = new Map();
  for (const m of members.docs) {
    const x = m.data();
    const uid = typeof x.userId === 'string' ? x.userId : m.id;
    const orgId = m.ref.parent.parent.id;
    const list = byUser.get(uid) ?? [];
    list.push({orgId, org: orgNames.get(orgId) ?? 'Teşkilat', role: ['member', 'admin', 'owner'].includes(x.role) ? x.role : 'unknown', status: ['pending', 'approved', 'rejected'].includes(x.status) ? x.status : 'unknown', title: typeof x.organizationalTitle === 'string' ? x.organizationalTitle : ''});
    byUser.set(uid, list);
  }
  for (const u of users) u.memberships = byUser.get(u.id) ?? [];
  return users;
}

const localOrigins = ['http://localhost:4173', 'http://127.0.0.1:4173'];
const readBody = req => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 4096) { reject(new Error('too large')); req.destroy(); } });
  req.on('end', () => resolve(body));
});
const send = (res, code, obj) => { res.writeHead(code, {'content-type': 'application/json'}); res.end(JSON.stringify(obj)); };

// Giriş yapan kişinin geçerli (iptal edilmemiş) token'ı ve global admin profili olmalı.
async function requireAdmin(req) {
  const bearer = req.headers.authorization;
  if (!bearer?.startsWith('Bearer ')) throw Object.assign(new Error('Lütfen giriş yapın.'), {status: 401});
  let uid;
  try { uid = (await auth.verifyIdToken(bearer.slice(7), true)).uid; } catch { throw Object.assign(new Error('Oturum geçersiz. Yeniden giriş yapın.'), {status: 401}); }
  const profile = await db.doc(`users/${uid}`).get();
  if (profile.data()?.role !== 'admin' || profile.data()?.deletionPending) throw Object.assign(new Error('Bu panel yalnızca uygulama yöneticileri içindir.'), {status: 403});
  return uid;
}

async function setOrgRole(actor, orgId, uid, role) {
  const ref = db.doc(`organizationMemberships/${orgId}/members/${uid}`);
  await db.runTransaction(async tx => {
    const [org, m] = await Promise.all([tx.get(db.doc(`organizations/${orgId}`)), tx.get(ref)]);
    if (!org.exists || org.data().isActive !== true) throw Object.assign(new Error('Teşkilat bulunamadı.'), {status: 404});
    const d = m.data();
    if (!m.exists || d.userId !== uid || d.organizationId !== orgId || d.status !== 'approved') throw Object.assign(new Error('Onaylı teşkilat üyesi gerekli.'), {status: 409});
    if (d.role === 'owner') throw Object.assign(new Error('Teşkilat sahibinin rolü değiştirilemez.'), {status: 409});
    tx.update(ref, {role});
    tx.create(db.collection('webAdminAudit').doc(), {actor, action: 'organization-role-update', target: `${orgId}/${uid}`, createdAt: FieldValue.serverTimestamp()});
  });
}

async function setRole(actor, uid, role) {
  if (uid === actor && role !== 'admin') throw Object.assign(new Error('Kendi yönetici yetkinizi kaldıramazsınız.'), {status: 409});
  const target = db.doc(`users/${uid}`);
  await db.runTransaction(async tx => {
    const s = await tx.get(target);
    if (!s.exists) throw Object.assign(new Error('Kullanıcı bulunamadı.'), {status: 404});
    if (s.data().deletionPending) throw Object.assign(new Error('Silme işlemi tamamlanmalı.'), {status: 409});
    if (s.data().role === 'admin' && role !== 'admin') {
      const admins = await tx.get(db.collection('users').where('role', '==', 'admin').limit(2));
      if (admins.size < 2) throw Object.assign(new Error('Son yönetici değiştirilemez.'), {status: 409});
    }
    tx.update(target, {role, updatedAt: FieldValue.serverTimestamp()});
    tx.create(db.collection('webAdminAudit').doc(), {actor, action: 'update', target: uid, createdAt: FieldValue.serverTimestamp()});
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/orgs/role' && req.method === 'POST') {
    try {
      if (!localOrigins.includes(req.headers.origin) || !String(req.headers['content-type']).startsWith('application/json')) return send(res, 403, {error: 'Yalnızca yerel panelden.'});
      const actor = await requireAdmin(req);
      const {orgId, uid, role} = JSON.parse(await readBody(req));
      const idOk = v => typeof v === 'string' && v && v.length <= 128 && !v.includes('/');
      if (!idOk(orgId) || !idOk(uid) || !['member', 'admin'].includes(role)) return send(res, 400, {error: 'Geçersiz teşkilat, kullanıcı veya rol.'});
      await setOrgRole(actor, orgId, uid, role);
      send(res, 200, {ok: true});
    } catch (e) {
      console.error('Teşkilat rol hatası:', e.message);
      send(res, e.status ?? 500, {error: e.status ? e.message : 'İşlem tamamlanamadı.'});
    }
    return;
  }
  if (url.pathname === '/api/users/role' && req.method === 'POST') {
    try {
      if (!localOrigins.includes(req.headers.origin) || !String(req.headers['content-type']).startsWith('application/json')) return send(res, 403, {error: 'Yalnızca yerel panelden.'});
      const actor = await requireAdmin(req);
      const {uid, role} = JSON.parse(await readBody(req));
      if (typeof uid !== 'string' || !uid || uid.includes('/') || !roleValid(role)) return send(res, 400, {error: 'Geçersiz kullanıcı veya rol.'});
      await setRole(actor, uid, role);
      send(res, 200, {ok: true});
    } catch (e) {
      console.error('Rol hatası:', e.message);
      send(res, e.status ?? 500, {error: e.status ? e.message : 'İşlem tamamlanamadı.'});
    }
    return;
  }
  if (url.pathname === '/api/report/orgs' && req.method === 'GET') {
    try {
      const actor = await requireAdmin(req);
      const defaultOrganizationId = (await db.doc(`users/${actor}`).get()).data()?.organizationId ?? null;
      send(res, 200, {organizations: await listOrganizations(db), defaultOrganizationId});
    } catch (e) {
      console.error('Rapor teşkilat hatası:', e.message);
      send(res, e.status ?? 500, {error: e.status ? e.message : 'İşlem tamamlanamadı.'});
    }
    return;
  }
  if (url.pathname === '/api/report' && req.method === 'POST') {
    try {
      if (!localOrigins.includes(req.headers.origin) || !String(req.headers['content-type']).startsWith('application/json')) return send(res, 403, {error: 'Yalnızca yerel panelden.'});
      const actor = await requireAdmin(req);
      const fail = (code, message) => { throw Object.assign(new Error(message), {status: code === 'not-found' ? 404 : code === 'failed-precondition' ? 409 : 400}); };
      const input = parseReportRequest(JSON.parse(await readBody(req)), fail);
      const report = await buildReport({db, fail}, input);
      await db.collection('webAdminAudit').doc().set({actor, action: 'export-attendance', target: input.organizationId, createdAt: FieldValue.serverTimestamp()});
      res.writeHead(200, {'content-type': 'application/json', 'cache-control': 'no-store'});
      res.end(JSON.stringify(report));
    } catch (e) {
      console.error('Rapor hatası:', e.message);
      send(res, e.status ?? 500, {error: e.status ? e.message : 'İşlem tamamlanamadı.'});
    }
    return;
  }
  if (url.pathname === '/api/events' && req.method === 'POST') {
    try {
      if (!localOrigins.includes(req.headers.origin) || !String(req.headers['content-type']).startsWith('application/json')) return send(res, 403, {error: 'Yalnızca yerel panelden.'});
      const actor = await requireAdmin(req);
      const fail = (code, message) => { throw Object.assign(new Error(message), {status: code === 'not-found' ? 404 : 400}); };
      const body = JSON.parse(await readBody(req));
      let result;
      if (body.action === 'events') result = await listEvents({db, fail}, parseEventListRequest(body, fail));
      else if (body.action === 'eventAttendees') {
        result = await eventDetail({db, fail}, parseEventDetailRequest(body, fail));
        await db.collection('webAdminAudit').doc().set({actor, action: 'view-event-attendees', target: result.event.id, createdAt: FieldValue.serverTimestamp()});
      } else fail('invalid-argument', 'Geçersiz işlem.');
      res.writeHead(200, {'content-type': 'application/json', 'cache-control': 'no-store'});
      res.end(JSON.stringify(result));
    } catch (e) {
      console.error('Etkinlik hatası:', e.message);
      send(res, e.status ?? 500, {error: e.status ? e.message : 'İşlem tamamlanamadı.'});
    }
    return;
  }
  if (url.pathname === '/api/mode' && req.method === 'GET') return send(res, 200, {local: true});
  if (url.pathname === '/api/users' && req.method === 'GET') {
    try {
      await requireAdmin(req);
      res.writeHead(200, {'content-type': 'application/json', 'cache-control': 'no-store'});
      res.end(JSON.stringify(await listUsers()));
    } catch (e) {
      console.error('Liste hatası:', e.message);
      send(res, e.status ?? 502, {error: e.status ? e.message : 'firestore'});
    }
    return;
  }
  const file = path.normalize(path.join(dist, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  res.writeHead(200, {'content-type': types[path.extname(file)] ?? 'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
}).listen(4173, '127.0.0.1', () => console.log('http://localhost:4173'));
