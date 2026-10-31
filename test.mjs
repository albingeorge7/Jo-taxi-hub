// End-to-end smoke test: node test.mjs
import assert from 'node:assert/strict';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cab-'));
process.env.DRIVER_PASSWORD = 'test-pass';
const { server } = await import('./server.js');
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const j = async (url, method = 'GET', body, cookie) => {
  const r = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body && JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => null), headers: r.headers };
};
const when = new Date(Date.now() + 3600e3).toISOString();

assert.equal((await j('/api/info')).status, 200);
assert.equal((await j('/api/driver/bookings')).status, 401, 'driver API must need login');
assert.equal((await j('/api/bookings', 'POST', { name: '', phone: '1' })).status, 400);
assert.equal((await j('/api/driver/login', 'POST', { username: 'driver', password: 'bad' })).status, 401);

const login = await j('/api/driver/login', 'POST', { username: 'driver', password: 'test-pass' });
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie').split(';')[0];

// live alert
const ac = new AbortController();
const sse = await fetch(base + '/api/driver/events', { headers: { Cookie: cookie }, signal: ac.signal });
const reader = sse.body.getReader(); let seen = '';
const gotAlert = (async () => { for (;;) { const { value } = await reader.read(); seen += Buffer.from(value); if (seen.includes('event: booking')) return; } })();

const bk = await j('/api/bookings', 'POST', { name: '<b>Asha</b>', phone: '+91 98765 43210', email: 'a@x.com', pickup: 'Airport', dropoff: 'Hotel', pickup_at: when, passengers: 2 });
assert.equal(bk.status, 201);
await gotAlert; ac.abort();

assert.equal((await j('/api/track', 'POST', { ref: bk.data.ref, phone: '00000' })).status, 404);
assert.equal((await j('/api/track', 'POST', { ref: bk.data.ref, phone: '9876543210' })).data.status, 'pending');

const list = (await j('/api/driver/bookings', 'GET', null, cookie)).data;
assert.equal(list.length, 1);
const id = list[0].id;
assert.equal((await j(`/api/driver/bookings/${id}`, 'PATCH', { status: 'confirmed' }, cookie)).data.status, 'confirmed');

const bill = await j('/api/driver/bills', 'POST', { booking_id: id, tax_percent: 5, items: [{ description: 'Base', qty: 1, rate: 50 }, { description: 'Distance', qty: 10, rate: 14 }] }, cookie);
assert.equal(bill.status, 201);
assert.equal(bill.data.bill.total, 199.5);
assert.ok(bill.data.whatsapp.startsWith('https://wa.me/919876543210?text='), 'whatsapp link to booking phone');
assert.equal((await j('/api/driver/bills', 'POST', { booking_id: id, items: [{ description: 'x', qty: 1, rate: 1 }] }, cookie)).status, 409);
const page = await fetch(bill.data.link.replace(/^https?:\/\/[^/]+/, base));
const html = await page.text();
assert.ok(html.includes('199.50') && html.includes('&lt;b&gt;Asha'), 'bill renders & escapes');

// manual bill (ride not booked on the site), fixed amount, number without country code
const man = await j('/api/driver/bills', 'POST', { customer: { name: 'Walk In', phone: '98470 11122', pickup: 'Aluva', dropoff: 'Munnar' }, items: [{ description: 'Cab fare', qty: 1, rate: 3500 }], whatsapp_to: '98470 11122' }, cookie);
assert.equal(man.status, 201); assert.equal(man.data.bill.total, 3500);
assert.ok(man.data.whatsapp.startsWith('https://wa.me/919847011122?text='));
assert.equal((await j('/api/driver/bills', 'POST', { customer: { name: 'x', phone: 'abc' }, items: [{ description: 'f', qty: 1, rate: 5 }] }, cookie)).status, 400);
assert.equal((await j('/api/driver/bills', 'POST', { customer: { phone: '9847011122' }, items: [{ description: 'f', qty: 1, rate: 0 }] }, cookie)).status, 400);
assert.equal((await j('/api/driver/bookings', 'GET', null, cookie)).data.length, 2, 'failed bills leave no orphan bookings');

const st = (await j('/api/driver/stats', 'GET', null, cookie)).data;
assert.equal(st.totals.completed, 2); assert.equal(st.totals.revenueAll, 3699.5);
assert.equal((await fetch(base + '/../etc/passwd')).status === 200, false);
assert.equal((await fetch(base + '/%2e%2e/server.js')).status, 404);
for (const p of ['/', '/driver', '/app.js', '/driver.js']) assert.equal((await fetch(base + p)).status, 200, p);
console.log('All tests passed'); process.exit(0);
