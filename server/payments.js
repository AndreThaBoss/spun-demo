// ─────────────────────────────────────────────────────────────────────────────
// Payments: MOCK by default, Stripe TEST MODE when test keys are provided.
//
// ▶ To try real Stripe test mode later, put these in .env (see .env.example):
//     STRIPE_SECRET_KEY=sk_test_...
//     STRIPE_PUBLISHABLE_KEY=pk_test_...      (not needed for hosted Checkout)
// Only keys that start with sk_test_ are accepted; live keys are refused.
// With no key set, everything runs through the built-in mock checkout, which
// imitates Stripe's test cards (4242 4242 4242 4242 = success,
// 4000 0000 0000 0002 = declined).
//
// The Stripe path below uses Stripe's REST API directly (Checkout Sessions,
// mode=payment for one-off orders, a one-time 4-week charge for plans). It has
// NOT been exercised against Stripe — no account was created for this prototype.
// For real subscriptions you would switch plans to Stripe Billing (Prices +
// mode=subscription) and handle webhooks; see README "Next steps".
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'node:crypto';

const KEY = process.env.STRIPE_SECRET_KEY || '';
if (KEY && !KEY.startsWith('sk_test_')) {
  console.error('\n[payments] Refusing STRIPE_SECRET_KEY that is not a TEST key (must start with sk_test_). Falling back to mock.\n');
}
export const PAYMENTS_MODE = KEY.startsWith('sk_test_') ? 'stripe_test' : 'mock';

export const newRef = (prefix = 'mock_cs') => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;

// Stripe test card behaviour, imitated.
export function mockCharge(cardNumber = '') {
  const n = String(cardNumber).replace(/\D/g, '');
  if (n === '4000000000000002') return { ok: false, error: 'Your card was declined. (mock — Stripe test card 4000 0000 0000 0002)' };
  if (n.length < 12) return { ok: false, error: 'Enter a test card number, e.g. 4242 4242 4242 4242.' };
  return { ok: true, chargeRef: newRef('mock_pi') };
}

async function stripe(pathname, params, method = 'POST') {
  const body = new URLSearchParams(params);
  const res = await fetch(`https://api.stripe.com/v1/${pathname}${method === 'GET' ? '?' + body : ''}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || 'Stripe error');
  return json;
}

/** Create a hosted Stripe Checkout Session (TEST mode only). */
export async function createStripeCheckout({ ref, description, amountCents, baseUrl, email }) {
  return stripe('checkout/sessions', {
    mode: 'payment',
    'line_items[0][price_data][currency]': 'cad',
    'line_items[0][price_data][product_data][name]': description,
    'line_items[0][price_data][unit_amount]': String(amountCents), // HST-inclusive total
    'line_items[0][quantity]': '1',
    customer_email: email || '',
    client_reference_id: ref,
    success_url: `${baseUrl}/api/checkout/${ref}/stripe-return?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/#/checkout/${ref}?cancelled=1`,
  });
}
export async function retrieveStripeCheckout(sessionId) {
  return stripe(`checkout/sessions/${encodeURIComponent(sessionId)}`, {}, 'GET');
}
