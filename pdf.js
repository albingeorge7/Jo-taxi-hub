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
  const b = config.business, [first, ...rest] = b.name.trim().split(/\s+/);
  const NAVY = '0.071 0.188 0.42', NAVY_D = '0.043 0.122 0.29', RED = '0.882 0.114 0.165', GREY = '0.4 0.45 0.52', INK = '0.06 0.09 0.16';
  const SOFT = '0.965 0.973 0.988', LINE = '0.886 0.91 0.941', ZEBRA = '0.984 0.988 0.996', LIGHT = '0.78 0.83 0.93';
  const paid = ['cash', 'card'].includes(String(bill.payment_method || '').toLowerCase());
  const hasTrip = !(booking.pickup === '—' && booking.dropoff === '—');
  const M = 40, R = W - M;
  const pages = []; let ops;                       // all coordinates below are measured from the TOP of the page
  const addPage = () => { ops = []; pages.push(ops); };
  const rect = (x, top, w, h, rgb) => ops.push(`${rgb} rg ${x.toFixed(2)} ${(H - top - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  const box = (x, top, w, h, fill, stroke) => ops.push(`${fill} rg ${stroke} RG 0.7 w ${x.toFixed(2)} ${(H - top - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re B`);
  const line = (x1, top, x2, rgb = LINE, lw = 0.7) => ops.push(`${rgb} RG ${lw} w ${x1} ${(H - top).toFixed(2)} m ${x2} ${(H - top).toFixed(2)} l S`);
  const text = (s, x, top, { size = 10, font = 'F1', rgb = INK, align = 'left', tc = 0 } = {}) => {
    const w = textWidth(s, size, font !== 'F1') + tc * clean(s).length, px = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    ops.push(`BT ${rgb} rg /${font} ${size} Tf ${tc} Tc ${px.toFixed(2)} ${(H - top).toFixed(2)} Td (${esc(s)}) Tj ET`);
  };

  // ---- header band ----
  const header = (compact) => {
    const bh = compact ? 56 : 112;
    rect(0, 0, W, bh, NAVY); rect(0, bh, W, 4, RED);
    if (compact) {
      text(`${first} ${rest.join(' ')}`.toUpperCase(), M, 34, { size: 14, font: 'F2', rgb: '1 1 1' });
      text(`INVOICE ${bill.number}  (continued)`, R, 34, { size: 10, rgb: LIGHT, align: 'right' });
      return bh + 30;
    }
    text(first, M, 44, { size: 22, font: 'F3', rgb: '1 0.42 0.45' });
    text((rest.join(' ') || first).toUpperCase(), M, 76, { size: 30, font: 'F2', rgb: '1 1 1' });
    text(String(b.tagline || '').replace(/\s*•.*$/, ''), M, 96, { size: 9.5, rgb: LIGHT });
    text('INVOICE', R + 3, 52, { size: 9, rgb: LIGHT, align: 'right', tc: 3 });
    text(bill.number, R, 76, { size: 19, font: 'F2', rgb: '1 1 1', align: 'right' });
    return bh + 30;
  };
  addPage(); let y = header(false);

  // ---- meta row ----
  const meta = [['DATE', when(bill.created_at, { dateStyle: 'medium' })], ['BOOKING REF', booking.ref]];
  meta.forEach(([k, v], i) => { text(k, M + i * 180, y, { size: 7.5, font: 'F2', rgb: GREY, tc: 1 }); text(v, M + i * 180, y + 15, { size: 12, font: 'F2' }); });
  if (paid) { text('PAYMENT', M + 360, y, { size: 7.5, font: 'F2', rgb: GREY, tc: 1 }); rect(M + 360, y + 5, 96, 18, '0.863 0.988 0.906'); text(`PAID - ${bill.payment_method}`.toUpperCase(), M + 408, y + 17.5, { size: 8.5, font: 'F2', rgb: '0.086 0.396 0.204', align: 'center' }); }
  y += 38; line(M, y, R); y += 18;

  // ---- billed to / trip cards ----
  const cw = (R - M - 14) / 2, lx = M + 12;
  const fromL = wrap(booking.pickup, 10.5, cw - 64, 2), toL = wrap(booking.dropoff, 10.5, cw - 64, 2);
  const tripH = hasTrip ? 40 + (fromL.length + toL.length) * 13 + 16 : 52, cardH = Math.max(72, tripH);
  box(M, y, cw, cardH, SOFT, LINE); box(M + cw + 14, y, cw, cardH, SOFT, LINE);
  text('BILLED TO', lx, y + 18, { size: 7.5, font: 'F2', rgb: GREY, tc: 1 });
  text(fit(booking.name, 13, cw - 24, true), lx, y + 36, { size: 13, font: 'F2' }); text(booking.phone, lx, y + 52, { size: 10, rgb: GREY });
  const rx = M + cw + 14 + 12;
  if (hasTrip) {
    text('TRIP', rx, y + 18, { size: 7.5, font: 'F2', rgb: GREY, tc: 1 });
    let ty = y + 36;
    text('FROM', rx, ty, { size: 7.5, font: 'F2', rgb: GREY }); fromL.forEach((l) => { text(l, rx + 40, ty, { size: 10.5, font: 'F2' }); ty += 13; });
    text('TO', rx, ty, { size: 7.5, font: 'F2', rgb: GREY }); toL.forEach((l) => { text(l, rx + 40, ty, { size: 10.5, font: 'F2' }); ty += 13; });
    text(`${when(booking.pickup_at, { dateStyle: 'medium', timeStyle: 'short' })}  |  ${booking.passengers} passenger${booking.passengers > 1 ? 's' : ''}`, rx, ty + 6, { size: 9, rgb: GREY });
  } else { text('DATE', rx, y + 18, { size: 7.5, font: 'F2', rgb: GREY, tc: 1 }); text(when(booking.pickup_at, { dateStyle: 'medium' }), rx, y + 36, { size: 13, font: 'F2' }); }
  y += cardH + 20;

  // ---- items table (flows onto further pages if needed) ----
  const cQty = 372, cRate = 460, cAmt = R - 10, FOOT = 72, RESERVE = 190;
  const tableHead = () => { rect(M, y, R - M, 24, NAVY); text('DESCRIPTION', M + 10, y + 15.5, { size: 7.5, font: 'F2', rgb: '1 1 1', tc: 1 }); text('QTY', cQty, y + 15.5, { size: 7.5, font: 'F2', rgb: '1 1 1', align: 'right', tc: 1 }); text('RATE', cRate, y + 15.5, { size: 7.5, font: 'F2', rgb: '1 1 1', align: 'right', tc: 1 }); text('AMOUNT', cAmt, y + 15.5, { size: 7.5, font: 'F2', rgb: '1 1 1', align: 'right', tc: 1 }); y += 24; };
  tableHead();
  bill.items.forEach((it, idx) => {
    const dl = wrap(it.description, 10, 292, 3), rh = dl.length * 12 + 14;
    if (y + rh > H - FOOT - 20) { addPage(); y = header(true); tableHead(); }
    if (idx % 2 === 0) rect(M, y, R - M, rh, ZEBRA);
    dl.forEach((ln, i) => text(ln, M + 10, y + 17 + i * 12, { size: 10 }));
    text(String(+it.qty), cQty, y + 17, { size: 10, align: 'right' }); text(money(it.rate), cRate, y + 17, { size: 10, align: 'right' }); text(money(it.amount), cAmt, y + 17, { size: 10, font: 'F2', align: 'right' });
    y += rh; line(M, y, R);
  });

  // ---- totals ----
  if (y + RESERVE - FOOT > H - FOOT - 20) { addPage(); y = header(true); }
  y += 14; const tx = 330;
  text('Subtotal', tx, y + 4, { size: 10.5, rgb: GREY }); text(money(bill.subtotal), R - 4, y + 4, { size: 10.5, align: 'right' }); y += 20;
  if (bill.tax_percent) { text(`Tax (${+bill.tax_percent}%)`, tx, y + 4, { size: 10.5, rgb: GREY }); text(money(bill.tax), R - 4, y + 4, { size: 10.5, align: 'right' }); y += 20; }
  rect(tx - 8, y, R - tx + 8, 40, NAVY_D);
  text('TOTAL', tx + 6, y + 24.5, { size: 8.5, font: 'F2', rgb: '1 1 1', tc: 2 }); text(money(bill.total), R - 12, y + 26, { size: 17, font: 'F2', rgb: '1 1 1', align: 'right' });
  y += 66;
  text('Thank you for riding with us!', W / 2, y, { size: 12, font: 'F2', rgb: NAVY, align: 'center' });

  // ---- footer on every page ----
  pages.forEach((pg, i) => {
    ops = pg;
    rect(0, H - FOOT, W, FOOT, SOFT); line(0, H - FOOT, W, LINE, 0.7);
    text(`${b.name}  |  ${b.driverName}`, W / 2, H - 44, { size: 9.5, font: 'F2', align: 'center' });
    text(`${b.phone}${b.email ? '  |  ' + b.email : ''}`, W / 2, H - 31, { size: 8.5, rgb: GREY, align: 'center' });
    text(`${b.address}${b.licence ? '  |  Vehicle ' + b.licence : ''}  |  Computer-generated bill${pages.length > 1 ? `  |  Page ${i + 1} of ${pages.length}` : ''}`, W / 2, H - 18, { size: 7.5, rgb: GREY, align: 'center' });
  });

  // ---- assemble PDF ----
  const N = pages.length, objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${6 + i * 2} 0 R`).join(' ')}] /Count ${N} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-BoldOblique /Encoding /WinAnsiEncoding >>',
  ];
  const streams = [];
  pages.forEach((pg, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${7 + i * 2} 0 R >>`);
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
