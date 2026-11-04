// Read-only report builder shared by the callable and the local dev server.
// Authorization (global admin) is checked by the caller; attendances are never written here.
const MAX_EVENTS = 200;
const MAX_RANGE_MS = 366 * 24 * 3600 * 1000;
const REPORT_STATUSES = ['active', 'completed'];

exports.REPORT_STATUSES = REPORT_STATUSES;

exports.parseReportRequest = (data, fail) => {
  const id = v => typeof v === 'string' && v.trim() && v.length <= 128 && !v.includes('/');
  const millis = v => Number.isSafeInteger(v) && v >= 0 && v < 8.64e15;
  if (!id(data.organizationId)) fail('invalid-argument', 'Geçersiz teşkilat.');
  if (data.from !== undefined && !millis(data.from)) fail('invalid-argument', 'Geçersiz başlangıç tarihi.');
  if (data.to !== undefined && !millis(data.to)) fail('invalid-argument', 'Geçersiz bitiş tarihi.');
  if (data.from !== undefined && data.to !== undefined && (data.to < data.from || data.to - data.from > MAX_RANGE_MS)) {
    fail('invalid-argument', 'Tarih aralığı geçersiz veya bir yıldan uzun.');
  }
  return {organizationId: data.organizationId.trim(), from: data.from, to: data.to};
};

exports.listOrganizations = async db => {
  const snap = await db.collection('organizations').where('isActive', '==', true).get();
  return snap.docs.map(d => ({id: d.id, name: typeof d.data().name === 'string' ? d.data().name : 'Teşkilat'}))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr-TR'));
};

exports.buildReport = async ({db, fail}, {organizationId, from, to}) => {
  const organization = await db.doc(`organizations/${organizationId}`).get();
  if (!organization.exists || organization.data().isActive !== true) fail('not-found', 'Teşkilat bulunamadı.');
  // Range is filtered in memory: equality + range on startTime would need a new composite index.
  const [eventsSnap, membersSnap] = await Promise.all([
    db.collection('events').where('organizationId', '==', organizationId).get(),
    db.collection(`organizationMemberships/${organizationId}/members`).where('status', '==', 'approved').get(),
  ]);
  const events = eventsSnap.docs
    .filter(d => REPORT_STATUSES.includes(d.data().status) && d.data().startTime?.toMillis)
    .filter(d => (from === undefined || d.data().startTime.toMillis() >= from) && (to === undefined || d.data().startTime.toMillis() <= to))
    .sort((a, b) => a.data().startTime.toMillis() - b.data().startTime.toMillis());
  if (events.length > MAX_EVENTS) fail('failed-precondition', `Aralıkta ${events.length} etkinlik var; en fazla ${MAX_EVENTS}. Aralığı daraltın.`);

  const memberIds = membersSnap.docs.map(d => d.data().userId ?? d.id);
  const attendanceByEvent = await Promise.all(events.map(e => e.ref.collection('attendances').get()));
  const userIds = [...new Set([...memberIds, ...attendanceByEvent.flatMap(s => s.docs.map(d => d.id))])];
  const profiles = new Map();
  for (let i = 0; i < userIds.length; i += 300) {
    const docs = await db.getAll(...userIds.slice(i, i + 300).map(id => db.doc(`users/${id}`)));
    for (const d of docs) if (d.exists) profiles.set(d.id, d.data());
  }
  const str = v => (typeof v === 'string' ? v : '');
  const person = id => {
    const p = profiles.get(id) ?? {};
    const name = [p.firstName, p.middleName, p.lastName].filter(x => typeof x === 'string' && x.trim()).join(' ') || str(p.displayName) || 'Bilinmeyen kullanıcı';
    return {userId: id, name, email: str(p.email), phone: str(p.phoneNumber)};
  };

  const memberCount = memberIds.length;
  const attended = new Map();
  const eventRows = events.map((e, i) => {
    const d = e.data(), records = attendanceByEvent[i].docs;
    for (const r of records) attended.set(r.id, (attended.get(r.id) ?? 0) + 1);
    return {
      id: e.id, title: str(d.title), locationName: str(d.locationName), status: d.status,
      startMillis: d.startTime.toMillis(), endMillis: d.endTime?.toMillis?.() ?? null,
      attendedCount: records.length, memberCount,
      rate: memberCount > 0 ? records.length / memberCount : null,
      records: records.map(r => ({...person(r.id), checkedInAtMillis: r.data().checkedInAt?.toMillis?.() ?? null, distanceMeters: typeof r.data().distanceMeters === 'number' ? r.data().distanceMeters : null})),
    };
  });
  const members = memberIds.map(id => ({...person(id), attendedEvents: attended.get(id) ?? 0, totalEvents: events.length,
    rate: events.length > 0 ? (attended.get(id) ?? 0) / events.length : null}))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr-TR'));
  return {organization: {id: organizationId, name: str(organization.data().name), memberCount}, from: from ?? null, to: to ?? null, events: eventRows, members};
};

const idOk = v => typeof v === 'string' && v.trim() && v.length <= 128 && !v.includes('/');
const MAX_LISTED_EVENTS = 300;

exports.parseEventListRequest = (data, fail) => {
  if (!idOk(data.organizationId)) fail('invalid-argument', 'Geçersiz teşkilat.');
  return data.organizationId.trim();
};
exports.parseEventDetailRequest = (data, fail) => {
  if (!idOk(data.eventId)) fail('invalid-argument', 'Geçersiz etkinlik.');
  return data.eventId.trim();
};

// Every status (draft, active, completed, cancelled) so current and past events can both be reviewed.
exports.listEvents = async ({db, fail}, organizationId) => {
  const organization = await db.doc(`organizations/${organizationId}`).get();
  if (!organization.exists || organization.data().isActive !== true) fail('not-found', 'Teşkilat bulunamadı.');
  const snap = await db.collection('events').where('organizationId', '==', organizationId).get();
  const docs = snap.docs.filter(d => d.data().startTime?.toMillis).sort((a, b) => b.data().startTime.toMillis() - a.data().startTime.toMillis()).slice(0, MAX_LISTED_EVENTS);
  const counts = await Promise.all(docs.map(d => d.ref.collection('attendances').count().get()));
  return {
    events: docs.map((d, i) => {
      const x = d.data();
      return {id: d.id, title: typeof x.title === 'string' ? x.title : '', locationName: typeof x.locationName === 'string' ? x.locationName : '',
        status: ['draft', 'active', 'completed', 'cancelled'].includes(x.status) ? x.status : 'unknown',
        startMillis: x.startTime.toMillis(), endMillis: x.endTime?.toMillis?.() ?? null, attendedCount: counts[i].data().count};
    }),
    truncated: snap.size > MAX_LISTED_EVENTS,
  };
};

exports.eventDetail = async ({db, fail}, eventId) => {
  const event = await db.doc(`events/${eventId}`).get();
  const x = event.data();
  if (!event.exists || typeof x.organizationId !== 'string') fail('not-found', 'Etkinlik bulunamadı.');
  const records = await event.ref.collection('attendances').orderBy('checkedInAt').get();
  const ids = records.docs.map(d => d.id);
  const profiles = new Map();
  for (let i = 0; i < ids.length; i += 300) {
    for (const d of await db.getAll(...ids.slice(i, i + 300).map(id => db.doc(`users/${id}`)))) if (d.exists) profiles.set(d.id, d.data());
  }
  const str = v => (typeof v === 'string' ? v : '');
  return {
    event: {id: event.id, organizationId: x.organizationId, title: str(x.title), description: str(x.description), locationName: str(x.locationName), status: str(x.status),
      startMillis: x.startTime?.toMillis?.() ?? null, endMillis: x.endTime?.toMillis?.() ?? null, radiusMeters: typeof x.radiusMeters === 'number' ? x.radiusMeters : null},
    attendees: records.docs.map(d => {
      const p = profiles.get(d.id) ?? {};
      const name = [p.firstName, p.middleName, p.lastName].filter(v => typeof v === 'string' && v.trim()).join(' ') || str(p.displayName) || 'Bilinmeyen kullanıcı';
      return {userId: d.id, name, email: str(p.email), phone: str(p.phoneNumber), checkedInAtMillis: d.data().checkedInAt?.toMillis?.() ?? null,
        distanceMeters: typeof d.data().distanceMeters === 'number' ? d.data().distanceMeters : null};
    }),
  };
};
