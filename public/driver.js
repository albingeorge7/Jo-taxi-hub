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
function showLogin() { $('#fabBill').classList.add('hidden'); $('#loginView').classList.remove('hidden'); $('#app').classList.add('hidden'); $('#logout').classList.add('hidden'); if (es) es.close(); }
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await api('/api/driver/login', 'POST', Object.fromEntries(new FormData(e.target))); e.target.reset(); start(); }
  catch (err) { $('#loginMsg').innerHTML = `<div class="msg err">${ic('x')}<div>${esc(err.message)}</div></div>`; }
});
$('#logout').addEventListener('click', async (e) => { e.preventDefault(); await api('/api/driver/logout', 'POST', {}); showLogin(); });

async function start() {
  info = await (await fetch('/api/info')).json(); cur = info.currency;
  $('#loginView').classList.add('hidden'); $('#app').classList.remove('hidden'); $('#fabBill').classList.remove('hidden'); $('#logout').classList.remove('hidden');
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
  <div class="meta"><span>${ic('calendar')}${when(b.pickup_at)}</span><span>${ic('users')}${b.passengers} pax</span>${b.fare ? `<span>${ic('rupee')}${money(b.fare).replace(cur, '')}</span>` : ''}<span>${esc(b.ref)}</span>${b.source === 'manual' ? '<span class="tag">Manual bill</span>' : ''}</div>
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
    else if (el.dataset.resend) { const w = window.open('', '_blank'); try { const r = await api(`/api/driver/bills/${el.dataset.resend}/send`, 'POST', {}); w.location = r.whatsapp; } catch (e2) { w.close(); throw e2; } }
  } catch (err) { toast(esc(err.message)); }
});

// ---------- billing ----------
let billMode = 'km';
function extraRow(d = '', amt = '') {
  return `<tr><td style="width:55%"><input placeholder="Description" value="${esc(d)}" class="x-d"></td><td><input type="number" min="0" step="any" inputmode="decimal" value="${amt}" class="x-a" placeholder="Amount"></td><td><button type="button" class="btn sm sec rm">${ic('x')}</button></td></tr>`;
}
function setMode(m) {
  billMode = m;
  document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  $('#modeKm').classList.toggle('hidden', m !== 'km'); $('#modeFixed').classList.toggle('hidden', m !== 'fixed');
  calc();
}
function openBill(b) { // b = booking, or null for a ride that was not booked on the site
  billBooking = b;
  const f = $('#billForm'); f.reset();
  $('#billTitle').textContent = b ? 'Complete & bill' : 'New bill (walk-in / phone ride)';
  $('#custSummary').classList.toggle('hidden', !b); $('#custFields').classList.toggle('hidden', !!b);
  if (b) { $('#custSummary').innerHTML = `${ic('user')} ${esc(b.name)} &bull; ${esc(b.pickup)} &rarr; ${esc(b.dropoff)} &bull; ${esc(b.ref)}`; f.wa.value = b.phone; }
  f.rate.value = info.ratePerKm || ''; f.base.value = info.baseFare || ''; f.tax.value = info.taxPercent || 0;
  $('#extraRows').innerHTML = '';
  $('#billMsg').innerHTML = ''; $('#billSave').classList.remove('hidden'); $('#billSave').disabled = false;
  setMode('km'); $('#billDlg').showModal();
}
function readItems() {
  const f = $('#billForm'), n = (v) => Number(v) || 0, items = [];
  if (billMode === 'fixed') {
    if (n(f.famt.value) > 0) items.push({ description: f.fdesc.value.trim() || 'Cab fare', qty: 1, rate: n(f.famt.value) });
    return items;
  }
  if (n(f.base.value) > 0) items.push({ description: 'Base fare', qty: 1, rate: n(f.base.value) });
  if (n(f.km.value) > 0 && n(f.rate.value) > 0) items.push({ description: `Distance (${n(f.km.value)} km @ ${cur}${n(f.rate.value)}/km)`, qty: n(f.km.value), rate: n(f.rate.value) });
  document.querySelectorAll('#extraRows tr').forEach((tr) => {
    const d = tr.querySelector('.x-d').value.trim(), a = n(tr.querySelector('.x-a').value);
    if (d && a > 0) items.push({ description: d, qty: 1, rate: a });
  });
  return items;
}
function calc() {
  const sub = readItems().reduce((s, i) => s + i.qty * i.rate, 0), tax = Number($('#billForm').tax.value) || 0;
  $('#billTotal').textContent = `Total: ${money(sub * (1 + tax / 100))}`;
}
$('#billForm').addEventListener('input', calc);
$('#modeSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });
$('#billDlg').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-extra]');
  if (chip) { $('#extraRows').insertAdjacentHTML('beforeend', extraRow(chip.dataset.extra)); $('#extraRows tr:last-child ' + (chip.dataset.extra ? '.x-a' : '.x-d')).focus(); }
  if (e.target.closest('.rm')) { e.target.closest('tr').remove(); calc(); }
});
$('#fabBill').onclick = () => openBill(null);
$('#billCancel').onclick = () => $('#billDlg').close();
$('#billForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, items = readItems();
  const err = (m) => ($('#billMsg').innerHTML = `<div class="msg err">${ic('x')}<div>${esc(m)}</div></div>`);
  if (!items.length) return err(billMode === 'fixed' ? 'Enter the fare amount.' : 'Enter distance and rate, a base fare, or at least one extra.');
  $('#billSave').disabled = true;
  try {
    const payload = { items, tax_percent: f.tax.value, payment_method: f.pay.value, whatsapp_to: f.wa.value };
    if (billBooking) payload.booking_id = billBooking.id;
    else payload.customer = { name: f.cname.value, phone: f.wa.value, pickup: f.ctrip.value.split(/\s*(?:→|->|\s+to\s+)\s*/i)[0] || '', dropoff: f.ctrip.value.split(/\s*(?:→|->|\s+to\s+)\s*/i)[1] || '' };
    const r = await api('/api/driver/bills', 'POST', payload);
    $('#billSave').classList.add('hidden');
    $('#billMsg').innerHTML = `<div class="msg ok">${ic('check')}<div>Bill ${esc(r.bill.number)} created &mdash; ${money(r.bill.total)}</div></div>
      <a class="btn green block" target="_blank" rel="noopener" href="${r.whatsapp}">${ic('whatsapp')}Send bill on WhatsApp</a>
      <div class="actions" style="margin-top:8px"><a class="btn sm sec" target="_blank" href="${r.link}">${ic('receipt')}Open bill</a><button type="button" class="btn sm sec" id="copyLink" data-link="${esc(r.link)}">Copy link</button></div>`;
    $('#billMsg').scrollIntoView({ block: 'end', behavior: 'smooth' });
    await refresh();
  } catch (e2) { err(e2.message); $('#billSave').disabled = false; }
});
document.addEventListener('click', async (e) => {
  const c = e.target.closest('#copyLink'); if (!c) return;
  try { await navigator.clipboard.writeText(c.dataset.link); c.textContent = 'Copied'; } catch { prompt('Copy this link', c.dataset.link); }
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
