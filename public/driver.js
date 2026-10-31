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

let range = { preset: '30d' };
const statsUrl = () => '/api/driver/stats?' + new URLSearchParams(range.preset === 'custom' ? range : { preset: range.preset });
async function refresh() {
  [bookings, stats] = await Promise.all([api('/api/driver/bookings'), api(statsUrl())]);
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
    if (b.status === 'completed' && b.bill_token) a.push(`<button class="btn sm green" data-pdf="${b.bill_token}" data-name="Invoice-${esc(b.ref)}.pdf" data-id="${b.id}">${ic('file')}Send PDF</button><a class="btn sm sec" target="_blank" href="/bill/${b.bill_token}">${ic('receipt')}View bill</a><button class="btn sm sec" data-resend="${b.id}">${ic('send')}Send link</button>`);
    if (b.status === 'completed' && !b.bill_token) a.push(`<button class="btn sm green" data-bill="${b.id}">${ic('receipt')}Generate bill</button>`);
  }
  return `<div class="card ride st-${b.status}"><div class="top"><div class="route">${esc(b.pickup)} &rarr; ${esc(b.dropoff)}</div><span class="badge s-${b.status}">${b.status}</span></div>
  <div class="meta"><span>${ic('calendar')}${when(b.pickup_at)}</span><span>${ic('users')}${b.passengers} pax</span>${b.fare ? `<span>${ic('rupee')}${money(b.fare).replace(cur, '')}</span>` : ''}<span>${esc(b.ref)}</span>${b.bill_number ? `<span>${esc(b.bill_number)}</span>` : ''}${b.source === 'manual' ? '<span class="tag">Manual bill</span>' : ''}</div>
  <div class="who"><span>${ic('user')}${esc(b.name)}</span><a href="${tel}">${ic('phone')}${esc(b.phone)}</a>${b.email ? `<span>${ic('mail')}${esc(b.email)}</span>` : ''}</div>
  ${b.notes ? `<div class="muted">${ic('note')} ${esc(b.notes)}</div>` : ''}
  ${conflictOf(b)}
  ${mapButtons(b)}
  <div class="actions">${a.join('')}<a class="btn sm sec" href="${tel}">${ic('phone')}Call</a></div></div>`;
}
// Open the pin the customer chose (or the typed address) in Google Maps / the phone's maps app.
function mapButtons(b) {
  if (!['pending', 'confirmed'].includes(b.status) || b.pickup === '—') return '';
  const place = (t, la, lo) => (la != null && lo != null ? `${la},${lo}` : t);
  const p = place(b.pickup, b.pickup_lat, b.pickup_lng), d = place(b.dropoff, b.drop_lat, b.drop_lng), e = encodeURIComponent;
  const pin = (la) => (la != null ? ' <span class="tag">pinned</span>' : '');
  return `<div class="actions maps"><a class="btn sm sec" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${e(p)}">${ic('pin')}Pickup${pin(b.pickup_lat)}</a>
    <a class="btn sm sec" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${e(d)}">${ic('route')}Drop${pin(b.drop_lat)}</a>
    <a class="btn sm navy" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&origin=${e(p)}&destination=${e(d)}&travelmode=driving">${ic('car')}Route</a></div>`;
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
  $('#tab-requests').innerHTML = `<div class="stats">${statTile('bell', t.pending, 'Awaiting reply')}${statTile('car', t.todayRides, 'Rides today', 'b')}${statTile('rupee', money(t.revenueToday), 'Earned today', 'g')}${statTile('eye', t.visitsToday, 'Site visits today')}${statTile('users', t.visitorsToday, 'Visitors today', 'b')}</div>
    <h2 class="sec">${ic('bell')}New booking requests</h2>${pend.map((b) => rideCard(b)).join('') || '<p class="muted">No pending requests. You will be alerted here the moment someone books.</p>'}`;
}

function renderSchedule() {
  const now = Date.now() - 2 * 3600e3;
  const up = bookings.filter((b) => ['confirmed', 'pending'].includes(b.status) && new Date(b.pickup_at).getTime() >= now).sort((a, b) => a.pickup_at.localeCompare(b.pickup_at));
  let html = `<h2 class="sec">${ic('calendar')}Upcoming schedule</h2>`, last = '';
  for (const b of up) { const k = dayKey(b.pickup_at); if (k !== last) { html += `<div class="day">${ic('calendar')}${dayLabel(b.pickup_at)}</div>`; last = k; } html += rideCard(b); }
  $('#tab-schedule').innerHTML = html + (up.length ? '' : '<p class="muted">Nothing scheduled.</p>');
}

// "Rides & bills": website bookings and manual bills, filterable by type, status, date and text
const hist = { source: '', status: '', preset: 'all', from: '', to: '', q: '' };
let histRows = [], histSeq = 0;
function renderHistory() {
  const el = $('#tab-history');
  if (!$('#hList')) {
    el.innerHTML = `<h2 class="sec">${ic('list')}Rides &amp; bills</h2>
    <div class="card rangebar" id="hControls">
      <div class="chips" id="hPresets"></div>
      <div class="custom"><label>From<input type="date" id="hFrom"></label><label>To<input type="date" id="hTo"></label><button class="btn sm navy" id="hApply">${ic('check')}Apply</button></div>
      <div class="row">
        <label>Type<select id="hSource"><option value="">All rides</option><option value="web">Website bookings</option><option value="manual">Manual bills</option></select></label>
        <label>Status<select id="hStatus"><option value="">All</option>${['pending', 'confirmed', 'completed', 'cancelled', 'rejected'].map((s) => `<option>${s}</option>`).join('')}</select></label>
      </div>
      <label style="margin:0">Search<span class="field">${ic('search')}<input id="hQ" type="search" placeholder="Name, phone, booking ref or place" autocomplete="off"></span></label>
      <div class="muted" id="hSummary" style="font-size:13px"></div>
    </div><div id="hList"></div>`;
    $('#hSource').onchange = (e) => { hist.source = e.target.value; loadHistory(); };
    $('#hStatus').onchange = (e) => { hist.status = e.target.value; loadHistory(); };
    let t; $('#hQ').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { hist.q = e.target.value.trim(); loadHistory(); }, 300); };
    $('#hApply').onclick = () => {
      const from = $('#hFrom').value, to = $('#hTo').value;
      if (!from || !to) return toast('Pick both a start and an end date.');
      Object.assign(hist, { preset: 'custom', from, to }); loadHistory();
    };
    $('#hPresets').onclick = (e) => { const b = e.target.closest('[data-hpreset]'); if (b) { Object.assign(hist, { preset: b.dataset.hpreset, from: '', to: '' }); $('#hFrom').value = $('#hTo').value = ''; loadHistory(); } };
  }
  $('#hPresets').innerHTML = [...PRESETS].map(([k, l]) => `<button class="chip ${hist.preset === k ? 'on' : ''}" data-hpreset="${k}">${l === 'All time' ? 'All dates' : l}</button>`).join('');
  loadHistory();
}
async function loadHistory() {
  const seq = ++histSeq, p = new URLSearchParams({ limit: 1 });
  for (const k of ['source', 'status', 'q']) if (hist[k]) p.set(k, hist[k]);
  if (hist.preset !== 'all') { p.set('preset', hist.preset); if (hist.preset === 'custom') { p.set('from', hist.from); p.set('to', hist.to); } }
  let rows;
  try { rows = await api('/api/driver/bookings?' + p); } catch (e) { return toast(esc(e.message)); }
  if (seq !== histSeq) return;                                           // a newer filter change already replaced this
  histRows = rows;
  document.querySelectorAll('#hPresets .chip').forEach((c) => c.classList.toggle('on', c.dataset.hpreset === hist.preset));
  const billed = rows.filter((b) => b.status === 'completed'), total = billed.reduce((s, b) => s + (b.fare || 0), 0);
  $('#hSummary').innerHTML = `<b>${rows.length}</b> ride${rows.length === 1 ? '' : 's'}${rows.length >= 1000 ? ' (first 1000 shown)' : ''} &middot; <b>${billed.length}</b> completed &middot; billed <b>${money(total)}</b>`;
  $('#hList').innerHTML = rows.map((b) => rideCard(b)).join('') || '<p class="muted">No rides match these filters.</p>';
}

// ---------- analytics ----------
const PRESETS = [['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['all', 'All time']];
const prettyDate = (s) => new Date(s + 'T00:00:00').toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
function renderAnalytics() {
  const r = stats.range, t = r.totals, d = r.daily, per = r.monthly ? 'per month' : 'per day';
  const maxRev = Math.max(1, ...d.map((x) => x.revenue)), maxBk = Math.max(1, ...d.map((x) => x.bookings));
  const hmax = Math.max(1, ...r.hours), maxVis = Math.max(1, ...d.map((x) => x.visits));
  const share = (arr) => { const tot = arr.reduce((a, x) => a + x.n, 0) || 1; return arr.map((x) => `<div class="hbar"><b>${x.n}</b><span style="min-width:84px">${esc(x.label)}</span><i style="display:block;height:8px;border-radius:4px;background:var(--navy);width:${Math.max(4, x.n / tot * 100)}px"></i><span class="muted">${Math.round(x.n / tot * 100)}%</span></div>`).join('') || '<span class="muted">No visits yet</span>'; };
  const list = (arr) => arr.map((x) => `<div class="hbar"><b>${x.n}×</b><span>${esc(x.label)}</span></div>`).join('') || '<span class="muted">No data in this period</span>';
  const chart = (icon, title, body, l1, l2) => `<div class="card chart" style="margin-bottom:12px"><h3>${ic(icon)}${title}</h3>${body}<div class="legend"><span>${l1}</span><span>${l2}</span></div></div>`;
  const keep = $('#rFrom') ? { from: $('#rFrom').value, to: $('#rTo').value } : null;
  $('#tab-analytics').innerHTML = `<h2 class="sec">${ic('chart')}Analytics</h2>
  <div class="card rangebar">
    <div class="chips">${PRESETS.map(([k, l]) => `<button class="chip ${r.preset === k ? 'on' : ''}" data-preset="${k}">${l}</button>`).join('')}</div>
    <div class="custom"><label>From<input type="date" id="rFrom" value="${keep?.from || r.from}" max="${stats.today}"></label><label>To<input type="date" id="rTo" value="${keep?.to || r.to}" max="${stats.today}"></label><button class="btn sm navy" id="rApply">${ic('check')}Apply</button></div>
    <div class="muted" style="font-size:13px">${ic('calendar')} Showing <b>${prettyDate(r.from)}</b> to <b>${prettyDate(r.to)}</b> (${r.days} day${r.days > 1 ? 's' : ''}${r.preset === 'custom' ? ', custom' : ''}) &middot; rides counted by pickup date</div>
  </div>
  <div class="stats">${statTile('rupee', money(t.revenue), 'Revenue')}${statTile('car', t.completed, 'Completed rides', 'b')}${statTile('list', t.bookings, 'Total bookings', 'b')}
    ${statTile('receipt', money(t.avgFare), 'Average fare')}${statTile('check', (t.completionRate ?? '–') + (t.completionRate != null ? '%' : ''), 'Completion rate', 'g')}${statTile('users', t.repeatCustomers, 'Repeat customers', 'g')}
    ${statTile('eye', t.visits, 'Site visits')}${statTile('users', t.visitors, 'Unique visitors', 'b')}${statTile('trend', t.returningVisitors, 'Returning visitors', 'g')}${statTile('trend', (t.conversion ?? '–') + (t.conversion != null ? '%' : ''), 'Visitors who booked', 'g')}</div>
  ${chart('rupee', `Revenue ${per}`, `<div class="bars">${d.map((x) => `<div title="${x.date}: ${money(x.revenue)}" style="height:${x.revenue / maxRev * 100}%"></div>`).join('')}</div>`, d[0].date, d[d.length - 1].date)}
  ${chart('bell', `New booking requests ${per}`, `<div class="bars">${d.map((x) => `<div class="b2" title="${x.date}: ${x.bookings}" style="height:${x.bookings / maxBk * 100}%"></div>`).join('')}</div>`, d[0].date, d[d.length - 1].date)}
  ${chart('eye', `Site visits ${per}`, `<div class="bars">${d.map((x) => `<div class="b2" title="${x.date}: ${x.visits} visits, ${x.visitors} visitors" style="height:${x.visits / maxVis * 100}%"></div>`).join('')}</div>`, d[0].date, d[d.length - 1].date)}
  ${chart('clock', 'Busiest pickup hours', `<div class="bars">${r.hours.map((n, h) => `<div title="${h}:00 – ${n} rides" style="height:${n / hmax * 100}%"></div>`).join('')}</div>`, '12am', '11pm')}
  <div class="grid"><div class="card chart"><h3>${ic('pin')}Top pickup spots</h3>${list(r.topPickups)}</div><div class="card chart"><h3>${ic('route')}Top destinations</h3>${list(r.topDrops)}</div>
  <div class="card chart"><h3>${ic('eye')}Where visitors come from</h3>${share(r.sources)}</div><div class="card chart"><h3>${ic('phone')}Devices</h3>${share(r.devices)}</div>
  <div class="card chart"><h3>${ic('list')}Ride status</h3>${Object.entries(r.byStatus).map(([s, n]) => `<div class="hbar"><span class="badge s-${s}" style="min-width:92px;text-align:center">${s}</span> <b>${n}</b></div>`).join('')}</div></div>`;
}
async function setRange(next) {
  const prev = range; range = next;
  try { stats = await api(statsUrl()); render(); } catch (e) { range = prev; toast(esc(e.message)); }
}
document.addEventListener('click', (e) => {
  const p = e.target.closest('[data-preset]'); if (p) return setRange({ preset: p.dataset.preset });
  if (e.target.closest('#rApply')) {
    const from = $('#rFrom').value, to = $('#rTo').value;
    if (!from || !to) return toast('Pick both a start and an end date.');
    setRange({ preset: 'custom', from, to });
  }
});

// ---------- actions ----------
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act],[data-bill],[data-resend]'); if (!el) return;
  try {
    if (el.dataset.act) {
      if (['cancelled', 'rejected'].includes(el.dataset.act) && !confirm('Are you sure?')) return;
      await api('/api/driver/bookings/' + el.dataset.id, 'PATCH', { status: el.dataset.act }); await refresh();
    } else if (el.dataset.bill) openBill([...histRows, ...bookings].find((b) => b.id == el.dataset.bill));
    else if (el.dataset.resend) { const w = window.open('', '_blank'); try { const r = await api(`/api/driver/bills/${el.dataset.resend}/send`, 'POST', {}); w.location = r.whatsapp; } catch (e2) { w.close(); throw e2; } }
  } catch (err) { toast(esc(err.message)); }
});

// ---------- billing ----------
let billMode = 'km';
function extraRow(d = '', amt = '') {
  return `<tr><td style="width:55%"><input placeholder="Description" value="${esc(d)}" class="x-d"></td><td><input type="number" min="0" step="any" inputmode="decimal" value="${amt}" class="x-a" placeholder="Amount"></td><td><button type="button" class="btn sm sec rm">${ic('x')}</button></td></tr>`;
}
const ARROW = /\s*(?:→|->|\s+to\s+)\s*/i;
const defaultRoute = () => {
  if (billBooking) return `${billBooking.pickup} → ${billBooking.dropoff}`;
  const f = $('#billForm'); return f.cpick.value && f.cdrop.value ? `${f.cpick.value.trim()} → ${f.cdrop.value.trim()}` : '';
};
const reverseRoute = (r) => { const p = r.split(ARROW); return p.length === 2 && p[0] && p[1] ? `${p[1].trim()} → ${p[0].trim()}` : ''; };
function legRow(route = '', km = '', amt = '', date = '') {
  return `<div class="leg"><div class="leg-h"><span>Leg <span class="ln"></span><span class="leg-route"></span></span><button type="button" class="btn sm sec rmleg">${ic('x')}</button></div>
    <input class="l-route" placeholder="From → To" value="${esc(route)}">
    <label style="margin-top:8px">Date <span class="muted">(optional &mdash; if different from the booking)</span><input class="l-date" type="date" max="${new Date().toLocaleDateString('en-CA')}" value="${date}"></label>
    <div class="row"><label class="km-only">Distance (km)<input class="l-km" type="number" min="0" step="any" inputmode="decimal" value="${km}"></label>
    <label class="fixed-only">Amount<input class="l-amt" type="number" min="0" step="any" inputmode="decimal" value="${amt}"></label></div></div>`;
}
function renumberLegs() {
  const legs = document.querySelectorAll('#legs .leg');
  legs.forEach((l, i) => {
    l.querySelector('.ln').textContent = i + 1;
    l.querySelector('.rmleg').classList.toggle('hidden', i === 0);                        // leg 1 is the booking's pickup → drop
    l.querySelector('.leg-route').textContent = i === 0 ? ` · ${defaultRoute() || 'Pickup → Drop'}` : '';
    l.querySelector('.l-route').classList.toggle('hidden', i === 0);
    l.querySelector('.l-route').placeholder = 'From → To (e.g. Munnar → Aluva)';
  });
}
function addLeg(route, km, amt, date) { $('#legs').insertAdjacentHTML('beforeend', legRow(route, km, amt, date)); renumberLegs(); calc(); }
function addReturnLeg() {
  const last = [...document.querySelectorAll('#legs .leg')].pop();
  const route = last ? (last.querySelector('.l-route').value.trim() || (document.querySelectorAll('#legs .leg').length === 1 ? defaultRoute() : '')) : defaultRoute();
  addLeg(reverseRoute(route), last?.querySelector('.l-km').value || '', last?.querySelector('.l-amt').value || '', last?.querySelector('.l-date').value || '');
}
function setMode(m) {
  $('#billForm').dataset.mode = m;
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
  ['cname', 'cpick', 'cdrop'].forEach((n) => (f[n].required = !b));
  if (b) { $('#custSummary').innerHTML = `${ic('user')} ${esc(b.name)} &bull; ${esc(b.pickup)} &rarr; ${esc(b.dropoff)} &bull; ${esc(b.ref)}`; f.wa.value = b.phone; }
  f.rate.value = info.ratePerKm || ''; f.base.value = info.baseFare || ''; f.tax.value = info.taxPercent || 0;
  $('#extraRows').innerHTML = ''; $('#legs').innerHTML = ''; addLeg();
  $('#billMsg').innerHTML = ''; $('#billSave').classList.remove('hidden'); $('#billSave').disabled = false;
  setMode('km'); $('#billDlg').showModal();
}
const prettyLegDate = (s) => { const [y, m, dd] = s.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
function activeLegs() {
  const km = billMode === 'km', n = (v) => Number(v) || 0;
  return [...document.querySelectorAll('#legs .leg')].map((l) => ({ route: l.querySelector('.l-route').value.trim(), date: l.querySelector('.l-date').value, km: n(l.querySelector('.l-km').value), amt: n(l.querySelector('.l-amt').value) }))
    .filter((l) => (km ? l.km > 0 : l.amt > 0));
}
function readItems() {
  const f = $('#billForm'), n = (v) => Number(v) || 0, items = [], legs = activeLegs(), rate = n(f.rate.value), multi = legs.length > 1;
  const tag = (l) => (l.date ? ` · ${prettyLegDate(l.date)}` : '');
  const label = (l, i) => `Leg ${i + 1}${tag(l)}: ${l.route || (i === 0 ? defaultRoute() : '') || 'trip'}`;
  if (billMode === 'fixed') {
    legs.forEach((l, i) => items.push({ description: multi ? label(l, i) : (l.route || 'Cab fare') + tag(l), qty: 1, rate: l.amt }));
    if (items.length && n(f.ftoll.value) > 0) items.push({ description: 'Toll', qty: 1, rate: n(f.ftoll.value) });
    return items;
  }
  if (n(f.base.value) > 0) items.push({ description: 'Base fare', qty: 1, rate: n(f.base.value) });
  if (rate > 0) legs.forEach((l, i) => items.push({ description: `${multi ? label(l, i) + ' ' : 'Distance' + tag(l) + ' '}(${l.km} km @ ${cur}${rate}/km)`, qty: l.km, rate }));
  document.querySelectorAll('#extraRows tr').forEach((tr) => {
    const dsc = tr.querySelector('.x-d').value.trim(), a = n(tr.querySelector('.x-a').value);
    if (dsc && a > 0) items.push({ description: dsc, qty: 1, rate: a });
  });
  return items;
}
function calc() {
  const sub = readItems().reduce((s, i) => s + i.qty * i.rate, 0), tax = Number($('#billForm').tax.value) || 0;
  const km = billMode === 'km' ? activeLegs().reduce((s, l) => s + l.km, 0) : 0;
  $('#billTotal').textContent = `Total: ${money(sub * (1 + tax / 100))}${km ? ` · ${km} km` : ''}`;
}
$('#billForm').addEventListener('input', calc);
$('#modeSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });
$('#billDlg').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-extra]');
  if (chip) { $('#extraRows').insertAdjacentHTML('beforeend', extraRow(chip.dataset.extra)); $('#extraRows tr:last-child ' + (chip.dataset.extra ? '.x-a' : '.x-d')).focus(); }
  if (e.target.closest('.rm')) { e.target.closest('tr').remove(); calc(); }
});
$('#addLeg').onclick = () => addLeg();
$('#addReturn').onclick = addReturnLeg;
$('#legs').addEventListener('click', (e) => { const r = e.target.closest('.rmleg'); if (r) { r.closest('.leg').remove(); renumberLegs(); calc(); } });
['cpick', 'cdrop'].forEach((nme) => $('#billForm')[nme].addEventListener('input', renumberLegs));
$('#fabBill').onclick = () => openBill(null);
$('#billCancel').onclick = () => $('#billDlg').close();
$('#billForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, items = readItems();
  const err = (m) => ($('#billMsg').innerHTML = `<div class="msg err">${ic('x')}<div>${esc(m)}</div></div>`);
  if (!items.length) return err(billMode === 'fixed' ? 'Enter an amount for at least one leg.' : 'Enter the distance of at least one leg and the rate per km, a base fare, or an extra.');
  $('#billSave').disabled = true;
  try {
    const payload = { items, tax_percent: f.tax.value, whatsapp_to: f.wa.value };
    if (billBooking) payload.booking_id = billBooking.id;
    else payload.customer = { name: f.cname.value, phone: f.wa.value, pickup: f.cpick.value, dropoff: f.cdrop.value, ride_date: activeLegs().map((l) => l.date).filter(Boolean).sort()[0] || '' };
    const r = await api('/api/driver/bills', 'POST', payload);
    $('#billSave').classList.add('hidden');
    $('#billMsg').innerHTML = `<div class="msg ok">${ic('check')}<div>Bill ${esc(r.bill.number)} created &mdash; ${money(r.bill.total)}</div></div>
      <button type="button" class="btn green block" id="sendPdf" data-pdf="${r.bill.token}" data-name="Invoice-${esc(r.bill.number)}.pdf" data-wa="${esc(r.whatsapp)}">${ic('file')}Send PDF on WhatsApp</button>
      <div class="muted" style="font-size:12.5px;margin:6px 0">Opens your phone's share sheet with the PDF attached &mdash; choose WhatsApp, then the customer's chat.</div>
      <div class="actions" style="margin-top:8px"><a class="btn sm sec" target="_blank" rel="noopener" href="${r.whatsapp}">${ic('whatsapp')}Send link only</a><a class="btn sm sec" target="_blank" href="${r.link}">${ic('receipt')}Open bill</a><button type="button" class="btn sm sec" id="copyLink" data-link="${esc(r.link)}">Copy link</button></div>`;
    $('#billMsg').scrollIntoView({ block: 'end', behavior: 'smooth' });
    getPdf(r.bill.token, `Invoice-${r.bill.number}.pdf`).catch(() => {}); // preload so the share sheet opens instantly
    await refresh();
  } catch (e2) { err(e2.message); $('#billSave').disabled = false; }
});
// ---------- send the bill PDF on WhatsApp ----------
const pdfCache = {};
async function getPdf(token, name) {
  if (!pdfCache[token]) {
    const r = await fetch(`/bill/${token}.pdf`);
    if (!r.ok) throw new Error('Could not load the PDF');
    pdfCache[token] = new File([await r.blob()], name, { type: 'application/pdf' });
  }
  return pdfCache[token];
}
async function sharePdf(token, name, getWaLink) {
  let file; try { file = await getPdf(token, name); } catch (e) { return toast(esc(e.message)); }
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name, text: `Your bill from ${info.name}` }); return; }
    catch (e) {
      if (e.name === 'AbortError') return;
      if (e.name === 'NotAllowedError') return toast('PDF is ready &mdash; tap Send PDF again.');
    }
  }
  // no file sharing here (e.g. desktop): download the PDF and open the WhatsApp chat so it can be attached
  const w = window.open('', '_blank');
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click();
  try { const link = await getWaLink(); if (w) w.location = link; } catch { if (w) w.close(); }
  toast('PDF downloaded. Attach it in the WhatsApp chat that opened.', 9000);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-pdf]'); if (!b) return;
  sharePdf(b.dataset.pdf, b.dataset.name, async () => b.dataset.wa || (await api(`/api/driver/bills/${b.dataset.id}/send`, 'POST', {})).whatsapp);
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
