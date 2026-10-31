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

const ic = (n) => `<svg class="ic"><use href="/img/icons.svg#${n}"/></svg>`;
const svcIcon = (t) => /airport/i.test(t) ? 'plane' : /city/i.test(t) ? 'city' : /outstation|trip|tour/i.test(t) ? 'route' : /hour/i.test(t) ? 'clock' : 'car';
const setLogo = (el, name) => { const [first, ...rest] = name.trim().split(/\s+/); el.innerHTML = `<span class="logo-jo">${esc(first)}</span><span class="logo-t">${esc(rest.join(' ') || first)}</span>`; };

(async function init() {
  info = await (await fetch('/api/info')).json();
  document.title = `${info.name} – Book a Ride`;
  ['#logoMini', '#heroLogo', '#footLogo'].forEach((s) => setLogo($(s), info.name));
  const digits = info.phone.replace(/[^+\d]/g, ''), tel = 'tel:' + digits;
  $('#h-driver').textContent = info.driverName;
  $('#h-call').href = tel; $('#navCall').href = tel; $('#h-callno').textContent = info.phone;
  if (info.whatsapp) {
    const n = info.whatsapp; $('#h-wa').href = 'https://wa.me/' + n; $('#h-wano').textContent = '+' + n.slice(0, 2) + ' ' + n.slice(2, 7) + ' ' + n.slice(7);
    $('#wa').href = 'https://wa.me/' + n; $('#wa').classList.remove('hidden');
  } else $('#h-wa').classList.add('hidden');
  $('#h-tag').innerHTML = esc(info.tagline).replace(/ • .*$/, '').replace(/ & /, '<br>&amp; ');
  $('#ib-loc').textContent = info.address; $('#ib-veh').textContent = info.vehicle; $('#ib-hrs').textContent = info.hours;
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(info.address)}`;
  const cards = [
    ['user', 'Driver', esc(info.driverName)], ['phone', 'Phone', `<a href="${tel}">${esc(info.phone)}</a>`],
    ['pin', 'Address', `<a target="_blank" rel="noopener" href="${maps}">${esc(info.address)}</a>`],
    ['car', 'Vehicle', esc(info.vehicle)], ['clock', 'Hours', esc(info.hours)],
  ];
  if (info.email) cards.push(['mail', 'Email', `<a href="mailto:${esc(info.email)}">${esc(info.email)}</a>`]);
  if (info.licence) cards.push(['shield', 'Cab number', esc(info.licence)]);
  $('#details').innerHTML = cards.map(([i, h, v], n) => `<div class="card icon-card${n % 2 ? ' blue' : ''}"><div class="ico">${ic(i)}</div><div><h3>${h}</h3><p>${v}</p></div></div>`).join('');
  $('#areas').innerHTML = info.areas.map((a) => `<div class="card svc"><div class="ico">${ic(svcIcon(a))}</div><h3>${esc(a.trim())}</h3></div>`).join('');
  $('#rates').textContent = `Base ${info.currency}${info.baseFare} + ${info.currency}${info.ratePerKm}/km. Final fare is confirmed by the driver.`;
  const links = [`<a href="${tel}">${ic('phone')} ${esc(info.phone)}</a>`];
  if (info.email) links.push(`<a href="mailto:${esc(info.email)}">${ic('mail')} ${esc(info.email)}</a>`);
  links.push(`<a target="_blank" rel="noopener" href="${maps}">${ic('pin')} ${esc(info.address)}</a>`);
  $('#foot-links').innerHTML = links.join('');
  $('#foot-copy').textContent = `© ${new Date().getFullYear()} ${info.name}`;
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
    show(msg, 'ok', `${ic('check')}<div>Booking request sent!<br>Your reference: <strong>${esc(r.ref)}</strong><br>The driver will confirm shortly. Save this reference to check status.</div>`);
    $('#trackForm [name=ref]').value = r.ref; $('#trackForm [name=phone]').value = v.phone;
    f.reset(); whenInput.value = whenInput.min;
  } catch (err) { show(msg, 'err', ic('x') + '<div>' + esc(err.message) + '</div>'); }
  btn.disabled = false; btn.textContent = 'Request booking';
});

$('#trackForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = Object.fromEntries(new FormData(e.target)), msg = $('#trackMsg');
  try {
    const r = await post('/api/track', v);
    show(msg, 'ok', `${ic('check')}<div><strong>${esc(r.ref)}</strong> <span class="badge s-${r.status}">${r.status}</span><br>${esc(r.pickup)} → ${esc(r.dropoff)}<br>${fmt(r.pickup_at)}${r.fare ? `<br>Fare: ${info.currency}${r.fare}` : ''}</div>`);
  } catch (err) { show(msg, 'err', ic('x') + '<div>' + esc(err.message) + '</div>'); }
});
