// End-to-end smoke test: node test.mjs
import assert from 'node:assert/strict';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cab-'));
process.env.DRIVER_PASSWORD = 'test-pass';
const { server, config: liveConfig } = await import('./server.js');
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const j = async (url, method = 'GET', body, cookie, extra = {}) => {
  const r = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...extra }, body: body && JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => null), headers: r.headers };
};
const when = new Date(Date.now() + 3600e3).toISOString();

assert.equal((await j('/api/info')).status, 200);
assert.equal((await j('/api/driver/bookings')).status, 401, 'driver API must need login');
assert.equal((await j('/api/bookings', 'POST', { name: '', phone: '1' })).status, 400);
assert.equal((await j('/api/driver/login', 'POST', { username: 'jojojose', password: 'bad' })).status, 401);

const login = await j('/api/driver/login', 'POST', { username: ' JoJoJose ', password: 'test-pass' });
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie').split(';')[0];

// live alert
const ac = new AbortController();
const sse = await fetch(base + '/api/driver/events', { headers: { Cookie: cookie }, signal: ac.signal });
const reader = sse.body.getReader(); let seen = '';
const gotAlert = (async () => { for (;;) { const { value } = await reader.read(); seen += Buffer.from(value); if (seen.includes('event: booking')) return; } })();

const pdfBufText = async (link) => Buffer.from(await (await fetch(link.replace(/^https?:\/\/[^/]+/, base) + '.pdf')).arrayBuffer()).toString('latin1');
const bk = await j('/api/bookings', 'POST', { name: '<b>Asha</b>', phone: '+91 98765 43210', email: 'a@x.com', pickup: 'Airport', dropoff: 'Hotel', pickup_at: when, passengers: 2, pickup_lat: '10.1520', pickup_lng: '76.4019', drop_lat: 'abc', drop_lng: '76.3' });
assert.equal(bk.status, 201);
await gotAlert; ac.abort();

assert.equal((await j('/api/track', 'POST', { ref: bk.data.ref, phone: '00000' })).status, 404);
assert.equal((await j('/api/track', 'POST', { ref: bk.data.ref, phone: '9876543210' })).data.status, 'pending');

const list = (await j('/api/driver/bookings', 'GET', null, cookie)).data;
assert.equal(list.length, 1);
const id = list[0].id;
assert.equal(list[0].pickup_lat, 10.152); assert.equal(list[0].pickup_lng, 76.4019);
assert.equal(list[0].drop_lat, null, 'invalid drop coords dropped'); assert.equal(list[0].drop_lng, null);
assert.equal((await j(`/api/driver/bookings/${id}`, 'PATCH', { status: 'confirmed' }, cookie)).data.status, 'confirmed');

const bill = await j('/api/driver/bills', 'POST', { booking_id: id, tax_percent: 5, items: [{ description: 'Base', qty: 1, rate: 50 }, { description: 'Distance', qty: 10, rate: 14 }] }, cookie);
assert.equal(bill.status, 201);
assert.equal(bill.data.bill.total, 199.5);
assert.ok(bill.data.whatsapp.startsWith('https://wa.me/919876543210?text='), 'whatsapp link to booking phone');
assert.equal((await j('/api/driver/bills', 'POST', { booking_id: id, items: [{ description: 'x', qty: 1, rate: 1 }] }, cookie)).status, 409);
const page = await fetch(bill.data.link.replace(/^https?:\/\/[^/]+/, base));
const html = await page.text();
assert.ok(html.includes('199.50') && html.includes('&lt;b&gt;Asha'), 'bill renders & escapes');
assert.ok(!html.includes('upi://') && !html.includes('okaxis'), 'no UPI id or pay link on the bill itself');
assert.ok(!(await pdfBufText(bill.data.link)).includes('okaxis'), 'no UPI id in the PDF');
const msg = decodeURIComponent(bill.data.whatsapp);
const payUrl = msg.match(/https?:\/\/\S+\/pay\/[a-f0-9]{32}/)?.[0];
assert.ok(payUrl && !msg.includes('okaxis'), 'WhatsApp message has a tappable https pay link, not the raw UPI id');
const payHtml = await (await fetch(payUrl.replace(/^https?:\/\/[^/]+/, base))).text();
assert.ok(payHtml.includes('upi://pay?pa=jojojosemangalan-1@okaxis&amp;pn=') && payHtml.includes('am=199.50'), 'pay page opens the UPI app with the amount');
for (const scheme of ['tez://upi/pay?pa=', 'phonepe://pay?pa=', 'paytmmp://pay?pa=']) assert.ok(payHtml.includes(scheme), 'app button ' + scheme);
assert.ok(!payHtml.includes('<script'), 'no automatic redirect to the generic upi:// link');
const paid = await j('/api/driver/bills', 'POST', { customer: { name: 'Cash Cust', pickup: 'A', dropoff: 'B', phone: '9847011133' }, items: [{ description: 'Fare', qty: 1, rate: 100 }], payment_method: 'Cash' }, cookie);
assert.ok(!decodeURIComponent(paid.data.whatsapp).includes('/pay/'), 'no pay link on cash bills');
assert.ok(!(await (await fetch(paid.data.link.replace(/^https?:\/\/[^/]+/, base).replace('/bill/', '/pay/'))).text()).includes('upi://pay'), 'pay page of a cash bill has no UPI link');

// manual bill (ride not booked on the site), fixed amount, number without country code
const man = await j('/api/driver/bills', 'POST', { customer: { name: 'Walk In', phone: '98470 11122', pickup: 'Aluva', dropoff: 'Munnar' }, items: [{ description: 'Cab fare', qty: 1, rate: 3500 }], whatsapp_to: '98470 11122' }, cookie);
assert.equal(man.status, 201); assert.equal(man.data.bill.total, 3500);
assert.ok(man.data.whatsapp.startsWith('https://wa.me/919847011122?text='));
for (const c of [{ phone: '9847011122', pickup: 'A', dropoff: 'B' }, { name: 'X', phone: '9847011122', dropoff: 'B' }, { name: 'X', phone: '9847011122', pickup: 'A' }])
  assert.equal((await j('/api/driver/bills', 'POST', { customer: c, items: [{ description: 'f', qty: 1, rate: 5 }] }, cookie)).status, 400, 'name/pickup/drop mandatory');
assert.equal((await j('/api/driver/bills', 'POST', { customer: { name: 'x', pickup: 'A', dropoff: 'B', phone: 'abc' }, items: [{ description: 'f', qty: 1, rate: 5 }] }, cookie)).status, 400);
assert.equal((await j('/api/driver/bills', 'POST', { customer: { name: 'x', pickup: 'A', dropoff: 'B', phone: '9847011122' }, items: [{ description: 'f', qty: 1, rate: 0 }] }, cookie)).status, 400);
assert.equal((await j('/api/driver/bookings', 'GET', null, cookie)).data.length, 3, 'failed bills leave no orphan bookings');

// PDF bill
const pdfRes = await fetch(bill.data.link.replace(/^https?:\/\/[^/]+/, base) + '.pdf');
const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
assert.equal(pdfRes.headers.get('content-type'), 'application/pdf');
assert.ok(pdfBuf.subarray(0, 5).toString() === '%PDF-' && pdfBuf.toString('latin1').includes('%%EOF') && pdfBuf.toString('latin1').includes('Rs.199.50'), 'valid PDF with total');
assert.ok(bill.data.whatsapp.includes(encodeURIComponent('.pdf')), 'WhatsApp message links the PDF');
assert.equal((await fetch(base + '/bill/' + 'a'.repeat(32) + '.pdf')).status, 404);

// visit counter: anonymous, de-duplicated per day, ignores bots and the driver
const visit = (body, ua, ck, ip = '8.8.8.8') => j('/api/visit', 'POST', body, ck, { 'User-Agent': ua, 'CF-Connecting-IP': ip });
const phoneUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile Safari/604.1';
assert.equal((await visit({ ref: 'https://wa.me/x', src: '' }, phoneUa)).status, 204);
assert.equal((await visit({ ref: '', src: 'Card!' }, phoneUa)).status, 204);
await visit({}, 'Googlebot/2.1'); await visit({}, phoneUa, cookie);
const vs = (await j('/api/driver/stats', 'GET', null, cookie)).data;
assert.equal(vs.range.totals.visits, 2, 'bots and the driver are not counted');
assert.equal(vs.range.totals.visitors, 1, 'same visitor counted once per day');
assert.equal(vs.totals.visitsToday, 2);
assert.deepEqual(vs.range.sources.map((s) => s.label).sort(), ['card', 'whatsapp']);
assert.equal(vs.range.devices[0].label, 'mobile');
assert.equal(vs.range.totals.conversion, 100, 'booked / visitors');

const st = (await j('/api/driver/stats', 'GET', null, cookie)).data;
assert.equal(st.range.preset, '30d'); assert.equal(st.range.totals.completed, 3); assert.equal(st.range.totals.revenue, 3799.5);
const sj = (q) => j('/api/driver/stats?' + q, 'GET', null, cookie);
assert.equal((await sj('preset=all')).data.range.totals.revenue, 3799.5);
assert.equal((await sj('preset=today')).data.range.totals.completed, 3, 'rides billed today fall in today');
const old = (await sj('preset=custom&from=2020-01-01&to=2020-01-31')).data; assert.equal(old.range.totals.revenue, 0); assert.equal(old.range.days, 31);
assert.equal((await sj('preset=custom&from=2020-02-01&to=2020-01-01')).status, 400, 'reversed range rejected');
assert.equal((await sj('preset=custom&from=nope&to=2020-01-01')).status, 400);
assert.equal((await sj('preset=custom&from=1990-01-01&to=2026-01-01')).status, 400, 'range capped');
const lm = (await sj('preset=lastmonth')).data.range; assert.ok(lm.from.endsWith('-01') && lm.to > lm.from);
assert.equal((await sj('preset=custom&from=2020-01-01&to=2020-12-31')).data.range.monthly, true, 'long ranges bucket by month');
assert.equal((await fetch(base + '/../etc/passwd')).status === 200, false);
assert.equal((await fetch(base + '/%2e%2e/server.js')).status, 404);
for (const p of ['/', '/driver', '/app.js', '/driver.js']) assert.equal((await fetch(base + p)).status, 200, p);
// rate limits are per visitor (behind the tunnel everyone is localhost; CF-Connecting-IP identifies them)
const bookAs = (ip) => j('/api/bookings', 'POST', { name: 'T', phone: '9847011122', pickup: 'A', dropoff: 'B', pickup_at: when }, undefined, { 'CF-Connecting-IP': ip });
for (let i = 0; i < 8; i++) assert.equal((await bookAs('1.1.1.1')).status, 201);
assert.equal((await bookAs('1.1.1.1')).status, 429, 'same visitor limited');
assert.equal((await bookAs('2.2.2.2')).status, 201, 'other visitors unaffected');
const loginAs = (ip, password) => j('/api/driver/login', 'POST', { username: 'jojojose', password }, undefined, { 'CF-Connecting-IP': ip });
for (let i = 0; i < 10; i++) assert.equal((await loginAs('3.3.3.3', 'nope')).status, 401);
assert.equal((await loginAs('3.3.3.3', 'test-pass')).status, 429, 'attacker locked out even with right password');
assert.equal((await loginAs('4.4.4.4', 'test-pass')).status, 200, 'driver on another IP can still log in');
assert.equal((await fetch(base + '/%E0%A4%A')).status, 404, 'bad URI is a 404 not a 500');
assert.equal((await j('/api/driver/bills', 'POST', { booking_id: id + 999, items: [{ description: 'x', qty: 1, rate: 1 }] }, cookie)).status, 404);
assert.equal((await j('/api/driver/bills', 'POST', { customer: { name: 'x', pickup: 'A', dropoff: 'B', phone: '9847011122' }, items: [{ description: 'x', qty: 1, rate: 1e12 }] }, cookie)).status, 400, 'absurd amounts rejected');
assert.equal((await j(`/api/driver/bookings/${id}`, 'PATCH', { status: 'bogus' }, cookie)).status, 400);
assert.equal((await j(`/api/driver/bookings/${id}`, 'PATCH', { fare: -5 }, cookie)).status, 400);
// the WhatsApp number typed while billing must be used everywhere, including later re-sends
const bk2 = await j('/api/bookings', 'POST', { name: 'Ravi', phone: '9847011144', pickup: 'A', dropoff: 'B', pickup_at: when }, undefined, { 'CF-Connecting-IP': '5.5.5.5' });
const id2 = (await j('/api/driver/bookings', 'GET', null, cookie)).data.find((x) => x.ref === bk2.data.ref).id;
assert.equal((await j('/api/driver/bills', 'POST', { booking_id: id2, whatsapp_to: 'abc', items: [{ description: 'f', qty: 1, rate: 5 }] }, cookie)).status, 400, 'invalid WhatsApp number rejected');
const nb = await j('/api/driver/bills', 'POST', { booking_id: id2, whatsapp_to: '98470 99999', items: [{ description: 'Fare', qty: 1, rate: 300 }] }, cookie);
assert.ok(nb.data.whatsapp.startsWith('https://wa.me/919847099999?text='), 'new bill uses the edited number');
const rs = await j(`/api/driver/bills/${id2}/send`, 'POST', {}, cookie);
assert.ok(rs.data.whatsapp.startsWith('https://wa.me/919847099999?text='), 're-send uses the edited number, not the booking number');
assert.ok(!nb.data.whatsapp.includes('919847011144'));
// leg dates: a manual bill takes the first leg's date as the ride date
const dated = await j('/api/driver/bills', 'POST', { customer: { name: 'Old Trip', pickup: 'A', dropoff: 'A', phone: '9847011155', ride_date: '2026-09-15' }, items: [{ description: 'Leg 1 · 15 Sep 2026: A → B', qty: 1, rate: 700 }, { description: 'Leg 2 · 17 Sep 2026: B → A', qty: 1, rate: 700 }] }, cookie);
assert.equal(dated.status, 201);
const dbk = (await j('/api/driver/bookings', 'GET', null, cookie)).data.find((x) => x.phone === '9847011155');
assert.equal(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(dbk.pickup_at)), '2026-09-15', 'ride dated by its first leg');
const sep = (await sj('preset=custom&from=2026-09-01&to=2026-09-30')).data.range.totals; assert.equal(sep.revenue, 1400, 'revenue lands in September');
assert.equal((await j('/api/driver/bills', 'POST', { customer: { name: 'x', pickup: 'A', dropoff: 'B', phone: '9847011166', ride_date: '2999-01-01' }, items: [{ description: 'f', qty: 1, rate: 5 }] }, cookie)).status, 400, 'future trip date rejected');
assert.equal((await j('/api/driver/bills', 'POST', { customer: { name: 'x', pickup: 'A', dropoff: 'B', phone: '9847011166', ride_date: '15/09/2026' }, items: [{ description: 'f', qty: 1, rate: 5 }] }, cookie)).status, 400, 'bad date rejected');
const longDesc = 'Leg 2 · 17 Sep 2026: Cochin International Airport Nedumbassery → Fort Kochi Beach Road (120 km @ ₹14/km)';
const ld = await j('/api/driver/bills', 'POST', { customer: { name: 'Long', pickup: 'A', dropoff: 'B', phone: '9847011177' }, items: [{ description: longDesc, qty: 1, rate: 10 }] }, cookie);
assert.ok(ld.data.bill.items[0].description.length > 100 && ld.data.bill.items[0].description.endsWith('₹14/km)'), 'long leg descriptions are not cut off');
assert.equal((await fetch(ld.data.link.replace(/^https?:\/\/[^/]+/, base) + '.pdf')).status, 200, 'PDF builds with a long description');
// persistent login: 30-day cookie, renewed on use, stored server-side, ends on logout or password change
assert.ok(login.headers.get('set-cookie').includes('Max-Age=2592000'), 'login cookie lasts 30 days');
const me = await j('/api/driver/me', 'GET', null, cookie);
assert.equal(me.data.loggedIn, true); assert.ok(me.headers.get('set-cookie')?.includes('Max-Age=2592000'), 'opening the dashboard renews the cookie');
const other = (await loginAs('6.6.6.6', 'test-pass')).headers.get('set-cookie').split(';')[0];
liveConfig.driverPassword = 'changed-password';
assert.equal((await j('/api/driver/me', 'GET', null, cookie)).data.loggedIn, false, 'password change signs every device out');
assert.equal((await j('/api/driver/me', 'GET', null, other)).data.loggedIn, false);
liveConfig.driverPassword = 'test-pass';
const again = (await loginAs('7.7.7.7', 'test-pass')).headers.get('set-cookie').split(';')[0];
assert.equal((await j('/api/driver/me', 'GET', null, again)).data.loggedIn, true);
await j('/api/driver/logout', 'POST', {}, again);
assert.equal((await j('/api/driver/me', 'GET', null, again)).data.loggedIn, false, 'logout ends the session');
// Rides & bills filters
const ck2 = (await loginAs('9.9.9.9', 'test-pass')).headers.get('set-cookie').split(';')[0];
const hb = async (q) => (await j('/api/driver/bookings?' + q, 'GET', null, ck2)).data;
const everything = await hb('limit=1');
assert.ok(everything.some((x) => x.source === 'manual') && everything.some((x) => x.source === 'web'), 'manual bills and website bookings are both listed');
assert.ok((await hb('source=manual')).every((x) => x.source === 'manual') && (await hb('source=web')).every((x) => x.source === 'web'), 'type filter');
assert.equal((await hb('preset=custom&from=2026-09-01&to=2026-09-30')).length, 1, 'date filter finds the September ride');
assert.equal((await hb('preset=custom&from=2026-09-16&to=2026-09-30')).length, 0, 'and excludes it outside the range');
assert.equal((await hb('preset=custom&from=2026-09-15&to=2026-09-15')).length, 1, 'single day range is inclusive');
assert.ok((await hb('q=Old%20Trip')).length === 1 && (await hb('q=9847011155')).length === 1, 'search by name and phone');
assert.equal((await hb('q=%25')).length, 0, 'wildcards in search are escaped');
assert.ok((await hb('preset=today')).length >= 3 && (await hb('preset=today')).every((x) => x.bill_number !== undefined), 'today preset; bill number included');
assert.equal((await j('/api/driver/bookings?preset=custom&from=bad&to=2026-01-01', 'GET', null, ck2)).status, 400);
// the customer page must actually send the visit beacon (a past edit silently dropped it)
const appJs = await (await fetch(base + '/app.js')).text();
assert.ok(appJs.includes("fetch('/api/visit'") && appJs.includes("sessionStorage.getItem('visited')"), 'app.js sends the visit counter request');
assert.ok((await (await fetch(base + '/')).text()).includes('/app.js'), 'home page loads app.js');
// unique visitors come from a per-device random id: many people behind one IP with identical browsers stay distinct
const hexId = (n) => n.toString(16).padStart(32, '0');
for (const n of [1, 2, 3]) await visit({ vid: hexId(n) }, phoneUa, undefined, '10.10.10.10');   // same IP + same browser, 3 people
await visit({ vid: hexId(1) }, phoneUa, undefined, '10.10.10.10');                                   // person 1 again (new session)
await visit({ vid: 'not-a-valid-id' }, phoneUa, undefined, '10.10.10.11');                           // bad id falls back to fingerprint
const vs2 = (await j('/api/driver/stats', 'GET', null, ck2)).data;
assert.equal(vs2.range.totals.visits, 2 + 5, 'every session is a visit');
assert.equal(vs2.range.totals.visitors, 1 + 3 + 1, 'distinct people: earlier fallback visitor + 3 ids + 1 fallback');
assert.equal(vs2.totals.visitorsToday, vs2.range.totals.visitors);
assert.ok(vs2.range.daily.reduce((a, d) => a + d.visitors, 0) >= vs2.range.totals.visitors - 0, 'daily buckets present');
// elegant bill: web page has the invoice layout; long bills continue on a second PDF page
const many = Array.from({ length: 20 }, (_, i) => ({ description: `Leg ${i + 1} · ${i + 1} Nov 2026: Edappally Junction, Kochi → Cochin International Airport, Nedumbassery (45 km @ ₹14/km)`, qty: 45, rate: 14 }));
const big = await j('/api/driver/bills', 'POST', { customer: { name: 'Many Legs', pickup: 'Edappally', dropoff: 'Airport', phone: '9847011188' }, items: many }, ck2);
assert.equal(big.status, 201);
const bigPdf = await (async () => Buffer.from(await (await fetch(big.data.link.replace(/^https?:\/\/[^/]+/, base) + '.pdf')).arrayBuffer()).toString('latin1'))();
assert.ok(bigPdf.includes('/Count 2'), 'a 20-line bill continues on a second PDF page');
assert.ok(bigPdf.includes('(continued)'), 'continuation pages carry a compact header');
const bigHtml = await (await fetch(big.data.link.replace(/^https?:\/\/[^/]+/, base))).text();
assert.ok(bigHtml.includes('INVOICE') && bigHtml.includes('<i>From</i>') && bigHtml.includes('<i>To</i>') && bigHtml.includes('TOTAL'), 'invoice layout');
console.log('All tests passed'); process.exit(0);
