import { html, render, useState, useEffect, useMemo, useRef } from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js';
import { SUPABASE_URL, SUPABASE_KEY, DOMAIN } from './config.js?v=1';
import { Icon } from './icons.js?v=1';
import * as P from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js';

if (!window.supabase) throw new Error('The Supabase library did not load (cdn.jsdelivr.net)');
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// current user, settings and shift, refreshed by App() on every render
let CTX = { me: null, S: {}, shift: null };
let toastFn = () => {};
const toast = (text, kind) => toastFn({ text, kind });

/* ================= helpers ================= */
const tzOf = () => CTX.S.timezone || 'Africa/Cairo';
const AR = 'ar-EG-u-nu-latn';
// a missing / invalid date shows "—" instead of crashing the screen (Safari throws RangeError on Invalid Date)
const safeFmt = (opts, v) => {
  if (!v) return '—';
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat(AR, { ...opts, timeZone: tzOf() }).format(d);
};
const fmtTime = (iso) => safeFmt({ hour: '2-digit', minute: '2-digit', hour12: true }, iso);
const fmtDay = (iso) => safeFmt({ weekday: 'long', day: 'numeric', month: 'long' }, iso);
const fmtShort = (iso) => safeFmt({ weekday: 'short', day: 'numeric', month: 'short' }, iso);
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
  else if (navStack[navStack.length - 1] !== r) navStack.push(r);
});
const goBack = (fallback) => {
  const prev = navStack.length > 1 ? navStack[navStack.length - 2] : '';
  location.replace('#' + (prev || fallback));
};
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

/* ================= error boundary: a crashing page shows its error instead of freezing the app ================= */
const Boundary = P.Component
  ? class extends P.Component {
    constructor(props) { super(props); this.state = { err: null }; }
    static getDerivedStateFromError(err) { return { err }; }
    componentDidCatch(err) { console.error(err); }
    render(props, state) {
      if (!state.err) return props.children;
      const msg = String((state.err && (state.err.stack || state.err.message)) || state.err).slice(0, 500);
      return html`<div class="page"><${Hero} title="حصلت مشكلة" slim />
        <div class="body flat"><div class="card">
          <div class="note bad" dir="ltr" style="font-size:12px;word-break:break-word;text-align:left">${msg}</div>
          <a class="btn" href="#dash">الرئيسية</a>
        </div></div></div>`;
    }
  }
  : ({ children }) => children;

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
  const [pos, setPos] = useState(null);
  const [gpsErr, setGpsErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [pay, setPay] = useState(null);

  async function load() {
    const a = await sb.from('attendance').select('*').eq('staff_id', me.id).order('check_in', { ascending: false }).limit(1);
    setLast(a.data && a.data[0] ? a.data[0] : null);
    const pr = await sb.rpc('my_payroll', { p_month: monthStart(todayKey()) });
    if (!pr.error) setPay(pr.data);
  }
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
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

  let zone;
  if (me.any_location) zone = { tone: 'green', icon: 'pin', text: 'مسموحلك تسجّل من أي مكان' };
  else if (clat == null || clon == null) zone = { tone: 'amber', icon: 'pin', text: 'الإدارة لسه ما حددتش موقع الشغل' };
  else if (gpsErr) zone = { tone: 'amber', icon: 'pin', text: gpsErr };
  else if (!pos) zone = { tone: 'sand', icon: 'pin', text: 'بنحدد موقعك...' };
  else if (inside) zone = { tone: 'green', icon: 'pin', text: 'أنت في مكان الشغل، تقدر تسجّل' };
  else zone = { tone: 'red', icon: 'pin', text: 'أنت بعيد عن مكان الشغل. لازم تكون فيه عشان تسجّل' };

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

  const showDue = !!(open && shift && S.auto_close_enabled !== false);
  const shiftEndLabel = shift ? hm12(shiftStartMin(shift) + Math.round(Number(shift.hours) * 60)) : '';
  const center = 'align-items:center;text-align:center;gap:10px';

  return html`<div class="page">
    <${Hero} title=${greet() + ' يا ' + firstName(me.full_name)} sub=${fmtDay(new Date())} bell=${html`<${Bell} count=${unread} />`} />
    <div class="body">
      ${last === undefined ? html`<div class="card"><div class="empty">لحظة...</div></div>` : open ? html`
        <div class="card" style=${center}>
          <${Tile} icon="check" tone="green" />
          <div class="h2">أنت حاضر دلوقتي</div>
          <div class="soft">سجّلت حضورك الساعة ${fmtTime(open.check_in)}</div>
          ${shift && html`<div class="soft">شفتك بيخلص الساعة ${shiftEndLabel}</div>`}
          ${open.in_zone === false && html`<div class="note warn">حضورك اتسجّل من خارج مكان الشغل.</div>`}
          <button class="btn dark bigbtn" style="width:100%" disabled=${busy} onClick=${() => act('check_out')}><${Icon} name="out" size=${24} /> ${busy ? 'لحظة...' : 'سجّل انصرافك'}</button>
        </div>
        ${showDue && html`<div class="note info">لو نسيت تسجّل انصرافك، بيتسجّل لوحده على نهاية شفتك.</div>`}
      ` : doneToday ? html`
        <div class="card" style=${center}>
          <${Tile} icon="check" tone="green" />
          <div class="h2">خلّصت يومك، تسلم إيدك</div>
          <div class="soft">حضور ${fmtTime(last.check_in)} · انصراف ${fmtTime(last.check_out)}</div>
          ${last.closed_by === 'auto' && html`<div class="note warn">انصرافك اتسجّل لوحده على نهاية شفتك لأنك نسيت تسجّله.</div>`}
        </div>` : html`
        <div class="card" style=${center}>
          <${Tile} icon="clock" />
          <div class="h2">لسه ما سجّلتش حضورك</div>
          ${shift && html`<div class="soft">شفتك النهارده</div><div class="h2 num">${shiftRange(shift)}</div>`}
          <div class=${'row note ' + (zone.tone === 'green' ? 'ok' : zone.tone === 'red' ? 'bad' : zone.tone === 'amber' ? 'warn' : 'info')} style="width:100%;text-align:start">
            <${Icon} name=${zone.icon} size=${20} /><div class="grow" style="font-weight:500">${zone.text}</div></div>
          <button class="btn bigbtn" style="width:100%" disabled=${busy} onClick=${() => act('check_in')}><${Icon} name="check" size=${24} /> ${busy ? 'لحظة...' : 'سجّل حضورك'}</button>
        </div>`}

      ${pay && pay.calc && html`<a class="card" href="#salary" style="gap:8px">
        <div class="row"><${Tile} icon="wallet" tone="red" /><div class="grow"><div class="soft">رصيدك لحد دلوقتي</div>
          <div class="num" style="font-family:var(--hf);font-weight:600;font-size:30px;line-height:1.25">${fmtMoney(pay.calc.net)} <span class="soft" style="font-size:14px">ج.م</span></div></div><${Chev} /></div>
        <div class="soft">القبض ${fmtShort(keyToDate(paydayOf(monthStart(todayKey()), me)))}</div></a>`}
      <a class="btn ghost" href="#history"><${Icon} name="calendar" size=${20} /> سجل حضوري</a>
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
    <${Hero} title="سجل الحضور" sub="آخر 60 يوم" back="home" slim />
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
  const [adjs, setAdjs] = useState([]);
  const [more, setMore] = useState(false);
  const cur = monthStart(todayKey());
  async function load() {
    const [a, b] = await Promise.all([
      sb.rpc('my_payroll', { p_month: month }),
      sb.from('pay_adjustments').select('*').eq('staff_id', me.id).eq('voided', false).gte('effective_date', month).lt('effective_date', addMonths(month, 1)).order('effective_date', { ascending: false }),
    ]);
    if (a.error) toast(errText(a.error.message), 'bad'); else setRes(a.data);
    setAdjs(b.data || []);
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
        <div class="soft">${isCur ? 'رصيدك لحد دلوقتي' : 'صافي مرتب الشهر'}</div>
        <div class="num" style="font-family:var(--hf);font-weight:600;font-size:44px;line-height:1.2">${c ? fmtMoney(c.net) : '...'} <span class="soft" style="font-size:18px">ج.م</span></div>
        <div class="chips" style="justify-content:center">
          ${res && res.status === 'paid' ? html`<${Pill} tone="green" icon="check">اتصرف<//>` : html`<${Pill} tone="sand" icon="calendar">القبض ${fmtShort(keyToDate(pd))}<//>${left > 0 && html`<${Pill} tone="green">باقي ${left} يوم<//>`}`}
        </div>
      </div>
      ${prevDue && html`<a class="note warn" href="#salary" onClick=${() => setMonth(addMonths(cur, -1))}><b>مرتب ${monthShort(addMonths(cur, -1))} لسه ما اتصرفش</b><br />${fmtMoney(prev.calc.net)} ج.م · القبض ${fmtShort(keyToDate(paydayOf(addMonths(cur, -1), me)))}</a>`}
      <${MonthChips} month=${month} setMonth=${setMonth} />
      <button class="btn ghost" onClick=${() => setMore(!more)}>${more ? 'إخفاء التفاصيل' : 'شوف الحساب بالتفصيل'}</button>
      ${more && (c ? html`<${PayBreakdown} c=${c} />` : html`<div class="card"><div class="empty">لحظة...</div></div>`)}
      ${more && adjs.length > 0 && html`<div class="card tight">
        <div class="h2" style="padding:12px 0 4px">المكافآت والخصومات</div>
        ${adjs.map((a) => html`<div class="list-row"><${Tile} icon=${a.kind === 'bonus' ? 'gift' : 'minus'} tone=${a.kind === 'bonus' ? 'green' : 'red'} sm />
          <div class="grow"><div style="font-weight:500">${a.reason}</div><div class="soft">${fmtShort(keyToDate(a.effective_date))}</div></div>
          <div class=${'amt ' + (a.kind === 'bonus' ? 'pos' : 'neg')}>${(a.kind === 'bonus' ? '+' : '−') + fmtMoney(a.amount)}</div></div>`)}
      </div>`}
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
  { id: 'salary', icon: 'wallet', label: 'رصيدي' },
  { id: 'requests', icon: 'file', label: 'طلباتي' },
  { id: 'profile', icon: 'user', label: 'حسابي' },
];

function EmployeeShell({ route }) {
  const { me } = CTX;
  const [unread, setUnread] = useState(0);
  const page = ['home', 'history', 'salary', 'requests', 'profile'].includes(route) ? route : 'home';
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
  const view = { home: html`<${EmpHome} unread=${unread} />`, history: html`<${EmpHistory} />`, salary: html`<${EmpSalary} />`, requests: html`<${EmpRequests} />`, profile: html`<${Profile} />` }[page];
  return html`<div style="height:100%"><${Boundary} key=${route}>${view}<//><${Nav} items=${EMP_NAV} tab=${page === 'history' ? 'home' : page} /></div>`;
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
        ${can('attendance.view') && html`<a class="list-row" href="#month"><${Tile} icon="calendar" tone="slate" sm /><div class="grow" style="font-weight:500">الجدول الشهري لكل موظف</div><${Chev} /></a>`}
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
  const [box, setBox] = useState(null); // { tab, data }: rows are always tagged with the tab they belong to
  const [dec, setDec] = useState(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  async function load() {
    const t = tab;
    const { data } = await sb.from(t).select('*, staff(full_name, code)').order('created_at', { ascending: false }).limit(60);
    if (tabRef.current !== t) return; // the user already switched tab, ignore this late answer
    setBox({ tab: t, data: (data || []).sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1)) });
  }
  useEffect(() => { load(); window.addEventListener('adm-refresh', load); return () => window.removeEventListener('adm-refresh', load); }, [tab]);
  const rows = box && box.tab === tab ? box.data : null; // other tab's rows are never drawn with this tab's layout
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
        ${adjs.length === 0 ? html`<div class="empty">مفي
