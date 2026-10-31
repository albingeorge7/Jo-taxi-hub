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
const fit = (s, size, max, bold) => { let t = clean(s); if (textWidth(t, size, bold) <= max) return t; while (t.length > 1 && textWidth(t + '...', size, bold) > max) t = t.slice(0, -1); return t + '...'; };
const money = (n) => clean(`${config.currency}${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const when = (iso, opts) => new Date(iso).toLocaleString('en-GB', { timeZone: config.timezone, ...opts });

export function buildBillPdf(bill, booking) {
  const b = config.business, ops = [];
  const NAVY = '0.071 0.188 0.42', RED = '0.882 0.114 0.165', GREY = '0.4 0.45 0.52', INK = '0.06 0.09 0.16';
  const rect = (x, y, w, h, rgb) => ops.push(`${rgb} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  const line = (x1, y1, x2, y2, rgb = '0.89 0.91 0.94', lw = 0.7) => ops.push(`${rgb} RG ${lw} w ${x1} ${y1} m ${x2} ${y2} l S`);
  const text = (s, x, y, { size = 10, bold = false, rgb = INK, align = 'left' } = {}) => {
    const w = textWidth(s, size, bold), px = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    ops.push(`BT ${rgb} rg /${bold ? 'F2' : 'F1'} ${size} Tf ${px.toFixed(2)} ${y.toFixed(2)} Td (${esc(s)}) Tj ET`);
  };

  // header band
  rect(0, H - 96, W, 96, NAVY); rect(0, H - 100, W, 4, RED);
  text(b.name, 40, H - 44, { size: 22, bold: true, rgb: '1 1 1' });
  text(`${b.driverName}  |  ${b.phone}`, 40, H - 62, { size: 10, rgb: '0.85 0.88 0.95' });
  text(b.address, 40, H - 76, { size: 10, rgb: '0.85 0.88 0.95' });
  text('BILL', W - 40, H - 42, { size: 20, bold: true, rgb: '1 1 1', align: 'right' });
  text(bill.number, W - 40, H - 60, { size: 11, rgb: '0.85 0.88 0.95', align: 'right' });
  text(`Date: ${when(bill.created_at, { dateStyle: 'medium' })}`, W - 40, H - 76, { size: 10, rgb: '0.85 0.88 0.95', align: 'right' });

  // customer + trip
  let y = H - 140;
  text('BILLED TO', 40, y, { size: 8, bold: true, rgb: GREY });
  text(booking.name, 40, y - 16, { size: 13, bold: true });
  text(booking.phone, 40, y - 31, { size: 10, rgb: GREY });
  text('BOOKING', W - 40, y, { size: 8, bold: true, rgb: GREY, align: 'right' });
  text(booking.ref, W - 40, y - 16, { size: 12, bold: true, align: 'right' });
  const hasTrip = !(booking.pickup === '—' && booking.dropoff === '—');
  y -= 58;
  if (hasTrip) {
    text('TRIP', 40, y, { size: 8, bold: true, rgb: GREY });
    text(fit(`${booking.pickup}  ->  ${booking.dropoff}`, 11, W - 80, true), 40, y - 16, { size: 11, bold: true });
    text(`Pickup: ${when(booking.pickup_at, { dateStyle: 'medium', timeStyle: 'short' })}  |  ${booking.passengers} passenger(s)`, 40, y - 31, { size: 10, rgb: GREY });
    y -= 58;
  }

  // items table
  const cQty = 370, cRate = 455, cAmt = W - 40;
  rect(40, y - 6, W - 80, 24, '0.94 0.95 0.98');
  text('DESCRIPTION', 48, y + 2, { size: 8, bold: true, rgb: GREY }); text('QTY', cQty, y + 2, { size: 8, bold: true, rgb: GREY, align: 'right' });
  text('RATE', cRate, y + 2, { size: 8, bold: true, rgb: GREY, align: 'right' }); text('AMOUNT', cAmt - 8, y + 2, { size: 8, bold: true, rgb: GREY, align: 'right' });
  y -= 26;
  for (const it of bill.items) {
    text(fit(it.description, 10, 290), 48, y, { size: 10 });
    text(String(+it.qty), cQty, y, { size: 10, align: 'right' }); text(money(it.rate), cRate, y, { size: 10, align: 'right' }); text(money(it.amount), cAmt - 8, y, { size: 10, align: 'right' });
    line(40, y - 7, W - 40, y - 7); y -= 22;
  }

  // totals
  y -= 6;
  text('Subtotal', cRate, y, { size: 10, rgb: GREY, align: 'right' }); text(money(bill.subtotal), cAmt - 8, y, { size: 10, align: 'right' }); y -= 18;
  if (bill.tax_percent) { text(`Tax (${+bill.tax_percent}%)`, cRate, y, { size: 10, rgb: GREY, align: 'right' }); text(money(bill.tax), cAmt - 8, y, { size: 10, align: 'right' }); y -= 18; }
  line(300, y + 10, W - 40, y + 10, INK, 1);
  text('TOTAL', cRate, y - 8, { size: 13, bold: true, align: 'right' }); text(money(bill.total), cAmt - 8, y - 8, { size: 15, bold: true, rgb: RED, align: 'right' });
  y -= 36;
  if (bill.payment_method) text(`Payment: ${bill.payment_method}`, 40, y, { size: 10, rgb: GREY });
  if (!['cash', 'card'].includes(String(bill.payment_method || '').toLowerCase()) && config.upi.id) {
    rect(40, y - 62, W - 80, 48, '0.94 0.97 0.94'); text('PAY BY UPI', 52, y - 28, { size: 8, bold: true, rgb: GREY });
    text(config.upi.id, 52, y - 46, { size: 13, bold: true, rgb: NAVY }); text(`Amount: ${money(bill.total)}`, W - 52, y - 46, { size: 11, bold: true, align: 'right' });
  }

  // footer
  line(40, 70, W - 40, 70);
  text('Thank you for riding with us!', W / 2, 52, { size: 11, bold: true, rgb: NAVY, align: 'center' });
  text(`${b.name}  |  ${b.phone}${b.email ? '  |  ' + b.email : ''}`, W / 2, 38, { size: 9, rgb: GREY, align: 'center' });

  // assemble objects + xref
  const content = Buffer.from(ops.join('\n'), 'latin1');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    null,
  ];
  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')], offsets = [];
  let pos = parts[0].length;
  objs.forEach((o, i) => {
    offsets.push(pos);
    const body = o === null ? Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from('\nendstream')]) : Buffer.from(o);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
    parts.push(chunk); pos += chunk.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`));
  return Buffer.concat(parts);
}
