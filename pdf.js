// Minimal dependency-free PDF writer for a one-page bill (standard Helvetica fonts).
import config from './config.js';

const W = 595.28, H = 841.89;
// Helvetica glyph widths (1/1000 em) for ASCII 32..126, used to right-align and truncate text.
const WIDTHS = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,
  667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,
  556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];

// Standard PDF fonts only cover Latin-1, so map or replace anything else.
const clean = (s) => String(s ?? '').replace(/₹/g, 'Rs.').replace(/→/g, '->').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[•·]/g, '-').replace(/[^\x20-\x7e\xa1-\xff]/g, '?');
const esc = (s) => clean(s).replace(/[\\()]/g, '\\$&');
const textWidth = (s, size, bold) => [...clean(s)].reduce((a, c) => a + (WIDTHS[c.charCodeAt(0) - 32] ?? 556), 0) * size / 1000 * (bold ? 1.06 : 1);
const wrap = (s, size, max, lines = 2) => { // greedy word wrap, last line truncated with "..."
  const words = clean(s).split(' '), out = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (textWidth(t, size) <= max || !cur) cur = t; else { out.push(cur); cur = w; } }
  out.push(cur);
  if (out.length > lines) { const keep = out.slice(0, lines); keep[lines - 1] = fit(out.slice(lines - 1).join(' '), size, max); return keep; }
  return out.map((l) => fit(l, size, max));
};
const fit = (s, size, max, bold) => { let t = clean(s); if (textWidth(t, size, bold) <= max) return t; while (t.length > 1 && textWidth(t + '...', size, bold) > max) t = t.slice(0, -1); return t + '...'; };
const money = (n) => clean(`${config.currency}${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const when = (iso, opts) => new Date(iso).toLocaleString('en-GB', { timeZone: config.timezone, ...opts });

export function buildBillPdf(bill, booking) {
  const b = config.business;
  const TINT = '0.91 0.933 0.984', GOLD = '0.882 0.114 0.165', RULE = '0.882 0.114 0.165', BORDER = '0.765 0.804 0.89', SEP = '0.902 0.922 0.961', NAVY = '0.071 0.188 0.42', NAVY_D = '0.043 0.122 0.29';
  const INK = '0.07 0.09 0.15', GREY = '0.35 0.4 0.47', WHITE = '1 1 1', RED = '0.882 0.114 0.165';
  const paidBy = ['cash', 'card'].includes(String(bill.payment_method || '').toLowerCase()) ? bill.payment_method : '';
  const hasTrip = !(booking.pickup === '—' && booking.dropoff === '—');
  const M = 44, R = W - M;
  const pages = []; let ops;                       // coordinates are measured from the TOP of the page
  const addPage = () => { ops = []; pages.push(ops); };
  const P = (x, top) => `${x.toFixed(2)} ${(H - top).toFixed(2)}`;
  const rect = (x, top, w, h, rgb) => ops.push(`${rgb} rg ${x.toFixed(2)} ${(H - top - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  const frame = (x, top, w, h, stroke = BORDER, lw = 0.8) => ops.push(`${stroke} RG ${lw} w ${x.toFixed(2)} ${(H - top - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`);
  const line = (x1, t1, x2, t2, rgb = SEP, lw = 0.7) => ops.push(`${rgb} RG ${lw} w ${P(x1, t1)} m ${P(x2, t2)} l S`);
  const poly = (pts, fill, stroke, lw = 1) => ops.push(`${fill} rg ${stroke} RG ${lw} w ${P(...pts[0])} m ${pts.slice(1).map((q) => P(...q) + ' l').join(' ')} h B`);
  const circle = (cx, top, r, fill) => {
    const k = 0.5523 * r, y = H - top, f = (n) => n.toFixed(2);
    ops.push(`${fill} rg ${f(cx + r)} ${f(y)} m ${f(cx + r)} ${f(y + k)} ${f(cx + k)} ${f(y + r)} ${f(cx)} ${f(y + r)} c ${f(cx - k)} ${f(y + r)} ${f(cx - r)} ${f(y + k)} ${f(cx - r)} ${f(y)} c ${f(cx - r)} ${f(y - k)} ${f(cx - k)} ${f(y - r)} ${f(cx)} ${f(y - r)} c ${f(cx + k)} ${f(y - r)} ${f(cx + r)} ${f(y - k)} ${f(cx + r)} ${f(y)} c f`);
  };
  const text = (s, x, top, { size = 10, font = 'F1', rgb = INK, align = 'left' } = {}) => {
    const w = textWidth(s, size, font !== 'F1'), px = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    ops.push(`BT ${rgb} rg /${font} ${size} Tf ${px.toFixed(2)} ${(H - top).toFixed(2)} Td (${esc(s)}) Tj ET`);
  };
  const taxiIcon = (x0, t0, s) => {                 // little taxi, drawn from simple shapes
    const X = (x) => x0 + x * s, T = (y) => t0 + y * s;
    poly([[23, 2], [41, 2], [41, 11], [23, 11]].map(([x, y]) => [X(x), T(y)]), WHITE, NAVY_D, 1.2);
    text('TAXI', X(32), T(8.6), { size: 5.2 * s, font: 'F2', rgb: NAVY_D, align: 'center' });
    poly([[8, 24], [12, 15], [14, 12], [50, 12], [52, 15], [56, 24], [56, 45], [8, 45]].map(([x, y]) => [X(x), T(y)]), RED, NAVY_D, 1.8);
    poly([[15, 24], [18, 17], [46, 17], [49, 24]].map(([x, y]) => [X(x), T(y)]), NAVY_D, NAVY_D, 0.5);
    circle(X(17), T(35), 3.2 * s, WHITE); circle(X(47), T(35), 3.2 * s, WHITE);
    circle(X(18), T(50), 6 * s, NAVY_D); circle(X(46), T(50), 6 * s, NAVY_D);
  };

  // ---- first page header: icon + company on the left, INVOICE + number/date table on the right ----
  addPage();
  taxiIcon(M, 34, 0.95);
  text(b.name, M, 122, { size: 20 });
  const contact = [b.driverName, b.address, b.email, b.phone, b.licence ? `Vehicle: ${b.licence}` : ''].filter(Boolean);
  contact.forEach((l, i) => text(l, M, 146 + i * 15, { size: 10, rgb: '0.15 0.15 0.15' }));
  text('INVOICE', R, 80, { size: 34, font: 'F2', rgb: GOLD, align: 'right' });
  const mx = 330, c1 = 135, c2 = R - mx - c1;
  rect(mx, 112, R - mx, 24, TINT);
  text('Invoice #', mx + c1 / 2, 128, { size: 10.5, font: 'F2', rgb: NAVY, align: 'center' }); text('Date', mx + c1 + c2 / 2, 128, { size: 10.5, font: 'F2', rgb: NAVY, align: 'center' });
  text(bill.number, mx + c1 / 2, 154, { size: 10.5, font: 'F2', align: 'center' });
  text(when(bill.created_at, { day: '2-digit', month: '2-digit', year: 'numeric' }), mx + c1 + c2 / 2, 154, { size: 10.5, font: 'F2', align: 'center' });
  text(`Booking ref: ${booking.ref}`, R, 176, { size: 9, rgb: GREY, align: 'right' });
  let y = Math.max(146 + (contact.length - 1) * 15, 180) + 40;

  // ---- Bill to / Trip ----
  const gap = 28, cw = (R - M - gap) / 2, rx = M + cw + gap;
  text('Bill to', M + 4, y, { size: 13, font: 'F2', rgb: NAVY }); line(M, y + 8, M + cw, y + 8, RULE, 2);
  text(fit(booking.name, 11, cw - 8, true), M + 4, y + 28, { size: 11, font: 'F2' }); text(booking.phone, M + 4, y + 44, { size: 10.5 });
  text(hasTrip ? 'Trip' : 'Date', rx + 4, y, { size: 13, font: 'F2', rgb: NAVY }); line(rx, y + 8, rx + cw, y + 8, RULE, 2);
  let ty = y + 28;
  if (hasTrip) {
    const fromL = wrap(booking.pickup, 10.5, cw - 52, 2), toL = wrap(booking.dropoff, 10.5, cw - 52, 2);
    text('From', rx + 4, ty, { size: 9, rgb: GREY }); fromL.forEach((l) => { text(l, rx + 44, ty, { size: 10.5 }); ty += 14; });
    text('To', rx + 4, ty, { size: 9, rgb: GREY }); toL.forEach((l) => { text(l, rx + 44, ty, { size: 10.5 }); ty += 14; });
    text(`${when(booking.pickup_at, { dateStyle: 'medium', timeStyle: 'short' })}  |  ${booking.passengers} passenger${booking.passengers > 1 ? 's' : ''}`, rx + 4, ty + 2, { size: 9.5, rgb: GREY }); ty += 16;
  } else { text(when(booking.pickup_at, { dateStyle: 'medium' }), rx + 4, ty, { size: 10.5 }); ty += 16; }
  y = Math.max(y + 56, ty) + 26;

  // ---- items table (bordered, flows onto more pages) ----
  const amtX = R - 118, BOTTOM = H - 58;
  let segTop = 0;
  const openTable = () => { segTop = y; rect(M, y, R - M, 26, TINT); text('Description', M + 10, y + 17, { size: 11.5, font: 'F2', rgb: NAVY }); text('Amount', R - 10, y + 17, { size: 11.5, font: 'F2', rgb: NAVY, align: 'right' }); line(M, y + 26, R, y + 26, BORDER, 0.8); y += 26; };
  const closeTable = () => { frame(M, segTop, R - M, y - segTop); line(amtX, segTop, amtX, y, BORDER, 0.8); };
  const compactHeader = () => {
    text(b.name, M, 44, { size: 15 }); text(`INVOICE ${bill.number}  (continued)`, R, 44, { size: 10, font: 'F2', rgb: GOLD, align: 'right' });
    line(M, 54, R, 54, RULE, 1.6); return 84;
  };
  openTable();
  bill.items.forEach((it) => {
    const dl = wrap(it.description, 10.5, amtX - M - 22, 3), rh = dl.length * 13.5 + 9 + 14;
    if (y + rh > BOTTOM) { closeTable(); addPage(); y = compactHeader(); openTable(); }
    dl.forEach((ln, i) => text(ln, M + 10, y + 17 + i * 13.5, { size: 10.5 }));
    text(`${+it.qty} x ${money(it.rate)}`, M + 10, y + 17 + dl.length * 13.5 - 2, { size: 8.5, rgb: GREY });
    text(money(it.amount), R - 10, y + 17, { size: 10.5, align: 'right' });
    y += rh; line(M + 0.4, y, R - 0.4, y, SEP);
  });
  closeTable();

  // ---- totals ----
  if (y + 150 > BOTTOM) { addPage(); y = compactHeader() - 20; }
  y += 18; const tx = 330;
  text('Subtotal', tx + 10, y, { size: 10.5 }); text(money(bill.subtotal), R - 10, y, { size: 10.5, align: 'right' }); y += 19;
  if (bill.tax_percent) { text(`Tax (${+bill.tax_percent}%)`, tx + 10, y, { size: 10.5 }); text(money(bill.tax), R - 10, y, { size: 10.5, align: 'right' }); y += 19; }
  rect(tx, y - 8, R - tx, 32, TINT); frame(tx, y - 8, R - tx, 32);
  text('Total', tx + 10, y + 13, { size: 12.5, font: 'F2', rgb: NAVY }); text(money(bill.total), R - 10, y + 13, { size: 14, font: 'F2', rgb: NAVY, align: 'right' });
  if (paidBy) text(`Paid by ${paidBy}. Thank you!`, M + 4, y + 13, { size: 10.5 });
  y += 70;
  text('Thank you for your business!', W / 2, y, { size: 12, rgb: NAVY, align: 'center' });

  // ---- tiny footer on every page ----
  pages.forEach((pg, i) => { ops = pg; text(`Computer-generated invoice${pages.length > 1 ? `  |  Page ${i + 1} of ${pages.length}` : ''}`, W / 2, H - 26, { size: 8, rgb: '0.55 0.55 0.55', align: 'center' }); });

  // ---- assemble PDF ----
  const N = pages.length, objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')}] /Count ${N} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];
  const streams = [];
  pages.forEach((pg, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`);
    objs.push(null); streams.push(Buffer.from(pg.join('\n'), 'latin1'));
  });
  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')], offsets = [];
  let pos = parts[0].length, si = 0;
  objs.forEach((o, i) => {
    offsets.push(pos);
    const body = o === null ? (() => { const s = streams[si++]; return Buffer.concat([Buffer.from(`<< /Length ${s.length} >>\nstream\n`), s, Buffer.from('\nendstream')]); })() : Buffer.from(o);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
    parts.push(chunk); pos += chunk.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`));
  return Buffer.concat(parts);
}
