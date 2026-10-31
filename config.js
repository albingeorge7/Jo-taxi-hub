// Edit these (or set the matching environment variables) to describe your service.
const env = process.env;

export default {
  port: Number(env.PORT || 3000),
  baseUrl: env.BASE_URL || '',            // public URL, used in bill links e.g. https://mycab.example.com
  timezone: env.TIMEZONE || 'Asia/Kolkata',
  currency: env.CURRENCY || '₹',
  mapCenter: (env.MAP_CENTER || '9.9312,76.2673').split(',').map(Number), // [lat, lng] where the map opens (Kochi)
  countryIso: env.COUNTRY_ISO || 'in',   // limits place search to this country
  countryCode: env.COUNTRY_CODE || '91', // added to 10-digit numbers for WhatsApp links
  business: {
    name: env.BUSINESS_NAME || 'JO Taxi Cab',
    tagline: env.TAGLINE || 'Airport pickup & drop available • 24/7 service',
    driverName: env.DRIVER_NAME || 'Jojo Jose',
    phone: env.DRIVER_PHONE || '+91 94965 20184',
    whatsapp: env.DRIVER_WHATSAPP || '919645599184', // digits only, country code first
    email: env.DRIVER_EMAIL || 'jojojosemangalan@gmail.com',
    address: env.DRIVER_ADDRESS || 'Cochin, Kerala',
    vehicle: env.VEHICLE || 'All types of vehicles available',
    licence: env.CAB_NUMBER || '',
    hours: env.HOURS || '24/7 service (advance booking recommended)',
    areas: (env.SERVICE_AREAS || 'Airport pickup & drop,City rides,Outstation trips,Hourly rental').split(','),
    ratePerKm: Number(env.RATE_PER_KM || 14),
    baseFare: Number(env.BASE_FARE || 50),
    taxPercent: Number(env.TAX_PERCENT || 0),
  },
  // Driver login. CHANGE THE PASSWORD before going live (DRIVER_PASSWORD=...).
  driverUser: env.DRIVER_USER || 'jojojose',
  driverPassword: env.DRIVER_PASSWORD || 'driver123',
  // Optional phone alerts via Telegram bot (create one with @BotFather).
  telegram: { token: env.TELEGRAM_BOT_TOKEN || '', chatId: env.TELEGRAM_CHAT_ID || '' },
};
