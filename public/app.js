const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let info;

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Something went wrong');
  return d;
}
const show = (el, cls, html) => { el.innerHTML = `<div class="msg ${cls}">${html}</div>`; };
const fmt = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

(async function init() {
  info = await (await fetch('/api/info')).json();
  document.title = `${info.name} – Book a Ride`;
  $('#brand').textContent = '🚖 ' + info.name;
  $('#h-name').textContent = info.name;
  $('#h-tag').textContent = info.tagline;
  $('#h-call').href = 'tel:' + info.phone.replace(/[^+\d]/g, '');
  const tel = 'tel:' + info.phone.replace(/[^+\d]/g, '');
  const cards = [
    ['Driver', info.driverName], ['Phone', `<a href="${tel}">${esc(info.phone)}</a>`],
    ['Address', `<a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(info.address)}">${esc(info.address)}</a>`],
    ['Vehicle', info.vehicle], ['Hours', info.hours],
  ];
  if (info.licence) cards.push(['Cab number', info.licence]);
  if (info.email) cards.push(['Email', `<a href="mailto:${esc(info.email)}">${esc(info.email)}</a>`]);
  $('#details').innerHTML = cards.map(([h, v]) => `<div class="card"><h3>${h}</h3><p>${h === 'Phone' || h === 'Address' || h === 'Email' ? v : esc(v)}</p></div>`).join('');
  $('#areas').innerHTML = info.areas.map((a) => `<span class="chip">${esc(a.trim())}</span>`).join('');
  $('#rates').textContent = `Base ${info.currency}${info.baseFare} + ${info.currency}${info.ratePerKm}/km (final fare confirmed by driver)`;
  $('#foot').textContent = `© ${new Date().getFullYear()} ${info.name} • ${info.phone}`;
  if (info.whatsapp) { const w = $('#wa'); w.href = 'https://wa.me/' + info.whatsapp; w.classList.remove('hidden'); }
})();

// min pickup time = now (local)
const whenInput = document.querySelector('[name=when]');
const pad = (n) => String(n).padStart(2, '0');
const d = new Date(Date.now() + 30 * 60e3);
whenInput.min = whenInput.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

$('#bookForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, v = Object.fromEntries(new FormData(f));
  const msg = $('#bookMsg'), btn = $('#bookBtn');
  if (!f.checkValidity()) return f.reportValidity();
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const r = await post('/api/bookings', { ...v, pickup_at: new Date(v.when).toISOString() });
    show(msg, 'ok', `✅ Booking request sent!<br>Your reference: <strong>${esc(r.ref)}</strong><br>The driver will confirm shortly. Save this reference to check status.`);
    $('#trackForm [name=ref]').value = r.ref; $('#trackForm [name=phone]').value = v.phone;
    f.reset(); whenInput.value = whenInput.min;
  } catch (err) { show(msg, 'err', esc(err.message)); }
  btn.disabled = false; btn.textContent = 'Request booking';
});

$('#trackForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = Object.fromEntries(new FormData(e.target)), msg = $('#trackMsg');
  try {
    const r = await post('/api/track', v);
    show(msg, 'ok', `<strong>${esc(r.ref)}</strong> <span class="badge s-${r.status}">${r.status}</span><br>${esc(r.pickup)} → ${esc(r.dropoff)}<br>${fmt(r.pickup_at)}${r.fare ? `<br>Fare: ${info.currency}${r.fare}` : ''}`);
  } catch (err) { show(msg, 'err', esc(err.message)); }
});
