import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import config from './config.js';
import { renderBill, billMessage } from './bill.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- database ----------
const db = new DatabaseSync(path.join(DATA_DIR, 'cab.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT,
  pickup TEXT NOT NULL, dropoff TEXT NOT NULL,
  pickup_at TEXT NOT NULL,            -- ISO UTC
  passengers INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|confirmed|completed|cancelled|rejected
  fare REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  token TEXT UNIQUE NOT NULL,
  number TEXT UNIQUE NOT NULL,
  items TEXT NOT NULL,               -- JSON [{description, qty, rate, amount}]
  subtotal REAL NOT NULL, tax_percent REAL NOT NULL, tax REAL NOT NULL, total REAL NOT NULL,
  payment_method TEXT, sent_at TEXT, send_note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_bookings_pickup ON bookings(pickup_at);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
`);

try { db.exec("ALTER TABLE bookings ADD COLUMN source TEXT NOT NULL DEFAULT 'web'"); } catch { /* column exists */ }

const STATUSES = ['pending', 'confirmed', 'completed', 'cancelled', 'rejected'];
const round2 = (n) => Math.round(n * 100) / 100;
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

// ---------- helpers ----------
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}

async function readJson(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'JSON required');
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 50_000) throw new HttpError(413, 'Too large'); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

const hits = new Map();
function rateLimit(req, key, max, windowMs) {
  const k = key + ':' + req.socket.remoteAddress; const now = Date.now();
  const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) throw new HttpError(429, 'Too many requests, please try again later');
  arr.push(now); hits.set(k, arr);
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 3600e3)) hits.delete(k); }, 600e3).unref();

// sessions (in memory; driver just logs in again after a restart)
const sessions = new Map();
const SESSION_MS = 12 * 3600e3;
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((s) => s.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, v.join('=')]));
}
function isDriver(req) {
  const sid = parseCookies(req).sid; const s = sid && sessions.get(sid);
  if (!s) return false;
  if (s.expires < Date.now()) { sessions.delete(sid); return false; }
  return true;
}
function requireDriver(req) { if (!isDriver(req)) throw new HttpError(401, 'Please log in'); }
const safeEq = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

// live alerts (Server-Sent Events)
const sseClients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const r of sseClients) r.write(msg);
}
setInterval(() => { for (const r of sseClients) r.write(': ping\n\n'); }, 25e3).unref();

async function telegram(text) {
  const { token, chatId } = config.telegram;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (e) { console.error('Telegram alert failed:', e.message); }
}

const fmtWhen = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: config.timezone, dateStyle: 'medium', timeStyle: 'short' });
const publicBooking = (b) => ({ ref: b.ref, status: b.status, pickup: b.pickup, dropoff: b.dropoff, pickup_at: b.pickup_at, fare: b.fare });
const baseUrl = (req) => config.baseUrl || `${req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${req.headers.host}`;

function newRef() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (;;) {
    const ref = 'CAB' + Array.from(crypto.randomBytes(5), (b) => alphabet[b % alphabet.length]).join('');
    if (!db.prepare('SELECT 1 FROM bookings WHERE ref=?').get(ref)) return ref;
  }
}

// WhatsApp wants digits with country code; add the default one for local 10-digit numbers.
function waNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '').replace(/^00/, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = config.countryCode + d;
  return d;
}
const waLink = (phone, bill, booking, link) => `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(billMessage(bill, booking, link))}`;

const loadBill = (row) => row && { ...row, items: JSON.parse(row.items) };

// ---------- API ----------
async function api(req, res, url) {
  const { pathname } = url; const m = req.method;

  if (m === 'GET' && pathname === '/api/info') return send(res, 200, { ...config.business, currency: config.currency });

  if (m === 'POST' && pathname === '/api/bookings') {
    rateLimit(req, 'book', 8, 3600e3);
    const b = await readJson(req);
    const name = clean(b.name, 80), phone = clean(b.phone, 20), email = clean(b.email, 120);
    const pickup = clean(b.pickup, 200), dropoff = clean(b.dropoff, 200), notes = clean(b.notes, 500);
    const passengers = Math.max(1, Math.min(20, parseInt(b.passengers, 10) || 1));
    const when = new Date(b.pickup_at);
    if (!name) throw new HttpError(400, 'Please enter your name');
    if (!/^\+?[0-9 ()-]{7,20}$/.test(phone)) throw new HttpError(400, 'Please enter a valid phone number');
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Please enter a valid email');
    if (!pickup || !dropoff) throw new HttpError(400, 'Pickup and drop locations are required');
    if (isNaN(when) || when.getTime() < Date.now() - 5 * 60e3) throw new HttpError(400, 'Please choose a pickup time in the future');
    if (when.getTime() > Date.now() + 365 * 86400e3) throw new HttpError(400, 'Pickup time is too far ahead');
    const ref = newRef();
    const info = db.prepare(`INSERT INTO bookings (ref,name,phone,email,pickup,dropoff,pickup_at,passengers,notes) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(ref, name, phone, email || null, pickup, dropoff, when.toISOString(), passengers, notes || null);
    const row = db.prepare('SELECT * FROM bookings WHERE id=?').get(info.lastInsertRowid);
    broadcast('booking', row);
    telegram(`🚖 New booking ${ref}\n${name} (${phone})\n${pickup} → ${dropoff}\n${fmtWhen(row.pickup_at)} • ${passengers} pax${notes ? '\nNote: ' + notes : ''}`);
    return send(res, 201, publicBooking(row));
  }

  if (m === 'POST' && pathname === '/api/track') {
    rateLimit(req, 'track', 30, 3600e3);
    const { ref, phone } = await readJson(req);
    const row = db.prepare('SELECT * FROM bookings WHERE ref=?').get(clean(ref, 20).toUpperCase());
    const digits = (s) => String(s || '').replace(/\D/g, '').slice(-10);
    if (!row || !digits(phone) || digits(phone) !== digits(row.phone)) throw new HttpError(404, 'No booking found for that reference and phone number');
    return send(res, 200, publicBooking(row));
  }

  // public bill page
  const billPage = pathname.match(/^\/bill\/([a-f0-9]{32})$/);
  if (m === 'GET' && billPage) {
    const bill = loadBill(db.prepare('SELECT * FROM bills WHERE token=?').get(billPage[1]));
    if (!bill) throw new HttpError(404, 'Bill not found');
    const booking = db.prepare('SELECT * FROM bookings WHERE id=?').get(bill.booking_id);
    return send(res, 200, renderBill(bill, booking), { 'Cache-Control': 'no-store' });
  }

  // ----- driver auth -----
  if (m === 'POST' && pathname === '/api/driver/login') {
    rateLimit(req, 'login', 10, 15 * 60e3);
    const { username, password } = await readJson(req);
    if (!(safeEq(username, config.driverUser) & safeEq(password, config.driverPassword))) throw new HttpError(401, 'Wrong username or password');
    const sid = crypto.randomBytes(24).toString('hex');
    sessions.set(sid, { expires: Date.now() + SESSION_MS });
    return send(res, 200, { ok: true }, { 'Set-Cookie': `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${config.baseUrl.startsWith('https') ? '; Secure' : ''}` });
  }
  if (m === 'POST' && pathname === '/api/driver/logout') {
    sessions.delete(parseCookies(req).sid);
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  if (m === 'GET' && pathname === '/api/driver/me') return send(res, 200, { loggedIn: isDriver(req) });

  if (!pathname.startsWith('/api/driver/')) throw new HttpError(404, 'Not found');
  requireDriver(req);

  if (m === 'GET' && pathname === '/api/driver/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (m === 'GET' && pathname === '/api/driver/bookings') {
    const status = url.searchParams.get('status');
    const rows = status && STATUSES.includes(status)
      ? db.prepare('SELECT b.*, (SELECT token FROM bills WHERE booking_id=b.id) AS bill_token FROM bookings b WHERE status=? ORDER BY pickup_at DESC LIMIT 500').all(status)
      : db.prepare('SELECT b.*, (SELECT token FROM bills WHERE booking_id=b.id) AS bill_token FROM bookings b ORDER BY pickup_at DESC LIMIT 500').all();
    return send(res, 200, rows);
  }

  const upd = pathname.match(/^\/api\/driver\/bookings\/(\d+)$/);
  if (m === 'PATCH' && upd) {
    const id = Number(upd[1]); const b = await readJson(req);
    const cur = db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
    if (!cur) throw new HttpError(404, 'Booking not found');
    const status = b.status === undefined ? cur.status : b.status;
    if (!STATUSES.includes(status)) throw new HttpError(400, 'Invalid status');
    let fare = cur.fare;
    if (b.fare !== undefined) { fare = b.fare === null || b.fare === '' ? null : Number(b.fare); if (fare !== null && (!isFinite(fare) || fare < 0)) throw new HttpError(400, 'Invalid fare'); }
    db.prepare('UPDATE bookings SET status=?, fare=? WHERE id=?').run(status, fare, id);
    return send(res, 200, db.prepare('SELECT * FROM bookings WHERE id=?').get(id));
  }

  if (m === 'GET' && pathname === '/api/driver/stats') return send(res, 200, stats());

  if (m === 'POST' && pathname === '/api/driver/bills') {
    const b = await readJson(req);
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 20) throw new HttpError(400, 'Add at least one bill item');
    const items = b.items.map((it) => {
      const qty = Number(it.qty), rate = Number(it.rate);
      const description = clean(it.description, 120);
      if (!description || !isFinite(qty) || !isFinite(rate) || qty <= 0) throw new HttpError(400, 'Each item needs a description, quantity and amount');
      return { description, qty, rate, amount: round2(qty * rate) };
    });
    const taxPercent = Math.max(0, Math.min(50, Number(b.tax_percent) || 0));
    const subtotal = round2(items.reduce((s, i) => s + i.amount, 0));
    if (subtotal <= 0) throw new HttpError(400, 'Bill total must be more than zero');
    const tax = round2(subtotal * taxPercent / 100), total = round2(subtotal + tax);

    let booking;
    if (b.booking_id) {
      booking = db.prepare('SELECT * FROM bookings WHERE id=?').get(Number(b.booking_id));
      if (!booking) throw new HttpError(404, 'Booking not found');
      if (db.prepare('SELECT 1 FROM bills WHERE booking_id=?').get(booking.id)) throw new HttpError(409, 'A bill already exists for this ride');
    } else { // ride that was not booked through the website
      const c = b.customer || {};
      const phone = clean(c.phone, 20);
      if (!/^\+?[0-9 ()-]{7,20}$/.test(phone)) throw new HttpError(400, "Enter the customer's WhatsApp number");
      const info = db.prepare(`INSERT INTO bookings (ref,name,phone,pickup,dropoff,pickup_at,passengers,status,source) VALUES (?,?,?,?,?,?,1,'completed','manual')`)
        .run(newRef(), clean(c.name, 80) || 'Customer', phone, clean(c.pickup, 200) || '—', clean(c.dropoff, 200) || '—', new Date().toISOString());
      booking = db.prepare('SELECT * FROM bookings WHERE id=?').get(info.lastInsertRowid);
    }
    const token = crypto.randomBytes(16).toString('hex');
    const ym = new Date().toISOString().slice(0, 7).replace('-', '');
    const seq = db.prepare('SELECT COUNT(*) c FROM bills').get().c + 1;
    const number = `INV-${ym}-${String(seq).padStart(4, '0')}`;
    const info = db.prepare(`INSERT INTO bills (booking_id,token,number,items,subtotal,tax_percent,tax,total,payment_method) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(booking.id, token, number, JSON.stringify(items), subtotal, taxPercent, tax, total, clean(b.payment_method, 30) || null);
    db.prepare(`UPDATE bookings SET status='completed', fare=? WHERE id=?`).run(total, booking.id);
    const bill = loadBill(db.prepare('SELECT * FROM bills WHERE id=?').get(info.lastInsertRowid));
    const link = `${baseUrl(req)}/bill/${token}`;
    return send(res, 201, { bill, link, whatsapp: waLink(clean(b.whatsapp_to, 20) || booking.phone, bill, booking, link) });
  }

  const resend = pathname.match(/^\/api\/driver\/bills\/(\d+)\/send$/);
  if (m === 'POST' && resend) {
    const bill = loadBill(db.prepare('SELECT * FROM bills WHERE booking_id=?').get(Number(resend[1])));
    if (!bill) throw new HttpError(404, 'No bill for this ride');
    const booking = db.prepare('SELECT * FROM bookings WHERE id=?').get(bill.booking_id);
    const link = `${baseUrl(req)}/bill/${bill.token}`;
    return send(res, 200, { link, whatsapp: waLink(booking.phone, bill, booking, link) });
  }

  throw new HttpError(404, 'Not found');
}

// ---------- analytics ----------
function stats() {
  const tz = config.timezone;
  const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d); // YYYY-MM-DD
  const all = db.prepare('SELECT * FROM bookings').all();
  const now = new Date();
  const today = dayKey(now);
  const monthPrefix = today.slice(0, 7);
  const done = all.filter((b) => b.status === 'completed');
  const revenue = (list) => round2(list.reduce((s, b) => s + (b.fare || 0), 0));

  const daily = {};
  for (let i = 29; i >= 0; i--) daily[dayKey(new Date(now.getTime() - i * 86400e3))] = { rides: 0, revenue: 0, bookings: 0 };
  for (const b of all) {
    const created = dayKey(new Date(b.created_at)); if (daily[created]) daily[created].bookings++;
    if (b.status === 'completed') { const k = dayKey(new Date(b.pickup_at)); if (daily[k]) { daily[k].rides++; daily[k].revenue = round2(daily[k].revenue + (b.fare || 0)); } }
  }
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, all.filter((b) => b.status === s).length]));
  const hours = Array(24).fill(0);
  for (const b of all) if (b.status !== 'cancelled' && b.status !== 'rejected') {
    hours[Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date(b.pickup_at))) % 24]++;
  }
  const top = (key) => {
    const c = {}; for (const b of all) { if (b[key] === '—') continue; const k = b[key].toLowerCase(); c[k] = c[k] || { label: b[key], n: 0 }; c[k].n++; }
    return Object.values(c).sort((a, b) => b.n - a.n).slice(0, 5);
  };
  const decided = byStatus.completed + byStatus.cancelled + byStatus.rejected;
  const customers = {}; for (const b of done) customers[b.phone] = (customers[b.phone] || 0) + 1;
  return {
    totals: {
      bookings: all.length, pending: byStatus.pending, confirmed: byStatus.confirmed, completed: done.length,
      todayRides: all.filter((b) => dayKey(new Date(b.pickup_at)) === today && ['confirmed', 'completed'].includes(b.status)).length,
      revenueAll: revenue(done),
      revenueMonth: revenue(done.filter((b) => dayKey(new Date(b.pickup_at)).startsWith(monthPrefix))),
      revenueToday: revenue(done.filter((b) => dayKey(new Date(b.pickup_at)) === today)),
      avgFare: done.length ? round2(revenue(done) / done.length) : 0,
      completionRate: decided ? Math.round(byStatus.completed / decided * 100) : null,
      repeatCustomers: Object.values(customers).filter((n) => n > 1).length,
    },
    currency: config.currency,
    daily: Object.entries(daily).map(([date, v]) => ({ date, ...v })),
    byStatus, hours, topPickups: top('pickup'), topDrops: top('dropoff'),
  };
}

// ---------- static + server ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/driver') pathname = '/driver.html';
  const file = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new HttpError(404, 'Not found');
  const ext = path.extname(file);
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' };
  if (file.endsWith('driver.html')) headers['Cache-Control'] = 'no-store';
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/bill/')) await api(req, res, url);
    else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url.pathname);
    else throw new HttpError(405, 'Method not allowed');
  } catch (e) {
    if (res.headersSent) return res.end();
    const status = e.status || 500;
    if (status === 500) console.error(e);
    send(res, status, { error: status === 500 ? 'Server error' : e.message });
  }
});

export { server, db, config };
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (config.driverPassword === 'driver123') console.warn('⚠  Using the default driver password. Set DRIVER_PASSWORD before going live.');
  server.listen(config.port, () => console.log(`Cab site:   http://localhost:${config.port}\nDriver app: http://localhost:${config.port}/driver`));
}
