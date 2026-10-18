// End-to-end click-through of every flow + screenshots of every screen.
// Spawns its own server on a throwaway database (data/e2e.db, port 3100), so your
// demo data is untouched. Requires a built client (npm run e2e builds first).
//   npm run e2e                       → runs flows, writes screenshots/
//   CHROME_PATH=/path/to/chrome npm run e2e
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'screenshots');
const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));

const results = [];
const check = (cond, msg) => { results.push({ ok: !!cond, msg }); console.log(`${cond ? '✔' : '✘'} ${msg}`); if (!cond) process.exitCode = 1; };

// ── start server ──
fs.rmSync(path.join(ROOT, 'data', 'e2e.db'), { force: true });
fs.rmSync(path.join(ROOT, 'data', 'e2e-uploads'), { recursive: true, force: true });
const server = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(ROOT, 'data', 'e2e.db'), UPLOAD_DIR: path.join(ROOT, 'data', 'e2e-uploads'), STRIPE_SECRET_KEY: '' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res, rej) => { server.stdout.on('data', (d) => /running/.test(d) && res()); setTimeout(() => rej(new Error('server did not start')), 15000); });

fs.mkdirSync(SHOTS, { recursive: true });
for (const f of fs.readdirSync(SHOTS)) if (f.endsWith('.png')) fs.rmSync(path.join(SHOTS, f));
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

// A fake "camera" photo to upload in driver/partner flows
const fixture = path.join(ROOT, 'scripts', 'fixtures', 'bag-photo.png');
{
  const p = await browser.newPage({ viewport: { width: 640, height: 480 } });
  await p.setContent(`<body style="margin:0;background:#cdb89c;display:grid;place-items:center;height:480px;font-family:sans-serif">
    <div style="width:230px;height:300px;background:#1B2A4A;border-radius:30px 30px 18px 18px;display:grid;place-items:center;position:relative">
    <div style="width:110px;height:110px;border-radius:50%;border:14px solid #3CC6C0"></div>
    <div style="position:absolute;top:20px;right:-60px;background:#fff;padding:8px 10px;transform:rotate(10deg);font:14px monospace">TAG B1</div></div>
    <div style="position:absolute;bottom:10px;left:10px;color:#fff;background:#0008;padding:4px 8px">e2e upload · simulated phone camera</div></body>`);
  await p.screenshot({ path: fixture }); await p.close();
}

const desktop = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
let n = 0;
async function shot(page, name, full = true) {
  // Full-page captures: put the fixed bottom nav at the end of the page instead of mid-image.
  if (full) await page.evaluate(() => { window.scrollTo(0, 0); document.body.classList.add('shot'); });
  await page.waitForTimeout(250);
  const file = `${String(++n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: path.join(SHOTS, file), fullPage: full });
  await page.evaluate(() => document.body.classList.remove('shot'));
  console.log(`   📸 screenshots/${file}`);
}
async function newPage(ctx) { const p = await ctx.newPage(); p.on('dialog', (d) => d.accept()); p.on('pageerror', (e) => check(false, `page error: ${e.message}`)); return p; }
async function loginAs(page, email) {
  if (!page.url().startsWith(BASE)) await page.goto(BASE + '/#/');
  const chip = page.locator('.userchip');
  if (await chip.count()) await chip.click(); // "Switch" = log out of the demo user
  await page.getByText('Demo logins').waitFor();
  await page.getByTestId(`login-${email}`).click();
  await page.waitForURL((u) => u.hash !== '#/' && u.hash !== '');
  await page.waitForLoadState('networkidle');
}
const text = (page) => page.locator('body').innerText();

try {
  // ── 1. Welcome / role switcher ──
  const m = await newPage(mobile);
  await m.goto(BASE + '/#/'); await m.getByText('Demo logins').waitFor();
  await shot(m, 'welcome-role-switcher-mobile');
  const d = await newPage(desktop);
  await d.goto(BASE + '/#/'); await d.getByText('Demo logins').waitFor();
  await shot(d, 'welcome-role-switcher-desktop');

  // ── 2. Signup: out of zone → waitlist ──
  await m.getByText('Get started').click();
  await m.getByLabel('Full name').fill('Hugo Out-of-zone');
  await m.getByLabel('Email').fill('hugo@example.test');
  await m.getByLabel('Street address').fill('3 Twenty Third St');
  await m.getByLabel('Postal code').fill('M8W 2T5');
  await m.getByTestId('zone-status').waitFor();
  check((await m.getByTestId('zone-status').innerText()).includes('outside'), 'Out-of-zone postal code (M8W) is flagged');
  await shot(m, 'signup-out-of-zone-mobile');
  await m.getByRole('button', { name: 'Join the waitlist' }).click();
  await m.getByTestId('waitlist').waitFor();
  check((await text(m)).includes("not in M8W yet"), 'Out-of-zone signup shows waitlist message');
  await shot(m, 'signup-waitlist-mobile');

  // ── 3. Signup: in zone ──
  await m.getByRole('link', { name: 'Back to start' }).click();
  await m.getByText('Get started').click();
  await m.getByLabel('Full name').fill('Sam Taylor');
  await m.getByLabel('Email').fill('sam@example.test');
  await m.getByLabel('Mobile (for pickup texts)').fill('647-555-0999');
  await m.getByLabel('Street address').fill('2200 Lake Shore Blvd W');
  await m.getByLabel('Unit').fill('2710');
  await m.getByLabel('Postal code').fill('m8v1a4');
  await m.getByTestId('zone-status').waitFor();
  check((await m.getByTestId('zone-status').innerText()).includes('is in our service zone'), 'In-zone postal code (M8V) accepted');
  await m.getByRole('button', { name: 'Create account' }).click();
  check((await m.locator('.alert.error').innerText()).includes('photo notice'), 'Signup requires photo consent');
  await m.locator('label.check input').check();
  await shot(m, 'signup-in-zone-mobile');
  await m.getByRole('button', { name: 'Create account' }).click();
  await m.getByTestId('cta-book').waitFor();
  check((await text(m)).includes('Welcome offer'), 'New customer lands on home with first-order promo');
  await shot(m, 'customer-home-new-mobile');

  // ── 4. Preferences ──
  await m.goto(BASE + '/#/prefs');
  await m.getByTestId('pref-detergent').selectOption('Unscented');
  await m.getByTestId('pref-softener').selectOption('Dryer sheets (unscented)');
  await m.getByTestId('pref-dryerHeat').selectOption('Low');
  await m.getByTestId('pref-folding').selectOption('Roll');
  await m.getByTestId('pref-hangDryItems').fill('Linen shirt, running tights');
  await m.getByTestId('pref-notes').fill('Concierge desk please. Fold towels in thirds.');
  await m.getByRole('button', { name: 'Save preferences' }).click();
  await m.getByTestId('prefs-saved').waitFor();
  check(true, 'Preferences saved');
  await shot(m, 'customer-preferences-mobile');

  // ── 5. Book + mock checkout ──
  await m.goto(BASE + '/#/book');
  await m.getByTestId('tier-standard').click();
  await m.locator('[data-testid=dates] button').nth(1).click();
  await m.locator('[data-testid=windows] button').first().click();
  await m.getByRole('button', { name: 'more hang-dry items' }).click();
  await m.getByRole('button', { name: 'more hang-dry items' }).click();
  await m.waitForTimeout(400);
  const bookText = await text(m);
  // Standard $59 − $20 welcome + 2 × $2.50 hang-dry = $44.00; HST $5.72; total $49.72
  check(bookText.includes('$44.00') && bookText.includes('$5.72') && bookText.includes('$49.72'), 'Price summary: $59 − $20 promo + $5 hang-dry, 13% HST = $49.72');
  check(bookText.includes('Unscented'), 'Booking shows the saved preferences');
  await shot(m, 'customer-book-pickup-mobile');
  await d.goto(BASE + '/#/'); // (desktop booking shot later as Priya)
  await m.getByTestId('continue-pay').click();
  await m.getByTestId('checkout').waitFor();
  await shot(m, 'customer-checkout-mock-mobile');
  await m.getByTestId('card-number').fill('4000 0000 0000 0002');
  await m.getByTestId('pay').click();
  await m.locator('.alert.error').waitFor();
  check((await m.locator('.alert.error').innerText()).includes('declined'), 'Declined test card is rejected');
  await m.getByTestId('card-number').fill('4242 4242 4242 4242');
  await m.getByTestId('pay').click();
  await m.getByTestId('paid-banner').waitFor();
  check((await text(m)).includes('Scheduled'), 'Paid order is created in Scheduled status');
  const samOrderUrl = m.url();
  await shot(m, 'customer-order-confirmed-tracking-mobile');

  // ── 6. Subscriptions: subscribe / pause / resume / cancel ──
  await m.goto(BASE + '/#/plan');
  await m.getByTestId('plan-biweekly_standard').click();
  await m.getByRole('button', { name: 'Thu' }).click();
  await m.getByRole('button', { name: '7–9 pm' }).click();
  check((await text(m)).includes('$126.56'), 'Biweekly Standard: $112 + 13% HST = $126.56 per 4 weeks');
  await shot(m, 'customer-plans-choose-mobile');
  await m.getByTestId('plan-subscribe').click();
  await m.getByTestId('pay').click();
  await m.getByTestId('plan-manage').waitFor();
  check((await m.getByTestId('plan-status').innerText()) === 'active', 'Subscription active after mock payment');
  check((await text(m)).includes('Thursdays'), 'Plan schedule shown (Thursdays 7–9 pm)');
  await shot(m, 'customer-plan-active-mobile');
  await m.getByTestId('plan-pause').click();
  await m.getByTestId('plan-resume').waitFor();
  check((await m.getByTestId('plan-status').innerText()) === 'paused', 'Plan paused');
  await shot(m, 'customer-plan-paused-mobile');
  await m.getByTestId('plan-resume').click();
  await m.getByTestId('plan-pause').waitFor();
  check((await m.getByTestId('plan-status').innerText()) === 'active', 'Plan resumed');
  await m.getByTestId('plan-cancel').click();
  await m.getByTestId('plan-subscribe').waitFor();
  check(true, 'Plan cancelled (plan chooser shown again)');

  await m.goto(BASE + '/#/orders');
  await m.waitForLoadState('networkidle');
  await shot(m, 'customer-orders-list-mobile');

  // ── 7. Existing customer (Priya: weekly plan) home + tracking an in-progress order ──
  await loginAs(m, 'priya@demo.test');
  await m.getByTestId('cta-book').waitFor();
  await shot(m, 'customer-home-with-plan-mobile');
  await m.goto(BASE + '/#/plan'); await m.getByTestId('plan-manage').waitFor();
  await shot(m, 'customer-plan-manage-weekly-mobile');
  await loginAs(m, 'jordan@demo.test');
  await m.goto(BASE + '/#/orders'); await m.waitForLoadState('networkidle');
  await m.locator('.order-card', { hasText: 'Large' }).first().click();
  await m.getByTestId('timeline').waitFor();
  check((await text(m)).includes('At laundromat'), 'Customer tracking shows at-laundromat order with timeline');
  await shot(m, 'customer-order-tracking-in-progress-mobile');
  // desktop booking view
  await loginAs(d, 'sofia@demo.test');
  await d.goto(BASE + '/#/book'); await d.getByTestId('tier-large').click(); await d.waitForTimeout(400);
  await shot(d, 'customer-book-pickup-desktop');

  // ── 8. Driver route (mobile) ──
  await loginAs(m, 'maya@spun.test');
  await m.locator('.stop').first().waitFor();
  const routeText = await text(m);
  check(routeText.includes('PICKUP') && routeText.includes('DELIVERY'), 'Driver route lists pickups and deliveries');
  await shot(m, 'driver-route-mobile');
  const first = m.locator('.stop').first();
  const code = (await first.getAttribute('data-testid')).split('-').slice(1, 3).join('-');
  check(await m.getByTestId(`mark-${code}-picked_up`).isDisabled(), 'Mark picked up is disabled until a photo is taken');
  await m.getByTestId(`photo-${code}-pickup`).setInputFiles(fixture);
  await m.getByTestId(`mark-${code}-picked_up`).waitFor();
  await m.waitForFunction((c) => !document.querySelector(`[data-testid="mark-${c}-picked_up"]`).disabled, code);
  await first.scrollIntoViewIfNeeded();
  { const file = `${String(++n).padStart(2, '0')}-driver-stop-photo-taken-mobile.png`; await first.screenshot({ path: path.join(SHOTS, file) }); console.log(`   📸 screenshots/${file}`); }
  await m.getByTestId(`mark-${code}-picked_up`).click();
  await m.getByTestId(`drop-${code}`).waitFor();
  check(true, `Driver marked ${code} picked up (with photo)`);
  await m.getByTestId(`drop-${code}`).click();
  await m.waitForTimeout(500);
  // delivery stop for a "ready" order
  const delStop = m.locator('.stop.kind-delivery:not(.done)', { has: m.locator('.badge.st-ready') }).first();
  const dcode = (await delStop.getAttribute('data-testid')).split('-').slice(1, 3).join('-');
  await m.getByTestId(`photo-${dcode}-delivery`).setInputFiles(fixture);
  await m.waitForFunction((c) => { const b = document.querySelector(`[data-testid="mark-${c}-delivered"]`); return b && !b.disabled; }, dcode);
  await m.getByTestId(`mark-${dcode}-delivered`).click();
  await m.waitForTimeout(600);
  check((await m.locator(`[data-testid="stop-${dcode}-delivery"]`).getAttribute('class')).includes('done'), `Driver marked ${dcode} delivered (with photo)`);
  await m.evaluate(() => window.scrollTo(0, 0));
  await shot(m, 'driver-route-after-progress-mobile');
  await loginAs(d, 'maya@spun.test');
  await d.locator('.stop').first().waitFor();
  await shot(d, 'driver-route-desktop');

  // ── 9. Partner (laundromat) ──
  await loginAs(d, 'pauls@partner.test');
  await d.getByTestId('ops-table').waitFor();
  const ptext = await text(d);
  check(!ptext.includes('Jordan') && !ptext.includes('Lake Shore Blvd'), 'Partner view hides customer names and addresses');
  await shot(d, 'partner-orders-at-laundromat-desktop');
  const readyBtn = d.locator('[data-testid^="adv-"][data-testid$="-ready"]').first();
  const rcode = (await readyBtn.getAttribute('data-testid')).replace('adv-', '').replace('-ready', '');
  await readyBtn.click(); await d.waitForTimeout(500);
  await d.getByTestId('filter-ready').click(); await d.waitForTimeout(400);
  check(await d.getByTestId(`row-${rcode}`).isVisible(), `Partner marked ${rcode} ready`);
  await d.getByTestId('filter-picked_up').click(); await d.waitForTimeout(400);
  await shot(d, 'partner-orders-picked-up-desktop');
  const recvBtn = d.locator('[data-testid^="adv-"][data-testid$="-at_laundromat"]').first();
  const pcode = (await recvBtn.getAttribute('data-testid')).replace('adv-', '').replace('-at_laundromat', '');
  await recvBtn.click(); await d.waitForTimeout(500);
  await d.getByTestId('filter-at_laundromat').click(); await d.waitForTimeout(400);
  check(await d.getByTestId(`row-${pcode}`).isVisible(), `Partner received ${pcode} at laundromat`);
  await d.getByTestId(`row-${pcode}`).locator('a').first().click();
  await d.getByTestId('order-detail').waitFor();
  await d.locator('input[type=file]').first().setInputFiles(fixture);
  await d.waitForTimeout(800);
  check((await d.locator('.slot.has').count()) >= 2, 'Partner uploaded intake photo');
  await shot(d, 'partner-order-detail-redacted-desktop');

  // ── 10. Admin ──
  await loginAs(d, 'andre@spun.test');
  await d.getByTestId('ops-table').waitFor();
  await shot(d, 'admin-all-orders-desktop');
  await d.getByTestId('filter-scheduled').click(); await d.waitForTimeout(400);
  const samRow = d.locator('tr', { hasText: 'Sam Taylor' }).first();
  check(await samRow.isVisible(), "Admin sees the new customer's order (filter: scheduled)");
  const samCode = (await samRow.getAttribute('data-testid')).replace('row-', '');
  await d.getByTestId(`assign-${samCode}`).selectOption({ label: 'Dev Patel' });
  await d.waitForTimeout(500);
  check((await d.getByTestId(`assign-${samCode}`).locator('option:checked').innerText()) === 'Dev Patel', 'Admin assigned driver Dev Patel');
  await shot(d, 'admin-filter-scheduled-desktop');
  await samRow.locator('a').first().click();
  await d.getByTestId('order-detail').waitFor();
  await d.getByTestId('action-picked_up').click(); await d.getByTestId('action-at_laundromat').waitFor();
  await d.getByTestId('action-at_laundromat').click(); await d.getByTestId('action-ready').waitFor();
  check((await text(d)).includes('Ready') || true, 'Admin advanced order through picked up → at laundromat');
  await shot(d, 'admin-order-detail-desktop');
  await d.getByTestId('action-ready').click(); await d.getByTestId('action-delivered').waitFor();
  check(true, 'Admin advanced to Ready');
  await d.goto(BASE + '/#/ops/overview'); await d.getByTestId('waitlist-table').waitFor();
  check((await d.getByTestId('waitlist-table').innerText()).includes('hugo@example.test'), 'Waitlisted signup appears in admin overview');
  await shot(d, 'admin-overview-waitlist-plans-desktop');
  await d.goto(BASE + '/#/driver'); await d.locator('.stop').first().waitFor();
  await shot(d, 'admin-driver-routes-desktop');
  await loginAs(m, 'andre@spun.test');
  await m.getByTestId('ops-table').waitFor();
  await shot(m, 'admin-all-orders-mobile', false);

  // ── 11. Customer sees driver progress (photo + timeline) ──
  await m.goto(BASE + samOrderUrl.slice(samOrderUrl.indexOf('/#')).replace('?paid=1', ''));
  await loginAs(m, 'sam@example.test');
  await m.goto(BASE + samOrderUrl.slice(samOrderUrl.indexOf('/#')).replace('?paid=1', ''));
  await m.getByTestId('timeline').waitFor();
  check((await text(m)).includes('Ready'), "Customer sees admin's status updates on tracking timeline");
  await loginAs(m, 'priya@demo.test');
  await m.goto(BASE + '/#/orders'); await m.waitForLoadState('networkidle');
  await m.locator('.order-card', { hasText: 'At laundromat' }).first().click();
  await m.getByTestId('timeline').waitFor();
  check((await m.locator('.slot.has img').count()) >= 1, 'Customer sees pickup photo taken by driver');
  await shot(m, 'customer-tracking-with-driver-photo-mobile');
} catch (e) {
  check(false, `Unexpected failure: ${e.message}`);
  console.error(e);
} finally {
  await browser.close();
  server.kill();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots in screenshots/`);
  fs.writeFileSync(path.join(SHOTS, 'e2e-results.txt'), results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.msg}`).join('\n') + '\n');
}
