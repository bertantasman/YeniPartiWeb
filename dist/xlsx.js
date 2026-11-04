// Minimal .xlsx writer (no dependencies): stored ZIP + SpreadsheetML. Cells: string | number | {pct:number} | null.
const enc = new TextEncoder();
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = bytes => { let c = 0xFFFFFFFF; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const esc = v => String(v).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const col = i => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
// Spreadsheet apps treat a leading = + - @ as a formula; neutralise it for text cells.
const safeText = v => /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;

function sheetXml(rows) {
  const widths = [];
  const body = rows.map((row, r) => `<row r="${r + 1}">${row.map((cell, c) => {
    if (cell === null || cell === undefined || cell === '') return '';
    const ref = col(c) + (r + 1);
    if (typeof cell === 'object') return `<c r="${ref}" s="1"><v>${cell.pct}</v></c>`;
    if (typeof cell === 'number') return `<c r="${ref}"><v>${cell}</v></c>`;
    const text = safeText(String(cell));
    widths[c] = Math.max(widths[c] ?? 8, Math.min(60, text.length + 2));
    return `<c r="${ref}" t="inlineStr"${r === 0 ? ' s="2"' : ''}><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${body}</sheetData></worksheet>`;
}

export function buildXlsx(sheets) {
  const names = sheets.map(s => esc(s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)));
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`,
  };
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s.rows); });
  return zip(files);
}

function zip(files) {
  const chunks = [], central = [];
  let offset = 0;
  const u16 = v => [v & 255, v >>> 8 & 255], u32 = v => [v & 255, v >>> 8 & 255, v >>> 16 & 255, v >>> 24 & 255];
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const head = Uint8Array.from([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0)]);
    chunks.push(head, nameBytes, data);
    central.push(Uint8Array.from([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), nameBytes);
    offset += head.length + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0), count = Object.keys(files).length;
  const end = Uint8Array.from([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(count), ...u16(count), ...u32(centralSize), ...u32(offset), ...u16(0)]);
  return new Blob([...chunks, ...central, end], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}

const dateTime = ms => ms == null ? '' : new Intl.DateTimeFormat('tr-TR', {dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul'}).format(new Date(ms));
const statusText = {active: 'Aktif', completed: 'Tamamlandı'};

/** Turns a report from the server into worksheets. */
export function reportSheets(report) {
  const summary = [['Etkinlik', 'Başlangıç', 'Bitiş', 'Konum', 'Durum', 'Katılan', 'Onaylı üye', 'Katılım oranı'],
    ...report.events.map(e => [e.title, dateTime(e.startMillis), dateTime(e.endMillis), e.locationName, statusText[e.status] ?? e.status, e.attendedCount, e.memberCount, e.rate == null ? '' : {pct: e.rate}])];
  const records = [['Etkinlik', 'Etkinlik tarihi', 'Ad soyad', 'Katılım saati', 'Telefon', 'E-posta', 'Konuma uzaklık (m)'],
    ...report.events.flatMap(e => e.records.sort((a, b) => (a.checkedInAtMillis ?? 0) - (b.checkedInAtMillis ?? 0)).map(r => [e.title, dateTime(e.startMillis), r.name, dateTime(r.checkedInAtMillis), r.phone, r.email, r.distanceMeters == null ? '' : Math.round(r.distanceMeters)]))];
  const people = [['Ad soyad', 'Telefon', 'E-posta', 'Katıldığı etkinlik', 'Toplam etkinlik', 'Katılım oranı'],
    ...report.members.map(m => [m.name, m.phone, m.email, m.attendedEvents, m.totalEvents, m.rate == null ? '' : {pct: m.rate}])];
  const attendanceByEvent = new Map(report.events.map(e => [e.id, new Map(e.records.map(r => [r.userId, r]))]));
  const attendanceStatus = [['Etkinlik', 'Etkinlik tarihi', 'Ad soyad', 'Telefon', 'E-posta', 'Durum', 'Katılım saati', 'Konuma uzaklık (m)']];
  for (const event of report.events) {
    const recordsByUser = attendanceByEvent.get(event.id) ?? new Map();
    for (const member of report.members) {
      const record = recordsByUser.get(member.userId);
      attendanceStatus.push([
        event.title,
        dateTime(event.startMillis),
        member.name,
        member.phone,
        member.email,
        record ? 'Katıldı' : 'Katılmadı',
        record ? dateTime(record.checkedInAtMillis) : '',
        record?.distanceMeters == null ? '' : Math.round(record.distanceMeters),
      ]);
    }
  }
  const attendedRows = [attendanceStatus[0], ...attendanceStatus.slice(1).filter(row => row[5] === 'Katıldı')];
  const missedRows = [attendanceStatus[0], ...attendanceStatus.slice(1).filter(row => row[5] === 'Katılmadı')];
  return [
    {name: 'Etkinlik özeti', rows: summary},
    {name: 'Katılım durumu', rows: attendanceStatus},
    {name: 'Katılanlar', rows: attendedRows},
    {name: 'Katılmayanlar', rows: missedRows},
    {name: 'Katılımlar', rows: records},
    {name: 'Kişi bazlı', rows: people},
  ];
}
