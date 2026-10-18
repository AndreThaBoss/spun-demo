// Pure business logic shared by client (live previews) and server (authoritative).
import {
  TIERS, EXTRA_STANDARD_BAG_CENTS, ADDONS, HST_RATE, FIRST_ORDER_PROMO, PLANS,
  PLAN_EXTRA_BAG_CENTS, WINDOWS, TIMEZONE, BOOKING_CUTOFF_MIN, BOOKING_DAYS_AHEAD,
  DEFAULT_PREFS,
} from './config.js';

export const money = (cents) =>
  (cents < 0 ? '−' : '') + '$' + (Math.abs(cents) / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function normalizePostal(pc = '') {
  const s = String(pc).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 6 ? `${s.slice(0, 3)} ${s.slice(3)}` : s;
}
export const isValidPostal = (pc) => /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] \d[ABCEGHJ-NPRSTV-Z]\d$/.test(normalizePostal(pc));
export function inZone(pc, prefixes) {
  const s = normalizePostal(pc).replace(' ', '');
  return prefixes.some((p) => s.startsWith(String(p).toUpperCase().replace(/\s/g, '')));
}

/**
 * Price an order.
 * input: { tier, extraBags, hangDryCount, sameDay, comforters:{key:qty}, firstOrder, planTier }
 * If planTier is set, the base bag is covered by the subscription.
 */
export function priceOrder(input) {
  const { tier = 'standard', extraBags = 0, hangDryCount = 0, sameDay = false,
          comforters = {}, firstOrder = false, planTier = null } = input || {};
  const lines = [];
  let bags = 0;
  if (planTier) {
    bags = 1 + Math.max(0, extraBags);
    lines.push({ label: `${TIERS[planTier].name} bag — included in your plan`, cents: 0 });
    if (extraBags > 0) lines.push({ label: `Extra bag × ${extraBags}`, cents: extraBags * PLAN_EXTRA_BAG_CENTS[planTier] });
  } else {
    const t = TIERS[tier] || TIERS.standard;
    bags = t.bags;
    lines.push({ label: `${t.name} (${t.bags} bag${t.bags > 1 ? 's' : ''})`, cents: t.priceCents });
    if (tier === 'large' && extraBags > 0) {
      bags += extraBags;
      lines.push({ label: `Additional Standard bag × ${extraBags}`, cents: extraBags * EXTRA_STANDARD_BAG_CENTS });
    }
  }
  if (hangDryCount > 0) lines.push({ label: `Hang-dry × ${hangDryCount} items`, cents: hangDryCount * ADDONS.hangDryPerItemCents });
  if (sameDay) lines.push({ label: 'Same-day service', cents: ADDONS.sameDayCents });
  for (const [k, q] of Object.entries(comforters || {})) {
    const c = ADDONS.comforters[k];
    if (c && q > 0) lines.push({ label: `${c.name} × ${q}`, cents: c.cents * q });
  }
  const subtotal = lines.reduce((a, l) => a + l.cents, 0);
  let discount = 0;
  if (firstOrder && !planTier && (tier === 'standard' || tier === 'large')) {
    discount = FIRST_ORDER_PROMO.discountCents;
    lines.push({ label: FIRST_ORDER_PROMO.label, cents: -discount });
  }
  const taxable = subtotal - discount;
  const hst = Math.round(taxable * HST_RATE);
  return { lines, bags, subtotalCents: subtotal, discountCents: discount, hstCents: hst, totalCents: taxable + hst };
}

export function pricePlan(planId) {
  const p = PLANS[planId];
  const hst = Math.round(p.priceCents * HST_RATE);
  return { lines: [{ label: `${p.name} — ${p.bagsPer4Weeks} pickups / 4 weeks`, cents: p.priceCents }], subtotalCents: p.priceCents, hstCents: hst, totalCents: p.priceCents + hst };
}

// ── Dates (all in Toronto local time, as YYYY-MM-DD strings) ──
export function torontoNow(d = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
}
export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const dayOfWeek = (dateStr) => new Date(dateStr + 'T12:00:00Z').getUTCDay();
export const isServiceDay = (dateStr) => dayOfWeek(dateStr) !== 0;
export function nextServiceDay(dateStr) {
  let d = addDays(dateStr, 1);
  while (!isServiceDay(d)) d = addDays(d, 1);
  return d;
}
export const windowsFor = (dateStr) => WINDOWS.filter((w) => w.days.includes(dayOfWeek(dateStr)));
export const windowById = (id) => WINDOWS.find((w) => w.id === id);
const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

export function bookableSlots(now = torontoNow()) {
  const out = [];
  for (let i = 0; i < BOOKING_DAYS_AHEAD; i++) {
    const date = addDays(now.date, i);
    const wins = windowsFor(date).filter((w) => i > 0 || toMin(w.start) - BOOKING_CUTOFF_MIN >= now.minutes);
    if (wins.length) out.push({ date, windows: wins });
  }
  return out;
}

/** Next-day turnaround (Sat → Mon). Same-day: back by 9 pm same date. */
export function deliveryFor(pickupDate, pickupWindowId, sameDay = false) {
  if (sameDay && dayOfWeek(pickupDate) !== 6) return { date: pickupDate, windowId: 'pm2' };
  const d = nextServiceDay(pickupDate);
  const evening = windowsFor(d).find((w) => w.id === 'pm1');
  return { date: d, windowId: evening ? 'pm1' : windowsFor(d)[0].id };
}

export function fmtDate(dateStr, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-CA', { ...opts, timeZone: 'UTC' });
}

/** Upcoming plan pickup dates from a start date. */
export function planDates(startDate, cadenceWeeks, count = 4) {
  return Array.from({ length: count }, (_, i) => addDays(startDate, i * 7 * cadenceWeeks));
}
/** First date >= fromDate that falls on weekday dow (1-6). */
export function firstOnOrAfter(fromDate, dow) {
  let d = fromDate;
  for (let i = 0; i < 7; i++) { if (dayOfWeek(d) === dow) return d; d = addDays(d, 1); }
  return fromDate;
}

/** Coloured-dot flags from service-standards.md §2. */
export function prefFlags(p = DEFAULT_PREFS) {
  const f = [];
  if (/Unscented|Hypo/.test(p.detergent)) f.push({ color: 'green', label: 'Unscented / hypo' });
  if (p.hangDryItems || p.hangDryActivewear || /Hang-dry/.test(p.dryerHeat)) f.push({ color: 'blue', label: 'Hang-dry items' });
  if (p.allergies || /Customer-supplied/.test(p.detergent)) f.push({ color: 'red', label: p.allergies ? 'Allergy' : 'Own detergent' });
  return f;
}
