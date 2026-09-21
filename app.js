import { html, render, useState, useEffect, useMemo, useRef } from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js';
import { SUPABASE_URL, SUPABASE_KEY, DOMAIN } from './config.js?v=1';
import { Icon } from './icons.js?v=1';

if (!window.supabase) throw new Error('The Supabase library did not load (cdn.jsdelivr.net)');
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// current user, settings and shift, refreshed by App() on every render
let CTX = { me: null, S: {}, shift: null };
let toastFn = () => {};
const toast = (text, kind) => toastFn({ text, kind });

/* ================= helpers ================= */
const tzOf = () => CTX.S.timezone || 'Africa/Cairo';
const AR = 'ar-EG-u-nu-latn';
const fmtTime = (iso) => (iso ? new Intl.DateTimeFormat(AR, { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: tzOf() }).format(new Date(iso)) : '—');
const fmtDay = (iso) => new Intl.DateTimeFormat(AR, { weekday: 'long', day: 'numeric', month: 'long', timeZone: tzOf() }).format(new Date(iso));
const fmtShort = (iso) => new Intl.DateTimeFormat(AR, { weekday: 'short', day: 'numeric', month: 'short', timeZone: tzOf() }).format(new Date(iso));
const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tzOf() }).format(d instanceof Date ? d : new Date(d));
const todayKey = () => dayKey(new Date());
const keyToDate = (key) => new Date(key + 'T12:00:00Z');
const addDays = (key, n) => { const d = keyToDate(key); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const minsOfDay = (iso) => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: tzOf(), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  return Number(p.find((x) => x.type === 'hour').value) * 60 + Number(p.find((x) => x.type === 'minute').value);
};
const shiftStartMin = (sh) => { const [h, m] = String(sh.start_time).split(':'); return Number(h) * 60 + Number(m); };
const lateMin = (att, sh) => (sh ? Math.max(0, minsOfDay(att.check_in) - shiftStartMin(sh)) : 0);
// in-app navigation history, so "back" returns to the page you came from
const navStack = [location.hash.slice(1)];
window.addEventListener('hashchange', () => {
  const r = location.hash.slice(1);
  if (navStack.length > 1 && navStack[navStack.length - 2] === r) navStack.pop();
  else navStack.push(r);
});
const goBack = (fallback) => { if (navStack.length > 1) history.back(); else location.hash = '#' + fallback; };
const fullHours = (a) => Math.max(0, Math.floor(((a.check_out ? new Date(a.check_out) : new Date()) - new Date(a.check_in)) / 3600000));
// paid hours by the shift clock: regular hours only inside the shift, overtime from the end of the shift until check-out
const shiftStartTs = (a, sh) => new Date(a.check_in).getTime() - (minsOfDay(a.check_in) - shiftStartMin(sh)) * 60000;
const paidParts = (a, sh) => {
  if (!sh) return { reg: fullHours(a), ot: 0 };
  const s = shiftStartTs(a, sh);
  const e = s + Number(sh.hours) * 3600000;
  const tin = new Date(a.check_in).getTime();
  const tout = a.check_out ? new Date(a.check_out).getTime() : Date.now();
  return {
    reg: Math.max(0, Math.floor((Math.min(tout, e) - Math.max(tin, s)) / 3600000)),
    ot: Math.max(0, Math.floor((tout - Math.max(e, tin)) / 3600000)),
  };
};
const paidHours = (a, sh) => { const p = paidParts(a, sh); return p.reg + p.ot; };
const pad2 = (n) => String(n).padStart(2, '0');
const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return pad2(Math.floor(s / 3600)) + ':' + pad2(Math.floor((s % 3600) / 60)) + ':' + pad2(s % 60); };
const toLocalInput = (iso) => {
  const d = new Date(iso);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
};
const distM = (lat1, lon1, lat2, lon2) => {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(a));
};
const initial = (name) => ((name || '?').trim().charAt(0) || '?');
const greet = () => (Number(new Intl.DateTimeFormat('en-GB', { timeZone: tzOf(), hour: '2-digit', hourCycle: 'h23' }).format(new Date())) < 12 ? 'صباح الخير' : 'مساء الخير');
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const fmtMoney = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthStart = (key) => key.slice(0, 7) + '-01';
const addMonths = (key, n) => { const [y, m] = key.slice(0, 7).split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10); };
const daysInMonth = (key) => { const [y, m] = key.slice(0, 7).split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const monthName = (key) => new Intl.DateTimeFormat(AR, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(keyToDate(monthStart(key)));
const monthShort = (key) => new Intl.DateTimeFormat(AR, { month: 'long', timeZone: 'UTC' }).format(keyToDate(monthStart(key)));
const daysUntil = (key) => Math.round((keyToDate(key) - keyToDate(todayKey())) / 86400000);
// work of a month is paid in the NEXT month, on the payday chosen in the settings (31 = last day of the month)
function paydayOf(monthKey, staff) {
  const cfg = Number((staff && staff.payday_override) || CTX.S.payday_day || 1);
  const next = addMonths(monthKey, 1);
  return next.slice(0, 8) + pad2(Math.min(cfg, daysInMonth(next)));
}

/* ---- permissions (the database enforces them too; this only hides what you cannot use) ---- */
const DEFAULT_PERMS = {
  hr: ['employees.view', 'employees.edit', 'attendance.view', 'attendance.edit', 'leaves.decide', 'log.view'],
  accountant: ['employees.view', 'attendance.view', 'advances.decide', 'payroll.view', 'payroll.edit'],
  manager: ['employees.view', 'attendance.view', 'leaves.decide'],
};
const PERMS = [
  ['employees.view', 'عرض الموظفين'], ['employees.edit', 'إضافة وتعديل الموظفين'], ['attendance.view', 'عرض الحضور'],
  ['attendance.edit', 'تعديل الحضور واعتماده'], ['leaves.decide', 'الموافقة على الإجازات'], ['advances.decide', 'الموافقة على السلف'],
  ['payroll.view', 'عرض المرتبات'], ['payroll.edit', 'مكافآت وخصومات وقفل الشهر'], ['payroll.reopen', 'إعادة فتح شهر مقفول'],
  ['settings.edit', 'تعديل الإعدادات'], ['roles.manage', 'إدارة الأدوار والصلاحيات'], ['log.view', 'سجل النشاط'],
];
function can(p) {
  const r = CTX.me && CTX.me.role;
  if (!r || r === 'employee') return false;
  if (r === 'super_admin') return true;
  return ((CTX.S.role_permissions || DEFAULT_PERMS)[r] || []).includes(p);
}

function errText(msg) {
  const m = String(msg || '');
  if (m.startsWith('advance_too_high:')) return 'أقصى مبلغ سلفة ليك ' + m.split(':')[1] + ' ج.م.';
  if (m.startsWith('pending_reviews:')) return 'فيه ' + m.split(':')[1] + ' يوم انصراف تلقائي لسه محتاج مراجعة في الحضور.';
  if (m.startsWith('pending_leaves:')) return 'فيه ' + m.split(':')[1] + ' طلب إجازة لسه ماتقررش فيه.';
  if (m.startsWith('outside_area:')) return 'أنت بعيد عن مكان الشغل (حوالي ' + m.split(':')[1] + ' متر). لازم تكون جوه النطاق.';
  const map = {
    weak_gps: 'إشارة الموقع ضعيفة. اطلع لمكان مفتوح وجرّب تاني.',
    no_gps: 'مقدرناش نحدد موقعك. فعّل الموقع وجرّب تاني.',
    gps_denied: 'فعّل الموقع للتطبيق من إعدادات المتصفح وجرّب تاني.',
    location_not_set: 'الإدارة لسه ما حددتش موقع الشغل.',
    already_today: 'انت سجّلت حضورك النهارده بالفعل.',
    already_in: 'انت مسجّل حضور بالفعل. سجّل انصرافك الأول.',
    not_in: 'مفيش حضور مفتوح تسجّل له انصراف.',
    not_allowed: 'مش مسموحلك بالعملية دي.',
    reason_required: 'اكتب سبب التعديل.',
    bad_code: 'الكود لازم يبقى حروف إنجليزي أو أرقام (من 2 لـ 20).',
    bad_pin: 'الـ PIN لازم يبقى 6 أرقام.',
    name_required: 'اكتب اسم الموظف.',
    only_super_admin_creates_admins: 'المدير العام بس يقدر يضيف إدارة.',
    'Invalid login credentials': 'الكود أو الـ PIN غلط.',
    month_locked: 'الشهر ده مقفول. لازم تعيد فتحه الأول.',
    not_pending: 'الطلب ده اتقرر فيه قبل كده.',
    leave_overlap: 'عندك إجازة تانية في نفس الأيام.',
    bad_dates: 'التواريخ مش مظبوطة.',
    advance_pending: 'عندك طلب سلفة لسه ماتردش عليه.',
    bad_amount: 'اكتب مبلغ صحيح.',
    bad_installments: 'عدد الأقساط مش مسموح.',
    month_not_ended: 'الشهر لسه ما خلصش.',
    not_locked: 'الشهر مش مقفول.',
    last_super_admin: 'لازم يفضل مدير عام واحد على الأقل.',
    only_super_admin_can_change_roles: 'مش مسموحلك تغيّر الأدوار.',
    bad_role: 'الدور مش صحيح.',
    bad_kind: 'النوع مش صحيح.',
    no_attendance: 'مفيش حضور مسجّل في اليوم ده.',
    has_attendance: 'الموظف ليه حضور في اليوم ده، فمش غياب.',
    on_leave: 'اليوم ده إجازة معتمدة أصلًا.',
  };
  if (map[m]) return map[m];
  if (/already been registered|already exists|duplicate/i.test(m)) return 'الكود ده مستخدم قبل كده.';
  return m || 'حصلت مشكلة. جرّب تاني.';
}

async function loadSettingsMap() {
  const { data, error } = await sb.from('settings').select('key,value,effective_from,id')
    .order('effective_from', { ascending: true }).order('id', { ascending: true });
  if (error) throw error;
  const t = todayKey();
  const m = {};
  (data || []).forEach((r) => { if (r.effective_from <= t) m[r.key] = r.value; });
  return m;
}

// every change is a new row with an effective date (the old value stays in the history)
async function saveSettings(obj, from) {
  const rows = Object.entries(obj).map(([key, value]) => ({ key, value, effective_from: from || todayKey(), changed_by: CTX.me.id }));
  const { error } = await sb.from('settings').insert(rows);
  if (error) throw error;
}

async function callAdmin(body) {
  const { data, error } = await sb.functions.invoke('admin-users', { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e) { /* keep message */ }
    throw new Error(msg);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}

function getPos() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('no_gps'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
      (e) => reject(new Error(e.code === 1 ? 'gps_denied' : 'no_gps')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

/* ================= small UI parts ================= */
const Tile = ({ icon, tone = 'sand', sm }) => html`<div class=${'tile tone-' + tone + (sm ? ' sm' : '')}><${Icon} name=${icon} size=${sm ? 20 : 22} /></div>`;
const Pill = ({ tone = 'sand', icon, children }) => html`<span class=${'pill tone-' + tone}>${icon && html`<${Icon} name=${icon} size=${15} />`}${children}</span>`;
const Chev = () => html`<span style="color:var(--faint);display:flex"><${Icon} name="chev" size=${20} /></span>`;
const Toggle = ({ on, onChange }) => html`<button type="button" role="switch" aria-checked=${on} class=${'toggle' + (on ? ' on' : '')} onClick=${() => onChange(!on)}></button>`;

function Stepper({ value, onChange, min = 0, max = 999, step = 1, unit = '' }) {
  return html`<div class="stepper">
    <button type="button" aria-label="زيادة" onClick=${() => onChange(Math.min(max, +(value + step).toFixed(2)))}><${Icon} name="plus" size=${20} /></button>
    <div class="v num">${value}${unit}</div>
    <button type="button" aria-label="نقصان" onClick=${() => onChange(Math.max(min, +(value - step).toFixed(2)))}><${Icon} name="minus" size=${20} /></button>
  </div>`;
}

function Bell({ count }) {
  return html`<a class="iconbtn" href="#notifications" aria-label="الإشعارات"><${Icon} name="bell" size=${22} />${count > 0 && html`<span class="dotbadge"></span>`}</a>`;
}

function Hero({ title, sub, back, bell, slim }) {
  return html`<div class=${'hero' + (slim ? ' slim' : '')}>
    <div class="hero-top">
      ${back
        ? html`<div class="row"><a class="iconbtn" href=${'#' + back} onClick=${(e) => { e.preventDefault(); goBack(back); }} aria-label="رجوع"><${Icon} name="back" size=${22} /></a><div class="hero-title inline">${title}</div></div>`
        : html`<img class="hero-logo" src="captain-logo.png" alt="الكابتن" />`}
      <div class="row">${bell}</div>
    </div>
    ${!back && title && html`<div class="hero-title">${title}</div>`}
    ${sub && html`<div class="hero-sub">${sub}</div>`}
  </div>`;
}

function Sheet({ title, onClose, children }) {
  return html`<div class="sheet-back" onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class="sheet">
      <div class="spread"><div class="h2">${title}</div>
        <button class="iconbtn light" onClick=${onClose} aria-label="إغلاق"><${Icon} name="close" size=${20} /></button></div>
      ${children}
    </div>
  </div>`;
}

function Nav({ items, tab }) {
  return html`<nav class="nav">${items.map((it) => html`<a href=${'#' + it.id} class=${tab === it.id ? 'on' : ''}>
    <span class="pillnav"><${Icon} name=${it.icon} size=${24} />${it.badge > 0 && html`<span class="cnt">${it.badge}</span>`}</span><span>${it.label}</span></a>`)}</nav>`;
}

const Soon = ({ title, text }) => html`<div class="page">
  <${Hero} title=${title} slim />
  <div class="body flat"><div class="card"><div class="empty"><${Icon} name="clock" size=${24} /> <span>${text || 'ده جاي في التحديث الجاي.'}</span></div></div></div>
</div>`;

/* ================= login ================= */
function Login() {
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [usePw, setUsePw] = useState(false);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(secret) {
    const c = code.trim().toLowerCase();
    if (!c) { setErr('اكتب كود الموظف.'); setPin(''); return; }
    setBusy(true);
    setErr('');
    const { error } = await sb.auth.signInWithPassword({ email: c + '@' + DOMAIN, password: secret });
    setBusy(false);
    if (error) { setErr(errText(error.message)); setPin(''); }
  }

  useEffect(() => {
    if (pin.length === 6 && !usePw) submit(pin);
  }, [pin]);

  const press = (d) => { if (!busy && pin.length < 6) setPin(pin + d); };

  return html`<div class="login">
    <img class="login-cover" src="captain-cover.jpg" alt="الكابتن" />
    <div class="login-sheet">
      <div><h1 class="hero-title inline" style="color:var(--ink);font-size:26px">أهلاً بيك في الكابتن</h1><div class="soft" style="font-size:14px">سجّل دخولك عشان تبدأ يومك</div></div>
      <label class="field">كود الموظف
        <input class="input num-in" value=${code} inputmode="text" autocapitalize="none" autocomplete="username" placeholder="مثال: 014"
          onInput=${(e) => setCode(e.target.value)} />
      </label>
      ${usePw
        ? html`<label class="field">كلمة السر
            <input class="input" type="password" value=${pw} autocomplete="current-password" onInput=${(e) => setPw(e.target.value)} />
          </label>
          <button class="btn" disabled=${busy || !pw} onClick=${() => submit(pw)}>${busy ? 'لحظة...' : 'دخول'}</button>`
        : html`<div class="field" style="align-items:center">رقم الـ PIN
            <div class="dots">${[0, 1, 2, 3, 4, 5].map((i) => html`<span class=${i < pin.length ? 'f' : ''}></span>`)}</div></div>
          <div class="pad">
            ${'123456789'.split('').map((d) => html`<button type="button" onClick=${() => press(d)}>${d}</button>`)}
            <span></span>
            <button type="button" onClick=${() => press('0')}>0</button>
            <button type="button" class="ghostkey" aria-label="مسح" onClick=${() => setPin(pin.slice(0, -1))}><${Icon} name="backspace" size=${26} /></button>
          </div>
          <button class="btn" disabled=${busy || pin.length !== 6 || !code.trim()} onClick=${() => submit(pin)}>${busy ? 'جاري الدخول...' : 'دخول'}</button>`}
      ${err && html`<div class="note bad">${err}</div>`}
      <button class="linkbtn" style="align-self:center" onClick=${() => { setUsePw(!usePw); setErr(''); setPin(''); }}>${usePw ? 'الدخول بالـ PIN' : 'الدخول بكلمة سر (للإدارة)'}</button>
    </div>
  </div>`;
}

/* ================= employee screens ================= */
const hm12 = (mins) => {
  const m = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return pad2(h % 12 || 12) + ':' + pad2(m % 60) + ' ' + (h >= 12 ? 'م' : 'ص');
};
const shiftRange = (sh) => (sh ? hm12(shiftStartMin(sh)) + ' — ' + hm12(shiftStartMin(sh) + Math.round(Number(sh.hours) * 60)) : '');

function EmpHome({ unread }) {
  const { me, S, shift } = CTX;
  const [last, setLast] = useState(undefined);
  const [month, setMonth] = useState([]);
  const [pos, setPos] = useState(null);
  const [gpsErr, setGpsErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [pay, setPay] = useState(null);

  async function load() {
    const first = todayKey().slice(0, 8) + '01';
    const [a, b] = await Promise.all([
      sb.from('attendance').select('*').eq('staff_id', me.id).order('check_in', { ascending: false }).limit(1),
      sb.from('attendance').select('*').eq('staff_id', me.id).gte('work_date', first),
    ]);
    setLast(a.data && a.data[0] ? a.data[0] : null);
    setMonth(b.data || []);
    const pr = await sb.rpc('my_payroll', { p_month: monthStart(todayKey()) });
    if (!pr.error) setPay(pr.data);
  }
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!navigator.geolocation) { setGpsErr('الموقع مش مدعوم على الجهاز ده.'); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => { setGpsErr(''); setPos({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }); },
      (e) => setGpsErr(e.code === 1 ? 'فعّل الموقع للتطبيق من إعدادات المتصفح.' : 'مقدرناش نحدد موقعك.'),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  const open = last && !last.check_out ? last : null;
  const doneToday = last && last.check_out && last.work_date === todayKey();
  const clat = S.company_lat, clon = S.company_lon;
  const radius = Number(S.radius_m ?? 100);
  const dist = pos && clat != null && clon != null ? distM(pos.lat, pos.lon, Number(clat), Number(clon)) : null;
  const inside = dist != null && dist <= radius;
  const grace = Number(S.grace_minutes ?? 30);

  let zone;
  if (me.any_location) zone = { tone: 'green', icon: 'pin', text: 'مسموحلك تسجّل من أي مكان' };
  else if (clat == null || clon == null) zone = { tone: 'amber', icon: 'pin', text: 'الإدارة لسه ما حددتش موقع الشغل' };
  else if (gpsErr) zone = { tone: 'amber', icon: 'pin', text: gpsErr };
  else if (!pos) zone = { tone: 'sand', icon: 'pin', text: 'بنحدد موقعك...' };
  else if (inside) zone = { tone: 'green', icon: 'pin', text: 'أنت داخل نطاق الشغل', extra: 'دقة الموقع ' + Math.round(pos.acc) + ' متر' };
  else zone = { tone: 'red', icon: 'pin', text: 'أنت بعيد عن الشغل حوالي ' + Math.round(dist) + ' متر' };

  async function act(kind) {
    setBusy(true);
    try {
      let p = null;
      try { p = await getPos(); } catch (e) { if (!me.any_location) throw e; }
      const { error } = await sb.rpc(kind, { p_lat: p ? p.lat : null, p_lon: p ? p.lon : null, p_accuracy: p ? p.acc : null });
      if (error) throw new Error(error.message);
      toast(kind === 'check_in' ? 'اتسجّل حضورك. يومك سعيد' : 'اتسجّل انصرافك. تسلم إيدك');
      await load();
    } catch (e) { toast(errText(e.message), 'bad'); }
    setBusy(false);
  }

  const lateDays = month.filter((a) => lateMin(a, shift) > grace).length;
  const hoursSum = month.reduce((s, a) => s + paidHours(a, shift), 0);
  const donePaid = last && last.check_out ? paidParts(last, shift) : null;
  const elapsed = open ? now - new Date(open.check_in).getTime() : 0;
  const shiftMs = shift ? Number(shift.hours) * 3600000 : 0;
  const showDue = !!(open && shift && S.auto_close_enabled !== false);
  const shiftEndLabel = shift ? hm12(shiftStartMin(shift) + Math.round(Number(shift.hours) * 60)) : '';
  const cutLabel = hm12(Number(S.auto_close_hour ?? 2) * 60);

  return html`<div class="page">
    <${Hero} title=${greet() + ' يا ' + firstName(me.full_name)} sub=${fmtDay(new Date())} bell=${html`<${Bell} count=${unread} />`} />
    <div class="body">
      ${last === undefined ? html`<div class="card"><div class="empty">لحظة...</div></div>` : open ? html`
        <div class="card">
          <div class="spread"><${Pill} tone="green" icon="check">حاضر منذ ${fmtTime(open.check_in)}<//>
            ${open.in_zone === false ? html`<${Pill} tone="amber" icon="pin">خارج النطاق<//>` : html`<${Pill} tone="sand" icon="pin">داخل النطاق<//>`}</div>
          <div><div class="soft" style="text-align:center">مدة حضورك اليوم</div><div class="timer num">${clock(elapsed)}</div></div>
          ${shift && html`<div><div class="progress"><div style=${'width:' + Math.min(100, (elapsed / shiftMs) * 100) + '%'}></div></div>
            <div class="spread soft" style="margin-top:6px"><span>حضور ${fmtTime(open.check_in)}</span><span>${Number(shift.hours)} ساعات</span></div></div>`}
          <div class="row" style="background:var(--sand);border-radius:16px;padding:12px">
            <${Tile} icon="clock" tone="dark" sm />
            <div class="grow"><div style="font-weight:600;font-size:14px">${paidHours(open, shift)} ساعة اتحسبت لحد دلوقتي</div>
              <div class="soft">${shift ? 'شفتك بيخلص الساعة ' + shiftEndLabel + '، وبعده بتتحسب إضافي' : ''}</div></div>
          </div>
          <button class="btn dark bigbtn" disabled=${busy} onClick=${() => act('check_out')}><${Icon} name="out" size=${24} /> ${busy ? 'لحظة...' : 'سجّل انصرافك'}</button>
        </div>
        ${showDue && html`<div class="note warn"><b>لو نسيت تسجّل الانصراف</b><br />تقدر تسجّله لحد الساعة ${cutLabel}. بعد كده يتقفل يومك على نهاية شفتك (${shiftEndLabel}) من غير إضافي.</div>`}
      ` : doneToday ? html`
        <div class="card">
          <div class="row"><${Tile} icon="check" tone="green" /><div class="grow"><div class="h2">خلّصت يومك</div>
            <div class="soft">حضور ${fmtTime(last.check_in)} · انصراف ${fmtTime(last.check_out)}</div></div></div>
          <div class="note ok">${donePaid ? (donePaid.reg + donePaid.ot) + ' ساعة اتحسبت النهارده' + (donePaid.ot > 0 ? ' (منها ' + donePaid.ot + ' إضافي)' : '') : ''}. تسلم إيدك.</div>
          ${last.closed_by === 'auto' && html`<div class="note warn">انصرافك اتسجّل تلقائيًا على نهاية شفتك لأنك نسيت تسجّله.</div>`}
        </div>` : html`
        <div class="card">
          <div class="row"><${Tile} icon="clock" />
            <div class="grow"><div class="soft">شفتك النهارده</div>
              <div class="h2 num">${shift ? shiftRange(shift) : 'لسه ما اتحددش'}</div></div>
            ${shift && html`<${Pill}>${Number(shift.hours)} ساعات<//>`}</div>
          <div class=${'row note ' + (zone.tone === 'green' ? 'ok' : zone.tone === 'red' ? 'bad' : zone.tone === 'amber' ? 'warn' : 'info')}>
            <${Icon} name=${zone.icon} size=${20} /><div class="grow" style="font-weight:500">${zone.text}</div>${zone.extra && html`<span style="font-size:13px">${zone.extra}</span>`}</div>
          <button class="btn bigbtn" disabled=${busy} onClick=${() => act('check_in')}><${Icon} name="check" size=${24} /> ${busy ? 'لحظة...' : 'سجّل حضورك'}</button>
        </div>`}

      <div class="spread" style="margin-top:4px"><div class="h2">هذا الشهر</div><span class="soft">${new Intl.DateTimeFormat(AR, { month: 'long', timeZone: tzOf() }).format(new Date())}</span></div>
      <div class="stats">
        <div class="stat"><span class="tile sm tone-green"><${Icon} name="check" size=${20} /></span><span class="big num">${month.length}</span><span class="soft">أيام حضور</span></div>
        <div class="stat"><span class="tile sm tone-amber"><${Icon} name="clock" size=${20} /></span><span class="big num">${lateDays}</span><span class="soft">تأخير</span></div>
        <div class="stat"><span class="tile sm tone-slate"><${Icon} name="auto" size=${20} /></span><span class="big num">${hoursSum}</span><span class="soft">ساعات شغل</span></div>
      </div>
      ${pay && pay.calc && html`<a class="card" href="#salary" style="gap:8px">
        <div class="row"><${Tile} icon="wallet" tone="red" /><div class="grow"><div class="soft">رصيدك لحد دلوقتي</div>
          <div class="num" style="font-family:var(--hf);font-weight:600;font-size:30px;line-height:1.25">${fmtMoney(pay.calc.net)} <span class="soft" style="font-size:14px">ج.م</span></div></div><${Chev} /></div>
        <div class="spread soft"><span>سعر الساعة ${fmtMoney(pay.calc.hour_rate)} ج.م</span><span>القبض ${fmtShort(keyToDate(paydayOf(monthStart(todayKey()), me)))}</span></div></a>`}
    </div>
  </div>`;
}

function EmpHistory() {
  const { me, shift, S } = CTX;
  const [rows, setRows] = useState(null);
  const [exs, setExs] = useState([]);
  useEffect(() => {
    sb.from('attendance').select('*').eq('staff_id', me.id).order('work_date', { ascending: false }).limit(60)
      .then(({ data }) => setRows(data || []));
    sb.from('day_excuses').select('*').eq('staff_id', me.id).eq('voided', false).order('work_date', { ascending: false }).limit(60)
      .then(({ data }) => setExs(data || []));
  }, []);
  const grace = Number(S.grace_minutes ?? 30);
  return html`<div class="page">
    <${Hero} title="سجل الحضور" sub="آخر 60 يوم" slim />
    <div class="body flat">
      ${exs.filter((e) => e.kind === 'absence').length > 0 && html`<div class="card tight"><div class="h2" style="padding:12px 0 4px">أيام اتلغى غيابها</div>
        ${exs.filter((e) => e.kind === 'absence').map((e) => html`<div class="list-row"><${Tile} icon="check" tone="green" sm /><div class="grow"><div style="font-weight:600">${fmtShort(keyToDate(e.work_date))}</div><div class="soft">${e.reason}</div></div>
          <${Pill} tone=${e.mode === 'paid' ? 'green' : 'sand'}>${e.mode === 'paid' ? 'بأجر' : 'بدون أجر'}<//></div>`)}</div>`}
      <div class="card tight">
        ${rows === null ? html`<div class="empty">لحظة...</div>` : rows.length === 0 ? html`<div class="empty">لسه مفيش سجل حضور.</div>` : rows.map((a) => html`
          <div class="list-row">
            <div class="grow"><div style="font-weight:600">${fmtShort(keyToDate(a.work_date))}</div>
              <div class="soft num">${fmtTime(a.check_in)} — ${a.check_out ? fmtTime(a.check_out) : 'لسه شغال'}</div></div>
            <div class="stack" style="align-items:flex-end;gap:4px">
              <${Pill} tone=${lateMin(a, shift) > grace && !exs.some((e) => e.kind === 'late' && e.work_date === a.work_date) ? 'amber' : 'green'}>${paidHours(a, shift)} ساعة<//>
              ${exs.some((e) => e.kind === 'late' && e.work_date === a.work_date) && html`<span class="soft">التأخير اتلغى</span>`}
              ${a.closed_by === 'auto' && html`<span class="soft">انصراف تلقائي</span>`}
              ${a.edited && html`<span class="soft">معدّل من الإدارة</span>`}
            </div>
          </div>`)}
      </div>
    </div>
  </div>`;
}

function PinChange() {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!/^\d{6}$/.test(a)) return toast('الـ PIN لازم يبقى 6 أرقام.', 'bad');
    if (a !== b) return toast('الرقمين مش متطابقين.', 'bad');
    setBusy(true);
    const { error } = await sb.auth.updateUser({ password: a });
    setBusy(false);
    if (error) return toast(errText(error.message), 'bad');
    setA(''); setB('');
    toast('اتغيّر الـ PIN');
  }
  return html`<div class="card">
    <div class="h3">غيّر الـ PIN</div>
    <label class="field">PIN جديد (6 أرقام)<input class="input num-in" type="password" inputmode="numeric" maxlength="6" value=${a} onInput=${(e) => setA(e.target.value.replace(/\D/g, ''))} /></label>
    <label class="field">أكّد الـ PIN<input class="input num-in" type="password" inputmode="numeric" maxlength="6" value=${b} onInput=${(e) => setB(e.target.value.replace(/\D/g, ''))} /></label>
    <button class="btn dark small" disabled=${busy || a.length !== 6} onClick=${save}>حفظ الـ PIN</button>
  </div>`;
}

function Profile() {
  const { me } = CTX;
  return html`<div class="page">
    <${Hero} title="حسابي" slim />
    <div class="body flat">
      <div class="card">
        <div class="row"><div class="avatar tone-sand">${initial(me.full_name)}</div>
          <div class="grow"><div class="h2">${me.full_name}</div><div class="soft">كود ${me.code}${me.department ? ' · ' + me.department : ''}</div></div></div>
      </div>
      <${PinChange} />
      <button class="btn ghost" onClick=${() => sb.auth.signOut()}><${Icon} name="logout" size=${20} /> تسجيل الخروج</button>
    </div>
  </div>`;
}

const REQ_STATUS = {
  pending: ['amber', 'بانتظار الرد'],
  approved: ['green', 'اتقبل'],
  rejected: ['red', 'اترفض'],
  cancelled: ['sand', 'اتلغى'],
};

function MonthChips({ month, setMonth, count = 4 }) {
  const cur = monthStart(todayKey());
  const list = Array.from({ length: count }, (_, i) => addMonths(cur, -i));
  return html`<div class="chips">${list.map((m) => html`<button class=${'chip' + (m === month ? ' on' : '')} onClick=${() => setMonth(m)}>${monthShort(m)}</button>`)}</div>`;
}

function PayRow({ icon, tone, label, hint, amount, kind }) {
  return html`<div class="list-row"><${Tile} icon=${icon} tone=${tone} sm />
    <div class="grow"><div style="font-weight:500">${label}</div><div class="soft">${hint}</div></div>
    <div class=${'amt ' + (kind || '')}>${amount}</div></div>`;
}

function PayBreakdown({ c }) {
  const rate = Number(c.hour_rate);
  const otRate = (rate * Number(c.ot_pct)) / 100;
  return html`<div class="card tight">
    <${PayRow} icon="clock" tone="sand" label="ساعات الشغل" hint=${c.hours_regular + ' ساعة كاملة × ' + fmtMoney(rate) + (Number(c.late_excused) > 0 ? ' · ' + c.late_excused + ' تأخير اتلغى' : '')} amount=${fmtMoney(c.amount_regular)} />
    ${Number(c.excused_paid_days) > 0 && html`<${PayRow} icon="check" tone="green" label="أيام اتلغى غيابها" hint=${c.excused_paid_days + ' يوم بأجر'} amount=${'+' + fmtMoney(c.amount_excused)} kind="pos" />`}
    ${(Number(c.paid_leave_days) > 0 || Number(c.unpaid_leave_days) > 0) && html`<${PayRow} icon="sun" tone="slate" label="إجازة مدفوعة"
      hint=${c.paid_leave_days + ' يوم من ' + c.paid_leave_allowance + (Number(c.unpaid_leave_days) > 0 ? ' · ' + c.unpaid_leave_days + ' يوم من غير أجر' : '')} amount=${'+' + fmtMoney(c.amount_leave)} kind="pos" />`}
    ${Number(c.hours_overtime) > 0 && html`<${PayRow} icon="auto" tone="amber" label="ساعات إضافية" hint=${c.hours_overtime + ' ساعة × ' + fmtMoney(otRate) + ' (' + c.ot_pct + '٪)'} amount=${'+' + fmtMoney(c.amount_overtime)} kind="pos" />`}
    ${Number(c.bonus) > 0 && html`<${PayRow} icon="gift" tone="green" label="مكافآت" hint="من الإدارة" amount=${'+' + fmtMoney(c.bonus)} kind="pos" />`}
    ${Number(c.advances) > 0 && html`<${PayRow} icon="down" tone="slate" label="قسط سلفة" hint="بيتخصم من المرتب" amount=${'−' + fmtMoney(c.advances)} kind="neg" />`}
    ${Number(c.deductions) > 0 && html`<${PayRow} icon="minus" tone="red" label="خصومات" hint="من الإدارة" amount=${'−' + fmtMoney(c.deductions)} kind="neg" />`}
    ${Number(c.late_deduction) > 0 && html`<${PayRow} icon="clock" tone="red" label="خصم تأخير" hint=${c.late_days + ' يوم تأخير'} amount=${'−' + fmtMoney(c.late_deduction)} kind="neg" />`}
    ${Number(c.absence_penalty) > 0 && html`<${PayRow} icon="minus" tone="red" label="غرامة غياب بدون إذن" hint=${c.absent_penalized + ' يوم غياب بدون إذن'} amount=${'−' + fmtMoney(c.absence_penalty)} kind="neg" />`}
    <div class="spread" style="padding:14px 0 8px"><div class="h2">الصافي</div><div class="amt" style="font-size:22px">${fmtMoney(c.net)} ج.م</div></div>
  </div>`;
}

function EmpSalary() {
  const { me } = CTX;
  const [month, setMonth] = useState(monthStart(todayKey()));
  const [res, setRes] = useState(null);
  const [prev, setPrev] = useState(null);
  const [advs, setAdvs] = useState([]);
  const [adjs, setAdjs] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const cur = monthStart(todayKey());
  async function load() {
    const [a, b, c, d] = await Promise.all([
      sb.rpc('my_payroll', { p_month: month }),
      sb.from('pay_adjustments').select('*').eq('staff_id', me.id).eq('voided', false).gte('effective_date', month).lt('effective_date', addMonths(month, 1)).order('effective_date', { ascending: false }),
      sb.from('advances').select('*').eq('staff_id', me.id).order('created_at', { ascending: false }).limit(8),
      sb.from('leaves').select('*').eq('staff_id', me.id).order('from_date', { ascending: false }).limit(8),
    ]);
    if (a.error) toast(errText(a.error.message), 'bad'); else setRes(a.data);
    setAdjs(b.data || []); setAdvs(c.data || []); setLeaves(d.data || []);
    if (month === cur) { const p = await sb.rpc('my_payroll', { p_month: addMonths(cur, -1) }); setPrev(p.error ? null : p.data); } else setPrev(null);
  }
  useEffect(() => { setRes(null); load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [month]);
  const c = res && res.calc;
  const pd = paydayOf(month, me);
  const left = daysUntil(pd);
  const isCur = month === cur;
  const prevDue = prev && prev.calc && prev.status !== 'paid' && Number(prev.calc.net) > 0;
  return html`<div class="page">
    <${Hero} title="رصيدي" sub=${monthName(month)} />
    <div class="body">
      <div class="card" style="align-items:center;text-align:center;gap:6px">
        <div class="soft">${isCur ? 'الصافي لحد دلوقتي' : 'صافي مرتب الشهر'}</div>
        <div class="num" style="font-family:var(--hf);font-weight:600;font-size:44px;line-height:1.2">${c ? fmtMoney(c.net) : '...'} <span class="soft" style="font-size:18px">ج.م</span></div>
        <div class="chips" style="justify-content:center"><${Pill} tone="sand" icon="calendar">القبض ${fmtShort(keyToDate(pd))}<//>
          ${left > 0 ? html`<${Pill} tone="green">باقي ${left} يوم<//>` : html`<${Pill} tone="green">${res && res.status === 'paid' ? 'اتصرف' : 'حان موعد القبض'}<//>`}
          ${res && res.status !== 'open' && html`<${Pill} tone="slate" icon="lock">${res.status === 'paid' ? 'اتصرف' : 'مقفول'}<//>`}</div>
      </div>
      ${prevDue && html`<a class="note warn" href="#salary" onClick=${() => setMonth(addMonths(cur, -1))}><b>مرتب ${monthShort(addMonths(cur, -1))} لسه ما اتصرفش</b><br />${fmtMoney(prev.calc.net)} ج.م · القبض ${fmtShort(keyToDate(paydayOf(addMonths(cur, -1), me)))}</a>`}
      <${MonthChips} month=${month} setMonth=${setMonth} />
      ${c ? html`<${PayBreakdown} c=${c} />` : html`<div class="card"><div class="empty">لحظة...</div></div>`}
      <div class="card tight">
        <div class="h2" style="padding:12px 0 4px">المكافآت والخصومات</div>
        ${adjs.length === 0 ? html`<div class="empty">مفيش حاجة الشهر ده.</div>` : adjs.map((a) => html`<div class="list-row"><${Tile} icon=${a.kind === 'bonus' ? 'gift' : 'minus'} tone=${a.kind === 'bonus' ? 'green' : 'red'} sm />
          <div class="grow"><div style="font-weight:500">${a.reason}</div><div class="soft">${fmtShort(keyToDate(a.effective_date))}</div></div>
          <div class=${'amt ' + (a.kind === 'bonus' ? 'pos' : 'neg')}>${(a.kind === 'bonus' ? '+' : '−') + fmtMoney(a.amount)}</div></div>`)}
      </div>
      <div class="card tight">
        <div class="h2" style="padding:12px 0 4px">سلفي</div>
        ${advs.length === 0 ? html`<div class="empty">مفيش سلف.</div>` : advs.map((a) => html`<div class="list-row"><${Tile} icon="down" tone="slate" sm />
          <div class="grow"><div style="font-weight:500">${fmtMoney(a.amount)} ج.م · ${a.installments} ${a.installments > 1 ? 'أقساط' : 'قسط'}</div>
            <div class="soft">${a.status === 'approved' && a.start_month ? 'بتتخصم من ' + monthShort(a.start_month) : a.reason || ''}</div></div>
          <${Pill} tone=${REQ_STATUS[a.status][0]}>${REQ_STATUS[a.status][1]}<//></div>`)}
      </div>
      <div class="card tight">
        <div class="h2" style="padding:12px 0 4px">إجازاتي</div>
        ${leaves.length === 0 ? html`<div class="empty">مفيش إجازات.</div>` : leaves.map((l) => html`<div class="list-row"><${Tile} icon="sun" tone="slate" sm />
          <div class="grow"><div style="font-weight:500">${fmtShort(keyToDate(l.from_date))}${l.to_date !== l.from_date ? ' ← ' + fmtShort(keyToDate(l.to_date)) : ''}</div>
            <div class="soft">${l.force_unpaid && l.status === 'approved' ? 'من غير أجر' : l.reason || ''}</div></div>
          <${Pill} tone=${REQ_STATUS[l.status][0]}>${REQ_STATUS[l.status][1]}<//></div>`)}
      </div>
    </div>
  </div>`;
}

function LeaveSheet({ onClose, onDone }) {
  const [from, setFrom] = useState(todayKey());
  const [to, setTo] = useState(todayKey());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    const { error } = await sb.rpc('request_leave', { p_from: from, p_to: to < from ? from : to, p_reason: reason });
    setBusy(false);
    if (error) return toast(errText(error.message), 'bad');
    toast('اتبعت طلب الإجازة');
    onDone();
  }
  return html`<${Sheet} title="طلب إجازة" onClose=${onClose}>
    <label class="field">من يوم<input class="input" type="date" value=${from} onInput=${(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} /></label>
    <label class="field">إلى يوم<input class="input" type="date" value=${to} min=${from} onInput=${(e) => setTo(e.target.value)} /></label>
    <label class="field">السبب (اختياري)<input class="input" value=${reason} onInput=${(e) => setReason(e.target.value)} /></label>
    <div class="note info">أول ${CTX.S.paid_leave_days ?? 2} يوم في الشهر بيتحسبوا بأجر، وباقي الأيام حسب قرار الإدارة.${Number(CTX.S.absence_penalty_days) > 0 ? ' الغياب من غير طلب إجازة، أو لو الطلب اترفض، بيتخصم عليه ' + CTX.S.absence_penalty_days + ' يوم غرامة زيادة عن اليوم الضايع.' : ''}</div>
    <button class="btn" disabled=${busy} onClick=${send}>${busy ? 'لحظة...' : 'إرسال الطلب'}</button>
  <//>`;
}

function AdvanceSheet({ onClose, onDone }) {
  const { me, S } = CTX;
  const maxAmount = Math.floor((Number(me.base_salary) * Number(S.advance_max_pct ?? 50)) / 100);
  const maxInst = Number(S.advance_max_installments ?? 3);
  const [amount, setAmount] = useState('');
  const [inst, setInst] = useState(1);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!Number(amount)) return toast('اكتب المبلغ.', 'bad');
    setBusy(true);
    const { error } = await sb.rpc('request_advance', { p_amount: Number(amount), p_installments: inst, p_reason: reason });
    setBusy(false);
    if (error) return toast(errText(error.message), 'bad');
    toast('اتبعت طلب السلفة');
    onDone();
  }
  return html`<${Sheet} title="طلب سلفة" onClose=${onClose}>
    <label class="field">المبلغ (ج.م)<input class="input num-in" inputmode="decimal" value=${amount} placeholder=${'لحد ' + maxAmount} onInput=${(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
      <span class="hint">أقصى مبلغ ليك ${maxAmount} ج.م</span></label>
    <div class="spread"><div><div class="h3">عدد الأقساط</div><div class="soft">بتتخصم من المرتب على شهور</div></div><${Stepper} value=${inst} min=${1} max=${maxInst} onChange=${setInst} /></div>
    ${Number(amount) > 0 && html`<div class="note info">القسط الشهري حوالي ${fmtMoney(Number(amount) / inst)} ج.م</div>`}
    <label class="field">السبب (اختياري)<input class="input" value=${reason} onInput=${(e) => setReason(e.target.value)} /></label>
    <button class="btn" disabled=${busy} onClick=${send}>${busy ? 'لحظة...' : 'إرسال الطلب'}</button>
  <//>`;
}

function EmpRequests() {
  const { me } = CTX;
  const [leaves, setLeaves] = useState(null);
  const [advs, setAdvs] = useState(null);
  const [sheet, setSheet] = useState(null);
  async function load() {
    const [a, b] = await Promise.all([
      sb.from('leaves').select('*').eq('staff_id', me.id).order('created_at', { ascending: false }).limit(30),
      sb.from('advances').select('*').eq('staff_id', me.id).order('created_at', { ascending: false }).limit(30),
    ]);
    setLeaves(a.data || []); setAdvs(b.data || []);
  }
  useEffect(() => { load(); }, []);
  async function cancel(kind, id) {
    if (!confirm('إلغاء الطلب؟')) return;
    const { error } = await sb.rpc('cancel_request', { p_kind: kind, p_id: id });
    if (error) return toast(errText(error.message), 'bad');
    toast('اتلغى الطلب');
    load();
  }
  const items = leaves && advs ? [...leaves.map((x) => ({ ...x, kind: 'leave' })), ...advs.map((x) => ({ ...x, kind: 'advance' }))].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)) : null;
  return html`<div class="page">
    <${Hero} title="طلباتي" sub="إجازات وسلف" />
    <div class="body">
      <div class="row">
        <button class="btn ghost grow" onClick=${() => setSheet('leave')}><${Icon} name="sun" size=${20} /> طلب إجازة</button>
        <button class="btn ghost grow" onClick=${() => setSheet('advance')}><${Icon} name="down" size=${20} /> طلب سلفة</button>
      </div>
      <div class="card tight">
        ${items === null ? html`<div class="empty">لحظة...</div>` : items.length === 0 ? html`<div class="empty">لسه ماعملتش أي طلب.</div>` : items.map((r) => html`<div class="list-row" style="align-items:flex-start;padding:12px 0">
          <${Tile} icon=${r.kind === 'leave' ? 'sun' : 'down'} tone="slate" sm />
          <div class="grow"><div style="font-weight:600">${r.kind === 'leave' ? 'إجازة' : 'سلفة ' + fmtMoney(r.amount) + ' ج.م'}</div>
            <div class="soft">${r.kind === 'leave' ? fmtShort(keyToDate(r.from_date)) + (r.to_date !== r.from_date ? ' ← ' + fmtShort(keyToDate(r.to_date)) : '') : r.installments + ' ' + (r.installments > 1 ? 'أقساط' : 'قسط')}</div>
            ${r.reason && html`<div class="soft">${r.reason}</div>`}
            ${r.decision_note && html`<div class="soft">رد الإدارة: ${r.decision_note}</div>`}</div>
          <div class="stack" style="align-items:flex-end"><${Pill} tone=${REQ_STATUS[r.status][0]}>${REQ_STATUS[r.status][1]}<//>
            ${r.status === 'pending' && html`<button class="linkbtn" onClick=${() => cancel(r.kind, r.id)}>إلغاء</button>`}</div>
        </div>`)}
      </div>
    </div>
    ${sheet === 'leave' && html`<${LeaveSheet} onClose=${() => setSheet(null)} onDone=${() => { setSheet(null); load(); }} />`}
    ${sheet === 'advance' && html`<${AdvanceSheet} onClose=${() => setSheet(null)} onDone=${() => { setSheet(null); load(); }} />`}
  </div>`;
}

const EMP_NAV = [
  { id: 'home', icon: 'home', label: 'الرئيسية' },
  { id: 'history', icon: 'calendar', label: 'الحضور' },
  { id: 'salary', icon: 'wallet', label: 'مرتبي' },
  { id: 'requests', icon: 'file', label: 'طلباتي' },
  { id: 'profile', icon: 'user', label: 'حسابي' },
];

function EmployeeShell({ route }) {
  const { me } = CTX;
  const [unread, setUnread] = useState(0);
  const tab = EMP_NAV.some((n) => n.id === route) ? route : route === 'notifications' ? 'home' : 'home';
  async function loadUnread() {
    const { data } = await sb.from('notifications').select('id,read_by').order('created_at', { ascending: false }).limit(60);
    setUnread((data || []).filter((n) => !(n.read_by || []).includes(me.id)).length);
  }
  useEffect(() => {
    loadUnread();
    const ch = sb.channel('emp-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (p) => {
        if (p.new.to_staff !== me.id) return;
        toast((p.new.title || 'إشعار') + ': ' + (p.new.body || ''));
        loadUnread();
        window.dispatchEvent(new Event('adm-refresh'));
      })
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, []);
  if (route === 'notifications') return html`<div style="height:100%"><${Notifications} home="home" onRead=${loadUnread} /></div>`;
  const view = { home: html`<${EmpHome} unread=${unread} />`, history: html`<${EmpHistory} />`, salary: html`<${EmpSalary} />`, requests: html`<${EmpRequests} />`, profile: html`<${Profile} />` }[tab];
  return html`<div style="height:100%">${view}<${Nav} items=${EMP_NAV} tab=${tab} /></div>`;
}


/* ================= admin screens ================= */
const STATUS = {
  present: { tone: 'green', label: 'حاضر' },
  late: { tone: 'amber', label: 'متأخر' },
  absent: { tone: 'red', label: 'غايب' },
  waiting: { tone: 'sand', label: 'لسه' },
  leave: { tone: 'slate', label: 'إجازة' },
  excused: { tone: 'green', label: 'اتلغى غيابه' },
};
const ROLE_LABEL = { employee: 'موظف', manager: 'مدير', hr: 'موارد بشرية', accountant: 'محاسب', super_admin: 'مدير عام' };
const randomPin = () => String(Math.floor(100000 + Math.random() * 900000));

function Denied() {
  return html`<div class="page"><${Hero} title="مش مسموح" slim /><div class="body flat"><div class="card"><div class="empty"><${Icon} name="lock" size=${24} /> <span>الدور بتاعك مالوش صلاحية الصفحة دي. اطلبها من المدير العام.</span></div></div></div></div>`;
}

function ExcuseSheet({ staffId, name, date, kind, onClose, onDone }) {
  const [mode, setMode] = useState('paid');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    const { error } = await sb.rpc('excuse_day', { p_staff: staffId, p_date: date, p_kind: kind, p_mode: kind === 'late' ? 'paid' : mode, p_reason: reason });
    setBusy(false);
    if (error) return toast(errText(error.message), 'bad');
    toast(kind === 'late' ? 'اتلغى التأخير' : 'اتلغى الغياب');
    onDone();
  }
  return html`<${Sheet} title=${(kind === 'late' ? 'إلغاء تأخير ' : 'إلغاء غياب ') + name} onClose=${onClose}>
    <div class="soft">${fmtShort(keyToDate(date))}</div>
    ${kind === 'late'
      ? html`<div class="note info">حضوره هيتحسب من بداية الشفت، ومش هيتحسب عليه تأخير ولا خصم. سجل الحضور الأصلي بيفضل زي ما هو.</div>`
      : html`<div class="chips"><button class=${'chip' + (mode === 'paid' ? ' on' : '')} onClick=${() => setMode('paid')}>يوم بأجر</button>
          <button class=${'chip' + (mode === 'unpaid' ? ' on' : '')} onClick=${() => setMode('unpaid')}>معذور بدون أجر</button></div>
        <div class="note info">${mode === 'paid' ? 'اليوم هيتحسب كأنه اشتغل الشفت كله، من غير ما يخصم من أيام الإجازة.' : 'مش هيتحسب غياب، بس مفيش أجر عن اليوم ده.'}</div>`}
    <label class="field">السبب<input class="input" placeholder=${kind === 'late' ? 'مثال: عطل في المواصلات' : 'مثال: كان في مأمورية'} value=${reason} onInput=${(e) => setReason(e.target.value)} /></label>
    <button class="btn" disabled=${busy} onClick=${go}>${busy ? 'لحظة...' : kind === 'late' ? 'إلغاء التأخير' : 'إلغاء الغياب'}</button>
  <//>`;
}

async function voidExcuseAsk(ex, done) {
  const reason = prompt('سبب التراجع؟');
  if (!reason) return;
  const { error } = await sb.rpc('void_excuse', { p_id: ex.id, p_reason: reason });
  if (error) return toast(errText(error.message), 'bad');
  toast('اتلغى الإلغاء');
  done();
}

function AdmDash({ unread }) {
  const [board, setBoard] = useState(null);
  const [need, setNeed] = useState({ leaves: [], advances: [] });
  const [ex, setEx] = useState(null);
  const [dec, setDec] = useState(null);
  async function load() {
    const none = Promise.resolve({ data: [] });
    const [b, l, a] = await Promise.all([
      can('attendance.view') ? sb.rpc('today_board') : none,
      can('leaves.decide') ? sb.from('leaves').select('*, staff(full_name, code)').eq('status', 'pending').order('created_at', { ascending: true }).limit(20) : none,
      can('advances.decide') ? sb.from('advances').select('*, staff(full_name, code)').eq('status', 'pending').order('created_at', { ascending: true }).limit(20) : none,
    ]);
    if (!b.error) setBoard(b.data || []);
    setNeed({ leaves: l.data || [], advances: a.data || [] });
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    window.addEventListener('adm-refresh', load);
    return () => { clearInterval(t); window.removeEventListener('adm-refresh', load); };
  }, []);
  async function decideNow(fn, ok) {
    const { error } = await fn();
    if (error) return toast(errText(error.message), 'bad');
    toast(ok);
    load();
  }
  const totalNeed = need.leaves.length + need.advances.length;
  const bs = 'height:38px;padding:0 12px;font-size:13px;border-radius:12px';
  const reqRow = (key, icon, tone, name, sub, actions) => html`<div class="list-row" key=${key}>
    <${Tile} icon=${icon} tone=${tone} sm />
    <div class="grow"><div style="font-weight:600">${name}</div><div class="soft">${sub}</div></div>
    ${actions}</div>`;
  const okBtn = (label, fn) => html`<button class="btn auto" style=${bs + ';box-shadow:none'} onClick=${fn}>${label}</button>`;
  const canReq = can('leaves.decide') || can('advances.decide');
  const rowSub = (r) => (r.check_in
    ? 'حضر ' + fmtTime(r.check_in) + (r.check_out ? ' · انصرف ' + fmtTime(r.check_out) : ' · لسه شغال')
    : r.status === 'leave' ? 'في إجازة' : r.status === 'absent' ? 'ماحضرش' : 'لسه');
  return html`<div class="page">
    <${Hero} title="أهلاً يا إدارة" sub=${fmtDay(new Date())} bell=${html`<${Bell} count=${unread} />`} />
    <div class="body">
      ${totalNeed > 0 && html`<div class="card tight">
        <div class="h2" style="padding:12px 0 4px">محتاج قرارك</div>
        ${need.leaves.map((l) => reqRow('l' + l.id, 'sun', 'slate', l.staff ? l.staff.full_name : '',
          'طلب إجازة · ' + fmtShort(keyToDate(l.from_date)) + (l.to_date !== l.from_date ? ' ← ' + fmtShort(keyToDate(l.to_date)) : ''),
          html`<button class="btn ghost auto" style=${bs} onClick=${() => setDec({ kind: 'leave', item: l })}>رفض</button>
            ${okBtn('قبول', () => decideNow(() => sb.rpc('decide_leave', { p_id: l.id, p_approve: true, p_note: '', p_force_unpaid: false }), 'اتقبلت الإجازة'))}`))}
        ${need.advances.map((x) => reqRow('a' + x.id, 'down', 'amber', x.staff ? x.staff.full_name : '',
          'سلفة ' + fmtMoney(x.amount) + ' ج.م على ' + x.installments + (x.installments > 1 ? ' أقساط' : ' قسط'),
          html`<button class="btn ghost auto" style=${bs} onClick=${() => setDec({ kind: 'advance', item: x })}>رفض</button>
            ${okBtn('قبول', () => decideNow(() => sb.rpc('decide_advance', { p_id: x.id, p_approve: true, p_note: '', p_installments: x.installments, p_start: monthStart(todayKey()) }), 'اتقبلت السلفة'))}`))}
      </div>`}
      ${can('attendance.view') && html`<div class="card tight">
        <div class="h2" style="padding:12px 0 4px">الموظفين</div>
        ${board === null ? html`<div class="empty">لحظة...</div>` : board.length === 0 ? html`<div class="empty">لسه مفيش موظفين. ضيف أول موظف من الزرار اللي تحت.</div>` : board.map((r) => html`
          <div class="list-row">
            <a class="row grow" href=${'#employee/' + r.staff_id}>
              <div class=${'avatar tone-' + STATUS[r.status].tone}>${initial(r.full_name)}</div>
              <div class="grow"><div style="font-weight:600">${r.full_name}</div>
                <div class="soft num">${rowSub(r)}</div></div>
              <${Pill} tone=${STATUS[r.status].tone}>${STATUS[r.status].label}<//>
            </a>
            ${(r.status === 'late' || r.status === 'absent') && can('attendance.edit') && html`<button class="btn ghost auto" style="height:38px;padding:0 12px;font-size:13px;border-radius:12px" onClick=${() => setEx({ staffId: r.staff_id, name: r.full_name, kind: r.status === 'late' ? 'late' : 'absence' })}>إلغاء</button>`}
          </div>`)}
      </div>`}
      ${can('employees.edit') && html`<a class="btn ghost" href="#add"><${Icon} name="plus" size=${22} /> إضافة موظف</a>`}
      ${(canReq || can('attendance.view')) && html`<div class="card tight">
        ${canReq && html`<a class="list-row" href="#requests"><${Tile} icon="file" tone="slate" sm /><div class="grow" style="font-weight:500">كل الطلبات</div><${Chev} /></a>`}
        ${can('attendance.view') && html`<a class="list-row" href="#att"><${Tile} icon="calendar" tone="sand" sm /><div class="grow" style="font-weight:500">حضور الأيام اللي فاتت</div><${Chev} /></a>`}
      </div>`}
    </div>
    ${ex && html`<${ExcuseSheet} ...${ex} date=${todayKey()} onClose=${() => setEx(null)} onDone=${() => { setEx(null); load(); }} />`}
    ${dec && html`<${DecideSheet} kind=${dec.kind} item=${dec.item} approve=${false} onClose=${() => setDec(null)} onDone=${() => { setDec(null); load(); }} />`}
  </div>`;
}

/* ---------- requests (leaves + advances) ---------- */
function DecideSheet({ kind, item, approve, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [unpaid, setUnpaid] = useState(false);
  const [inst, setInst] = useState(item.installments || 1);
  const cur = monthStart(todayKey());
  const [start, setStart] = useState(cur);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    const { error } = kind === 'leave'
      ? await sb.rpc('decide_leave', { p_id: item.id, p_approve: approve, p_note: note, p_force_unpaid: unpaid })
      : await sb.rpc('decide_advance', { p_id: item.id, p_approve: approve, p_note: note, p_installments: inst, p_start: start });
    setBusy(false);
    if (error) return toast(errText(error.message), 'bad');
    toast(approve ? 'اتقبل الطلب' : 'اترفض الطلب');
    onDone();
  }
  const who = item.staff ? item.staff.full_name : '';
  return html`<${Sheet} title=${(approve ? 'قبول' : 'رفض') + (kind === 'leave' ? ' إجازة ' : ' سلفة ') + who} onClose=${onClose}>
    ${kind === 'leave' && approve && html`<div class="row"><div class="grow"><div class="h3">من غير أجر</div><div class="soft">مش هيتحسب من الأيام المدفوعة</div></div><${Toggle} on=${unpaid} onChange=${setUnpaid} /></div>`}
    ${kind === 'leave' && !approve && Number(CTX.S.absence_penalty_days) > 0 && html`<div class="note warn">رفض الإجازة معناه إن اليوم يتحسب غياب بدون إذن، وبيتخصم عليه ${CTX.S.absence_penalty_days} يوم غرامة زيادة عن اليوم الضايع.</div>`}
    ${kind === 'advance' && approve && html`
      <div class="spread"><div><div class="h3">عدد الأقساط</div><div class="soft">القسط ${fmtMoney(Number(item.amount) / inst)} ج.م</div></div><${Stepper} value=${inst} min=${1} max=${24} onChange=${setInst} /></div>
      <div><div class="h3" style="margin-bottom:8px">يبدأ الخصم من مرتب</div><div class="chips">
        <button class=${'chip' + (start === cur ? ' on' : '')} onClick=${() => setStart(cur)}>${monthShort(cur)}</button>
        <button class=${'chip' + (start === addMonths(cur, 1) ? ' on' : '')} onClick=${() => setStart(addMonths(cur, 1))}>${monthShort(addMonths(cur, 1))}</button></div></div>`}
    <label class="field">ملاحظة للموظف (اختياري)<input class="input" value=${note} onInput=${(e) => setNote(e.target.value)} /></label>
    <button class=${'btn' + (approve ? '' : ' dark')} disabled=${busy} onClick=${go}>${busy ? 'لحظة...' : approve ? 'تأكيد القبول' : 'تأكيد الرفض'}</button>
  <//>`;
}

function AdmRequests({ tabInit }) {
  const [tab, setTab] = useState(tabInit === 'advances' ? 'advances' : 'leaves');
  const [rows, setRows] = useState(null);
  const [dec, setDec] = useState(null);
  async function load() {
    const { data } = await sb.from(tab).select('*, staff(full_name, code)').order('created_at', { ascending: false }).limit(60);
    setRows((data || []).sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1)));
  }
  useEffect(() => { setRows(null); load(); window.addEventListener('adm-refresh', load); return () => window.removeEventListener('adm-refresh', load); }, [tab]);
  const kind = tab === 'leaves' ? 'leave' : 'advance';
  const allowed = can(kind === 'leave' ? 'leaves.decide' : 'advances.decide');
  return html`<div class="page">
    <${Hero} title="الطلبات" sub="إجازات وسلف الموظفين" back="dash" slim />
    <div class="body flat">
      <div class="chips"><button class=${'chip' + (tab === 'leaves' ? ' on' : '')} onClick=${() => setTab('leaves')}>الإجازات</button>
        <button class=${'chip' + (tab === 'advances' ? ' on' : '')} onClick=${() => setTab('advances')}>السلف</button></div>
      <div class="card tight">
        ${rows === null ? html`<div class="empty">لحظة...</div>` : rows.length === 0 ? html`<div class="empty">مفيش طلبات.</div>` : rows.map((r) => html`<div class="list-row" style="align-items:flex-start;padding:12px 0">
          <div class=${'avatar tone-' + REQ_STATUS[r.status][0]}>${initial(r.staff && r.staff.full_name)}</div>
          <div class="grow"><div style="font-weight:600">${r.staff ? r.staff.full_name : ''}</div>
            <div class="soft">${kind === 'leave' ? fmtShort(keyToDate(r.from_date)) + (r.to_date !== r.from_date ? ' ← ' + fmtShort(keyToDate(r.to_date)) : '') : fmtMoney(r.amount) + ' ج.م · ' + r.installments + ' ' + (r.installments > 1 ? 'أقساط' : 'قسط')}</div>
            ${r.reason && html`<div class="soft">${r.reason}</div>`}
            ${r.status === 'pending' && allowed && html`<div class="row" style="margin-top:8px"><button class="btn small" style="box-shadow:none" onClick=${() => setDec({ item: r, approve: true })}>قبول</button>
              <button class="btn small ghost" onClick=${() => setDec({ item: r, approve: false })}>رفض</button></div>`}</div>
          <${Pill} tone=${REQ_STATUS[r.status][0]}>${REQ_STATUS[r.status][1]}<//>
        </div>`)}
      </div>
    </div>
    ${dec && html`<${DecideSheet} kind=${kind} item=${dec.item} approve=${dec.approve} onClose=${() => setDec(null)} onDone=${() => { setDec(null); load(); window.dispatchEvent(new Event('adm-refresh')); }} />`}
  </div>`;
}

/* ---------- payroll ---------- */
function MonthNav({ month, setMonth }) {
  const cur = monthStart(todayKey());
  return html`<div class="card"><div class="spread">
    <button class="iconbtn light" aria-label="الشهر اللي بعده" disabled=${month >= cur} onClick=${() => setMonth(addMonths(month, 1))}><${Icon} name="chev" size=${22} /></button>
    <div style="text-align:center"><div class="h2">${monthName(month)}</div>${month === cur && html`<span class="soft">الشهر الحالي</span>`}</div>
    <button class="iconbtn light" aria-label="الشهر اللي قبله" onClick=${() => setMonth(addMonths(month, -1))}><${Icon} name="back" size=${22} /></button></div></div>`;
}

const PM_STATUS = { open: ['green', 'مفتوح'], locked: ['slate', 'مقفول'], paid: ['sand', 'اتصرف'] };

function AdmPay() {
  const [month, setMonth] = useState(monthStart(todayKey()));
  const [rows, setRows] = useState(null);
  const [pm, setPm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reopen, setReopen] = useState(false);
  async function load() {
    const [a, b] = await Promise.all([sb.rpc('payroll_month', { p_month: month }), sb.from('payroll_months').select('*').eq('month', month).maybeSingle()]);
    if (a.error) { toast(errText(a.error.message), 'bad'); setRows([]); } else setRows(a.data || []);
    setPm(b.data);
  }
  useEffect(() => { setRows(null); load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [month]);
  const status = pm ? pm.status : 'open';
  const cur = monthStart(todayKey());
  const total = (rows || []).reduce((s, r) => s + Number(r.calc ? r.calc.net : 0), 0);
  const hours = (rows || []).reduce((s, r) => s + Number(r.calc ? r.calc.hours_regular + r.calc.hours_overtime : 0), 0);
  async function act(fn, ok, ask) {
    if (ask && !confirm(ask)) return;
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) return toast(errText(error.message), 'bad');
    toast(ok);
    load();
  }
  const canEdit = can('payroll.edit');
  return html`<div class="page">
    <${Hero} title="المرتبات" sub=${'القبض ' + fmtShort(keyToDate(paydayOf(month)))} />
    <div class="body">
      <${MonthNav} month=${month} setMonth=${setMonth} />
      <div class="card">
        <div class="spread"><div><div class="soft">${status === 'open' && month === cur ? 'المستحق لحد دلوقتي' : 'إجمالي الصافي'}</div>
          <div class="num" style="font-family:var(--hf);font-weight:600;font-size:30px">${fmtMoney(total)} <span class="soft" style="font-size:14px">ج.م</span></div></div>
          <${Pill} tone=${PM_STATUS[status][0]} icon=${status === 'open' ? 'clock' : 'lock'}>${PM_STATUS[status][1]}<//></div>
        <div class="spread soft"><span>${rows ? rows.length : 0} موظف</span><span>${hours} ساعة</span></div>
        ${canEdit && status === 'open' && month < cur && html`<button class="btn small" disabled=${busy} onClick=${() => act(() => sb.rpc('lock_month', { p_month: month }), 'اتقفل الشهر', 'قفل شهر ' + monthName(month) + '؟ الأرقام هتتثبت.')}><${Icon} name="lock" size=${20} /> قفل الشهر</button>`}
        ${canEdit && status === 'locked' && html`<button class="btn small" disabled=${busy} onClick=${() => act(() => sb.rpc('mark_paid', { p_month: month }), 'اتسجّل الصرف', 'تسجيل إن المرتبات اتصرفت؟ الموظفين هيوصلهم إشعار.')}><${Icon} name="check" size=${20} /> تم صرف المرتبات</button>`}
        ${can('payroll.reopen') && status !== 'open' && html`<button class="btn ghost small" disabled=${busy} onClick=${() => setReopen(true)}>إعادة فتح الشهر</button>`}
        ${status === 'open' && month >= cur && html`<div class="note info">الشهر لسه شغال. تقدر تقفله أول ما يخلص.</div>`}
      </div>
      <div class="card tight">
        ${rows === null ? html`<div class="empty">لحظة...</div>` : rows.length === 0 ? html`<div class="empty">مفيش موظفين.</div>` : rows.map((r) => html`<a class="list-row" href=${'#payroll/' + r.staff_id + '/' + month}>
          <div class="avatar tone-sand">${initial(r.full_name)}</div>
          <div class="grow"><div style="font-weight:600">${r.full_name}</div><div class="soft num">${r.calc ? r.calc.hours_regular + r.calc.hours_overtime + ' ساعة' : ''}</div></div>
          <div class="amt">${r.calc ? fmtMoney(r.calc.net) : '—'}</div><${Chev} /></a>`)}
      </div>
    </div>
    ${reopen && html`<${ReopenSheet} month=${month} onClose=${() => setReopen(false)} onDone=${() => { setReopen(false); load(); }} />`}
  </div>`;
}

function ReopenSheet({ month, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    const { error } = await sb.rpc('reopen_month', { p_month: month, p_reason: reason });
    setBusy(false);
    if (error) return toast(errText(error.message), 'bad');
    toast('اتفتح الشهر');
    onDone();
  }
  return html`<${Sheet} title=${'إعادة فتح ' + monthName(month)} onClose=${onClose}>
    <div class="note warn">الأرقام المثبّتة هتتمسح وهتتحسب من جديد. الإجراء ده بيتسجّل في سجل النشاط.</div>
    <label class="field">سبب إعادة الفتح<input class="input" value=${reason} onInput=${(e) => setReason(e.target.value)} /></label>
    <button class="btn dark" disabled=${busy} onClick=${go}>تأكيد إعادة الفتح</button>
  <//>`;
}

function AdjSheet({ staffId, kind, month, onClose, onDone }) {
  const last = addMonths(month, 1);
  const lastDay = addDays(last, -1);
  const [k, setK] = useState(kind);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(todayKey() < lastDay && todayKey() >= month ? todayKey() : lastDay);
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!Number(amount)) return toast('اكتب المبلغ.', 'bad');
    setBusy(true);
    const { error } = await sb.rpc('add_adjustment', { p_staff: staffId, p_kind: k, p_amount: Number(amount), p_reason: reason, p_date: date });
    setBusy(false);
    if (error) return toast(errText(error.message), 'bad');
    toast(k === 'bonus' ? 'اتضافت المكافأة' : 'اتضاف الخصم');
    onDone();
  }
  return html`<${Sheet} title="مكافأة أو خصم" onClose=${onClose}>
    <div class="chips"><button class=${'chip' + (k === 'bonus' ? ' on' : '')} onClick=${() => setK('bonus')}>مكافأة</button><button class=${'chip' + (k === 'deduction' ? ' on' : '')} onClick=${() => setK('deduction')}>خصم</button></div>
    <label class="field">المبلغ (ج.م)<input class="input num-in" inputmode="decimal" value=${amount} onInput=${(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} /></label>
    <label class="field">السبب<input class="input" placeholder=${k === 'bonus' ? 'مثال: أداء ممتاز' : 'مثال: تلف عدة'} value=${reason} onInput=${(e) => setReason(e.target.value)} /></label>
    <label class="field">التاريخ<input class="input" type="date" value=${date} min=${month} max=${lastDay} onInput=${(e) => setDate(e.target.value)} /></label>
    <div class="note info">الموظف هيوصله إشعار، وبيظهر في مرتب ${monthName(month)}.</div>
    <button class="btn" disabled=${busy} onClick=${go}>${busy ? 'لحظة...' : 'إضافة'}</button>
  <//>`;
}

function AdmPayroll({ id, month }) {
  const m = month ? monthStart(month) : monthStart(todayKey());
  const [s, setS] = useState(null);
  const [res, setRes] = useState(null);
  const [adjs, setAdjs] = useState([]);
  const [sheet, setSheet] = useState(null);
  async function load() {
    const [a, b, c] = await Promise.all([
      sb.from('staff').select('*').eq('id', id).maybeSingle(),
      sb.rpc('staff_payroll', { p_staff: id, p_month: m }),
      sb.from('pay_adjustments').select('*').eq('staff_id', id).gte('effective_date', m).lt('effective_date', addMonths(m, 1)).order('effective_date', { ascending: false }),
    ]);
    setS(a.data);
    if (b.error) toast(errText(b.error.message), 'bad'); else setRes(b.data);
    setAdjs(c.data || []);
  }
  useEffect(() => { load(); }, [id, m]);
  async function voidAdj(a) {
    const reason = prompt('سبب الإلغاء؟');
    if (!reason) return;
    const { error } = await sb.rpc('void_adjustment', { p_id: a.id, p_reason: reason });
    if (error) return toast(errText(error.message), 'bad');
    toast('اتلغى');
    load();
  }
  const c = res && res.calc;
  const open = res && res.status === 'open';
  return html`<div class="page nonav">
    <${Hero} title=${s ? s.full_name : 'المرتب'} sub=${monthName(m) + (res && res.status !== 'open' ? ' · ' + PM_STATUS[res.status][1] : '')} back=${'pay'} slim />
    <div class="body flat">
      <div class="card" style="align-items:center;text-align:center;gap:4px"><div class="soft">صافي المرتب</div>
        <div class="num" style="font-family:var(--hf);font-weight:600;font-size:40px">${c ? fmtMoney(c.net) : '...'} <span class="soft" style="font-size:16px">ج.م</span></div>
        ${s && html`<div class="soft">المرتب الأساسي ${fmtMoney(s.base_salary)} · القبض ${fmtShort(keyToDate(paydayOf(m, s)))}</div>`}</div>
      ${c && html`<${PayBreakdown} c=${c} />`}
      ${c && html`<div class="stats"><div class="stat"><span class="big num">${c.days_present}</span><span class="soft">أيام حضور</span></div>
        <div class="stat"><span class="big num">${c.late_days}</span><span class="soft">تأخير</span></div>
        <div class="stat"><span class="big num">${c.days_absent}</span><span class="soft">غياب</span></div></div>`}
      ${can('payroll.edit') && open && html`<div class="row"><button class="btn small grow" style="box-shadow:none" onClick=${() => setSheet('bonus')}><${Icon} name="gift" size=${20} /> مكافأة</button>
        <button class="btn small ghost grow" onClick=${() => setSheet('deduction')}><${Icon} name="minus" size=${20} /> خصم</button></div>
        <a class="btn ghost small" href=${'#backfill/' + id + '/' + m}><${Icon} name="calendar" size=${20} /> إدخال أيام سابقة</a>`}
      <div class="card tight">
        <div class="h2" style="padding:12px 0 4px">المكافآت والخصومات</div>
        ${adjs.length === 0 ? html`<div class="empty">مفيش حاجة الشهر ده.</div>` : adjs.map((a) => html`<div class="list-row" style=${a.voided ? 'opacity:.5' : ''}>
          <${Tile} icon=${a.kind === 'bonus' ? 'gift' : 'minus'} tone=${a.kind === 'bonus' ? 'green' : 'red'} sm />
          <div class="grow"><div style="font-weight:500">${a.reason}${a.voided ? ' (ملغي)' : ''}</div><div class="soft">${fmtShort(keyToDate(a.effective_date))}</div></div>
          <div class=${'amt ' + (a.kind === 'bonus' ? 'pos' : 'neg')}>${(a.kind === 'bonus' ? '+' : '−') + fmtMoney(a.amount)}</div>
          ${!a.voided && open && can('payroll.edit') && html`<button class="iconbtn light" aria-label="إلغاء" onClick=${() => voidAdj(a)}><${Icon} name="close" size=${18} /></button>`}</div>`)}
      </div>
    </div>
    ${sheet && html`<${AdjSheet} staffId=${id} kind=${sheet} month=${m} onClose=${() => setSheet(null)} onDone=${() => { setSheet(null); load(); }} />`}
  </div>`;
}

/* ---------- days entered by hand (first month, before the app was used) ---------- */
const NEXT_STATE = { none: 'present', present: 'absent', absent: 'leave', leave: 'none' };
function Backfill({ id, month }) {
  const m = month ? monthStart(month) : monthStart(todayKey());
  const [s, setS] = useState(null);
  const [sh, setSh] = useState(null);
  const [app, setApp] = useState({});
  const [cells, setCells] = useState({});
  const [hours, setHours] = useState(8);
  const [ot, setOt] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    (async () => {
      const [a, at, md] = await Promise.all([
        sb.from('staff').select('*').eq('id', id).maybeSingle(),
        sb.from('attendance').select('work_date').eq('staff_id', id).gte('work_date', m).lt('work_date', addMonths(m, 1)),
        sb.from('manual_days').select('*').eq('staff_id', id).gte('work_date', m).lt('work_date', addMonths(m, 1)),
      ]);
      setS(a.data);
      if (a.data && a.data.shift_id) { const r = await sb.from('shifts').select('*').eq('id', a.data.shift_id).maybeSingle(); setSh(r.data); setHours(r.data ? Number(r.data.hours) : 8); }
      const ap = {}; (at.data || []).forEach((x) => { ap[x.work_date] = true; }); setApp(ap);
      const cs = {}; let o = 0; let h = null;
      (md.data || []).forEach((x) => { cs[x.work_date] = x.kind; o += Number(x.overtime_hours || 0); if (x.kind === 'present' && x.hours != null && h == null) h = Number(x.hours); });
      setCells(cs); setOt(o); if (h != null) setHours(h);
    })();
  }, [id, m]);
  if (!s) return html`<div class="page nonav"><${Hero} title="أيام سابقة" back=${'employee/' + id} slim /><div class="body flat"><div class="card"><div class="empty">لحظة...</div></div></div></div>`;
  const dim = daysInMonth(m);
  const first = (keyToDate(m).getUTCDay() + 1) % 7;
  const today = todayKey();
  const keyOf = (d) => m.slice(0, 8) + pad2(d);
  const cnt = { present: 0, absent: 0, leave: 0 };
  Object.entries(cells).forEach(([k, v]) => { if (!app[k] && cnt[v] != null) cnt[v] += 1; });
  const shiftH = sh ? Number(sh.hours) : 8;
  const rate = Number(s.base_salary) / dim / shiftH;
  const allowance = Number(CTX.S.paid_leave_days ?? 2);
  const est = (cnt.present * hours + ot * (Number(CTX.S.overtime_pct ?? 150) / 100)) * rate + Math.min(cnt.leave, allowance) * shiftH * rate;
  const style = { present: 'background:var(--green-bg);color:var(--green)', absent: 'background:var(--red-bg);color:var(--red-fg)', leave: 'background:var(--slate-bg);color:var(--slate)', none: 'background:#fff;color:var(--ink);border:1px dashed var(--line)' };
  async function save() {
    const firstPresent = Object.keys(cells).filter((k) => cells[k] === 'present' && !app[k]).sort()[0];
    const rows = Object.keys(cells).filter((k) => !app[k] && cells[k] !== 'none').map((k) => ({ work_date: k, kind: cells[k], hours: cells[k] === 'present' ? hours : null, overtime_hours: k === firstPresent ? ot : 0 }));
    setBusy(true);
    const { error } = await sb.rpc('save_manual_days', { p_staff: id, p_from: m, p_to: addDays(addMonths(m, 1), -1), p_rows: rows });
    setBusy(false);
    if (error) return toast(errText(error.message), 'bad');
    toast('اتحفظت الأيام');
    location.hash = '#payroll/' + id + '/' + m;
  }
  const days = [];
  for (let i = 0; i < first; i++) days.push(html`<span></span>`);
  for (let d = 1; d <= dim; d++) {
    const k = keyOf(d);
    const future = k > today;
    const fromApp = app[k];
    days.push(html`<button type="button" class="cal-d" disabled=${future || fromApp}
      style=${(fromApp ? 'background:var(--green-bg);color:var(--green);opacity:.6' : future ? 'background:transparent;color:#B5B0B8' : style[cells[k] || 'none'])}
      onClick=${() => setCells({ ...cells, [k]: NEXT_STATE[cells[k] || 'none'] })}>${d}</button>`);
  }
  return html`<div class="page nonav">
    <${Hero} title="إدخال أيام سابقة" sub=${s.full_name + ' · ' + monthName(m)} back=${'employee/' + id} slim />
    <div class="body flat">
      <div class="note info">دوس على اليوم يتغيّر: حاضر، ثم غايب، ثم إجازة مدفوعة، ثم فاضي. الأيام اللي التطبيق سجّلها لوحده مش بتتعدّل.</div>
      <div class="card">
        <div class="cal">${['سبت', 'أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة'].map((d) => html`<div class="soft" style="text-align:center;font-size:12px">${d}</div>`)}</div>
        <div class="cal">${days}</div>
        <div class="chips" style="gap:12px"><span class="pill tone-green">حاضر</span><span class="pill tone-red">غايب</span><span class="pill tone-slate">إجازة</span><span class="pill" style="background:#fff;border:1px dashed var(--line)">فاضي</span></div>
      </div>
      <div class="card">
        <div class="spread"><div><div class="h3">ساعات اليوم</div><div class="soft">بتتطبق على كل يوم حاضر</div></div><${Stepper} value=${hours} min=${1} max=${24} step=${0.5} onChange=${setHours} /></div>
        <div class="spread"><div><div class="h3">ساعات إضافية</div><div class="soft">إجمالي الشهر</div></div><${Stepper} value=${ot} min=${0} max=${300} step=${1} onChange=${setOt} /></div>
      </div>
      <div class="card">
        <div class="h2">ملخص الأيام دي</div>
        <div class="spread"><span class="soft">حاضر</span><b class="num">${cnt.present} يوم · ${cnt.present * hours} ساعة</b></div>
        <div class="spread"><span class="soft">إجازة مدفوعة</span><b class="num">${cnt.leave} يوم</b></div>
        <div class="spread"><span class="soft">غايب</span><b class="num">${cnt.absent} يوم</b></div>
        <div class="spread" style="border-top:1px solid var(--line);padding-top:10px"><span class="h3">تقدير المستحق</span><b class="amt" style="font-size:20px">${fmtMoney(est)} ج.م</b></div>
      </div>
      <button class="btn" disabled=${busy || !can('payroll.edit')} onClick=${save}>${busy ? 'لحظة...' : 'حفظ الأيام'}</button>
    </div>
  </div>`;
}

function AdmEmployees() {
  const [list, setList] = useState(null);
  const [board, setBoard] = useState({});
  const [q, setQ] = useState('');
  const [f, setF] = useState('all');
  useEffect(() => {
    sb.from('staff').select('*').order('code').then(({ data }) => setList(data || []));
    sb.rpc('today_board').then(({ data }) => { const m = {}; (data || []).forEach((r) => { m[r.staff_id] = r; }); setBoard(m); });
  }, []);
  const shown = (list || []).filter((s) => {
    const st = board[s.id] ? board[s.id].status : null;
    if (f !== 'all' && f !== 'off' && st !== f) return false;
    if (f === 'off' && s.active) return false;
    if (f !== 'off' && !s.active) return false;
    const t = q.trim().toLowerCase();
    return !t || s.full_name.toLowerCase().includes(t) || s.code.toLowerCase().includes(t);
  });
  const cnt = (k) => (list || []).filter((s) => s.active && board[s.id] && board[s.id].status === k).length;
  const chips = [['all', 'الكل ' + (list || []).filter((s) => s.active).length], ['present', 'حاضر ' + cnt('present')], ['late', 'متأخر ' + cnt('late')], ['absent', 'غايب ' + cnt('absent')], ['off', 'موقوف']];
  return html`<div class="page">
    <${Hero} title="الموظفين" sub=${list ? (list.filter((s) => s.active).length + ' موظف شغال') : ''} />
    <div class="body">
      <label class="row" style="height:52px;padding:0 16px;border:1px solid var(--line);border-radius:26px;background:#fff;box-shadow:0 8px 24px rgba(29,29,34,.08);color:var(--soft)">
        <${Icon} name="search" size=${22} /><input class="grow" style="border:0;outline:none;background:transparent;font-size:16px;color:var(--ink);min-width:0" placeholder="دوّر بالاسم أو الكود" aria-label="بحث" value=${q} onInput=${(e) => setQ(e.target.value)} />
      </label>
      <a class="btn" href="#add"><${Icon} name="plus" size=${22} /> إضافة موظف</a>
      <div class="chips">${chips.map(([k, l]) => html`<button class=${'chip' + (f === k ? ' on' : '')} onClick=${() => setF(k)}>${l}</button>`)}</div>
      <div class="card tight">
        ${list === null ? html`<div class="empty">لحظة...</div>` : shown.length === 0 ? html`<div class="empty">مفيش نتايج.</div>` : shown.map((s) => {
          const st = board[s.id] ? board[s.id].status : null;
          return html`<a class="list-row" href=${'#employee/' + s.id}>
            <div class=${'avatar tone-' + (st ? STATUS[st].tone : 'sand')}>${initial(s.full_name)}</div>
            <div class="grow"><div style="font-weight:600">${s.full_name}</div><div class="soft">${s.role !== 'employee' ? ROLE_LABEL[s.role] + ' · ' : ''}${s.department || '—'} · كود ${s.code}</div></div>
            ${st && html`<${Pill} tone=${STATUS[st].tone}>${STATUS[st].label}<//>`}<${Chev} />
          </a>`;
        })}
      </div>
    </div>
  </div>`;
}

function Credentials({ name, code, pin, phone, onClose, extra }) {
  const url = location.origin + location.pathname;
  const text = 'أهلاً ' + name + '، دي بيانات دخولك لنظام الكابتن:\nالكود: ' + code + '\nالـ PIN: ' + pin + '\nالرابط: ' + url + '\nتقدر تغيّر الـ PIN من صفحة حسابي.';
  let ph = String(phone || '').replace(/\D/g, '');
  if (ph.startsWith('0')) ph = '2' + ph;
  const wa = 'https://wa.me/' + ph + '?text=' + encodeURIComponent(text);
  return html`<${Sheet} title="بيانات الدخول" onClose=${onClose}>
    <div class="note ok">${extra || 'الموظف اتضاف.'} احفظ البيانات دي أو ابعتها دلوقتي، الـ PIN مش هيظهر تاني.</div>
    <div class="card">
      <div class="spread"><span class="soft">الاسم</span><b>${name}</b></div>
      <div class="spread"><span class="soft">الكود</span><b class="num" style="font-family:var(--hf);font-size:20px">${code}</b></div>
      <div class="spread"><span class="soft">الـ PIN</span><b class="num" style="font-family:var(--hf);font-size:24px;letter-spacing:3px">${pin}</b></div>
    </div>
    <a class="btn dark" href=${wa} target="_blank" rel="noopener"><${Icon} name="send" size=${22} /> إرسال على واتساب</a>
    <button class="btn ghost" onClick=${() => { navigator.clipboard && navigator.clipboard.writeText(text); toast('اتنسخت الرسالة'); }}>نسخ الرسالة</button>
  <//>`;
}

function AdmAdd() {
  const [f, setF] = useState({ name: '', phone: '', dept: '', job: '', salary: '', shift: '', start: todayKey(), code: '', pin: randomPin(), anyLoc: false, role: 'employee' });
  const [shifts, setShifts] = useState([]);
  const [depts, setDepts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));
  useEffect(() => {
    sb.from('shifts').select('*').eq('active', true).order('created_at').then(({ data }) => {
      setShifts(data || []);
      if (data && data[0]) setF((o) => ({ ...o, shift: o.shift || data[0].id }));
    });
    sb.from('staff').select('code,department').then(({ data }) => {
      const nums = (data || []).map((s) => parseInt(s.code, 10)).filter((n) => !isNaN(n));
      setF((o) => ({ ...o, code: o.code || String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0') }));
      setDepts([...new Set((data || []).map((s) => s.department).filter(Boolean))]);
    });
  }, []);
  const sh = shifts.find((s) => s.id === f.shift);
  const hourly = f.salary && sh ? (Number(f.salary) / 30 / Number(sh.hours)) : null;
  async function submit() {
    if (!f.name.trim()) return toast('اكتب اسم الموظف.', 'bad');
    if (!f.code.trim()) return toast('اكتب كود الموظف.', 'bad');
    if (!/^\d{6}$/.test(f.pin)) return toast('الـ PIN لازم يبقى 6 أرقام.', 'bad');
    setBusy(true);
    try {
      const r = await callAdmin({ action: 'create', code: f.code, pin: f.pin, full_name: f.name, phone: f.phone, department: f.dept, job_title: f.job,
        base_salary: Number(f.salary || 0), shift_id: f.shift || null, start_date: f.start || null, any_location: f.anyLoc, role: f.role });
      setDone({ id: r.id, code: r.code, pin: f.pin, name: f.name.trim(), phone: f.phone });
    } catch (e) { toast(errText(e.message), 'bad'); }
    setBusy(false);
  }
  const sec = (icon, tone, title, ...kids) => html`<div class="card"><div class="row"><${Tile} icon=${icon} tone=${tone} sm /><div class="h2">${title}</div></div>${kids}</div>`;
  return html`<div class="page nonav">
    <${Hero} title="إضافة موظف" back="dash" slim />
    <div class="body flat">
      ${sec('user', 'slate', 'البيانات الأساسية',
        html`<label class="field">الاسم الكامل<input class="input" placeholder="مثال: أحمد محمد علي" value=${f.name} onInput=${(e) => set('name', e.target.value)} /></label>`,
        html`<label class="field">رقم الموبايل<input class="input num-in" inputmode="tel" placeholder="01xxxxxxxxx" value=${f.phone} onInput=${(e) => set('phone', e.target.value)} /></label>`,
        html`<div class="row" style="align-items:flex-start"><label class="field grow">القسم<input class="input" list="depts" value=${f.dept} onInput=${(e) => set('dept', e.target.value)} /><datalist id="depts">${depts.map((d) => html`<option value=${d}></option>`)}</datalist></label>
          <label class="field grow">المسمى الوظيفي<input class="input" value=${f.job} onInput=${(e) => set('job', e.target.value)} /></label></div>`)}
      ${sec('wallet', 'red', 'المرتب والشفت',
        html`<label class="field">المرتب الأساسي (شهريًا)<input class="input num-in" inputmode="decimal" placeholder="10000" value=${f.salary} onInput=${(e) => set('salary', e.target.value.replace(/[^\d.]/g, ''))} />
          ${hourly != null && html`<span class="hint">سعر الساعة (تقريبي على شهر 30 يوم): ${hourly.toFixed(2)} ج.م</span>`}</label>`,
        html`<label class="field">الشفت<select class="select" value=${f.shift} onChange=${(e) => set('shift', e.target.value)}>${shifts.map((s) => html`<option value=${s.id} selected=${s.id === f.shift}>${s.name} · ${shiftRange(s)}</option>`)}</select></label>`,
        html`<label class="field">تاريخ بداية الشغل<input class="input" type="date" value=${f.start} onInput=${(e) => set('start', e.target.value)} /></label>`)}
      ${sec('lock', 'amber', 'الدخول للتطبيق',
        html`<label class="field">كود الموظف<input class="input num-in" autocapitalize="none" value=${f.code} onInput=${(e) => set('code', e.target.value)} /><span class="hint">بيتحدد تلقائي وتقدر تغيّره</span></label>`,
        html`<label class="field">الـ PIN (6 أرقام)<div class="row"><input class="input num-in grow" inputmode="numeric" maxlength="6" value=${f.pin} onInput=${(e) => set('pin', e.target.value.replace(/\D/g, ''))} />
          <button type="button" class="btn ghost small auto" onClick=${() => set('pin', randomPin())}><${Icon} name="refresh" size=${20} /> توليد</button></div>
          <span class="hint">الموظف يقدر يغيّره بنفسه من صفحة حسابي</span></label>`)}
      ${sec('pin', 'green', 'مكان التسجيل',
        html`<div class="row"><div class="grow"><div style="font-weight:600;color:var(--ink)">يسجّل من أي مكان</div><div class="soft">مقفول: لازم يكون داخل نطاق الشغل</div></div><${Toggle} on=${f.anyLoc} onChange=${(v) => set('anyLoc', v)} /></div>`)}
      ${can('roles.manage') && html`<div class="card"><label class="field">الدور<select class="select" onChange=${(e) => set('role', e.target.value)}>${Object.entries(ROLE_LABEL).map(([k, v]) => html`<option value=${k} selected=${f.role === k}>${v}</option>`)}</select>
        <span class="hint">اختار "موظف" للناس العادية. الأدوار التانية بتدخل لوحة الإدارة.</span></label></div>`}
      <button class="btn" disabled=${busy} onClick=${submit}>${busy ? 'لحظة...' : 'إضافة الموظف'}</button>
    </div>
    ${done && html`<${Credentials} ...${done} onClose=${() => { setDone(null); location.hash = '#employee/' + done.id; }} />`}
  </div>`;
}

function AdmEmployee({ id }) {
  const [s, setS] = useState(null);
  const [f, setF] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [cred, setCred] = useState(null);
  const [pay, setPay] = useState(null);
  const [today, setToday] = useState(null);
  const [more, setMore] = useState(false);
  const [editing, setEditing] = useState(false);
  const [adj, setAdj] = useState(null);
  const month = monthStart(todayKey());
  async function load() {
    const none = Promise.resolve({ data: null });
    const [a, b, c, d, e] = await Promise.all([
      sb.from('staff').select('*').eq('id', id).maybeSingle(),
      sb.from('shifts').select('*').order('created_at'),
      sb.from('attendance').select('*').eq('staff_id', id).order('work_date', { ascending: false }).limit(7),
      can('payroll.view') ? sb.rpc('staff_payroll', { p_staff: id, p_month: month }) : none,
      can('attendance.view') ? sb.rpc('today_board') : none,
    ]);
    setS(a.data);
    if (a.data) setF({ name: a.data.full_name, phone: a.data.phone || '', dept: a.data.department || '', job: a.data.job_title || '', salary: String(a.data.base_salary ?? ''), shift: a.data.shift_id || '', start: a.data.start_date || '', anyLoc: a.data.any_location });
    setShifts(b.data || []);
    setRows(c.data || []);
    if (d && !d.error) setPay(d.data);
    if (e && e.data) setToday(e.data.find((r) => r.staff_id === id) || null);
  }
  useEffect(() => { load(); }, [id]);
  if (!s || !f) return html`<div class="page nonav"><${Hero} title="ملف الموظف" back="dash" slim /><div class="body flat"><div class="card"><div class="empty">لحظة...</div></div></div></div>`;
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));
  const sh = shifts.find((x) => x.id === s.shift_id);
  async function save() {
    setBusy(true);
    const { error } = await sb.from('staff').update({ full_name: f.name.trim(), phone: f.phone || null, department: f.dept || null, job_title: f.job || null,
      base_salary: Number(f.salary || 0), shift_id: f.shift || null, start_date: f.start || null, any_location: f.anyLoc }).eq('id', id);
    setBusy(false);
    if (error) return toast(errText(error.message), 'bad');
    toast('اتحفظت التعديلات');
    setEditing(false);
    load();
  }
  async function resetPin() {
    const pin = randomPin();
    setBusy(true);
    try { await callAdmin({ action: 'reset_pin', id, pin }); setCred({ name: s.full_name, code: s.code, pin, phone: s.phone, extra: 'الـ PIN اتغيّر.' }); }
    catch (e) { toast(errText(e.message), 'bad'); }
    setBusy(false);
  }
  async function toggleActive() {
    const next = !s.active;
    if (!next && !confirm('إيقاف ' + s.full_name + '؟ مش هيقدر يدخل، وسجله بيفضل محفوظ.')) return;
    setBusy(true);
    try { await callAdmin({ action: 'set_active', id, active: next }); toast(next ? 'اتفعّل الموظف' : 'اتوقّف الموظف'); await load(); }
    catch (e) { toast(errText(e.message), 'bad'); }
    setBusy(false);
  }
  const grace = Number(CTX.S.grace_minutes ?? 30);
  const c = pay && pay.calc;
  const open = !pay || pay.status === 'open';
  const canEditStaff = can('employees.edit');
  const isMe = CTX.me && s.id === CTX.me.id;
  return html`<div class="page nonav">
    <${Hero} title="ملف الموظف" back="dash" sub=${ROLE_LABEL[s.role]} slim />
    <div class="body flat">
      ${!s.active && html`<div class="note bad">الموظف موقوف ومش قادر يدخل.</div>`}
      <div class="card">
        <div class="row"><div class="avatar tone-sand">${initial(s.full_name)}</div>
          <div class="grow"><div class="h2">${s.full_name}</div><div class="soft">كود ${s.code}${s.department ? ' · ' + s.department : ''}${sh ? ' · ' + shiftRange(sh) : ''}</div></div>
          ${today && html`<${Pill} tone=${STATUS[today.status].tone}>${STATUS[today.status].label}<//>`}</div>
      </div>
      ${can('payroll.view') && html`<div class="card">
        <div class="soft">رصيده لحد دلوقتي</div>
        <div class="num" style="font-family:var(--hf);font-weight:600;font-size:34px;line-height:1.2">${c ? fmtMoney(c.net) : '...'} <span class="soft" style="font-size:15px">ج.م</span></div>
        <div class="soft">القبض ${fmtShort(keyToDate(paydayOf(month, s)))}</div>
        ${can('payroll.edit') && open && html`<div class="row"><button class="btn small grow" style="box-shadow:none" onClick=${() => setAdj('bonus')}><${Icon} name="plus" size=${20} /> مكافأة</button>
          <button class="btn small ghost grow" onClick=${() => setAdj('deduction')}><${Icon} name="minus" size=${20} /> خصم</button></div>`}
        <a class="btn ghost small" href=${'#payroll/' + id + '/' + month}><${Icon} name="wallet" size=${20} /> تفاصيل المرتب</a>
      </div>`}
      ${can('attendance.view') && html`<div class="card tight">
        <div class="h2" style="padding:12px 0 4px">آخر 7 أيام</div>
        ${rows.length === 0 ? html`<div class="empty">لسه مفيش حضور.</div>` : rows.map((a) => html`<div class="list-row">
          <div class="grow"><div style="font-weight:600">${fmtShort(keyToDate(a.work_date))}</div><div class="soft num">${fmtTime(a.check_in)} — ${a.check_out ? fmtTime(a.check_out) : 'لسه شغال'}</div></div>
          <${Pill} tone=${lateMin(a, sh) > grace ? 'amber' : 'green'}>${paidHours(a, sh)} ساعة<//></div>`)}
      </div>`}
      ${(canEditStaff || can('payroll.edit')) && html`<div class="card tight">
        <button class="list-row" onClick=${() => setMore(!more)}><${Tile} icon="sliders" tone="sand" sm /><div class="grow" style="font-weight:500;text-align:start">المزيد</div><${Chev} /></button>
        ${more && html`
          ${canEditStaff && html`<button class="list-row" onClick=${() => setEditing(!editing)}><${Tile} icon="user" tone="amber" sm /><div class="grow" style="font-weight:500;text-align:start">تعديل البيانات</div><${Chev} /></button>`}
          ${can('payroll.edit') && html`<a class="list-row" href=${'#backfill/' + id}><${Tile} icon="clock" tone="slate" sm /><div class="grow" style="font-weight:500">أيام سابقة</div><${Chev} /></a>`}
          ${canEditStaff && html`<button class="list-row" disabled=${busy} onClick=${resetPin}><${Tile} icon="lock" tone="sand" sm /><div class="grow" style="font-weight:500;text-align:start">تغيير الـ PIN</div><${Chev} /></button>`}
          ${canEditStaff && !isMe && html`<button class="list-row" disabled=${busy} onClick=${toggleActive}><${Tile} icon="xcircle" tone="red" sm /><div class="grow" style=${'font-weight:500;text-align:start;' + (s.active ? 'color:var(--red)' : '')}>${s.active ? 'إيقاف الموظف' : 'تفعيل الموظف'}</div><${Chev} /></button>`}`}
      </div>`}
      ${editing && canEditStaff && html`<div class="card">
        <div class="h2">البيانات</div>
        <label class="field">الاسم<input class="input" value=${f.name} onInput=${(e) => set('name', e.target.value)} /></label>
        <label class="field">الموبايل<input class="input num-in" inputmode="tel" value=${f.phone} onInput=${(e) => set('phone', e.target.value)} /></label>
        <div class="row" style="align-items:flex-start"><label class="field grow">القسم<input class="input" value=${f.dept} onInput=${(e) => set('dept', e.target.value)} /></label>
          <label class="field grow">المسمى<input class="input" value=${f.job} onInput=${(e) => set('job', e.target.value)} /></label></div>
        <label class="field">المرتب الأساسي (شهريًا)<input class="input num-in" inputmode="decimal" value=${f.salary} onInput=${(e) => set('salary', e.target.value.replace(/[^\d.]/g, ''))} /></label>
        <label class="field">الشفت<select class="select" onChange=${(e) => set('shift', e.target.value)}><option value="" selected=${!f.shift}>—</option>${shifts.map((x) => html`<option value=${x.id} selected=${x.id === f.shift}>${x.name} · ${shiftRange(x)}</option>`)}</select></label>
        <label class="field">تاريخ بداية الشغل<input class="input" type="date" value=${f.start} onInput=${(e) => set('start', e.target.value)} /></label>
        <div class="row"><div class="grow"><div style="font-weight:600;color:var(--ink)">يسجّل من أي مكان</div><div class="soft">مقفول: لازم يكون داخل نطاق الشغل</div></div><${Toggle} on=${f.anyLoc} onChange=${(v) => set('anyLoc', v)} /></div>
        <button class="btn dark small" disabled=${busy} onClick=${save}>حفظ التعديلات</button>
      </div>`}
    </div>
    ${cred && html`<${Credentials} ...${cred} onClose=${() => setCred(null)} />`}
    ${adj && html`<${AdjSheet} staffId=${id} kind=${adj} month=${month} onClose=${() => setAdj(null)} onDone=${() => { setAdj(null); load(); }} />`}
  </div>`;
}

function AdmAtt() {
  const mode = 'day';
  const [day, setDay] = useState(todayKey());
  const [rows, setRows] = useState(null);
  const [shifts, setShifts] = useState({});
  const [edit, setEdit] = useState(null);
  const [excuses, setExcuses] = useState([]);
  const [raw, setRaw] = useState({ staff: [], onLeave: [], board: null });
  const [ex, setEx] = useState(null);
  async function load() {
    let q = sb.from('attendance').select('*, staff(full_name, code, shift_id)');
    q = mode === 'day' ? q.eq('work_date', day).order('check_in') : q.eq('review', 'pending').order('work_date', { ascending: false });
    if (mode === 'day') {
      const [a, sf, lv, exs, bd] = await Promise.all([
        q,
        sb.from('staff').select('id,full_name,code,shift_id,start_date').eq('role', 'employee').eq('active', true).order('full_name'),
        sb.from('leaves').select('staff_id').eq('status', 'approved').lte('from_date', day).gte('to_date', day),
        sb.from('day_excuses').select('*').eq('work_date', day).eq('voided', false),
        // for today, take the absent list from the same source as the home and employees screens
        day === todayKey() ? sb.rpc('today_board') : Promise.resolve({ data: null }),
      ]);
      setRows(a.data || []);
      setRaw({ staff: sf.data || [], onLeave: (lv.data || []).map((x) => x.staff_id), board: bd.data || null });
      setExcuses(exs.data || []);
    } else {
      const { data } = await q;
      setRows(data || []);
      setExcuses([]);
    }
  }
  useEffect(() => { sb.from('shifts').select('*').then(({ data }) => { const m = {}; (data || []).forEach((s) => { m[s.id] = s; }); setShifts(m); }); }, []);
  useEffect(() => { setRows(null); load(); }, [day, mode]);
  const grace = Number(CTX.S.grace_minutes ?? 30);
  const pendingCount = mode === 'pending' && rows ? rows.length : null;
  const present = new Set((rows || []).map((r) => r.staff_id));
  const pastGrace = (s) => { const sh = shifts[s.shift_id]; return !!sh && minsOfDay(new Date().toISOString()) > shiftStartMin(sh) + grace; };
  const isEx = (id, kind) => excuses.some((e) => e.staff_id === id && e.kind === kind);
  const absent = mode === 'day' && rows
    ? (raw.board && day === todayKey()
      ? raw.board.filter((r) => r.status === 'absent').map((r) => ({ id: r.staff_id, full_name: r.full_name, code: r.code }))
      : raw.staff.filter((s) => !present.has(s.id) && !raw.onLeave.includes(s.id) && (!s.start_date || s.start_date <= day) && !isEx(s.id, 'absence') && (day < todayKey() || pastGrace(s))))
    : [];
  const excusedAbs = excuses.filter((e) => e.kind === 'absence');
  const nameOf = (id) => { const s = raw.staff.find((x) => x.id === id); return s ? s.full_name : '—'; };
  const canEdit = can('attendance.edit');
  const smallBtn = 'height:38px;padding:0 12px;font-size:13px;border-radius:12px';
  return html`<div class="page">
    <${Hero} title="الحضور" back="dash" slim />
    <div class="body flat">
      ${mode === 'day' && html`<div class="card"><div class="spread">
        <button class="iconbtn light" aria-label="اليوم اللي بعده" onClick=${() => setDay(addDays(day, 1))} disabled=${day >= todayKey()}><${Icon} name="chev" size=${22} /></button>
        <div style="text-align:center"><div class="h2">${fmtShort(keyToDate(day))}</div>${day === todayKey() && html`<span class="soft">النهاردة</span>`}</div>
        <button class="iconbtn light" aria-label="اليوم اللي قبله" onClick=${() => setDay(addDays(day, -1))}><${Icon} name="back" size=${22} /></button></div></div>`}
      <div class="card tight">
        ${rows === null ? html`<div class="empty">لحظة...</div>` : rows.length === 0 ? html`<div class="empty">${mode === 'pending' ? 'مفيش حاجة محتاجة مراجعة.' : 'مفيش حضور مسجّل في اليوم ده.'}</div>` : rows.map((a) => {
          const sh = shifts[a.staff && a.staff.shift_id];
          const lateEx = isEx(a.staff_id, 'late');
          const isLate = lateMin(a, sh) > grace && !lateEx;
          return html`<button class="list-row" onClick=${() => setEdit(a)}>
            <div class=${'avatar tone-' + (isLate ? 'amber' : 'green')}>${initial(a.staff && a.staff.full_name)}</div>
            <div class="grow"><div style="font-weight:600">${a.staff ? a.staff.full_name : '—'}${mode === 'pending' ? ' · ' + fmtShort(keyToDate(a.work_date)) : ''}</div>
              <div class="soft num">${fmtTime(a.check_in)} — ${a.check_out ? fmtTime(a.check_out) : 'لسه شغال'} · ${paidHours(a, sh)} ساعة</div></div>
            <div class="stack" style="align-items:flex-end;gap:4px">
              ${isLate && html`<${Pill} tone="amber">متأخر<//>`}
              ${lateEx && html`<${Pill} tone="green">التأخير اتلغى<//>`}
              ${a.closed_by === 'auto' && html`<${Pill}>تلقائي<//>`}
              ${a.edited && html`<${Pill} tone="slate">معدّل<//>`}
              ${a.in_zone === false && html`<${Pill} tone="red">خارج النطاق<//>`}
            </div></button>`;
        })}
      </div>
      ${absent.length > 0 && html`<div class="card tight">
        <div class="h2" style="padding:12px 0 4px">غايبين</div>
        ${absent.map((s) => html`<div class="list-row"><div class="avatar tone-red">${initial(s.full_name)}</div>
          <div class="grow"><div style="font-weight:600">${s.full_name}</div><div class="soft">كود ${s.code}</div></div>
          ${canEdit && html`<button class="btn ghost auto" style=${smallBtn} onClick=${() => setEx({ staffId: s.id, name: s.full_name, kind: 'absence' })}>إلغاء الغياب</button>`}</div>`)}
      </div>`}
      ${excusedAbs.length > 0 && html`<div class="card tight">
        <div class="h2" style="padding:12px 0 4px">اتلغى غيابهم</div>
        ${excusedAbs.map((e) => html`<div class="list-row"><div class="avatar tone-green">${initial(nameOf(e.staff_id))}</div>
          <div class="grow"><div style="font-weight:600">${nameOf(e.staff_id)}</div><div class="soft">${e.reason}</div></div>
          <${Pill} tone=${e.mode === 'paid' ? 'green' : 'sand'}>${e.mode === 'paid' ? 'بأجر' : 'بدون أجر'}<//>
          ${canEdit && html`<button class="linkbtn" onClick=${() => voidExcuseAsk(e, load)}>تراجع</button>`}</div>`)}
      </div>`}
    </div>
    ${edit && html`<${EditAtt} a=${edit} grace=${grace} lateBy=${lateMin(edit, shifts[edit.staff && edit.staff.shift_id])} lateEx=${excuses.find((e) => e.staff_id === edit.staff_id && e.kind === 'late')}
      onClose=${() => setEdit(null)} onDone=${() => { setEdit(null); load(); window.dispatchEvent(new Event('adm-refresh')); }} />`}
    ${ex && html`<${ExcuseSheet} ...${ex} date=${day} onClose=${() => setEx(null)} onDone=${() => { setEx(null); load(); window.dispatchEvent(new Event('adm-refresh')); }} />`}
  </div>`;
}

function EditAtt({ a, grace, lateBy, lateEx, onClose, onDone }) {
  const [cin, setCin] = useState(toLocalInput(a.check_in));
  const [cout, setCout] = useState(a.check_out ? toLocalInput(a.check_out) : '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [otOk, setOtOk] = useState(a.overtime_ok === true);
  async function toggleOt(v) {
    setOtOk(v);
    const { error } = await sb.rpc('set_overtime_ok', { p_id: a.id, p_ok: v });
    if (error) { setOtOk(!v); return toast(errText(error.message), 'bad'); }
    toast(v ? 'اتعتمد الإضافي' : 'اتلغى اعتماد الإضافي');
  }
  async function save() {
    if (!reason.trim()) return toast('اكتب سبب التعديل.', 'bad');
    setBusy(true);
    const { error } = await sb.rpc('admin_edit_attendance', { p_id: a.id, p_check_in: new Date(cin).toISOString(), p_check_out: cout ? new Date(cout).toISOString() : null, p_reason: reason });
    setBusy(false);
    if (error) return toast(errText(error.message), 'bad');
    toast('اتعدّل السجل');
    onDone();
  }
  async function approve() {
    setBusy(true);
    const { error } = await sb.rpc('review_attendance', { p_id: a.id });
    setBusy(false);
    if (error) return toast(errText(error.message), 'bad');
    toast('اتعتمد السجل');
    onDone();
  }
  async function excuseLate() {
    if (!reason.trim()) return toast('اكتب السبب الأول.', 'bad');
    setBusy(true);
    const { error } = await sb.rpc('excuse_day', { p_staff: a.staff_id, p_date: a.work_date, p_kind: 'late', p_mode: 'paid', p_reason: reason });
    setBusy(false);
    if (error) return toast(errText(error.message), 'bad');
    toast('اتلغى التأخير');
    onDone();
  }
  const canEdit = can('attendance.edit');
  return html`<${Sheet} title=${(a.staff ? a.staff.full_name : 'سجل') + ' · ' + fmtShort(keyToDate(a.work_date))} onClose=${onClose}>
    ${a.closed_by === 'auto' && html`<div class="note warn">اليوم ده اتقفل تلقائيًا على نهاية الشفت لأن الموظف نسي الانصراف. لو اشتغل زيادة، عدّل وقت الانصراف.</div>`}
    ${a.in_zone === false && html`<div class="note bad">الحضور اتسجّل وهو خارج النطاق (${Math.round(a.in_dist_m || 0)} متر).</div>`}
    ${lateEx ? html`<div class="note ok">التأخير اتلغى: ${lateEx.reason}. حضوره بيتحسب من بداية الشفت.</div>` : lateBy > grace ? html`<div class="note warn">اتأخر ${lateBy} دقيقة.</div>` : ''}
    <label class="field">وقت الحضور<input class="input" type="datetime-local" value=${cin} onInput=${(e) => setCin(e.target.value)} /></label>
    <label class="field">وقت الانصراف<input class="input" type="datetime-local" value=${cout} onInput=${(e) => setCout(e.target.value)} /></label>
    ${CTX.S.overtime_requires_approval === true && html`<div class="row"><div class="grow"><div class="h3">اعتماد الساعات الإضافية</div><div class="soft">مش هتتحسب من غير اعتمادك</div></div><${Toggle} on=${otOk} onChange=${toggleOt} /></div>`}
    <label class="field">السبب (للتعديل أو لإلغاء التأخير)<input class="input" placeholder="مثال: نسي يسجّل الانصراف" value=${reason} onInput=${(e) => setReason(e.target.value)} /></label>
    <button class="btn" disabled=${busy} onClick=${save}>حفظ التعديل</button>
    ${canEdit && !lateEx && lateBy > grace && html`<button class="btn ghost" disabled=${busy} onClick=${excuseLate}><${Icon} name="check" size=${20} /> إلغاء التأخير</button>`}
    ${canEdit && lateEx && html`<button class="btn ghost" disabled=${busy} onClick=${() => voidExcuseAsk(lateEx, onDone)}>التراجع عن إلغاء التأخير</button>`}
    ${a.review === 'pending' && html`<button class="btn ghost" disabled=${busy} onClick=${approve}><${Icon} name="check" size=${20} /> اعتماد كما هو</button>`}
    <div class="soft" style="text-align:center">الوقت الأصلي بيتحفظ في سجل النشاط.</div>
  <//>`;
}

function Notifications({ onRead, home }) {
  const { me } = CTX;
  const [rows, setRows] = useState(null);
  async function load() {
    const { data } = await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(60);
    setRows(data || []);
  }
  useEffect(() => { load(); window.addEventListener('adm-refresh', load); return () => window.removeEventListener('adm-refresh', load); }, []);
  async function readAll() { await sb.rpc('mark_notifications_read'); await load(); onRead(); }
  const icon = { late: ['clock', 'amber'], auto_close: ['auto', 'slate'], leave_request: ['sun', 'slate'], advance_request: ['down', 'amber'],
    leave_decision: ['sun', 'green'], advance_decision: ['down', 'green'], adjustment: ['wallet', 'green'], paid: ['wallet', 'green'], excuse: ['check', 'green'] };
  const target = (n) => (home
    ? (n.type === 'adjustment' || n.type === 'paid' ? '#salary' : n.type === 'excuse' ? '#history' : '#requests')
    : n.type === 'leave_request' ? '#requests' : n.type === 'advance_request' ? '#requests/advances' : n.data && n.data.attendance_id ? '#att' : '#notifications');
  return html`<div class="page">
    <${Hero} title="الإشعارات" back=${home || 'dash'} slim />
    <div class="body flat">
      <button class="btn ghost small" onClick=${readAll}><${Icon} name="check" size=${20} /> تعليم الكل كمقروء</button>
      <div class="card tight">
        ${rows === null ? html`<div class="empty">لحظة...</div>` : rows.length === 0 ? html`<div class="empty">مفيش إشعارات.</div>` : rows.map((n) => {
          const [ic, tn] = icon[n.type] || ['bell', 'sand'];
          const unread = !(n.read_by || []).includes(me.id);
          return html`<a class="list-row" href=${target(n)}>
            <${Tile} icon=${ic} tone=${tn} sm />
            <div class="grow"><div style=${'font-weight:' + (unread ? 700 : 500)}>${n.title}</div><div class="soft">${n.body}</div></div>
            <div class="stack" style="align-items:flex-end;gap:4px"><span class="soft num">${fmtTime(n.created_at)}</span>${unread && html`<${Pill} tone="red">جديد<//>`}</div></a>`;
        })}
      </div>
    </div>
  </div>`;
}

/* ---------- settings ---------- */
const reloadSettings = () => window.dispatchEvent(new Event('reload-settings'));

function SetHub() {
  const item = (icon, tone, title, inside, href) => html`<a class="list-row" href=${href}><${Tile} icon=${icon} tone=${tone} /><div class="grow"><div style="font-weight:600;font-size:15.5px">${title}</div><div class="soft">${inside}</div></div><${Chev} /></a>`;
  const ed = can('settings.edit');
  return html`<div class="page">
    <${Hero} title="الإعدادات" sub="كل حاجة في النظام بتتغير من هنا" />
    <div class="body">
      <div class="note info"><b>التغييرات المالية بتسري من تاريخ تحدده</b><br />وأي شهر اتقفل مابيتغيرش، وكل تغيير بيتسجّل في سجل النشاط.</div>
      ${ed && html`<div class="card tight">
        <div class="h2" style="padding:12px 0 4px">الحضور</div>
        ${item('pin', 'red', 'الموقع والنطاق', 'موقع الشغل · نطاق التسجيل · دقة الـ GPS', '#set/location')}
        ${item('clock', 'sand', 'الشفتات', 'الأسماء · مواعيد البداية · عدد الساعات', '#set/shifts')}
        ${item('auto', 'amber', 'قواعد الحضور', 'فترة السماح · الانصراف التلقائي · الإشعارات', '#set/rules')}
      </div>
      <div class="card tight">
        <div class="h2" style="padding:12px 0 4px">المرتبات</div>
        ${item('wallet', 'green', 'حساب المرتب', 'الساعة الإضافية · التأخير · يوم القبض', '#set/pay')}
        ${item('sun', 'slate', 'الإجازات والسلف', 'الأيام المدفوعة · حدود السلف', '#set/leaves')}
      </div>`}
      <div class="card tight">
        <div class="h2" style="padding:12px 0 4px">الأمان</div>
        ${can('roles.manage') && item('shield', 'slate', 'الصلاحيات', 'الأدوار · مين يشوف ويعمل إيه', '#set/perm')}
        ${can('log.view') && item('file', 'sand', 'سجل النشاط', 'مين غيّر إيه وإمتى', '#set/log')}
      </div>
      <button class="btn ghost" onClick=${() => sb.auth.signOut()}><${Icon} name="logout" size=${20} /> تسجيل الخروج</button>
    </div>
  </div>`;
}

function SetLocation() {
  const { S } = CTX;
  const [f, setF] = useState({ lat: S.company_lat ?? '', lon: S.company_lon ?? '', radius: Number(S.radius_m ?? 100), acc: Number(S.min_accuracy_m ?? 150), coz: S.checkout_requires_zone !== false });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));
  async function useHere() {
    setBusy(true);
    try { const p = await getPos(); set('lat', +p.lat.toFixed(6)); set('lon', +p.lon.toFixed(6)); toast('اتحدد موقعك الحالي. اضغط حفظ.'); }
    catch (e) { toast(errText(e.message), 'bad'); }
    setBusy(false);
  }
  async function save() {
    const lat = Number(f.lat), lon = Number(f.lon);
    if (f.lat === '' || f.lon === '' || isNaN(lat) || isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return toast('اكتب إحداثيات صح، أو استخدم زرار موقعي الحالي.', 'bad');
    setBusy(true);
    try { await saveSettings({ company_lat: lat, company_lon: lon, radius_m: f.radius, min_accuracy_m: f.acc, checkout_requires_zone: f.coz }); reloadSettings(); toast('اتحفظت إعدادات الموقع'); }
    catch (e) { toast(errText(e.message), 'bad'); }
    setBusy(false);
  }
  const has = f.lat !== '' && f.lon !== '' && !isNaN(Number(f.lat)) && !isNaN(Number(f.lon));
  return html`<div class="page nonav">
    <${Hero} title="الموقع والنطاق" back="settings" slim />
    <div class="body flat">
      <div class="note info">روح مكان الشغل وإنت شايل الموبايل، واضغط الزرار. بعد كده الموظفين مش هيقدروا يسجّلوا حضور إلا جوه النطاق.</div>
      <div class="card">
        <button class="btn dark" disabled=${busy} onClick=${useHere}><${Icon} name="target" size=${22} /> استخدم موقعي الحالي</button>
        <div class="row" style="align-items:flex-start">
          <label class="field grow">خط العرض<input class="input num-in" inputmode="decimal" value=${f.lat} onInput=${(e) => set('lat', e.target.value)} /></label>
          <label class="field grow">خط الطول<input class="input num-in" inputmode="decimal" value=${f.lon} onInput=${(e) => set('lon', e.target.value)} /></label>
        </div>
        ${has && html`<a class="btn ghost small" target="_blank" rel="noopener" href=${'https://www.google.com/maps?q=' + f.lat + ',' + f.lon}><${Icon} name="pin" size=${20} /> افتح الموقع على الخريطة</a>`}
      </div>
      <div class="card">
        <div class="spread"><div><div class="h3">نطاق التسجيل</div><div class="soft">أقصى مسافة من موقع الشغل</div></div><${Stepper} value=${f.radius} min=${20} max=${2000} step=${10} onChange=${(v) => set('radius', v)} unit=" م" /></div>
        <div class="spread"><div><div class="h3">أقصى خطأ للـ GPS</div><div class="soft">لو الإشارة أضعف من كده بيتطلب إعادة المحاولة</div></div><${Stepper} value=${f.acc} min=${20} max=${1000} step=${10} onChange=${(v) => set('acc', v)} unit=" م" /></div>
        <div class="row"><div class="grow"><div class="h3">الانصراف جوه النطاق كمان</div><div class="soft">لو مقفول، الموظف يسجّل الانصراف من أي مكان</div></div><${Toggle} on=${f.coz} onChange=${(v) => set('coz', v)} /></div>
      </div>
      <button class="btn" disabled=${busy} onClick=${save}>حفظ</button>
    </div>
  </div>`;
}

function SetShifts() {
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState(null);
  async function load() { const { data } = await sb.from('shifts').select('*').order('created_at'); setRows(data || []); }
  useEffect(() => { load(); }, []);
  return html`<div class="page nonav">
    <${Hero} title="الشفتات" back="settings" slim />
    <div class="body flat">
      <button class="btn" onClick=${() => setEdit({ name: '', start_time: '09:00', hours: 8, active: true })}><${Icon} name="plus" size=${22} /> شفت جديد</button>
      <div class="card tight">
        ${rows === null ? html`<div class="empty">لحظة...</div>` : rows.map((s) => html`<button class="list-row" style=${s.active ? '' : 'opacity:.55'} onClick=${() => setEdit(s)}>
          <${Tile} icon="clock" tone="sand" /><div class="grow"><div style="font-weight:600">${s.name}</div><div class="soft num">${shiftRange(s)}</div></div>
          <${Pill}>${Number(s.hours)} ساعات<//>${!s.active && html`<${Pill} tone="red">موقوف<//>`}<${Chev} /></button>`)}
      </div>
    </div>
    ${edit && html`<${ShiftSheet} s=${edit} onClose=${() => setEdit(null)} onDone=${() => { setEdit(null); load(); }} />`}
  </div>`;
}

function ShiftSheet({ s, onClose, onDone }) {
  const [f, setF] = useState({ name: s.name, start: String(s.start_time).slice(0, 5), hours: Number(s.hours), active: s.active });
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!f.name.trim()) return toast('اكتب اسم الشفت.', 'bad');
    setBusy(true);
    const row = { name: f.name.trim(), start_time: f.start, hours: f.hours, active: f.active };
    const { error } = s.id ? await sb.from('shifts').update(row).eq('id', s.id) : await sb.from('shifts').insert(row);
    setBusy(false);
    if (error) return toast(errText(error.message), 'bad');
    toast('اتحفظ الشفت');
    onDone();
  }
  return html`<${Sheet} title=${s.id ? 'تعديل الشفت' : 'شفت جديد'} onClose=${onClose}>
    <label class="field">الاسم<input class="input" value=${f.name} onInput=${(e) => setF({ ...f, name: e.target.value })} /></label>
    <label class="field">بداية الشفت<input class="input" type="time" value=${f.start} onInput=${(e) => setF({ ...f, start: e.target.value })} /></label>
    <div class="spread"><div class="h3">عدد الساعات</div><${Stepper} value=${f.hours} min=${1} max=${24} step=${0.5} onChange=${(v) => setF({ ...f, hours: v })} /></div>
    ${s.id && html`<div class="row"><div class="grow h3">شفت شغال</div><${Toggle} on=${f.active} onChange=${(v) => setF({ ...f, active: v })} /></div>`}
    <div class="note info">تغيير مدة الشفت بيأثر على سعر الساعة والانصراف التلقائي.</div>
    <button class="btn" disabled=${busy} onClick=${save}>حفظ</button>
  <//>`;
}

function SetRules() {
  const { S } = CTX;
  const [f, setF] = useState({ grace: Number(S.grace_minutes ?? 30), auto: S.auto_close_enabled !== false, nl: S.notify_late !== false, na: S.notify_auto_close !== false });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await saveSettings({ grace_minutes: f.grace, auto_close_enabled: f.auto, notify_late: f.nl, notify_auto_close: f.na }); reloadSettings(); toast('اتحفظت قواعد الحضور'); }
    catch (e) { toast(errText(e.message), 'bad'); }
    setBusy(false);
  }
  const row = (t, d, ctrl) => html`<div class="row"><div class="grow"><div class="h3">${t}</div><div class="soft">${d}</div></div>${ctrl}</div>`;
  return html`<div class="page nonav">
    <${Hero} title="قواعد الحضور" back="settings" slim />
    <div class="body flat">
      <div class="card">
        ${row('فترة السماح', 'التأخير لحد الدقايق دي مابيتحسبش تأخير', html`<${Stepper} value=${f.grace} min=${0} max=${120} step=${5} unit=" د" onChange=${(v) => setF({ ...f, grace: v })} />`)}
        ${row('الانصراف التلقائي', 'لو الموظف نسي الانصراف، يقدر يسجّله لحد الساعة 2 الفجر. بعدها اليوم بيتقفل على نهاية شفته من غير إضافي', html`<${Toggle} on=${f.auto} onChange=${(v) => setF({ ...f, auto: v })} />`)}
      </div>
      <div class="card">
        <div class="h2">الإشعارات للإدارة</div>
        ${row('لما موظف يتأخر', 'إشعار لحظي', html`<${Toggle} on=${f.nl} onChange=${(v) => setF({ ...f, nl: v })} />`)}
        ${row('لما يتقفل يوم تلقائيًا', 'عشان تراجعه', html`<${Toggle} on=${f.na} onChange=${(v) => setF({ ...f, na: v })} />`)}
      </div>
      <button class="btn" disabled=${busy} onClick=${save}>حفظ</button>
    </div>
  </div>`;
}

function SetLog() {
  const [rows, setRows] = useState(null);
  const [names, setNames] = useState({});
  useEffect(() => {
    sb.from('staff').select('id,full_name').then(({ data }) => { const m = {}; (data || []).forEach((s) => { m[s.id] = s.full_name; }); setNames(m); });
    sb.from('activity_log').select('*').order('created_at', { ascending: false }).limit(80).then(({ data }) => setRows(data || []));
  }, []);
  const ENT = { settings: 'إعداد', staff: 'موظف', shifts: 'شفت', attendance: 'حضور' };
  const ACT = { INSERT: 'إضافة', UPDATE: 'تعديل', DELETE: 'حذف' };
  const desc = (r) => {
    if (r.entity === 'settings' && r.new) return 'إعداد ' + r.new.key + ' = ' + JSON.stringify(r.new.value) + ' (من ' + r.new.effective_from + ')';
    if (r.entity === 'staff') return (ACT[r.action] || r.action) + ' موظف: ' + ((r.new && r.new.full_name) || (r.old && r.old.full_name) || '');
    if (r.entity === 'shifts') return (ACT[r.action] || r.action) + ' شفت: ' + ((r.new && r.new.name) || (r.old && r.old.name) || '');
    return (ACT[r.action] || r.action) + ' ' + (ENT[r.entity] || r.entity);
  };
  const when = (iso) => fmtShort(iso) + ' ' + fmtTime(iso);
  return html`<div class="page nonav">
    <${Hero} title="سجل النشاط" back="settings" slim />
    <div class="body flat"><div class="card tight">
      ${rows === null ? html`<div class="empty">لحظة...</div>` : rows.length === 0 ? html`<div class="empty">لسه مفيش نشاط.</div>` : rows.map((r) => html`<div class="list-row">
        <div class="grow"><div style="font-weight:500;font-size:14px">${desc(r)}</div><div class="soft">${r.actor ? names[r.actor] || 'إدارة' : 'النظام'} · ${when(r.created_at)}</div></div></div>`)}
    </div></div>
  </div>`;
}

/* ---------- settings: pay, leaves + advances, permissions ---------- */
function SetPay() {
  const { S } = CTX;
  const [f, setF] = useState({
    ot: Number(S.overtime_pct ?? 150), otNeed: S.overtime_requires_approval === true, maxH: Number(S.max_hours_per_day ?? 14),
    lateOn: S.late_extra_deduction_enabled === true, tiers: Array.isArray(S.late_tiers) ? S.late_tiers : [{ from: 31, to: 60, pct: 10 }, { from: 61, to: 120, pct: 25 }, { from: 121, to: 1440, pct: 50 }],
    payday: Number(S.payday_day ?? 1),
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));
  const setTier = (i, k, v) => set('tiers', f.tiers.map((t, x) => (x === i ? { ...t, [k]: Number(v) || 0 } : t)));
  async function save() {
    setBusy(true);
    try {
      await saveSettings({ overtime_pct: f.ot, overtime_requires_approval: f.otNeed, max_hours_per_day: f.maxH, late_extra_deduction_enabled: f.lateOn, late_tiers: f.tiers, payday_day: f.payday });
      reloadSettings();
      toast('اتحفظت قواعد المرتب. بتسري من النهارده.');
    } catch (e) { toast(errText(e.message), 'bad'); }
    setBusy(false);
  }
  const days = Array.from({ length: 28 }, (_, i) => i + 1);
  const row = (t, d, ctrl) => html`<div class="row"><div class="grow"><div class="h3">${t}</div><div class="soft">${d}</div></div>${ctrl}</div>`;
  return html`<div class="page nonav">
    <${Hero} title="حساب المرتب" back="settings" slim />
    <div class="body flat">
      <div class="card">
        <div class="row"><${Tile} icon="clock" tone="sand" sm /><div class="grow"><div class="h3">سعر الساعة</div><div class="soft">المرتب ÷ أيام الشهر ÷ ساعات الشفت. الرصيد بيزيد بالساعة الكاملة حسب مواعيد الشفت: الساعة اللي قبل الشفت مش بتتحسب، وبعد نهاية الشفت بتتحسب إضافي.</div></div></div>
        <div class="note info">مثال: 10,000 ÷ 30 ÷ 8 = ${fmtMoney(10000 / 30 / 8)} ج.م للساعة، والساعة الإضافية ${fmtMoney((10000 / 30 / 8) * f.ot / 100)} ج.م.</div>
      </div>
      <div class="card">
        ${row('الساعة الإضافية', 'نسبة من سعر الساعة العادي', html`<${Stepper} value=${f.ot} min=${100} max=${300} step=${5} unit="٪" onChange=${(v) => set('ot', v)} />`)}
        ${row('الإضافي بموافقتك', 'لو مفتوح، الساعات الزيادة مابتتحسبش غير لما تعتمدها من صفحة الحضور', html`<${Toggle} on=${f.otNeed} onChange=${(v) => set('otNeed', v)} />`)}
        ${row('أقصى ساعات في اليوم', 'أي ساعات أكتر مابتتحسبش', html`<${Stepper} value=${f.maxH} min=${8} max=${24} onChange=${(v) => set('maxH', v)} />`)}
      </div>
      <div class="card">
        ${row('خصم تأخير إضافي', 'مقفول: التأخير بيقلل الساعات أصلًا. فعّله لو عايز خصم زيادة بالشرائح.', html`<${Toggle} on=${f.lateOn} onChange=${(v) => set('lateOn', v)} />`)}
        ${f.lateOn && html`<div class="stack">
          <div class="soft">لو الموظف اتأخر من ... لحد ... دقيقة، يتخصم نسبة من يوم الشغل:</div>
          ${f.tiers.map((t, i) => html`<div class="row"><label class="field grow">من (د)<input class="input num-in" inputmode="numeric" value=${t.from} onInput=${(e) => setTier(i, 'from', e.target.value)} /></label>
            <label class="field grow">إلى (د)<input class="input num-in" inputmode="numeric" value=${t.to} onInput=${(e) => setTier(i, 'to', e.target.value)} /></label>
            <label class="field grow">نسبة ٪<input class="input num-in" inputmode="numeric" value=${t.pct} onInput=${(e) => setTier(i, 'pct', e.target.value)} /></label>
            <button class="iconbtn light" aria-label="حذف" style="margin-top:22px" onClick=${() => set('tiers', f.tiers.filter((_, x) => x !== i))}><${Icon} name="close" size=${18} /></button></div>`)}
          <button class="btn ghost small" onClick=${() => set('tiers', [...f.tiers, { from: 0, to: 0, pct: 0 }])}><${Icon} name="plus" size=${20} /> شريحة جديدة</button></div>`}
      </div>
      <div class="card">
        <div class="row"><${Tile} icon="calendar" tone="red" sm /><div class="grow"><div class="h3">يوم القبض</div><div class="soft">القبض دايمًا عن الشهر اللي قبله، في اليوم ده من كل شهر.</div></div></div>
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px;direction:ltr">${days.map((d) => html`<button type="button" class=${'chip' + (f.payday === d ? ' on' : '')} style="padding:0;height:44px;border-radius:14px" onClick=${() => set('payday', d)}>${d}</button>`)}</div>
        <button type="button" class=${'chip' + (f.payday === 31 ? ' on' : '')} onClick=${() => set('payday', 31)}>آخر يوم في الشهر</button>
        <div class="note info">مرتب ${monthShort(monthStart(todayKey()))} بيتصرف ${fmtShort(keyToDate(paydayOf(monthStart(todayKey()), { payday_override: f.payday })))}.</div>
      </div>
      <button class="btn" disabled=${busy} onClick=${save}>حفظ</button>
    </div>
  </div>`;
}

function SetLeaves() {
  const { S } = CTX;
  const curPen = Number(S.absence_penalty_days ?? 0);
  const [f, setF] = useState({
    paid: Number(S.paid_leave_days ?? 2),
    extra: S.extra_leave_deduction === 'none' ? 'none' : 'full_day',
    pen: curPen,
    penFrom: addDays(todayKey(), 1),
    pct: Number(S.advance_max_pct ?? 50),
    inst: Number(S.advance_max_installments ?? 3),
    nr: S.notify_requests !== false,
  });
  const [sched, setSched] = useState(null);
  const [busy, setBusy] = useState(false);

  // if a penalty is scheduled to start on a coming date, show it
  useEffect(() => {
    sb.from('settings').select('value,effective_from').eq('key', 'absence_penalty_days')
      .gt('effective_from', todayKey()).order('effective_from', { ascending: false }).limit(1)
      .then(({ data }) => {
        const r = data && data[0];
        setSched(r || null);
        if (r) setF((o) => ({ ...o, pen: Number(r.value), penFrom: r.effective_from }));
      });
  }, []);

  async function save() {
    setBusy(true);
    try {
      await saveSettings({ paid_leave_days: f.paid, extra_leave_deduction: f.extra, advance_max_pct: f.pct, advance_max_installments: f.inst, notify_requests: f.nr });
      const base = sched ? Number(sched.value) : curPen;
      if (f.pen !== base) {
        await saveSettings({ absence_penalty_days: f.pen }, f.penFrom);
        setSched(f.penFrom > todayKey() ? { value: f.pen, effective_from: f.penFrom } : null);
      }
      reloadSettings();
      toast('اتحفظت الإعدادات');
    } catch (e) { toast(errText(e.message), 'bad'); }
    setBusy(false);
  }

  const row = (t, d, ctrl) => html`<div class="row"><div class="grow"><div class="h3">${t}</div><div class="soft">${d}</div></div>${ctrl}</div>`;
  return html`<div class="page nonav">
    <${Hero} title="الإجازات والسلف" back="settings" slim />
    <div class="body flat">
      <div class="card">
        <div class="h2">الإجازات</div>
        ${row('أيام إجازة مدفوعة في الشهر', 'بتتحسب كأنه اشتغل ساعات الشفت', html`<${Stepper} value=${f.paid} min=${0} max=${10} onChange=${(v) => setF({ ...f, paid: v })} />`)}
        <div><div class="h3" style="margin-bottom:8px">الأيام الزيادة عن كده (لو الإدارة وافقت)</div><div class="chips">
          <button class=${'chip' + (f.extra === 'full_day' ? ' on' : '')} onClick=${() => setF({ ...f, extra: 'full_day' })}>من غير أجر</button>
          <button class=${'chip' + (f.extra === 'none' ? ' on' : '')} onClick=${() => setF({ ...f, extra: 'none' })}>بأجر برضه</button></div></div>
      </div>
      <div class="card">
        <div class="h2">الغياب بدون إذن</div>
        <div class="note info">الموظف لازم يطلب الإجازة الأول. لو الإدارة وافقت، اليوم بس هو اللي بيضيع. لو ماطلبش، أو الطلب اترفض، اليوم بيضيع وبيتخصم غرامة زيادة.</div>
        ${row('غرامة الغياب بدون إذن', 'أيام بتتخصم زيادة عن اليوم الضايع (0 = مقفولة)', html`<${Stepper} value=${f.pen} min=${0} max=${5} step=${0.5} unit=" يوم" onChange=${(v) => setF({ ...f, pen: v })} />`)}
        ${f.pen > 0 && html`<label class="field">بتبدأ من تاريخ<input class="input" type="date" value=${f.penFrom} min=${todayKey()} onInput=${(e) => setF({ ...f, penFrom: e.target.value })} />
          <span class="hint">الأيام قبل التاريخ ده مابيتخصمش عليها غرامة</span></label>`}
        ${sched && html`<div class="note ok">مجدولة: غرامة ${sched.value} يوم من ${fmtShort(keyToDate(sched.effective_from))}.</div>`}
      </div>
      <div class="card">
        <div class="h2">السلف</div>
        ${row('أقصى سلفة', 'نسبة من المرتب الأساسي', html`<${Stepper} value=${f.pct} min=${10} max=${100} step=${5} unit="٪" onChange=${(v) => setF({ ...f, pct: v })} />`)}
        ${row('أقصى عدد أقساط', 'بيختار منها الموظف وأنت بتعدّلها وقت القبول', html`<${Stepper} value=${f.inst} min=${1} max=${12} onChange=${(v) => setF({ ...f, inst: v })} />`)}
      </div>
      <div class="card">${row('إشعار بالطلبات الجديدة', 'للإدارة لما موظف يطلب إجازة أو سلفة', html`<${Toggle} on=${f.nr} onChange=${(v) => setF({ ...f, nr: v })} />`)}</div>
      <button class="btn" disabled=${busy} onClick=${save}>حفظ</button>
    </div>
  </div>`;
}

function SetPerm() {
  const { S } = CTX;
  const init = { manager: [], hr: [], accountant: [], ...DEFAULT_PERMS, ...(S.role_permissions || {}) };
  const [perms, setPerms] = useState(init);
  const [staff, setStaff] = useState(null);
  const [busy, setBusy] = useState(false);
  const ROLES = [['manager', 'مدير'], ['hr', 'موارد بشرية'], ['accountant', 'محاسب']];
  async function loadStaff() { const { data } = await sb.from('staff').select('id,full_name,code,role,active').order('code'); setStaff(data || []); }
  useEffect(() => { loadStaff(); }, []);
  const toggle = (role, p) => setPerms((o) => ({ ...o, [role]: o[role].includes(p) ? o[role].filter((x) => x !== p) : [...o[role], p] }));
  async function save() {
    setBusy(true);
    try { await saveSettings({ role_permissions: perms }); reloadSettings(); toast('اتحفظت الصلاحيات'); }
    catch (e) { toast(errText(e.message), 'bad'); }
    setBusy(false);
  }
  async function setRole(s, role) {
    if (!confirm('تغيير دور ' + s.full_name + ' إلى ' + (ROLE_LABEL[role] || role) + '؟')) { loadStaff(); return; }
    const { error } = await sb.from('staff').update({ role }).eq('id', s.id);
    if (error) toast(errText(error.message), 'bad'); else toast('اتغيّر الدور');
    loadStaff();
  }
  return html`<div class="page nonav">
    <${Hero} title="الصلاحيات" back="settings" slim />
    <div class="body flat">
      <div class="note info">المدير العام عنده كل الصلاحيات دايمًا ومش بيتعدّل. حدّد لكل دور تاني هيشوف ويعمل إيه.</div>
      ${ROLES.map(([role, label]) => html`<div class="card"><div class="h2">${label}</div>
        ${PERMS.map(([p, l]) => html`<div class="row"><div class="grow" style="font-size:14.5px">${l}</div><${Toggle} on=${perms[role].includes(p)} onChange=${() => toggle(role, p)} /></div>`)}</div>`)}
      <button class="btn" disabled=${busy} onClick=${save}>حفظ الصلاحيات</button>
      <div class="card tight">
        <div class="h2" style="padding:12px 0 4px">دور كل حد</div>
        ${staff === null ? html`<div class="empty">لحظة...</div>` : staff.map((s) => html`<div class="list-row">
          <div class="avatar tone-sand">${initial(s.full_name)}</div>
          <div class="grow"><div style="font-weight:600">${s.full_name}</div><div class="soft">كود ${s.code}${s.active ? '' : ' · موقوف'}</div></div>
          <select class="select" style="width:auto;height:44px" value=${s.role} onChange=${(e) => setRole(s, e.target.value)}>
            ${Object.entries(ROLE_LABEL).map(([k, v]) => html`<option value=${k} selected=${s.role === k}>${v}</option>`)}</select></div>`)}
      </div>
    </div>
  </div>`;
}

/* ================= admin shell ================= */
const ADM_NAV_ALL = [
  { id: 'dash', icon: 'home', label: 'اليوم' },
  { id: 'pay', icon: 'wallet', label: 'المرتبات', ok: () => can('payroll.view') },
  { id: 'settings', icon: 'sliders', label: 'الإعدادات', ok: () => can('settings.edit') || can('roles.manage') || can('log.view') },
];

function AdminShell({ route }) {
  const { me } = CTX;
  const [unread, setUnread] = useState(0);
  const parts = (route || 'dash').split('/');
  const head = parts[0] || 'dash';
  async function loadUnread() {
    const { data } = await sb.from('notifications').select('id,read_by').order('created_at', { ascending: false }).limit(60);
    setUnread((data || []).filter((n) => !(n.read_by || []).includes(me.id)).length);
  }
  useEffect(() => {
    loadUnread();
    const ch = sb.channel('adm-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (p) => {
        toast((p.new.title || 'إشعار') + ': ' + (p.new.body || ''));
        loadUnread();
        window.dispatchEvent(new Event('adm-refresh'));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => window.dispatchEvent(new Event('adm-refresh')))
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, []);
  const navItems = ADM_NAV_ALL.filter((n) => !n.ok || n.ok());
  const gate = (ok, node) => (ok ? node : html`<${Denied} />`);
  let view;
  let tab = head;
  let hideNav = false;
  if (head === 'employee' && parts[1]) { view = gate(can('employees.view'), html`<${AdmEmployee} id=${parts[1]} key=${parts[1]} />`); tab = 'dash'; hideNav = true; }
  else if (head === 'add') { view = gate(can('employees.edit'), html`<${AdmAdd} />`); tab = 'dash'; hideNav = true; }
  else if (head === 'employees') { view = html`<${AdmDash} unread=${unread} />`; tab = 'dash'; }
  else if (head === 'att') { view = gate(can('attendance.view'), html`<${AdmAtt} />`); tab = 'dash'; }
  else if (head === 'pay') view = gate(can('payroll.view'), html`<${AdmPay} />`);
  else if (head === 'payroll') { view = gate(can('payroll.view'), html`<${AdmPayroll} id=${parts[1]} month=${parts[2]} key=${parts[1] + parts[2]} />`); tab = 'pay'; hideNav = true; }
  else if (head === 'backfill') { view = gate(can('payroll.edit'), html`<${Backfill} id=${parts[1]} month=${parts[2]} key=${parts[1] + parts[2]} />`); tab = 'pay'; hideNav = true; }
  else if (head === 'requests') { view = gate(can('leaves.decide') || can('advances.decide'), html`<${AdmRequests} tabInit=${parts[1]} key=${parts[1]} />`); tab = 'dash'; }
  else if (head === 'notifications') { view = html`<${Notifications} onRead=${loadUnread} />`; tab = 'dash'; }
  else if (head === 'settings') view = gate(navItems.some((n) => n.id === 'settings'), html`<${SetHub} />`);
  else if (head === 'set') {
    tab = 'settings'; hideNav = true;
    const m = {
      location: [can('settings.edit'), SetLocation], shifts: [can('settings.edit'), SetShifts], rules: [can('settings.edit'), SetRules],
      pay: [can('settings.edit'), SetPay], leaves: [can('settings.edit'), SetLeaves], perm: [can('roles.manage'), SetPerm], log: [can('log.view'), SetLog],
    }[parts[1]];
    view = m ? gate(m[0], html`<${m[1]} />`) : html`<${SetHub} />`;
    if (!m) hideNav = false;
  } else { view = html`<${AdmDash} unread=${unread} />`; tab = 'dash'; }
  return html`<div style="height:100%">${view}${!hideNav && html`<${Nav} items=${navItems} tab=${tab} />`}</div>`;
}

/* ================= app root ================= */
function App() {
  const [session, setSession] = useState(undefined);
  const [me, setMe] = useState(undefined);
  const [S, setS] = useState({});
  const [shift, setShift] = useState(null);
  const [route, setRoute] = useState(location.hash.slice(1));
  const [tst, setTst] = useState(null);
  const tmr = useRef(null);

  toastFn = ({ text, kind }) => { setTst({ text, kind }); clearTimeout(tmr.current); tmr.current = setTimeout(() => setTst(null), 3800); };
  CTX = { me: me || null, S, shift };

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    const h = () => setRoute(location.hash.slice(1));
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  useEffect(() => {
    const h = async () => { try { const m = await loadSettingsMap(); CTX.S = m; setS(m); } catch (e) { /* keep old */ } };
    window.addEventListener('reload-settings', h);
    return () => window.removeEventListener('reload-settings', h);
  }, []);
  useEffect(() => {
    if (session === undefined) return;
    if (!session) { setMe(null); return; }
    (async () => {
      setMe(undefined);
      try {
        const { data: staff, error } = await sb.from('staff').select('*').eq('id', session.user.id).maybeSingle();
        if (error) throw error;
        if (!staff || !staff.active) { setMe(false); return; }
        const m = await loadSettingsMap();
        CTX.S = m;
        setS(m);
        if (staff.shift_id) { const { data: sh } = await sb.from('shifts').select('*').eq('id', staff.shift_id).maybeSingle(); setShift(sh); } else setShift(null);
        setMe(staff);
        if (!location.hash) location.hash = staff.role === 'employee' ? '#home' : '#dash';
      } catch (e) { toast(errText(e.message), 'bad'); setMe(false); }
    })();
  }, [session]);
  useEffect(() => { window.__mounted = true; const b = document.getElementById('boot'); if (b) b.remove(); }, []);

  let body;
  if (session === undefined || (session && (me === undefined || me === null))) body = html`<div class="center"><img src="captain-logo.png" alt="الكابتن" /></div>`;
  else if (!session) body = html`<${Login} />`;
  else if (me === false) body = html`<div class="login"><div class="login-sheet" style="margin-top:80px">
      <div class="h2">الحساب مش مفعّل</div><div class="soft">كلّم الإدارة عشان تفعّل حسابك.</div>
      <button class="btn dark" onClick=${() => sb.auth.signOut()}>تسجيل الخروج</button></div></div>`;
  else body = me.role === 'employee' ? html`<${EmployeeShell} route=${route} />` : html`<${AdminShell} route=${route} />`;

  return html`${body}${tst && html`<div class=${'toast' + (tst.kind === 'bad' ? ' bad' : '')} role="status">${tst.text}</div>`}`;
}

render(html`<${App} />`, document.getElementById('app'));
