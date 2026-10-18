// ─────────────────────────────────────────────────────────────────────────────
// Spun prototype — single source of truth for brand, zone, windows and prices.
// Imported by BOTH the Express server and the React client.
//
// RENAMING: change BRAND below (name, tagline, colours). Nothing else in the app
// hard-codes "Spun" in user-facing UI except the logo SVG text, which reads
// BRAND.wordmark too.
// ─────────────────────────────────────────────────────────────────────────────

export const BRAND = {
  name: 'Spun',                 // display name (research: "Spun Laundry" if adopted)
  wordmark: 'spun',             // lowercase logo text (brand-options.md logo direction)
  legalName: 'Spun Laundry Co. (working name)',
  tagline: 'Picked up. Spun clean. Back by tomorrow.',
  colors: { primary: '#1B2A4A', accent: '#3CC6C0' }, // Deep Navy + Fresh Aqua (brand-options.md §3A)
  supportEmail: 'hello@example.test',
};

// Service zone: allowed postal-code prefixes (Forward Sortation Areas or longer
// prefixes). Research: pilot = Humber Bay Shores / Mimico = FSA M8V only.
// Override without code changes: SERVICE_ZONE_PREFIXES="M8V,M8W" in .env/env.
export const DEFAULT_ZONE = {
  name: 'Humber Bay Shores / Mimico',
  prefixes: ['M8V'],
};

export const TIMEZONE = 'America/Toronto';
export const CURRENCY = 'CAD';
export const HST_RATE = 0.13; // pricing.md: all prices exclude 13% Ontario HST

// Pickup/delivery windows. service-standards.md says "2-hour windows";
// the exact slots come from driver-plan.md §1.1. Sunday closed.
// day: 1=Mon … 6=Sat (JS getDay numbering, 0 = Sunday).
export const WINDOWS = [
  { id: 'am1', label: '7–9 am', start: '07:00', end: '09:00', days: [1, 2, 3, 4, 5, 6] },
  { id: 'am2', label: '9–11 am', start: '09:00', end: '11:00', days: [1, 2, 3, 4, 5, 6] },
  { id: 'sat3', label: '11 am–1 pm', start: '11:00', end: '13:00', days: [6] },
  { id: 'sat4', label: '1–3 pm', start: '13:00', end: '15:00', days: [6] },
  { id: 'pm1', label: '5–7 pm', start: '17:00', end: '19:00', days: [1, 2, 3, 4, 5] },
  { id: 'pm2', label: '7–9 pm', start: '19:00', end: '21:00', days: [1, 2, 3, 4, 5] },
];
// NOTE: driver-plan.md lists Saturday windows as 9–11, 11–1, 1–3 and morning
// run (Mon–Sat) as 7–9, 9–11. We therefore offer 7–9 am on Saturday too.
export const BOOKING_CUTOFF_MIN = 60;  // [ASSUMPTION] book up to 60 min before a window starts
export const BOOKING_DAYS_AHEAD = 14;

// Bag tiers — pricing.md §1.2 (CAD, pre-HST, pickup + next-day delivery included)
export const TIERS = {
  small:    { id: 'small', name: 'Small', priceCents: 3900, bags: 1, lbs: '≈15 lb (12–18)',
              blurb: 'Any standard 13-gal kitchen-size bag, tied closed. We transfer it to a liner.' },
  standard: { id: 'standard', name: 'Standard', priceCents: 5900, bags: 1, lbs: '≈25 lb (19–30)',
              blurb: 'One Spun bag filled to the fill line, drawstring fully closed.' },
  large:    { id: 'large', name: 'Large', priceCents: 10500, bags: 2, lbs: '≈50 lb',
              blurb: 'Two Standard Spun bags in one pickup (second bag $46).' },
};
export const EXTRA_STANDARD_BAG_CENTS = 4600; // each additional Standard bag, 3rd and up

// Add-ons — pricing.md §1.4
export const ADDONS = {
  hangDryPerItemCents: 250,
  sameDayCents: 2500,          // pickup by 9 am (7–9 am window), back by 9 pm
  comforters: {
    twin_double: { name: 'Comforter Twin/Double', cents: 2500 },
    queen:       { name: 'Comforter Queen', cents: 3200 },
    king:        { name: 'Comforter King', cents: 3800 },
    down:        { name: 'Down comforter (any size)', cents: 4400 },
    blanket:     { name: 'Blanket', cents: 1800 },
  },
  wetPerBagCents: 1000,        // applied by driver/partner only (not at booking)
};

// First-order promo — pricing.md §2: first Standard bag $39 ($20 off)
export const FIRST_ORDER_PROMO = { label: 'First Standard bag $39 (welcome offer)', discountCents: 2000 };

// Subscriptions — pricing.md §2. Billed every 4 weeks in advance, 6-month price lock,
// priority windows, pause before next billing date.
export const PLANS = {
  weekly_standard:   { id: 'weekly_standard', name: 'Weekly Standard', cadenceWeeks: 1, tier: 'standard', bagsPer4Weeks: 4, priceCents: 21200, perBag: '$53 / bag (−10%)' },
  biweekly_standard: { id: 'biweekly_standard', name: 'Biweekly Standard', cadenceWeeks: 2, tier: 'standard', bagsPer4Weeks: 2, priceCents: 11200, perBag: '$56 / bag (−5%)' },
  weekly_small:      { id: 'weekly_small', name: 'Weekly Small', cadenceWeeks: 1, tier: 'small', bagsPer4Weeks: 4, priceCents: 14000, perBag: '$35 / bag (−10%)' },
  biweekly_small:    { id: 'biweekly_small', name: 'Biweekly Small', cadenceWeeks: 2, tier: 'small', bagsPer4Weeks: 2, priceCents: 7400, perBag: '$37 / bag (−5%)' },
};
export const PLAN_BILLING_WEEKS = 4;
// [ASSUMPTION] Extra bags on a plan pickup are charged at the "each additional
// Standard bag" rate ($46) for Standard plans, and Small tier price ($39) for Small plans.
export const PLAN_EXTRA_BAG_CENTS = { standard: 4600, small: 3900 };

export const STATUSES = [
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'picked_up', label: 'Picked up' },
  { id: 'at_laundromat', label: 'At laundromat' },
  { id: 'ready', label: 'Ready' },
  { id: 'delivered', label: 'Delivered' },
];
export const STATUS_LABEL = Object.fromEntries([...STATUSES.map(s => [s.id, s.label]), ['cancelled', 'Cancelled']]);

// Preference profile — service-standards.md §2 (first option = default)
export const PREF_OPTIONS = {
  detergent: ['Standard (scented)', 'Unscented', 'Hypoallergenic (free & clear)', 'Customer-supplied'],
  softener: ['None', 'Liquid softener', 'Dryer sheets (scented)', 'Dryer sheets (unscented)'],
  bleach: ['None', 'Whites only (chlorine)', 'Oxygen bleach only'],
  washTemp: ['Cold', 'Warm for whites & towels', 'Follow care labels only'],
  dryerHeat: ['Medium', 'Low', 'Hang-dry list only'],
  folding: ['Standard', 'KonMari vertical file fold', 'Roll', 'Hang shirts'],
  sort: ['Lights/darks/towels separated', 'Wash together'],
};
export const DEFAULT_PREFS = {
  detergent: 'Standard (scented)', softener: 'None', bleach: 'None', washTemp: 'Cold',
  dryerHeat: 'Medium', hangDryItems: '', hangDryActivewear: false, folding: 'Standard',
  separateKids: false, sort: 'Lights/darks/towels separated', allergies: '', notes: '',
  buildingAccess: '',
};
export const NOTES_MAX = 200; // service-standards.md: special instructions max 200 chars
