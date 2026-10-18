// Domain operations shared by the API and the seed script.
import { all, get, run } from './db.js';
import { PLANS, DEFAULT_PREFS, DEFAULT_ZONE, STATUSES } from '../shared/config.js';
import { priceOrder, deliveryFor, addDays, firstOnOrAfter, dayOfWeek, torontoNow, isServiceDay } from '../shared/logic.js';

export const zonePrefixes = () =>
  (process.env.SERVICE_ZONE_PREFIXES ? process.env.SERVICE_ZONE_PREFIXES.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_ZONE.prefixes);

export const parse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

export function getPrefs(userId) {
  const row = get('SELECT data FROM preferences WHERE user_id = ?', [userId]);
  return { ...DEFAULT_PREFS, ...(row ? parse(row.data, {}) : {}) };
}
export function savePrefs(userId, prefs, opts) {
  run('INSERT INTO preferences (user_id, data, updated_at) VALUES (?, ?, datetime(\'now\')) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
    [userId, JSON.stringify({ ...DEFAULT_PREFS, ...prefs })], opts);
}

export const fullAddress = (u) => `${u.unit ? u.unit + '-' : ''}${u.address_line}, ${u.city || 'Toronto'}, ON ${u.postal_code}`;

export function nextOrderCode(pickupDate) {
  const prefix = pickupDate.slice(2).replace(/-/g, '');
  const n = get('SELECT COUNT(*) AS n FROM orders WHERE code LIKE ?', [prefix + '-%']).n + 1;
  return `${prefix}-${String(n).padStart(2, '0')}`;
}

export function pickDriver(date) {
  const drivers = all("SELECT id FROM users WHERE role = 'driver' ORDER BY id");
  if (!drivers.length) return null;
  const load = drivers.map((d) => ({ id: d.id, n: get('SELECT COUNT(*) AS n FROM orders WHERE driver_id = ? AND (pickup_date = ? OR delivery_date = ?)', [d.id, date, date]).n }));
  load.sort((a, b) => a.n - b.n || a.id - b.id);
  return load[0].id;
}

export function addEvent(orderId, status, byUserId = null, note = null, at = new Date().toISOString(), opts) {
  run('INSERT INTO order_events (order_id, status, at, by_user_id, note) VALUES (?, ?, ?, ?, ?)', [orderId, status, at, byUserId, note], opts);
}

export const isFirstOrder = (customerId) =>
  get("SELECT COUNT(*) AS n FROM orders WHERE customer_id = ? AND status != 'cancelled' AND subscription_id IS NULL", [customerId]).n === 0;

/**
 * Create an order. draft: { tier, extraBags, hangDryCount, sameDay, comforters, pickupDate, pickupWindow }
 * opts.subscription: subscription row (plan pickups), opts.status/at for seeding.
 */
export function createOrder(customer, draft, { subscription = null, paymentStatus = 'paid', paymentRef = null, status = 'scheduled', createdAt, driverId, persist = true } = {}) {
  const plan = subscription ? PLANS[subscription.plan] : null;
  const tier = plan ? plan.tier : draft.tier;
  const quote = priceOrder({ ...draft, tier, planTier: plan ? plan.tier : null, firstOrder: !plan && isFirstOrder(customer.id) });
  const del = deliveryFor(draft.pickupDate, draft.pickupWindow, !!draft.sameDay);
  const code = nextOrderCode(draft.pickupDate);
  const id = run(`INSERT INTO orders (code, customer_id, partner_id, driver_id, subscription_id, tier, bag_count, extra_bags, hang_dry_count, same_day, comforters,
      pickup_date, pickup_window, delivery_date, delivery_window, status, prefs, address, line_items, subtotal_cents, discount_cents, hst_cents, total_cents,
      payment_status, payment_ref, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  [code, customer.id, 1, driverId ?? pickDriver(draft.pickupDate), subscription?.id ?? null, tier, quote.bags, draft.extraBags || 0, draft.hangDryCount || 0,
    draft.sameDay ? 1 : 0, JSON.stringify(draft.comforters || {}), draft.pickupDate, draft.pickupWindow, del.date, del.windowId, status,
    JSON.stringify(getPrefs(customer.id)), fullAddress(customer), JSON.stringify(quote.lines), quote.subtotalCents, quote.discountCents, quote.hstCents,
    quote.totalCents, plan ? 'plan' : paymentStatus, paymentRef, createdAt || new Date().toISOString()], { persist });
  addEvent(id, 'scheduled', customer.id, plan ? `${plan.name} pickup` : 'Booked online', createdAt || new Date().toISOString(), { persist });
  return id;
}

/** Schedule the next plan pickup on/after fromDate (if none is already open). */
export function schedulePlanPickup(sub, fromDate, opts = {}) {
  if (sub.status !== 'active') return null;
  const open = get("SELECT id FROM orders WHERE subscription_id = ? AND status = 'scheduled'", [sub.id]);
  if (open) return open.id;
  const customer = get('SELECT * FROM users WHERE id = ?', [sub.customer_id]);
  const date = firstOnOrAfter(fromDate, sub.day_of_week);
  return createOrder(customer, { pickupDate: date, pickupWindow: sub.window_id, extraBags: 0 }, { subscription: sub, ...opts });
}

export function nextStatus(s) {
  const i = STATUSES.findIndex((x) => x.id === s);
  return i >= 0 && i < STATUSES.length - 1 ? STATUSES[i + 1].id : null;
}

/** Route day for drivers: today, or the next service day when today is Sunday. */
export function routeDay() {
  const t = torontoNow().date;
  if (isServiceDay(t)) return t;
  let d = addDays(t, 1); while (!isServiceDay(d)) d = addDays(d, 1);
  return d;
}
export { dayOfWeek };
