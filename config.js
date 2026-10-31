// Edit these (or set the matching environment variables) to describe your service.
const env = process.env;

export default {
  port: Number(env.PORT || 3000),
  baseUrl: env.BASE_URL || '',            // public URL, used in bill links e.g. https://mycab.example.com
  timezone: env.TIMEZONE || 'Asia/Kolkata',
  currency: env.CURRENCY || '₹',
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
  driverUser: env.DRIVER_USER || 'driver',
  driverPassword: env.DRIVER_PASSWORD || 'driver123',
  // Optional phone alerts via Telegram bot (create one with @BotFather).
  telegram: { token: env.TELEGRAM_BOT_TOKEN || '', chatId: env.TELEGRAM_CHAT_ID || '' },
  // Optional email for bills: install nodemailer (npm i) and set SMTP_*.
  smtp: { host: env.SMTP_HOST || '', port: Number(env.SMTP_PORT || 587), user: env.SMTP_USER || '', pass: env.SMTP_PASS || '', from: env.SMTP_FROM || '' },
};
