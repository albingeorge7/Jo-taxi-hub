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

// Simple taxi icon (inline SVG), in the spirit of a classic receipt template
const TAXI_SVG = `<svg viewBox="0 0 64 60" width="60" height="56" aria-hidden="true"><rect x="23" y="2" width="18" height="9" rx="2" fill="#ffe600" stroke="#111" stroke-width="2"/><text x="32" y="9.2" font-size="5.6" font-weight="700" text-anchor="middle" font-family="Arial,sans-serif">TAXI</text><path d="M8 24 L12 15 Q13 12 17 12 H47 Q51 12 52 15 L56 24 V45 H8 Z" fill="#ffe600" stroke="#111" stroke-width="2.6" stroke-linejoin="round"/><path d="M15 24 L18 17 H46 L49 24 Z" fill="#111"/><circle cx="17" cy="35" r="3.2" fill="#111"/><circle cx="47" cy="35" r="3.2" fill="#111"/><circle cx="18" cy="50" r="6" fill="#111"/><circle cx="46" cy="50" r="6" fill="#111"/></svg>`;

export function renderBill(bill, booking) {
  const b = config.business;
  const hasTrip = !(booking.pickup === '—' && booking.dropoff === '—');
  const paidBy = ['cash', 'card'].includes(String(bill.payment_method || '').toLowerCase()) ? bill.payment_method : '';
  const items = bill.items.map((i) => `<tr><td><div class="dsc">${esc(i.description)}</div><div class="sub">${+i.qty} &times; ${money(i.rate)}</div></td><td class="amt">${money(i.amount)}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bill ${esc(bill.number)} – ${esc(b.name)}</title>
<style>
:root{--tint:#ffe699;--tint2:#fff5d1;--gold:#7f6000;--rule:#f3d98b;--border:#bfbfbf;--ink:#111;--muted:#595959}
*{box-sizing:border-box}
body{margin:0;background:#f1f1f1;font-family:Arial,Helvetica,'Segoe UI',sans-serif;color:var(--ink);line-height:1.45;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{padding:16px 10px 30px}
.sheet{max-width:800px;margin:0 auto;background:#fff;padding:36px 40px 30px;box-shadow:0 1px 8px rgba(0,0,0,.12)}
.top{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap}
.coname{font-size:24px;margin:8px 0 10px}
.cl{font-size:14px;line-height:1.75;color:#222}
.ttl{text-align:right;min-width:250px}
.ttl h1{margin:6px 0 22px;font-size:46px;letter-spacing:.01em;color:var(--gold);line-height:1}
table{border-collapse:collapse;width:100%}
.meta th{background:var(--tint);padding:7px 10px;font-size:14px;text-align:center}
.meta td{padding:8px 10px;text-align:center;font-weight:700;font-size:14px}
.ref{margin-top:6px;font-size:12.5px;color:var(--muted)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin:34px 0 30px}
.two h3{margin:0;padding:0 0 6px 4px;font-size:17px;border-bottom:2px solid var(--rule)}
.two .ln{padding:6px 4px 0;font-size:14px;overflow-wrap:anywhere}.two .ln:first-of-type{padding-top:10px}
.two .k{color:var(--muted);display:inline-block;min-width:44px}
.items{border:1px solid var(--border)}
.items th{background:var(--tint);padding:9px 12px;font-size:15px;font-weight:400;text-align:left;border-bottom:1px solid var(--border)}
.items th:last-child,.items td.amt{text-align:right;width:150px;border-left:1px solid var(--border)}
.items td{padding:10px 12px;vertical-align:top;border-top:1px solid #e3e3e3}
.items tr:first-child td{border-top:0}
.dsc{font-size:14.5px;overflow-wrap:anywhere}.sub{font-size:12px;color:var(--muted);margin-top:2px}
.items td.amt{font-size:14.5px;white-space:nowrap}
.totals{margin:14px 0 0 auto;max-width:320px;font-size:14.5px}
.totals .row{display:flex;justify-content:space-between;padding:5px 12px}
.totals .grand{display:flex;justify-content:space-between;margin-top:6px;padding:11px 12px;background:var(--tint);font-weight:700;font-size:17px;border:1px solid var(--border)}
.note{margin:26px 4px 0;font-size:14px}
.thanks{margin:56px 0 4px;text-align:center;font-size:15px}
.fine{text-align:center;font-size:11px;color:#8a8a8a;margin-top:8px}
.btn{display:block;margin:16px auto 0;max-width:800px;width:100%;padding:12px;background:#222;color:#fff;border:0;border-radius:6px;font:inherit;font-weight:600;cursor:pointer}
@media(max-width:600px){.sheet{padding:24px 18px}.top{flex-direction:column}.ttl{text-align:left}.ttl h1{font-size:38px;margin:0 0 14px}.two{grid-template-columns:1fr;gap:22px;margin:26px 0 22px}.items th:last-child,.items td.amt{width:112px}.thanks{margin-top:36px}}
@page{size:A4;margin:12mm}
@media print{body{background:#fff}.page{padding:0}.sheet{box-shadow:none;padding:0}.btn{display:none}}
</style></head><body><div class="page"><div class="sheet">
<div class="top"><div class="co">${TAXI_SVG}<div class="coname">${esc(b.name)}</div>
<div class="cl">${esc(b.driverName)}<br>${esc(b.address)}<br>${b.email ? esc(b.email) + '<br>' : ''}${esc(b.phone)}${b.licence ? '<br>Vehicle: ' + esc(b.licence) : ''}</div></div>
<div class="ttl"><h1>BILL</h1><table class="meta"><thead><tr><th>Invoice #</th><th>Date</th></tr></thead><tbody><tr><td>${esc(bill.number)}</td><td>${esc(when(bill.created_at, { day: '2-digit', month: '2-digit', year: 'numeric' }))}</td></tr></tbody></table><div class="ref">Booking ref: ${esc(booking.ref)}</div></div></div>
<div class="two"><section><h3>Bill to</h3><div class="ln"><b>${esc(booking.name)}</b></div><div class="ln">${esc(booking.phone)}</div></section>
<section><h3>${hasTrip ? 'Trip' : 'Date'}</h3>${hasTrip ? `<div class="ln"><span class="k">From</span> ${esc(booking.pickup)}</div><div class="ln"><span class="k">To</span> ${esc(booking.dropoff)}</div><div class="ln">${esc(when(booking.pickup_at))} &middot; ${booking.passengers} passenger${booking.passengers > 1 ? 's' : ''}</div>` : `<div class="ln">${esc(when(booking.pickup_at, { dateStyle: 'medium' }))}</div>`}</section></div>
<table class="items"><thead><tr><th>Description</th><th>Amount</th></tr></thead><tbody>${items}</tbody></table>
<div class="totals"><div class="row"><span>Subtotal</span><span>${money(bill.subtotal)}</span></div>
${bill.tax_percent ? `<div class="row"><span>Tax (${+bill.tax_percent}%)</span><span>${money(bill.tax)}</span></div>` : ''}
<div class="grand"><span>Total</span><span>${money(bill.total)}</span></div></div>
${paidBy ? `<div class="note">Paid by ${esc(paidBy)}. Thank you!</div>` : ''}
<div class="thanks">Thank you for your business!</div><div class="fine">This is a computer-generated bill.</div>
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
