import {auth, manageUsers} from './firebase-client.js';
import {buildXlsx, reportSheets} from './xlsx.js';
const $ = s => document.querySelector(s);
const localMode = fetch('/api/mode').then(r => r.ok).catch(() => false);
const fail = (code, message) => Object.assign(new Error(message), {code, userMessage: message});

export async function call(data) {
  if (!(await localMode)) return manageUsers(data);
  const headers = {authorization: `Bearer ${await auth.currentUser.getIdToken()}`};
  const res = data.action === 'reportOrganizations'
    ? await fetch('/api/report/orgs', {headers, cache: 'no-store'})
    : data.action === 'events' || data.action === 'eventAttendees'
      ? await fetch('/api/events', {method: 'POST', headers: {...headers, 'content-type': 'application/json'}, body: JSON.stringify(data)})
      : await fetch('/api/report', {method: 'POST', headers: {...headers, 'content-type': 'application/json'}, body: JSON.stringify({organizationId: data.organizationId, from: data.from, to: data.to})});
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw fail('failed', body.error ?? 'İşlem tamamlanamadı.');
  return body;
}

// Dates are Istanbul local days: start of the first day .. end of the last day.
const dayStart = v => v ? new Date(`${v}T00:00:00+03:00`).getTime() : undefined;
const dayEnd = v => v ? new Date(`${v}T23:59:59.999+03:00`).getTime() : undefined;
const pct = r => r == null ? '—' : `%${Math.round(r * 100)}`;
const esc = v => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let lastReport = null, loadedFor = null;

function setStatus(text, error = false) { const el = $('#report-status'); el.textContent = text; el.className = error ? 'form-error' : 'field-hint'; }

export async function openReport() {
  if (!auth.currentUser || loadedFor === auth.currentUser.uid) return;
  try {
    const {organizations, defaultOrganizationId} = await call({action: 'reportOrganizations'});
    $('#report-org').innerHTML = organizations.map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('');
    if (organizations.some(o => o.id === defaultOrganizationId)) $('#report-org').value = defaultOrganizationId;
    loadedFor = auth.currentUser.uid;
    $('#report-run').disabled = organizations.length === 0;
    setStatus(organizations.length ? 'Teşkilat ve tarih aralığı seçip raporu hazırlayın.' : 'Aktif teşkilat bulunamadı.');
  } catch (e) { setStatus(e.userMessage ?? e.message ?? 'Teşkilatlar yüklenemedi.', true); }
}

function downloadWorkbook(report, filename, toastFn) {
  const blob = buildXlsx(reportSheets(report));
  const a = Object.assign(document.createElement('a'), {href: URL.createObjectURL(blob), download: filename});
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toastFn('Excel dosyası indirildi.');
}

function renderPreview(report) {
  const attended = report.events.reduce((n, e) => n + e.attendedCount, 0);
  const avg = report.events.length && report.organization.memberCount ? attended / (report.events.length * report.organization.memberCount) : null;
  $('#report-summary').innerHTML = `<article><div class="stat-top">Etkinlik</div><strong>${report.events.length}</strong><small>Seçilen aralıkta (aktif + tamamlanan)</small></article><article><div class="stat-top">Toplam katılım</div><strong>${attended}</strong><small>${report.organization.memberCount} onaylı üye</small></article><article><div class="stat-top">Ortalama katılım oranı</div><strong>${pct(avg)}</strong><small>Katılım ÷ (etkinlik × üye)</small></article>`;
  $('#report-rows').innerHTML = report.events.map(e => `<tr><td>${esc(e.title)}</td><td>${esc(new Date(e.startMillis).toLocaleString('tr-TR', {dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul'}))}</td><td>${e.attendedCount} / ${e.memberCount}</td><td>${pct(e.rate)}</td><td><button class="secondary event-report-download" type="button" data-event-id="${esc(e.id)}">Etkinlik Excel'i</button></td></tr>`).join('') || '<tr><td colspan="5">Bu aralıkta etkinlik yok.</td></tr>';
  $('#report-result').hidden = false;
}

export function initReport(toast) {
  $('#report-form').addEventListener('submit', async e => {
    e.preventDefault();
    const from = dayStart($('#report-from').value), to = dayEnd($('#report-to').value);
    if (from !== undefined && to !== undefined && to < from) { setStatus('Bitiş tarihi başlangıçtan önce olamaz.', true); return; }
    $('#report-run').disabled = true; $('#report-download').hidden = true; setStatus('Rapor hazırlanıyor…');
    try {
      lastReport = await call({action: 'attendanceReport', organizationId: $('#report-org').value, ...(from !== undefined ? {from} : {}), ...(to !== undefined ? {to} : {})});
      renderPreview(lastReport); $('#report-download').hidden = false; setStatus('Rapor hazır.');
    } catch (err) { lastReport = null; $('#report-result').hidden = true; setStatus(err.userMessage ?? err.message ?? 'Rapor hazırlanamadı.', true); }
    $('#report-run').disabled = false;
  });
  $('#report-download').addEventListener('click', () => {
    if (!lastReport) return;
    downloadWorkbook(lastReport, `katilim-raporu-${new Date().toISOString().slice(0, 10)}.xlsx`, toast);
  });
  $('#report-rows').addEventListener('click', e => {
    const button = e.target.closest('[data-event-id]');
    if (!button || !lastReport) return;
    const event = lastReport.events.find(item => item.id === button.dataset.eventId);
    if (!event) return;
    const safeTitle = event.title.toLocaleLowerCase('tr-TR').replace(/[^a-z0-9ğüşöçıİĞÜŞÖÇ]+/gi, '-').replace(/^-|-$/g, '') || 'etkinlik';
    downloadWorkbook({...lastReport, events: [event]}, `etkinlik-katilim-${safeTitle}-${new Date(event.startMillis).toISOString().slice(0, 10)}.xlsx`, toast);
  });
}
