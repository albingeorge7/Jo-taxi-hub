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
    document.querySelectorAll('[data-pinned]').forEach((x) => x.classList.add('hidden'));
    f.querySelectorAll('input[type=hidden]').forEach((h) => (h.value = ''));  // reset() does not clear hidden fields
    show(msg, 'ok', `${ic('check')}<div>Booking request sent!<br>Your reference: <strong>${esc(r.ref)}</strong><br>The driver will confirm shortly. Save this reference to check status.</div>`);
    $('#trackForm [name=ref]').value = r.ref; $('#trackForm [name=phone]').value = v.phone;
    f.reset(); f.querySelectorAll('input[type=hidden]').forEach((h) => (h.value = '')); whenInput.value = whenInput.min;
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

// ---------- location picker (OpenStreetMap + Leaflet, loaded on first use) ----------
const bookForm = $('#bookForm');
let leafletReady, map, marker, picking, picked;
const loadLeaflet = () => leafletReady ||= new Promise((ok, fail) => {
  const s = document.createElement('script'); s.src = '/vendor/leaflet/leaflet.js';
  s.onload = () => { L.Icon.Default.imagePath = '/vendor/leaflet/images/'; ok(); }; s.onerror = () => { leafletReady = null; s.remove(); fail(new Error('map script failed')); }; document.head.append(s);
});
let mapReady;
const initMap = () => mapReady ||= (async () => {
  await loadLeaflet();
  map = L.map('map').setView(info?.mapCenter || [9.9312, 76.2673], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
  map.on('click', (e) => pinFromMap(e.latlng.lat, e.latlng.lng));
})().catch((e) => { mapReady = null; throw e; });
const shortName = (n) => n.split(',').slice(0, 3).join(',').trim();
async function nominatim(path) {
  const r = await fetch('https://nominatim.openstreetmap.org/' + path + '&format=jsonv2&accept-language=en');
  if (!r.ok) throw new Error('Map search unavailable');
  return r.json();
}
function setPin(lat, lng, label) {
  picked = { lat, lng, label };
  if (!marker) marker = L.marker([lat, lng]).addTo(map); else marker.setLatLng([lat, lng]);
  map.setView([lat, lng], Math.max(map.getZoom(), 16));
  $('#mapPicked').textContent = label || `${lat.toFixed(5)}, ${lng.toFixed(5)}`; $('#mapOk').disabled = false;
}
async function pinFromMap(lat, lng) {
  setPin(lat, lng, 'Finding address…');
  try { const d = await nominatim(`reverse?lat=${lat}&lon=${lng}`); picked.label = d.display_name ? shortName(d.display_name) : `${lat.toFixed(5)}, ${lng.toFixed(5)}`; }
  catch { picked.label = `${lat.toFixed(5)}, ${lng.toFixed(5)}`; }
  $('#mapPicked').textContent = picked.label;
}
async function openPicker(which) {
  picking = which; picked = null;
  $('#mapTitle').textContent = which === 'pickup' ? 'Choose pickup location' : 'Choose drop location';
  $('#mapOk').disabled = true; $('#mapPicked').textContent = 'Tap the map to drop a pin, or search above.'; renderSuggestions([]); $('#mapQ').value = '';
  $('#mapDlg').showModal();
  try { await initMap(); } catch { $('#mapPicked').textContent = 'Could not load the map. Please type the address instead.'; return; }
  if (marker) { marker.remove(); marker = null; }
  const lat = Number(bookForm[which + '_lat'].value), lng = Number(bookForm[which + '_lng'].value);
  setTimeout(() => { map.invalidateSize(); if (lat && lng) { setPin(lat, lng, bookForm[which === 'pickup' ? 'pickup' : 'dropoff'].value); } }, 50);
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (b) openPicker(b.dataset.pick); });
$('#mapClose').onclick = () => $('#mapDlg').close();
$('#mapOk').onclick = () => {
  if (!picked) return;
  const field = bookForm[picking === 'pickup' ? 'pickup' : 'dropoff'];
  field.value = picked.label; bookForm[picking + '_lat'].value = picked.lat; bookForm[picking + '_lng'].value = picked.lng;
  document.querySelector(`[data-pinned=${picking}]`).classList.remove('hidden'); $('#mapDlg').close();
};
// typing by hand after pinning clears the pin so text and coordinates never disagree
document.querySelectorAll('input[data-loc]').forEach((inp) => inp.addEventListener('input', () => {
  const w = inp.dataset.loc; bookForm[w + '_lat'].value = ''; bookForm[w + '_lng'].value = ''; document.querySelector(`[data-pinned=${w}]`).classList.add('hidden');
}));
// ---------- place suggestions while typing (Photon = OpenStreetMap search built for autocomplete) ----------
let sugTimer, sugAbort, sugSeq = 0, sugItems = [];
const sugUl = () => $('#mapResults');
function photonItem(f) {
  const p = f.properties || {}, street = p.street ? `${p.housenumber ? p.housenumber + ' ' : ''}${p.street}` : '';
  const title = p.name || street || p.city || p.state || 'Unnamed place';
  const rest = [...new Set([street, p.district || p.locality, p.city || p.county, p.state].filter((x) => x && x !== title))].slice(0, 3).join(', ');
  return { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], title, sub: rest, label: [title, rest].filter(Boolean).join(', ') };
}
async function fetchSuggestions(q, signal) {
  const iso = (info?.countryIso || 'in').toUpperCase(), c = map ? map.getCenter() : { lat: info?.mapCenter?.[0] ?? 9.9312, lng: info?.mapCenter?.[1] ?? 76.2673 };
  try {
    const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=en&lat=${c.lat.toFixed(4)}&lon=${c.lng.toFixed(4)}`, { signal });
    if (!r.ok) throw new Error('photon ' + r.status);
    const j = await r.json();
    return (j.features || []).filter((f) => (f.properties?.countrycode || '').toUpperCase() === iso).map(photonItem).slice(0, 6);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    // backup: Nominatim (only used if Photon is down)
    const res = await nominatim(`search?q=${encodeURIComponent(q)}&limit=6&countrycodes=${iso.toLowerCase()}`);
    return res.map((r) => ({ lat: +r.lat, lon: +r.lon, title: shortName(r.display_name).split(',')[0], sub: shortName(r.display_name).split(',').slice(1).join(',').trim(), label: shortName(r.display_name) }));
  }
}
function renderSuggestions(items, msg) {
  const ul = sugUl(); ul.innerHTML = ''; sugItems = items || [];
  if (msg) { const li = document.createElement('li'); li.className = 'note'; li.textContent = msg; ul.append(li); }
  (items || []).forEach((it) => {
    const li = document.createElement('li'), t = document.createElement('span'), s = document.createElement('span');
    t.className = 't'; t.textContent = it.title; s.className = 's'; s.textContent = it.sub; li.append(t, s);
    li.onclick = () => chooseSuggestion(it); ul.append(li);
  });
  ul.classList.toggle('hidden', !ul.children.length);
}
function chooseSuggestion(it) {
  sugAbort?.abort(); clearTimeout(sugTimer); sugUl().classList.add('hidden');
  $('#mapQ').value = it.title; setPin(it.lat, it.lon, it.label); $('#mapQ').blur();
}
async function runSuggest(q) {
  const seq = ++sugSeq; sugAbort?.abort(); sugAbort = new AbortController();
  renderSuggestions([], 'Searching…');
  try {
    const items = await fetchSuggestions(q, sugAbort.signal);
    if (seq === sugSeq) renderSuggestions(items, items.length ? '' : 'No places found. Try a nearby landmark, or tap the map to drop a pin.');
  } catch (e) { if (e.name !== 'AbortError' && seq === sugSeq) renderSuggestions([], 'Search is unavailable right now. You can still tap the map to drop a pin.'); }
}
$('#mapQ').addEventListener('input', () => {
  clearTimeout(sugTimer); const q = $('#mapQ').value.trim();
  if (q.length < 3) { sugSeq++; sugAbort?.abort(); renderSuggestions([]); return; }
  sugTimer = setTimeout(() => runSuggest(q), 350);
});
$('#mapSearch').addEventListener('submit', (e) => {   // Enter key: take the top suggestion, or search right away
  e.preventDefault(); const q = $('#mapQ').value.trim(); clearTimeout(sugTimer);
  if (sugItems.length) chooseSuggestion(sugItems[0]); else if (q.length >= 3) runSuggest(q);
});

// ---------- "use my current location" with a clear popup when it cannot work ----------
const platform = /iphone|ipad|ipod/i.test(navigator.userAgent) ? 'ios' : /android/i.test(navigator.userAgent) ? 'android' : 'desktop';
const LOC_HELP = {
  denied: ['Location is turned off', {
    android: 'Tap the lock icon (or the ⋮ menu) next to the web address, open <b>Permissions</b> or <b>Site settings</b>, set <b>Location</b> to <b>Allow</b>. Also make sure your phone\'s <b>Location (GPS)</b> is switched on.',
    ios: 'Open <b>Settings → Privacy &amp; Security → Location Services</b> and turn it on, then set <b>Safari Websites</b> to <b>While Using the App</b>. Or tap <b>aA</b> in the address bar → <b>Website Settings → Location → Allow</b>.',
    desktop: 'Click the lock icon at the left of the address bar, set <b>Location</b> to <b>Allow</b>, then reload the page.' }],
  secure: ['Location needs a secure page', { all: 'Your browser only shares location on secure (<b>https://</b>) pages. Open this site with an https address, then try again.' }],
  unsupported: ['Location is not available', { all: 'This browser cannot share your location. Please search for the place or tap the map instead.' }],
  unavailable: ['We could not find your position', { all: 'Switch on your phone\'s <b>Location (GPS)</b>, move near a window or outdoors and try again. You can also search for the place or tap the map.' }],
};
function locPopup(kind) {
  const [title, body] = LOC_HELP[kind];
  $('#locTitle span').textContent = title; $('#locBody').innerHTML = `<p>${body[platform] || body.all}</p><p class="muted">You can still search for the place above, or tap the map to drop a pin.</p>`;
  $('#locRetry').classList.toggle('hidden', kind === 'secure' || kind === 'unsupported');
  $('#mapPicked').textContent = 'Could not get your location. Search above or tap the map instead.';
  if (!$('#locDlg').open) $('#locDlg').showModal();
}
async function locate() {
  if (!window.isSecureContext) return locPopup('secure');
  if (!navigator.geolocation) return locPopup('unsupported');
  try { const p = await navigator.permissions?.query({ name: 'geolocation' }); if (p?.state === 'denied') return locPopup('denied'); } catch { /* Permissions API not available */ }
  $('#mapPicked').textContent = 'Getting your location…';
  try { await initMap(); } catch { $('#mapPicked').textContent = 'Could not load the map. Please type the address instead.'; return; }
  const get = (opts) => new Promise((ok, fail) => navigator.geolocation.getCurrentPosition(ok, fail, opts));
  let pos;
  try { pos = await get({ enableHighAccuracy: true, timeout: 8000 }); }
  catch (e) {
    if (e.code === 1) return locPopup('denied');
    try { pos = await get({ enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }); }  // slow GPS fix: accept a rougher one
    catch (e2) { return locPopup(e2.code === 1 ? 'denied' : 'unavailable'); }
  }
  pinFromMap(pos.coords.latitude, pos.coords.longitude);
}
$('#mapLocate').onclick = locate;
$('#locClose').onclick = () => $('#locDlg').close();
$('#locRetry').onclick = () => { $('#locDlg').close(); locate(); };

// anonymous visit counter: once per browser session (no cookies, no personal data)
try {
  if (!sessionStorage.getItem('visited')) {
    sessionStorage.setItem('visited', '1');
    fetch('/api/visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ ref: document.referrer, src: new URLSearchParams(location.search).get('src') || '' }) }).catch(() => {});
  }
} catch { /* storage blocked: skip counting */ }
