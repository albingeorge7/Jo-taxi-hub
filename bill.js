import config from './config.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `${config.currency}${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (iso, opts = { dateStyle: 'medium', timeStyle: 'short' }) => new Date(iso).toLocaleString('en-GB', { timeZone: config.timezone, ...opts });

// Cash / card bills are already paid; anything else shows the UPI payment option.
export const needsPayment = (bill) => !!config.upi.id && !['cash', 'card'].includes(String(bill.payment_method || '').toLowerCase());
export const upiLink = (bill) => `upi://pay?pa=${encodeURIComponent(config.upi.id).replace(/%40/g, '@')}&pn=${encodeURIComponent(config.upi.name)}&am=${Number(bill.total).toFixed(2)}&cu=INR&tn=${encodeURIComponent('Bill ' + bill.number)}`;

export function billMessage(bill, booking, link) {
  const trip = booking.pickup === '—' && booking.dropoff === '—' ? '' : ` for your trip ${booking.pickup} → ${booking.dropoff}`;
  return `Hello ${booking.name},\n\nThank you for riding with ${config.business.name}.\nBill ${bill.number}${trip}: total ${money(bill.total)}.${needsPayment(bill) ? `\n\nPay ${money(bill.total)} now (tap to open your UPI app): ${link.replace('/bill/', '/pay/')}` : ''}\n\nView / print your bill: ${link}\nPDF: ${link}.pdf\n\n${config.business.driverName}, ${config.business.phone}`;
}

export function renderBill(bill, booking) {
  const b = config.business;
  const rows = bill.items.map((i) => `<tr><td>${esc(i.description)}</td><td class="r">${+i.qty}</td><td class="r">${money(i.rate)}</td><td class="r">${money(i.amount)}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bill ${esc(bill.number)} – ${esc(b.name)}</title>
<style>
body{font-family:system-ui,Segoe UI,Arial,sans-serif;background:#f3f4f6;margin:0;padding:16px;color:#111827}
.sheet{max-width:720px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;box-shadow:0 2px 12px rgba(0,0,0,.08)}
h1{margin:0;font-size:22px;color:#e11d2a}.top{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;border-bottom:2px solid #12306b;padding-bottom:12px}
.muted{color:#6b7280;font-size:14px}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{padding:8px;border-bottom:1px solid #e5e7eb;text-align:left;font-size:14px}
.r{text-align:right}.tot td{font-weight:700;border:0}.grand td{font-size:18px;border-top:2px solid #111827}

.btn{display:inline-block;margin-top:12px;padding:10px 16px;background:#e11d2a;color:#fff;border:0;border-radius:8px;font-weight:600;cursor:pointer}
@media print{body{background:#fff;padding:0}.sheet{box-shadow:none}.btn{display:none}}
</style></head><body><div class="sheet">
<div class="top"><div><h1>${esc(b.name)}</h1><div class="muted">${esc(b.driverName)}<br>${esc(b.address)}<br>${esc(b.phone)}${b.email ? ' • ' + esc(b.email) : ''}${b.licence ? '<br>Vehicle: ' + esc(b.licence) : ''}</div></div>
<div class="muted" style="text-align:right"><strong style="font-size:16px;color:#111827">BILL ${esc(bill.number)}</strong><br>Date: ${esc(when(bill.created_at, { dateStyle: 'medium' }))}<br>Booking: ${esc(booking.ref)}</div></div>
<p><strong>Billed to:</strong> ${esc(booking.name)}<br><span class="muted">${esc(booking.phone)}${booking.email ? ' • ' + esc(booking.email) : ''}</span></p>
${booking.pickup === '—' && booking.dropoff === '—' ? `<p class="muted">Date: ${esc(when(booking.pickup_at))}</p>` : `<p><strong>Trip:</strong> ${esc(booking.pickup)} → ${esc(booking.dropoff)}<br><span class="muted">Pickup: ${esc(when(booking.pickup_at))} • ${booking.passengers} passenger(s)</span></p>`}
<table><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody>
<tfoot><tr class="tot"><td colspan="3" class="r">Subtotal</td><td class="r">${money(bill.subtotal)}</td></tr>
${bill.tax_percent ? `<tr class="tot"><td colspan="3" class="r">Tax (${+bill.tax_percent}%)</td><td class="r">${money(bill.tax)}</td></tr>` : ''}
<tr class="tot grand"><td colspan="3" class="r">Total</td><td class="r">${money(bill.total)}</td></tr></tfoot></table>
${bill.payment_method ? `<p class="muted">Payment: ${esc(bill.payment_method)}</p>` : ''}
<p class="muted">Thank you for riding with us!</p>
<button class="btn" onclick="window.print()">Print / Save as PDF</button>
</div></body></html>`;
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
a.btn{display:block;margin:18px 0 8px;padding:15px;background:#16a34a;color:#fff;border-radius:12px;font-size:17px;font-weight:700;text-decoration:none}
a.sec{display:block;margin-top:14px;color:#12306b;font-size:14px}</style></head><body><div class="box">
<h1>${esc(b.name)}</h1><div class="muted">Bill ${esc(bill.number)}</div>
${due ? `<div class="amt">${money(bill.total)}</div>
<a class="btn" id="pay" href="${esc(upiLink(bill))}">Pay with UPI app</a>
<div class="muted">Opens GPay, PhonePe, Paytm or any UPI app with the amount filled in.<br>If nothing opens, use this link on your phone.</div>
<script>setTimeout(function(){location.href=document.getElementById('pay').href},400)</script>`
 : `<div class="amt">Paid</div><div class="muted">This bill is already marked as paid (${esc(bill.payment_method || '')}). No payment is needed.</div>`}
<a class="sec" href="/bill/${esc(bill.token)}">View bill</a></div></body></html>`;
}
