import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import config from './config.js';
import { renderBill, renderPayPage, billMessage } from './bill.js';
import { buildBillPdf } from './pdf.js';

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

db.exec(`
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,                 -- YYYY-MM-DD in the business timezone
  vh TEXT NOT NULL,                  -- anonymous per-day visitor hash (no IP stored)
  source TEXT NOT NULL, device TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_visits_day ON visits(day);
`);
const SALT = (() => {
  const f = path.join(DATA_DIR, '.salt');
  try { return fs.readFileSync(f, 'utf8'); } catch { const v = crypto.randomBytes(24).toString('hex'); fs.writeFileSync(f, v, { mode: 0o600 }); return v; }
})();
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone });
const todayKey = () => dayFmt.format(new Date());

for (const col of ['pickup_lat', 'pickup_lng', 'drop_lat', 'drop_lng']) {
  try { db.exec(`ALTER TABLE bookings ADD COLUMN ${col} REAL`); } catch { /* column exists */ }
}
try { db.exec("ALTER TABLE bookings ADD COLUMN source TEXT NOT NULL DEFAULT 'web'"); } catch { /* column exists */ }

try { db.exec('ALTER TABLE bills ADD COLUMN wa_to TEXT'); } catch { /* column exists */ }

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

// Behind the Cloudflare tunnel every request arrives from localhost, so use the visitor IP
// Cloudflare passes along (only trusted when the request really came from this machine).
function clientIp(req) {
  const a = req.socket.remoteAddress || '';
  if (a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1') {
    return String(req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0] || a).trim();
  }
  return a;
}
function visitSource(ref, src, ownHost) {
  const tag = src.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20); // ?src=card on QR codes / business cards
  if (tag) return tag;
  let host = '';
  try { host = new URL(ref).hostname.replace(/^www\./, ''); } catch { /* no referrer */ }
  if (!host || host === String(ownHost).split(':')[0]) return 'direct';
  if (/wa\.me|whatsapp/.test(host)) return 'whatsapp';
  if (/google\./.test(host)) return 'google';
  if (/facebook|fb\.com|^l\.messenger/.test(host)) return 'facebook';
  if (/instagram/.test(host)) return 'instagram';
  if (/(^|\.)t\.co$|twitter|(^|\.)x\.com$/.test(host)) return 'x';
  return host.slice(0, 40);
}
const hits = new Map();
function rateLimit(req, key, max, windowMs) {
  const k = key + ':' + clientIp(req); const now = Date.now();
  const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) throw new HttpError(429, 'Too many requests, please try again later');
  arr.push(now); hits.set(k, arr);
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 3600e3)) hits.delete(k); }, 600e3).unref();

// sessions (in memory; driver just logs in again after a restart)
const sessions = new Map();
const SESSION_MS = 12 * 3600e3;
setInterval(() => { for (const [k, v] of sessions) if (v.expires < Date.now()) sessions.delete(k); }, 3600e3).unref();
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

  if (m === 'GET' && pathname === '/api/info') return send(res, 200, { ...config.business, currency: config.currency, mapCenter: config.mapCenter, countryIso: config.countryIso });

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
    const coord = (lat, lng) => { // optional map pin; both values must be valid or both are dropped
      const a = Number(lat), o = Number(lng);
      return lat != null && lng != null && lat !== '' && lng !== '' && Math.abs(a) <= 90 && Math.abs(o) <= 180 ? [a, o] : [null, null];
    };
    const [pla, plo] = coord(b.pickup_lat, b.pickup_lng), [dla, dlo] = coord(b.drop_lat, b.drop_lng);
    const info = db.prepare(`INSERT INTO bookings (ref,name,phone,email,pickup,dropoff,pickup_at,passengers,notes,pickup_lat,pickup_lng,drop_lat,drop_lng) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ref, name, phone, email || null, pickup, dropoff, when.toISOString(), passengers, notes || null, pla, plo, dla, dlo);
    const row = db.prepare('SELECT * FROM bookings WHERE id=?').get(info.lastInsertRowid);
    broadcast('booking', row);
    const pin = (la, lo) => (la != null ? `https://www.google.com/maps/search/?api=1&query=${la},${lo}` : '');
    telegram(`🚖 New booking ${ref}\n${name} (${phone})\n${pickup} → ${dropoff}\n${fmtWhen(row.pickup_at)} • ${passengers} pax${notes ? '\nNote: ' + notes : ''}${row.pickup_lat != null ? '\nPickup map: ' + pin(row.pickup_lat, row.pickup_lng) : ''}${row.drop_lat != null ? '\nDrop map: ' + pin(row.drop_lat, row.drop_lng) : ''}`);
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

  // anonymous visit counter (called once per browser session by the customer site)
  if (m === 'POST' && pathname === '/api/visit') {
    rateLimit(req, 'visit', 120, 3600e3);
    const v = await readJson(req);
    const ua = String(req.headers['user-agent'] || '');
    if (!isDriver(req) && ua && !/bot|crawl|spider|slurp|preview|monitor|uptime|curl|wget|python|headless|lighthouse/i.test(ua)) {
      const day = todayKey();
      const vh = crypto.createHmac('sha256', SALT).update(`${day}|${clientIp(req)}|${ua}`).digest('hex').slice(0, 24);
      db.prepare('INSERT INTO visits (day,vh,source,device) VALUES (?,?,?,?)')
        .run(day, vh, visitSource(clean(v.ref, 300), clean(v.src, 30), req.headers.host), /ipad|tablet/i.test(ua) ? 'tablet' : /mobi|android|iphone/i.test(ua) ? 'mobile' : 'desktop');
    }
    res.writeHead(204); return res.end();
  }

  // "pay now" link used in the WhatsApp message: hands over to the customer's UPI app
  const payPage = pathname.match(/^\/pay\/([a-f0-9]{32})$/);
  if (m === 'GET' && payPage) {
    const bill = loadBill(db.prepare('SELECT * FROM bills WHERE token=?').get(payPage[1]));
    if (!bill) throw new HttpError(404, 'Bill not found');
    return send(res, 200, renderPayPage(bill, null), { 'Cache-Control': 'no-store' });
  }

  // public bill page (HTML) and PDF

  const billPage = pathname.match(/^\/bill\/([a-f0-9]{32})(\.pdf)?$/);
  if (m === 'GET' && billPage) {
    const bill = loadBill(db.prepare('SELECT * FROM bills WHERE token=?').get(billPage[1]));
    if (!bill) throw new HttpError(404, 'Bill not found');
    const booking = db.prepare('SELECT * FROM bookings WHERE id=?').get(bill.booking_id);
    if (billPage[2]) {
      const pdf = buildBillPdf(bill, booking);
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length, 'Content-Disposition': `inline; filename="Bill-${bill.number}.pdf"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(pdf);
    }
    return send(res, 200, renderBill(bill, booking), { 'Cache-Control': 'no-store' });
  }

  // ----- driver auth -----
  if (m === 'POST' && pathname === '/api/driver/login') {
    if ((hits.get('login:' + clientIp(req)) || []).filter((t) => Date.now() - t < 15 * 60e3).length >= 10) throw new HttpError(429, 'Too many attempts, try again in 15 minutes');
    const { username, password } = await readJson(req);
    // username ignores case/spaces (phone keyboards capitalise the first letter)
    if (!(safeEq(String(username || '').trim().toLowerCase(), config.driverUser.toLowerCase()) & safeEq(password, config.driverPassword))) {
      rateLimit(req, 'login', 10, 15 * 60e3); // only wrong attempts count towards the lockout
      throw new HttpError(401, 'Wrong username or password');
    }
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

  if (m === 'GET' && pathname === '/api/driver/stats') return send(res, 200, stats(Object.fromEntries(url.searchParams)));

  if (m === 'POST' && pathname === '/api/driver/bills') {
    const b = await readJson(req);
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 20) throw new HttpError(400, 'Add at least one bill item');
    const items = b.items.map((it) => {
      const qty = Number(it.qty), rate = Number(it.rate);
      const description = clean(it.description, 120);
      if (!description || !isFinite(qty) || !isFinite(rate) || qty <= 0 || qty > 100000 || rate > 1e7) throw new HttpError(400, 'Each item needs a description, a sensible quantity and amount');
      return { description, qty, rate, amount: round2(qty * rate) };
    });
    const taxPercent = Math.max(0, Math.min(50, Number(b.tax_percent) || 0));
    const subtotal = round2(items.reduce((s, i) => s + i.amount, 0));
    if (subtotal <= 0) throw new HttpError(400, 'Bill total must be more than zero');
    const tax = round2(subtotal * taxPercent / 100), total = round2(subtotal + tax);

    const waTo = clean(b.whatsapp_to, 20);
    if (waTo && !/^\+?[0-9 ()-]{7,20}$/.test(waTo)) throw new HttpError(400, "Enter a valid WhatsApp number");
    let booking;
    if (b.booking_id) {
      booking = db.prepare('SELECT * FROM bookings WHERE id=?').get(Number(b.booking_id));
      if (!booking) throw new HttpError(404, 'Booking not found');
      if (db.prepare('SELECT 1 FROM bills WHERE booking_id=?').get(booking.id)) throw new HttpError(409, 'A bill already exists for this ride');
    } else { // ride that was not booked through the website
      const c = b.customer || {};
      const phone = clean(c.phone, 20), cname = clean(c.name, 80), pickup = clean(c.pickup, 200), dropoff = clean(c.dropoff, 200);
      if (!cname) throw new HttpError(400, "Enter the customer's name");
      if (!pickup || !dropoff) throw new HttpError(400, 'Enter the pickup and drop points');
      if (!/^\+?[0-9 ()-]{7,20}$/.test(phone)) throw new HttpError(400, "Enter the customer's WhatsApp number");
      const info = db.prepare(`INSERT INTO bookings (ref,name,phone,pickup,dropoff,pickup_at,passengers,status,source) VALUES (?,?,?,?,?,?,1,'completed','manual')`)
        .run(newRef(), cname, phone, pickup, dropoff, new Date().toISOString());
      booking = db.prepare('SELECT * FROM bookings WHERE id=?').get(info.lastInsertRowid);
    }
    const token = crypto.randomBytes(16).toString('hex');
    const ym = new Date().toISOString().slice(0, 7).replace('-', '');
    const seq = db.prepare('SELECT COUNT(*) c FROM bills').get().c + 1;
    const number = `INV-${ym}-${String(seq).padStart(4, '0')}`;
    const info = db.prepare(`INSERT INTO bills (booking_id,token,number,items,subtotal,tax_percent,tax,total,payment_method,wa_to) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(booking.id, token, number, JSON.stringify(items), subtotal, taxPercent, tax, total, clean(b.payment_method, 30) || null, waTo || null);
    db.prepare(`UPDATE bookings SET status='completed', fare=? WHERE id=?`).run(total, booking.id);
    const bill = loadBill(db.prepare('SELECT * FROM bills WHERE id=?').get(info.lastInsertRowid));
    const link = `${baseUrl(req)}/bill/${token}`;
    return send(res, 201, { bill, link, whatsapp: waLink(bill.wa_to || booking.phone, bill, booking, link) });
  }

  const resend = pathname.match(/^\/api\/driver\/bills\/(\d+)\/send$/);
  if (m === 'POST' && resend) {
    const bill = loadBill(db.prepare('SELECT * FROM bills WHERE booking_id=?').get(Number(resend[1])));
    if (!bill) throw new HttpError(404, 'No bill for this ride');
    const booking = db.prepare('SELECT * FROM bookings WHERE id=?').get(bill.booking_id);
    const link = `${baseUrl(req)}/bill/${bill.token}`;
    return send(res, 200, { link, whatsapp: waLink(bill.wa_to || booking.phone, bill, booking, link) });
  }

  throw new HttpError(404, 'Not found');
}

// ---------- analytics ----------
const DAY = 86400e3, ymd = (ms) => new Date(ms).toISOString().slice(0, 10), dayMs = (s) => Date.parse(s + 'T00:00:00Z');
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && ymd(dayMs(s)) === s;

function resolveRange(q, today, earliest) {
  let from, to = today;
  switch (q.preset) {
    case 'today': from = today; break;
    case '7d': from = ymd(dayMs(today) - 6 * DAY); break;
    case 'month': from = today.slice(0, 7) + '-01'; break;
    case 'lastmonth': to = ymd(dayMs(today.slice(0, 7) + '-01') - DAY); from = to.slice(0, 7) + '-01'; break;
    case 'all': from = earliest || today; break;
    case 'custom':
      if (!validDate(q.from) || !validDate(q.to)) throw new HttpError(400, 'Choose a valid start and end date');
      from = q.from; to = q.to; break;
    default: from = ymd(dayMs(today) - 29 * DAY); q = { ...q, preset: '30d' };
  }
  if (from > to) throw new HttpError(400, 'The start date must be on or before the end date');
  if ((dayMs(to) - dayMs(from)) / DAY > 3660) throw new HttpError(400, 'Please choose a range of 10 years or less');
  return { preset: q.preset || '30d', from, to };
}

function stats(query = {}) {
  const tz = config.timezone;
  const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d); // YYYY-MM-DD
  const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false });
  const all = db.prepare('SELECT * FROM bookings').all().map((b) => ({ ...b, day: dayKey(new Date(b.pickup_at)), created: dayKey(new Date(b.created_at)) }));
  const today = dayKey(new Date());
  const revenue = (list) => round2(list.reduce((s, b) => s + (b.fare || 0), 0));
  const earliest = all.reduce((m, b) => (!m || b.day < m ? b.day : m), '');
  const range = resolveRange(query, today, earliest);

  // live numbers for the Requests tab (not affected by the chosen range)
  const done = all.filter((b) => b.status === 'completed');
  const live = {
    pending: all.filter((b) => b.status === 'pending').length,
    todayRides: all.filter((b) => b.day === today && ['confirmed', 'completed'].includes(b.status)).length,
    revenueToday: revenue(done.filter((b) => b.day === today)),
    visitsToday: db.prepare('SELECT COUNT(*) c FROM visits WHERE day=?').get(today).c,
  };

  // numbers for the selected date range (by ride date; request volume by the date it was made)
  const inRange = all.filter((b) => b.day >= range.from && b.day <= range.to);
  const rdone = inRange.filter((b) => b.status === 'completed');
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, inRange.filter((b) => b.status === s).length]));
  const days = Math.round((dayMs(range.to) - dayMs(range.from)) / DAY) + 1;
  const monthly = days > 92; // long ranges are shown one bar per month
  const bucket = (day) => (monthly ? day.slice(0, 7) : day);
  const series = {};
  for (let i = 0; i < days; i++) series[bucket(ymd(dayMs(range.from) + i * DAY))] ||= { rides: 0, revenue: 0, bookings: 0, visits: 0, visitors: 0 };
  for (const b of all) {
    if (b.source === 'web' && b.created >= range.from && b.created <= range.to) series[bucket(b.created)].bookings++;
    if (b.status === 'completed' && b.day >= range.from && b.day <= range.to) { const e = series[bucket(b.day)]; e.rides++; e.revenue = round2(e.revenue + (b.fare || 0)); }
  }
  const vrows = db.prepare('SELECT day, COUNT(*) v, COUNT(DISTINCT vh) u FROM visits WHERE day BETWEEN ? AND ? GROUP BY day').all(range.from, range.to);
  for (const r of vrows) { const e = series[bucket(r.day)]; e.visits += r.v; e.visitors += r.u; }
  const visitsTotal = vrows.reduce((a, r) => a + r.v, 0), visitorsTotal = vrows.reduce((a, r) => a + r.u, 0);
  const group = (col) => db.prepare(`SELECT ${col} AS label, COUNT(*) n FROM visits WHERE day BETWEEN ? AND ? GROUP BY ${col} ORDER BY n DESC LIMIT 8`).all(range.from, range.to);
  const webBookings = all.filter((b) => b.source === 'web' && b.created >= range.from && b.created <= range.to).length;
  const hours = Array(24).fill(0);
  for (const b of inRange) if (b.status !== 'cancelled' && b.status !== 'rejected') hours[Number(hourFmt.format(new Date(b.pickup_at))) % 24]++;
  const top = (key) => {
    const c = {}; for (const b of inRange) { if (b[key] === '—') continue; const k = b[key].toLowerCase(); c[k] = c[k] || { label: b[key], n: 0 }; c[k].n++; }
    return Object.values(c).sort((a, b) => b.n - a.n).slice(0, 5);
  };
  const decided = byStatus.completed + byStatus.cancelled + byStatus.rejected;
  const customers = {}; for (const b of rdone) customers[b.phone] = (customers[b.phone] || 0) + 1;
  return {
    currency: config.currency, today,
    totals: live,
    range: {
      ...range, days, monthly,
      totals: {
        bookings: inRange.length, completed: rdone.length, revenue: revenue(rdone),
        avgFare: rdone.length ? round2(revenue(rdone) / rdone.length) : 0,
        completionRate: decided ? Math.round(byStatus.completed / decided * 100) : null,
        repeatCustomers: Object.values(customers).filter((n) => n > 1).length,
        visits: visitsTotal, visitors: visitorsTotal, webBookings,
        conversion: visitorsTotal ? Math.round(webBookings / visitorsTotal * 1000) / 10 : null,
      },
      sources: group('source'), devices: group('device'),
      daily: Object.entries(series).map(([date, v]) => ({ date, ...v })),
      byStatus, hours, topPickups: top('pickup'), topDrops: top('dropoff'),
    },
  };
}

// ---------- static + server ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/driver') pathname = '/driver.html';
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { throw new HttpError(404, 'Not found'); }
  const file = path.normalize(path.join(PUBLIC, decoded));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new HttpError(404, 'Not found');
  const ext = path.extname(file);
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' };
  // Always revalidate code and pages so an update never mixes old scripts with new HTML.
  headers['Cache-Control'] = ['.html', '.js', '.css'].includes(ext) ? 'no-cache, must-revalidate' : 'public, max-age=86400';
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/bill/') || url.pathname.startsWith('/pay/')) await api(req, res, url);
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
