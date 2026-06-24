// ── SCHOOL TIMETABLE MODULE ──────────────────────────────────────────────────
// Drop into your Gradewick folder. Add to index.html AFTER app.js:
//   <script src="school-timetable.js"></script>
//
// Views available:
//   Grid: Day · Week
//   List: Day · Week · Month
// ─────────────────────────────────────────────────────────────────────────────

// ── Constants ─────────────────────────────────────────────────────────────────
const TT_STORAGE_KEY = 'gradewick_timetable_v1';
const TT_VIEW_KEY    = 'gradewick_timetable_view2';  // bumped key so old 'week'/'list' don't conflict
const TT_NAV_KEY     = 'gradewick_timetable_navdate';
const TT_IMPORT_KEY  = 'gradewick_timetable_ical_url';

const TT_COLOURS = [
  { bg:'#EDE9FE', border:'#7C3AED', text:'#4C1D95' },
  { bg:'#DBEAFE', border:'#2563EB', text:'#1E3A8A' },
  { bg:'#D1FAE5', border:'#059669', text:'#064E3B' },
  { bg:'#FEF3C7', border:'#D97706', text:'#78350F' },
  { bg:'#FCE7F3', border:'#DB2777', text:'#831843' },
  { bg:'#CCFBF1', border:'#0D9488', text:'#134E4A' },
  { bg:'#FFE4E6', border:'#E11D48', text:'#881337' },
  { bg:'#F3F4F6', border:'#6B7280', text:'#1F2937' },
];

const TT_DAYS_SHORT = ['Mon','Tue','Wed','Thu','Fri'];

// View config: id, label, group (grid/list)
const TT_VIEWS = [
  { id:'grid-day',   label:'Day',   group:'Grid' },
  { id:'grid-week',  label:'Week',  group:'Grid' },
  { id:'list-day',   label:'Day',   group:'List' },
  { id:'list-week',  label:'Week',  group:'List' },
  { id:'list-month', label:'Month', group:'List' },
];

const TT_GRID_START = 8;
const TT_GRID_END   = 20;
const TT_GRID_HOURS = TT_GRID_END - TT_GRID_START;
const TT_SLOT_PX    = 56;

// ── State ──────────────────────────────────────────────────────────────────────
let _ttView      = 'grid-week';
let _ttNavDate   = null;   // anchor date (Monday for week views, 1st for month, exact day for day)
let _ttEventModal = null;

// ── Storage ────────────────────────────────────────────────────────────────────
function ttLoad() {
  try { const r = localStorage.getItem(TT_STORAGE_KEY); return r ? JSON.parse(r) : {}; }
  catch { return {}; }
}
function ttSave(data) {
  try { localStorage.setItem(TT_STORAGE_KEY, JSON.stringify(data)); }
  catch { showToast('⚠ Timetable storage full or blocked.'); }
}
function ttGetEvents(yid) { return ttLoad()[yid] || []; }
function ttSetEvents(yid, events) { const d = ttLoad(); d[yid] = events; ttSave(d); }
function ttClearEvents(yid) { const d = ttLoad(); delete d[yid]; ttSave(d); }

// ── iCal parser ────────────────────────────────────────────────────────────────
function parseIcal(text) {
  const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT')   { if (cur && cur.start && cur.summary) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const ci = line.indexOf(':');
    if (ci === -1) continue;
    const propFull = line.slice(0, ci).toUpperCase();
    const value    = line.slice(ci + 1);
    const prop     = propFull.split(';')[0];
    switch (prop) {
      case 'UID':         cur.uid            = value; break;
      case 'SUMMARY':     cur.summary        = ttUnescape(value); break;
      case 'DESCRIPTION': cur.description    = ttUnescape(value); break;
      case 'LOCATION':    cur.location       = ttUnescape(value); break;
      case 'DTSTART':     cur.start          = ttParseIcalDate(value); break;
      case 'DTEND':       cur.end            = ttParseIcalDate(value); break;
      case 'ORGANIZER': {
        const cn = propFull.match(/CN=([^;:]+)/i);
        const em = value.match(/MAILTO:(.+)/i);
        cur.organiserName  = cn ? ttUnescape(cn[1]) : '';
        cur.organiserEmail = em ? em[1].trim() : '';
        break;
      }
    }
  }
  return events;
}

function ttParseIcalDate(s) {
  if (!s) return null;
  s = s.trim();
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] || ''}`);
  const d = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (d) return new Date(`${d[1]}-${d[2]}-${d[3]}T00:00:00`);
  return null;
}

function ttUnescape(s) {
  return (s || '').replace(/\\,/g,',').replace(/\\;/g,';').replace(/\\[nN]/g,'\n').replace(/\\\\/g,'\\');
}

// ── Colour assignment ──────────────────────────────────────────────────────────
const _ttColourMap = {};
let   _ttColourIdx = 0;

function ttModuleKey(summary) {
  if (!summary) return 'other';
  const m = summary.match(/^([A-Z]{2,4}\d{2,4})/i);
  return m ? m[1].toUpperCase() : (summary.split(' ')[0] || 'other').toUpperCase();
}
function ttGetColour(summary) {
  const key = ttModuleKey(summary);
  if (!_ttColourMap[key]) { _ttColourMap[key] = TT_COLOURS[_ttColourIdx % TT_COLOURS.length]; _ttColourIdx++; }
  return _ttColourMap[key];
}

// ── Date utilities ─────────────────────────────────────────────────────────────
function ttMondayOf(date) {
  const d = new Date(date), day = d.getDay();
  d.setDate(d.getDate() + ((day === 0) ? -6 : 1 - day));
  d.setHours(0,0,0,0); return d;
}
function ttFirstOfMonth(date) {
  const d = new Date(date); d.setDate(1); d.setHours(0,0,0,0); return d;
}
function ttAddDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); return d; }
function ttAddMonths(date, n) { const d = new Date(date); d.setMonth(d.getMonth() + n); return d; }
function ttFmtDay(d) { return d.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short', year:'numeric' }); }
function ttFmtTime(d) { return d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', hour12:false }); }
function ttFmtDayShort(d) { return d.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' }); }
function ttFmtMonthYear(d) { return d.toLocaleDateString('en-GB', { month:'long', year:'numeric' }); }
function ttSameDay(a, b) {
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}

// ── Nav anchor ─────────────────────────────────────────────────────────────────
function ttEnsureNavDate() {
  if (_ttNavDate) return;
  const saved = localStorage.getItem(TT_NAV_KEY);
  _ttNavDate = saved ? new Date(saved) : new Date();
  _ttNavDate.setHours(0,0,0,0);
}
function ttSaveNavDate() {
  if (_ttNavDate) localStorage.setItem(TT_NAV_KEY, _ttNavDate.toISOString());
}

// Navigate forward/back by the right unit for the current view
function ttNav(yid, delta) {
  ttEnsureNavDate();
  if (_ttView === 'grid-day' || _ttView === 'list-day')   _ttNavDate = ttAddDays(_ttNavDate, delta);
  else if (_ttView === 'grid-week' || _ttView === 'list-week') _ttNavDate = ttAddDays(_ttNavDate, delta * 7);
  else if (_ttView === 'list-month') _ttNavDate = ttAddMonths(_ttNavDate, delta);
  ttSaveNavDate();
  ttRenderPane(yid);
}
function ttGoToday(yid) {
  _ttNavDate = new Date(); _ttNavDate.setHours(0,0,0,0);
  ttSaveNavDate(); ttRenderPane(yid);
}
function ttSetView(yid, view) {
  _ttView = view; localStorage.setItem(TT_VIEW_KEY, view); ttRenderPane(yid);
}
function ttConfirmClear(yid) {
  if (!confirm('Delete all imported timetable events for this year? This cannot be undone.')) return;
  ttClearEvents(yid); ttRenderPane(yid); showToast('Timetable cleared.');
}

// ── Serialise / deserialise ────────────────────────────────────────────────────
function ttSerialiseEvent(ev) {
  return {
    uid: ev.uid||'', summary: ev.summary||'', description: ev.description||'',
    location: ev.location||'', organiserName: ev.organiserName||'', organiserEmail: ev.organiserEmail||'',
    start: ev.start ? ev.start.toISOString() : null,
    end:   ev.end   ? ev.end.toISOString()   : null,
  };
}
function ttDeserialiseEvent(ev) {
  return { ...ev, start: ev.start ? new Date(ev.start) : null, end: ev.end ? new Date(ev.end) : null };
}

// ── Import ─────────────────────────────────────────────────────────────────────
function ttOpenImport(yid) {
  document.getElementById('ttImportYid').value = yid;
  document.getElementById('ttImportUrl').value = localStorage.getItem(TT_IMPORT_KEY) || '';
  document.getElementById('ttImportStatus').textContent = '';
  openOverlay('ttImportOverlay');
}

async function ttImportFromUrl() {
  const yid      = document.getElementById('ttImportYid').value;
  const urlRaw   = document.getElementById('ttImportUrl').value.trim();
  const statusEl = document.getElementById('ttImportStatus');
  if (!urlRaw) { statusEl.textContent = '⚠ Please enter a URL.'; return; }
  localStorage.setItem(TT_IMPORT_KEY, urlRaw);

  const attempts = [
    { url: urlRaw,                                                              label:'Tabula directly…' },
    { url:`https://api.allorigins.win/raw?url=${encodeURIComponent(urlRaw)}`,   label:'via proxy 1…'     },
    { url:`https://corsproxy.io/?${encodeURIComponent(urlRaw)}`,                label:'via proxy 2…'     },
  ];

  let text = null, errorMsg = '';
  for (const attempt of attempts) {
    statusEl.textContent = `⏳ Fetching ${attempt.label}`;
    try {
      const ctrl = new AbortController();
      const t    = setTimeout(() => ctrl.abort(), 8000);
      const res  = await fetch(attempt.url, { cache:'no-store', signal:ctrl.signal });
      clearTimeout(t);
      if (!res.ok) { errorMsg = `HTTP ${res.status}`; continue; }
      const body = await res.text();
      if (body.includes('BEGIN:VCALENDAR')) { text = body; break; }
      errorMsg = 'Response was not a valid iCal file.';
    } catch (e) {
      errorMsg = e.name === 'AbortError' ? 'Timed out after 8s' : (e.message || 'Network error');
    }
  }

  if (!text) {
    statusEl.innerHTML = `<span style="color:var(--red)">❌ Could not fetch: ${escapeHTML(errorMsg)}<br>Try uploading the .ics file instead.</span>`;
    return;
  }
  const events = parseIcal(text);
  if (!events.length) {
    statusEl.innerHTML = `<span style="color:var(--red)">❌ Parsed 0 events — check the URL is a valid Tabula iCal link.</span>`;
    return;
  }
  ttSetEvents(yid, events.map(ttSerialiseEvent));
  Object.keys(_ttColourMap).forEach(k => delete _ttColourMap[k]); _ttColourIdx = 0;
  statusEl.innerHTML = `<span style="color:var(--gn)">✓ Imported ${events.length} events.</span>`;
  showToast(`✓ ${events.length} timetable events imported!`);
  setTimeout(() => { closeOverlayDirect('ttImportOverlay'); ttRenderPane(yid); }, 800);
}

function ttImportFromFile(input) {
  const yid = document.getElementById('ttImportYid').value;
  const file = input.files[0];
  const statusEl = document.getElementById('ttImportStatus');
  if (!file) return;
  statusEl.textContent = '⏳ Reading file…';
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    if (!text.includes('BEGIN:VCALENDAR')) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ Not a valid .ics calendar.</span>`; return;
    }
    const events = parseIcal(text);
    if (!events.length) { statusEl.innerHTML = `<span style="color:var(--red)">❌ No events found in file.</span>`; return; }
    ttSetEvents(yid, events.map(ttSerialiseEvent));
    Object.keys(_ttColourMap).forEach(k => delete _ttColourMap[k]); _ttColourIdx = 0;
    statusEl.innerHTML = `<span style="color:var(--gn)">✓ Imported ${events.length} events.</span>`;
    showToast(`✓ ${events.length} timetable events imported!`);
    setTimeout(() => { closeOverlayDirect('ttImportOverlay'); ttRenderPane(yid); }, 800);
  };
  reader.readAsText(file);
}

// ── Main pane ──────────────────────────────────────────────────────────────────
function ttRenderPane(yid) {
  const pane = document.getElementById(`sp-${yid}-schooltimetable`);
  if (!pane) return;
  pane.innerHTML = buildSchoolTimetable(getYear(yid));
}

function buildSchoolTimetable(yr) {
  ttEnsureNavDate();
  const rawEvents = ttGetEvents(yr.id);
  const events    = rawEvents.map(ttDeserialiseEvent);
  if (!events.length) return ttBuildEmpty(yr.id);

  // ── View switcher toolbar ──
  // Two pill groups: Grid (Day|Week) and List (Day|Week|Month)
  const groups = ['Grid','List'];
  const switcherParts = groups.map(grp => {
    const btns = TT_VIEWS.filter(v => v.group === grp).map(v =>
      `<button class="tt-flt ${_ttView===v.id?'active':''}" onclick="ttSetView('${yr.id}','${v.id}')">${v.label}</button>`
    ).join('');
    return `<div class="tt-view-group">
      <span class="tt-view-grp-lbl">${grp}</span>
      <div class="tt-view-grp-btns">${btns}</div>
    </div>`;
  }).join('');

  const toolbar = `
    <div class="tt-toolbar">
      <div class="tt-view-switcher">${switcherParts}</div>
      <div class="tt-toolbar-actions">
        <button class="btn btn-ghost btn-sm" onclick="ttOpenImport('${yr.id}')">↻ Re-import</button>
        <button class="btn btn-danger btn-sm" onclick="ttConfirmClear('${yr.id}')">🗑 Clear</button>
      </div>
    </div>`;

  let content = '';
  if      (_ttView === 'grid-day')   content = ttBuildGridDay(yr.id, events);
  else if (_ttView === 'grid-week')  content = ttBuildGridWeek(yr.id, events);
  else if (_ttView === 'list-day')   content = ttBuildListFiltered(yr.id, events, 'day');
  else if (_ttView === 'list-week')  content = ttBuildListFiltered(yr.id, events, 'week');
  else if (_ttView === 'list-month') content = ttBuildListFiltered(yr.id, events, 'month');

  return toolbar + content;
}

function ttBuildEmpty(yid) {
  return `
    <div class="empty-state-card" style="margin-top:0">
      <div class="empty-state-icon">📅</div>
      <div class="empty-state-title">No timetable yet</div>
      <div class="empty-state-sub">
        Import your Tabula iCal URL or upload a .ics file to see your full lecture timetable here.<br>
        <span style="font-family:var(--fm);font-size:10px;color:var(--tx4);display:block;margin-top:6px">
          Find your link at <strong>tabula.warwick.ac.uk → Timetable → Export calendar</strong>
        </span>
      </div>
      <button class="btn btn-primary" style="margin-top:20px" onclick="ttOpenImport('${yid}')">📥 Import iCal</button>
    </div>`;
}

// ── Shared nav bar ─────────────────────────────────────────────────────────────
function ttNavBar(yid, label) {
  return `
    <div class="tt-week-nav">
      <button class="icon-btn" onclick="ttNav('${yid}',-1)" title="Previous">◀</button>
      <div class="tt-week-label">${label}</div>
      <button class="icon-btn" onclick="ttNav('${yid}',1)" title="Next">▶</button>
      <button class="btn btn-ghost btn-sm" onclick="ttGoToday('${yid}')">Today</button>
    </div>`;
}

// ── Grid: Day ──────────────────────────────────────────────────────────────────
function ttBuildGridDay(yid, events) {
  const day   = new Date(_ttNavDate); day.setHours(0,0,0,0);
  const today = new Date(); today.setHours(0,0,0,0);
  const isToday = ttSameDay(day, today);

  const label = ttFmtDay(day);
  const nav   = ttNavBar(yid, label);

  // Hour lines
  let hourLines = '';
  for (let h = TT_GRID_START; h <= TT_GRID_END; h++) {
    hourLines += `<div class="tt-hour-line" style="top:${(h-TT_GRID_START)*TT_SLOT_PX}px">
      <span class="tt-hour-lbl">${String(h).padStart(2,'0')}:00</span>
    </div>`;
  }

  // Now line
  let nowLine = '';
  if (isToday) {
    const now  = new Date();
    const mins = (now.getHours()-TT_GRID_START)*60 + now.getMinutes();
    const top  = Math.round(mins/60*TT_SLOT_PX);
    if (top >= 0 && top <= TT_GRID_HOURS*TT_SLOT_PX) {
      nowLine = `<div class="tt-now-line tt-now-line-day" style="top:${top}px">
        <span class="tt-now-dot"></span><span class="tt-now-bar"></span>
      </div>`;
    }
  }

  const dayEvents = events.filter(ev =>
    ev.start && ttSameDay(ev.start, day) &&
    ev.start.getHours() >= TT_GRID_START && ev.start.getHours() < TT_GRID_END
  ).sort((a,b) => a.start - b.start);

  const blocks = dayEvents.map(ev => ttBuildEventBlockDay(yid, ev)).join('');
  const gridHeight = TT_GRID_HOURS * TT_SLOT_PX;

  return `
    ${nav}
    <div class="tt-week-grid-wrap">
      <div class="tt-col-headers tt-col-headers-day">
        <div class="tt-time-gutter"></div>
        <div class="tt-col-hdr ${isToday?'tt-today-hdr':''}" style="flex:1">
          <div class="tt-col-day">${day.toLocaleDateString('en-GB',{weekday:'long'})}</div>
          <div class="tt-col-date ${isToday?'tt-today-badge':''}">${day.getDate()} ${day.toLocaleDateString('en-GB',{month:'short',year:'numeric'})}</div>
        </div>
      </div>
      <div class="tt-grid-body" style="height:${gridHeight}px">
        <div class="tt-gutter-col">${hourLines}</div>
        <div class="tt-events-area tt-events-area-day" style="height:${gridHeight}px;position:relative">
          ${blocks}
          ${nowLine}
          ${!dayEvents.length ? `<div style="position:absolute;top:40px;left:0;right:0;text-align:center;font-family:var(--fm);font-size:12px;color:var(--tx4);font-style:italic">No classes today</div>` : ''}
        </div>
      </div>
    </div>`;
}

function ttBuildEventBlockDay(yid, ev) {
  if (!ev.start || !ev.end) return '';
  const startMins = (ev.start.getHours()-TT_GRID_START)*60 + ev.start.getMinutes();
  const durMins   = Math.round((ev.end - ev.start)/60000);
  const top       = Math.round(startMins/60*TT_SLOT_PX);
  const height    = Math.max(Math.round(durMins/60*TT_SLOT_PX)-2, 20);
  const col       = ttGetColour(ev.summary);
  const code      = ttModuleKey(ev.summary);
  const title     = ev.summary.replace(/^[A-Z]{2,4}\d{2,4}\s*/i,'').replace(/\s+[A-Z]{2,4}\d{2,4}[A-Z]?\s*(\{.*\})?$/,'').trim() || ev.summary;
  const typeTag   = ttEventTypeTag(ev.summary);
  const safeUid   = escapeHTML(ev.uid||'');
  return `
    <div class="tt-event-block tt-event-block-day" style="top:${top}px;height:${height}px;background:${col.bg};border-left:3px solid ${col.border};color:${col.text}"
         onclick="ttOpenEvent('${yid}','${safeUid}')" title="${escapeHTML(ev.summary)}">
      <div class="tt-ev-code">${escapeHTML(code)}${typeTag?` <span class="tt-ev-type">${typeTag}</span>`:''}</div>
      ${height>=30?`<div class="tt-ev-title">${escapeHTML(title)}</div>`:''}
      ${height>=46&&ev.location?`<div class="tt-ev-loc">📍 ${escapeHTML(ev.location)}</div>`:''}
      ${height>=62?`<div class="tt-ev-loc">⏰ ${ttFmtTime(ev.start)} – ${ttFmtTime(ev.end)}</div>`:''}
    </div>`;
}

// ── Grid: Week ─────────────────────────────────────────────────────────────────
function ttBuildGridWeek(yid, events) {
  const mon   = ttMondayOf(_ttNavDate);
  const fri   = ttAddDays(mon, 4);
  const today = new Date(); today.setHours(0,0,0,0);
  const nav   = ttNavBar(yid, `${ttFmtDayShort(mon)} – ${ttFmtDayShort(fri)}`);

  const dayHeaders = TT_DAYS_SHORT.map((d,i) => {
    const date = ttAddDays(mon,i); const isT = ttSameDay(date,today);
    return `<div class="tt-col-hdr ${isT?'tt-today-hdr':''}">
      <div class="tt-col-day">${d}</div>
      <div class="tt-col-date ${isT?'tt-today-badge':''}">${date.getDate()}</div>
    </div>`;
  }).join('');

  let hourLines = '';
  for (let h = TT_GRID_START; h <= TT_GRID_END; h++) {
    hourLines += `<div class="tt-hour-line" style="top:${(h-TT_GRID_START)*TT_SLOT_PX}px">
      <span class="tt-hour-lbl">${String(h).padStart(2,'0')}:00</span>
    </div>`;
  }

  const now = new Date();
  let nowLine = '';
  const isCurWeek = now >= mon && now < ttAddDays(fri,1);
  if (isCurWeek) {
    const di = (now.getDay()+6)%7;
    if (di < 5) {
      const mins = (now.getHours()-TT_GRID_START)*60+now.getMinutes();
      const top  = Math.round(mins/60*TT_SLOT_PX);
      if (top>=0 && top<=TT_GRID_HOURS*TT_SLOT_PX) {
        nowLine = `<div class="tt-now-line" style="top:${top}px;left:calc(${di} * (100% / 5))">
          <span class="tt-now-dot"></span><span class="tt-now-bar"></span>
        </div>`;
      }
    }
  }

  const dayColumns = TT_DAYS_SHORT.map((_,di) => {
    const colDate   = ttAddDays(mon,di);
    const dayEvents = events.filter(ev =>
      ev.start && ttSameDay(ev.start,colDate) &&
      ev.start.getHours()>=TT_GRID_START && ev.start.getHours()<TT_GRID_END
    ).sort((a,b)=>a.start-b.start);
    return `<div class="tt-day-col">${dayEvents.map(ev=>ttBuildEventBlock(yid,ev)).join('')}</div>`;
  }).join('');

  const gridHeight = TT_GRID_HOURS * TT_SLOT_PX;
  return `
    ${nav}
    <div class="tt-week-grid-wrap">
      <div class="tt-col-headers"><div class="tt-time-gutter"></div>${dayHeaders}</div>
      <div class="tt-grid-body" style="height:${gridHeight}px">
        <div class="tt-gutter-col">${hourLines}</div>
        <div class="tt-events-area" style="height:${gridHeight}px">${dayColumns}${nowLine}</div>
      </div>
    </div>`;
}

function ttBuildEventBlock(yid, ev) {
  if (!ev.start||!ev.end) return '';
  const startMins = (ev.start.getHours()-TT_GRID_START)*60+ev.start.getMinutes();
  const durMins   = Math.round((ev.end-ev.start)/60000);
  const top       = Math.round(startMins/60*TT_SLOT_PX);
  const height    = Math.max(Math.round(durMins/60*TT_SLOT_PX)-2, 20);
  const col       = ttGetColour(ev.summary);
  const code      = ttModuleKey(ev.summary);
  const title     = ev.summary.replace(/^[A-Z]{2,4}\d{2,4}\s*/i,'').replace(/\s+[A-Z]{2,4}\d{2,4}[A-Z]?\s*(\{.*\})?$/,'').trim()||ev.summary;
  const typeTag   = ttEventTypeTag(ev.summary);
  const safeUid   = escapeHTML(ev.uid||'');
  return `
    <div class="tt-event-block" style="top:${top}px;height:${height}px;background:${col.bg};border-left:3px solid ${col.border};color:${col.text}"
         onclick="ttOpenEvent('${yid}','${safeUid}')" title="${escapeHTML(ev.summary)}">
      <div class="tt-ev-code">${escapeHTML(code)}${typeTag?` <span class="tt-ev-type">${typeTag}</span>`:''}</div>
      ${height>=36?`<div class="tt-ev-title">${escapeHTML(title)}</div>`:''}
      ${height>=52&&ev.location?`<div class="tt-ev-loc">📍 ${escapeHTML(ev.location)}</div>`:''}
    </div>`;
}

// ── List views (Day / Week / Month) ────────────────────────────────────────────
function ttBuildListFiltered(yid, events, range) {
  ttEnsureNavDate();
  const today = new Date(); today.setHours(0,0,0,0);

  let rangeStart, rangeEnd, navLabel, prevNext;

  if (range === 'day') {
    rangeStart = new Date(_ttNavDate); rangeStart.setHours(0,0,0,0);
    rangeEnd   = new Date(rangeStart); rangeEnd.setHours(23,59,59,999);
    navLabel   = ttFmtDay(rangeStart);
  } else if (range === 'week') {
    rangeStart = ttMondayOf(_ttNavDate);
    rangeEnd   = ttAddDays(rangeStart, 6); rangeEnd.setHours(23,59,59,999);
    navLabel   = `${ttFmtDayShort(rangeStart)} – ${ttFmtDayShort(ttAddDays(rangeStart,6))}`;
  } else { // month
    rangeStart = ttFirstOfMonth(_ttNavDate);
    rangeEnd   = ttAddMonths(rangeStart, 1); rangeEnd.setDate(0); rangeEnd.setHours(23,59,59,999);
    navLabel   = ttFmtMonthYear(rangeStart);
  }

  const nav = ttNavBar(yid, navLabel);

  const filtered = events
    .filter(ev => ev.start && ev.start >= rangeStart && ev.start <= rangeEnd)
    .sort((a,b) => a.start - b.start);

  if (!filtered.length) {
    return nav + `<div class="tt-empty" style="margin-top:12px">No classes in this ${range}.</div>`;
  }

  // Group by day
  const groups = {};
  filtered.forEach(ev => {
    const key = ev.start.toDateString();
    if (!groups[key]) groups[key] = { date: ev.start, events:[] };
    groups[key].events.push(ev);
  });

  let html = nav + '<div class="tt-list-wrap">';
  for (const [, grp] of Object.entries(groups)) {
    const isT = ttSameDay(grp.date, today);
    html += `<div class="tt-list-day-hdr ${isT?'tt-list-today':''}">${isT?'⬤ ':''}${ttFmtDay(grp.date)}</div>`;
    grp.events.forEach(ev => {
      const col     = ttGetColour(ev.summary);
      const typeTag = ttEventTypeTag(ev.summary);
      const durMins = ev.end ? Math.round((ev.end-ev.start)/60000) : null;
      const durStr  = durMins ? `${Math.floor(durMins/60)}h${durMins%60?` ${durMins%60}m`:''}` : '';
      html += `
        <div class="tt-list-event" style="border-left:3px solid ${col.border};background:${col.bg}"
             onclick="ttOpenEvent('${yid}','${escapeHTML(ev.uid||'')}')">
          <div class="tt-list-time">${ttFmtTime(ev.start)}${ev.end?` – ${ttFmtTime(ev.end)}`:''}${durStr?` <span style="color:${col.border};opacity:.7">(${durStr})</span>`:''}</div>
          <div class="tt-list-title">
            <span class="tt-ev-code-pill" style="background:${col.border}20;color:${col.text};border:1px solid ${col.border}40">${escapeHTML(ttModuleKey(ev.summary))}</span>
            ${escapeHTML(ev.summary)}
            ${typeTag?`<span class="tt-ev-type" style="background:${col.border}15;color:${col.text}">${typeTag}</span>`:''}
          </div>
          ${ev.location?`<div class="tt-list-loc">📍 ${escapeHTML(ev.location)}</div>`:''}
        </div>`;
    });
  }
  html += '</div>';

  // Month: show a compact summary count bar at the top
  if (range === 'month') {
    const countByDay = {};
    filtered.forEach(ev => {
      const k = ev.start.toDateString();
      countByDay[k] = (countByDay[k]||0) + 1;
    });
    const totalDays = Object.keys(countByDay).length;
    const summary = `<div class="tt-month-summary">
      <span>${filtered.length} classes</span>
      <span style="color:var(--tx4)">·</span>
      <span>${totalDays} teaching day${totalDays!==1?'s':''}</span>
      <span style="color:var(--tx4)">·</span>
      <span>${ttFmtMonthYear(rangeStart)}</span>
    </div>`;
    html = nav + summary + '<div class="tt-list-wrap">' + html.slice((nav + '<div class="tt-list-wrap">').length);
  }

  return html;
}

// ── Event type tag ─────────────────────────────────────────────────────────────
function ttEventTypeTag(summary) {
  if (!summary) return '';
  const m = summary.match(/[A-Z]{2,4}\d{2,4}([LSPW])\s*(?:\{.*\})?$/i);
  if (!m) return '';
  return {L:'Lecture',P:'Practical',S:'Seminar',W:'Workshop'}[m[1].toUpperCase()]||m[1];
}

// ── Event detail modal ─────────────────────────────────────────────────────────
function ttOpenEvent(yid, uid) {
  const events = ttGetEvents(yid).map(ttDeserialiseEvent);
  const ev = events.find(e => e.uid === uid);
  if (!ev) return;
  _ttEventModal = ev;

  const col     = ttGetColour(ev.summary);
  const durMins = ev.start&&ev.end ? Math.round((ev.end-ev.start)/60000) : null;
  const durStr  = durMins ? `${Math.floor(durMins/60)}h${durMins%60?` ${durMins%60}m`:''}` : '—';
  const typeTag = ttEventTypeTag(ev.summary);
  const code    = ttModuleKey(ev.summary);

  const modal = document.getElementById('ttEventModal');
  if (!modal) return;

  document.getElementById('ttev-modbadge').style.cssText =
    `background:${col.bg};color:${col.text};border:1px solid ${col.border}40;font-family:var(--fm);font-size:11px;padding:3px 9px;border-radius:6px`;
  document.getElementById('ttev-modbadge').textContent = code;
  document.getElementById('ttev-typebadge').innerHTML  = typeTag
    ? `<span style="font-family:var(--fm);font-size:10px;color:${col.text};background:${col.border}20;border:1px solid ${col.border}40;padding:2px 7px;border-radius:4px">${typeTag}</span>`
    : '';
  document.getElementById('ttev-title').textContent = ev.summary;

  let grid = '';
  if (ev.start) {
    grid += `<div class="modal-det"><div class="modal-det-lbl">📅 Date</div><div class="modal-det-val hl">${ttFmtDay(ev.start)}</div></div>`;
    grid += `<div class="modal-det"><div class="modal-det-lbl">⏰ Time</div><div class="modal-det-val hl">${ttFmtTime(ev.start)}${ev.end?' – '+ttFmtTime(ev.end):''}</div></div>`;
  }
  grid += `<div class="modal-det"><div class="modal-det-lbl">⏱ Duration</div><div class="modal-det-val">${durStr}</div></div>`;
  if (ev.location)      grid += `<div class="modal-det full"><div class="modal-det-lbl">📍 Venue</div><div class="modal-det-val" style="font-size:13px">${escapeHTML(ev.location)}</div></div>`;
  if (ev.organiserName) grid += `<div class="modal-det full"><div class="modal-det-lbl">👤 Organiser</div><div class="modal-det-val" style="font-size:13px">${escapeHTML(ev.organiserName)}${ev.organiserEmail?` <a href="mailto:${escapeHTML(ev.organiserEmail)}" style="color:var(--accent-mid);font-size:11px;margin-left:6px">${escapeHTML(ev.organiserEmail)}</a>`:''}</div></div>`;
  document.getElementById('ttev-grid').innerHTML = grid;

  const descEl = document.getElementById('ttev-desc');
  if (ev.description&&ev.description.trim()) {
    descEl.style.display = 'block';
    descEl.querySelector('.ttev-desc-body').innerHTML = escapeHTML(ev.description).replace(/\n/g,'<br>');
  } else { descEl.style.display = 'none'; }

  openOverlay('ttEventModal');
}

// ── DOM injection ──────────────────────────────────────────────────────────────
function ttInjectDOM() {
  // Import overlay
  const importOverlay = document.createElement('div');
  importOverlay.className = 'overlay'; importOverlay.id = 'ttImportOverlay';
  importOverlay.setAttribute('onclick', "closeOverlay('ttImportOverlay',event)");
  importOverlay.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-hdr">
        <button class="modal-close" aria-label="Close" onclick="closeOverlayDirect('ttImportOverlay')">✕</button>
        <div style="font-family:var(--fm);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--tx3);margin-bottom:6px">Tabula Calendar</div>
        <div style="font-family:var(--fd);font-size:20px;font-weight:800">Import Timetable</div>
      </div>
      <div class="modal-body">
        <input type="hidden" id="ttImportYid" />
        <div class="settings-section-title">From Tabula iCal URL</div>
        <p style="font-family:var(--fm);font-size:11px;color:var(--tx3);margin-bottom:12px;line-height:1.65">
          Go to <strong>tabula.warwick.ac.uk → Profile → Export calendar</strong> and copy the URL ending in <code>.ics</code>.
        </p>
        <div class="form-row">
          <label for="ttImportUrl">iCal URL</label>
          <input class="form-inp" id="ttImportUrl" placeholder="https://tabula.warwick.ac.uk/…/calendar/….ics" />
        </div>
        <button class="btn btn-primary" onclick="ttImportFromUrl()">📥 Fetch &amp; Import</button>
        <div class="settings-section-title" style="margin-top:24px">Or upload a .ics file</div>
        <p style="font-family:var(--fm);font-size:11px;color:var(--tx3);margin-bottom:12px;line-height:1.65">
          Download the .ics from Tabula and upload it here.
        </p>
        <label class="btn btn-ghost" style="cursor:pointer">
          📎 Choose .ics file
          <input type="file" accept=".ics,text/calendar" style="display:none" onchange="ttImportFromFile(this)" />
        </label>
        <div id="ttImportStatus" style="margin-top:16px;font-family:var(--fm);font-size:12px;line-height:1.6"></div>
        <div class="privacy-badge" style="margin-top:20px">
          <span class="privacy-badge-icon">🔒</span>
          <div><strong>Stored locally only.</strong><span>Your timetable never leaves your device.</span></div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(importOverlay);

  // Event modal
  const eventModal = document.createElement('div');
  eventModal.className = 'overlay'; eventModal.id = 'ttEventModal';
  eventModal.setAttribute('onclick', "closeOverlay('ttEventModal',event)");
  eventModal.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-hdr">
        <button class="modal-close" aria-label="Close" onclick="closeOverlayDirect('ttEventModal')">✕</button>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span id="ttev-modbadge"></span><span id="ttev-typebadge"></span>
        </div>
        <div style="font-family:var(--fd);font-size:18px;font-weight:800;line-height:1.25" id="ttev-title"></div>
      </div>
      <div class="modal-body">
        <div class="modal-detail-grid" id="ttev-grid"></div>
        <div id="ttev-desc" style="display:none">
          <div class="modal-mark-lbl" style="margin-top:4px">Description</div>
          <div class="ttev-desc-body" style="font-family:var(--fm);font-size:12px;color:var(--tx2);line-height:1.7"></div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(eventModal);

  // Sidebar footer shortcut
  const footer = document.querySelector('.sidebar-footer');
  if (footer) {
    const btn = document.createElement('button');
    btn.className = 'nav-btn';
    btn.onclick = () => { const yr = activeYear(); if (yr) { switchSubtab(yr.id,'schooltimetable'); closeSidebar(); } };
    btn.innerHTML = `<div class="nav-btn-left"><span class="nav-icon"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/></svg></span> <span class="nav-lbl">School Timetable</span></div>`;
    footer.insertBefore(btn, footer.firstChild);
  }
}

// ── CSS injection ──────────────────────────────────────────────────────────────
function ttInjectCSS() {
  const style = document.createElement('style');
  style.textContent = `
/* ── SCHOOL TIMETABLE ──────────────────────────────────────────── */

/* Toolbar */
.tt-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 10px; margin-bottom: 20px;
  background: var(--s1); border: 1.5px solid var(--b1);
  border-radius: var(--r-md); padding: 10px 14px;
}
.tt-view-switcher { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.tt-view-group    { display: flex; align-items: center; gap: 6px; }
.tt-view-grp-lbl  {
  font-family: var(--fm); font-size: 9.5px; letter-spacing: .1em;
  text-transform: uppercase; color: var(--tx4); white-space: nowrap;
}
.tt-view-grp-btns { display: flex; gap: 4px; }
.tt-toolbar-actions { display: flex; gap: 8px; }

/* Nav bar */
.tt-week-nav {
  display: flex; align-items: center; gap: 10px; margin-bottom: 14px;
  background: var(--s1); border: 1.5px solid var(--b1);
  border-radius: var(--r-md); padding: 10px 16px;
}
.tt-week-label {
  flex: 1; text-align: center; font-family: var(--fd);
  font-size: 14px; font-weight: 700; color: var(--tx);
}

/* Grid shared */
.tt-week-grid-wrap {
  background: var(--s1); border: 1.5px solid var(--b1);
  border-radius: var(--r-md); overflow: hidden; margin-bottom: 20px;
}
.tt-col-headers {
  display: grid; grid-template-columns: 48px repeat(5, 1fr);
  border-bottom: 1.5px solid var(--b1);
  background: var(--s1); border-radius: var(--r-md) var(--r-md) 0 0; overflow: hidden;
}
.tt-col-headers-day { grid-template-columns: 48px 1fr; }
.tt-time-gutter { width: 48px; }
.tt-col-hdr { padding: 8px 4px 6px; text-align: center; border-left: 1px solid var(--b1); }
.tt-col-hdr.tt-today-hdr { background: var(--accent-bg); }
.tt-col-day  { font-family: var(--fm); font-size: 10px; letter-spacing:.08em; text-transform:uppercase; color:var(--tx3); }
.tt-col-date { font-family: var(--fd); font-size: 18px; font-weight: 800; color: var(--tx); line-height:1.1; margin-top:2px; }
.tt-today-badge {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--accent-mid); color: var(--s1); font-size: 14px; margin: 0 auto;
}
.tt-grid-body  { display: flex; position: relative; overflow-y: auto; overflow-x: hidden; }
.tt-gutter-col { width: 48px; flex-shrink: 0; position: relative; border-right: 1px solid var(--b1); }
.tt-hour-line  { position:absolute; left:0; right:0; border-top:1px dashed var(--b1); width:100%; display:flex; align-items:flex-start; }
.tt-hour-lbl   { font-family:var(--fm); font-size:9px; color:var(--tx4); padding:0 4px; line-height:1; transform:translateY(-6px); white-space:nowrap; }
.tt-events-area { flex:1; display:grid; grid-template-columns:repeat(5,1fr); position:relative; overflow:hidden; }
.tt-events-area-day { display:block; }
.tt-day-col { position:relative; border-left:1px solid var(--b1); }

/* Now line */
.tt-now-line { position:absolute; width:calc(100% / 5); z-index:10; display:flex; align-items:center; pointer-events:none; }
.tt-now-line-day { width:100%; }
.tt-now-dot  { width:8px; height:8px; border-radius:50%; background:var(--red); flex-shrink:0; margin-left:-4px; }
.tt-now-bar  { flex:1; height:1.5px; background:var(--red); opacity:.7; }

/* Event blocks */
.tt-event-block {
  position:absolute; left:2px; right:2px;
  border-radius:5px; padding:3px 5px; cursor:pointer; overflow:hidden;
  transition:transform var(--t-fast) var(--spring), box-shadow var(--t-fast);
  font-size:11px; line-height:1.25; z-index:2;
}
.tt-event-block-day { left:4px; right:4px; }
.tt-event-block:hover { transform:scale(1.02) translateY(-1px); box-shadow:0 4px 12px rgba(0,0,0,.15); z-index:5; }
.tt-ev-code  { font-family:var(--fm); font-size:9px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; opacity:.85; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.tt-ev-title { font-family:var(--fd); font-size:10px; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:1px; }
.tt-ev-loc   { font-family:var(--fm); font-size:9px; opacity:.75; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:1px; }
.tt-ev-type  { font-family:var(--fm); font-size:8px; font-weight:500; opacity:.75; text-transform:uppercase; letter-spacing:.05em; }

/* List shared */
.tt-list-wrap { display:flex; flex-direction:column; gap:4px; }
.tt-list-day-hdr {
  font-family:var(--fd); font-size:14px; font-weight:800; color:var(--tx);
  padding:16px 0 6px; border-bottom:1.5px solid var(--b1); margin-top:8px;
}
.tt-list-day-hdr:first-child { margin-top:0; }
.tt-list-day-hdr.tt-list-today { color:var(--accent-mid); }
.tt-list-event {
  display:flex; flex-direction:column; gap:3px;
  padding:10px 14px; border-radius:var(--r-md); cursor:pointer;
  transition:transform var(--t-fast) var(--spring), box-shadow var(--t-fast); margin-bottom:4px;
}
.tt-list-event:hover { transform:translateX(4px); box-shadow:0 2px 8px rgba(0,0,0,.08); }
.tt-list-time  { font-family:var(--fm); font-size:11px; color:var(--tx3); font-weight:500; }
.tt-list-title { font-family:var(--fd); font-size:14px; font-weight:700; color:var(--tx); display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.tt-list-loc   { font-family:var(--fm); font-size:11px; color:var(--tx3); }
.tt-ev-code-pill { font-family:var(--fm); font-size:10px; font-weight:600; padding:2px 6px; border-radius:4px; white-space:nowrap; }

/* Month summary pill */
.tt-month-summary {
  display:flex; align-items:center; gap:8px; flex-wrap:wrap;
  font-family:var(--fm); font-size:11px; color:var(--tx3);
  background:var(--s2); border:1px solid var(--b1);
  border-radius:var(--r-md); padding:8px 14px; margin-bottom:16px;
}

/* Dark mode */
[data-theme="dark"] .tt-event-block { opacity:.92; }
[data-theme="dark"] .tt-event-block:hover { opacity:1; }

/* Mobile */
@media (max-width:640px) {
  .tt-col-hdr  { padding:6px 2px 4px; }
  .tt-col-date { font-size:14px; }
  .tt-ev-title { display:none; }
  .tt-week-label { font-size:12px; }
  .tt-view-switcher { gap:8px; }
}
`;
  document.head.appendChild(style);
}

// ── Hook into Gradewick ────────────────────────────────────────────────────────

const _origRenderSidebarNav = renderSidebarNav;
window.renderSidebarNav = function(yid) {
  _origRenderSidebarNav(yid);
  const nav = document.getElementById('sidebarNav'); if (!nav) return;
  const st  = _yearSubtabs[yid] || APP.lastTab?.[yid] || 'dashboard';
  const btn = document.createElement('div');
  btn.className = `nav-btn ${st==='schooltimetable'?'active':''}`;
  btn.setAttribute('onclick', `switchSubtab('${yid}','schooltimetable')`);
  btn.innerHTML = `<div class="nav-btn-left"><span class="nav-icon"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/></svg></span> <span class="nav-lbl">${APP.settings.tabNames?.schooltimetable||'School Timetable'}</span></div>`;
  nav.appendChild(btn);
};

const _origRenderYearPane = renderYearPane;
window.renderYearPane = function(yid) {
  _origRenderYearPane(yid);
  const yr = getYear(yid), pane = document.getElementById('pane-'+yid);
  if (!pane||!yr) return;
  const st = _yearSubtabs[yid]||APP.lastTab?.[yid]||'dashboard';
  if (!document.getElementById(`sp-${yid}-schooltimetable`)) {
    const sp = document.createElement('div');
    sp.className = `subpane${st==='schooltimetable'?' active':''}`;
    sp.id = `sp-${yid}-schooltimetable`; pane.appendChild(sp);
  }
  if (st==='schooltimetable') ttRenderPane(yid);
};

const _origSwitchSubtab = switchSubtab;
window.switchSubtab = function(yid, st) {
  if (st !== 'schooltimetable') { _origSwitchSubtab(yid, st); return; }
  _yearSubtabs[yid] = st;
  if (!APP.lastTab) APP.lastTab = {};
  APP.lastTab[yid] = st;
  if (APP.activeOverview) {
    APP.activeOverview = false; APP.activeYear = yid;
    const ov = document.getElementById('pane-overview');
    if (ov) { ov.style.display='none'; ov.classList.remove('active'); }
    const yp = document.getElementById('pane-'+yid);
    if (yp) { yp.style.display='block'; yp.classList.add('active'); }
    renderYearsNav();
  }
  persist();
  document.querySelectorAll(`#pane-${yid} > .subpane`).forEach(p => p.classList.remove('active'));
  let sp = document.getElementById(`sp-${yid}-schooltimetable`);
  if (!sp) {
    sp = document.createElement('div'); sp.className='subpane active'; sp.id=`sp-${yid}-schooltimetable`;
    const yp = document.getElementById('pane-'+yid); if (yp) yp.appendChild(sp);
  } else { sp.classList.add('active'); }
  ttRenderPane(yid); renderSidebarNav(yid); renderHeader(); closeSidebar();
};

const _origRenderHeader = renderHeader;
window.renderHeader = function() {
  _origRenderHeader();
  const yr = activeYear(); if (!yr) return;
  const st = _yearSubtabs[yr.id]||APP.lastTab?.[yr.id]||'dashboard';
  if (st!=='schooltimetable') return;
  const name = APP.settings.name ? `<span class="hl">${APP.settings.name}'s </span>` : '';
  const h1   = document.getElementById('hdrTitle');
  if (h1) h1.innerHTML = `${name}School Timetable`;
};

if (typeof DEFAULT_TAB_NAMES !== 'undefined') DEFAULT_TAB_NAMES.schooltimetable = 'School Timetable';

// ── Init ───────────────────────────────────────────────────────────────────────
(function ttInit() {
  const saved = localStorage.getItem(TT_VIEW_KEY);
  if (saved && TT_VIEWS.some(v=>v.id===saved)) _ttView = saved;
  if (document.readyState==='loading') {
    document.addEventListener('DOMContentLoaded', ()=>{ ttInjectCSS(); ttInjectDOM(); });
  } else { ttInjectCSS(); ttInjectDOM(); }
})();
