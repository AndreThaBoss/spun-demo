// Seeds realistic demo data for the Humber Bay Shores / Mimico pilot.
// All people, emails, phone numbers and unit numbers are FAKE.
// Dates are relative to "today" (America/Toronto) so the demo always looks live.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, run, get, save, UPLOAD_DIR } from './db.js';
import { createOrder, addEvent, savePrefs, routeDay, schedulePlanPickup } from './domain.js';
import { addDays, isServiceDay, torontoNow, windowById, windowsFor } from '../shared/logic.js';
import { BRAND, PLANS } from '../shared/config.js';

const prevServiceDay = (d) => { let x = addDays(d, -1); while (!isServiceDay(x)) x = addDays(x, -1); return x; };
const nextService = (d) => { let x = addDays(d, 1); while (!isServiceDay(x)) x = addDays(x, 1); return x; };
const svcBack = (d) => (isServiceDay(d) ? d : prevServiceDay(d));
// Toronto local time (EDT offset — fine for an October demo). Clamped so seeded events are never in the future.
const at = (date, hhmm) => new Date(Math.min(new Date(`${date}T${hhmm}:00-04:00`).getTime(), Date.now() - 10 * 60000)).toISOString();

const PALETTE = { navy: BRAND.colors.primary, aqua: BRAND.colors.accent };
function svgPhoto(code, stage, variant = 0) {
  const bgs = { pickup: ['#d9cbb8', '#c9d3dc', '#e3d9c6'], delivery: ['#bfcad6', '#d8c9b5', '#cdd8c8'], intake: ['#e9ecef', '#e9ecef', '#e9ecef'] };
  const bg = bgs[stage][variant % 3];
  const caption = { pickup: 'Photo 1 · sealed bag + tag at pickup', intake: 'Photo 2 · contents at partner intake', delivery: 'Photo 4 · bag at door / concierge' }[stage];
  const door = stage !== 'intake'
    ? `<rect x="40" y="30" width="240" height="420" rx="6" fill="#8a6b4f" opacity=".55"/><circle cx="250" cy="250" r="8" fill="#e8d28a"/><rect x="0" y="450" width="640" height="30" fill="#00000022"/>`
    : `<rect x="0" y="300" width="640" height="180" fill="#f8f9fa"/>${[0, 1, 2, 3].map((i) => `<rect x="${60 + i * 140}" y="330" width="110" height="${40 + (i % 2) * 20}" rx="6" fill="${['#7aa6c2', '#e0e0e0', '#33415c', '#c9a7a7'][i]}"/>`).join('')}`;
  const bag = stage === 'intake' ? '' : `
    <path d="M330 150 Q300 160 300 220 L290 440 Q290 460 320 462 L520 462 Q550 460 548 440 L540 220 Q540 160 510 150 Z" fill="${stage === 'delivery' ? '#ffffff' : PALETTE.navy}" stroke="${PALETTE.navy}" stroke-width="4"/>
    ${stage === 'delivery' ? `<path d="M318 175 L522 175 L528 440 L312 440 Z" fill="${PALETTE.navy}" opacity=".9"/>` : ''}
    <path d="M335 150 Q420 120 505 150" fill="none" stroke="#222" stroke-width="5"/>
    <circle cx="420" cy="290" r="48" fill="none" stroke="${PALETTE.aqua}" stroke-width="9"/><circle cx="420" cy="290" r="26" fill="${PALETTE.aqua}"/>
    <rect x="455" y="160" width="110" height="64" rx="6" fill="#fff" stroke="#999" transform="rotate(12 510 190)"/>
    <text x="462" y="196" font-family="monospace" font-size="15" fill="#111" transform="rotate(12 510 190)">${code}-B1</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480"><rect width="640" height="480" fill="${bg}"/>${door}${bag}
    <rect x="0" y="0" width="640" height="34" fill="#00000088"/><text x="14" y="23" font-family="sans-serif" font-size="16" fill="#fff">${caption} · demo placeholder image</text></svg>`;
}

const PARTNERS = [
  ["Paul's Laundromat", '2380 Lake Shore Blvd W, Etobicoke, ON M8V 1C3', 'Mon–Sun 6 am–10 pm'],
  ['XL Laundromat & Dry Cleaners', '2491 Lake Shore Blvd W, Units 8-9, Etobicoke, ON M8V 1C5', 'Mon–Fri 9 am–8 pm; Sat–Sun 8 am–8 pm'],
];
// [name, email, phone, address, unit, postal, prefs]
const CUSTOMERS = [
  ['Priya Sharma', 'priya@demo.test', '416-555-0141', '2121 Lake Shore Blvd W', '1408', 'M8V 4E9', { detergent: 'Hypoallergenic (free & clear)', softener: 'None', dryerHeat: 'Low', hangDryItems: '2 silk blouses, yoga leggings', hangDryActivewear: true, folding: 'KonMari vertical file fold', allergies: 'Sensitive skin — no fragrance', notes: 'Leave with concierge (Raj). Towels tri-fold please.', buildingAccess: 'Concierge 24/7, parcel room OK' }],
  ['Jordan Lee', 'jordan@demo.test', '647-555-0172', '10 Park Lawn Rd', '2205', 'M8V 0H9', { detergent: 'Standard (scented)', softener: 'Liquid softener', dryerHeat: 'Medium', folding: 'Standard', notes: 'Door drop OK — building allows couriers up.', buildingAccess: 'Buzz 2205, door drop OK' }],
  ['Sofia Rossi', 'sofia@demo.test', '416-555-0119', '33 Shore Breeze Dr', '3110', 'M8V 0G1', { detergent: 'Unscented', softener: 'Dryer sheets (unscented)', folding: 'Roll', separateKids: true, notes: 'Kids clothes in separate bag.' }],
  ['Marcus Brown', 'marcus@example.test', '647-555-0108', '2240 Lake Shore Blvd W', '907', 'M8V 0B1', { washTemp: 'Warm for whites & towels', bleach: 'Whites only (chlorine)' }],
  ['Aisha Mohamed', 'aisha@example.test', '416-555-0185', '59 Annie Craig Dr', '1802', 'M8V 0C4', { detergent: 'Customer-supplied', hangDryItems: 'Wool sweaters', notes: 'Own detergent bottle in bag B1.' }],
  ["Liam O'Connor", 'liam@example.test', '647-555-0133', '2200 Lake Shore Blvd W', '1206', 'M8V 1A4', { folding: 'Hang shirts', notes: '5 work shirts on hangers.' }],
  ['Mei Wong', 'mei@example.test', '416-555-0167', '65 Annie Craig Dr', '4302', 'M8V 0G2', { detergent: 'Unscented', dryerHeat: 'Low' }],
  ['Daniel Kim', 'daniel@example.test', '647-555-0154', '2083 Lake Shore Blvd W', '515', 'M8V 4G2', { sort: 'Wash together' }],
  ['Olivia Martin', 'olivia@example.test', '416-555-0126', '12 Mimico Ave', '', 'M8V 1R1', { hangDryActivewear: true, notes: 'Side door, leave on bench under porch.' }],
  ['Noah Tremblay', 'noah@example.test', '647-555-0190', '48 Albert Ave', '', 'M8V 2L5', { detergent: 'Hypoallergenic (free & clear)', allergies: 'Eczema' }],
];

export async function seed() {
  open({ fresh: true });
  const P = { persist: false };
  const seedDir = path.join(UPLOAD_DIR, 'seed');
  fs.rmSync(seedDir, { recursive: true, force: true });
  fs.mkdirSync(seedDir, { recursive: true });

  for (const [n, a, h] of PARTNERS) run('INSERT INTO partners (name, address, hours) VALUES (?,?,?)', [n, a, h], P);
  run("INSERT INTO users (role, name, email, phone) VALUES ('admin','Andre Dossantos','andre@spun.test','416-555-0100')", [], P);
  const maya = run("INSERT INTO users (role, name, email, phone) VALUES ('driver','Maya Chen','maya@spun.test','647-555-0201')", [], P);
  const dev = run("INSERT INTO users (role, name, email, phone) VALUES ('driver','Dev Patel','dev@spun.test','647-555-0202')", [], P);
  run("INSERT INTO users (role, name, email, phone, partner_id) VALUES ('partner','Paul''s Laundromat (partner)','pauls@partner.test','416-555-0300',1)", [], P);

  const c = {};
  CUSTOMERS.forEach(([name, email, phone, addr, unit, pc, prefs], i) => {
    const id = run(`INSERT INTO users (role, name, email, phone, customer_code, address_line, unit, city, postal_code, photo_consent, listed, created_at)
      VALUES ('customer',?,?,?,?,?,?,'Toronto',?,1,?, datetime('now', ?))`, [name, email, phone, `C-${1001 + i}`, addr, unit, pc, email.endsWith('@demo.test') ? 1 : 0, `-${40 - i * 3} days`], P);
    savePrefs(id, prefs, P);
    c[name.split(' ')[0].replace("'", '')] = get('SELECT * FROM users WHERE id = ?', [id]);
  });

  const today = torontoNow().date;
  const R = routeDay();              // driver route day (today, or Monday if today is Sunday)
  const P1 = prevServiceDay(R), P2 = prevServiceDay(P1), P3 = prevServiceDay(P2), P8 = svcBack(addDays(R, -8)), P14 = addDays(R, -14), P16 = svcBack(addDays(R, -16));
  const N1 = nextService(R);

  const photo = (orderId, code, stage, date, hhmm, by, v) => {
    const file = `seed/${code}-${stage}.svg`;
    fs.writeFileSync(path.join(UPLOAD_DIR, file), svgPhoto(code, stage, v));
    run('INSERT INTO photos (order_id, stage, path, uploaded_by, at) VALUES (?,?,?,?,?)', [orderId, stage, file, by, at(date, hhmm)], P);
  };
  // Walk an order through statuses with realistic timestamps (+ photos)
  const advance = (orderId, upTo, by, { photos = true, intakePhoto = true } = {}) => {
    const o = get('SELECT * FROM orders WHERE id = ?', [orderId]);
    const pw = windowById(o.pickup_window), dw = windowById(o.delivery_window);
    const steps = [
      ['picked_up', o.pickup_date, pw.start.replace(/:00$/, ':25'), by, 'Bag closed, tag scanned'],
      ['at_laundromat', o.pickup_date, pw.start < '12:00' ? '11:40' : '21:10', 4, 'Weighed & logged at partner'],
      ['ready', o.same_day ? o.pickup_date : addDays(o.delivery_date, 0), o.same_day ? '17:30' : (dw.start < '12:00' ? '06:30' : '14:30'), 4, 'Folded, liner sealed, sheet initialled'],
      ['delivered', o.delivery_date, dw.start.replace(/:00$/, ':42'), by, 'Left with concierge'],
    ];
    for (const [st, d, t, who, note] of steps) {
      if (st === 'ready' && d === o.pickup_date && !o.same_day) continue;
      addEvent(orderId, st, who, note, at(d, t), P);
      if (photos && st === 'picked_up') photo(orderId, o.code, 'pickup', d, t, who, orderId);
      if (photos && intakePhoto && st === 'at_laundromat') photo(orderId, o.code, 'intake', d, t, 4, orderId);
      if (photos && st === 'delivered') photo(orderId, o.code, 'delivery', d, t, who, orderId);
      run('UPDATE orders SET status = ? WHERE id = ?', [st, orderId], P);
      if (st === upTo) break;
    }
  };
  const book = (cust, draft, opts = {}) => createOrder(cust, { ...draft, pickupWindow: windowsFor(draft.pickupDate).some((w) => w.id === draft.pickupWindow) ? draft.pickupWindow : 'am2' }, { persist: false, paymentRef: 'mock_pi_seed' + Math.random().toString(16).slice(2, 10), createdAt: at(addDays(draft.pickupDate, -2), '20:15'), ...opts });

  // Subscriptions
  const subPriya = run(`INSERT INTO subscriptions (customer_id, plan, status, day_of_week, window_id, start_date, next_billing_date, price_lock_until, price_cents, payment_ref, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [c.Priya.id, 'weekly_standard', 'active', new Date(R + 'T12:00:00Z').getUTCDay(), 'am1', P14, addDays(P14, 28), addDays(P14, 182), PLANS.weekly_standard.priceCents, 'mock_pi_seedplan1', at(P14, '09:00')], P);
  const subAisha = run(`INSERT INTO subscriptions (customer_id, plan, status, day_of_week, window_id, start_date, next_billing_date, price_lock_until, price_cents, payment_ref, paused_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now','-3 days'))`, [c.Aisha.id, 'biweekly_small', 'paused', 3, 'pm1', addDays(R, -30), addDays(R, -2), addDays(R, 152), PLANS.biweekly_small.priceCents, 'mock_pi_seedplan2'], P);
  const subLiam = run(`INSERT INTO subscriptions (customer_id, plan, status, day_of_week, window_id, start_date, next_billing_date, price_lock_until, price_cents, payment_ref)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, [c.Liam.id, 'biweekly_standard', 'active', new Date(N1 + 'T12:00:00Z').getUTCDay(), 'pm2', addDays(R, -12), addDays(R, 16), addDays(R, 170), PLANS.biweekly_standard.priceCents, 'mock_pi_seedplan3'], P);
  const sub = (id) => get('SELECT * FROM subscriptions WHERE id = ?', [id]);

  // ── History: delivered orders ──
  let o;
  o = book(c.Priya, { pickupDate: P14, pickupWindow: 'am1' }, { subscription: sub(subPriya), driverId: maya }); advance(o, 'delivered', maya);
  o = book(c.Priya, { pickupDate: addDays(P14, 7), pickupWindow: 'am1', extraBags: 1 }, { subscription: sub(subPriya), driverId: maya }); advance(o, 'delivered', maya);
  o = book(c.Jordan, { tier: 'standard', pickupDate: P8, pickupWindow: 'pm1', hangDryCount: 2 }, { driverId: maya }); advance(o, 'delivered', maya);
  o = book(c.Sofia, { tier: 'large', extraBags: 1, pickupDate: P3, pickupWindow: 'am2', comforters: { queen: 1 } }, { driverId: dev }); advance(o, 'delivered', dev);
  o = book(c.Marcus, { tier: 'small', pickupDate: P3, pickupWindow: 'pm2' }, { driverId: dev }); advance(o, 'delivered', dev);
  o = book(c.Mei, { tier: 'standard', pickupDate: P2, pickupWindow: 'am1', sameDay: true }, { driverId: maya }); advance(o, 'delivered', maya);
  o = book(c.Aisha, { pickupDate: P16, pickupWindow: 'am2' }, { subscription: { ...sub(subAisha), status: 'active' }, driverId: maya }); advance(o, 'delivered', maya);

  // ── In progress (delivering on route day R) ──
  o = book(c.Daniel, { tier: 'standard', pickupDate: P1, pickupWindow: 'am1' }, { driverId: maya }); advance(o, 'ready', maya);
  o = book(c.Olivia, { tier: 'small', pickupDate: P1, pickupWindow: 'am2', hangDryCount: 3 }, { driverId: maya }); advance(o, 'ready', maya);
  o = book(c.Jordan, { tier: 'large', pickupDate: P1, pickupWindow: 'am2' }, { driverId: dev }); advance(o, 'at_laundromat', dev, { intakePhoto: false });
  o = book(c.Noah, { tier: 'standard', pickupDate: P1, pickupWindow: P1 && new Date(P1 + 'T12:00:00Z').getUTCDay() === 6 ? 'sat4' : 'pm2' }, { driverId: dev }); advance(o, 'picked_up', dev);

  // ── Scheduled pickups on route day R ──
  schedulePlanPickup(sub(subPriya), R, { persist: false, driverId: maya });
  book(c.Sofia, { tier: 'standard', pickupDate: R, pickupWindow: 'am1', hangDryCount: 1 }, { driverId: maya });
  book(c.Marcus, { tier: 'large', pickupDate: R, pickupWindow: 'am2' }, { driverId: maya });
  const rIsSat = new Date(R + 'T12:00:00Z').getUTCDay() === 6;
  book(c.Mei, { tier: 'small', pickupDate: R, pickupWindow: rIsSat ? 'sat3' : 'pm1' }, { driverId: maya });
  book(c.Olivia, { tier: 'standard', pickupDate: R, pickupWindow: rIsSat ? 'sat4' : 'pm2', comforters: { king: 1 } }, { driverId: dev });
  // Future + cancelled
  schedulePlanPickup(sub(subLiam), N1, { persist: false, driverId: dev });
  o = book(c.Daniel, { tier: 'small', pickupDate: N1, pickupWindow: 'am2' }, { driverId: maya });
  run("UPDATE orders SET status = 'cancelled' WHERE id = ?", [o], P); addEvent(o, 'cancelled', c.Daniel.id, 'Customer cancelled (travelling)', at(R, '08:00'), P);

  // Waitlist (out-of-zone signups)
  for (const [n, e, pc, a] of [['Hannah Ng', 'hannah@example.test', 'M8W 2T5', '3 Twenty Fifth St'], ['Omar Haddad', 'omar@example.test', 'M6S 1N9', '2 Old Mill Dr'], ['Grace Liu', 'grace@example.test', 'M8Y 3H8', '88 Park Lawn Rd']])
    run('INSERT INTO waitlist (name, email, postal_code, address) VALUES (?,?,?,?)', [n, e, pc, a], P);

  // Payments ledger rows for paid orders/plans (mock)
  run(`INSERT INTO payments (provider, ref, kind, amount_cents, status, customer_id, order_id) SELECT 'mock', payment_ref, 'order', total_cents, 'succeeded', customer_id, id FROM orders WHERE payment_status = 'paid'`, [], P);
  run(`INSERT INTO payments (provider, ref, kind, amount_cents, status, customer_id, subscription_id) SELECT 'mock', payment_ref, 'plan', CAST(ROUND(price_cents * 1.13) AS INTEGER), 'succeeded', customer_id, id FROM subscriptions`, [], P);

  save();
  console.log(`Seeded demo data (today ${today}, driver route day ${R}).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await seed();
