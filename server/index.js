import './env.js';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, all, get, run, save, dbExists, UPLOAD_DIR } from './db.js';
import { seed } from './seed.js';
import {
  zonePrefixes, parse, getPrefs, savePrefs, createOrder, schedulePlanPickup, addEvent,
  isFirstOrder, nextStatus, routeDay, fullAddress,
} from './domain.js';
import { PAYMENTS_MODE, newRef, mockCharge, createStripeCheckout, retrieveStripeCheckout } from './payments.js';
import { BRAND, DEFAULT_ZONE, PLANS, TIERS, WINDOWS, PREF_OPTIONS, NOTES_MAX, PLAN_BILLING_WEEKS } from '../shared/config.js';
import {
  normalizePostal, isValidPostal, inZone, priceOrder, pricePlan, bookableSlots, torontoNow,
  addDays, firstOnOrAfter, windowById, deliveryFor,
} from '../shared/logic.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

open();
if (!dbExists() || !get('SELECT id FROM users LIMIT 1')) { await seed(); open(); }

const app = express();
app.use(express.json({ limit: '1mb' }));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));

// ── Demo auth: the client sends x-user-id (chosen in the role switcher). ──
// This is NOT real authentication — see README "What's mocked".
app.use('/api', (req, _res, next) => {
  const id = Number(req.get('x-user-id'));
  req.user = id ? get('SELECT * FROM users WHERE id = ?', [id]) : null;
  next();
});
const need = (...roles) => (req, res, next) =>
  !req.user ? res.status(401).json({ error: 'Choose a demo user first.' })
    : roles.length && !roles.includes(req.user.role) ? res.status(403).json({ error: 'Not allowed for your role.' }) : next();
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

const publicUser = (u) => u && ({ id: u.id, role: u.role, name: u.name, email: u.email, phone: u.phone, customerCode: u.customer_code,
  addressLine: u.address_line, unit: u.unit, city: u.city, postalCode: u.postal_code, partnerId: u.partner_id });

// ── Meta / demo users ──
app.get('/api/meta', (_req, res) => res.json({
  brand: BRAND, zone: { name: DEFAULT_ZONE.name, prefixes: zonePrefixes() }, paymentsMode: PAYMENTS_MODE,
  today: torontoNow().date, routeDay: routeDay(),
}));
app.get('/api/demo-users', (_req, res) => {
  const rows = all("SELECT * FROM users WHERE role != 'customer' OR listed = 1 ORDER BY CASE role WHEN 'customer' THEN 0 WHEN 'driver' THEN 1 WHEN 'partner' THEN 2 ELSE 3 END, id");
  res.json(rows.map(publicUser));
});

// ── Signup & zone ──
app.post('/api/zone-check', (req, res) => {
  const pc = normalizePostal(req.body.postalCode);
  res.json({ postalCode: pc, valid: isValidPostal(pc), inZone: isValidPostal(pc) && inZone(pc, zonePrefixes()) });
});
app.post('/api/signup', (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim(), email = String(b.email || '').trim().toLowerCase();
  const pc = normalizePostal(b.postalCode);
  if (!name) return bad(res, 'Please enter your name.');
  if (!/^\S+@\S+\.\S+$/.test(email)) return bad(res, 'Please enter a valid email.');
  if (!String(b.addressLine || '').trim()) return bad(res, 'Please enter your street address.');
  if (!isValidPostal(pc)) return bad(res, 'Please enter a valid Canadian postal code (e.g. M8V 0C8).');
  if (!inZone(pc, zonePrefixes())) {
    run('INSERT INTO waitlist (name, email, postal_code, address) VALUES (?,?,?,?)', [name, email, pc, b.addressLine]);
    return res.json({ waitlisted: true, postalCode: pc, zone: DEFAULT_ZONE.name, prefixes: zonePrefixes() });
  }
  if (!b.photoConsent) return bad(res, 'Please accept the photo notice — we photograph bags at pickup and delivery.');
  if (get('SELECT id FROM users WHERE email = ?', [email])) return bad(res, 'That email already has an account — pick it in the demo switcher.');
  const n = get("SELECT COUNT(*) AS n FROM users WHERE role='customer'").n;
  const id = run(`INSERT INTO users (role, name, email, phone, customer_code, address_line, unit, city, postal_code, photo_consent, listed)
    VALUES ('customer',?,?,?,?,?,?,?,?,1,1)`, [name, email, b.phone || '', `C-${1001 + n}`, b.addressLine.trim(), b.unit || '', b.city || 'Toronto', pc]);
  savePrefs(id, { buildingAccess: b.buildingAccess || '' });
  res.json({ user: publicUser(get('SELECT * FROM users WHERE id = ?', [id])) });
});

// ── Me / preferences ──
const subFor = (customerId) => {
  const s = get("SELECT * FROM subscriptions WHERE customer_id = ? AND status != 'cancelled' ORDER BY id DESC LIMIT 1", [customerId]);
  if (!s) return null;
  const next = get("SELECT id, code, pickup_date, pickup_window FROM orders WHERE subscription_id = ? AND status = 'scheduled' ORDER BY pickup_date LIMIT 1", [s.id]);
  return { ...s, planInfo: PLANS[s.plan], nextPickup: next || null };
};
app.get('/api/me', need(), (req, res) => {
  const u = req.user;
  res.json({ user: publicUser(u), prefs: u.role === 'customer' ? getPrefs(u.id) : null,
    subscription: u.role === 'customer' ? subFor(u.id) : null, firstOrder: u.role === 'customer' ? isFirstOrder(u.id) : false });
});
app.put('/api/me/preferences', need('customer'), (req, res) => {
  const p = req.body || {};
  for (const [k, opts] of Object.entries(PREF_OPTIONS)) if (p[k] && !opts.includes(p[k])) return bad(res, `Invalid ${k}`);
  if ((p.notes || '').length > NOTES_MAX) return bad(res, `Special instructions are limited to ${NOTES_MAX} characters.`);
  savePrefs(req.user.id, p);
  // Preferences travel with every order — refresh the snapshot on orders not yet picked up.
  run("UPDATE orders SET prefs = ? WHERE customer_id = ? AND status = 'scheduled'", [JSON.stringify(getPrefs(req.user.id)), req.user.id]);
  res.json({ prefs: getPrefs(req.user.id) });
});

// ── Booking ──
app.get('/api/slots', need(), (_req, res) => res.json(bookableSlots()));
function validateDraft(d) {
  if (!TIERS[d.tier]) return 'Choose a bag size.';
  const slot = bookableSlots().find((s) => s.date === d.pickupDate);
  if (!slot || !slot.windows.some((w) => w.id === d.pickupWindow)) return 'That pickup window is no longer available — please pick another.';
  if (d.sameDay && d.pickupWindow !== 'am1') return 'Same-day service needs the 7–9 am pickup window.';
  if (d.sameDay && new Date(d.pickupDate + 'T12:00:00Z').getUTCDay() === 6) return 'Same-day is not offered on Saturdays (evening run is Mon–Fri).';
  for (const k of ['extraBags', 'hangDryCount']) if (d[k] != null && (!Number.isInteger(d[k]) || d[k] < 0 || d[k] > 30)) return `Invalid ${k}`;
  return null;
}
const cleanDraft = (b) => ({ tier: b.tier, extraBags: b.tier === 'large' ? Number(b.extraBags) || 0 : 0, hangDryCount: Number(b.hangDryCount) || 0,
  sameDay: !!b.sameDay, comforters: b.comforters || {}, pickupDate: b.pickupDate, pickupWindow: b.pickupWindow });
app.post('/api/quote', need('customer'), (req, res) => {
  const d = cleanDraft(req.body);
  res.json({ ...priceOrder({ ...d, firstOrder: isFirstOrder(req.user.id) }), delivery: d.pickupDate ? deliveryFor(d.pickupDate, d.pickupWindow, d.sameDay) : null });
});

// ── Checkout (mock or Stripe test) ──
const baseUrl = (req) => `${req.protocol}://${req.get('host')}`;
async function startCheckout(req, res, kind, payload, quote, description) {
  const ref = newRef(PAYMENTS_MODE === 'mock' ? 'mock_cs' : 'spun');
  run('INSERT INTO payments (provider, ref, kind, amount_cents, status, customer_id, payload) VALUES (?,?,?,?,?,?,?)',
    [PAYMENTS_MODE, ref, kind, quote.totalCents, 'pending', req.user.id, JSON.stringify({ payload, quote, description })]);
  if (PAYMENTS_MODE === 'stripe_test') {
    try {
      const s = await createStripeCheckout({ ref, description, amountCents: quote.totalCents, baseUrl: baseUrl(req), email: req.user.email });
      return res.json({ ref, mode: PAYMENTS_MODE, redirectUrl: s.url });
    } catch (e) { return bad(res, `Stripe test checkout failed: ${e.message}`, 502); }
  }
  res.json({ ref, mode: PAYMENTS_MODE });
}
app.post('/api/checkout/order', need('customer'), async (req, res) => {
  const d = cleanDraft(req.body);
  const err = validateDraft(d); if (err) return bad(res, err);
  const quote = priceOrder({ ...d, firstOrder: isFirstOrder(req.user.id) });
  await startCheckout(req, res, 'order', d, quote, `${BRAND.name} pickup — ${TIERS[d.tier].name}`);
});
app.post('/api/checkout/plan', need('customer'), async (req, res) => {
  const { plan, dayOfWeek, windowId } = req.body || {};
  if (!PLANS[plan]) return bad(res, 'Choose a plan.');
  const w = windowById(windowId);
  if (!w || !w.days.includes(Number(dayOfWeek))) return bad(res, 'Choose a pickup day and window that we run.');
  if (subFor(req.user.id)) return bad(res, 'You already have a plan — manage it instead.');
  await startCheckout(req, res, 'plan', { plan, dayOfWeek: Number(dayOfWeek), windowId }, pricePlan(plan), `${BRAND.name} ${PLANS[plan].name} — first 4 weeks`);
});
app.get('/api/checkout/:ref', need('customer'), (req, res) => {
  const p = get('SELECT * FROM payments WHERE ref = ? AND customer_id = ?', [req.params.ref, req.user.id]);
  if (!p) return bad(res, 'Checkout not found', 404);
  res.json({ ref: p.ref, kind: p.kind, status: p.status, amountCents: p.amount_cents, provider: p.provider, ...parse(p.payload, {}), orderId: p.order_id, subscriptionId: p.subscription_id });
});
function fulfil(p, user, chargeRef) {
  const { payload } = parse(p.payload, {});
  let orderId = null, subscriptionId = null;
  if (p.kind === 'order') {
    orderId = createOrder(user, payload, { paymentStatus: 'paid', paymentRef: chargeRef });
  } else {
    const today = torontoNow().date;
    const lock = addDays(today, 182);
    subscriptionId = run(`INSERT INTO subscriptions (customer_id, plan, status, day_of_week, window_id, start_date, next_billing_date, price_lock_until, price_cents, payment_ref)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, [user.id, payload.plan, 'active', payload.dayOfWeek, payload.windowId, today, addDays(today, PLAN_BILLING_WEEKS * 7), lock, PLANS[payload.plan].priceCents, chargeRef]);
    const sub = get('SELECT * FROM subscriptions WHERE id = ?', [subscriptionId]);
    const slots = bookableSlots();
    let from = addDays(today, 1);
    const todaySlot = slots.find((s) => s.date === today);
    if (todaySlot && todaySlot.windows.some((w) => w.id === sub.window_id)) from = today;
    orderId = schedulePlanPickup(sub, from);
  }
  run("UPDATE payments SET status = 'succeeded', order_id = ?, subscription_id = ?, payload = json_set(payload, '$.chargeRef', ?) WHERE id = ?", [orderId, subscriptionId, chargeRef, p.id]);
  return { orderId, subscriptionId };
}
app.post('/api/checkout/:ref/confirm', need('customer'), (req, res) => {
  const p = get('SELECT * FROM payments WHERE ref = ? AND customer_id = ?', [req.params.ref, req.user.id]);
  if (!p) return bad(res, 'Checkout not found', 404);
  if (p.status === 'succeeded') return res.json({ ok: true, orderId: p.order_id, subscriptionId: p.subscription_id });
  if (p.provider !== 'mock') return bad(res, 'This checkout uses Stripe test mode — complete it on the Stripe page.');
  if (p.kind === 'order') { const err = validateDraft(parse(p.payload, {}).payload); if (err) return bad(res, err); }
  const charge = mockCharge(req.body?.cardNumber);
  if (!charge.ok) return bad(res, charge.error, 402); // session stays pending so the customer can retry
  res.json({ ok: true, ...fulfil(p, req.user, charge.chargeRef) });
});
app.get('/api/checkout/:ref/stripe-return', async (req, res) => {
  const p = get('SELECT * FROM payments WHERE ref = ?', [req.params.ref]);
  if (!p || p.provider !== 'stripe_test') return res.redirect('/#/');
  try {
    const s = await retrieveStripeCheckout(String(req.query.session_id));
    if (s.payment_status === 'paid' && s.client_reference_id === p.ref && p.status !== 'succeeded') {
      const r = fulfil(p, get('SELECT * FROM users WHERE id = ?', [p.customer_id]), s.payment_intent || s.id);
      return res.redirect(r.orderId ? `/#/orders/${r.orderId}?paid=1` : '/#/plan');
    }
  } catch (e) { console.error(e); }
  res.redirect(`/#/checkout/${p.ref}?cancelled=1`);
});

// ── Orders ──
function hydrate(o, viewer) {
  const customer = get('SELECT * FROM users WHERE id = ?', [o.customer_id]);
  const driver = o.driver_id ? get('SELECT id, name FROM users WHERE id = ?', [o.driver_id]) : null;
  const photos = all('SELECT id, stage, path, at FROM photos WHERE order_id = ? ORDER BY at', [o.id]);
  const events = all('SELECT e.status, e.at, e.note, u.name AS by_name, u.role AS by_role FROM order_events e LEFT JOIN users u ON u.id = e.by_user_id WHERE order_id = ? ORDER BY e.at, e.id', [o.id]);
  const partner = viewer.role === 'partner';
  return {
    id: o.id, code: o.code, status: o.status, tier: o.tier, bagCount: o.bag_count, extraBags: o.extra_bags, hangDryCount: o.hang_dry_count,
    sameDay: !!o.same_day, comforters: parse(o.comforters, {}), pickupDate: o.pickup_date, pickupWindow: o.pickup_window,
    deliveryDate: o.delivery_date, deliveryWindow: o.delivery_window, prefs: parse(o.prefs, {}),
    bagTags: Array.from({ length: o.bag_count }, (_, i) => `${o.code}-B${i + 1}`),
    subscriptionId: o.subscription_id, plan: o.subscription_id ? get('SELECT plan FROM subscriptions WHERE id = ?', [o.subscription_id])?.plan : null,
    customer: partner ? { customerCode: customer.customer_code } : { id: customer.id, name: customer.name, phone: customer.phone, customerCode: customer.customer_code },
    address: partner ? null : o.address,
    driver, photos: photos.map((p) => ({ ...p, url: '/uploads/' + p.path })),
    events: partner ? events.map((e) => ({ ...e, by_name: e.by_role === 'customer' ? 'Customer' : e.by_name })) : events,
    ...(partner ? {} : { lineItems: parse(o.line_items, []), subtotalCents: o.subtotal_cents, discountCents: o.discount_cents, hstCents: o.hst_cents,
      totalCents: o.total_cents, paymentStatus: o.payment_status, paymentRef: o.payment_ref }),
  };
}
function canSee(o, u) {
  if (u.role === 'admin') return true;
  if (u.role === 'customer') return o.customer_id === u.id;
  if (u.role === 'driver') return o.driver_id === u.id;
  if (u.role === 'partner') return o.partner_id === u.partner_id;
  return false;
}
app.get('/api/orders', need(), (req, res) => {
  const u = req.user; const where = []; const params = [];
  if (u.role === 'customer') { where.push('customer_id = ?'); params.push(u.id); }
  if (u.role === 'driver') { where.push('driver_id = ?'); params.push(u.id); }
  if (u.role === 'partner') { where.push('partner_id = ?'); params.push(u.partner_id); }
  if (req.query.status && req.query.status !== 'all') { where.push('status = ?'); params.push(req.query.status); }
  if (req.query.q) { where.push('(code LIKE ? OR address LIKE ? OR customer_id IN (SELECT id FROM users WHERE name LIKE ? OR customer_code LIKE ?))'); const q = `%${req.query.q}%`; params.push(q, q, q, q); }
  const rows = all(`SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY CASE status WHEN 'cancelled' THEN 2 WHEN 'delivered' THEN 1 ELSE 0 END, pickup_date DESC, id DESC`, params);
  res.json(rows.map((o) => hydrate(o, u)));
});
const loadOrder = (req, res) => {
  const o = get('SELECT * FROM orders WHERE id = ?', [Number(req.params.id)]);
  if (!o || !canSee(o, req.user)) { bad(res, 'Order not found', 404); return null; }
  return o;
};
app.get('/api/orders/:id', need(), (req, res) => { const o = loadOrder(req, res); if (o) res.json(hydrate(o, req.user)); });

// Who may move an order from → to
const TRANSITIONS = {
  driver: { scheduled: ['picked_up'], picked_up: ['at_laundromat'], ready: ['delivered'] },
  partner: { picked_up: ['at_laundromat'], at_laundromat: ['ready'] },
  admin: { scheduled: ['picked_up', 'cancelled'], picked_up: ['at_laundromat'], at_laundromat: ['ready'], ready: ['delivered'] },
  customer: { scheduled: ['cancelled'] },
};
const PHOTO_REQUIRED = { picked_up: 'pickup', delivered: 'delivery' }; // service-standards.md: Photo 1 / Photo 4
app.post('/api/orders/:id/status', need(), (req, res) => {
  const o = loadOrder(req, res); if (!o) return;
  const to = req.body?.status;
  if (!(TRANSITIONS[req.user.role]?.[o.status] || []).includes(to)) return bad(res, `Can't move this order from ${o.status} to ${to}.`);
  const stage = PHOTO_REQUIRED[to];
  if (stage && req.user.role === 'driver' && !get('SELECT id FROM photos WHERE order_id = ? AND stage = ?', [o.id, stage]))
    return bad(res, `Take the ${stage} photo first (bag + tag visible).`);
  run('UPDATE orders SET status = ? WHERE id = ?', [to, o.id]);
  addEvent(o.id, to, req.user.id, req.body?.note || null);
  if (to === 'delivered' && o.subscription_id) {
    const sub = get('SELECT * FROM subscriptions WHERE id = ?', [o.subscription_id]);
    const plan = PLANS[sub.plan];
    schedulePlanPickup(sub, addDays(o.pickup_date, 7 * plan.cadenceWeeks));
  }
  res.json(hydrate(get('SELECT * FROM orders WHERE id = ?', [o.id]), req.user));
});

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `order${req.params.id}-${req.body.stage || 'photo'}-${Date.now()}${(path.extname(file.originalname) || '.jpg').toLowerCase()}`),
  }),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});
app.post('/api/orders/:id/photos', need('driver', 'partner', 'admin'), upload.single('photo'), (req, res) => {
  const o = loadOrder(req, res); if (!o) return;
  const stage = req.body.stage;
  if (!['pickup', 'intake', 'delivery'].includes(stage)) return bad(res, 'Unknown photo stage');
  if (!req.file) return bad(res, 'No image received (JPEG/PNG/HEIC/WebP).');
  run('INSERT INTO photos (order_id, stage, path, uploaded_by, at) VALUES (?,?,?,?,?)', [o.id, stage, req.file.filename, req.user.id, new Date().toISOString()]);
  res.json(hydrate(o, req.user));
});
app.post('/api/orders/:id/assign', need('admin'), (req, res) => {
  const o = loadOrder(req, res); if (!o) return;
  const d = req.body?.driverId ? get("SELECT id, name FROM users WHERE id = ? AND role = 'driver'", [Number(req.body.driverId)]) : null;
  if (req.body?.driverId && !d) return bad(res, 'Unknown driver');
  run('UPDATE orders SET driver_id = ? WHERE id = ?', [d?.id ?? null, o.id]);
  res.json(hydrate(get('SELECT * FROM orders WHERE id = ?', [o.id]), req.user));
});

// ── Driver route ──
const winStart = (id) => windowById(id)?.start || '99';
app.get('/api/driver/route', need('driver', 'admin'), (req, res) => {
  const date = String(req.query.date || routeDay());
  const driverId = req.user.role === 'driver' ? req.user.id : Number(req.query.driverId) || null;
  const scope = driverId ? 'AND driver_id = ?' : '';
  const p = driverId ? [driverId] : [];
  const pickups = all(`SELECT * FROM orders WHERE pickup_date = ? AND status != 'cancelled' ${scope}`, [date, ...p])
    .map((o) => ({ kind: 'pickup', window: o.pickup_window, done: o.status !== 'scheduled', order: o }));
  const deliveries = all(`SELECT * FROM orders WHERE delivery_date = ? AND status IN ('at_laundromat','ready','delivered') ${scope}`, [date, ...p])
    .map((o) => ({ kind: 'delivery', window: o.delivery_window, done: o.status === 'delivered', order: o }));
  const stops = [...pickups, ...deliveries]
    .sort((a, b) => winStart(a.window).localeCompare(winStart(b.window)) || a.order.address.replace(/^\d+-/, '').localeCompare(b.order.address.replace(/^\d+-/, '')))
    .map((s, i) => ({ seq: i + 1, kind: s.kind, window: s.window, done: s.done, order: hydrate(s.order, req.user) }));
  res.json({ date, stops, partner: get('SELECT * FROM partners WHERE id = 1') });
});
app.get('/api/drivers', need('admin'), (_req, res) => res.json(all("SELECT id, name, phone FROM users WHERE role = 'driver'")));

// ── Subscriptions ──
app.get('/api/subscription', need('customer'), (req, res) => res.json(subFor(req.user.id)));
const loadSub = (req, res) => {
  const s = get('SELECT * FROM subscriptions WHERE id = ?', [Number(req.params.id)]);
  if (!s || (req.user.role === 'customer' && s.customer_id !== req.user.id)) { bad(res, 'Plan not found', 404); return null; }
  return s;
};
const cancelOpenPlanOrders = (subId, by) => {
  for (const o of all("SELECT id FROM orders WHERE subscription_id = ? AND status = 'scheduled'", [subId])) {
    run("UPDATE orders SET status = 'cancelled' WHERE id = ?", [o.id]); addEvent(o.id, 'cancelled', by, 'Plan paused/cancelled');
  }
};
app.post('/api/subscription/:id/pause', need('customer', 'admin'), (req, res) => {
  const s = loadSub(req, res); if (!s) return;
  if (s.status !== 'active') return bad(res, 'Only an active plan can be paused.');
  run("UPDATE subscriptions SET status = 'paused', paused_at = datetime('now') WHERE id = ?", [s.id]);
  cancelOpenPlanOrders(s.id, req.user.id);
  res.json(subFor(s.customer_id));
});
app.post('/api/subscription/:id/resume', need('customer', 'admin'), (req, res) => {
  const s = loadSub(req, res); if (!s) return;
  if (s.status !== 'paused') return bad(res, 'Plan is not paused.');
  const today = torontoNow().date;
  run("UPDATE subscriptions SET status = 'active', paused_at = NULL, next_billing_date = CASE WHEN next_billing_date < ? THEN ? ELSE next_billing_date END WHERE id = ?", [today, addDays(today, 28), s.id]);
  schedulePlanPickup(get('SELECT * FROM subscriptions WHERE id = ?', [s.id]), addDays(today, 1));
  res.json(subFor(s.customer_id));
});
app.post('/api/subscription/:id/cancel', need('customer', 'admin'), (req, res) => {
  const s = loadSub(req, res); if (!s) return;
  run("UPDATE subscriptions SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?", [s.id]);
  cancelOpenPlanOrders(s.id, req.user.id);
  res.json({ cancelled: true });
});
app.put('/api/subscription/:id', need('customer'), (req, res) => {
  const s = loadSub(req, res); if (!s) return;
  const w = windowById(req.body?.windowId); const dow = Number(req.body?.dayOfWeek);
  if (!w || !w.days.includes(dow)) return bad(res, 'Choose a day and window that we run.');
  run('UPDATE subscriptions SET day_of_week = ?, window_id = ? WHERE id = ?', [dow, w.id, s.id]);
  cancelOpenPlanOrders(s.id, req.user.id);
  const sub = get('SELECT * FROM subscriptions WHERE id = ?', [s.id]);
  if (sub.status === 'active') schedulePlanPickup(sub, addDays(torontoNow().date, 1));
  res.json(subFor(s.customer_id));
});

// ── Admin ──
app.get('/api/admin/summary', need('admin', 'partner'), (req, res) => {
  const scope = req.user.role === 'partner' ? 'WHERE partner_id = ' + Number(req.user.partner_id) : '';
  const counts = Object.fromEntries(all(`SELECT status, COUNT(*) AS n FROM orders ${scope} GROUP BY status`).map((r) => [r.status, r.n]));
  const out = { counts };
  if (req.user.role === 'admin') {
    out.waitlist = all('SELECT * FROM waitlist ORDER BY id DESC');
    out.subscriptions = all("SELECT s.*, u.name AS customer_name, u.customer_code FROM subscriptions s JOIN users u ON u.id = s.customer_id ORDER BY s.status, s.id")
      .map((s) => ({ ...s, planName: PLANS[s.plan].name }));
    out.revenueCents = get("SELECT COALESCE(SUM(amount_cents),0) AS c FROM payments WHERE status = 'succeeded'").c;
  }
  res.json(out);
});
app.post('/api/admin/reset', need('admin'), async (_req, res) => { await seed(); open(); res.json({ ok: true }); });

app.use('/api', (_req, res) => bad(res, 'Not found', 404));

// ── Static client (production build) ──
const dist = path.join(ROOT, 'web', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|uploads).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  app.get('/', (_req, res) => res.send('Client not built. Run <code>npm start</code> (builds + serves) or <code>npm run dev</code>.'));
}
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: err.message || 'Server error' }); });

app.listen(PORT, HOST, () => console.log(`\n  ${BRAND.name} prototype running → http://localhost:${PORT}   (payments: ${PAYMENTS_MODE})\n`));
export { save, fullAddress };
