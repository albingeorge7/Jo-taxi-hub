const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (n) => `<svg class="ic"><use href="/img/icons.svg#${n}"/></svg>`;
let info, bookings = [], stats, cur = '₹', activeTab = 'requests', billBooking = null;

async function api(url, method = 'GET', body) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && url !== '/api/driver/login') { showLogin(); throw new Error('Please log in'); }
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}
const money = (n) => cur + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const when = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const dayLabel = (iso) => new Date(iso).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
const dayKey = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

// ---------- login ----------
function showLogin() { $('#loginView').classList.remove('hidden'); $('#app').classList.add('hidden'); $('#logout').classList.add('hidden'); if (es) es.close(); }
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await api('/api/driver/login', 'POST', Object.fromEntries(new FormData(e.target))); e.target.reset(); start(); }
  catch (err) { $('#loginMsg').innerHTML = `<div class="msg err">${ic('x')}<div>${esc(err.message)}</div></div>`; }
});
$('#logout').addEventListener('click', async (e) => { e.preventDefault(); await api('/api/driver/logout', 'POST', {}); showLogin(); });

async function start() {
  info = await (await fetch('/api/info')).json(); cur = info.currency;
  $('#loginView').classList.add('hidden'); $('#app').classList.remove('hidden'); $('#logout').classList.remove('hidden');
  $('#alertBar').classList.toggle('hidden', audioOk && (!('Notification' in window) || Notification.permission !== 'default'));
  await refresh(); connect();
}

// ---------- tabs ----------
$('#tabs').addEventListener('click', (e) => {
  const t = e.target.closest('button'); if (!t) return;
  activeTab = t.dataset.tab;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b === t));
  ['requests', 'schedule', 'analytics', 'history'].forEach((n) => $('#tab-' + n).classList.toggle('hidden', n !== activeTab));
  render();
});

async function refresh() {
  [bookings, stats] = await Promise.all([api('/api/driver/bookings'), api('/api/driver/stats')]);
  render();
}
function render() {
  const pending = bookings.filter((b) => b.status === 'pending');
  const dot = $('#pendDot'); dot.textContent = pending.length; dot.classList.toggle('hidden', !pending.length);
  document.title = (pending.length ? `(${pending.length}) ` : '') + 'Driver Dashboard';
  ({ requests: renderRequests, schedule: renderSchedule, analytics: renderAnalytics, history: renderHistory })[activeTab]();
}

// ---------- ride card ----------
function rideCard(b, { actions = true } = {}) {
  const tel = 'tel:' + b.phone.replace(/[^+\d]/g, '');
  const a = [];
  if (actions) {
    if (b.status === 'pending') a.push(`<button class="btn sm green" data-act="confirmed" data-id="${b.id}">${ic('check')}Accept</button><button class="btn sm red" data-act="rejected" data-id="${b.id}">${ic('x')}Reject</button>`);
    if (b.status === 'confirmed') a.push(`<button class="btn sm green" data-bill="${b.id}">${ic('receipt')}Complete &amp; bill</button><button class="btn sm sec" data-act="cancelled" data-id="${b.id}">${ic('x')}Cancel</button>`);
    if (b.status === 'completed' && b.bill_token) a.push(`<a class="btn sm sec" target="_blank" href="/bill/${b.bill_token}">${ic('receipt')}View bill</a><button class="btn sm sec" data-resend="${b.id}">${ic('send')}Re-send</button>`);
    if (b.status === 'completed' && !b.bill_token) a.push(`<button class="btn sm green" data-bill="${b.id}">${ic('receipt')}Generate bill</button>`);
  }
  return `<div class="card ride st-${b.status}"><div class="top"><div class="route">${esc(b.pickup)} &rarr; ${esc(b.dropoff)}</div><span class="badge s-${b.status}">${b.status}</span></div>
  <div class="meta"><span>${ic('calendar')}${when(b.pickup_at)}</span><span>${ic('users')}${b.passengers} pax</span>${b.fare ? `<span>${ic('rupee')}${money(b.fare).replace(cur, '')}</span>` : ''}<span>${esc(b.ref)}</span></div>
  <div class="who"><span>${ic('user')}${esc(b.name)}</span><a href="${tel}">${ic('phone')}${esc(b.phone)}</a>${b.email ? `<span>${ic('mail')}${esc(b.email)}</span>` : ''}</div>
  ${b.notes ? `<div class="muted">${ic('note')} ${esc(b.notes)}</div>` : ''}
  ${conflictOf(b)}
  <div class="actions">${a.join('')}<a class="btn sm sec" href="${tel}">${ic('phone')}Call</a></div></div>`;
}
function conflictOf(b) {
  if (!['pending', 'confirmed'].includes(b.status)) return '';
  const t = new Date(b.pickup_at).getTime();
  const clash = bookings.find((o) => o.id !== b.id && o.status === 'confirmed' && Math.abs(new Date(o.pickup_at).getTime() - t) < 90 * 60e3);
  return clash ? `<div class="warn">${ic('bell')} Within 90 min of confirmed ride ${esc(clash.ref)} (${when(clash.pickup_at)})</div>` : '';
}

const statTile = (icon, v, l, c = '') => `<div class="card stat ${c}"><div class="ico">${ic(icon)}</div><div><b>${v}</b><span>${l}</span></div></div>`;
function renderRequests() {
  const pend = bookings.filter((b) => b.status === 'pending').sort((a, b) => a.pickup_at.localeCompare(b.pickup_at));
  const t = stats.totals;
  $('#tab-requests').innerHTML = `<div class="stats">${statTile('bell', t.pending, 'Awaiting reply')}${statTile('car', t.todayRides, 'Rides today', 'b')}${statTile('rupee', money(t.revenueToday), 'Earned today', 'g')}</div>
    <h2 class="sec">${ic('bell')}New booking requests</h2>${pend.map((b) => rideCard(b)).join('') || '<p class="muted">No pending requests. You will be alerted here the moment someone books.</p>'}`;
}

function renderSchedule() {
  const now = Date.now() - 2 * 3600e3;
  const up = bookings.filter((b) => ['confirmed', 'pending'].includes(b.status) && new Date(b.pickup_at).getTime() >= now).sort((a, b) => a.pickup_at.localeCompare(b.pickup_at));
  let html = `<h2 class="sec">${ic('calendar')}Upcoming schedule</h2>`, last = '';
  for (const b of up) { const k = dayKey(b.pickup_at); if (k !== last) { html += `<div class="day">${ic('calendar')}${dayLabel(b.pickup_at)}</div>`; last = k; } html += rideCard(b); }
  $('#tab-schedule').innerHTML = html + (up.length ? '' : '<p class="muted">Nothing scheduled.</p>');
}

function renderHistory() {
  const el = $('#tab-history');
  const f = el.dataset.filter || '';
  const list = bookings.filter((b) => !f || b.status === f);
  el.innerHTML = `<h2 class="sec">${ic('list')}All rides &amp; bills</h2><label class="history-filter">Filter<select id="hf"><option value="">All</option>${['pending', 'confirmed', 'completed', 'cancelled', 'rejected'].map((s) => `<option ${s === f ? 'selected' : ''}>${s}</option>`).join('')}</select></label>` +
    (list.map((b) => rideCard(b)).join('') || '<p class="muted">No rides.</p>');
  $('#hf').onchange = (e) => { el.dataset.filter = e.target.value; renderHistory(); };
}

// ---------- analytics ----------
function renderAnalytics() {
  const t = stats.totals, d = stats.daily;
  const maxRev = Math.max(1, ...d.map((x) => x.revenue)), maxBk = Math.max(1, ...d.map((x) => x.bookings));
  const hmax = Math.max(1, ...stats.hours);
  const list = (arr) => arr.map((x) => `<div class="hbar"><b>${x.n}×</b><span>${esc(x.label)}</span></div>`).join('') || '<span class="muted">No data yet</span>';
  const chart = (icon, title, body, l1, l2) => `<div class="card chart" style="margin-bottom:12px"><h3>${ic(icon)}${title}</h3>${body}<div class="legend"><span>${l1}</span><span>${l2}</span></div></div>`;
  $('#tab-analytics').innerHTML = `<h2 class="sec">${ic('chart')}Analytics</h2>
  <div class="stats">${statTile('rupee', money(t.revenueMonth), 'Revenue this month')}${statTile('trend', money(t.revenueAll), 'Total revenue', 'g')}${statTile('car', t.completed, 'Completed rides', 'b')}
    ${statTile('receipt', money(t.avgFare), 'Average fare')}${statTile('check', (t.completionRate ?? '–') + (t.completionRate != null ? '%' : ''), 'Completion rate', 'g')}${statTile('users', t.repeatCustomers, 'Repeat customers', 'b')}</div>
  ${chart('rupee', 'Revenue – last 30 days', `<div class="bars">${d.map((x) => `<div title="${x.date}: ${money(x.revenue)}" style="height:${x.revenue / maxRev * 100}%"></div>`).join('')}</div>`, d[0].date, d[d.length - 1].date)}
  ${chart('bell', 'New booking requests per day', `<div class="bars">${d.map((x) => `<div class="b2" title="${x.date}: ${x.bookings}" style="height:${x.bookings / maxBk * 100}%"></div>`).join('')}</div>`, d[0].date, d[d.length - 1].date)}
  ${chart('clock', 'Busiest pickup hours', `<div class="bars">${stats.hours.map((n, h) => `<div title="${h}:00 – ${n} rides" style="height:${n / hmax * 100}%"></div>`).join('')}</div>`, '12am', '11pm')}
  <div class="grid"><div class="card chart"><h3>${ic('pin')}Top pickup spots</h3>${list(stats.topPickups)}</div><div class="card chart"><h3>${ic('route')}Top destinations</h3>${list(stats.topDrops)}</div>
  <div class="card chart"><h3>${ic('list')}Ride status</h3>${Object.entries(stats.byStatus).map(([s, n]) => `<div class="hbar"><span class="badge s-${s}" style="min-width:92px;text-align:center">${s}</span> <b>${n}</b></div>`).join('')}</div></div>`;
}

// ---------- actions ----------
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act],[data-bill],[data-resend]'); if (!el) return;
  try {
    if (el.dataset.act) {
      if (['cancelled', 'rejected'].includes(el.dataset.act) && !confirm('Are you sure?')) return;
      await api('/api/driver/bookings/' + el.dataset.id, 'PATCH', { status: el.dataset.act }); await refresh();
    } else if (el.dataset.bill) openBill(bookings.find((b) => b.id == el.dataset.bill));
    else if (el.dataset.resend) { const r = await api(`/api/driver/bills/${el.dataset.resend}/send`, 'POST', {}); toast(r.note + (r.emailed ? '' : ` — <a style="color:#fde68a" target="_blank" href="${r.whatsapp}">Send via WhatsApp</a>`), 8000); }
  } catch (err) { toast(esc(err.message)); }
});

// ---------- billing ----------
function itemRow(d = '', q = 1, r = '') {
  return `<tr><td style="width:46%"><input placeholder="Description" value="${esc(d)}" class="i-d"></td><td><input type="number" min="0" step="any" value="${q}" class="i-q" placeholder="Qty"></td><td><input type="number" min="0" step="any" value="${r}" class="i-r" placeholder="Rate"></td><td><button type="button" class="btn sm sec rm">${ic('x')}</button></td></tr>`;
}
function openBill(b) {
  billBooking = b;
  $('#billFor').textContent = `${b.name} • ${b.pickup} → ${b.dropoff} • ${b.ref}`;
  $('#billItems').innerHTML = itemRow('Base fare', 1, info.baseFare) + itemRow('Distance (km)', '', info.ratePerKm) + itemRow('Waiting / tolls / parking', 1, '');
  $('#billForm').tax.value = info.taxPercent || 0; $('#billMsg').innerHTML = ''; calc(); $('#billDlg').showModal();
}
function readItems() {
  return [...document.querySelectorAll('#billItems tr')].map((tr) => ({ description: tr.querySelector('.i-d').value, qty: Number(tr.querySelector('.i-q').value), rate: Number(tr.querySelector('.i-r').value) }))
    .filter((i) => i.description.trim() && i.qty > 0 && i.rate > 0);
}
function calc() {
  const sub = readItems().reduce((s, i) => s + i.qty * i.rate, 0), tax = Number($('#billForm').tax.value) || 0;
  $('#billTotal').textContent = `Total: ${money(sub * (1 + tax / 100))}`;
}
$('#billForm').addEventListener('input', calc);
$('#addItem').onclick = () => { $('#billItems').insertAdjacentHTML('beforeend', itemRow()); };
$('#billItems').addEventListener('click', (e) => { if (e.target.classList.contains('rm')) { e.target.closest('tr').remove(); calc(); } });
$('#billCancel').onclick = () => $('#billDlg').close();
$('#billForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const items = readItems(); if (!items.length) return ($('#billMsg').innerHTML = '<div class="msg err">Add at least one item with a quantity and rate.</div>');
  $('#billSave').disabled = true;
  try {
    const r = await api('/api/driver/bills', 'POST', { booking_id: billBooking.id, items, tax_percent: e.target.tax.value, payment_method: e.target.pay.value });
    $('#billMsg').innerHTML = `<div class="msg ok">${ic('check')}<div>Bill ${esc(r.bill.number)} created (${money(r.bill.total)}).<br>${esc(r.note)}.<br>
      <a target="_blank" href="${r.link}">Open bill</a> • <a target="_blank" rel="noopener" href="${r.whatsapp}">Send via WhatsApp</a> • <a href="${r.sms}">Send via SMS</a></div>`;
    await refresh();
  } catch (err) { $('#billMsg').innerHTML = `<div class="msg err">${ic('x')}<div>${esc(err.message)}</div></div>`; }
  $('#billSave').disabled = false;
});

// ---------- live alerts ----------
let es, audioOk = false, actx;
function beep() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25, 0.5].forEach((t) => { const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(actx.destination); g.gain.setValueAtTime(0.3, actx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + t + 0.2); o.start(actx.currentTime + t); o.stop(actx.currentTime + t + 0.22); });
  } catch {}
}
$('#enableAlerts').onclick = async () => {
  audioOk = true; beep();
  if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
  $('#alertBar').classList.add('hidden');
};
let toastTimer;
function toast(html, ms = 6000) { const t = $('#toast'); t.innerHTML = html; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms); }
function connect() {
  if (es) es.close();
  es = new EventSource('/api/driver/events');
  es.onopen = () => { $('#conn').className = 'on'; refresh().catch(() => {}); };
  es.onerror = () => { $('#conn').className = 'off'; };
  es.addEventListener('booking', (ev) => {
    const b = JSON.parse(ev.data);
    beep(); if (navigator.vibrate) navigator.vibrate([300, 100, 300]);
    toast(`${ic('bell')} <strong>New booking!</strong><br>${esc(b.name)}: ${esc(b.pickup)} → ${esc(b.dropoff)}<br>${when(b.pickup_at)}`, 15000);
    if ('Notification' in window && Notification.permission === 'granted') new Notification('New cab booking', { body: `${b.name}: ${b.pickup} → ${b.dropoff}\n${when(b.pickup_at)}` });
    refresh();
  });
}

fetch('/api/driver/me').then((r) => r.json()).then((d) => (d.loggedIn ? start() : showLogin()));
