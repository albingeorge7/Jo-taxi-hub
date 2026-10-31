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
- **Analytics** – pick Today, 7 days, 30 days, This month, Last month, All time or any custom from–to dates. Shows revenue, rides, bookings, average fare, completion rate, repeat customers, revenue and request charts (per day, or per month for long ranges), busiest hours and top routes.
- **Bills** – "Complete & bill" builds an itemised bill (base fare, km, tolls…, tax %). It's saved at a private link `/bill/<token>` (print / save as PDF). A "Send bill on WhatsApp" button opens WhatsApp with the customer's number and the bill link ready to send. The red floating **New bill** button creates a bill for rides not booked on the site. Fares can be *per km + extras (toll, parking…)* or a *fixed amount*.

## UPI payment
The WhatsApp message for any bill not marked Cash or Card includes a tappable link (`/pay/<token>`). It opens a small page that hands over to the customer's UPI app (GPay, PhonePe, Paytm…) with the amount filled in. The UPI ID is not shown on the bill or PDF. Set `UPI_ID` and `UPI_NAME` (default `jojojosemangalan-1@okaxis`).

## Bill PDF on WhatsApp
Every bill is also a real PDF (`/bill/<token>.pdf`, generated on the server, no dependencies). **Send PDF on WhatsApp** opens the phone's share sheet with the PDF attached; choose WhatsApp, then the customer's chat. (WhatsApp does not allow an app to attach a file to a chosen contact automatically.) On desktop the PDF downloads and the WhatsApp chat opens so it can be attached. Standard PDF fonts only cover Latin letters, so other scripts in names print as `?` in the PDF (the web bill shows them correctly).

## Site visit statistics
The customer site counts one anonymous visit per browser session: no cookies, no IP stored (only a per-day hash to estimate unique visitors). Bots and the logged-in driver are ignored. Analytics shows visits, unique visitors, visits per day, traffic sources (direct / WhatsApp / Google / …), devices and the share of visitors who booked. Put `?src=card` (any word) on the link in a QR code or printed card to see it as its own source.

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
