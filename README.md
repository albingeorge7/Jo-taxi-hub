# Cab Rental website + Driver dashboard

Mobile-friendly site for a single-driver cab service. Zero dependencies (Node 22.5+, built-in SQLite).

```bash

DRIVER_PASSWORD=choose-a-password DRIVER_NAME="Ravi Kumar" DRIVER_PHONE="+91 98xxxxxx" \
DRIVER_ADDRESS="12 Main Rd, Kochi" npm start
```
- Customer site: http://localhost:3000 (the Pi script uses port 3100) — driver details, booking form, booking-status check.
- Driver dashboard: http://localhost:3000/driver (the Pi script uses port 3100). Default username `jojojose`; set the password with `DRIVER_PASSWORD` — never use the default `driver123`.

## Driver dashboard
- **Requests** – new bookings appear instantly with sound, vibration and a browser notification (tap "Enable sound & notifications" once). Accept / reject.
- **Schedule** – upcoming rides grouped by day, with warnings for clashing rides (within 90 min).
- **Analytics** – revenue (today/month/total), average fare, completion rate, repeat customers, 30-day charts, busiest hours, top routes.
- **Bills** – "Complete & bill" builds an itemised bill (base fare, km, tolls…, tax %). It's saved at a private link `/bill/<token>` (print / save as PDF). A "Send bill on WhatsApp" button opens WhatsApp with the customer's number and the bill link ready to send. The red floating **New bill** button creates a bill for rides not booked on the site. Fares can be *per km + extras (toll, parking…)* or a *fixed amount*.

## Location picker
Customers can type a place or tap **Map** next to pickup/drop: search a place, tap the map, or use their current location. The driver gets **Pickup / Drop / Route** buttons on each ride that open Google Maps (or the phone's maps app) at the exact pin. Uses OpenStreetMap + Leaflet (bundled in `public/vendor`), no API key. Set `MAP_CENTER=lat,lng` (default Kochi) and `COUNTRY_ISO` (default `in`).

## Configuration (env vars, see `config.js`)
`BUSINESS_NAME, DRIVER_NAME, DRIVER_PHONE, DRIVER_WHATSAPP, DRIVER_ADDRESS, VEHICLE, CAB_NUMBER, RATE_PER_KM, BASE_FARE, TAX_PERCENT, CURRENCY, TIMEZONE, BASE_URL, PORT, DATA_DIR`

- **Phone alerts when the app is closed:** set `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`.
- 10-digit phone numbers get `COUNTRY_CODE` (default `91`) added for WhatsApp links.
- Set `BASE_URL=https://your-domain` so bill links are correct, and serve behind HTTPS in production.

Data lives in `data/cab.db` (SQLite) — back it up. Test: `npm test`.

## Hosting on a Raspberry Pi (free)
```bash
git clone https://github.com/albingeorge7/Jo-taxi-hub.git
cd Jo-taxi-hub && bash deploy/setup-pi.sh
```
Installs Node 22, runs the app as a service that starts on boot. To make it reachable from the internet for free,
use Cloudflare Tunnel (no router changes): `cloudflared tunnel --url http://localhost:3000 (the Pi script uses port 3100)` for a quick test address,
or a named tunnel with your own domain for a permanent one. Then set `BASE_URL` in `/etc/cab-rental.env` and
`sudo systemctl restart cab-rental`. Back up `data/cab.db` regularly.
