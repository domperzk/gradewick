// ── COURSE DATA ──
// Load the full dataset from course-data.js, which should be included before this file.
// ── COURSE DATA ──
// Data is loaded globally from course-data.js and module-data.js
let courseData = WARWICK_COURSES || [];
// First-run course import prompt. Separate from the main saved data so
// choosing "Skip" is remembered even if the user has not added modules yet.
const COURSE_ONBOARDING_KEY = 'gradetracker_course_onboarding_seen_v1';
// ── Colour presets ──
const COLOUR_PRESETS = [
  { name:'Warwick', hex:'#5B21B6', mid:'#3c1053', light:'#A78BFA', bg:'#F5F3FF', border:'#DDD6FE' },
  { name:'Navy',    hex:'#1E3A8A', mid:'#2563EB', light:'#93C5FD', bg:'#EFF6FF', border:'#BFDBFE' },
  { name:'Teal',    hex:'#0F766E', mid:'#0D9488', light:'#5EEAD4', bg:'#F0FDFA', border:'#99F6E4' },
  { name:'Rose',    hex:'#9F1239', mid:'#E11D48', light:'#FDA4AF', bg:'#FFF1F2', border:'#FECDD3' },
  { name:'Slate',   hex:'#334155', mid:'#475569', light:'#94A3B8', bg:'#F8FAFC', border:'#E2E8F0' },
  { name:'Forest',  hex:'#14532D', mid:'#16A34A', light:'#86EFAC', bg:'#F0FDF4', border:'#BBF7D0' },
  { name:'Amber',   hex:'#92400E', mid:'#D97706', light:'#FCD34D', bg:'#FFFBEB', border:'#FDE68A' },
  { name:'Crimson', hex:'#7F1D1D', mid:'#DC2626', light:'#FCA5A5', bg:'#FEF2F2', border:'#FECACA' },
];

const GRADE_SCALE_PRESETS = {
  'uk-honours': [
    { label:'First', min:70, color:'#059669' },
    { label:'2:1',   min:60, color:'#2563EB' },
    { label:'2:2',   min:50, color:'#D97706' },
    { label:'Third', min:40, color:'#EA580C' },
    { label:'Fail',  min:0,  color:'#DC2626' },
  ],
  'uk-postgrad': [
    { label:'Distinction', min:70, color:'#059669' },
    { label:'Merit',       min:60, color:'#2563EB' },
    { label:'Pass',        min:50, color:'#D97706' },
    { label:'Fail',        min:0,  color:'#DC2626' },
  ],
  'percentage-only': [],
};
const DEFAULT_GRADE_SCALE = 'uk-honours';
const DEFAULT_GRADE_THRESHOLDS = GRADE_SCALE_PRESETS[DEFAULT_GRADE_SCALE];

function cloneGradeThresholds(scale) {
  return JSON.parse(JSON.stringify(GRADE_SCALE_PRESETS[scale] || DEFAULT_GRADE_THRESHOLDS));
}

function getGradeThresholds() {
  if (APP && APP.settings && Array.isArray(APP.settings.gradeThresholds)) return APP.settings.gradeThresholds;
  return DEFAULT_GRADE_THRESHOLDS;
}

function getTargetThresholds() {
  return getGradeThresholds().filter(t => t.min > 0).sort((a,b) => b.min - a.min);
}

function getThresholdByMin(min) {
  return getTargetThresholds().find(t => Number(t.min) === Number(min)) || getTargetThresholds()[0] || null;
}

function makeId() { return '_' + Math.random().toString(36).slice(2, 9); }

/**
 * escapeHTML(str)
 * Lightweight XSS / HTML-injection guard.
 * Converts the five dangerous characters that break out of HTML attribute
 * values or tag content into their safe named entity equivalents.
 * Call this on every piece of user-supplied text before inserting it into
 * an innerHTML template literal.
 */
function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g,  '&amp;')   // must be first — avoids double-escaping
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

const CATEGORIES = {
  'Exam':       { css:'cat-exam',  label:'📋 Exam' },
  'Coursework': { css:'cat-cw',    label:'📝 Coursework' },
  'Essays':     { css:'cat-essay', label:'📄 Essays' },
  'Class Test': { css:'cat-test',  label:'✏ Class Test' },
  'Other':      { css:'cat-other', label:'📦 Other' },
};

function catClass(cat)     { return (CATEGORIES[cat] || CATEGORIES['Other']).css; }
function catBadgeHtml(cat) { const cls = catClass(cat); const lbl = (CATEGORIES[cat] || {label:cat}).label; return `<span class="cat-badge ${cls}">${lbl}</span>`; }
function isExamCat(cat)    { return cat === 'Exam'; }

/**
 * Infer a category from a component name string.
 * Uses keyword matching in priority order.
 */
function inferCategory(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('centrally-timetabled examination') ||
      n.includes('take home examination') ||
      n.includes('take-home examination') ||
      n.includes('oral examination') ||
      n.includes('oral exam') ||
      n.includes('final exam') ||
      n.includes('online examination') ||
      n.includes('in-person examination') ||
      (n.includes('examination') && !n.includes('pre-examination'))) return 'Exam';
  if (n.includes('essay') || n.includes('dissertation') || n.includes('literature review') || n.includes('book chapter') || n.includes('article review')) return 'Essays';
  if (n.includes('test') || n.includes('quiz') || n.includes('mcq') || n.includes('multiple choice') || n.includes('in-class') || n.includes('class test')) return 'Class Test';
  if (n.includes('coursework') || n.includes('assignment') || n.includes('report') || n.includes('project') || n.includes('lab') || n.includes('portfolio') ||
      n.includes('presentation') || n.includes('poster') || n.includes('dissertation')) return 'Coursework';
  return 'Coursework';
}

/**
 * enrichExamData(moduleCode, componentObj)
 *
 * Mutates componentObj in-place with official exam details from EXAM_TIMETABLE
 * when the component is an Exam category (or its name contains "exam").
 *
 * Lookup strategy (most → least specific):
 *   1. Exact uppercase key:        "CS118"
 *   2. Credit-suffixed variant:    "CS118-15", "CS118-10" (first match wins)
 *
 * Only overwrites date / time / duration / location — all other fields
 * (id, name, category, weight, etc.) are left completely untouched.
 *
 * Returns true if enrichment was applied, false otherwise.
 * The boolean return value lets callers decide whether to show a toast.
 */
function enrichExamData(moduleCode, componentObj) {
  // Guard 1 — dictionary must be loaded
  if (typeof EXAM_TIMETABLE === 'undefined') return false;

  // Guard 2 — must be an Exam component (by category or name keyword)
  const isExam =
    componentObj.category === 'Exam' ||
    (componentObj.name || '').toLowerCase().includes('exam');
  if (!isExam) return false;

  // Guard 3 — module code must be a usable string
  if (!moduleCode || typeof moduleCode !== 'string') return false;

  const code = moduleCode.trim().toUpperCase();

  // Lookup: exact match first, then any key that starts with "CODE-"
  let entry = EXAM_TIMETABLE[code] || null;

  if (!entry) {
    const suffixedKey = Object.keys(EXAM_TIMETABLE).find(
      k => k.toUpperCase() === code || k.toUpperCase().startsWith(code + '-')
    );
    if (suffixedKey) entry = EXAM_TIMETABLE[suffixedKey];
  }

  if (!entry) return false;

  // Apply official data — only these four fields are ever overwritten
  componentObj.date     = entry.date     || componentObj.date;
  componentObj.time     = entry.time     || componentObj.time;
  componentObj.duration = entry.duration || componentObj.duration;
  componentObj.location = entry.location || componentObj.location;

  return true;
}

function gradeColor(m) {
  const thresholds = getGradeThresholds();
  if (!thresholds.length || m === null || m === undefined || isNaN(parseFloat(m))) return 'var(--accent-mid)';
  // Fix 3: round to 1 d.p. so 69.999998 → 70.0 and correctly matches First threshold
  const mark = Math.round(parseFloat(m) * 10) / 10;
  const match = thresholds.find(t => mark >= t.min) || thresholds[thresholds.length - 1];
  return match.color || 'var(--accent-mid)';
}
function gradeClass(m) {
  const thresholds = getGradeThresholds();
  if (!thresholds.length) return 'Percentage only';
  if (m === null || m === undefined || isNaN(parseFloat(m))) return '—';
  // Fix 3: round to 1 d.p. so 69.999998 → 70.0 and correctly matches First threshold
  const mark = Math.round(parseFloat(m) * 10) / 10;
  const match = thresholds.find(t => mark >= t.min) || thresholds[thresholds.length - 1];
  return match.label || '—';
}

function parseDate(s) {
  if (!s) return null;
  s = String(s).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  // Fix 5: explicitly pass 12 for the hour so the date is anchored at noon.
  // Constructing at midnight local-time meant BST (+01:00) shifted UTC-midnight
  // dates to 23:00 the previous day, rendering "May 15" as "May 14" in the UI.
  if (iso) return new Date(+iso[1], +iso[2]-1, +iso[3], 12, 0, 0);

  // Legacy migration fallback for older DD/MM/YYYY data already stored.
  const legacy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (legacy) return new Date(+legacy[3], +legacy[2]-1, +legacy[1], 12, 0, 0);

  return null;
}

function fmtDate(s) {
  const d = parseDate(s);
  if (!d) return s || '—';
  return d.toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'});
}

function resolveCompDate(comp) {
  return parseDate(comp.date) || null;
}

const DEFAULT_TAB_NAMES = {
  dashboard: 'Dashboard',
  timetable: 'Exam Timetable',
  modules: 'Modules',
  checklist: 'Revision Checklist',
  target: 'Target Grades'
};

const DEFAULT_DATA = {
  settings: {
    name:'', uni:'', dept:'', code:'',
    darkMode:false, compact:false, accentPreset:0, accentCustom:'',
    gradeScale: DEFAULT_GRADE_SCALE,
    gradeThresholds: cloneGradeThresholds(DEFAULT_GRADE_SCALE),
    dashboardTargetGrade: 70,
    showGradeTargets: true,
    tabNames: JSON.parse(JSON.stringify(DEFAULT_TAB_NAMES))
  },
  years: [
    { id:'y1', label:'Year 1', acyr:'2025/26', modules:[], marks:{}, checklist:{}, futureModuleGrades:{}, futureComponentGrades:{}, weighting:0 }
  ],
  activeYear: 'y1',
  activeOverview: false,
  lastTab: {}
};

let APP = {};

function loadApp() {
  try {
    const s = localStorage.getItem('gradetracker_v7');
    if (s) { APP = JSON.parse(s); migrateData(); return; }
  } catch(e) {}
  APP = JSON.parse(JSON.stringify(DEFAULT_DATA));
  persist();
}

function migrateData() {
  if (!APP.settings) APP.settings = {};
  if (!APP.settings.tabNames) APP.settings.tabNames = JSON.parse(JSON.stringify(DEFAULT_TAB_NAMES));
  if (APP.settings.tabNames.checklist === 'Exam Checklist') APP.settings.tabNames.checklist = 'Revision Checklist';
  if (!APP.settings.gradeScale) APP.settings.gradeScale = DEFAULT_GRADE_SCALE;
  if (!Array.isArray(APP.settings.gradeThresholds)) APP.settings.gradeThresholds = cloneGradeThresholds(APP.settings.gradeScale);
  if (APP.settings.showGradeTargets === undefined) APP.settings.showGradeTargets = true;
  if (APP.settings.dashboardTargetGrade === undefined) APP.settings.dashboardTargetGrade = 70;
  if (!APP.lastTab) APP.lastTab = {};
  if (APP.activeOverview === undefined) APP.activeOverview = false;
  if (!APP.years) return;
  APP.years.forEach(yr => {
    if (!yr.marks)     yr.marks     = {};
    if (!yr.checklist) yr.checklist = {};
    if (yr.weighting === undefined) yr.weighting = 0;
    if (!yr.futureModuleGrades) yr.futureModuleGrades = {};
    if (!yr.futureComponentGrades) yr.futureComponentGrades = {};
    const oldDates  = yr.dates  || {};
    (yr.modules || []).forEach(mod => {
      (mod.components || []).forEach(c => {
        if (oldDates[c.id] && !c.date)  c.date = oldDates[c.id];
        if (!c.time)        c.time        = '';
        if (!c.duration)    c.duration    = '';
        if (!c.location)    c.location    = '';
        if (!c.category)    c.category    = 'Coursework';
        if (c.category === 'Coursework & Essays') c.category = 'Coursework';
        if (c.readingTime  === undefined) c.readingTime  = '';
        if (c.seat         === undefined) c.seat         = '';
        if (c.openBook     === undefined) c.openBook     = '';
      });
    });
    // TODO: remove in v9 — legacy migration for pre-v6 data
    delete yr.dates;
    delete yr.labels;
  });
}

function persist() {
  // Fix 4: wrap in try/catch so a full or blocked localStorage never causes a
  // silent JS crash — the user gets a visible toast warning instead.
  try {
    localStorage.setItem('gradetracker_v7', JSON.stringify(APP));
  } catch (e) {
    showToast('⚠ Unable to save — storage full or blocked.');
    return; // skip the "saved" indicator when the write failed
  }
  const el = document.getElementById('autosaveIndicator');
  if (!el) return;
  el.classList.add('saving');
  const label = el.querySelector('.autosave-lbl');
  if (label) label.textContent = 'Saving…';
  clearTimeout(persist._t);
  persist._t = setTimeout(() => {
    el.classList.remove('saving');
    const lbl = el.querySelector('.autosave-lbl');
    if (lbl) lbl.textContent = 'All changes saved';
  }, 900);
}
function saveAll()  { persist(); }
function getYear(yid) { return APP.years.find(y => y.id === yid); }
function activeYear()  { return getYear(APP.activeYear); }
function totalCats(yr) { return yr.modules.reduce((s,m) => s+m.cats, 0); }

function modTotal(mod, marks) {
  let s=0;
  for (const c of mod.components) {
    const v = marks[c.id];
    if (v===''||v===undefined||v===null||isNaN(parseFloat(v))) return null;
    s += parseFloat(v) * (c.weight/100);
  }
  return mod.components.length>0 ? s : null;
}

function modPartial(mod, marks) {
  let s=0, any=false;
  for (const c of mod.components) {
    const v = marks[c.id];
    if (v!==''&&v!==undefined&&v!==null&&!isNaN(parseFloat(v))) { s+=parseFloat(v)*(c.weight/100); any=true; }
  }
  return any ? s : null;
}

function modEnteredWeight(mod, marks) {
  return mod.components.filter(c => { const v=marks[c.id]; return v!==''&&v!==undefined&&v!==null&&!isNaN(parseFloat(v)); }).reduce((s,c)=>s+c.weight,0);
}

function yearMark(yr) {
  const parts=[];
  yr.modules.forEach(m => { const t=modTotal(m,yr.marks); if(t!==null) parts.push({cats:m.cats,mark:t}); });
  if (!parts.length) return null;
  const tc=parts.reduce((s,p)=>s+p.cats,0);
  return parts.reduce((s,p)=>s+p.mark*p.cats,0)/tc;
}

// Compute a weighted overall degree mark from GRADED years only, using their
// weightings as a ratio against each other (not against the full degree's
// total weighting). E.g. Year 1 = 10% weighting at 60%, Year 2 = 30%
// weighting at 70%, Year 3 = 60% weighting but ungraded → projected mark is
// (60*10 + 70*30) / (10+30) = 67.5%, not diluted down to ~27% by Year 3's
// not-yet-earned weighting.
function overallDegreeMark() {
  let sum = 0, gradedW = 0, hasAny = false;
  for (const yr of APP.years) {
    const w = yr.weighting || 0;
    if (!w) continue;
    const ym = yearMark(yr);
    if (ym === null) continue;
    sum += ym * w;
    gradedW += w;
    hasAny = true;
  }
  if (!hasAny) return null;
  return sum / gradedW;
}

/** Sum of weighting (%) across years that currently have a usable grade. */
function gradedDegreeWeighting() {
  return APP.years.reduce((s, y) => {
    const w = y.weighting || 0;
    if (!w) return s;
    return yearMark(y) !== null ? s + w : s;
  }, 0);
}


function applyDarkMode(enabled) { document.documentElement.setAttribute('data-theme', enabled?'dark':'light'); }
function applyDensity(mode)     { document.documentElement.setAttribute('data-density', mode); }

function applyAccentColour(preset, customHex) {
  const root = document.documentElement;
  if (customHex) {
    root.style.setProperty('--accent',        customHex);
    root.style.setProperty('--accent-mid',    customHex);
    root.style.setProperty('--accent-light',  hexWithAlpha(customHex,0.6));
    root.style.setProperty('--accent-bg',     hexWithAlpha(customHex,0.08));
    root.style.setProperty('--accent-border', hexWithAlpha(customHex,0.25));
    root.style.setProperty('--cat-exam-color',  customHex);
    root.style.setProperty('--cat-exam-bg',     hexWithAlpha(customHex,0.08));
    root.style.setProperty('--cat-exam-border', hexWithAlpha(customHex,0.25));
  } else {
    const p = COLOUR_PRESETS[preset] || COLOUR_PRESETS[0];
    root.style.setProperty('--accent',        p.hex);
    root.style.setProperty('--accent-mid',    p.mid);
    root.style.setProperty('--accent-light',  p.light);
    root.style.setProperty('--accent-bg',     p.bg);
    root.style.setProperty('--accent-border', p.border);
    root.style.setProperty('--cat-exam-color',  p.mid);
    root.style.setProperty('--cat-exam-bg',     p.bg);
    root.style.setProperty('--cat-exam-border', p.border);
  }
}

function hexWithAlpha(hex, alpha) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function restoreAppearance() {
  const s = APP.settings;
  applyDarkMode(s.darkMode);
  applyDensity(s.compact?'compact':'normal');
  applyAccentColour(s.accentPreset||0, s.accentCustom||'');
}

function renderSwatches() {
  const container = document.getElementById('colourSwatches');
  if (!container) return;
  const activeIdx = APP.settings.accentPreset??0;
  const hasCustom = !!APP.settings.accentCustom;
  container.innerHTML = COLOUR_PRESETS.map((p,i) => `
    <div class="colour-swatch ${!hasCustom&&i===activeIdx?'selected':''}" style="background:${p.mid}" title="${p.name}" onclick="pickPreset(${i})"></div>
  `).join('');
}

function pickPreset(idx) {
  APP.settings.accentPreset = idx; APP.settings.accentCustom = '';
  applyAccentColour(idx,''); renderSwatches();
  const picker = document.getElementById('cfg-customColour');
  if (picker) picker.value = COLOUR_PRESETS[idx].mid;
}

function applyCustomColour(hex) {
  APP.settings.accentCustom = hex;
  applyAccentColour(null, hex);
  document.querySelectorAll('.colour-swatch').forEach(s => s.classList.remove('selected'));
}

function renderHeader() {
  const s=APP.settings, yr=activeYear();
  document.getElementById('logoSub').textContent = s.uni || 'Your academic journey';
  const name = s.name ? `<span class="hl">${s.name}'s </span>` : '';
  const eyeParts = [s.uni, s.dept].filter(Boolean);
  document.getElementById('hdrEyebrow').textContent = eyeParts.length ? eyeParts.join(' · ') : 'Gradewick';
  
  if (APP.activeOverview) {
    document.getElementById('hdrTitle').innerHTML = `${name}All Years Overview`;
    return;
  }

  const yearLabel = yr ? yr.label : '';
  const st = _yearSubtabs[yr?.id] || APP.lastTab?.[yr?.id] || 'dashboard';
  let tabName = s.tabNames[st] || DEFAULT_TAB_NAMES[st];
  if(st === 'dashboard') tabName = yearLabel || 'Dashboard';
  
  document.getElementById('hdrTitle').innerHTML = `${name}${tabName}`;
}

let yeEditId = null;
function renderYearsNav() {
  const nav = document.getElementById('yearsNav');
  nav.innerHTML = '';

  // Overview tab
  const ovBtn = document.createElement('div');
  ovBtn.className = 'year-tab-btn' + (APP.activeOverview ? ' active' : '');
  ovBtn.onclick = () => switchOverview();
  ovBtn.setAttribute('aria-label', 'All Years Overview');
  const ovLeft = document.createElement('div'); ovLeft.className = 'yr-left';
  const ovDot = document.createElement('span'); ovDot.className = 'yr-dot';
  const ovLabel = document.createElement('span'); ovLabel.className = 'yr-label'; ovLabel.textContent = '✦ All Years';
  ovLeft.appendChild(ovDot); ovLeft.appendChild(ovLabel);
  ovBtn.appendChild(ovLeft);
  nav.appendChild(ovBtn);

  APP.years.forEach(yr => {
    const btn = document.createElement('div');
    btn.className = 'year-tab-btn' + (!APP.activeOverview && yr.id===APP.activeYear?' active':'');
    btn.onclick = () => switchYear(yr.id);
    btn.setAttribute('aria-label', `${yr.label}`);

    const left = document.createElement('div');
    left.className = 'yr-left';
    const dot = document.createElement('span'); dot.className = 'yr-dot';
    const label = document.createElement('span'); label.className = 'yr-label'; label.textContent = yr.label;
    left.appendChild(dot); left.appendChild(label);

    const editBtn = document.createElement('button');
    editBtn.className = 'icon-btn btn-sm yr-edit-btn';
    editBtn.innerHTML = '✎';
    editBtn.title = 'Edit year';
    editBtn.setAttribute('aria-label', `Edit ${yr.label}`);
    editBtn.onclick = (e) => { e.stopPropagation(); openYearEdit(yr.id); };

    btn.appendChild(left);
    btn.appendChild(editBtn);
    nav.appendChild(btn);
  });
  const addBtn = document.createElement('button');
  addBtn.className = 'add-year-btn';
  addBtn.innerHTML = '+ Add year';
  addBtn.onclick   = () => openYearEdit(null);
  nav.appendChild(addBtn);
}

let editingTabKey = null;
function openTabEdit(key) {
  editingTabKey = key;
  document.getElementById('te-key').value = key;
  document.getElementById('te-name').value = APP.settings.tabNames[key] || DEFAULT_TAB_NAMES[key];
  openOverlay('tabEditOverlay');
}

function saveTabEdit() {
  const key = document.getElementById('te-key').value;
  const name = document.getElementById('te-name').value.trim();
  if(!name) { showToast('Please enter a name'); return; }
  APP.settings.tabNames[key] = name;
  persist();
  closeOverlayDirect('tabEditOverlay');
  renderSidebarNav(APP.activeYear);
  renderHeader();
}

function renderSidebarNav(yid) {
  const nav = document.getElementById('sidebarNav');
  const st  = _yearSubtabs[yid] || APP.lastTab?.[yid] || 'dashboard';
  const names = APP.settings.tabNames;
  
  const tabs = [
    { id: 'dashboard', icon: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>` },
    { id: 'timetable', icon: `<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/></svg>` },
    { id: 'modules',   icon: `<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>` },
    { id: 'checklist', icon: `<svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>` },
    { id: 'target',    icon: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/></svg>` },
  ];

  nav.innerHTML = tabs.map(t => `
    <div class="nav-btn ${st===t.id?'active':''}" onclick="switchSubtab('${yid}','${t.id}')">
      <div class="nav-btn-left">
        <span class="nav-icon">${t.icon}</span> <span class="nav-lbl">${names[t.id] || DEFAULT_TAB_NAMES[t.id]}</span>
      </div>
      <button class="icon-btn btn-sm nav-edit-btn" aria-label="Edit ${names[t.id] || DEFAULT_TAB_NAMES[t.id]}" onclick="event.stopPropagation();openTabEdit('${t.id}')" title="Edit section name">✎</button>
    </div>
  `).join('');
}

function switchYear(yid) {
  APP.activeYear = yid;
  APP.activeOverview = false;
  if (APP.lastTab?.[yid]) _yearSubtabs[yid] = APP.lastTab[yid];
  renderYearsNav(); renderYearPanes(); renderSidebarNav(yid); renderHeader(); persist();
}

function switchOverview() {
  APP.activeOverview = true;
  renderYearsNav(); renderOverviewPane();
  // Show/hide panes
  document.querySelectorAll('.year-pane').forEach(p => { p.style.display = 'none'; p.classList.remove('active'); });
  const ovPane = document.getElementById('pane-overview');
  if (ovPane) { ovPane.style.display = 'block'; ovPane.classList.add('active'); }
  renderSidebarNav(APP.activeYear);
  renderHeader();
  persist();
}

function renderOverviewPane() {
  const pane = document.getElementById('pane-overview');
  if (!pane) return;
  pane.innerHTML = buildOverview();
}

function openYearEdit(yid) {
  yeEditId = yid;
  const yr = yid ? getYear(yid) : null;
  document.getElementById('yearEditEyebrow').textContent = yid ? 'Edit year' : 'Add year';
  document.getElementById('yearEditTitle').textContent   = yid ? yr.label : 'New Academic Year';
  document.getElementById('ye-label').value = yr ? yr.label : '';
  document.getElementById('ye-acyr').value  = yr ? yr.acyr  : '';
  document.getElementById('ye-weighting').value = yr ? (yr.weighting || 0) : 0;
  document.getElementById('deleteYearBtn').style.display = yid ? 'inline-flex' : 'none';
  openOverlay('yearEditOverlay');
}

function saveYearEdit() {
  const label = document.getElementById('ye-label').value.trim();
  const acyr  = document.getElementById('ye-acyr').value.trim();
  const weighting = Math.max(0, Math.min(100, parseFloat(document.getElementById('ye-weighting').value) || 0));
  if (!label) { showToast('Please enter a label'); return; }
  if (yeEditId) {
    const yr = getYear(yeEditId); yr.label=label; yr.acyr=acyr; yr.weighting=weighting;
  } else {
    const nid = makeId();
    APP.years.push({id:nid,label,acyr,modules:[],marks:{},checklist:{},futureModuleGrades:{},futureComponentGrades:{},weighting});
    APP.activeYear = nid;
    APP.activeOverview = false;
  }
  persist(); closeOverlayDirect('yearEditOverlay'); renderAll();
}

function deleteCurrentYear() {
  if (APP.years.length<=1) { showToast('Cannot delete the only year.'); return; }
  const yrToDelete = getYear(yeEditId);
  if (!confirm(`Delete "${yrToDelete.label}" and all its data? This cannot be undone.`)) return;
  APP.years = APP.years.filter(y => y.id!==yeEditId);
  if (APP.activeYear===yeEditId) APP.activeYear = APP.years[0].id;
  persist(); closeOverlayDirect('yearEditOverlay'); renderAll();
}

let meYid=null, meModId=null;
function openModEdit(yid, modId) {
  meYid=yid; meModId=modId;
  const yr=getYear(yid), mod=modId?yr.modules.find(m=>m.id===modId):null;
  document.getElementById('modEditEyebrow').textContent = modId ? 'Edit module' : 'Add module';
  document.getElementById('modEditTitle').textContent   = modId ? mod.name : 'New Module';
  document.getElementById('me-code').value = mod ? mod.code : '';
  document.getElementById('me-name').value = mod ? mod.name : '';
  document.getElementById('me-cats').value = mod ? mod.cats : '';
  document.getElementById('deleteModBtn').style.display = modId ? 'inline-flex' : 'none';
  openOverlay('modEditOverlay');
}

function saveModEdit() {
  const code=document.getElementById('me-code').value.trim().toUpperCase();
  const name=document.getElementById('me-name').value.trim();
  const cats=parseInt(document.getElementById('me-cats').value)||0;
  if (!code||!name) { showToast('Fill in code and name'); return; }
  const yr=getYear(meYid);
  if (meModId) {
    const mod=yr.modules.find(m=>m.id===meModId); mod.code=code; mod.name=name; mod.cats=cats;
  } else {
    const nid=makeId();
    // Auto-populate components from module dict if available
    const dictEntry = ALL_MODULES_DICT[code];
    const components = [];
    if (dictEntry && dictEntry.components && dictEntry.components.length > 0) {
      dictEntry.components.forEach(c => {
        const componentObj = {
          id: makeId(),
          name: c.name,
          weight: c.weight,
          category: inferCategory(c.name),
          date: '', time: '', duration: '', location: '',
          readingTime: '', seat: '', openBook: ''
        };
        enrichExamData(code, componentObj);
        components.push(componentObj);
      });
    }
    yr.modules.push({id:nid, code, name, cats, components, url: dictEntry ? dictEntry.url : ''});
    if (!yr.checklist) yr.checklist={};
    if (!yr.futureModuleGrades) yr.futureModuleGrades={};
    if (!yr.futureComponentGrades) yr.futureComponentGrades={};
    yr.checklist[nid]={topics:[],done:{}};
  }
  persist(); closeOverlayDirect('modEditOverlay'); renderYearPane(meYid);
}

function deleteCurrentMod() {
  const yr=getYear(meYid);
  const modToDelete = yr.modules.find(m=>m.id===meModId);
  if (!confirm(`Delete "${modToDelete?.name || 'this module'}" and all its components? This cannot be undone.`)) return;
  if (modToDelete) {
    if (yr.futureModuleGrades) delete yr.futureModuleGrades[modToDelete.id];
    if (yr.futureComponentGrades) (modToDelete.components || []).forEach(c=>delete yr.futureComponentGrades[c.id]);
  }
  yr.modules=yr.modules.filter(m=>m.id!==meModId);
  persist(); closeOverlayDirect('modEditOverlay'); renderYearPane(meYid);
}

let ceYid=null, ceModId=null, ceCompId=null;
function openCompEdit(yid, modId, compId) {
  ceYid=yid; ceModId=modId; ceCompId=compId;
  const yr=getYear(yid), mod=yr.modules.find(m=>m.id===modId);
  const comp=compId?mod.components.find(c=>c.id===compId):null;
  document.getElementById('compEditTitle').textContent = compId ? 'Edit Component' : 'Add Component';
  document.getElementById('ce-name').value     = comp ? comp.name     : '';
  document.getElementById('ce-weight').value   = comp ? comp.weight   : '';
  document.getElementById('ce-date').value     = comp ? (comp.date     || '') : '';
  document.getElementById('ce-time').value     = comp ? (comp.time     || '') : '';
  document.getElementById('ce-duration').value = comp ? (comp.duration || '') : '';
  document.getElementById('ce-location').value = comp ? (comp.location || '') : '';
  document.getElementById('ce-readingTime').value = comp ? (comp.readingTime || '') : '';
  document.getElementById('ce-seat').value       = comp ? (comp.seat        || '') : '';
  document.getElementById('ce-openBook').value   = comp ? (comp.openBook    || '') : '';
  // Sync the open-book toggle buttons
  selectOpenBook(comp ? (comp.openBook || '') : '');
  document.getElementById('ce-category').value = comp ? (comp.category || 'Coursework') : 'Coursework';
  document.getElementById('deleteCompBtn').style.display = compId ? 'inline-flex' : 'none';
  // Handle custom category input visibility
  const savedCat = comp ? (comp.category || 'Coursework') : 'Coursework';
  const isCustom = !CATEGORIES[savedCat];
  const customWrap = document.getElementById('ce-category-custom-wrap');
  const customInp  = document.getElementById('ce-category-custom');
  if (customWrap) customWrap.style.display = isCustom ? 'block' : 'none';
  if (customInp)  customInp.value = isCustom ? savedCat : '';
  // If category is a custom string, mark Other as active in the selector
  syncCatSelector(isCustom ? 'Other' : savedCat);
  if (isCustom) document.getElementById('ce-category').value = 'Other';
  openOverlay('compEditOverlay');
}

function syncCatSelector(selectedCat) {
  document.querySelectorAll('#catSelector .cat-sel-btn').forEach(btn => {
    btn.className = 'cat-sel-btn';
    if (btn.dataset.cat===selectedCat) {
      if (selectedCat==='Exam') btn.classList.add('active-exam');
      else if (selectedCat==='Coursework') btn.classList.add('active-cw');
      else if (selectedCat==='Essays') btn.classList.add('active-essay');
      else if (selectedCat==='Class Test') btn.classList.add('active-test');
      else if (selectedCat==='Other') btn.classList.add('active-other');
    }
  });
}

function selectCat(btn) {
  document.getElementById('ce-category').value = btn.dataset.cat;
  syncCatSelector(btn.dataset.cat);
  const customWrap = document.getElementById('ce-category-custom-wrap');
  if (customWrap) {
    const isOther = btn.dataset.cat === 'Other';
    customWrap.style.display = isOther ? 'block' : 'none';
    if (!isOther) {
      const customInp = document.getElementById('ce-category-custom');
      if (customInp) customInp.value = '';
    }
  }
}

function selectOpenBook(val) {
  document.getElementById('ce-openBook').value = val;
  ['yes','no','na'].forEach(id => {
    const btn = document.getElementById('ob-' + id);
    if (btn) btn.classList.toggle('active', btn.dataset.val === val);
  });
}

function saveCompEdit() {
  const name     = document.getElementById('ce-name').value.trim();
  const customCatInp = document.getElementById('ce-category-custom');
  const customCatVal = customCatInp ? customCatInp.value.trim() : '';
  const baseCat  = document.getElementById('ce-category').value || 'Coursework';
  // If the user typed a custom category name, use that; otherwise use the button selection
  const category = (baseCat === 'Other' && customCatVal) ? customCatVal : baseCat;
  const weight   = parseFloat(document.getElementById('ce-weight').value) || 0;
  const date     = document.getElementById('ce-date').value.trim();
  const time     = document.getElementById('ce-time').value.trim();
  const duration = document.getElementById('ce-duration').value.trim();
  const location = document.getElementById('ce-location').value.trim();
  const readingTime = document.getElementById('ce-readingTime').value.trim();
  const seat        = document.getElementById('ce-seat').value.trim();
  const openBook    = document.getElementById('ce-openBook').value;
  if (!name||!weight) { showToast('Fill in name and weight'); return; }
  const yr=getYear(ceYid), mod=yr.modules.find(m=>m.id===ceModId);
  if (ceCompId) {
    // ── EDIT existing component — apply the user's explicit values as-is ──
    const comp=mod.components.find(c=>c.id===ceCompId);
    comp.name=name; comp.category=category; comp.weight=weight;
    comp.date=date; comp.time=time; comp.duration=duration; comp.location=location;
    comp.readingTime=readingTime; comp.seat=seat; comp.openBook=openBook;
  } else {
    // ── ADD new component — build the object, then attempt auto-fill ──
    const newComp = {id:makeId(),name,category,weight,date,time,duration,location,readingTime,seat,openBook};
    // enrichExamData returns true only when it found and applied official timetable data
    const wasEnriched = enrichExamData(mod.code, newComp);
    mod.components.push(newComp);
    if (wasEnriched) {
      // Defer the toast slightly so it appears after the overlay close animation
      setTimeout(() => showToast('📅 Official exam details auto-filled.'), 150);
    }
  }
  persist(); closeOverlayDirect('compEditOverlay'); renderYearPane(ceYid);
}

function deleteCurrentComp() {
  const yr=getYear(ceYid), mod=yr.modules.find(m=>m.id===ceModId);
  const compToDelete = mod.components.find(c=>c.id===ceCompId);
  if (!confirm(`Delete "${compToDelete?.name || 'this component'}"? This cannot be undone.`)) return;
  if (yr.futureComponentGrades) delete yr.futureComponentGrades[ceCompId];
  if (yr.marks) delete yr.marks[ceCompId];
  mod.components=mod.components.filter(c=>c.id!==ceCompId);
  if (yr.futureModuleGrades && mod) yr.futureModuleGrades[mod.id] = getFutureModuleGrade(yr, mod);
  persist(); closeOverlayDirect('compEditOverlay'); renderYearPane(ceYid);
}

function openEditSettings() {
  const s=APP.settings;
  document.getElementById('cfg-name').value    = s.name  || '';
  document.getElementById('cfg-uni').value     = s.uni   || '';
  document.getElementById('cfg-dept').value    = s.dept  || '';
  document.getElementById('cfg-code').value    = s.code  || '';
  document.getElementById('cfg-dark').checked  = !!s.darkMode;
  document.getElementById('cfg-compact').checked = !!s.compact;
  const gradeScaleEl = document.getElementById('cfg-gradeScale');
  if (gradeScaleEl) gradeScaleEl.value = s.gradeScale || DEFAULT_GRADE_SCALE;
  const activePreset = COLOUR_PRESETS[s.accentPreset||0];
  const picker = document.getElementById('cfg-customColour');
  if (picker) picker.value = s.accentCustom || activePreset.mid;
  renderSwatches();
  openOverlay('settingsOverlay');
}


function setGradeScale(scale) {
  const safeScale = GRADE_SCALE_PRESETS[scale] ? scale : DEFAULT_GRADE_SCALE;
  APP.settings.gradeScale = safeScale;
  APP.settings.gradeThresholds = cloneGradeThresholds(safeScale);
}

function applyGradeScale(scale) {
  setGradeScale(scale);
  persist();
  renderAll();
  showToast('Grading scale updated.');
}

function saveSettings() {
  const s=APP.settings;
  s.name   = document.getElementById('cfg-name').value.trim();
  s.uni    = document.getElementById('cfg-uni').value.trim();
  s.dept   = document.getElementById('cfg-dept').value.trim();
  s.code   = document.getElementById('cfg-code').value.trim();
  s.darkMode = document.getElementById('cfg-dark').checked;
  s.compact  = document.getElementById('cfg-compact').checked;
  const gradeScaleEl = document.getElementById('cfg-gradeScale');
  if (gradeScaleEl && gradeScaleEl.value !== s.gradeScale) setGradeScale(gradeScaleEl.value);
  persist(); restoreAppearance(); closeOverlayDirect('settingsOverlay'); renderAll();
  showToast('Settings saved!');
}

function openOverlay(id) {
  closeSidebar();
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.add('open');
  // Fix 2: push a history entry so the mobile back-button closes the modal
  // instead of navigating away from the page.
  history.pushState({ modal: id }, '');
  const firstInput = overlay.querySelector('input:not([type=hidden]), select, textarea');
  if (firstInput) setTimeout(() => firstInput.focus(), 80);
}
function closeOverlay(id,e)     { if(e.target===document.getElementById(id)) document.getElementById(id).classList.remove('open'); }
function closeOverlayDirect(id) { document.getElementById(id).classList.remove('open'); }
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const openOverlay = document.querySelector('.overlay.open');
  if (openOverlay) closeOverlayDirect(openOverlay.id);
});

// Fix 2: intercept the browser back-button / swipe-back gesture on mobile.
// If a modal is currently open, close it and absorb the navigation event
// instead of letting the browser leave the page.
window.addEventListener('popstate', e => {
  const openModal = document.querySelector('.overlay.open');
  if (openModal) {
    closeOverlayDirect(openModal.id);
    // Re-push so the next back-press still works if multiple modals were opened.
    // (history stack was already popped by the browser before popstate fires.)
  }
});

function setSidebarOpen(open) {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const hamburger = document.querySelector('.hamburger');
  if (!sidebar || !overlay) return;
  sidebar.classList.toggle('open', open);
  overlay.classList.toggle('open', open);
  document.body.classList.toggle('sidebar-is-open', open);
  if (hamburger) hamburger.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function toggleSidebar(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  const sidebar = document.getElementById('sidebar');
  const isOpen = sidebar && sidebar.classList.contains('open');
  setSidebarOpen(!isOpen);
}

function closeSidebar() {
  setSidebarOpen(false);
}

function shouldKeepSidebarOpenForClick(e) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar || !sidebar.classList.contains('open')) return true;

  const clickedSidebar = sidebar.contains(e.target);
  const clickedToggle = !!(e.target.closest && e.target.closest('.hamburger'));
  return clickedSidebar || clickedToggle;
}

document.addEventListener('pointerdown', e => {
  if (!shouldKeepSidebarOpenForClick(e)) closeSidebar();
}, true);

document.addEventListener('click', e => {
  if (!shouldKeepSidebarOpenForClick(e)) closeSidebar();
});

function renderAll() { renderHeader(); renderYearsNav(); renderYearPanes(); renderOverviewPane(); renderSidebarNav(APP.activeYear); }

function renderYearPanes() {
  const cont=document.getElementById('yearPanes'); cont.innerHTML='';

  // Overview pane (always present)
  const ovPane = document.createElement('div');
  ovPane.className = 'year-pane' + (APP.activeOverview ? ' active' : '');
  ovPane.id = 'pane-overview';
  ovPane.style.display = APP.activeOverview ? 'block' : 'none';
  cont.appendChild(ovPane);

  APP.years.forEach(yr => {
    const pane=document.createElement('div');
    pane.className='year-pane'+(!APP.activeOverview && yr.id===APP.activeYear?' active':'');
    pane.id='pane-'+yr.id;
    pane.style.display=(!APP.activeOverview && yr.id===APP.activeYear)?'block':'none';
    cont.appendChild(pane);
    renderYearPane(yr.id);
  });
  renderOverviewPane();
}

const _yearSubtabs={}, _ttFilterCat={}, _ttFilterTime={};

function renderYearPane(yid) {
  const yr=getYear(yid), pane=document.getElementById('pane-'+yid);
  if(!pane) return;
  const st=_yearSubtabs[yid] || APP.lastTab?.[yid] || 'dashboard';
  pane.innerHTML=`
    <div class="subpane ${st==='dashboard'?'active':''}"  id="sp-${yid}-dashboard">${buildDashboard(yr)}</div>
    <div class="subpane ${st==='timetable'?'active':''}"  id="sp-${yid}-timetable">${buildTimetable(yr)}</div>
    <div class="subpane ${st==='modules'?'active':''}"    id="sp-${yid}-modules">${buildModules(yr)}</div>
    <div class="subpane ${st==='checklist'?'active':''}"  id="sp-${yid}-checklist">${buildChecklist(yr)}</div>
    <div class="subpane ${st==='target'?'active':''}"     id="sp-${yid}-target">${buildTarget(yr)}</div>
  `;
}

// AFTER
function switchSubtab(yid, st) {
  _yearSubtabs[yid] = st;
  if (!APP.lastTab) APP.lastTab = {};
  APP.lastTab[yid] = st;

  // ── FIX: If the user is currently on the "All Years" overview,
  //    force the app back to the year view before switching the subtab.
  if (APP.activeOverview) {
    APP.activeOverview = false;
    APP.activeYear = yid;

    // Hide overview pane
    const ovPane = document.getElementById('pane-overview');
    if (ovPane) { ovPane.style.display = 'none'; ovPane.classList.remove('active'); }

    // Show the target year pane
    const yearPane = document.getElementById('pane-' + yid);
    if (yearPane) { yearPane.style.display = 'block'; yearPane.classList.add('active'); }

    renderYearsNav();
  }

  persist();
  document.querySelectorAll(`#pane-${yid} > .subpane`).forEach(p => p.classList.remove('active'));
  const target = document.getElementById(`sp-${yid}-${st}`);
  if (target) target.classList.add('active');
  renderSidebarNav(yid);
  renderHeader();
  closeSidebar();
}

// ── Overview (All Years) ──
function buildOverview() {
  const totalW = APP.years.reduce((s,y) => s + (y.weighting||0), 0);
  const hasWeightings = totalW > 0;
  const overallMark = overallDegreeMark();
  const gradedW = gradedDegreeWeighting();

  const hint = `<div class="menu-hint">
    <span class="menu-hint-icon">☰</span>
    <span>Use the <strong>menu button</strong> or <strong>sidebar</strong> to navigate individual years.</span>
  </div>`;

  // Overall degree mark card
  let overallHtml = '';
  if (hasWeightings) {
    const col = overallMark !== null ? gradeColor(overallMark) : 'var(--tx4)';
    const cls = overallMark !== null ? gradeClass(overallMark) : '—';
    const subText = overallMark !== null
      ? `Based on ${gradedW}% of your degree graded so far${gradedW < totalW ? ` (${totalW}% weighting assigned in total)` : ''}`
      : `Based on year weightings · ${totalW}% accounted for`;
    overallHtml = `
      <div class="ov-overall-card">
        <div class="ov-overall-label">Projected Degree Classification</div>
        <div class="ov-overall-mark" style="color:${col}">${overallMark !== null ? overallMark.toFixed(1)+'%' : '—'}</div>
        <div class="ov-overall-cls" style="color:${col}">${cls}</div>
        <div class="ov-overall-sub">${subText}</div>
      </div>`;
  } else {
    overallHtml = `
      <div class="ov-overall-card ov-overall-muted">
        <div class="ov-overall-label">Projected Degree Classification</div>
        <div class="ov-overall-mark" style="color:var(--tx4)">—</div>
        <div class="ov-overall-sub">Set year weightings via ✎ Edit on each year to see your projected classification</div>
      </div>`;
  }

  // Target grade planner
  const targetPlannerHtml = buildOverviewTargetPlanner();

  // Per-year summary cards
  let yearCards = '';
  APP.years.forEach(yr => {
    const ym = yearMark(yr);
    const totalMods = yr.modules.length;
    const completedMods = yr.modules.filter(m => modTotal(m, yr.marks) !== null).length;
    const completedCats = yr.modules.reduce((s,m) => s + (modTotal(m,yr.marks)!==null ? m.cats : 0), 0);
    const totalCats2 = yr.modules.reduce((s,m) => s + m.cats, 0);
    const wt = yr.weighting || 0;

    const col = ym !== null ? gradeColor(ym) : 'var(--tx4)';
    const cls = ym !== null ? gradeClass(ym) : '';

    let pills = yr.modules.map(m => {
      const t = modTotal(m, yr.marks);
      const p = modPartial(m, yr.marks);
      const label = t !== null ? `<span class="ps">${t.toFixed(1)}%</span>` : p !== null ? `<span style="color:var(--tx3)">${p.toFixed(1)}pt</span>` : `<span style="color:var(--tx4)">—</span>`;
      return `<div class="yr-pill">${m.code} ${label}</div>`;
    }).join('');

    const wtLabel = wt ? wt + '% weight ✎' : 'No weight set — click to add ✎';
    const wtCls   = wt ? 'ov-yr-card-wt ov-wt-set' : 'ov-yr-card-wt ov-wt-unset';

    yearCards += `
      <div class="ov-yr-card" onclick="switchYear('${yr.id}')">
        <div class="ov-yr-card-hdr">
          <div class="ov-yr-card-label">${yr.label} <span class="ov-yr-acyr">${yr.acyr||''}</span></div>
          <div id="ov-wt-${yr.id}" class="${wtCls}" title="Click to set year weighting" onclick="event.stopPropagation();ovStartWeightEdit('${yr.id}')">${wtLabel}</div>
        </div>
        <div class="ov-yr-card-mark" style="color:${col}">${ym !== null ? ym.toFixed(1)+'%' : '—'} <span class="ov-yr-card-cls">${cls}</span></div>
        <div class="ov-yr-card-meta">${completedMods} / ${totalMods} modules · ${completedCats} / ${totalCats2} credits</div>
        <div class="yr-pills" style="margin-top:10px">${pills || '<span style="color:var(--tx4);font-size:11px;font-family:var(--fm)">No modules</span>'}</div>
      </div>`;
  });

  return hint + overallHtml + targetPlannerHtml + `<div class="ov-yr-grid">${yearCards}</div>`;
}

function buildOverviewTargetPlanner() {
  const TARGETS = getTargetThresholds();
  const totalW = APP.years.reduce((s,y)=>s+(y.weighting||0),0);
  if (!totalW || !TARGETS.length) return '';

  let sel = APP.overviewTargetGrade !== undefined ? APP.overviewTargetGrade : TARGETS[0].min;
  if (!TARGETS.some(t => Number(t.min) === Number(sel))) sel = TARGETS[0].min;

  // Calculate: weighted sum of known years + weighted unknown years contribution
  // required_overall = sel
  // sum(known_ym * w) + req_unknown * sum(unknown_w) = sel * totalW
  let knownSum = 0, unknownW = 0;
  for (const yr of APP.years) {
    const w = yr.weighting || 0;
    if (!w) continue;
    const ym = yearMark(yr);
    if (ym !== null) knownSum += ym * w;
    else unknownW += w;
  }

  const targetBtns = TARGETS.map(t =>
    `<button class="ov-target-btn${sel===t.min?' active':''}" style="${sel===t.min?`background:${t.color};color:var(--s1);border-color:${t.color}`:`color:${t.color};border-color:${t.color}44`}" onclick="setOverviewTarget(${t.min})">${t.label} (${t.min}%+)</button>`
  ).join('');

  let resultHtml = '';
  if (unknownW === 0) {
    const overall = overallDegreeMark();
    if (overall !== null) {
      const achieved = overall >= sel;
      resultHtml = achieved
        ? `<div class="ov-target-result ov-target-ok">🎉 Target already achieved! Your current projected mark is <strong>${overall.toFixed(1)}%</strong>.</div>`
        : `<div class="ov-target-result ov-target-warn">⚠ Target not achievable with current marks. Projected: <strong>${overall.toFixed(1)}%</strong>.</div>`;
    } else {
      resultHtml = `<div class="ov-target-result">Enter marks in individual year modules to see your projection.</div>`;
    }
  } else {
    const needed = (sel * totalW - knownSum) / unknownW;
    if (needed <= 0) {
      resultHtml = `<div class="ov-target-result ov-target-ok">🎉 You've already secured enough marks for a <strong>${TARGETS.find(t=>t.min===sel)?.label||sel+'%'}</strong>!</div>`;
    } else if (needed > 100) {
      resultHtml = `<div class="ov-target-result ov-target-warn">⚠ A <strong>${TARGETS.find(t=>t.min===sel)?.label||sel+'%'}</strong> is not achievable with your current marks in graded years.</div>`;
    } else {
      // Show per-year breakdown for ungraded years
      let breakdown = '';
      APP.years.forEach(yr => {
        const w = yr.weighting || 0;
        if (!w) return;
        const ym = yearMark(yr);
        if (ym !== null) return; // already graded
        breakdown += `<div class="ov-target-yr-row"><span class="ov-target-yr-lbl">${yr.label} (${w}% weight)</span><span class="ov-target-yr-val" style="color:${gradeColor(needed)}">${needed.toFixed(1)}% average needed</span></div>`;
      });
      resultHtml = `<div class="ov-target-result">To achieve a <strong>${TARGETS.find(t=>t.min===sel)?.label||''} (${sel}%+)</strong>, you need in your remaining years:
        <div class="ov-target-breakdown">${breakdown}</div>
      </div>`;
    }
  }

  return `<div class="ov-target-planner">
    <div class="ov-section-title" style="display:flex;align-items:center;gap:8px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/></svg> Target Grade Planner</div>
    <div style="font-family:var(--fm);font-size:11px;color:var(--tx3);margin-bottom:14px">Select your target degree classification to see what you need in ungraded years.</div>
    <div class="ov-target-btns">${targetBtns}</div>
    ${resultHtml}
  </div>`;
}

function setOverviewTarget(val) {
  APP.overviewTargetGrade = val;
  persist();
  const pane = document.getElementById('pane-overview');
  if (pane) pane.innerHTML = buildOverview();
}

/**
 * ovStartWeightEdit(yid)
 * Replaces the weight badge on an overview card with an inline
 * number input + confirm button, without navigating to the year.
 */
function ovStartWeightEdit(yid) {
  const el = document.getElementById('ov-wt-' + yid);
  if (!el || el.querySelector('input')) return; // already in edit mode
  const yr = getYear(yid);
  const current = yr ? (yr.weighting || 0) : 0;
  // Swap label for an inline editor
  el.innerHTML = `
    <span style="font-size:10px;color:var(--tx3);margin-right:4px">Weight&nbsp;%</span>
    <input
      id="ov-wt-inp-${yid}"
      type="number" min="0" max="100" step="1"
      value="${current}"
      style="width:52px;padding:2px 5px;font-family:var(--fm);font-size:11px;font-weight:600;
             border:1.5px solid var(--accent-border);border-radius:5px;background:var(--s1);
             color:var(--tx);text-align:center"
      onkeydown="if(event.key==='Enter'){event.preventDefault();ovSaveWeightEdit('${yid}')}
                 if(event.key==='Escape'){renderOverviewPane()}"
      onclick="event.stopPropagation()"
    />
    <button
      style="margin-left:4px;padding:2px 8px;font-family:var(--fm);font-size:10px;font-weight:600;
             border-radius:5px;border:1.5px solid var(--accent-border);background:var(--accent-bg);
             color:var(--accent-mid);cursor:pointer"
      onclick="event.stopPropagation();ovSaveWeightEdit('${yid}')">Save</button>
    <button
      style="margin-left:3px;padding:2px 7px;font-family:var(--fm);font-size:10px;
             border-radius:5px;border:1.5px solid var(--b1);background:var(--s2);
             color:var(--tx3);cursor:pointer"
      onclick="event.stopPropagation();renderOverviewPane()">✕</button>
  `;
  // Focus and select so the user can type immediately
  const inp = document.getElementById('ov-wt-inp-' + yid);
  if (inp) { inp.focus(); inp.select(); }
}

function ovSaveWeightEdit(yid) {
  const inp = document.getElementById('ov-wt-inp-' + yid);
  if (!inp) return;
  const val = Math.min(100, Math.max(0, parseFloat(inp.value) || 0));
  const yr = getYear(yid);
  if (yr) yr.weighting = val;
  persist();
  // Re-render the whole overview so the overall card and target planner update too
  renderOverviewPane();
  showToast(val ? `${yr.label} set to ${val}% weight.` : `${yr.label} weight cleared.`);
}


function hasEnteredMark(v) {
  return v !== '' && v !== undefined && v !== null && !isNaN(parseFloat(v));
}

function getUpcomingDeadlines(yr, n = 5) {
  const today = new Date();
  today.setHours(0,0,0,0);
  const items = [];
  (yr.modules || []).forEach(mod => {
    (mod.components || []).forEach(comp => {
      const d = resolveCompDate(comp);
      if (!d || d < today) return;
      const mark = yr.marks[comp.id];
      items.push({
        modName: mod.name,
        modCode: mod.code,
        compName: comp.name,
        date: d,
        dateRaw: comp.date,
        category: comp.category || 'Coursework',
        mark: hasEnteredMark(mark) ? parseFloat(mark) : null,
      });
    });
  });
  return items.sort((a,b) => a.date - b.date).slice(0, n);
}

function buildDegreeBoundaryCard() {
  const thresholds = getGradeThresholds();
  const overall = overallDegreeMark();

  // If we have a proper weighted degree mark (2+ graded years with weightings), show it
  if (overall !== null) {
    const col = gradeColor(overall);
    const cls = gradeClass(overall);
    const higher = thresholds
      .filter(t => t.min > overall)
      .sort((a,b) => a.min - b.min)[0];

    let gapText = '';
    if (!thresholds.length) {
      gapText = 'Classification labels are turned off, so this shows your percentage only.';
    } else if (higher) {
      gapText = `${(higher.min - overall).toFixed(1)} marks from a ${higher.label}.`;
    } else {
      gapText = `You are in ${cls} class territory — keep it up!`;
    }

    return `<div class="dashboard-card degree-boundary-card">
      <div>
        <div class="dashboard-card-title">🎓 Projected Degree Classification</div>
        <div class="degree-boundary-mark" style="color:${col}">${overall.toFixed(1)}%</div>
        <div class="degree-boundary-class" style="color:${col}">${thresholds.length ? cls : 'Percentage only'}</div>
      </div>
      <div class="degree-boundary-gap">${gapText}</div>
    </div>`;
  }

  // Fall back: show current year average if any year has marks
  const anyYearMark = APP.years.map(y => yearMark(y)).find(m => m !== null);
  if (anyYearMark !== null && anyYearMark !== undefined) {
    const col = gradeColor(anyYearMark);
    const cls = gradeClass(anyYearMark);
    const higher = thresholds
      .filter(t => t.min > anyYearMark)
      .sort((a,b) => a.min - b.min)[0];
    const gapText = !thresholds.length
      ? 'Classification labels are turned off.'
      : higher
        ? `${(higher.min - anyYearMark).toFixed(1)} marks from a ${higher.label}.`
        : `You are in ${cls} class territory — keep it up!`;

    return `<div class="dashboard-card degree-boundary-card">
      <div>
        <div class="dashboard-card-title">🎓 Projected Degree Classification</div>
        <div class="degree-boundary-mark" style="color:${col}">${anyYearMark.toFixed(1)}%</div>
        <div class="degree-boundary-class" style="color:${col}">${thresholds.length ? cls : 'Percentage only'}</div>
      </div>
      <div class="degree-boundary-gap">${gapText}<br><span style="font-family:var(--fm);font-size:10px;color:var(--tx4)">Based on this year's marks. Set year weightings via ✎ for a full degree projection.</span></div>
    </div>`;
  }

  // No marks at all yet
  return `<div class="dashboard-card degree-boundary-card">
    <div>
      <div class="dashboard-card-title">🎓 Projected Degree Classification</div>
      <div class="degree-boundary-muted">Add more grades to see your overall average.</div>
    </div>
  </div>`;
}

function buildUpcomingDeadlinesCard(yr) {
  const items = getUpcomingDeadlines(yr, 5);
  let rows = '';
  if (!items.length) {
    rows = '<div style="font-family:var(--fm);font-size:11px;color:var(--tx4);font-style:italic">No upcoming deadlines — you are all caught up!</div>';
  } else {
    rows = `<div class="deadline-list">${items.map(item => {
      const status = item.mark !== null
        ? '<span class="badge badge-ok">✓ Graded</span>'
        : `<span class="deadline-date">${fmtDate(item.dateRaw)}</span>`;
      return `<div class="deadline-row ${item.mark !== null ? 'graded' : ''}">
        <div class="deadline-main">
          ${catBadgeHtml(item.category)}
          <div style="min-width:0">
            <div class="deadline-title">${escapeHTML(item.compName)}</div>
            <div class="deadline-module">${escapeHTML(item.modCode)} · ${escapeHTML(item.modName)}</div>
          </div>
        </div>
        ${status}
      </div>`;
    }).join('')}</div>`;
  }

  return `<div class="dashboard-card">
    <div class="dashboard-card-title">📅 Upcoming deadlines</div>
    ${rows}
  </div>`;
}

function buildDashboardTargetsCard(yr) {
  const thresholds = getTargetThresholds();
  if (!thresholds.length) return '';
  const visible = APP.settings.showGradeTargets !== false;
  let selected = APP.settings.dashboardTargetGrade || thresholds[0].min;
  if (!thresholds.some(t => Number(t.min) === Number(selected))) selected = thresholds[0].min;
  const target = getThresholdByMin(selected) || thresholds[0];

  const buttons = thresholds.map(t => `
    <button class="target-choice-btn ${Number(selected)===Number(t.min)?'active':''}"
            onclick="setDashboardTarget(${t.min})">
      ${t.label} (${t.min}%+)
    </button>`).join('');

  let rows = '';
  if (visible) {
    const modules = (yr.modules || []).filter(mod => {
      const entered = modEnteredWeight(mod, yr.marks);
      return entered > 0 && entered < 100;
    });

    if (!modules.length) {
      rows = '<div style="font-family:var(--fm);font-size:11px;color:var(--tx4);font-style:italic">Enter at least one mark in an unfinished module to see what you need next.</div>';
    } else {
      rows = modules.map(mod => {
        const enteredWeight = modEnteredWeight(mod, yr.marks);
        const partialMark = modPartial(mod, yr.marks) || 0;
        const remainingWeight = 100 - enteredWeight;
        const neededMark = (target.min - partialMark) / (1 - (enteredWeight / 100));
        let copy = '';
        if (neededMark <= 0) {
          copy = `You have already reached <strong>${target.label}</strong> territory for this module.`;
        } else if (neededMark > 100) {
          copy = `You would need <strong>${neededMark.toFixed(1)}%</strong> on the remaining <strong>${remainingWeight}%</strong>, so this target is unlikely from current marks.`;
        } else {
          copy = `You need <strong>${neededMark.toFixed(1)}%</strong> on the remaining <strong>${remainingWeight}%</strong> of this module to achieve a <strong>${target.label}</strong>.`;
        }
        return `<div class="grade-target-row">
          <div>
            <div style="font-family:var(--fd);font-size:13px;font-weight:800;color:var(--tx);margin-bottom:2px">${mod.code} · ${mod.name}</div>
            <div class="grade-target-copy">${copy}</div>
          </div>
          <div class="grade-target-meta">${enteredWeight}% graded</div>
        </div>`;
      }).join('');
    }
  }

  return `<div class="dashboard-card dashboard-targets-card">
    <div class="toggle-row">
      <div>
        <div class="dashboard-card-title" style="margin-bottom:2px;display:flex;align-items:center;gap:6px"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/></svg> What do I need?</div>
        <div class="toggle-sub">See the average needed on remaining assessments.</div>
      </div>
      <label class="toggle-switch">
        <input type="checkbox" ${visible ? 'checked' : ''} onchange="toggleDashboardTargets(this.checked)" />
        <span class="toggle-track"></span>
      </label>
    </div>
    ${visible ? `<div class="target-btn-row">${buttons}</div>${rows}` : ''}
  </div>`;
}

function toggleDashboardTargets(show) {
  APP.settings.showGradeTargets = !!show;
  persist();
  const yr = activeYear();
  const dsp = yr ? document.getElementById(`sp-${yr.id}-dashboard`) : null;
  if (dsp) dsp.innerHTML = buildDashboard(yr);
}

function setDashboardTarget(min) {
  APP.settings.dashboardTargetGrade = Number(min);
  persist();
  const yr = activeYear();
  const dsp = yr ? document.getElementById(`sp-${yr.id}-dashboard`) : null;
  if (dsp) dsp.innerHTML = buildDashboard(yr);
}


function buildDashboard(yr) {
  const noModules = !yr.modules || yr.modules.length === 0;

  const hint = `<div class="menu-hint">
    <span class="menu-hint-icon">☰</span>
    <span>Use the <strong>menu button</strong> or <strong>sidebar</strong> to navigate your views.</span>
  </div>`;

  if (noModules) {
    return hint + `
      <div class="empty-state-card">
        <div class="empty-state-icon">🎓</div>
        <div class="empty-state-title">No modules yet</div>
        <div class="empty-state-sub">Add your first module to start tracking your grades.</div>
        <button class="btn btn-primary" onclick="switchSubtab('${yr.id}','modules');openModEdit('${yr.id}',null)">
          + Add a module
        </button>
      </div>`;
  }

  const ym = yearMark(yr);
  let gradeHtml;
  if (ym!==null) {
    gradeHtml=`<div class="yr-grade-num">${ym.toFixed(1)}%</div><div class="yr-grade-cls">${gradeClass(ym)}</div>`;
  } else {
    gradeHtml=`<div class="yr-grade-num" style="color:var(--tx4)">—</div><div class="yr-grade-cls" style="color:var(--tx4)">No marks yet</div>`;
  }

  let pills='';
  yr.modules.forEach(m => {
    const t=modTotal(m,yr.marks), p=modPartial(m,yr.marks), ew=modEnteredWeight(m,yr.marks);
    let label;
    if (t!==null)      label=`<span class="ps">${t.toFixed(1)}%</span>`;
    else if (p!==null) label=`<span style="color:var(--tx2)">${p.toFixed(1)}/${ew}pt</span>`;
    else               label=`<span style="color:var(--tx4)">—</span>`;
    pills+=`<div class="yr-pill">${m.code} ${label}</div>`;
  });

  const completedCredits=yr.modules.reduce((s,m)=>s+(modTotal(m,yr.marks)!==null?m.cats:0),0);
  return hint
    + buildDegreeBoundaryCard()
    + buildUpcomingDeadlinesCard(yr)
    + `
    <div class="year-overview" data-label="${yr.label.toUpperCase()}">
      <div style="margin-bottom:4px;font-family:var(--fm);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--tx3)">Current Year Average</div>
      <div style="display:flex;align-items:baseline;gap:14px;margin-bottom:8px">${gradeHtml}</div>
      <p style="font-size:12px;color:var(--tx3);font-family:var(--fm)">${ym!==null?`Credits-weighted · ${completedCredits} of ${totalCats(yr)} credits complete`:''}</p>
      <div class="yr-pills">${pills}</div>
    </div>`
    + buildDashboardTargetsCard(yr);
}

function switchSubtabAndOpenModEdit(yid) {
  switchSubtab(yid, 'modules');
  openModEdit(yid, null);
}

function buildTimetable(yr) {
  const today=new Date(); today.setHours(0,0,0,0);
  const allItems=[];

  if (!yr.modules || !yr.modules.length) {
    return `<div class="tt-empty">No modules yet. Add modules and components to see your timetable here.</div>`;
  }

  yr.modules.forEach(mod => {
    mod.components.forEach(c => {
      const d=resolveCompDate(c);
      const hasMark=yr.marks[c.id]!==''&&yr.marks[c.id]!==undefined&&yr.marks[c.id]!==null&&!isNaN(parseFloat(yr.marks[c.id]));
      const daysUntil=d?Math.ceil((d-today)/86400000):null;
      allItems.push({mod,comp:c,date:d,mark:hasMark?parseFloat(yr.marks[c.id]):null,hasMark,daysUntil,isPast:d?d<today:false});
    });
  });

  const doneAll=allItems.filter(i=>i.hasMark).length;
  const upcoming=allItems.filter(i=>i.date&&i.daysUntil>=0&&!i.hasMark).length;
  const statsHtml=`<div class="tt-stats">
    <div class="tt-stat"><div class="tt-stat-lbl">Total Items</div><div class="tt-stat-val">${allItems.length}</div></div>
    <div class="tt-stat"><div class="tt-stat-lbl">Done</div><div class="tt-stat-val" style="color:var(--gn)">${doneAll}</div></div>
    <div class="tt-stat"><div class="tt-stat-lbl">Upcoming</div><div class="tt-stat-val" style="color:var(--accent-mid)">${upcoming}</div></div>
  </div>`;

  const noteHtml=`<div class="tt-note">ℹ <span>Click <strong>✎ Edit</strong> on any item to update date, time, venue, or results.</span></div>`;

  const fCat = _ttFilterCat[yr.id] || 'all';
  const fTime = _ttFilterTime[yr.id] || 'all';

  let items = allItems;
  if(fCat !== 'all') items = items.filter(i => i.comp.category === fCat);
  if(fTime === 'upcoming') items = items.filter(i => i.date && i.daysUntil >= 0 && !i.hasMark);
  else if(fTime === 'done') items = items.filter(i => i.hasMark);
  else if(fTime === 'undated') items = items.filter(i => !i.date);

  const filtersHtml = `
    <div class="tt-filters-group">
      <div class="tt-filters">
        <span class="tt-filters-lbl">Category</span>
        <button class="tt-flt ${fCat==='all'?'active':''}" onclick="setTTFilter('${yr.id}','cat','all')">All</button>
        <button class="tt-flt ${fCat==='Exam'?'active':''}" onclick="setTTFilter('${yr.id}','cat','Exam')">Exams</button>
        <button class="tt-flt ${fCat==='Coursework'?'active':''}" onclick="setTTFilter('${yr.id}','cat','Coursework')">Coursework</button>
        <button class="tt-flt ${fCat==='Essays'?'active':''}" onclick="setTTFilter('${yr.id}','cat','Essays')">Essays</button>
        <button class="tt-flt ${fCat==='Class Test'?'active':''}" onclick="setTTFilter('${yr.id}','cat','Class Test')">Tests</button>
        <button class="tt-flt ${fCat==='Other'?'active':''}" onclick="setTTFilter('${yr.id}','cat','Other')">Other</button>
      </div>
      <div class="tt-filters">
        <span class="tt-filters-lbl">Status</span>
        <button class="tt-flt ${fTime==='all'?'active':''}" onclick="setTTFilter('${yr.id}','time','all')">All</button>
        <button class="tt-flt ${fTime==='upcoming'?'active':''}" onclick="setTTFilter('${yr.id}','time','upcoming')">Upcoming</button>
        <button class="tt-flt ${fTime==='done'?'active':''}" onclick="setTTFilter('${yr.id}','time','done')">Done</button>
        <button class="tt-flt ${fTime==='undated'?'active':''}" onclick="setTTFilter('${yr.id}','time','undated')">No date</button>
      </div>
    </div>`;

  return `${statsHtml}${noteHtml}${filtersHtml}<div id="tt-list-wrap-${yr.id}">${buildTTList(items,yr)}</div>`;
}

function buildTTList(items, yr) {
  items.sort((a,b)=>{if(a.date&&b.date)return a.date-b.date;if(a.date)return-1;if(b.date)return 1;return 0;});
  if(!items.length) return '<div class="tt-empty">No assessments match this filter.</div>';
  const groups={};
  items.forEach(item=>{const key=item.date?item.date.toLocaleDateString('en-GB',{month:'long',year:'numeric'}):'No date set';if(!groups[key])groups[key]=[];groups[key].push(item);});
  let h='';
  for(const [month,gItems] of Object.entries(groups)){
    h+=`<div class="tt-grp"><div class="tt-grp-hdr"><span class="tt-month">${month}</span><span class="tt-line"></span><span class="tt-cnt">${gItems.length} item${gItems.length!==1?'s':''}</span></div>`;
    gItems.forEach(item=>{
      const sc=item.hasMark?'done':item.daysUntil!==null&&item.daysUntil<=7?'urgent':item.daysUntil!==null&&item.daysUntil<=14?'soon':'';
      const dateBlockHtml=item.date
        ?`<div class="tt-date"><div class="tt-day">${item.date.getDate()}</div><div class="tt-mon">${item.date.toLocaleDateString('en-GB',{month:'short'}).toUpperCase()}</div></div>`
        :`<div class="tt-date tt-tbd"><div class="tt-day">TBD</div><div class="tt-mon">—</div></div>`;
      let cdHtml=item.hasMark?`<span class="tt-cd">Marked ✓</span>`:'';
      if(!item.hasMark&&item.daysUntil!==null){const cls=item.daysUntil<=7?'urgent':item.daysUntil<=14?'soon':'';cdHtml=`<span class="tt-cd ${cls}">${item.daysUntil===0?'Today!':item.daysUntil<0?Math.abs(item.daysUntil)+'d ago':item.daysUntil+'d'}</span>`;}
      const markPill=item.hasMark?`<span class="tt-mark" style="color:${gradeColor(item.mark)};border-color:${gradeColor(item.mark)}44">${item.mark.toFixed(1)}% · ${gradeClass(item.mark)}</span>`:`<span class="tt-mark">—</span>`;
      let timeBadge='', locBadge='', rdBadge='', seatBadge='', obBadge='';
      if(item.comp.time) timeBadge=`<span class="tt-timebadge">⏰ ${item.comp.time}${item.comp.duration?' · '+item.comp.duration:''}</span>`;
      if(item.comp.location) locBadge=`<span class="tt-locbadge">📍 ${item.comp.location}</span>`;
      if(item.comp.readingTime) rdBadge=`<span class="tt-timebadge">📖 ${item.comp.readingTime} reading</span>`;
      if(item.comp.seat)        seatBadge=`<span class="tt-locbadge">💺 Seat ${escapeHTML(item.comp.seat)}</span>`;
      if(item.comp.openBook==='yes') obBadge=`<span class="tt-timebadge" style="color:var(--gn)">✅ Open book</span>`;
      else if(item.comp.openBook==='no') obBadge=`<span class="tt-timebadge" style="color:var(--red2)">🚫 Closed book</span>`;
      h+=`<div class="tt-item ${sc} clickable" onclick="openExamView('${yr.id}','${item.comp.id}')">
        ${dateBlockHtml}
        <div>
          <div class="tt-title">${escapeHTML(item.mod.name)} — ${escapeHTML(item.comp.name)}</div>
          <div class="tt-meta">
            <span class="tt-mod">${escapeHTML(item.mod.code)}</span>${catBadgeHtml(item.comp.category)}
            <span class="tt-wt">${item.comp.weight}% wt</span>${timeBadge}${rdBadge}${locBadge}${seatBadge}${obBadge}
          </div>
        </div>
        <div class="tt-right">
          ${markPill}${cdHtml}
          <button class="icon-btn btn-sm" aria-label="Edit ${escapeHTML(item.comp.name)}" title="Edit component" onclick="event.stopPropagation();openCompEdit('${yr.id}','${item.mod.id}','${item.comp.id}')">✎</button>
        </div>
      </div>`;
    });
    h+='</div>';
  }
  return h;
}

function setTTFilter(yid, type, val) {
  if (type === 'cat') _ttFilterCat[yid] = val;
  if (type === 'time') _ttFilterTime[yid] = val;
  const pane = document.getElementById(`sp-${yid}-timetable`);
  if(pane) pane.innerHTML = buildTimetable(getYear(yid));
}

function openExamView(yid, compId) {
  const yr=getYear(yid);
  let mod=null, comp=null;
  for(const m of yr.modules){const c=m.components.find(x=>x.id===compId);if(c){mod=m;comp=c;break;}}
  if(!comp) return;
  const today=new Date(); today.setHours(0,0,0,0);
  const mark=yr.marks[compId];
  const hasMark=mark!==''&&mark!==undefined&&mark!==null&&!isNaN(parseFloat(mark));
  const d=resolveCompDate(comp);
  document.getElementById('ev-modbadge').textContent=mod.code;
  document.getElementById('ev-catbadge').innerHTML=catBadgeHtml(comp.category);
  document.getElementById('ev-title').textContent=mod.name+' — '+comp.name;
  const cdVal=document.getElementById('ev-cd-val'), cdLbl=document.getElementById('ev-cd-lbl');
  if(hasMark){cdVal.textContent='Completed ✓';cdVal.className='modal-cd-val done';cdLbl.textContent='Status';}
  else if(d){const du=Math.ceil((d-today)/86400000),txt=du<0?Math.abs(du)+'d ago':du===0?'Today!':du+'d',cls=du<0?'done':du===0||du<=7?'urgent':du<=14?'soon':'';cdVal.textContent=txt;cdVal.className='modal-cd-val '+cls;cdLbl.textContent='Time until';}
  else{cdVal.textContent='Date TBD';cdVal.className='modal-cd-val';cdLbl.textContent='Schedule';}
  let grid='';
  if(comp.date)     grid+=`<div class="modal-det"><div class="modal-det-lbl">📅 Date</div><div class="modal-det-val hl">${fmtDate(comp.date)}</div></div>`;
  if(comp.time)     grid+=`<div class="modal-det"><div class="modal-det-lbl">⏰ Time</div><div class="modal-det-val hl">${comp.time}</div></div>`;
  if(comp.duration) grid+=`<div class="modal-det"><div class="modal-det-lbl">⏱ Duration</div><div class="modal-det-val">${comp.duration}</div></div>`;
  if(comp.readingTime) grid+=`<div class="modal-det"><div class="modal-det-lbl">📖 Reading time</div><div class="modal-det-val">${comp.readingTime}</div></div>`;
  if(comp.location) grid+=`<div class="modal-det${!comp.duration&&!comp.readingTime?' full':''}"><div class="modal-det-lbl">📍 Venue</div><div class="modal-det-val" style="font-size:13px">${comp.location}</div></div>`;
  if(comp.seat)     grid+=`<div class="modal-det"><div class="modal-det-lbl">💺 Seat</div><div class="modal-det-val hl">${escapeHTML(comp.seat)}</div></div>`;
  if(comp.openBook) grid+=`<div class="modal-det"><div class="modal-det-lbl">📚 Open book</div><div class="modal-det-val">${comp.openBook==='yes'?'✅ Yes':'🚫 No'}</div></div>`;
  grid+=`<div class="modal-det"><div class="modal-det-lbl">⚖️ Weight</div><div class="modal-det-val">${comp.weight}% of module</div></div>`;
  grid+=`<div class="modal-det"><div class="modal-det-lbl">📚 Credits</div><div class="modal-det-val">${mod.cats} credits</div></div>`;
  grid+=`<div class="modal-det full" style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap"><div><div class="modal-det-lbl">Edit component</div><div style="font-size:12px;color:var(--tx3)">Date, time, venue, name, weight, category</div></div><button class="btn btn-ghost btn-sm" onclick="closeOverlayDirect('examViewOverlay');openCompEdit('${yid}','${mod.id}','${compId}')">✎ Edit</button></div>`;
  document.getElementById('ev-grid').innerHTML=grid;
  let markHtml='';
  if(hasMark){const mv=parseFloat(mark),col=gradeColor(mv);markHtml=`<div style="display:flex;align-items:center;gap:12px"><div class="modal-mark-big" style="color:${col}">${mv.toFixed(1)}%</div><div><div style="font-family:var(--fd);font-size:15px;font-weight:700;color:${col}">${gradeClass(mv)}</div><div style="font-family:var(--fm);font-size:10px;color:var(--tx3);margin-top:2px">${comp.weight}% weighted</div></div></div>`;}
  else{markHtml='<div style="font-family:var(--fm);font-size:12px;color:var(--tx4);font-style:italic">No mark entered yet. Add it in the Modules tab.</div>';}
  document.getElementById('ev-mark').innerHTML=markHtml;
  openOverlay('examViewOverlay');
}

function buildModules(yr) {
  let html=`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
    <div class="sec-title" style="margin:0;padding:0;border:none;font-family:var(--fd);font-size:20px;font-weight:800;color:var(--tx)">Modules</div>
    <button class="btn btn-primary btn-sm" onclick="openModEdit('${yr.id}',null)">+ Add module</button>
  </div>`;

  if (!yr.modules || !yr.modules.length) {
    html+=`<div class="empty-state" onclick="openModEdit('${yr.id}',null)">
      <div class="empty-state-icon">📚</div>
      <div class="empty-state-title">No modules yet</div>
      <div class="empty-state-sub">Click to add your first module.</div>
      <button class="empty-state-btn" onclick="event.stopPropagation();openModEdit('${yr.id}',null)">+ Add module</button>
    </div>`;
    return html;
  }

  yr.modules.forEach(mod=>{
    const total=modTotal(mod,yr.marks), partial=modPartial(mod,yr.marks), ew=modEnteredWeight(mod,yr.marks);
    let pillTxt='—', pillStyle='';
    if(total!==null){pillTxt=total.toFixed(1)+'%';pillStyle=`color:${gradeColor(total)};background:${gradeColor(total)}18;border-color:${gradeColor(total)}44`;}
    else if(partial!==null){pillTxt=`${partial.toFixed(1)} / ${ew} pts`;pillStyle='color:var(--tx2);';}

    // Module URL quick-link (from course import/catalogue data)
    const modUrl = mod.url || (ALL_MODULES_DICT[mod.code] ? ALL_MODULES_DICT[mod.code].url : '');
    const safeModUrl = String(modUrl || '').replace(/"/g, '&quot;');
    const urlLink = safeModUrl
      ? `<a href="${safeModUrl}" target="_blank" rel="noopener" class="mod-url-link" title="Open official module page" onclick="event.stopPropagation()">📎 Module page</a>`
      : '';
    const progress = Math.min(100, Math.max(0, Math.round(ew * 10) / 10));

    let compRows='';
    mod.components.forEach(c=>{
      const mv=yr.marks[c.id]!==undefined?yr.marks[c.id]:'';
      const hasMark=mv!==''&&!isNaN(parseFloat(mv));
      const dateDisplay=c.date?fmtDate(c.date):'—';
      let statusHtml='';
      if(hasMark) statusHtml=`<span class="badge badge-ok">✓ Marked</span>`;
      else if(c.date) statusHtml=`<span class="badge badge-no" style="color:var(--tx3);border-color:var(--b2)">${dateDisplay}</span>`;
      else statusHtml=`<span class="badge badge-no">No date</span>`;
      const rowBg=hasMark?'background:rgba(5,150,105,.04)':'';
      compRows+=`<tr style="${rowBg}">
        <td style="color:var(--tx);font-weight:600">${escapeHTML(c.name)}</td>
        <td>${catBadgeHtml(c.category)}</td>
        <td style="font-family:var(--fm);font-size:12px;color:var(--accent-light)">${c.weight}%</td>
        <td><div style="display:flex;align-items:center;gap:5px">
          <input id="inp-${c.id}" class="inp inp-num" type="number" min="0" max="100" placeholder="—" value="${mv}" onkeydown="return !['e','E','+','-'].includes(event.key)" onchange="onMark('${yr.id}','${c.id}',this)" />
          <span style="font-family:var(--fm);font-size:11px;color:var(--tx4)">/100</span>
        </div></td>
        <td style="font-family:var(--fm);font-size:11px;color:var(--tx3)">${c.date||'<span style="color:var(--tx4)">—</span>'}</td>
        <td>${statusHtml}</td>
        <td><button class="icon-btn" aria-label="Edit ${escapeHTML(c.name)}" title="Edit component (date, time, venue, mark, name, weight)" onclick="openCompEdit('${yr.id}','${mod.id}','${c.id}')">✎</button></td>
      </tr>`;
    });

    let weightedHtml='';
    if(total!==null){weightedHtml=`<div class="mod-weighted"><span class="mod-wlbl">Module Average</span><span class="mod-wscore" style="color:${gradeColor(total)}">${total.toFixed(1)}% · ${gradeClass(total)}</span></div>`;}
    else if(partial!==null){const remaining=mod.components.length-mod.components.filter(c=>{const v=yr.marks[c.id];return v!==''&&v!==undefined&&v!==null&&!isNaN(parseFloat(v));}).length;weightedHtml=`<div class="mod-weighted"><span class="mod-wlbl">Points so far <span style="font-size:11px;color:var(--tx4)">(${remaining} remaining)</span></span><span class="mod-wscore" style="color:var(--tx2);font-size:14px">${partial.toFixed(1)} / ${ew} pts</span></div>`;}

    const modResetHtml=``;

    // Assessment split badge (if available in dict)
    const dictEntry = ALL_MODULES_DICT[mod.code];
    const splitBadge = dictEntry && dictEntry.assessmentSplit
      ? `<span style="font-family:var(--fm);font-size:10px;color:var(--tx3);margin-left:6px;background:var(--bg2);padding:2px 6px;border-radius:4px;border:1px solid var(--b2)">${dictEntry.assessmentSplit}</span>`
      : '';

    html+=`<div class="card" id="modcard-${yr.id}-${mod.id}">
      <div class="mod-hdr" onclick="toggleCard('modcard-${yr.id}-${mod.id}')">
        <span class="mod-code">${escapeHTML(mod.code)}</span>
        <span class="mod-title-wrap">
          <span class="mod-name">${escapeHTML(mod.name)}${splitBadge}</span>
          ${urlLink}
        </span>
        <span class="mod-pill" style="${pillStyle}">${pillTxt}</span>
        <span class="mod-cats">${mod.cats} credits</span>
        <button class="icon-btn" aria-label="Edit ${escapeHTML(mod.name)}" onclick="event.stopPropagation();openModEdit('${yr.id}','${mod.id}')" title="Edit module" style="margin-right:4px">✎</button>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="mod-progress-bar-track">
        <div class="mod-progress-bar-fill" style="width:${progress}%"></div>
      </div>
      <div class="mod-progress-label">${progress}% graded</div>
      <div class="mod-body" style="display:none">
        <table class="comp-tbl">
          <thead><tr><th>Component</th><th>Category</th><th>Wt</th><th>Your Mark</th><th>Date</th><th>Status</th><th></th></tr></thead>
          <tbody>${compRows}</tbody>
        </table>
        <button class="btn-add-dashed" onclick="openCompEdit('${yr.id}','${mod.id}',null)">+ Add component</button>
        ${weightedHtml}${modResetHtml}
      </div>
    </div>`;
  });

  html+=buildResetZone(yr);
  return html;
}

function normaliseFutureGrade(val, fallback = 70) {
  let v = parseFloat(val);
  if (isNaN(v)) v = fallback;
  return Math.min(100, Math.max(0, v));
}

function isEnteredMark(val) {
  return val !== '' && val !== undefined && val !== null && !isNaN(parseFloat(val));
}

function getModuleMarkForComponent(yr, comp) {
  if (!yr || !yr.marks || !comp) return null;
  const mark = yr.marks[comp.id];
  return isEnteredMark(mark) ? normaliseFutureGrade(mark) : null;
}

function getFutureComponentGrade(yr, mod, comp) {
  if (!yr.futureComponentGrades) yr.futureComponentGrades = {};
  if (!yr.futureModuleGrades) yr.futureModuleGrades = {};

  const moduleMark = getModuleMarkForComponent(yr, comp);
  if (moduleMark !== null) return moduleMark;

  if (yr.futureComponentGrades[comp.id] !== undefined) {
    return normaliseFutureGrade(yr.futureComponentGrades[comp.id]);
  }
  if (yr.futureModuleGrades[mod.id] !== undefined) {
    return normaliseFutureGrade(yr.futureModuleGrades[mod.id]);
  }
  return 70;
}

function getFutureModuleGrade(yr, mod) {
  if (!mod.components || !mod.components.length) {
    const stored = yr.futureModuleGrades ? yr.futureModuleGrades[mod.id] : undefined;
    return normaliseFutureGrade(stored, 70);
  }
  return mod.components.reduce((sum, comp) => {
    return sum + getFutureComponentGrade(yr, mod, comp) * (comp.weight / 100);
  }, 0);
}

function buildTarget(yr) {
  if (!yr.futureModuleGrades) yr.futureModuleGrades = {};
  if (!yr.futureComponentGrades) yr.futureComponentGrades = {};

  if (!yr.modules || !yr.modules.length) {
    return `<div class="tt-empty">No modules yet. Add modules to start exploring target grades.</div>`;
  }

  const anyModuleMarks = yr.modules.some(m => (m.components || []).some(c => getModuleMarkForComponent(yr, c) !== null));
  const totalW = APP.years.reduce((s,y)=>s+(y.weighting||0),0);
  const targets = getTargetThresholds();
  let sel = APP.overviewTargetGrade !== undefined ? APP.overviewTargetGrade : (targets[0]?.min || 70);
  if (targets.length && !targets.some(t => Number(t.min) === Number(sel))) sel = targets[0].min;

  let yearTargetSection = '';
  if (totalW > 0 && targets.length) {
    let knownSum = 0, unknownW = 0;
    APP.years.forEach(y => {
      const w = y.weighting || 0;
      if (!w) return;
      if (y.id === yr.id) { unknownW += w; return; }
      const ym = yearMark(y);
      if (ym !== null) knownSum += ym * w;
      else unknownW += w;
    });
    const neededAvg = unknownW > 0 ? (sel * totalW - knownSum) / unknownW : null;
    const targetBtns = targets
      .map(t => `<button class="ov-target-btn${Number(sel)===Number(t.min)?' active':''}" style="${Number(sel)===Number(t.min)?`background:${t.color};color:var(--s1);border-color:${t.color}`:`color:${t.color};border-color:${t.color}44`}" onclick="setOverviewTargetAndRefresh('${yr.id}',${t.min})">${t.label}</button>`).join('');

    let needHtml = '';
    if (neededAvg !== null) {
      if (neededAvg <= 0) needHtml = `<div class="ov-target-result ov-target-ok">🎉 You've already secured enough for a <strong>${getThresholdByMin(sel)?.label || sel+'%+'}</strong>!</div>`;
      else if (neededAvg > 100) needHtml = `<div class="ov-target-result ov-target-warn">⚠ <strong>${getThresholdByMin(sel)?.label || ''}</strong> is not achievable with current marks in other years.</div>`;
      else needHtml = `<div class="ov-target-result">For a <strong>${getThresholdByMin(sel)?.label || ''} (${sel}%+)</strong> overall, this year / remaining ungraded years need roughly <strong style="color:${gradeColor(neededAvg)}">${neededAvg.toFixed(1)}%</strong>.</div>`;
    }

    yearTargetSection = `<div class="ov-target-planner" style="margin-bottom:24px">
      <div class="ov-section-title" style="display:flex;align-items:center;gap:8px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/></svg> Degree Target</div>
      <div style="font-family:var(--fm);font-size:11px;color:var(--tx3);margin-bottom:12px">Select a target classification, then adjust the unlocked assessment simulations below.</div>
      <div class="ov-target-btns" style="margin-bottom:12px">${targetBtns}</div>
      ${needHtml}
    </div>`;
  }

  let html = `
    <div style="font-family:var(--fd);font-size:20px;font-weight:800;color:var(--tx);margin-bottom:8px">Target Grades &amp; Planning</div>
    <div style="font-family:var(--fm);font-size:12px;color:var(--tx3);margin-bottom:24px;line-height:1.5">
      Edit the simulated grade for each unmarked assessment. Marks entered in <strong>Modules</strong> are locked here and only change when you update them in Modules.
    </div>
    ${yearTargetSection}
  `;

  yr.modules.forEach(mod=>{
    const projected = getFutureModuleGrade(yr, mod);
    const realTotal = modTotal(mod, yr.marks);
    const ew = modEnteredWeight(mod, yr.marks);
    const lockSummary = realTotal !== null
      ? 'All assessments locked from Modules'
      : ew > 0
        ? `${ew}% locked from Modules · ${100-ew}% simulated`
        : 'All assessments simulated';
    const summaryLabel = realTotal !== null ? 'Module Average' : anyModuleMarks ? 'Projected Module Average' : 'Simulated Module Average';

    html += `
      <div class="card future-mod-card" id="futcard-${yr.id}-${mod.id}" style="padding:20px;cursor:pointer" onclick="toggleCard('futcard-${yr.id}-${mod.id}')">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
          <div>
            <div style="display:inline-block;font-family:var(--fm);font-size:11px;font-weight:600;color:var(--accent-mid);background:var(--accent-bg);padding:3px 8px;border-radius:6px;border:1px solid var(--accent-border);margin-bottom:6px">${mod.code}</div>
            <div style="font-family:var(--fd);font-size:15px;font-weight:700">${mod.name}</div>
            <div style="font-family:var(--fm);font-size:11px;color:var(--tx4);margin-top:2px">${mod.cats} credits · ${(mod.components || []).length} component${(mod.components || []).length!==1?'s':''} · ${lockSummary}</div>
          </div>
          <div class="fut-module-summary">
            <span class="fut-module-summary-label">${summaryLabel}</span>
            <span class="fut-module-summary-value" style="color:${gradeColor(projected)}">${projected.toFixed(1)}%</span>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
        </div>
        <div class="mod-body" style="display:none;margin-top:16px;padding-top:16px;border-top:1.5px solid var(--b1)">
          ${buildFutureModImpact(yr, mod)}
        </div>
      </div>`;
  });

  return html;
}

function buildFutureModImpact(yr, mod) {
  if (!yr.futureModuleGrades) yr.futureModuleGrades = {};
  if (!yr.futureComponentGrades) yr.futureComponentGrades = {};

  const simGrade = getFutureModuleGrade(yr, mod);
  let yearNumerator = simGrade * mod.cats;
  let yearDenominator = mod.cats;

  yr.modules.forEach(m => {
    if (m.id === mod.id) return;
    const realMark = modTotal(m, yr.marks);
    const useMark = realMark !== null ? realMark : getFutureModuleGrade(yr, m);
    if (useMark !== null) { yearNumerator += useMark * m.cats; yearDenominator += m.cats; }
  });
  const projYearMark = yearDenominator > 0 ? yearNumerator / yearDenominator : null;

  const totalW = APP.years.reduce((s,y)=>s+(y.weighting||0),0);
  let degHtml = '';
  if (totalW > 0 && projYearMark !== null) {
    let degNumerator = 0, degDenominator = 0;
    APP.years.forEach(y => {
      const w = y.weighting || 0;
      if (!w) return;
      if (y.id === yr.id) { degNumerator += projYearMark * w; degDenominator += w; return; }
      const ym = yearMark(y);
      if (ym !== null) { degNumerator += ym * w; degDenominator += w; }
    });
    const projDeg = degDenominator > 0 ? degNumerator / degDenominator : null;
    if (projDeg !== null) {
      degHtml = `<div class="fut-impact-row">
        <span class="fut-impact-lbl">Projected degree mark</span>
        <span class="fut-impact-val" style="color:${gradeColor(projDeg)}">${projDeg.toFixed(1)}% · ${gradeClass(projDeg)}</span>
      </div>`;
    }
  }

  const components = mod.components || [];
  const unlockedComponents = components.filter(c => getModuleMarkForComponent(yr, c) === null);
  const applyAllHtml = components.length
    ? `<div class="fut-impact-row">
      <span class="fut-impact-lbl">Set all unlocked assessments in this module</span>
      <span class="fut-impact-val fut-apply-all" onclick="event.stopPropagation()">
        ${unlockedComponents.length
          ? `<input type="number" class="inp inp-num" style="width:76px;font-size:15px;font-weight:700;color:${gradeColor(simGrade)}" value="${normaliseFutureGrade(yr.futureModuleGrades[mod.id], 70).toFixed(1)}" min="0" max="100" step="0.1" onkeydown="return !['e','E','+','-'].includes(event.key)" onchange="updateFutureGrade('${yr.id}','${mod.id}',this.value)" />`
          : `<span class="fut-locked-note">Locked from Modules</span>`}
      </span>
    </div>`
    : `<div class="fut-impact-row">
      <span class="fut-impact-lbl">Set module simulation</span>
      <span class="fut-impact-val fut-apply-all" onclick="event.stopPropagation()">
        <input type="number" class="inp inp-num" style="width:76px;font-size:15px;font-weight:700;color:${gradeColor(simGrade)}" value="${simGrade.toFixed(1)}" min="0" max="100" step="0.1" onkeydown="return !['e','E','+','-'].includes(event.key)" onchange="updateFutureGrade('${yr.id}','${mod.id}',this.value)" />
      </span>
    </div>`;

  const compRows = components.map(c => {
    const lockedMark = getModuleMarkForComponent(yr, c);
    const isLocked = lockedMark !== null;
    const compGrade = getFutureComponentGrade(yr, mod, c);
    const contribution = (compGrade * c.weight / 100);
    const controlHtml = isLocked
      ? `<label class="fut-comp-input-wrap fut-comp-locked" onclick="event.stopPropagation()">
          <span class="fut-comp-input-label">From Modules</span>
          <span class="fut-comp-actual" style="color:${gradeColor(compGrade)}">${compGrade.toFixed(1)}%</span>
        </label>`
      : `<label class="fut-comp-input-wrap" onclick="event.stopPropagation()">
          <span class="fut-comp-input-label">Sim mark</span>
          <input class="inp inp-num fut-comp-input" type="number" min="0" max="100" step="0.1" value="${compGrade.toFixed(1)}" style="color:${gradeColor(compGrade)}" onkeydown="return !['e','E','+','-'].includes(event.key)" onchange="updateFutureComponentGrade('${yr.id}','${mod.id}','${c.id}',this.value)" />
        </label>`;

    return `<div class="fut-comp-row ${isLocked ? 'locked' : ''}">
      <div class="fut-comp-main">
        <span class="fut-comp-name">${c.name}</span>
        <span class="fut-comp-wt">${c.weight}% weight · ${catBadgeHtml(c.category)}${isLocked ? '<span class="fut-lock-badge">Locked</span>' : ''}</span>
      </div>
      ${controlHtml}
      <span class="fut-comp-contrib">+${contribution.toFixed(1)} pts</span>
    </div>`;
  }).join('') || `<div class="tt-empty">No assessment components yet. Add components in the Modules tab to simulate them individually.</div>`;

  return `<div class="fut-impact-grid">
    ${applyAllHtml}
    ${projYearMark !== null ? `<div class="fut-impact-row">
      <span class="fut-impact-lbl">Projected year average</span>
      <span class="fut-impact-val" style="color:${gradeColor(projYearMark)}">${projYearMark.toFixed(1)}% · ${gradeClass(projYearMark)}</span>
    </div>` : ''}
    ${degHtml}
    <div class="fut-components-header">
      <span>Assessment simulations</span>
      <span>Module total: <strong style="color:${gradeColor(simGrade)}">${simGrade.toFixed(1)}%</strong></span>
    </div>
    ${compRows}
  </div>`;
}

function rerenderTargetPane(yid) {
  const yr = getYear(yid);
  const pane = document.getElementById(`sp-${yid}-target`);
  if (!yr || !pane) return;
  const openCards = [...pane.querySelectorAll('.card.open')].map(c => c.id);
  pane.innerHTML = buildTarget(yr);
  restoreOpenCards(openCards, '.mod-body');
}

function updateFutureGrade(yid, mid, val) {
  const yr = getYear(yid);
  const mod = yr ? yr.modules.find(m => m.id === mid) : null;
  if (!yr || !mod) return;
  if (!yr.futureModuleGrades) yr.futureModuleGrades = {};
  if (!yr.futureComponentGrades) yr.futureComponentGrades = {};
  const v = normaliseFutureGrade(val, 70);

  if (!mod.components || !mod.components.length) {
    yr.futureModuleGrades[mid] = v;
  } else {
    (mod.components || []).forEach(c => {
      if (getModuleMarkForComponent(yr, c) === null) yr.futureComponentGrades[c.id] = v;
    });
    yr.futureModuleGrades[mid] = v;
  }

  persist();
  rerenderTargetPane(yid);
}

function updateFutureComponentGrade(yid, mid, cid, val) {
  const yr = getYear(yid);
  const mod = yr ? yr.modules.find(m => m.id === mid) : null;
  const comp = mod ? (mod.components || []).find(c => c.id === cid) : null;
  if (!yr || !mod || !comp) return;
  if (getModuleMarkForComponent(yr, comp) !== null) {
    rerenderTargetPane(yid);
    return;
  }
  if (!yr.futureModuleGrades) yr.futureModuleGrades = {};
  if (!yr.futureComponentGrades) yr.futureComponentGrades = {};
  yr.futureComponentGrades[cid] = normaliseFutureGrade(val, 70);
  persist();
  // Fix 1: preserve focus across the target-pane re-render so Tab-key works.
  const focusedId = document.activeElement ? document.activeElement.id : null;
  rerenderTargetPane(yid);
  if (focusedId) {
    const refocusEl = document.getElementById(focusedId);
    if (refocusEl) refocusEl.focus();
  }
}

function setOverviewTargetAndRefresh(yid, val) {
  APP.overviewTargetGrade = val;
  persist();
  const pane = document.getElementById(`sp-${yid}-target`);
  if (pane) pane.innerHTML = buildTarget(getYear(yid));
}


function buildResetZone(yr) {
  return `<div class="reset-zone">
    <div class="reset-zone-title">Reset Options — ${yr.label}</div>
    <div class="reset-zone-sub">Use these options to clear grades or remove module data. Actions take effect immediately and cannot be undone.</div>
    <div class="reset-group">
      <div>
        <div class="reset-group-label">Clear Scores</div>
        <div class="reset-group-desc">Remove all entered marks for this year. Module structure is preserved.</div>
      </div>
      <div class="reset-btns"><button class="btn btn-ghost btn-sm" onclick="clearScores('${yr.id}')">Clear Scores</button></div>
    </div>
    <div class="reset-group">
      <div>
        <div class="reset-group-label" style="color:var(--red2)">Clear All Module Data</div>
        <div class="reset-group-desc">Remove all scores <strong>and</strong> all modules from this year permanently.</div>
      </div>
      <div class="reset-btns"><button class="btn btn-danger btn-sm" onclick="clearAll('${yr.id}')">Clear All Module Data</button></div>
    </div>
  </div>
  <p class="save-note" style="margin-top:10px">Auto-saved to your browser on every change.</p>
  ${buildDangerZone()}`;
}

function buildDangerZone() {
  return `<div class="danger-zone">
    <div class="danger-zone-title">⚠ Danger zone</div>
    <div class="danger-zone-desc">These actions are <strong style="color:var(--red)">permanent and cannot be undone</strong>.</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-danger" onclick="hardResetAll()">🗑 Hard reset everything</button>
      <button class="btn btn-ghost btn-sm" onclick="exportData()" style="margin-left:auto">↓ Download backup</button>
      <button class="btn btn-ghost btn-sm" onclick="importData()">↑ Restore backup</button>
    </div>
  </div>`;
}

function onMark(yid, compId, el) {
  const yr=getYear(yid), v=el.value.trim();
  yr.marks[compId]=v===''?'':Math.min(100,Math.max(0,parseFloat(v)));
  persist();
  // Fix 1: snapshot which input had focus (e.g. "inp-_abc123") before the
  // innerHTML wipe destroys the DOM — we'll restore focus after re-rendering
  // so Tab-key mass-entry keeps working uninterrupted.
  const focusedId = document.activeElement ? document.activeElement.id : null;
  const sp=document.getElementById(`sp-${yid}-modules`), dsp=document.getElementById(`sp-${yid}-dashboard`);
  const ttp=document.getElementById(`sp-${yid}-timetable`);
  const tgt=document.getElementById(`sp-${yid}-target`);
  const openCards=sp?[...sp.querySelectorAll('.card.open')].map(c=>c.id):[];
  const targetOpenCards=tgt?[...tgt.querySelectorAll('.card.open')].map(c=>c.id):[];
  if(sp)  sp.innerHTML=buildModules(yr);
  if(dsp) dsp.innerHTML=buildDashboard(yr);
  if(ttp) ttp.innerHTML=buildTimetable(yr);
  if(tgt) tgt.innerHTML=buildTarget(yr);
  restoreOpenCards(openCards,'.mod-body');
  restoreOpenCards(targetOpenCards,'.mod-body');
  renderHeader();
  // Fix 1: re-focus the input that triggered the change (DOM was recreated above).
  if (focusedId) {
    const refocusEl = document.getElementById(focusedId);
    if (refocusEl) refocusEl.focus();
  }
}

function clearScores(yid) { if(!confirm('Clear ALL scores for this year?'))return;const yr=getYear(yid);yr.marks={};persist();renderYearPane(yid);showToast('Scores cleared.'); }
function clearAll(yid)    { if(!confirm('Clear ALL scores and modules for this year? This cannot be undone.'))return;const yr=getYear(yid);yr.marks={};yr.modules=[];yr.checklist={};yr.futureModuleGrades={};yr.futureComponentGrades={};persist();renderYearPane(yid);showToast('All module data cleared.'); }
function clearModScores(yid,mid) { if(!confirm('Clear scores for this module?'))return;const yr=getYear(yid),mod=yr.modules.find(m=>m.id===mid);mod.components.forEach(c=>{delete yr.marks[c.id];});persist();renderYearPane(yid);showToast(`${mod.code} scores cleared.`); }
function clearModAll(yid,mid)    { if(!confirm('Clear all scores for this module?'))return;const yr=getYear(yid),mod=yr.modules.find(m=>m.id===mid);mod.components.forEach(c=>{delete yr.marks[c.id];});persist();renderYearPane(yid);showToast(`${mod.code} cleared.`); }

function hardResetAll() {
  if(!confirm('⚠ HARD RESET: permanently delete ALL data?'))return;
  if(!confirm('Last chance — click OK to permanently delete everything.'))return;
  localStorage.removeItem('gradetracker_v7');
  localStorage.removeItem(COURSE_ONBOARDING_KEY);
  APP=JSON.parse(JSON.stringify(DEFAULT_DATA));
  persist(); renderAll(); showToast('Hard reset complete.');
}

function exportData() {
  const blob=new Blob([JSON.stringify(APP,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='grade-tracker-backup.json'; a.click();
  showToast('Backup downloaded!');
}


function exportDataCSV() {
  const rows = [['Year', 'Module', 'Code', 'Component', 'Weight (%)', 'Mark']];
  APP.years.forEach(yr => {
    yr.modules.forEach(mod => {
      if (!mod.components.length) {
        rows.push([yr.label, mod.name, mod.code || '', '—', '—', '—']);
      } else {
        mod.components.forEach(c => {
          const mark = yr.marks[c.id] !== undefined ? yr.marks[c.id] : '';
          rows.push([yr.label, mod.name, mod.code || '', c.name, c.weight, mark]);
        });
      }
    });
  });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'my-grades.csv';
  a.click();
}

function importData() {
  const input=document.createElement('input'); input.type='file'; input.accept='.json';
  input.onchange=e=>{
    const file=e.target.files[0]; if(!file)return;
    const reader=new FileReader();
    reader.onload=ev=>{
      try{const data=JSON.parse(ev.target.result);if(!data.years||!data.settings)throw new Error('Invalid format');if(!confirm('Restore this backup? Current data will be replaced.'))return;APP=data;migrateData();persist();renderAll();restoreAppearance();showToast('Backup restored!');}
      catch(err){alert('Could not import: '+err.message);}
    };
    reader.readAsText(file);
  };
  input.click();
}

// ── DATA & PRIVACY ──────────────────────────────────────────────────────────
function openDataPrivacy() {
  buildDataHealthSummary();
  openOverlay('dataPrivacyOverlay');
}

function buildDataHealthSummary() {
  const el = document.getElementById('dataHealthSummary');
  if (!el) return;
  const totalModules    = APP.years.reduce((s, y) => s + y.modules.length, 0);
  const totalComponents = APP.years.reduce((s, y) => s + y.modules.reduce((ms, m) => ms + m.components.length, 0), 0);
  const totalMarks      = APP.years.reduce((s, y) => s + Object.values(y.marks || {}).filter(v => v !== '' && v !== null && v !== undefined && !isNaN(parseFloat(v))).length, 0);
  const totalTopics     = APP.years.reduce((s, y) => {
    if (!y.checklist) return s;
    return s + Object.values(y.checklist).reduce((cs, cl) => cs + (cl.topics ? cl.topics.length : 0), 0);
  }, 0);

  const storageRaw = localStorage.getItem('gradetracker_v7') || '';
  const storageKB  = (new Blob([storageRaw]).size / 1024).toFixed(1);

  el.innerHTML = `
    <div class="data-health-card">
      <div class="dhc-val">${APP.years.length}</div>
      <div class="dhc-lbl">Academic Years</div>
    </div>
    <div class="data-health-card">
      <div class="dhc-val">${totalModules}</div>
      <div class="dhc-lbl">Modules</div>
    </div>
    <div class="data-health-card">
      <div class="dhc-val">${totalComponents}</div>
      <div class="dhc-lbl">Components</div>
    </div>
    <div class="data-health-card">
      <div class="dhc-val">${totalMarks}</div>
      <div class="dhc-lbl">Grades Entered</div>
    </div>
    <div class="data-health-card">
      <div class="dhc-val">${totalTopics}</div>
      <div class="dhc-lbl">Revision Topics</div>
    </div>
    <div class="data-health-card">
      <div class="dhc-val">${storageKB}<span style="font-size:13px;font-weight:500"> KB</span></div>
      <div class="dhc-lbl">Storage Used</div>
    </div>
  `;
}

// ── SUPPORT / BUG REPORT ────────────────────────────────────────────────────
function openSupport() {
  const debugEl = document.getElementById('supportDebugInfo');
  if (debugEl) {
    const sanitisedSettings = JSON.parse(JSON.stringify(APP.settings || {}));
    // Remove any PII fields before including in debug info
    delete sanitisedSettings.name;
    delete sanitisedSettings.uni;
    delete sanitisedSettings.dept;
    delete sanitisedSettings.code;
    debugEl.innerHTML = `
      <div class="support-debug-label">Debug info (auto-included in your email)</div>
      <div class="support-debug-body">
        <div><strong>Browser:</strong> ${navigator.userAgent}</div>
        <div><strong>App Settings (sanitised):</strong> ${JSON.stringify(sanitisedSettings)}</div>
        <div><strong>Years:</strong> ${APP.years.length} · <strong>Modules:</strong> ${APP.years.reduce((s,y)=>s+y.modules.length,0)}</div>
      </div>
    `;
  }
  openOverlay('supportOverlay');
}

function sendBugReport() {
  const subject = document.getElementById('support-subject').value.trim() || 'Gradewick Bug Report';
  const desc    = document.getElementById('support-desc').value.trim();
  if (!desc) { showToast('Please describe the issue first'); return; }

  const sanitisedSettings = JSON.parse(JSON.stringify(APP.settings || {}));
  delete sanitisedSettings.name; delete sanitisedSettings.uni;
  delete sanitisedSettings.dept; delete sanitisedSettings.code;

  const debugBlock = [
    '--- Debug Info (auto-generated) ---',
    `Browser: ${navigator.userAgent}`,
    `App Settings (sanitised): ${JSON.stringify(sanitisedSettings)}`,
    `Years: ${APP.years.length}  |  Modules: ${APP.years.reduce((s,y)=>s+y.modules.length,0)}`,
    '---',
  ].join('\n');

  const body = encodeURIComponent(`${desc}\n\n${debugBlock}`);
  const encodedSubject = encodeURIComponent(`[Gradewick] ${subject}`);
  window.location.href = `mailto:kuku.dompreh@warwick.ac.uk?subject=${encodedSubject}&body=${body}`;
  closeOverlayDirect('supportOverlay');
  showToast('Opening your email client…');
}

// ── HELP & FAQ ───────────────────────────────────────────────────────────────
function openHelp() {
  buildHelpPane();
  openOverlay('helpOverlay');
}

function buildHelpPane() {
  const el = document.getElementById('helpModalBody');
  if (!el) return;

  const faqs = [
    {
      q: 'How does Gradewick calculate my grades?',
      a: `<p>Each assessment component is assigned a <strong>weight</strong> (e.g. 60% Exam, 40% Coursework). Your module mark is the <strong>weighted average</strong> of all components:</p>
      <div class="help-formula">Module Mark = Σ (Component Mark × Component Weight%) ÷ 100</div>
      <p>For example, if you score 72% on a 60%-weighted Exam and 68% on a 40%-weighted Coursework:</p>
      <div class="help-formula">(72 × 0.60) + (68 × 0.40) = 43.2 + 27.2 = <strong>70.4%</strong></div>`
    },
    {
      q: 'How do CATS credits affect my overall degree mark?',
      a: `<p>Your overall <strong>year mark</strong> is a CATS-weighted average across modules. Modules worth more credits contribute more to your year average:</p>
      <div class="help-formula">Year Mark = Σ (Module Mark × CATS) ÷ Total CATS in year</div>
      <p>So a 30-credit module counts twice as much as a 15-credit module when calculating your year score.</p>`
    },
    {
      q: 'How is my projected degree classification calculated?',
      a: `<p>Each academic year has a <strong>weighting percentage</strong> (e.g. Year 1 = 10%, Year 2 = 30%, Year 3 = 60%). Your projected mark is the weighted average of the years you've <strong>actually graded so far</strong>, using their weightings as a ratio against each other — not against your whole degree:</p>
      <div class="help-formula">Projected Mark = Σ (Year Mark × Year Weighting%) ÷ Σ (Weighting% of graded years)</div>
      <p>For example, Year 1 (10% weighting) at 60% and Year 2 (30% weighting) at 70%, with Year 3 not yet graded:</p>
      <div class="help-formula">(60 × 10 + 70 × 30) ÷ (10 + 30) = 2700 ÷ 40 = <strong>67.5%</strong></div>
      <p>This way, finishing Year 1 strongly doesn't get diluted down by years you haven't started yet. As you grade more years, they're folded into the ratio automatically. Set year weightings by clicking the <strong>✎ Edit</strong> button on any year in the sidebar. Years with a 0% weighting are excluded from the calculation.</p>`
    },
    {
      q: 'What does the Target Grade planner show?',
      a: `<p>The Target Grade planner works <em>backwards</em> from your goal classification. Given your already-graded years and their weightings, it calculates what average you need across your <strong>remaining ungraded years</strong> to hit your target.</p>
      <p>If all years are graded, it tells you whether you have already achieved the target or not.</p>`
    },
    {
      q: 'What does "What do I need?" on the Dashboard show?',
      a: `<p>For each module where you have entered <em>some</em> marks (but not all), Gradewick calculates the average you need on your <strong>remaining components</strong> to reach your chosen target grade for that module.</p>
      <div class="help-formula">Needed = (Target − Earned so far) ÷ Remaining weight fraction</div>
      <p>If the result is over 100%, the target is no longer achievable from those marks alone.</p>`
    },
    {
      q: 'Can I add custom assessment categories?',
      a: `<p>Yes! When adding or editing a component, select <strong>📦 Other</strong> in the category picker — a text field will appear below where you can type any custom label (e.g. "Lab Report", "Presentation", "Viva").</p>`
    },
    {
      q: 'How do I add or edit academic years?',
      a: `<p>In the sidebar, click the <strong>+ Add year</strong> button at the bottom of the years list. To edit an existing year (rename it, change the academic year string, or set its weighting), hover over it and click the <strong>✎</strong> pencil icon.</p>`
    },
    {
      q: 'Where is my data stored? Is it private?',
      a: `<p>All your data is stored exclusively in your browser's <strong>localStorage</strong> — it never leaves your device and is never sent to any server. Gradewick has no backend, no accounts, and no tracking.</p>
      <p>To back up your data, use <strong>Data &amp; Privacy → Download JSON backup</strong>.</p>`
    },
    {
      q: 'How do I import or restore a backup?',
      a: `<p>Go to <strong>Data &amp; Privacy</strong> in the sidebar footer, then click <strong>Restore from JSON backup</strong> and select a previously downloaded <code>.json</code> file. This will replace all current data.</p>`
    },
    {
      q: 'What does hard reset do?',
      a: `<p><strong>Hard reset</strong> permanently deletes all years, modules, components, marks, and settings from localStorage. This cannot be undone. Always download a backup before resetting.</p>`
    },
  ];

  el.innerHTML = `
    <p style="font-family:var(--fm);font-size:12px;color:var(--tx3);margin-bottom:20px;line-height:1.65">Tap any question to expand the answer. Use the sidebar's <strong>Report an Issue</strong> button if you still need help.</p>
    <div class="help-accordion" id="helpAccordion">
      ${faqs.map((faq, i) => `
        <div class="help-item" id="help-item-${i}">
          <button class="help-q" onclick="toggleHelp(${i})" aria-expanded="false">
            <span>${faq.q}</span>
            <svg class="help-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div class="help-a" id="help-a-${i}" style="display:none">${faq.a}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function toggleHelp(idx) {
  const item = document.getElementById(`help-item-${idx}`);
  const body = document.getElementById(`help-a-${idx}`);
  const btn  = item ? item.querySelector('.help-q') : null;
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  item.classList.toggle('open', !isOpen);
  if (btn) btn.setAttribute('aria-expanded', !isOpen);
}

let teYid=null, teModId=null;

function buildChecklist(yr) {
  if(!yr.checklist) yr.checklist={};
  let totalQ=0, totalDone=0;
  yr.modules.forEach(m=>{const cl=yr.checklist[m.id]||{topics:[],done:{}};totalQ+=cl.topics.length;totalDone+=cl.topics.filter((_,i)=>cl.done[i]).length;});
  const modsDone=yr.modules.filter(m=>{const cl=yr.checklist[m.id]||{topics:[],done:{}};return cl.topics.length>0&&cl.topics.every((_,i)=>cl.done[i]);}).length;
  const pct=totalQ>0?Math.round(totalDone/totalQ*100):0;

  if(!yr.modules||!yr.modules.length) {
    return `<div class="tt-empty">No modules yet. Add modules via the Modules tab first.</div>`;
  }

  const statsHtml=`<div class="cl-stats">
    <div class="cl-stat"><div class="cl-stat-lbl">Topics done</div><div class="cl-stat-val">${totalDone} <span style="font-size:15px;color:var(--tx4)">/ ${totalQ}</span></div></div>
    <div class="cl-stat"><div class="cl-stat-lbl">Progress</div><div class="cl-stat-val" style="color:var(--gn)">${pct}%</div></div>
    <div class="cl-stat"><div class="cl-stat-lbl">Modules done</div><div class="cl-stat-val">${modsDone} <span style="font-size:15px;color:var(--tx4)">/ ${yr.modules.length}</span></div></div>
  </div>`;

  const actHtml=`<div class="cl-actions">
    <button class="btn btn-ghost btn-sm" onclick="clExpandAll('${yr.id}')">Expand all</button>
    <button class="btn btn-ghost btn-sm" onclick="clCollapseAll('${yr.id}')">Collapse all</button>
    <button class="btn btn-danger btn-sm" onclick="clReset('${yr.id}')">Reset all progress</button>
  </div>`;

  let modHtml='';
  yr.modules.forEach(m=>{
    const cl=yr.checklist[m.id]||{topics:[],done:{}};
    const done=cl.topics.filter((_,i)=>cl.done[i]).length, total=cl.topics.length;
    const fpct=total>0?Math.round(done/total*100):0;
    let items='';
    cl.topics.forEach((topic,i)=>{const chk=!!cl.done[i];items+=`<div class="cl-item${chk?' chk':''}" onclick="clToggle('${yr.id}','${m.id}',${i})"><div class="cl-box"><svg class="cl-tick" viewBox="0 0 10 10" fill="none" stroke="currentColor"  stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5 5 4 7.5 8.5 2.5"/></svg></div><span class="cl-lbl">${escapeHTML(topic)||'Topic '+(i+1)}</span></div>`;});
    if(!items) items=`<div style="font-family:var(--fm);font-size:11px;color:var(--tx4);font-style:italic;padding:8px 0">No topics yet. Click ✎ to add some.</div>`;
    const modResetBtn=total>0?`<button class="btn btn-danger btn-sm" style="margin-top:10px" onclick="clResetMod('${yr.id}','${m.id}')">Reset ${escapeHTML(m.code)} progress</button>`:'';
    modHtml+=`<div class="card" id="clcard-${yr.id}-${m.id}">
      <div class="cl-mod-hdr" onclick="toggleCard('clcard-${yr.id}-${m.id}')">
        <span class="mod-code">${escapeHTML(m.code)}</span>
        <span class="mod-name">${escapeHTML(m.name)}</span>
        <span class="cl-count${done===total&&total>0?' done':''}">${done} / ${total}</span>
        <div class="cl-bar-wrap"><div class="cl-bar-fill" style="width:${fpct}%"></div></div>
        <button class="icon-btn btn-sm" aria-label="Edit topics for ${escapeHTML(m.name)}" onclick="event.stopPropagation();openTopicEdit('${yr.id}','${m.id}')" title="Edit topics" style="margin-right:4px">✎</button>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="cl-mod-body" style="display:none"><div class="cl-grid">${items}</div>${modResetBtn}</div>
    </div>`;
  });

  return statsHtml+actHtml+`<div>${modHtml}</div>`;
}

function clToggle(yid,mid,idx){const yr=getYear(yid);if(!yr.checklist)yr.checklist={};if(!yr.checklist[mid])yr.checklist[mid]={topics:[],done:{}};yr.checklist[mid].done[idx]=!yr.checklist[mid].done[idx];persist();const sp=document.getElementById(`sp-${yid}-checklist`);const openCards=sp?[...sp.querySelectorAll('.card.open')].map(c=>c.id):[];if(sp)sp.innerHTML=buildChecklist(yr);restoreOpenCards(openCards,'.cl-mod-body');}
function clExpandAll(yid){document.querySelectorAll(`#sp-${yid}-checklist .card`).forEach(c=>{c.classList.add('open');const body=c.querySelector('.cl-mod-body');if(body)body.style.display='block';const chev=c.querySelector('.chevron');if(chev)chev.style.transform='rotate(180deg)';});}
function clCollapseAll(yid){document.querySelectorAll(`#sp-${yid}-checklist .card`).forEach(c=>{c.classList.remove('open');const body=c.querySelector('.cl-mod-body');if(body)body.style.display='none';const chev=c.querySelector('.chevron');if(chev)chev.style.transform='';});}
function clReset(yid){if(!confirm('Reset ALL checklist progress?'))return;const yr=getYear(yid);if(yr.checklist)Object.values(yr.checklist).forEach(cl=>{cl.done={};});persist();const sp=document.getElementById(`sp-${yid}-checklist`);if(sp)sp.innerHTML=buildChecklist(yr);showToast('Checklist reset.');}
function clResetMod(yid,mid){const yr=getYear(yid),mod=yr.modules.find(m=>m.id===mid);if(!confirm(`Reset checklist progress for ${mod.code}?`))return;if(yr.checklist&&yr.checklist[mid])yr.checklist[mid].done={};persist();const sp=document.getElementById(`sp-${yid}-checklist`);const openCards=sp?[...sp.querySelectorAll('.card.open')].map(c=>c.id):[];if(sp)sp.innerHTML=buildChecklist(yr);restoreOpenCards(openCards,'.cl-mod-body');showToast(`${mod.code} checklist reset.`);}

function restoreOpenCards(openCardIds, bodySelector) {
  openCardIds.forEach(id=>{const card=document.getElementById(id);if(!card)return;card.classList.add('open');const body=card.querySelector(bodySelector);if(body)body.style.display='block';const chev=card.querySelector('.chevron');if(chev)chev.style.transform='rotate(180deg)';});
}

function openTopicEdit(yid,mid){
  teYid=yid; teModId=mid;
  const yr=getYear(yid),mod=yr.modules.find(m=>m.id===mid);
  if(!yr.checklist) yr.checklist={};
  if(!yr.checklist[mid]) yr.checklist[mid]={topics:[],done:{}};
  document.getElementById('topicEditEyebrow').textContent=mod.code;
  document.getElementById('topicEditModName').textContent=mod.name;
  document.getElementById('topicTextarea').value=yr.checklist[mid].topics.join('\n');
  openOverlay('topicEditOverlay');
}

function saveTopics(){
  const yr=getYear(teYid);
  const topics=document.getElementById('topicTextarea').value.split('\n').map(s=>s.trim()).filter(Boolean);
  if(!yr.checklist) yr.checklist={};
  if(!yr.checklist[teModId]) yr.checklist[teModId]={topics:[],done:{}};

  // Fix 4: Rebuild the done object from scratch so that only indexes that
  // exist in the NEW topics array are kept.  Without this, deleting a topic
  // leaves orphan keys (e.g. { 4: true } when only indexes 0-1 remain), which
  // corrupts progress counts and the "module done" badge.
  const oldDone = yr.checklist[teModId].done || {};
  const newDone  = {};
  topics.forEach((_, i) => {
    if (oldDone[i] !== undefined) newDone[i] = oldDone[i];
  });

  yr.checklist[teModId].topics = topics;
  yr.checklist[teModId].done   = newDone;

  persist(); closeOverlayDirect('topicEditOverlay');
  const sp=document.getElementById(`sp-${teYid}-checklist`);
  if(sp) sp.innerHTML=buildChecklist(yr);
  showToast('Topics saved!');
}

function toggleCard(id){
  const card=document.getElementById(id);if(!card)return;
  const isOpen=card.classList.contains('open');
  card.classList.toggle('open',!isOpen);
  const chev=card.querySelector('.chevron');if(chev)chev.style.transform=!isOpen?'rotate(180deg)':'';
  const body=card.querySelector('.mod-body,.cl-mod-body');if(body)body.style.display=!isOpen?'block':'none';
}

function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2200);}

// ── Course Picker ──
let cpSelectedDept = null, cpSelectedCourse = null, cpCurrentStep = 0;

// ALL_MODULES_DICT: keyed by module code (uppercase).
// Each entry: { name, cats, url, assessmentSplit, components: [{name, weight}] }
const ALL_MODULES_DICT = {};

/**
 * buildModuleDict()
 *
 * Populates ALL_MODULES_DICT with every searchable module so the autofill
 * datalists contain the full 3,500+ entry set.
 *
 * PRIORITY RULES:
 *  1. PRIMARY  — WARWICK_ALL_MODULES (deep-scraped, module-data.js).
 *                Every entry here is written unconditionally.
 *  2. FALLBACK — WARWICK_COURSES (core degree structures, course-data.js).
 *                A code is only written from this source if it was NOT already
 *                found in the primary set, so the deep-scraped assessment data
 *                is never clobbered by the smaller core dataset.
 *
 * IMPORTANT: module-data.js **must** be loaded before app.js in index.html
 * for the primary source to be available at call time.  If the load order is
 * wrong the function falls back gracefully to WARWICK_COURSES only.
 */
function buildModuleDict() {
  // ── 1. PRIMARY: deep-scraped full module list ─────────────────────────────
  let primaryCount = 0;
  if (typeof WARWICK_ALL_MODULES !== 'undefined' && Array.isArray(WARWICK_ALL_MODULES) && WARWICK_ALL_MODULES.length > 0) {
    WARWICK_ALL_MODULES.forEach(m => {
      if (!m.code) return;
      const code = m.code.toUpperCase();

      const asm = m.assessment || {};
      const components = [];
      if (asm.ok && Array.isArray(asm.components) && asm.components.length > 0) {
        asm.components.forEach(comp => {
          components.push({ name: comp.name, weight: comp.weighting });
        });
      }

      ALL_MODULES_DICT[code] = {
        name: m.course || m.name || code,   // deep-scraper stores the title in 'course'
        cats: (m.credits !== null && !isNaN(m.credits)) ? m.credits : 15,
        url: m.url || '',
        assessmentSplit: asm.assessmentSplit || '',
        components
      };
      primaryCount++;
    });
  } else {
    // Warn if the primary source is missing — likely a script load-order problem.
    console.warn(
      '[Gradewick] buildModuleDict: WARWICK_ALL_MODULES is not defined or empty. ' +
      'Make sure module-data.js is loaded BEFORE app.js in index.html. ' +
      'Falling back to WARWICK_COURSES only.'
    );
  }

  // ── 2. FALLBACK: core degree structures from course-data.js ───────────────
  // Only adds a code if the deep-scrape did NOT already cover it.
  let fallbackCount = 0;
  if (typeof WARWICK_COURSES !== 'undefined' && Array.isArray(WARWICK_COURSES) && WARWICK_COURSES.length > 0) {
    WARWICK_COURSES.forEach(c => {
      if (!c.years) return;
      Object.values(c.years).forEach(yr => {
        if (!yr.core) return;
        yr.core.forEach(m => {
          if (!m.code) return;
          const code = m.code.toUpperCase();
          if (ALL_MODULES_DICT[code]) return; // already covered by primary — do not overwrite

          const asm = m.assessment || {};
          const components = [];
          if (asm.ok && Array.isArray(asm.components) && asm.components.length > 0) {
            asm.components.forEach(comp => {
              components.push({ name: comp.name, weight: comp.weighting });
            });
          }
          ALL_MODULES_DICT[code] = {
            name: m.name || code,
            cats: (m.credits !== null && !isNaN(m.credits)) ? m.credits : 15,
            url: asm.url || '',
            assessmentSplit: asm.assessmentSplit || '',
            components
          };
          fallbackCount++;
        });
      });
    });
  }

  // ── 3. Verification log ───────────────────────────────────────────────────
  const totalLoaded = Object.keys(ALL_MODULES_DICT).length;
  console.log(
    `[Gradewick] buildModuleDict complete: ` +
    `${primaryCount} from WARWICK_ALL_MODULES (primary), ` +
    `${fallbackCount} from WARWICK_COURSES (fallback), ` +
    `${totalLoaded} total unique modules loaded into ALL_MODULES_DICT.`
  );
}

function populateDatalists() {
  let codesHtml = '';
  let namesHtml = '';
  Object.keys(ALL_MODULES_DICT).forEach(code => {
    codesHtml += `<option value="${code}">`;
    namesHtml += `<option value="${ALL_MODULES_DICT[code].name}">`;
  });
  const cl = document.getElementById('module-codes-list');
  const nl = document.getElementById('module-names-list');
  if (cl) cl.innerHTML = codesHtml;
  if (nl) nl.innerHTML = namesHtml;
}

function setupAutoFill() {
  const codeInp = document.getElementById('me-code');
  const nameInp = document.getElementById('me-name');
  const catsInp = document.getElementById('me-cats');

  if (codeInp && nameInp && catsInp) {
    codeInp.addEventListener('input', (e) => {
      const code = e.target.value.trim().toUpperCase();
      const entry = ALL_MODULES_DICT[code];
      if (entry) {
        nameInp.value = entry.name;
        catsInp.value = entry.cats;
      }
    });

    nameInp.addEventListener('input', (e) => {
      const name = e.target.value.trim().toLowerCase();
      const foundCode = Object.keys(ALL_MODULES_DICT).find(k => ALL_MODULES_DICT[k].name.toLowerCase() === name);
      if (foundCode) {
        codeInp.value = foundCode;
        catsInp.value = ALL_MODULES_DICT[foundCode].cats;
      }
    });
  }

  const compNameInp = document.getElementById('ce-name');
  if (compNameInp) {
    compNameInp.addEventListener('input', (e) => {
      const cat = inferCategory(e.target.value);
      const btn = document.querySelector(`.cat-sel-btn[data-cat="${cat}"]`);
      if (btn) selectCat(btn);
    });
  }
}

function cpGetDepts() {
  return [...new Set(courseData.map(c => c.department))].filter(Boolean).sort();
}

function cpGetCourses(dept) {
  return courseData.filter(c => c.department === dept).sort((a,b) => a.course.localeCompare(b.course));
}

function cpGetCoreModules(courseObj) {
  const result = [];
  const years = courseObj.years || {};
  const yearOrder = ['Year 1','Year 2','Year 3','Year 4','Year 5','Intermediate Year','Final Year'];
  const populatedKeys = Object.keys(years).filter(k => years[k].core && years[k].core.length > 0);
  
  populatedKeys.sort((a,b) => yearOrder.indexOf(a) - yearOrder.indexOf(b));
  
  populatedKeys.forEach(yr => {
    const mods = years[yr].core || [];
    if (mods.length) result.push({ yearLabel: yr, modules: mods });
  });
  return result;
}

function cpShowOnboarding(firstRun = false) {
  cpCurrentStep = 0;
  cpSelectedDept = null;
  cpSelectedCourse = null;
  document.getElementById('cpTitle').textContent = firstRun ? 'Set up your course' : 'Set up my course';
  document.getElementById('cpSub').textContent = firstRun
    ? 'Find your course to set up the website automatically, or continue manually.'
    : 'Find your course automatically, or continue setting things up manually.';
  cpGoStep(0);
  openOverlay('coursePickerOverlay');
}

function cpGoStep(step) {
  [0,1,2,3].forEach(i => {
    const el = document.getElementById(`cp-step-${i}`);
    if (el) el.style.display = i === step ? 'block' : 'none';
  });
  cpCurrentStep = step;
  if (step === 1) cpRenderDepts();
  if (step === 2) cpRenderCourses();
  if (step === 3) cpRenderPreview();
}

function cpStartCourse() {
  closeSidebar();
  cpGoStep(1);
}

function cpRenderDepts() {
  const grid = document.getElementById('cp-dept-grid');
  if (!courseData || courseData.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1; padding:30px; text-align:center; color:var(--red); background:var(--redbg); border-radius:var(--r-md);"><b>⚠️ Course data missing!</b><br>Please make sure you created <code>data.js</code> and pasted your JSON into it as instructed.</div>';
    return;
  }
  const depts = cpGetDepts();
  grid.innerHTML = depts.map(d => {
    const safeD = d.replace(/"/g, '&quot;');
    return `<button class="cp-card ${cpSelectedDept===d?'selected':''}" data-val="${safeD}" onclick="cpPickDept(this.dataset.val)">
      <div class="cp-card-title">${d}</div>
      <div class="cp-card-sub">${cpGetCourses(d).length} course${cpGetCourses(d).length!==1?'s':''}</div>
    </button>`;
  }).join('');
}

function cpFilterDepts(q) {
  const grid = document.getElementById('cp-dept-grid');
  const depts = cpGetDepts().filter(d => d.toLowerCase().includes(q.toLowerCase()));
  grid.innerHTML = depts.length ? depts.map(d => {
    const safeD = d.replace(/"/g, '&quot;');
    return `<button class="cp-card ${cpSelectedDept===d?'selected':''}" data-val="${safeD}" onclick="cpPickDept(this.dataset.val)">
      <div class="cp-card-title">${d}</div>
      <div class="cp-card-sub">${cpGetCourses(d).length} course${cpGetCourses(d).length!==1?'s':''}</div>
    </button>`;
  }).join('') : '<div style="font-family:var(--fm);font-size:12px;color:var(--tx4);padding:12px 0">No departments match your search.</div>';
}

function cpPickDept(dept) {
  cpSelectedDept = dept;
  cpSelectedCourse = null;
  document.getElementById('cp-dept-search').value = '';
  cpGoStep(2);
}

function cpRenderCourses() {
  document.getElementById('cp-dept-label').textContent = cpSelectedDept;
  const grid = document.getElementById('cp-course-grid');
  const courses = cpGetCourses(cpSelectedDept);
  grid.innerHTML = courses.map(c => {
    const safeC = c.course.replace(/"/g, '&quot;');
    return `<button class="cp-card ${cpSelectedCourse&&cpSelectedCourse.course===c.course?'selected':''}" data-val="${safeC}" onclick="cpPickCourse(this.dataset.val)">
      <div class="cp-card-title">${c.course}</div>
      <div class="cp-card-sub">${c.qualification}</div>
      <div class="cp-card-sub" style="margin-top:2px">${c.duration}</div>
    </button>`;
  }).join('');
}

function cpFilterCourses(q) {
  const grid = document.getElementById('cp-course-grid');
  const courses = cpGetCourses(cpSelectedDept).filter(c => c.course.toLowerCase().includes(q.toLowerCase()));
  grid.innerHTML = courses.length ? courses.map(c => {
    const safeC = c.course.replace(/"/g, '&quot;');
    return `<button class="cp-card ${cpSelectedCourse&&cpSelectedCourse.course===c.course?'selected':''}" data-val="${safeC}" onclick="cpPickCourse(this.dataset.val)">
      <div class="cp-card-title">${c.course}</div>
      <div class="cp-card-sub">${c.qualification}</div>
      <div class="cp-card-sub" style="margin-top:2px">${c.duration}</div>
    </button>`;
  }).join('') : '<div style="font-family:var(--fm);font-size:12px;color:var(--tx4);padding:12px 0">No courses match your search.</div>';
}

function cpPickCourse(courseName) {
  cpSelectedCourse = courseData.find(c => c.course === courseName);
  document.getElementById('cp-course-search').value = '';
  cpGoStep(3);
}

function cpRenderPreview() {
  if (!cpSelectedCourse) return;
  const c = cpSelectedCourse;
  const yearMods = cpGetCoreModules(c);
  const totalMods = yearMods.reduce((s,y) => s + y.modules.length, 0);
  const totalWithAssessments = yearMods.reduce((s,y) => s + y.modules.filter(m => m.assessment && m.assessment.ok && m.assessment.components && m.assessment.components.length > 0).length, 0);

  document.getElementById('cp-preview-header').innerHTML = `
    <div class="cp-preview-header-title">${c.course}</div>
    <div class="cp-preview-header-meta">${c.department} · ${c.qualification} · ${c.duration}</div>
    <div style="margin-top:8px;font-family:var(--fm);font-size:10px;color:var(--accent-mid)">${totalMods} core module${totalMods!==1?'s':''} across ${yearMods.length} year${yearMods.length!==1?'s':''} · ${totalWithAssessments} with full assessment data</div>
  `;

  let listHtml = '';
  if (!yearMods.length) {
    listHtml = '<div style="font-family:var(--fm);font-size:12px;color:var(--tx4);padding:8px 0;font-style:italic">No core modules with credits found in the dataset. You can add modules manually after setup.</div>';
  } else {
    yearMods.forEach(ym => {
      listHtml += `<div class="cp-preview-yr">${ym.yearLabel}</div>`;
      ym.modules.forEach(m => {
        const asm = m.assessment || {};
        const hasComponents = asm.ok && asm.components && asm.components.length > 0;
        const splitBadge = asm.assessmentSplit
          ? `<span style="font-family:var(--fm);font-size:9px;color:var(--tx3);background:var(--bg2);padding:1px 5px;border-radius:3px;border:1px solid var(--b2);margin-left:4px">${asm.assessmentSplit}</span>`
          : '';
        const urlLink = asm.url
          ? `<a href="${asm.url}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="font-size:10px;color:var(--accent-mid);text-decoration:none;margin-left:4px" title="Open module page">🔗</a>`
          : '';
        listHtml += `<div class="cp-preview-mod">
          <span class="cp-preview-code">${m.code}</span>
          <span class="cp-preview-name">${m.name}${splitBadge}${urlLink}</span>
          <span class="cp-preview-cats">${(m.credits !== null && !isNaN(m.credits)) ? m.credits : 15} credits</span>
          <span class="cp-preview-type">Core</span>
        </div>`;
        // Show assessment components breakdown if available
        if (hasComponents) {
          listHtml += `<div style="padding:0 0 6px 0;margin-left:0">`;
          asm.components.forEach(comp => {
            const cat = inferCategory(comp.name);
            listHtml += `<div style="display:flex;align-items:center;gap:6px;padding:2px 0 2px 16px;font-family:var(--fm);font-size:10px;color:var(--tx3)">
              ${catBadgeHtml(cat)}
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${comp.name}</span>
              <span style="color:var(--accent-mid);font-weight:600;flex-shrink:0">${comp.weighting}%</span>
            </div>`;
          });
          listHtml += `</div>`;
        }
      });
    });
  }
  document.getElementById('cp-preview-list').innerHTML = listHtml;
}

function markCourseOnboardingSeen() {
  localStorage.setItem(COURSE_ONBOARDING_KEY, '1');
}

function cpConfirm() {
  if (!cpSelectedCourse) return;
  const c = cpSelectedCourse;
  
APP.settings.uni  = 'University of Warwick';
APP.settings.dept = c.department;
APP.settings.code = c.course;

  const populatedKeys = Object.keys(c.years || {}).filter(k => c.years[k].core && c.years[k].core.length > 0);
  const yearOrder = ['Year 1','Year 2','Year 3','Year 4','Year 5','Intermediate Year','Final Year'];
  populatedKeys.sort((a,b) => yearOrder.indexOf(a) - yearOrder.indexOf(b));

  let durationYears = 3;
  if (c.duration) {
    const m = c.duration.match(/(\d+)\s*years?/i);
    if (m) {
      durationYears = parseInt(m[1]);
    } else {
      const dLow = c.duration.toLowerCase();
      if (dLow.includes('four') || dLow.includes('4')) durationYears = 4;
      else if (dLow.includes('five') || dLow.includes('5')) durationYears = 5;
      else if (dLow.includes('two') || dLow.includes('2')) durationYears = 2;
      else if (dLow.includes('one') || dLow.includes('1')) durationYears = 1;
    }
  }

  const numYears = Math.max(durationYears, populatedKeys.length, 1);

  APP.years = [];
  const currentCalYear = new Date().getFullYear();

  for (let i = 1; i <= numYears; i++) {
    const yid = makeId();
    const acStart = currentCalYear + (i - 1) - 1;
    APP.years.push({
      id: yid,
      label: `Year ${i}`,
      acyr: `${acStart}/${String(acStart+1).slice(-2)}`,
      modules: [],
      marks: {},
      checklist: {},
      futureModuleGrades: {},
      futureComponentGrades: {},
      weighting: 0
    });
  }
  APP.activeYear = APP.years[0].id;
  APP.activeOverview = false;
  APP.lastTab = {};

  // Distribute populated years — importing full components from assessment data
  populatedKeys.forEach(yrKey => {
    let targetIdx = 0;
    if (yrKey.startsWith('Year')) {
       targetIdx = parseInt(yrKey.replace('Year ', '')) - 1;
    } else if (yrKey === 'Intermediate Year') {
       targetIdx = numYears > 3 ? 2 : 1; 
    } else if (yrKey === 'Final Year') {
       targetIdx = numYears - 1;
    }
    
    if (targetIdx < 0) targetIdx = 0;
    if (targetIdx >= numYears) targetIdx = numYears - 1;

    const appYear = APP.years[targetIdx];
    const mods = c.years[yrKey].core || [];
    
    mods.forEach(m => {
      if (appYear.modules.find(existing => existing.code === m.code)) return;
      const nid = makeId();
      const safeCats = (m.credits !== null && !isNaN(m.credits)) ? m.credits : 15;

      // Build components from assessment data
      const components = [];
      const asm = m.assessment || {};
      if (asm.ok && asm.components && asm.components.length > 0) {
        asm.components.forEach(comp => {
          const componentObj = {
            id:       makeId(),
            name:     comp.name,
            weight:   comp.weighting,
            category: inferCategory(comp.name),
            date: '', time: '', duration: '', location: ''
          };
          // ── AUTO-FILL: overwrite exam fields from the official timetable ──
          enrichExamData(m.code, componentObj);
          components.push(componentObj);
        });
      }

      appYear.modules.push({
        id: nid,
        code: m.code,
        name: m.name,
        cats: safeCats,
        components,
        url: asm.url || '',
      });

      if (!appYear.checklist) appYear.checklist = {};
      appYear.checklist[nid] = { topics: [], done: {} };
    });
  });

  markCourseOnboardingSeen();
  persist();
  closeOverlayDirect('coursePickerOverlay');
  restoreAppearance();
  renderAll();
  showToast(`✓ ${cpSelectedCourse.course} added!`);
}

function cpSkip() {
  closeSidebar();
  markCourseOnboardingSeen();
  persist();
  closeOverlayDirect('coursePickerOverlay');
  renderAll();
}

// ── Boot ──
buildModuleDict();
populateDatalists();
setupAutoFill();
loadApp();
// Default to overview tab on first load
if (APP.activeOverview === undefined) APP.activeOverview = true;
restoreAppearance();
renderAll();

(function showCourseImportOnFirstVisit() {
  const hasSeenCourseOnboarding = localStorage.getItem(COURSE_ONBOARDING_KEY) === '1';
  const hasModules = APP.years.some(y => y.modules && y.modules.length > 0);
  const hasSettings = APP.settings.name || APP.settings.uni || APP.settings.dept;

  // Show the course import as the first thing on a brand-new website visit.
  if (!hasSeenCourseOnboarding && !hasModules && !hasSettings) {
    setTimeout(() => cpShowOnboarding(true), 300);
  }
})();
