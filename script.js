// Cron parser & next-run calculator (5 fields)
// — supports numbers, lists, ranges, steps, month/day names.

const $ = (sel) => document.querySelector(sel);
const cronInput = $("#cron-input");
const nextList = $("#next-list");
const nextSubtitle = $("#next-run-subtitle");
const humanTime = $("#human-time");
const humanText = $("#human-text");
const errorBox = $("#error");

const MONTHS = {
  jan:1,feb:2,mar:3,apr:4,may:5,jun:6,
  jul:7,aug:8,sep:9,oct:10,nov:11,dec:12
};
const DOW = { sun:0, mon:1, tue:2, wed:3, thu:4, fri:5, sat:6 };

// Utilities
function pad(n){ return String(n).padStart(2,'0'); }
function clone(d){ return new Date(d.getTime()); }
function roundUpToNextMinute(d){
  const ms = d.getMilliseconds();
  const s  = d.getSeconds();
  const base = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), 0, 0);
  base.setMinutes(base.getMinutes() + 1);
  return base;
}

function parseNumberOrName(tok, namesMap, offset=0) {
  const low = tok.toLowerCase();
  if (namesMap && (low in namesMap)) return namesMap[low] + offset;
  if (!/^-?\d+$/.test(tok)) return null;
  return parseInt(tok, 10);
}

function expandPart(part, min, max, namesMap=null) {
  // Handle */n or a-b/n or single
  let [rangePart, stepPart] = part.split('/');
  const step = stepPart ? parseInt(stepPart, 10) : 1;
  if (isNaN(step) || step <= 0) throw new Error(`Invalid step: ${part}`);

  if (rangePart === '*') {
    const arr = [];
    for (let i=min; i<=max; i+=step) arr.push(i);
    return arr;
  }

  let start, end;
  if (rangePart.includes('-')) {
    const [a,b] = rangePart.split('-');
    start = parseNumberOrName(a, namesMap, 0);
    end   = parseNumberOrName(b, namesMap, 0);
  } else {
    start = parseNumberOrName(rangePart, namesMap, 0);
    end = start;
  }
  if (start===null || end===null) throw new Error(`Invalid token: ${part}`);

  // Normalize Sunday = 7 -> 0 for DOW (caller should pass min=0,max=6)
  if (namesMap === DOW) {
    if (start === 7) start = 0;
    if (end === 7) end = 0;
  }

  if (start>max || end>max || start<min || end<min) {
    throw new Error(`Out of range: ${part}`);
  }

  const arr = [];
  if (end >= start) {
    for (let v=start; v<=end; v++) if ((v-start) % step === 0) arr.push(v);
  } else {
    // handle wraparound like 5-2 (allowed for DOW)
    for (let v=start; v<=max; v++) if ((v-start) % step === 0) arr.push(v);
    const count = arr.length;
    for (let v=min; v<=end; v++) {
      const idx = (v + (max - start + 1));
      if (idx % step === 0) arr.push(v);
    }
  }
  return arr;
}

function parseField(field, min, max, names=null) {
  field = field.trim();
  if (!field) throw new Error('Missing field');
  if (field === '*') {
    const set = new Set();
    for (let i=min; i<=max; i++) set.add(i);
    return set;
  }
  const parts = field.split(',');
  const out = new Set();
  for (const p of parts) {
    const values = expandPart(p.trim(), min, max, names);
    values.forEach(v => out.add(v));
  }
  return out;
}

// Parse a 5-field cron string
function parseCron(expr) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('Cron must have exactly 5 fields');
  const [m, h, dom, mon, dow] = parts;

  return {
    minute: parseField(m, 0, 59, null),
    hour:   parseField(h, 0, 23, null),
    dom:    parseField(dom, 1, 31, null),
    month:  parseField(mon, 1, 12, MONTHS),
    dow:    parseField(dow, 0, 6, DOW), // 0 or 7 = Sunday; parser maps 7->0
  };
}

function matches(d, cron) {
  const minute = d.getMinutes();
  const hour   = d.getHours();
  const dom    = d.getDate();
  const month  = d.getMonth()+1;
  const dow    = d.getDay();
  return cron.minute.has(minute) &&
         cron.hour.has(hour) &&
         cron.dom.has(dom) &&
         cron.month.has(month) &&
         cron.dow.has(dow);
}

function nextRun(cron, from = new Date()) {
  let d = roundUpToNextMinute(from);
  // Search up to ~2 years of minutes to be safe
  const limit = 2 * 366 * 24 * 60;
  for (let i=0; i<limit; i++) {
    if (matches(d, cron)) return d;
    d = new Date(d.getTime() + 60_000);
  }
  throw new Error('Could not find the next run within 2 years.');
}

function nextNRuns(cron, n=5, from = new Date()) {
  const runs = [];
  let d = new Date(from.getTime());
  for (let i=0; i<n; i++) {
    const r = nextRun(cron, d);
    runs.push(r);
    d = new Date(r.getTime() + 60_000); // move past
  }
  return runs;
}

// Humanize (simple cases)
function humanize(expr, runs) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return '';
  const [m, h, dom, mon, dow] = parts;
  const d0 = runs?.[0];
  let timeStr = d0 ? `${pad(d0.getHours())}:${pad(d0.getMinutes())}` : '--:--';
  humanTime.textContent = timeStr;

  let txt = `Next run is ${d0?.toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`;

  // If only minute+hour fixed and others * → “At HH:MM daily.”
  const isDaily = dom==='*' && mon==='*' && dow==='*' && h!=='*' && m!=='*';
  if (isDaily) {
    txt = `At ${timeStr} every day.`;
  }
  return txt;
}

function formatRun(d){
  return d.toLocaleString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function refresh() {
  const expr = cronInput.value.trim();
  errorBox.textContent = '';
  nextList.innerHTML = '';
  humanText.textContent = '';
  nextSubtitle.textContent = 'next at —';
  humanTime.textContent = '--:--';

  if (!expr) return;

  let cron;
  try {
    cron = parseCron(expr);
  } catch (e) {
    errorBox.textContent = e.message;
    return;
  }

  try {
    const runs = nextNRuns(cron, 5, new Date());
    humanText.textContent = humanize(expr, runs);
    humanTime.textContent = runs.length ? `${pad(runs[0].getHours())}:${pad(runs[0].getMinutes())}` : '--:--';
    nextSubtitle.textContent = `next at ${formatRun(runs[0])}`;
    nextList.innerHTML = runs.map(d => `<li>${formatRun(d)}</li>`).join('');
  } catch (e) {
    errorBox.textContent = e.message;
  }
}

// Random simple cron (like screenshot: m h * * *)
function randomCron() {
  const m = Math.floor(Math.random()*60);
  const h = Math.floor(Math.random()*24);
  return `${m} ${h} * * *`;
}

// Copy to clipboard
function copyCron() {
  const val = cronInput.value.trim();
  if (!val) return;
  navigator.clipboard?.writeText(val).then(()=>{
    const btn = document.getElementById('copy-btn');
    const old = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(()=>btn.textContent = old, 900);
  }).catch(()=>{});
}

// Wire up
document.getElementById('random-btn').addEventListener('click', () => {
  cronInput.value = randomCron();
  refresh();
});
document.getElementById('copy-btn').addEventListener('click', copyCron);
cronInput.addEventListener('input', refresh);

// Initial state
cronInput.value = '5 4 * * *';
refresh();
