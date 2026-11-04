import {auth} from './firebase-client.js';
import {call} from './report.js';
import {buildXlsx} from './xlsx.js';
const $ = s => document.querySelector(s);
const esc = v => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = ms => ms == null ? '—' : new Intl.DateTimeFormat('tr-TR', {dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul'}).format(new Date(ms));
let events = [], filter = 'all', loadedFor = null, detail = null, toastFn = () => {};

// "now" = active and inside its time window; "upcoming" = active and not started; everything else is history.
function phase(e, now = Date.now()) {
  if (e.status === 'draft') return 'draft';
  if (e.status === 'active' && e.endMillis && now >= e.startMillis && now <= e.endMillis) return 'now';
  if (e.status === 'active' && now < e.startMillis) return 'upcoming';
  return 'past';
}
const labels = {now: 'Şu an', upcoming: 'Yaklaşan', past: 'Geçmiş', draft: 'Taslak'};
const statusNote = {completed: 'Tamamlandı', cancelled: 'İptal edildi', active: 'Aktif', draft: 'Taslak', unknown: 'Bilinmiyor'};
const setStatus = (text, error = false) => { const el = $('#events-status'); el.textContent = text; el.className = error ? 'form-error' : 'field-hint'; };

function render() {
  const shown = events.filter(e => filter === 'all' || phase(e) === filter);
  $('#events-rows').innerHTML = shown.map(e => `<tr class="clickable" data-event="${esc(e.id)}" tabindex="0"><td><strong>${esc(e.title)}</strong><small class="org-line">${esc(e.locationName)}</small></td><td>${esc(fmt(e.startMillis))}</td><td><span class="badge ${phase(e) === 'now' ? 'admin' : ''}">${labels[phase(e)]}${e.status === 'completed' || e.status === 'cancelled' ? ' · ' + statusNote[e.status] : ''}</span></td><td>${e.attendedCount}</td></tr>`).join('');
  $('#events-empty').hidden = shown.length > 0;
  document.querySelectorAll('#events-filter button').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
}

async function loadEvents() {
  const organizationId = $('#events-org').value;
  if (!organizationId) return;
  setStatus('Etkinlikler yükleniyor…'); $('#events-refresh').disabled = true;
  try {
    const result = await call({action: 'events', organizationId});
    events = result.events; render();
    setStatus(result.truncated ? 'En yeni 300 etkinlik gösteriliyor.' : `${events.length} etkinlik.`);
  } catch (e) { setStatus(e.userMessage ?? e.message ?? 'Etkinlikler yüklenemedi.', true); }
  $('#events-refresh').disabled = false;
}

export async function openEvents() {
  if (!auth.currentUser) return;
  if (loadedFor === auth.currentUser.uid) return;
  try {
    const {organizations, defaultOrganizationId} = await call({action: 'reportOrganizations'});
    $('#events-org').innerHTML = organizations.map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('');
    if (organizations.some(o => o.id === defaultOrganizationId)) $('#events-org').value = defaultOrganizationId;
    loadedFor = auth.currentUser.uid;
    await loadEvents();
  } catch (e) { setStatus(e.userMessage ?? e.message ?? 'Teşkilatlar yüklenemedi.', true); }
}

async function openDetail(id) {
  const dialog = $('#event-dialog');
  $('#event-detail-body').innerHTML = '<p class="field-hint">Yükleniyor…</p>';
  $('#event-download').hidden = true; detail = null;
  dialog.showModal();
  try {
    detail = await call({action: 'eventAttendees', eventId: id});
    const e = detail.event;
    $('#event-title').textContent = e.title;
    $('#event-detail-body').innerHTML = `<p class="field-hint">${esc(fmt(e.startMillis))} – ${esc(fmt(e.endMillis))} · ${esc(e.locationName)} · ${esc(statusNote[e.status] ?? e.status)}</p>${e.description ? `<p class="field-hint">${esc(e.description)}</p>` : ''}<p><strong>${detail.attendees.length}</strong> katılımcı</p>` + (detail.attendees.length
      ? `<div class="table-wrap"><table><thead><tr><th>AD SOYAD</th><th>KATILIM SAATİ</th><th>TELEFON</th><th>E-POSTA</th><th>UZAKLIK</th></tr></thead><tbody>${detail.attendees.map(a => `<tr><td>${esc(a.name)}</td><td>${esc(fmt(a.checkedInAtMillis))}</td><td>${esc(a.phone)}</td><td>${esc(a.email)}</td><td>${a.distanceMeters == null ? '—' : Math.round(a.distanceMeters) + ' m'}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="field-hint">Bu etkinliğe henüz katılım yok.</p>');
    $('#event-download').hidden = detail.attendees.length === 0;
  } catch (err) { $('#event-detail-body').innerHTML = `<p class="form-error">${esc(err.userMessage ?? err.message ?? 'Detay yüklenemedi.')}</p>`; }
}

export function initEvents(toast) {
  toastFn = toast;
  $('#events-org').addEventListener('change', loadEvents);
  $('#events-refresh').addEventListener('click', loadEvents);
  $('#events-filter').addEventListener('click', e => { const b = e.target.closest('[data-filter]'); if (b) { filter = b.dataset.filter; render(); } });
  const open = e => { const row = e.target.closest('[data-event]'); if (row) openDetail(row.dataset.event); };
  $('#events-rows').addEventListener('click', open);
  $('#events-rows').addEventListener('keydown', e => { if (e.key === 'Enter') open(e); });
  $('#event-close').addEventListener('click', () => $('#event-dialog').close());
  $('#event-download').addEventListener('click', () => {
    if (!detail) return;
    const rows = [['Ad soyad', 'Katılım saati', 'Telefon', 'E-posta', 'Konuma uzaklık (m)'], ...detail.attendees.map(a => [a.name, fmt(a.checkedInAtMillis), a.phone, a.email, a.distanceMeters == null ? '' : Math.round(a.distanceMeters)])];
    const a = Object.assign(document.createElement('a'), {href: URL.createObjectURL(buildXlsx([{name: 'Katılımcılar', rows}])), download: `etkinlik-katilimcilari-${new Date().toISOString().slice(0, 10)}.xlsx`});
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toastFn('Excel dosyası indirildi. Kişisel veri içerir, dikkatli paylaşın.');
  });
}
