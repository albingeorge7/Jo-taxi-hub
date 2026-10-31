import config from './config.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `${config.currency}${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (iso, opts = { dateStyle: 'medium', timeStyle: 'short' }) => new Date(iso).toLocaleString('en-GB', { timeZone: config.timezone, ...opts });

// Cash / card bills are already paid; anything else shows the UPI payment option.
export const needsPayment = (bill) => !!config.upi.id && !['cash', 'card'].includes(String(bill.payment_method || '').toLowerCase());
const upiQuery = (bill) => `pa=${encodeURIComponent(config.upi.id).replace(/%40/g, '@')}&pn=${encodeURIComponent(config.upi.name)}&am=${Number(bill.total).toFixed(2)}&cu=INR&tn=${encodeURIComponent('Bill ' + bill.number)}`;
export const upiLink = (bill) => `upi://pay?${upiQuery(bill)}`;
// App-specific links go straight to that app, so the customer is not sent to whichever app grabbed upi:// (often WhatsApp Pay).
export const upiAppLinks = (bill) => [['Google Pay', `tez://upi/pay?${upiQuery(bill)}`], ['PhonePe', `phonepe://pay?${upiQuery(bill)}`], ['Paytm', `paytmmp://pay?${upiQuery(bill)}`]];

// WhatsApp message: short labelled sections, *bold* headings, each link on its own line so it stays tappable.
export function billMessage(bill, booking, link) {
  const hasTrip = !(booking.pickup === '—' && booking.dropoff === '—');
  const pay = needsPayment(bill);
  const paidBy = !pay && bill.payment_method ? `${bill.payment_method} (paid)` : '';
  const lines = [
    `🚖 *${config.business.name}*`,
    '',
    `Hello ${booking.name}, thank you for riding with us! 🙏`,
    '',
    `🧾 *Bill ${bill.number}*`,
    ...(hasTrip ? [`📍 ${booking.pickup} → ${booking.dropoff}`] : []),
    `💰 *Total: ${money(bill.total)}*`,
    ...(paidBy ? [`✅ ${paidBy}`] : []),
    ...(pay ? ['', '💳 *Pay now* (opens your UPI app)', link.replace('/bill/', '/pay/')] : []),
    '',
    '📄 *View bill*',
    link,
    '',
    '📎 *Download PDF*',
    `${link}.pdf`,
    '',
    `— ${config.business.driverName}`,
    `📞 ${config.business.phone}`,
  ];
  return lines.join('\n');
}

export function renderBill(bill, booking) {
  const b = config.business, [first, ...rest] = b.name.trim().split(/\s+/);
  const hasTrip = !(booking.pickup === '—' && booking.dropoff === '—');
  const paid = ['cash', 'card'].includes(String(bill.payment_method || '').toLowerCase());
  const tagline = String(b.tagline || '').replace(/\s*•.*$/, '');
  const items = bill.items.map((i) => `<div class="it"><div class="d"><b>${esc(i.description)}</b><span>${+i.qty} &times; ${money(i.rate)}</span></div><div class="a">${money(i.amount)}</div></div>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bill ${esc(bill.number)} – ${esc(b.name)}</title>
<style>
:root{--navy:#12306b;--navy-d:#0b1f4a;--red:#e11d2a;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--soft:#f6f8fc}
*{box-sizing:border-box}
body{margin:0;background:#e9edf5;font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:var(--ink);line-height:1.5;-webkit-font-smoothing:antialiased;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{padding:18px 12px 32px}
.sheet{max-width:780px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 10px 40px rgba(15,23,42,.14)}
.band{background:linear-gradient(120deg,var(--navy-d),var(--navy));color:#fff;padding:26px 28px;display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap}
.brand{line-height:1}.jo{display:block;font-family:'Brush Script MT','Lucida Handwriting','Segoe Script',cursive;font-style:italic;font-weight:700;color:#ff6b73;font-size:26px;margin-left:2px}
.tc{display:block;font-family:Impact,'Haettenschweiler','Arial Narrow Bold',Inter,sans-serif;font-weight:900;font-size:36px;letter-spacing:.02em;text-transform:uppercase}
.tag{margin-top:8px;font-size:12.5px;color:#c7d3ee;letter-spacing:.02em}
.inv{text-align:right}.inv .lbl{font-size:12px;letter-spacing:.28em;color:#c7d3ee}.inv .no{font-size:22px;font-weight:700;margin-top:2px}
.accent{height:4px;background:linear-gradient(90deg,var(--red),#ff6b73)}
.body{padding:26px 28px 8px}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:14px;padding-bottom:20px;border-bottom:1px solid var(--line)}
.meta div span{display:block;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:600}.meta div b{font-size:15px}
.chip{display:inline-block;margin-top:2px;padding:3px 12px;border-radius:99px;background:#dcfce7;color:#166534;font-weight:700;font-size:13px}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:20px 0}
@media(max-width:560px){.cards{grid-template-columns:1fr}.band{padding:22px 20px}.body{padding:22px 18px 6px}.tc{font-size:30px}.inv{text-align:left}}
.route>div{display:flex;gap:10px;align-items:baseline;margin-bottom:4px}.route i{font-style:normal;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);min-width:34px}.route b{font-size:15px;overflow-wrap:anywhere}
.card{background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.card h4{margin:0 0 6px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.card b{display:block;font-size:16px}.card span{display:block;color:var(--muted);font-size:13.5px;overflow-wrap:anywhere}
.arrow{color:var(--red);font-weight:700;padding:0 4px}
.items{margin-top:6px;border:1px solid var(--line);border-radius:12px;overflow:hidden}
.items .hd{display:flex;justify-content:space-between;background:var(--navy);color:#fff;padding:10px 16px;font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600}
.it{display:flex;justify-content:space-between;gap:16px;padding:12px 16px;border-top:1px solid var(--line)}.it:nth-child(odd){background:#fbfcfe}
.it .d b{display:block;font-weight:600;font-size:14.5px;overflow-wrap:anywhere}.it .d span{display:block;color:var(--muted);font-size:12.5px}.it .a{font-weight:600;white-space:nowrap}
.totals{margin:16px 0 0 auto;max-width:340px}
.totals .row{display:flex;justify-content:space-between;padding:6px 4px;color:var(--muted);font-size:14.5px}
.totals .grand{display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding:14px 16px;border-radius:12px;background:linear-gradient(120deg,var(--navy-d),var(--navy));color:#fff}
.grand span{font-size:12px;letter-spacing:.16em;font-weight:600}.grand b{font-size:24px}
.thanks{margin:24px 0 20px;text-align:center;color:var(--navy);font-weight:600}
.foot{background:var(--soft);border-top:1px solid var(--line);padding:16px 28px;text-align:center;color:var(--muted);font-size:12.5px}
.foot b{color:var(--ink)}
.btn{display:block;margin:18px auto 0;max-width:780px;padding:13px;background:var(--red);color:#fff;border:0;border-radius:12px;font:inherit;font-weight:600;cursor:pointer;width:100%}
@page{size:A4;margin:10mm}
@media print{body{background:#fff}.page{padding:0}.sheet{box-shadow:none;border-radius:0}.btn{display:none}}
</style></head><body><div class="page"><div class="sheet">
<div class="band"><div class="brand"><span class="jo">${esc(first)}</span><span class="tc">${esc(rest.join(' ') || first)}</span><div class="tag">${esc(tagline)}</div></div>
<div class="inv"><div class="lbl">INVOICE</div><div class="no">${esc(bill.number)}</div></div></div>
<div class="accent"></div>
<div class="body">
<div class="meta"><div><span>Date</span><b>${esc(when(bill.created_at, { dateStyle: 'medium' }))}</b></div><div><span>Booking ref</span><b>${esc(booking.ref)}</b></div>
${paid ? `<div><span>Payment</span><b class="chip">PAID &middot; ${esc(bill.payment_method)}</b></div>` : ''}</div>
<div class="cards"><div class="card"><h4>Billed to</h4><b>${esc(booking.name)}</b><span>${esc(booking.phone)}</span></div>
<div class="card"><h4>${hasTrip ? 'Trip' : 'Date'}</h4>${hasTrip ? `<div class="route"><div><i>From</i><b>${esc(booking.pickup)}</b></div><div><i>To</i><b>${esc(booking.dropoff)}</b></div></div><span style="margin-top:6px">${esc(when(booking.pickup_at))} &middot; ${booking.passengers} passenger${booking.passengers > 1 ? 's' : ''}</span>` : `<b>${esc(when(booking.pickup_at, { dateStyle: 'medium' }))}</b>`}</div></div>
<div class="items"><div class="hd"><span>Description</span><span>Amount</span></div>${items}</div>
<div class="totals"><div class="row"><span>Subtotal</span><span>${money(bill.subtotal)}</span></div>
${bill.tax_percent ? `<div class="row"><span>Tax (${+bill.tax_percent}%)</span><span>${money(bill.tax)}</span></div>` : ''}
<div class="grand"><span>TOTAL</span><b>${money(bill.total)}</b></div></div>
<div class="thanks">Thank you for riding with us! 🙏</div>
</div>
<div class="foot"><b>${esc(b.name)}</b> &middot; ${esc(b.driverName)}<br>${esc(b.phone)}${b.email ? ' &middot; ' + esc(b.email) : ''}<br>${esc(b.address)}${b.licence ? ' &middot; Vehicle ' + esc(b.licence) : ''}<br><span style="opacity:.8">This is a computer-generated bill.</span></div>
</div><button class="btn" onclick="window.print()">Print / Save as PDF</button></div></body></html>`;
}

// Small page behind the "pay now" link in the WhatsApp message. WhatsApp only makes http(s) links tappable,
// so this page hands over to the customer's UPI app (upi:// link) with the amount filled in.
export function renderPayPage(bill, booking) {
  const b = config.business, due = needsPayment(bill);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pay ${esc(b.name)}</title>
<style>body{font-family:system-ui,Segoe UI,Arial,sans-serif;background:#f3f4f6;margin:0;padding:16px;color:#111827}
.box{max-width:420px;margin:40px auto;background:#fff;border-radius:16px;padding:28px 24px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.08)}
h1{margin:0 0 4px;font-size:20px;color:#12306b}.amt{font-size:34px;font-weight:800;margin:14px 0 4px}.muted{color:#6b7280;font-size:14px}
a.btn{display:block;margin:10px 0;padding:15px;background:#16a34a;color:#fff;border-radius:12px;font-size:17px;font-weight:700;text-decoration:none}
a.sec{display:block;margin-top:14px;color:#12306b;font-size:14px}a.btn.alt{background:#fff;color:#12306b;border:1px solid #cbd5e1}</style></head><body><div class="box">
<h1>${esc(b.name)}</h1><div class="muted">Bill ${esc(bill.number)}</div>
${due ? `<div class="amt">${money(bill.total)}</div>
<div class="muted" style="margin-top:6px">Choose your payment app</div>
${upiAppLinks(bill).map(([n, u]) => `<a class="btn" href="${esc(u)}">${n}</a>`).join('')}
<a class="btn alt" href="${esc(upiLink(bill))}">Other UPI app</a>
<div class="muted">The amount is filled in for you. If nothing opens, tap the menu and choose <b>Open in browser</b> (Chrome or Safari), then try again.</div>`
 : `<div class="amt">Paid</div><div class="muted">This bill is already marked as paid (${esc(bill.payment_method || '')}). No payment is needed.</div>`}
<a class="sec" href="/bill/${esc(bill.token)}">View bill</a></div></body></html>`;
}
