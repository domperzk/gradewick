// ── SCHOOL TIMETABLE MODULE ──────────────────────────────────────────────────
// Drop this file into your Gradewick folder and add the following to index.html:
//   <script src="school-timetable.js"></script>
// Place it AFTER app.js in the load order.
//
// What this adds:
//  • A new "School Timetable" tab in every year's main sidebar navigation
//    (and nowhere else — there is intentionally no duplicate entry in the
//    sidebar footer)
//  • iCal import via URL (Tabula) or file upload (.ics)
//  • Per-year calendar storage in localStorage (separate key so it never
//    touches gradetracker_v7 data)
//  • Four view modes: Day grid, Week grid (Mon–Fri, 08:00–20:00), Month
//    grid, and a List view — and the List view itself can be scoped to
//    Day / Week / Month
//  • "Today" button, prev/next navigation (granularity matches the active
//    view/period — a day, a week, or a month)
//  • Event detail modal with all fields (summary, location, description,
//    organiser, time, duration)
//  • Module-code colour coding that auto-matches Gradewick accent palette
// ─────────────────────────────────────────────────────────────────────────────

// ── Constants ──────────────────────────────────────────────────────────────
const TT_STORAGE_KEY    = 'gradewick_timetable_v1';
const TT_VIEW_KEY       = 'gradewick_timetable_view';        // 'day' | 'week' | 'month' | 'list'
const TT_LIST_PER_KEY   = 'gradewick_timetable_list_period';  // 'day' | 'week' | 'month'
const TT_ANCHOR_KEY     = 'gradewick_timetable_anchor';       // ISO string of the currently navigated date
const TT_WEEK_KEY       = 'gradewick_timetable_week';         // legacy key, read once for migration
const TT_IMPORT_KEY     = 'gradewick_timetable_ical_url';

// Colour palette for module codes (cycles through these)
const TT_COLOURS = [
  { bg:'#EDE9FE', border:'#7C3AED', text:'#4C1D95' },  // purple  (Warwick default)
  { bg:'#DBEAFE', border:'#2563EB', text:'#1E3A8A' },  // blue
  { bg:'#D1FAE5', border:'#059669', text:'#064E3B' },  // green
  { bg:'#FEF3C7', border:'#D97706', text:'#78350F' },  // amber
  { bg:'#FCE7F3', border:'#DB2777', text:'#831843' },  // pink
  { bg:'#CCFBF1', border:'#0D9488', text:'#134E4A' },  // teal
  { bg:'#FFE4E6', border:'#E11D48', text:'#881337' },  // rose
  { bg:'#F3F4F6', border:'#6B7280', text:'#1F2937' },  // gray
];

// Day labels for the week grid
const TT_DAYS = ['Mon','Tue','Wed','Thu','Fri'];

// ── State ──────────────────────────────────────────────────────────────────
let _ttView       = 'week';   // 'day' | 'week' | 'month' | 'list'
let _ttListPeriod = 'week';   // 'day' | 'week' | 'month' — scope used only when _ttView === 'list'
let _ttAnchor     = null;     // Date — the date currently being navigated to (day/week/month all derive from this)
let _ttEventModal = null;     // Currently viewed event

// ── Storage helpers ────────────────────────────────────────────────────────

/** Load all stored calendar events. Returns { yid: [event, ...] } */
function ttLoad() {
  try {
    const raw = localStorage.getItem(TT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

/** Save all calendar events. */
function ttSave(data) {
  try {
    localStorage.setItem(TT_STORAGE_KEY, JSON.stringify(data));
  } catch { showToast('⚠ Timetable storage full or blocked.'); }
}

/** Get events for a specific year id. */
function ttGetEvents(yid) {
  return ttLoad()[yid] || [];
}

/** Replace events for a specific year id. */
function ttSetEvents(yid, events) {
  const data = ttLoad();
  data[yid] = events;
  ttSave(data);
}

/** Delete all events for a year. */
function ttClearEvents(yid) {
  const data = ttLoad();
  delete data[yid];
  ttSave(data);
}

// ── iCal parser ────────────────────────────────────────────────────────────

/**
 * parseIcal(text)
 * Parses a VCALENDAR string and returns an array of event objects:
 *   { uid, summary, description, location, organiserName, organiserEmail,
 *     start: Date, end: Date, dtStartRaw, dtEndRaw }
 *
 * Handles:
 *  • Folded lines (continuation lines starting with space/tab — RFC 5545 §3.1)
 *  • DTSTART with VALUE=DATE-TIME and bare DTSTART formats
 *  • UTC Z suffix → converts to local time
 *  • Escaped characters (\, \n \N \; \,) in DESCRIPTION and SUMMARY
 */
function parseIcal(text) {
  // 1. Unfold: join folded continuation lines
  const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const lines    = unfolded.split(/\r?\n/);

  const events = [];
  let cur = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line === 'BEGIN:VEVENT') {
      cur = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (cur && cur.start && cur.summary) events.push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;

    // Split property name/params from value at first ':'
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const propFull = line.slice(0, colonIdx).toUpperCase();
    const value    = line.slice(colonIdx + 1);

    // Strip parameter suffixes (e.g. DTSTART;VALUE=DATE-TIME → DTSTART)
    const prop = propFull.split(';')[0];

    switch (prop) {
      case 'UID':         cur.uid            = value; break;
      case 'SUMMARY':     cur.summary        = ttUnescape(value); break;
      case 'DESCRIPTION': cur.description    = ttUnescape(value); break;
      case 'LOCATION':    cur.location       = ttUnescape(value); break;
      case 'DTSTART':
        cur.dtStartRaw = value;
        cur.start      = ttParseIcalDate(value);
        break;
      case 'DTEND':
        cur.dtEndRaw = value;
        cur.end      = ttParseIcalDate(value);
        break;
      case 'ORGANIZER': {
        // ORGANIZER;CN=Name:MAILTO:email@example.com
        // Use the original (non-uppercased) line so the CN value keeps its casing.
        const rawPropPart = raw.trim().slice(0, colonIdx);
        const cnMatch    = rawPropPart.match(/CN=([^;:]+)/i);
        const emailMatch = value.match(/MAILTO:(.+)/i);
        cur.organiserName  = cnMatch    ? ttUnescape(cnMatch[1])    : '';
        cur.organiserEmail = emailMatch ? emailMatch[1].trim()      : '';
        break;
      }
      default: break;
    }
  }

  return events;
}

/** Convert a DTSTART/DTEND value string to a JS Date. */
function ttParseIcalDate(s) {
  if (!s) return null;
  s = s.trim();
  // 20251006T080000Z  →  2025-10-06T08:00:00Z
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] || ''}`;
    return new Date(iso);
  }
  // DATE-only: 20251006
  const d = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (d) return new Date(`${d[1]}-${d[2]}-${d[3]}T00:00:00`);
  return null;
}

/** Unescape iCal text values (RFC 5545 §3.3.11). */
function ttUnescape(s) {
  return (s || '')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\[nN]/g, '\n')
    .replace(/\\\\/g, '\\');
}

// ── Colour assignment ──────────────────────────────────────────────────────

const _ttColourMap = {};
let   _ttColourIdx = 0;

/**
 * Derive a stable short key from an event summary for colour assignment.
 * Extracts the module code prefix (e.g. "CS118" from "CS118 Programming…")
 * falling back to the first word.
 */
function ttModuleKey(summary) {
  if (!summary) return 'other';
  // Match a typical Warwick module code at the start: letters + digits
  const m = summary.match(/^([A-Z]{2,4}\d{2,4})/i);
  return m ? m[1].toUpperCase() : (summary.split(' ')[0] || 'other').toUpperCase();
}

function ttGetColour(summary) {
  const key = ttModuleKey(summary);
  if (!_ttColourMap[key]) {
    _ttColourMap[key] = TT_COLOURS[_ttColourIdx % TT_COLOURS.length];
    _ttColourIdx++;
  }
  return _ttColourMap[key];
}

// ── Date utilities ─────────────────────────────────────────────────────────

/** Return the Monday of the week containing `date`. */
function ttMondayOf(date) {
  const d   = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = (day === 0) ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Add `n` days to a Date, returning a new Date. */
function ttAddDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/** Format a Date as "Mon 6 Oct 2025". */
function ttFmtDay(d) {
  return d.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short', year:'numeric' });
}

/** Format a Date as "HH:MM". Uses local time. */
function ttFmtTime(d) {
  return d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', hour12:false });
}

/** "Mon 6 Oct" short label. */
function ttFmtDayShort(d) {
  return d.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' });
}

/** Are two dates on the same calendar day (local time)? */
function ttSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth()    &&
         a.getDate()     === b.getDate();
}

// ── Anchor date state initialisation ──────────────────────────────────────
// `_ttAnchor` is the single date all views navigate around: for Day view it
// IS the displayed day; for Week view its Monday is derived from it; for
// Month view its month is derived from it; List view reuses whichever of
// those applies to the currently selected list period.

function ttEnsureAnchor() {
  if (_ttAnchor) return;
  const saved = localStorage.getItem(TT_ANCHOR_KEY) || localStorage.getItem(TT_WEEK_KEY);
  _ttAnchor = saved ? new Date(saved) : new Date();
  if (isNaN(_ttAnchor.getTime())) _ttAnchor = new Date();
  _ttAnchor.setHours(0, 0, 0, 0);
}

function ttSaveAnchor() {
  if (_ttAnchor) localStorage.setItem(TT_ANCHOR_KEY, _ttAnchor.toISOString());
}

/** The granularity currently driving navigation: the active view, or the
 *  list's own period when the list view is active. */
function ttActivePeriod() {
  return _ttView === 'list' ? _ttListPeriod : _ttView;
}

// ── Import ─────────────────────────────────────────────────────────────────

/** Open the import overlay for a given year. */
function ttOpenImport(yid) {
  const overlay = document.getElementById('ttImportOverlay');
  if (!overlay) return;
  document.getElementById('ttImportYid').value = yid;
  // Restore saved URL if any
  const savedUrl = localStorage.getItem(TT_IMPORT_KEY) || '';
  document.getElementById('ttImportUrl').value = savedUrl;
  document.getElementById('ttImportStatus').textContent = '';
  openOverlay('ttImportOverlay');
}

/** Fetch an iCal URL via a CORS proxy and import it. */
async function ttImportFromUrl() {
  const yid     = document.getElementById('ttImportYid').value;
  const urlRaw  = document.getElementById('ttImportUrl').value.trim();
  const statusEl = document.getElementById('ttImportStatus');

  if (!urlRaw) { statusEl.textContent = '⚠ Please enter a URL.'; return; }

  statusEl.textContent = '⏳ Fetching timetable…';

  // Save the URL for future re-imports
  localStorage.setItem(TT_IMPORT_KEY, urlRaw);

  // Tabula's /api/v1/timetable/calendar/... URLs require an SSO session cookie
  // and will return 403 when fetched from JS (no cookie) or via a proxy (no
  // cookie either).  Detect this early and guide the user to the file-upload
  // path instead, offering a direct download link so they can grab the .ics
  // in one click and then upload it.
  let text = null;
  let got403 = false;
  let errorMsg = '';

  const attempts = [
    urlRaw,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(urlRaw)}`,
    `https://corsproxy.io/?${encodeURIComponent(urlRaw)}`,
  ];

  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt, { cache: 'no-store' });
      if (res.status === 403) { got403 = true; errorMsg = 'HTTP 403'; continue; }
      if (!res.ok) { errorMsg = `HTTP ${res.status}`; continue; }
      const t = await res.text();
      if (t.includes('BEGIN:VCALENDAR')) { text = t; break; }
      errorMsg = 'Response did not look like a valid iCal file.';
    } catch (e) {
      errorMsg = e.message || 'Network error';
    }
  }

  if (!text) {
    if (got403) {
      // This URL requires a Warwick SSO login — proxies can't pass the session
      // cookie.  The easiest fix is to download the file while logged in and
      // then upload it with the file picker below.
      statusEl.innerHTML = `
        <span style="color:var(--red)">
          ❌ <strong>403 Forbidden</strong> — this URL requires you to be logged in to Tabula.<br>
          Proxies can't pass your session cookie, so the fetch always fails.<br><br>
          <strong>Fix:</strong> <a href="${escapeHTML(urlRaw)}" target="_blank" rel="noopener"
            style="color:var(--accent-mid);text-decoration:underline">
            👉 Open the .ics link while logged in to Tabula</a>,
          let the browser download the file, then use
          <strong>"Choose .ics file"</strong> below to import it.
        </span>`;
    } else {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ Could not fetch: ${escapeHTML(errorMsg)}<br>Try downloading the .ics file and uploading it below instead.</span>`;
    }
    return;
  }

  const events = parseIcal(text);
  if (!events.length) {
    statusEl.innerHTML = `<span style="color:var(--red)">❌ Parsed 0 events — check the URL is a valid Tabula iCal link.</span>`;
    return;
  }

  ttSetEvents(yid, events.map(ttSerialiseEvent));
  Object.keys(_ttColourMap).forEach(k => delete _ttColourMap[k]);
  _ttColourIdx = 0;

  statusEl.innerHTML = `<span style="color:var(--gn)">✓ Imported ${events.length} events.</span>`;
  showToast(`✓ ${events.length} timetable events imported!`);

  setTimeout(() => {
    closeOverlayDirect('ttImportOverlay');
    ttRenderPane(yid);
  }, 800);
}

/** Handle .ics file upload. */
function ttImportFromFile(input) {
  const yid    = document.getElementById('ttImportYid').value;
  const file   = input.files[0];
  const statusEl = document.getElementById('ttImportStatus');
  if (!file) return;
  statusEl.textContent = '⏳ Reading file…';
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    if (!text.includes('BEGIN:VCALENDAR')) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ File does not look like a valid .ics calendar.</span>`;
      return;
    }
    const events = parseIcal(text);
    if (!events.length) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ No events found in file.</span>`;
      return;
    }
    ttSetEvents(yid, events.map(ttSerialiseEvent));
    Object.keys(_ttColourMap).forEach(k => delete _ttColourMap[k]);
    _ttColourIdx = 0;
    statusEl.innerHTML = `<span style="color:var(--gn)">✓ Imported ${events.length} events.</span>`;
    showToast(`✓ ${events.length} timetable events imported!`);
    setTimeout(() => {
      closeOverlayDirect('ttImportOverlay');
      ttRenderPane(yid);
    }, 800);
  };
  reader.readAsText(file);
}

/**
 * Serialise an event object for localStorage.
 * Converts Date objects to ISO strings so JSON round-trips correctly.
 */
function ttSerialiseEvent(ev) {
  return {
    uid:            ev.uid            || '',
    summary:        ev.summary        || '',
    description:    ev.description    || '',
    location:       ev.location       || '',
    organiserName:  ev.organiserName  || '',
    organiserEmail: ev.organiserEmail || '',
    start:          ev.start ? ev.start.toISOString() : null,
    end:            ev.end   ? ev.end.toISOString()   : null,
  };
}

/** Deserialise: convert stored ISO strings back to Date objects. */
function ttDeserialiseEvent(ev) {
  return {
    ...ev,
    start: ev.start ? new Date(ev.start) : null,
    end:   ev.end   ? new Date(ev.end)   : null,
  };
}

// ── Main pane builder ──────────────────────────────────────────────────────

function ttRenderPane(yid) {
  const pane = document.getElementById(`sp-${yid}-schooltimetable`);
  if (!pane) return;
  pane.innerHTML = buildSchoolTimetable(getYear(yid));
}

const TT_VIEWS = [
  { id: 'day',   icon: '📆', label: 'Day' },
  { id: 'week',  icon: '📅', label: 'Week' },
  { id: 'month', icon: '🗓', label: 'Month' },
  { id: 'list',  icon: '📋', label: 'List' },
];

function buildSchoolTimetable(yr) {
  ttEnsureAnchor();
  const rawEvents = ttGetEvents(yr.id);
  const events    = rawEvents.map(ttDeserialiseEvent);

  if (!events.length) return ttBuildEmpty(yr.id);

  const viewBtns = TT_VIEWS.map(v =>
    `<button class="tt-flt ${_ttView === v.id ? 'active' : ''}" onclick="ttSetView('${yr.id}','${v.id}')">${v.icon} ${v.label}</button>`
  ).join('');

  // When List is active, expose a secondary Day/Week/Month period toggle
  // that scopes the date range the list covers.
  const periodBtns = _ttView === 'list'
    ? `<div class="tt-list-period-row">
         ${['day','week','month'].map(p =>
           `<button class="tt-flt tt-flt-mini ${_ttListPeriod === p ? 'active' : ''}" onclick="ttSetListPeriod('${yr.id}','${p}')">${p[0].toUpperCase()}${p.slice(1)}</button>`
         ).join('')}
       </div>`
    : '';

  const viewToggle = `
    <div class="tt-view-toggle" style="display:flex;align-items:center;gap:8px;margin-bottom:20px;flex-wrap:wrap">
      ${viewBtns}
      ${periodBtns}
      <div style="flex:1"></div>
      <button class="btn btn-ghost btn-sm" onclick="ttOpenImport('${yr.id}')">↻ Re-import iCal</button>
      <button class="btn btn-danger btn-sm" onclick="ttConfirmClear('${yr.id}')">🗑 Clear</button>
    </div>`;

  let content;
  switch (_ttView) {
    case 'day':   content = ttBuildDayView(yr.id, events);   break;
    case 'month': content = ttBuildMonthView(yr.id, events); break;
    case 'list':  content = ttBuildListView(yr.id, events);  break;
    default:      content = ttBuildWeekView(yr.id, events);  break;
  }

  return viewToggle + content;
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
      <button class="btn btn-primary" style="margin-top:20px" onclick="ttOpenImport('${yid}')">
        📥 Import iCal
      </button>
    </div>`;
}

// ── Week view ──────────────────────────────────────────────────────────────

const TT_GRID_START = 8;   // 08:00
const TT_GRID_END   = 20;  // 20:00
const TT_GRID_HOURS = TT_GRID_END - TT_GRID_START;  // 12 hours
const TT_SLOT_PX    = 56;  // pixels per hour

function ttBuildWeekView(yid, events) {
  const mon = ttMondayOf(_ttAnchor);
  const fri = ttAddDays(mon, 4);
  const today = new Date(); today.setHours(0,0,0,0);

  // Navigation header
  const weekLabel = `${ttFmtDayShort(mon)} – ${ttFmtDayShort(fri)}`;
  const nav = `
    <div class="tt-week-nav">
      <button class="icon-btn" onclick="ttNav('${yid}',-1)" title="Previous week">◀</button>
      <div class="tt-week-label">${weekLabel}</div>
      <button class="icon-btn" onclick="ttNav('${yid}',1)" title="Next week">▶</button>
      <button class="btn btn-ghost btn-sm" onclick="ttGoToday('${yid}')">Today</button>
    </div>`;

  // Column headers (Mon–Fri)
  const dayHeaders = TT_DAYS.map((d, i) => {
    const date    = ttAddDays(mon, i);
    const isToday = ttSameDay(date, today);
    return `<div class="tt-col-hdr ${isToday?'tt-today-hdr':''}">
      <div class="tt-col-day">${d}</div>
      <div class="tt-col-date ${isToday?'tt-today-badge':''}">${date.getDate()}</div>
    </div>`;
  }).join('');

  // Hour rows (background grid lines)
  let hourLines = '';
  for (let h = TT_GRID_START; h <= TT_GRID_END; h++) {
    const top = (h - TT_GRID_START) * TT_SLOT_PX;
    hourLines += `<div class="tt-hour-line" style="top:${top}px">
      <span class="tt-hour-lbl">${String(h).padStart(2,'0')}:00</span>
    </div>`;
  }

  // Current-time indicator
  const now = new Date();
  let nowLine = '';
  const isCurWeek = now >= mon && now < ttAddDays(fri, 1);
  if (isCurWeek) {
    const dayIdx = (now.getDay() + 6) % 7; // Mon=0
    if (dayIdx < 5) {
      const mins = (now.getHours() - TT_GRID_START) * 60 + now.getMinutes();
      const top  = Math.round(mins / 60 * TT_SLOT_PX);
      if (top >= 0 && top <= TT_GRID_HOURS * TT_SLOT_PX) {
        nowLine = `<div class="tt-now-line" style="top:${top}px;left:calc(${dayIdx} * (100% / 5))">
          <span class="tt-now-dot"></span>
          <span class="tt-now-bar"></span>
        </div>`;
      }
    }
  }

  // Event blocks per day column
  const dayColumns = TT_DAYS.map((_, dayIdx) => {
    const colDate = ttAddDays(mon, dayIdx);
    const dayEvents = events.filter(ev =>
      ev.start && ttSameDay(ev.start, colDate) &&
      ev.start.getHours() >= TT_GRID_START && ev.start.getHours() < TT_GRID_END
    ).sort((a, b) => a.start - b.start);

    const blocks = dayEvents.map(ev => ttBuildEventBlock(yid, ev)).join('');
    return `<div class="tt-day-col" data-day="${dayIdx}">${blocks}</div>`;
  }).join('');

  const gridHeight = TT_GRID_HOURS * TT_SLOT_PX;

  return `
    ${nav}
    <div class="tt-week-grid-wrap">
      <div class="tt-col-headers">
        <div class="tt-time-gutter"></div>
        ${dayHeaders}
      </div>
      <div class="tt-grid-body" style="height:${gridHeight}px">
        <div class="tt-gutter-col">
          ${hourLines}
        </div>
        <div class="tt-events-area" style="height:${gridHeight}px">
          ${dayColumns}
          ${nowLine}
        </div>
      </div>
    </div>`;
}

function ttBuildEventBlock(yid, ev) {
  if (!ev.start || !ev.end) return '';
  const startMins = (ev.start.getHours() - TT_GRID_START) * 60 + ev.start.getMinutes();
  const durMins   = Math.round((ev.end - ev.start) / 60000);
  const top       = Math.round(startMins / 60 * TT_SLOT_PX);
  const height    = Math.max(Math.round(durMins / 60 * TT_SLOT_PX) - 2, 20);

  const col     = ttGetColour(ev.summary);
  const code    = ttModuleKey(ev.summary);
  const title   = ev.summary.replace(/^[A-Z]{2,4}\d{2,4}\s*/i, '').replace(/\s+[A-Z]{2,4}\d{2,4}[A-Z]?\s*(\{.*\})?$/, '').trim() || ev.summary;
  const typeTag = ttEventTypeTag(ev.summary);

  const safeUid = escapeHTML(ev.uid || '');
  return `
    <div class="tt-event-block" style="top:${top}px;height:${height}px;background:${col.bg};border-left:3px solid ${col.border};color:${col.text}"
         onclick="ttOpenEvent('${yid}','${safeUid}')" title="${escapeHTML(ev.summary)}">
      <div class="tt-ev-code">${escapeHTML(code)}${typeTag?` <span class="tt-ev-type">${typeTag}</span>`:''}</div>
      ${height >= 36 ? `<div class="tt-ev-title">${escapeHTML(title)}</div>` : ''}
      ${height >= 52 && ev.location ? `<div class="tt-ev-loc">📍 ${escapeHTML(ev.location)}</div>` : ''}
    </div>`;
}

// ── Day view ───────────────────────────────────────────────────────────────

function ttBuildDayView(yid, events) {
  const day   = new Date(_ttAnchor);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isToday = ttSameDay(day, today);

  const nav = `
    <div class="tt-week-nav">
      <button class="icon-btn" onclick="ttNav('${yid}',-1)" title="Previous day">◀</button>
      <div class="tt-week-label">${ttFmtDay(day)}</div>
      <button class="icon-btn" onclick="ttNav('${yid}',1)" title="Next day">▶</button>
      <button class="btn btn-ghost btn-sm" onclick="ttGoToday('${yid}')">Today</button>
    </div>`;

  const dayHeader = `<div class="tt-col-hdr ${isToday ? 'tt-today-hdr' : ''}">
    <div class="tt-col-day">${day.toLocaleDateString('en-GB', { weekday: 'long' })}</div>
    <div class="tt-col-date ${isToday ? 'tt-today-badge' : ''}">${day.getDate()}</div>
  </div>`;

  let hourLines = '';
  for (let h = TT_GRID_START; h <= TT_GRID_END; h++) {
    const top = (h - TT_GRID_START) * TT_SLOT_PX;
    hourLines += `<div class="tt-hour-line" style="top:${top}px">
      <span class="tt-hour-lbl">${String(h).padStart(2, '0')}:00</span>
    </div>`;
  }

  const now = new Date();
  let nowLine = '';
  if (isToday) {
    const mins = (now.getHours() - TT_GRID_START) * 60 + now.getMinutes();
    const top  = Math.round(mins / 60 * TT_SLOT_PX);
    if (top >= 0 && top <= TT_GRID_HOURS * TT_SLOT_PX) {
      nowLine = `<div class="tt-now-line" style="top:${top}px;left:0;width:100%">
        <span class="tt-now-dot"></span>
        <span class="tt-now-bar"></span>
      </div>`;
    }
  }

  const dayEvents = events.filter(ev =>
    ev.start && ttSameDay(ev.start, day) &&
    ev.start.getHours() >= TT_GRID_START && ev.start.getHours() < TT_GRID_END
  ).sort((a, b) => a.start - b.start);

  const blocks = dayEvents.map(ev => ttBuildEventBlock(yid, ev)).join('');
  const gridHeight = TT_GRID_HOURS * TT_SLOT_PX;

  return `
    ${nav}
    <div class="tt-week-grid-wrap">
      <div class="tt-col-headers" style="grid-template-columns:48px 1fr">
        <div class="tt-time-gutter"></div>
        ${dayHeader}
      </div>
      <div class="tt-grid-body" style="height:${gridHeight}px">
        <div class="tt-gutter-col">
          ${hourLines}
        </div>
        <div class="tt-events-area" style="grid-template-columns:1fr;height:${gridHeight}px">
          <div class="tt-day-col" data-day="0">${blocks}</div>
          ${nowLine}
        </div>
      </div>
    </div>`;
}

// ── Month view ─────────────────────────────────────────────────────────────

const TT_MV_WEEKDAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function ttBuildMonthView(yid, events) {
  const anchor = _ttAnchor;
  const year   = anchor.getFullYear();
  const month  = anchor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth  = new Date(year, month + 1, 0);
  const gridStart = ttMondayOf(firstOfMonth);
  const gridEnd   = ttAddDays(ttMondayOf(lastOfMonth), 6);
  const today     = new Date(); today.setHours(0, 0, 0, 0);

  const monthLabel = anchor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const nav = `
    <div class="tt-week-nav">
      <button class="icon-btn" onclick="ttNav('${yid}',-1)" title="Previous month">◀</button>
      <div class="tt-week-label">${monthLabel}</div>
      <button class="icon-btn" onclick="ttNav('${yid}',1)" title="Next month">▶</button>
      <button class="btn btn-ghost btn-sm" onclick="ttGoToday('${yid}')">Today</button>
    </div>`;

  const wdHeader = TT_MV_WEEKDAYS.map(d => `<div class="tt-mv-wd">${d}</div>`).join('');

  const MAX_CHIPS = 3;
  let cells = '';
  let cur = new Date(gridStart);
  while (cur <= gridEnd) {
    const inMonth  = cur.getMonth() === month;
    const isToday  = ttSameDay(cur, today);
    const cellDate = new Date(cur);

    const dayEvents = events.filter(ev => ev.start && ttSameDay(ev.start, cellDate))
                             .sort((a, b) => a.start - b.start);

    const chips = dayEvents.slice(0, MAX_CHIPS).map(ev => {
      const col  = ttGetColour(ev.summary);
      const code = ttModuleKey(ev.summary);
      return `<div class="tt-mv-chip" style="background:${col.bg};color:${col.text};border-left:2px solid ${col.border}"
                   onclick="event.stopPropagation();ttOpenEvent('${yid}','${escapeHTML(ev.uid || '')}')"
                   title="${escapeHTML(ev.summary)}">${ttFmtTime(ev.start)} ${escapeHTML(code)}</div>`;
    }).join('');
    const more = dayEvents.length > MAX_CHIPS ? `<div class="tt-mv-more">+${dayEvents.length - MAX_CHIPS} more</div>` : '';
    const dot  = dayEvents.length ? `<div class="tt-mv-dot" title="${dayEvents.length} event${dayEvents.length>1?'s':''}"></div>` : '';

    cells += `<div class="tt-mv-cell ${inMonth ? '' : 'tt-mv-cell-out'} ${isToday ? 'tt-mv-cell-today' : ''}"
                   onclick="ttGoToDay('${yid}','${cellDate.toISOString()}')">
      <div class="tt-mv-date ${isToday ? 'tt-mv-date-today' : ''}">${cellDate.getDate()}${dot}</div>
      <div class="tt-mv-events">${chips}${more}</div>
    </div>`;
    cur = ttAddDays(cur, 1);
  }

  return `
    ${nav}
    <div class="tt-mv-wrap">
      <div class="tt-mv-wd-row">${wdHeader}</div>
      <div class="tt-mv-grid">${cells}</div>
    </div>`;
}

/** Jump straight to Day view for a date tapped in the Month grid. */
function ttGoToDay(yid, iso) {
  _ttAnchor = new Date(iso);
  _ttAnchor.setHours(0, 0, 0, 0);
  _ttView = 'day';
  localStorage.setItem(TT_VIEW_KEY, _ttView);
  ttSaveAnchor();
  ttRenderPane(yid);
}

// ── List view ──────────────────────────────────────────────────────────────

function ttBuildListView(yid, events) {
  const period = _ttListPeriod;
  const anchor = _ttAnchor;

  let rangeStart, rangeEnd, label, navTitle;
  if (period === 'day') {
    rangeStart = new Date(anchor); rangeStart.setHours(0, 0, 0, 0);
    rangeEnd   = ttAddDays(rangeStart, 1);
    label      = ttFmtDay(anchor);
    navTitle   = 'day';
  } else if (period === 'month') {
    rangeStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    rangeEnd   = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
    label      = anchor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    navTitle   = 'month';
  } else {
    rangeStart = ttMondayOf(anchor);
    rangeEnd   = ttAddDays(rangeStart, 7);
    label      = `${ttFmtDayShort(rangeStart)} – ${ttFmtDayShort(ttAddDays(rangeStart, 6))}`;
    navTitle   = 'week';
  }

  const nav = `
    <div class="tt-week-nav">
      <button class="icon-btn" onclick="ttNav('${yid}',-1)" title="Previous ${navTitle}">◀</button>
      <div class="tt-week-label">${label}</div>
      <button class="icon-btn" onclick="ttNav('${yid}',1)" title="Next ${navTitle}">▶</button>
      <button class="btn btn-ghost btn-sm" onclick="ttGoToday('${yid}')">Today</button>
    </div>`;

  const filtered = events.filter(ev => ev.start && ev.start >= rangeStart && ev.start < rangeEnd);
  if (!filtered.length) {
    return nav + `<div class="tt-empty">No events this ${navTitle}.</div>`;
  }

  // Sort all events chronologically
  const sorted = [...filtered].sort((a, b) => a.start - b.start);

  // Group by day
  const groups = {};
  sorted.forEach(ev => {
    const key = ev.start.toDateString();
    if (!groups[key]) groups[key] = { date: ev.start, events: [] };
    groups[key].events.push(ev);
  });

  const today = new Date(); today.setHours(0,0,0,0);

  let html = '<div class="tt-list-wrap">';
  for (const [, grp] of Object.entries(groups)) {
    const isToday = ttSameDay(grp.date, today);
    html += `<div class="tt-list-day-hdr ${isToday?'tt-list-today':''}">
      ${isToday ? '⬤ ' : ''}${ttFmtDay(grp.date)}
    </div>`;
    grp.events.forEach(ev => {
      const col     = ttGetColour(ev.summary);
      const typeTag = ttEventTypeTag(ev.summary);
      const duration = ev.end ? Math.round((ev.end - ev.start) / 60000) : null;
      const durStr   = duration ? `${Math.floor(duration/60)}h${duration%60?` ${duration%60}m`:''}` : '';
      html += `
        <div class="tt-list-event" style="border-left:3px solid ${col.border};background:${col.bg}"
             onclick="ttOpenEvent('${yid}','${escapeHTML(ev.uid || '')}')">
          <div class="tt-list-time">${ttFmtTime(ev.start)}${ev.end?` – ${ttFmtTime(ev.end)}`:''}${durStr?` <span style="color:${col.border};opacity:.7">(${durStr})</span>`:''}</div>
          <div class="tt-list-title">
            <span class="tt-ev-code-pill" style="background:${col.border}20;color:${col.text};border:1px solid ${col.border}40">${escapeHTML(ttModuleKey(ev.summary))}</span>
            ${escapeHTML(ev.summary)}
            ${typeTag?`<span class="tt-ev-type" style="background:${col.border}15;color:${col.text}">${typeTag}</span>`:''}
          </div>
          ${ev.location ? `<div class="tt-list-loc">📍 ${escapeHTML(ev.location)}</div>` : ''}
        </div>`;
    });
  }
  html += '</div>';
  return nav + html;
}

// ── Event type extraction ──────────────────────────────────────────────────

/** Extract a short type label from Tabula's naming convention. */
function ttEventTypeTag(summary) {
  if (!summary) return '';
  // E.g. "CS118 Programming … CS118L" → "L" = Lecture
  // "CS118P" → P = Practical, "CS118S" → S = Seminar
  const m = summary.match(/[A-Z]{2,4}\d{2,4}([LSPW])\s*(?:\{.*\})?$/i);
  if (!m) return '';
  const map = { L:'Lecture', P:'Practical', S:'Seminar', W:'Workshop' };
  return map[m[1].toUpperCase()] || m[1];
}

// ── Navigation ─────────────────────────────────────────────────────────────

function ttNav(yid, delta) {
  ttEnsureAnchor();
  const period = ttActivePeriod();
  if (period === 'day') {
    _ttAnchor = ttAddDays(_ttAnchor, delta);
  } else if (period === 'month') {
    const d = new Date(_ttAnchor);
    d.setDate(1); // avoid month-end overflow (e.g. Jan 31 + 1 month skipping March)
    d.setMonth(d.getMonth() + delta);
    _ttAnchor = d;
  } else { // week
    _ttAnchor = ttAddDays(_ttAnchor, delta * 7);
  }
  ttSaveAnchor();
  ttRenderPane(yid);
}

function ttGoToday(yid) {
  _ttAnchor = new Date();
  _ttAnchor.setHours(0, 0, 0, 0);
  ttSaveAnchor();
  ttRenderPane(yid);
}

function ttSetView(yid, view) {
  _ttView = view;
  localStorage.setItem(TT_VIEW_KEY, view);
  ttRenderPane(yid);
}

function ttSetListPeriod(yid, period) {
  _ttListPeriod = period;
  localStorage.setItem(TT_LIST_PER_KEY, period);
  ttRenderPane(yid);
}

function ttConfirmClear(yid) {
  if (!confirm('Delete all imported timetable events for this year? This cannot be undone.')) return;
  ttClearEvents(yid);
  ttRenderPane(yid);
  showToast('Timetable cleared.');
}

// ── Event detail modal ─────────────────────────────────────────────────────

function ttOpenEvent(yid, uid) {
  const events = ttGetEvents(yid).map(ttDeserialiseEvent);
  const ev     = events.find(e => e.uid === uid);
  if (!ev) return;
  _ttEventModal = ev;

  const col      = ttGetColour(ev.summary);
  const duration = ev.start && ev.end ? Math.round((ev.end - ev.start) / 60000) : null;
  const durStr   = duration ? `${Math.floor(duration/60)}h${duration%60 ? ` ${duration%60}m` : ''}` : '—';
  const typeTag  = ttEventTypeTag(ev.summary);
  const code     = ttModuleKey(ev.summary);

  const modal = document.getElementById('ttEventModal');
  if (!modal) return;

  // Header badges
  document.getElementById('ttev-modbadge').style.cssText =
    `background:${col.bg};color:${col.text};border:1px solid ${col.border}40;font-family:var(--fm);font-size:11px;padding:3px 9px;border-radius:6px`;
  document.getElementById('ttev-modbadge').textContent = code;
  document.getElementById('ttev-typebadge').innerHTML  = typeTag
    ? `<span style="font-family:var(--fm);font-size:10px;color:${col.text};background:${col.border}20;border:1px solid ${col.border}40;padding:2px 7px;border-radius:4px">${typeTag}</span>`
    : '';

  document.getElementById('ttev-title').textContent = ev.summary;

  // Detail grid
  let grid = '';
  if (ev.start) {
    grid += `<div class="modal-det"><div class="modal-det-lbl">📅 Date</div><div class="modal-det-val hl">${ttFmtDay(ev.start)}</div></div>`;
    grid += `<div class="modal-det"><div class="modal-det-lbl">⏰ Time</div><div class="modal-det-val hl">${ttFmtTime(ev.start)}${ev.end ? ' – ' + ttFmtTime(ev.end) : ''}</div></div>`;
  }
  grid += `<div class="modal-det"><div class="modal-det-lbl">⏱ Duration</div><div class="modal-det-val">${durStr}</div></div>`;
  if (ev.location) grid += `<div class="modal-det full"><div class="modal-det-lbl">📍 Venue</div><div class="modal-det-val" style="font-size:13px">${escapeHTML(ev.location)}</div></div>`;
  if (ev.organiserName) grid += `<div class="modal-det full"><div class="modal-det-lbl">👤 Organiser</div><div class="modal-det-val" style="font-size:13px">${escapeHTML(ev.organiserName)}${ev.organiserEmail ? ` <a href="mailto:${escapeHTML(ev.organiserEmail)}" style="color:var(--accent-mid);font-size:11px;margin-left:6px">${escapeHTML(ev.organiserEmail)}</a>` : ''}</div></div>`;
  document.getElementById('ttev-grid').innerHTML = grid;

  // Description
  const descEl = document.getElementById('ttev-desc');
  if (ev.description && ev.description.trim()) {
    descEl.style.display = 'block';
    descEl.querySelector('.ttev-desc-body').innerHTML =
      escapeHTML(ev.description).replace(/\n/g, '<br>');
  } else {
    descEl.style.display = 'none';
  }

  openOverlay('ttEventModal');
}

// ── DOM injection ──────────────────────────────────────────────────────────

/**
 * Inject the HTML for:
 *  1. The import overlay modal
 *  2. The event detail modal
 *  3. (Intentionally no sidebar-footer button — see note in ttInjectDOM)
 *
 * Called once on DOMContentLoaded.
 */
function ttInjectDOM() {
  // ── Import overlay ──
  const importOverlay = document.createElement('div');
  importOverlay.className = 'overlay';
  importOverlay.id = 'ttImportOverlay';
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
          Go to <strong>tabula.warwick.ac.uk → Profile → Export calendar</strong> and copy the iCal URL.<br>
          <span style="color:var(--amber,#D97706)">⚠ If you see a 403 error, your URL requires login — use the file upload below instead.</span>
        </p>
        <div class="form-row">
          <label for="ttImportUrl">iCal URL</label>
          <input class="form-inp" id="ttImportUrl" placeholder="https://tabula.warwick.ac.uk/…/calendar/….ics" />
        </div>
        <button class="btn btn-primary" onclick="ttImportFromUrl()">📥 Fetch &amp; Import</button>

        <div class="settings-section-title" style="margin-top:24px">Upload a .ics file <span style="font-family:var(--fm);font-size:10px;font-weight:400;color:var(--gn,#059669)">(recommended for Tabula)</span></div>
        <p style="font-family:var(--fm);font-size:11px;color:var(--tx3);margin-bottom:12px;line-height:1.65">
          Open your iCal URL <strong>while logged in to Tabula</strong> — the browser will download a <code>.ics</code> file. Then upload it here.
        </p>
        <label class="btn btn-ghost" style="cursor:pointer">
          📎 Choose .ics file
          <input type="file" accept=".ics,text/calendar" style="display:none" onchange="ttImportFromFile(this)" />
        </label>

        <div id="ttImportStatus" style="margin-top:16px;font-family:var(--fm);font-size:12px;line-height:1.6"></div>

        <div class="privacy-badge" style="margin-top:20px">
          <span class="privacy-badge-icon">🔒</span>
          <div>
            <strong>Stored locally only.</strong>
            <span>Your timetable never leaves your device.</span>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(importOverlay);

  // ── Event detail modal ──
  const eventModal = document.createElement('div');
  eventModal.className = 'overlay';
  eventModal.id = 'ttEventModal';
  eventModal.setAttribute('onclick', "closeOverlay('ttEventModal',event)");
  eventModal.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-hdr">
        <button class="modal-close" aria-label="Close" onclick="closeOverlayDirect('ttEventModal')">✕</button>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span id="ttev-modbadge"></span>
          <span id="ttev-typebadge"></span>
        </div>
        <div style="font-family:var(--fd);font-size:18px;font-weight:800;line-height:1.25" id="ttev-title"></div>
      </div>
      <div class="modal-body">
        <div class="modal-detail-grid" id="ttev-grid"></div>
        <div id="ttev-desc" style="display:none">
          <div class="modal-mark-lbl" style="margin-top:4px">Description</div>
          <div class="ttev-desc-body" style="font-family:var(--fm);font-size:12px;color:var(--tx2);line-height:1.7;white-space:pre-line"></div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(eventModal);

  // NOTE: deliberately no "School Timetable" button is added to
  // `.sidebar-footer` here. The tab already lives in the main sidebar
  // navigation (see renderSidebarNav patch below) — adding a second entry
  // in the footer duplicated it and pushed it below the "Settings" group,
  // which is confusing. Footer stays exactly as Gradewick defines it.
}

// ── CSS injection ───────────────────────────────────────────────────────────

function ttInjectCSS() {
  const style = document.createElement('style');
  style.textContent = `
/* ── SCHOOL TIMETABLE ─────────────────────────────────── */

/* Week nav */
.tt-week-nav {
  display: flex; align-items: center; gap: 10px; margin-bottom: 16px;
  background: var(--s1); border: 1.5px solid var(--b1); border-radius: var(--r-md);
  padding: 10px 16px;
}
.tt-week-label {
  flex: 1; text-align: center; font-family: var(--fd); font-size: 14px;
  font-weight: 700; color: var(--tx);
}

/* Column headers */
.tt-col-headers {
  display: grid;
  grid-template-columns: 48px repeat(5, 1fr);
  margin-bottom: 0;
  border-bottom: 1.5px solid var(--b1);
  background: var(--s1);
  border-radius: var(--r-md) var(--r-md) 0 0;
  overflow: hidden;
}
.tt-time-gutter { width: 48px; }
.tt-col-hdr {
  padding: 8px 4px 6px; text-align: center;
  border-left: 1px solid var(--b1);
}
.tt-col-hdr.tt-today-hdr { background: var(--accent-bg); }
.tt-col-day  { font-family: var(--fm); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--tx3); }
.tt-col-date {
  font-family: var(--fd); font-size: 18px; font-weight: 800; color: var(--tx); line-height: 1.1; margin-top: 2px;
}
.tt-today-badge {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--accent-mid); color: var(--s1);
  font-size: 14px; margin: 0 auto;
}

/* Grid body */
.tt-week-grid-wrap {
  background: var(--s1); border: 1.5px solid var(--b1);
  border-radius: var(--r-md); overflow: hidden; margin-bottom: 20px;
}
.tt-grid-body {
  display: flex; position: relative; overflow-y: auto; overflow-x: hidden;
}
.tt-gutter-col {
  width: 48px; flex-shrink: 0; position: relative; border-right: 1px solid var(--b1);
}
.tt-hour-line {
  position: absolute; left: 0; right: 0; border-top: 1px dashed var(--b1); width: 100%;
  display: flex; align-items: flex-start;
}
.tt-hour-lbl {
  font-family: var(--fm); font-size: 9px; color: var(--tx4);
  padding: 0 4px; line-height: 1; transform: translateY(-6px); white-space: nowrap;
}
.tt-events-area {
  flex: 1; display: grid; grid-template-columns: repeat(5, 1fr);
  position: relative; overflow: hidden;
}
.tt-day-col {
  position: relative; border-left: 1px solid var(--b1);
}

/* Now line */
.tt-now-line {
  position: absolute; width: calc(100% / 5); z-index: 10;
  display: flex; align-items: center; pointer-events: none;
}
.tt-now-dot {
  width: 8px; height: 8px; border-radius: 50%; background: var(--red); flex-shrink: 0;
  margin-left: -4px;
}
.tt-now-bar {
  flex: 1; height: 1.5px; background: var(--red); opacity: .7;
}

/* Event blocks */
.tt-event-block {
  position: absolute; left: 2px; right: 2px;
  border-radius: 5px; padding: 3px 5px;
  cursor: pointer; overflow: hidden;
  transition: transform var(--t-fast) var(--spring), box-shadow var(--t-fast);
  font-size: 11px; line-height: 1.25;
  z-index: 2;
}
.tt-event-block:hover {
  transform: scale(1.02) translateY(-1px);
  box-shadow: 0 4px 12px rgba(0,0,0,.15);
  z-index: 5;
}
.tt-ev-code {
  font-family: var(--fm); font-size: 9px; font-weight: 600;
  letter-spacing: .04em; text-transform: uppercase; opacity: .85;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tt-ev-title {
  font-family: var(--fd); font-size: 10px; font-weight: 700;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  margin-top: 1px;
}
.tt-ev-loc {
  font-family: var(--fm); font-size: 9px; opacity: .75;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  margin-top: 1px;
}
.tt-ev-type {
  font-family: var(--fm); font-size: 8px; font-weight: 500;
  opacity: .75; text-transform: uppercase; letter-spacing: .05em;
}

/* List view */
.tt-list-wrap { display: flex; flex-direction: column; gap: 4px; }
.tt-list-day-hdr {
  font-family: var(--fd); font-size: 14px; font-weight: 800; color: var(--tx);
  padding: 16px 0 6px; border-bottom: 1.5px solid var(--b1); margin-top: 8px;
}
.tt-list-day-hdr:first-child { margin-top: 0; }
.tt-list-day-hdr.tt-list-today { color: var(--accent-mid); }
.tt-list-event {
  display: flex; flex-direction: column; gap: 3px;
  padding: 10px 14px; border-radius: var(--r-md); cursor: pointer;
  transition: transform var(--t-fast) var(--spring), box-shadow var(--t-fast);
  margin-bottom: 4px;
}
.tt-list-event:hover { transform: translateX(4px); box-shadow: 0 2px 8px rgba(0,0,0,.08); }
.tt-list-time {
  font-family: var(--fm); font-size: 11px; color: var(--tx3); font-weight: 500;
}
.tt-list-title {
  font-family: var(--fd); font-size: 14px; font-weight: 700; color: var(--tx);
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
}
.tt-list-loc {
  font-family: var(--fm); font-size: 11px; color: var(--tx3);
}
.tt-ev-code-pill {
  font-family: var(--fm); font-size: 10px; font-weight: 600;
  padding: 2px 6px; border-radius: 4px; white-space: nowrap;
}

/* List-period sub-toggle (Day/Week/Month, shown only when List is active) */
.tt-list-period-row {
  display: flex; align-items: center; gap: 4px;
  padding-left: 8px; border-left: 1.5px solid var(--b1);
}
.tt-flt-mini { padding: 5px 10px; font-size: 10px; }

/* ── Month view ──────────────────────────────────────────────────────── */
.tt-mv-wrap {
  background: var(--s1); border: 1.5px solid var(--b1);
  border-radius: var(--r-md); overflow: hidden; margin-bottom: 20px;
}
.tt-mv-wd-row {
  display: grid; grid-template-columns: repeat(7, 1fr);
  background: var(--s2); border-bottom: 1.5px solid var(--b1);
}
.tt-mv-wd {
  padding: 8px 4px; text-align: center;
  font-family: var(--fm); font-size: 10px; letter-spacing: .08em;
  text-transform: uppercase; color: var(--tx3);
}
.tt-mv-grid {
  display: grid; grid-template-columns: repeat(7, 1fr);
}
.tt-mv-cell {
  min-height: 92px; padding: 6px; border-right: 1px solid var(--b1);
  border-bottom: 1px solid var(--b1); cursor: pointer;
  transition: background var(--t-fast);
  display: flex; flex-direction: column; gap: 4px;
}
.tt-mv-cell:nth-child(7n) { border-right: none; }
.tt-mv-cell:hover { background: var(--s2); }
.tt-mv-cell-out { opacity: .4; }
.tt-mv-cell-today { background: var(--accent-bg); }
.tt-mv-date {
  font-family: var(--fd); font-size: 13px; font-weight: 700; color: var(--tx);
  width: 22px; height: 22px; display: flex; align-items: center; justify-content: center;
  position: relative;
}
.tt-mv-date-today {
  background: var(--accent-mid); color: var(--s1); border-radius: 50%;
}
.tt-mv-dot {
  display: none; /* shown only on mobile, where chips are hidden for space */
  position: absolute; bottom: -3px; right: -3px;
  width: 6px; height: 6px; border-radius: 50%; background: var(--accent-mid);
}
.tt-mv-events { display: flex; flex-direction: column; gap: 2px; overflow: hidden; }
.tt-mv-chip {
  font-family: var(--fm); font-size: 9px; font-weight: 600;
  padding: 2px 4px; border-radius: 3px; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; cursor: pointer;
}
.tt-mv-more {
  font-family: var(--fm); font-size: 9px; color: var(--tx4); padding: 1px 4px;
}

/* Dark mode adjustments */
[data-theme="dark"] .tt-event-block { opacity: .92; }
[data-theme="dark"] .tt-event-block:hover { opacity: 1; }

/* ── Sidebar layout safeguard ───────────────────────────────────────────
   The per-year nav list (#sidebarNav, inside the scrollable .sidebar-middle)
   now has one more entry (School Timetable). Make sure that however long
   that list gets, scrolled content stays visually inside .sidebar-middle's
   own box and never appears to run underneath the fixed footer below it. */
.sidebar-footer {
  position: relative; z-index: 2; background: var(--s1);
  box-shadow: 0 -6px 14px -8px rgba(0,0,0,.18);
}
.sidebar-nav { padding-bottom: clamp(8px, 1.4vh, 16px); }

/* Mobile */
@media (max-width: 640px) {
  .tt-col-hdr { padding: 6px 2px 4px; }
  .tt-col-date { font-size: 14px; }
  .tt-ev-title { display: none; }
  .tt-week-label { font-size: 12px; }
  .tt-mv-cell { min-height: 64px; padding: 4px; }
  .tt-mv-chip { display: none; }
  .tt-mv-more { display: none; }
  .tt-mv-dot { display: block; }
}
`;
  document.head.appendChild(style);
}

// ── Hook into Gradewick's tab system ─────────────────────────────────────────
//
// We monkey-patch the key functions that render year panes and sidebar nav
// to insert our new 'schooltimetable' tab without touching the original files.

// 1. Extend renderSidebarNav to include the new tab
const _origRenderSidebarNav = renderSidebarNav;
window.renderSidebarNav = function(yid) {
  _origRenderSidebarNav(yid);
  // Add schooltimetable button to sidebar nav
  const nav = document.getElementById('sidebarNav');
  if (!nav) return;
  const st = _yearSubtabs[yid] || APP.lastTab?.[yid] || 'dashboard';
  const names = APP.settings.tabNames;
  const ttName = names.schooltimetable || 'School Timetable';
  const ttBtn = document.createElement('div');
  ttBtn.className = `nav-btn ${st === 'schooltimetable' ? 'active' : ''}`;
  ttBtn.setAttribute('onclick', `switchSubtab('${yid}','schooltimetable')`);
  ttBtn.innerHTML = `
    <div class="nav-btn-left">
      <span class="nav-icon">
        <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/></svg>
      </span>
      <span class="nav-lbl">${ttName}</span>
    </div>`;
  nav.appendChild(ttBtn);
};

// 2. Extend renderYearPane to include the new subpane
const _origRenderYearPane = renderYearPane;
window.renderYearPane = function(yid) {
  _origRenderYearPane(yid);
  const yr   = getYear(yid);
  const pane = document.getElementById('pane-' + yid);
  if (!pane || !yr) return;
  const st = _yearSubtabs[yid] || APP.lastTab?.[yid] || 'dashboard';
  // Only add if not already present
  if (!document.getElementById(`sp-${yid}-schooltimetable`)) {
    const sp = document.createElement('div');
    sp.className = `subpane${st === 'schooltimetable' ? ' active' : ''}`;
    sp.id = `sp-${yid}-schooltimetable`;
    pane.appendChild(sp);
  }
  if (st === 'schooltimetable') {
    ttRenderPane(yid);
  }
};

// 3. Extend switchSubtab to handle schooltimetable
const _origSwitchSubtab = switchSubtab;
window.switchSubtab = function(yid, st) {
  if (st !== 'schooltimetable') {
    _origSwitchSubtab(yid, st);
    return;
  }

  // Mirror what the original function does
  _yearSubtabs[yid] = st;
  if (!APP.lastTab) APP.lastTab = {};
  APP.lastTab[yid] = st;

  if (APP.activeOverview) {
    APP.activeOverview = false;
    APP.activeYear = yid;
    const ovPane = document.getElementById('pane-overview');
    if (ovPane) { ovPane.style.display = 'none'; ovPane.classList.remove('active'); }
    const yearPane = document.getElementById('pane-' + yid);
    if (yearPane) { yearPane.style.display = 'block'; yearPane.classList.add('active'); }
    renderYearsNav();
  }

  persist();

  // Deactivate all subpanes in this year
  document.querySelectorAll(`#pane-${yid} > .subpane`).forEach(p => p.classList.remove('active'));

  // Activate ours (create if missing)
  let sp = document.getElementById(`sp-${yid}-schooltimetable`);
  if (!sp) {
    sp = document.createElement('div');
    sp.className = 'subpane active';
    sp.id = `sp-${yid}-schooltimetable`;
    const yearPane = document.getElementById('pane-' + yid);
    if (yearPane) yearPane.appendChild(sp);
  } else {
    sp.classList.add('active');
  }

  ttRenderPane(yid);
  renderSidebarNav(yid);
  renderHeader();
  closeSidebar();
};

// 4. Extend renderHeader to show a nice title for the new tab
const _origRenderHeader = renderHeader;
window.renderHeader = function() {
  _origRenderHeader();
  const yr = activeYear();
  if (!yr) return;
  const st = _yearSubtabs[yr.id] || APP.lastTab?.[yr.id] || 'dashboard';
  if (st !== 'schooltimetable') return;
  // Override the h1 set by renderHeader
  const s    = APP.settings;
  const name = s.name ? `<span class="hl">${s.name}'s </span>` : '';
  const h1   = document.getElementById('hdrTitle');
  if (h1) h1.innerHTML = `${name}School Timetable`;
};

// ── Default tab name ────────────────────────────────────────────────────────
// Make sure migrateData() doesn't strip our tab name on next load.
// We patch DEFAULT_TAB_NAMES (it's a const object, but properties are mutable).
if (typeof DEFAULT_TAB_NAMES !== 'undefined') {
  DEFAULT_TAB_NAMES.schooltimetable = 'School Timetable';
}

// ── Init ────────────────────────────────────────────────────────────────────

(function ttInit() {
  // Restore persisted view + list-period preferences
  const savedView = localStorage.getItem(TT_VIEW_KEY);
  if (['day', 'week', 'month', 'list'].includes(savedView)) _ttView = savedView;

  const savedPeriod = localStorage.getItem(TT_LIST_PER_KEY);
  if (['day', 'week', 'month'].includes(savedPeriod)) _ttListPeriod = savedPeriod;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { ttInjectCSS(); ttInjectDOM(); });
  } else {
    ttInjectCSS();
    ttInjectDOM();
  }
})();
