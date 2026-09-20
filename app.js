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
const fullHours = (a) => Math.max(0, Math.floor(((a.check_out ? new Date(a.check_out) : new Date()) - new Date(a.check_in)) / 3600000));
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

function errText(msg) {
  const m = String(msg || '');
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
async function saveSettings(obj) {
  const rows = Object.entries(obj).map(([key, value]) => ({ key, value, effective_from: todayKey(), changed_by: CTX.me.id }));
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
        ? html`<div class="row"><a class="iconbtn" href=${'#' + back} aria-label="رجوع"><${Icon} name="back" size=${22} /></a><div class="hero-title inline">${title}</div></div>`
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

function EmpHome() {
  const { me, S, shift } = CTX;
  const [last, setLast] = useState(undefined);
  const [month, setMonth] = useState([]);
  const [pos, setPos] = useState(null);
  const [gpsErr, setGpsErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  async function load() {
    const first = todayKey().slice(0, 8) + '01';
    const [a, b] = await Promise.all([
      sb.from('attendance').select('*').eq('staff_id', me.id).order('check_in', { ascending: false }).limit(1),
      sb.from('attendance').select('*').eq('staff_id', me.id).gte('work_date', first),
    ]);
    setLast(a.data && a.data[0] ? a.data[0] : null);
    setMonth(b.data || []);
  }
  useEffect(() => { load(); }, []);
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
  const hoursSum = month.reduce((s, a) => s + fullHours(a), 0);
  const elapsed = open ? now - new Date(open.check_in).getTime() : 0;
  const shiftMs = shift ? Number(shift.hours) * 3600000 : 0;
  const dueAt = open && shift && S.auto_close_enabled !== false ? new Date(open.check_in).getTime() + shiftMs : null;

  return html`<div class="page">
    <${Hero} title=${greet() + ' يا ' + firstName(me.full_name)} sub=${fmtDay(new Date())} />
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
            <div class="grow"><div style="font-weight:600;font-size:14px">${Math.floor(elapsed / 3600000)} ساعة كاملة اتحسبت</div>
              <div class="soft">الساعة الجاية بعد ${60 - (Math.floor(elapsed / 60000) % 60)} دقيقة</div></div>
          </div>
          <button class="btn dark bigbtn" disabled=${busy} onClick=${() => act('check_out')}><${Icon} name="out" size=${24} /> ${busy ? 'لحظة...' : 'سجّل انصرافك'}</button>
        </div>
        ${dueAt && html`<div class="note warn"><b>انصراف تلقائي لو نسيت</b><br />لو نسيت تسجّل انصرافك، هيتقفل يومك تلقائيًا الساعة ${fmtTime(dueAt)}.</div>`}
      ` : doneToday ? html`
        <div class="card">
          <div class="row"><${Tile} icon="check" tone="green" /><div class="grow"><div class="h2">خلّصت يومك</div>
            <div class="soft">حضور ${fmtTime(last.check_in)} · انصراف ${fmtTime(last.check_out)}</div></div></div>
          <div class="note ok">${fullHours(last)} ساعة كاملة اتحسبت النهارده. تسلم إيدك.</div>
          ${last.closed_by === 'auto' && html`<div class="note warn">انصرافك اتسجّل تلقائيًا لأنك نسيت. الإدارة هتراجعه.</div>`}
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
    </div>
  </div>`;
}

function EmpHistory() {
  const { me, shift, S } = CTX;
  const [rows, setRows] = useState(null);
  useEffect(() => {
    sb.from('attendance').select('*').eq('staff_id', me.id).order('work_date', { ascending: false }).limit(60)
      .then(({ data }) => setRows(data || []));
  }, []);
  const grace = Number(S.grace_minutes ?? 30);
  return html`<div class="page">
    <${Hero} title="سجل الحضور" sub="آخر 60 يوم" slim />
    <div class="body flat">
      <div class="card tight">
        ${rows === null ? html`<div class="empty">لحظة...</div>` : rows.length === 0 ? html`<div class="empty">لسه مفيش سجل حضور.</div>` : rows.map((a) => html`
          <div class="list-row">
            <div class="grow"><div style="font-weight:600">${fmtShort(keyToDate(a.work_date))}</div>
              <div class="soft num">${fmtTime(a.check_in)} — ${a.check_out ? fmtTime(a.check_out) : 'لسه شغال'}</div></div>
            <div class="stack" style="align-items:flex-end;gap:4px">
              <${Pill} tone=${lateMin(a, shift) > grace ? 'amber' : 'green'}>${fullHours(a)} ساعة<//>
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

const EMP_NAV = [
  { id: 'home', icon: 'home', label: 'الرئيسية' },
  { id: 'history', icon: 'calendar', label: 'الحضور' },
  { id: 'salary', icon: 'wallet', label: 'مرتبي' },
  { id: 'requests', icon: 'file', label: 'طلباتي' },
  { id: 'profile', icon: 'user', label: 'حسابي' },
];

function EmployeeShell({ route }) {
  const tab = EMP_NAV.some((n) => n.id === route) ? route : 'home';
  const view = { home: EmpHome, history: EmpHistory, profile: Profile }[tab];
  return html`<div style="height:100%">
    ${view ? html`<${view} key=${tab} />` : html`<${Soon} title=${tab === 'salary' ? 'مرتبي' : 'طلباتي'} text=${tab === 'salary' ? 'رصيدك بالساعة ومرتبك هيظهروا هنا في التحديث الجاي.' : 'طلبات الإجازة والسلف هتظهر هنا في التحديث الجاي.'} />`}
    <${Nav} items=${EMP_NAV} tab=${tab} />
  </div>`;
}

/* ================= admin screens ================= */
const STATUS = {
  present: { tone: 'green', label: 'حاضر' },
  late: { tone: 'amber', label: 'متأخر' },
  absent: { tone: 'red', label: 'غايب' },
  waiting: { tone: 'sand', label: 'لسه' },
};
const ROLE_LABEL = { employee: 'موظف', manager: 'مدير', hr: 'موارد بشرية', accountant: 'محاسب', super_admin: 'مدير عام' };
const randomPin = () => String(Math.floor(100000 + Math.random() * 900000));

function AdmDash({ unread }) {
  const [board, setBoard] = useState(null);
  const [pending, setPending] = useState(0);
  async function load() {
    const [b, p] = await Promise.all([
      sb.rpc('today_board'),
      sb.from('attendance').select('id', { count: 'exact', head: true }).eq('review', 'pending'),
    ]);
    if (!b.error) setBoard(b.data || []);
    setPending(p.count || 0);
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    window.addEventListener('adm-refresh', load);
    return () => { clearInterval(t); window.removeEventListener('adm-refresh', load); };
  }, []);
  const c = { present: 0, late: 0, absent: 0, waiting: 0 };
  (board || []).forEach((r) => { c[r.status] = (c[r.status] || 0) + 1; });
  const total = board ? board.length : 0;
  return html`<div class="page">
    <${Hero} title="أهلاً يا إدارة" sub=${fmtDay(new Date()) + (board ? ' · ' + total + ' موظف' : '')} bell=${html`<${Bell} count=${unread} />`} />
    <div class="body">
      <div class="card">
        <div class="spread"><div class="h2">النهاردة</div><${Pill} icon="clock">محدّث الآن<//></div>
        <div class="bar">${total ? ['present', 'late', 'absent'].map((k) => c[k] > 0 && html`<div style=${'flex:' + c[k] + ';background:' + (k === 'present' ? 'var(--green)' : k === 'late' ? '#E0A93D' : 'var(--red)')}></div>`) : ''}</div>
        <div class="stats">
          <div class="stat"><span class="tile sm tone-green"><${Icon} name="check" size=${20} /></span><span class="big num">${c.present}</span><span class="soft">حاضر</span></div>
          <div class="stat"><span class="tile sm tone-amber"><${Icon} name="clock" size=${20} /></span><span class="big num">${c.late}</span><span class="soft">متأخر</span></div>
          <div class="stat"><span class="tile sm tone-red"><${Icon} name="xcircle" size=${20} /></span><span class="big num">${c.absent}</span><span class="soft">غايب</span></div>
          <div class="stat"><span class="tile sm tone-sand"><${Icon} name="clock" size=${20} /></span><span class="big num">${c.waiting}</span><span class="soft">لسه</span></div>
        </div>
      </div>
      <div class="card tight">
        <div class="h2" style="padding:12px 0 4px">محتاج قرارك</div>
        <a class="list-row" href="#att"><${Tile} icon="auto" tone="sand" sm /><div class="grow" style="font-weight:500">انصراف تلقائي للمراجعة</div><${Pill} tone=${pending ? 'amber' : 'sand'}>${pending}<//><${Chev} /></a>
        <a class="list-row" href="#notifications"><${Tile} icon="bell" tone="slate" sm /><div class="grow" style="font-weight:500">إشعارات جديدة</div><${Pill} tone=${unread ? 'red' : 'sand'}>${unread}<//><${Chev} /></a>
      </div>
      <div class="card tight">
        <div class="h2" style="padding:12px 0 4px">حضور اليوم</div>
        ${board === null ? html`<div class="empty">لحظة...</div>` : board.length === 0 ? html`<div class="empty">لسه مفيش موظفين. ضيف أول موظف من تبويب الموظفين.</div>` : board.map((r) => html`
          <a class="list-row" href=${'#employee/' + r.staff_id}>
            <div class=${'avatar tone-' + STATUS[r.status].tone}>${initial(r.full_name)}</div>
            <div class="grow"><div style="font-weight:600">${r.full_name}</div>
              <div class="soft num">${r.check_in ? 'حضور ' + fmtTime(r.check_in) + (r.check_out ? ' · انصراف ' + fmtTime(r.check_out) : '') : 'كود ' + r.code}</div></div>
            <${Pill} tone=${STATUS[r.status].tone}>${STATUS[r.status].label}<//>
          </a>`)}
      </div>
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
  const [f, setF] = useState({ name: '', phone: '', dept: '', job: '', salary: '', shift: '', start: todayKey(), code: '', pin: randomPin(), anyLoc: false });
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
        base_salary: Number(f.salary || 0), shift_id: f.shift || null, start_date: f.start || null, any_location: f.anyLoc });
      setDone({ id: r.id, code: r.code, pin: f.pin, name: f.name.trim(), phone: f.phone });
    } catch (e) { toast(errText(e.message), 'bad'); }
    setBusy(false);
  }
  const sec = (icon, tone, title, ...kids) => html`<div class="card"><div class="row"><${Tile} icon=${icon} tone=${tone} sm /><div class="h2">${title}</div></div>${kids}</div>`;
  return html`<div class="page nonav">
    <${Hero} title="إضافة موظف" back="employees" slim />
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
  async function load() {
    const [a, b, c] = await Promise.all([
      sb.from('staff').select('*').eq('id', id).maybeSingle(),
      sb.from('shifts').select('*').order('created_at'),
      sb.from('attendance').select('*').eq('staff_id', id).order('work_date', { ascending: false }).limit(10),
    ]);
    setS(a.data);
    if (a.data) setF({ name: a.data.full_name, phone: a.data.phone || '', dept: a.data.department || '', job: a.data.job_title || '', salary: String(a.data.base_salary ?? ''), shift: a.data.shift_id || '', start: a.data.start_date || '', anyLoc: a.data.any_location });
    setShifts(b.data || []);
    setRows(c.data || []);
  }
  useEffect(() => { load(); }, [id]);
  if (!s || !f) return html`<div class="page nonav"><${Hero} title="ملف الموظف" back="employees" slim /><div class="body flat"><div class="card"><div class="empty">لحظة...</div></div></div></div>`;
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));
  const sh = shifts.find((x) => x.id === s.shift_id);
  async function save() {
    setBusy(true);
    const { error } = await sb.from('staff').update({ full_name: f.name.trim(), phone: f.phone || null, department: f.dept || null, job_title: f.job || null,
      base_salary: Number(f.salary || 0), shift_id: f.shift || null, start_date: f.start || null, any_location: f.anyLoc }).eq('id', id);
    setBusy(false);
    if (error) return toast(errText(error.message), 'bad');
    toast('اتحفظت التعديلات');
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
  return html`<div class="page nonav">
    <${Hero} title=${s.full_name} back="employees" sub=${'كود ' + s.code + (s.department ? ' · ' + s.department : '') + ' · ' + ROLE_LABEL[s.role]} slim />
    <div class="body flat">
      ${!s.active && html`<div class="note bad">الموظف موقوف ومش قادر يدخل.</div>`}
      <div class="card">
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
      </div>
      <div class="card">
        <div class="h2">آخر حضور</div>
        ${rows.length === 0 ? html`<div class="soft">لسه مفيش حضور.</div>` : rows.map((a) => html`<div class="list-row">
          <div class="grow"><div style="font-weight:600">${fmtShort(keyToDate(a.work_date))}</div><div class="soft num">${fmtTime(a.check_in)} — ${a.check_out ? fmtTime(a.check_out) : 'لسه شغال'}</div></div>
          <${Pill} tone=${lateMin(a, sh) > grace ? 'amber' : 'green'}>${fullHours(a)} ساعة<//></div>`)}
      </div>
      <div class="card">
        <div class="h2">الحساب</div>
        <button class="btn ghost" disabled=${busy} onClick=${resetPin}><${Icon} name="lock" size=${20} /> تغيير الـ PIN</button>
        <button class="btn ghost" disabled=${busy} style=${s.active ? 'color:var(--red)' : ''} onClick=${toggleActive}>${s.active ? 'إيقاف الموظف' : 'تفعيل الموظف'}</button>
      </div>
    </div>
    ${cred && html`<${Credentials} ...${cred} onClose=${() => setCred(null)} />`}
  </div>`;
}

function AdmAtt() {
  const [mode, setMode] = useState('day');
  const [day, setDay] = useState(todayKey());
  const [rows, setRows] = useState(null);
  const [shifts, setShifts] = useState({});
  const [edit, setEdit] = useState(null);
  async function load() {
    let q = sb.from('attendance').select('*, staff(full_name, code, shift_id)');
    q = mode === 'day' ? q.eq('work_date', day).order('check_in') : q.eq('review', 'pending').order('work_date', { ascending: false });
    const { data } = await q;
    setRows(data || []);
  }
  useEffect(() => { sb.from('shifts').select('*').then(({ data }) => { const m = {}; (data || []).forEach((s) => { m[s.id] = s; }); setShifts(m); }); }, []);
  useEffect(() => { setRows(null); load(); }, [day, mode]);
  const grace = Number(CTX.S.grace_minutes ?? 30);
  const pendingCount = mode === 'pending' && rows ? rows.length : null;
  return html`<div class="page">
    <${Hero} title="الحضور" sub="راجع وعدّل سجلات الحضور" />
    <div class="body">
      <div class="chips"><button class=${'chip' + (mode === 'day' ? ' on' : '')} onClick=${() => setMode('day')}>حسب اليوم</button>
        <button class=${'chip' + (mode === 'pending' ? ' on' : '')} onClick=${() => setMode('pending')}>للمراجعة${pendingCount != null ? ' ' + pendingCount : ''}</button></div>
      ${mode === 'day' && html`<div class="card"><div class="spread">
        <button class="iconbtn light" aria-label="اليوم اللي بعده" onClick=${() => setDay(addDays(day, 1))} disabled=${day >= todayKey()}><${Icon} name="chev" size=${22} /></button>
        <div style="text-align:center"><div class="h2">${fmtShort(keyToDate(day))}</div>${day === todayKey() && html`<span class="soft">النهاردة</span>`}</div>
        <button class="iconbtn light" aria-label="اليوم اللي قبله" onClick=${() => setDay(addDays(day, -1))}><${Icon} name="back" size=${22} /></button></div></div>`}
      <div class="card tight">
        ${rows === null ? html`<div class="empty">لحظة...</div>` : rows.length === 0 ? html`<div class="empty">${mode === 'pending' ? 'مفيش حاجة محتاجة مراجعة.' : 'مفيش حضور مسجّل في اليوم ده.'}</div>` : rows.map((a) => {
          const sh = shifts[a.staff && a.staff.shift_id];
          return html`<button class="list-row" onClick=${() => setEdit(a)}>
            <div class=${'avatar tone-' + (a.review === 'pending' ? 'amber' : lateMin(a, sh) > grace ? 'amber' : 'green')}>${initial(a.staff && a.staff.full_name)}</div>
            <div class="grow"><div style="font-weight:600">${a.staff ? a.staff.full_name : '—'}${mode === 'pending' ? ' · ' + fmtShort(keyToDate(a.work_date)) : ''}</div>
              <div class="soft num">${fmtTime(a.check_in)} — ${a.check_out ? fmtTime(a.check_out) : 'لسه شغال'} · ${fullHours(a)} ساعة</div></div>
            <div class="stack" style="align-items:flex-end;gap:4px">
              ${a.review === 'pending' && html`<${Pill} tone="amber">للمراجعة<//>`}
              ${a.closed_by === 'auto' && a.review !== 'pending' && html`<${Pill}>تلقائي<//>`}
              ${a.edited && html`<${Pill} tone="slate">معدّل<//>`}
              ${a.in_zone === false && html`<${Pill} tone="red">خارج النطاق<//>`}
            </div></button>`;
        })}
      </div>
    </div>
    ${edit && html`<${EditAtt} a=${edit} onClose=${() => setEdit(null)} onDone=${() => { setEdit(null); load(); window.dispatchEvent(new Event('adm-refresh')); }} />`}
  </div>`;
}

function EditAtt({ a, onClose, onDone }) {
  const [cin, setCin] = useState(toLocalInput(a.check_in));
  const [cout, setCout] = useState(a.check_out ? toLocalInput(a.check_out) : '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
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
  return html`<${Sheet} title=${(a.staff ? a.staff.full_name : 'سجل') + ' · ' + fmtShort(keyToDate(a.work_date))} onClose=${onClose}>
    ${a.closed_by === 'auto' && html`<div class="note warn">اليوم ده اتقفل تلقائيًا لأن الموظف نسي الانصراف. راجعه واعتمده أو عدّل وقت الانصراف.</div>`}
    ${a.in_zone === false && html`<div class="note bad">الحضور اتسجّل وهو خارج النطاق (${Math.round(a.in_dist_m || 0)} متر).</div>`}
    <label class="field">وقت الحضور<input class="input" type="datetime-local" value=${cin} onInput=${(e) => setCin(e.target.value)} /></label>
    <label class="field">وقت الانصراف<input class="input" type="datetime-local" value=${cout} onInput=${(e) => setCout(e.target.value)} /></label>
    <label class="field">سبب التعديل<input class="input" placeholder="مثال: نسي يسجّل الانصراف" value=${reason} onInput=${(e) => setReason(e.target.value)} /></label>
    <button class="btn" disabled=${busy} onClick=${save}>حفظ التعديل</button>
    ${a.review === 'pending' && html`<button class="btn ghost" disabled=${busy} onClick=${approve}><${Icon} name="check" size=${20} /> اعتماد كما هو</button>`}
    <div class="soft" style="text-align:center">الوقت الأصلي بيتحفظ في سجل النشاط.</div>
  <//>`;
}

function Notifications({ onRead }) {
  const { me } = CTX;
  const [rows, setRows] = useState(null);
  async function load() {
    const { data } = await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(60);
    setRows(data || []);
  }
  useEffect(() => { load(); window.addEventListener('adm-refresh', load); return () => window.removeEventListener('adm-refresh', load); }, []);
  async function readAll() { await sb.rpc('mark_notifications_read'); await load(); onRead(); }
  const icon = { late: ['clock', 'amber'], auto_close: ['auto', 'slate'] };
  return html`<div class="page">
    <${Hero} title="الإشعارات" back="dash" slim />
    <div class="body flat">
      <button class="btn ghost small" onClick=${readAll}><${Icon} name="check" size=${20} /> تعليم الكل كمقروء</button>
      <div class="card tight">
        ${rows === null ? html`<div class="empty">لحظة...</div>` : rows.length === 0 ? html`<div class="empty">مفيش إشعارات.</div>` : rows.map((n) => {
          const [ic, tn] = icon[n.type] || ['bell', 'sand'];
          const unread = !(n.read_by || []).includes(me.id);
          return html`<a class="list-row" href=${n.data && n.data.attendance_id ? '#att' : '#notifications'}>
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
  const item = (icon, tone, title, inside, href) => href
    ? html`<a class="list-row" href=${href}><${Tile} icon=${icon} tone=${tone} /><div class="grow"><div style="font-weight:600;font-size:15.5px">${title}</div><div class="soft">${inside}</div></div><${Chev} /></a>`
    : html`<div class="list-row" style="opacity:.6"><${Tile} icon=${icon} tone=${tone} /><div class="grow"><div style="font-weight:600;font-size:15.5px">${title}</div><div class="soft">${inside}</div></div><${Pill}>قريبًا<//></div>`;
  return html`<div class="page">
    <${Hero} title="الإعدادات" sub="كل حاجة في النظام بتتغير من هنا" />
    <div class="body">
      <div class="note info"><b>التغييرات المالية بتسري من تاريخ تحدده</b><br />وأي شهر اتقفل مابيتغيرش، وكل تغيير بيتسجّل في سجل النشاط.</div>
      <div class="card tight">
        <div class="h2" style="padding:12px 0 4px">الحضور</div>
        ${item('pin', 'red', 'الموقع والنطاق', 'موقع الشغل · نطاق التسجيل · دقة الـ GPS', '#set/location')}
        ${item('clock', 'sand', 'الشفتات', 'الأسماء · مواعيد البداية · عدد الساعات', '#set/shifts')}
        ${item('auto', 'amber', 'قواعد الحضور', 'فترة السماح · الانصراف التلقائي · الإشعارات', '#set/rules')}
      </div>
      <div class="card tight">
        <div class="h2" style="padding:12px 0 4px">قريبًا</div>
        ${item('wallet', 'green', 'حساب المرتب', 'سعر الساعة · الساعة الإضافية · يوم القبض')}
        ${item('sun', 'slate', 'الإجازات', 'الأيام المدفوعة · الموافقات')}
        ${item('down', 'amber', 'السلف والخصومات', 'الحد الأقصى · طريقة السداد')}
        ${item('shield', 'slate', 'الصلاحيات', 'الأدوار · مين يشوف إيه')}
      </div>
      <div class="card tight">
        <div class="h2" style="padding:12px 0 4px">الأمان</div>
        ${item('file', 'sand', 'سجل النشاط', 'مين غيّر إيه وإمتى', '#set/log')}
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
        ${row('الانصراف التلقائي', 'لو الموظف نسي الانصراف، اليوم بيتقفل بعد مدة الشفت من حضوره', html`<${Toggle} on=${f.auto} onChange=${(v) => setF({ ...f, auto: v })} />`)}
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

/* ================= admin shell ================= */
const ADM_NAV = [
  { id: 'dash', icon: 'home', label: 'الرئيسية' },
  { id: 'employees', icon: 'users', label: 'الموظفين' },
  { id: 'att', icon: 'calendar', label: 'الحضور' },
  { id: 'pay', icon: 'wallet', label: 'المرتبات' },
  { id: 'settings', icon: 'sliders', label: 'الإعدادات' },
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
  let view;
  let tab = head;
  if (head === 'employee' && parts[1]) { view = html`<${AdmEmployee} id=${parts[1]} key=${parts[1]} />`; tab = 'employees'; }
  else if (head === 'add') { view = html`<${AdmAdd} />`; tab = 'employees'; }
  else if (head === 'employees') view = html`<${AdmEmployees} />`;
  else if (head === 'att') view = html`<${AdmAtt} />`;
  else if (head === 'pay') view = html`<${Soon} title="المرتبات" text="كشف المرتبات والرصيد بالساعة هيظهروا هنا في التحديث الجاي." />`;
  else if (head === 'notifications') { view = html`<${Notifications} onRead=${loadUnread} />`; tab = 'dash'; }
  else if (head === 'settings') view = html`<${SetHub} />`;
  else if (head === 'set') {
    tab = 'settings';
    view = { location: html`<${SetLocation} />`, shifts: html`<${SetShifts} />`, rules: html`<${SetRules} />`, log: html`<${SetLog} />` }[parts[1]] || html`<${SetHub} />`;
  } else { view = html`<${AdmDash} unread=${unread} />`; tab = 'dash'; }
  const hideNav = head === 'add' || head === 'employee' || head === 'set';
  return html`<div style="height:100%">${view}${!hideNav && html`<${Nav} items=${ADM_NAV} tab=${tab} />`}</div>`;
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
