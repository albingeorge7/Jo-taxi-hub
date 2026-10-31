# Cab Rental website + Driver dashboard

Mobile-friendly site for a single-driver cab service. Zero dependencies (Node 22.5+, built-in SQLite).

```bash

DRIVER_PASSWORD=choose-a-password DRIVER_NAME="Ravi Kumar" DRIVER_PHONE="+91 98xxxxxx" \
DRIVER_ADDRESS="12 Main Rd, Kochi" npm start
```
- Customer site: http://localhost:3000 — driver details, booking form, booking-status check.
- Driver dashboard: http://localhost:3000/driver (default login `driver` / `driver123` — **change it**).

## Driver dashboard
- **Requests** – new bookings appear instantly with sound, vibration and a browser notification (tap "Enable sound & notifications" once). Accept / reject.
- **Schedule** – upcoming rides grouped by day, with warnings for clashing rides (within 90 min).
- **Analytics** – revenue (today/month/total), average fare, completion rate, repeat customers, 30-day charts, busiest hours, top routes.
- **Bills** – "Complete & bill" builds an itemised bill (base fare, km, tolls…, tax %). It's saved at a private link `/bill/<token>` (print / save as PDF), emailed to the customer if they gave an email and SMTP is set, and the driver gets one-tap WhatsApp/SMS share buttons.

## Configuration (env vars, see `config.js`)
`BUSINESS_NAME, DRIVER_NAME, DRIVER_PHONE, DRIVER_WHATSAPP, DRIVER_ADDRESS, VEHICLE, CAB_NUMBER, RATE_PER_KM, BASE_FARE, TAX_PERCENT, CURRENCY, TIMEZONE, BASE_URL, PORT, DATA_DIR`

- **Phone alerts when the app is closed:** set `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`.
- **Emailing bills:** `npm install` (nodemailer) and set `SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM`.
- Set `BASE_URL=https://your-domain` so bill links are correct, and serve behind HTTPS in production.

Data lives in `data/cab.db` (SQLite) — back it up. Test: `npm test`.

## Hosting on a Raspberry Pi (free)
```bash
git clone https://github.com/albingeorge7/Jo-taxi-hub.git
cd Jo-taxi-hub && bash deploy/setup-pi.sh
```
Installs Node 22, runs the app as a service that starts on boot. To make it reachable from the internet for free,
use Cloudflare Tunnel (no router changes): `cloudflared tunnel --url http://localhost:3000` for a quick test address,
or a named tunnel with your own domain for a permanent one. Then set `BASE_URL` in `/etc/cab-rental.env` and
`sudo systemctl restart cab-rental`. Back up `data/cab.db` regularly.
