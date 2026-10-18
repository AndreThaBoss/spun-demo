import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { BRAND, TIERS, PLANS, ADDONS, PREF_OPTIONS, NOTES_MAX, WINDOWS, EXTRA_STANDARD_BAG_CENTS, FIRST_ORDER_PROMO, HST_RATE } from '../../../shared/config.js';
import { money, fmtDate, deliveryFor, pricePlan, planDates, firstOnOrAfter, addDays, dayOfWeek } from '../../../shared/logic.js';
import { StatusBadge, Progress, PriceSummary, PrefsList, Flags, Stepper, ErrorMsg, when, win, orderTitle, extrasText } from '../components.jsx';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function OrderCard({ o }) {
  return (
    <Link to={`/orders/${o.id}`} className="card order-card" data-testid={`order-${o.code}`}>
      <div className="row-between"><b>{orderTitle(o)}</b><StatusBadge status={o.status} /></div>
      <div className="muted small">#{o.code} · Pickup {when(o.pickupDate, o.pickupWindow)} → Delivery {when(o.deliveryDate, o.deliveryWindow)}</div>
      {o.status !== 'cancelled' && o.status !== 'delivered' && <Progress status={o.status} />}
    </Link>
  );
}

export function CustomerHome() {
  const { me } = useApp();
  const [orders, setOrders] = useState(null);
  useEffect(() => { api('/api/orders').then(setOrders); }, []);
  const active = (orders || []).filter((o) => !['delivered', 'cancelled'].includes(o.status));
  const sub = me.subscription;
  return (
    <div className="stack">
      <div className="greet">
        <h1>Hi {me.user.name.split(' ')[0]} 👋</h1>
        <p className="muted">{me.user.unit ? `${me.user.unit}-` : ''}{me.user.addressLine} · {me.user.postalCode}</p>
      </div>
      <Link to="/book" className="btn primary big block" data-testid="cta-book">Book a pickup</Link>
      {me.firstOrder && <div className="alert promo">🎉 Welcome offer: your first Standard bag is {money(TIERS.standard.priceCents - FIRST_ORDER_PROMO.discountCents)} (save {money(FIRST_ORDER_PROMO.discountCents)}).</div>}
      <section>
        <h2>Active orders</h2>
        {orders === null ? <p className="muted">Loading…</p> : active.length ? active.map((o) => <OrderCard key={o.id} o={o} />) : <p className="muted">No active orders. Book a pickup and we'll be there in your 2-hour window.</p>}
      </section>
      <section className="card">
        <div className="row-between"><h2>Your plan</h2><Link to="/plan">{sub ? 'Manage' : 'See plans'}</Link></div>
        {sub ? (
          <p><b>{sub.planInfo.name}</b> · <span className={`badge sub-${sub.status}`}>{sub.status}</span><br />
            <span className="muted">{sub.nextPickup ? `Next pickup ${when(sub.nextPickup.pickup_date, sub.nextPickup.pickup_window)}` : sub.status === 'paused' ? 'Paused — no pickups scheduled' : ''}</span></p>
        ) : <p className="muted">Save up to 10% with a weekly or biweekly plan, billed every 4 weeks.</p>}
      </section>
      <section className="card">
        <div className="row-between"><h2>Laundry preferences</h2><Link to="/prefs">Edit</Link></div>
        <Flags prefs={me.prefs} />
        <PrefsList prefs={me.prefs} compact />
      </section>
    </div>
  );
}

export function Book() {
  const { me } = useApp();
  const nav = useNavigate();
  const [slots, setSlots] = useState([]);
  const [d, setD] = useState({ tier: 'standard', extraBags: 0, hangDryCount: 0, sameDay: false, comforters: {}, pickupDate: '', pickupWindow: '' });
  const [quote, setQuote] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (patch) => setD((x) => ({ ...x, ...patch }));

  useEffect(() => { api('/api/slots').then((s) => { setSlots(s); if (s[0]) set({ pickupDate: s[0].date, pickupWindow: s[0].windows[0].id }); }); }, []);
  useEffect(() => { api('/api/quote', { method: 'POST', body: d }).then(setQuote).catch(() => {}); }, [d]);

  const day = slots.find((s) => s.date === d.pickupDate);
  const sameDayOk = d.pickupWindow === 'am1' && d.pickupDate && dayOfWeek(d.pickupDate) !== 6;
  useEffect(() => { if (!sameDayOk && d.sameDay) set({ sameDay: false }); }, [sameDayOk]);
  const del = d.pickupDate && d.pickupWindow ? deliveryFor(d.pickupDate, d.pickupWindow, d.sameDay) : null;

  const pay = async () => {
    setErr(''); setBusy(true);
    try {
      const r = await api('/api/checkout/order', { method: 'POST', body: d });
      if (r.redirectUrl) window.location.href = r.redirectUrl; else nav(`/checkout/${r.ref}`);
    } catch (x) { setErr(x.message); setBusy(false); }
  };

  return (
    <div className="stack">
      <h1>Book a pickup</h1>
      {me.subscription?.status === 'active' && <div className="alert info">Your {me.subscription.planInfo.name} pickups are scheduled automatically. This is an extra one-off pickup at pay-per-bag prices.</div>}

      <section className="card">
        <h2><span className="stepno">1</span> Bag size</h2>
        <div className="tiers">
          {Object.values(TIERS).map((t) => (
            <button key={t.id} type="button" className={`tier ${d.tier === t.id ? 'sel' : ''}`} onClick={() => set({ tier: t.id, extraBags: 0 })} data-testid={`tier-${t.id}`}>
              <span className="tname">{t.name}</span><span className="tprice">{money(t.priceCents)}</span>
              <span className="tlbs">{t.lbs}</span><span className="tblurb">{t.blurb}</span>
            </button>
          ))}
        </div>
        {d.tier === 'large' && (
          <div className="row-between addon"><span>Additional Standard bags ({money(EXTRA_STANDARD_BAG_CENTS)} each)</span><Stepper label="extra bags" value={d.extraBags} onChange={(v) => set({ extraBags: v })} max={8} /></div>
        )}
        <p className="fine">Bags must close with the drawstring (soft limit ≈25 lb per Standard bag). If one won't close, we text you a photo before splitting it into an extra bag.</p>
      </section>

      <section className="card">
        <h2><span className="stepno">2</span> Pickup window</h2>
        <div className="chips scroll" data-testid="dates">
          {slots.map((s) => (
            <button key={s.date} type="button" className={`chip date ${d.pickupDate === s.date ? 'sel' : ''}`} onClick={() => set({ pickupDate: s.date, pickupWindow: s.windows[0].id })}>
              <small>{fmtDate(s.date, { weekday: 'short' })}</small><b>{fmtDate(s.date, { day: 'numeric' })}</b><small>{fmtDate(s.date, { month: 'short' })}</small>
            </button>
          ))}
        </div>
        <div className="chips" data-testid="windows">
          {day?.windows.map((w) => <button key={w.id} type="button" className={`chip ${d.pickupWindow === w.id ? 'sel' : ''}`} onClick={() => set({ pickupWindow: w.id })}>{w.label}</button>)}
        </div>
        <p className="fine">Mon–Fri: 7–9 am, 9–11 am, 5–7 pm, 7–9 pm · Sat: 7 am–3 pm · Sunday closed.</p>
        {del && <div className="alert ok">Back {d.sameDay ? 'today by 9 pm' : 'next service day'}: <b>{when(del.date, del.windowId)}</b>{dayOfWeek(d.pickupDate) === 6 && !d.sameDay ? ' (Saturday pickups return Monday evening)' : ''}</div>}
      </section>

      <section className="card">
        <h2><span className="stepno">3</span> Extras</h2>
        <div className="row-between addon"><span>Hang-dry items <small className="muted">({money(ADDONS.hangDryPerItemCents)}/item)</small></span><Stepper label="hang-dry items" value={d.hangDryCount} onChange={(v) => set({ hangDryCount: v })} max={30} /></div>
        <label className={`row-between addon check ${sameDayOk ? '' : 'disabled'}`}>
          <span>Same-day service <small className="muted">(+{money(ADDONS.sameDayCents)} · 7–9 am pickup, back by 9 pm, Mon–Fri)</small></span>
          <input type="checkbox" checked={d.sameDay} disabled={!sameDayOk} onChange={(e) => set({ sameDay: e.target.checked })} data-testid="same-day" />
        </label>
        <details>
          <summary>Comforters &amp; blankets (washed per piece)</summary>
          {Object.entries(ADDONS.comforters).map(([k, c]) => (
            <div key={k} className="row-between addon"><span>{c.name} <small className="muted">{money(c.cents)}</small></span>
              <Stepper label={c.name} value={d.comforters[k] || 0} max={4} onChange={(v) => set({ comforters: { ...d.comforters, [k]: v } })} /></div>
          ))}
        </details>
        <p className="fine">Hypoallergenic / fragrance-free detergent or your own detergent is free — set it in preferences.</p>
      </section>

      <section className="card">
        <div className="row-between"><h2><span className="stepno">4</span> Preferences for this order</h2><Link to="/prefs">Edit</Link></div>
        <Flags prefs={me.prefs} />
        <PrefsList prefs={me.prefs} compact />
      </section>

      <section className="card">
        <h2><span className="stepno">5</span> Summary</h2>
        <PriceSummary quote={quote} />
        <ErrorMsg error={err} />
        <button className="btn primary big block" disabled={busy || !d.pickupWindow} onClick={pay} data-testid="continue-pay">{busy ? 'Starting checkout…' : `Continue to payment · ${quote ? money(quote.totalCents) : ''}`}</button>
      </section>
    </div>
  );
}

export function Checkout() {
  const { ref } = useParams();
  const [sp] = useSearchParams();
  const { meta, refreshMe } = useApp();
  const nav = useNavigate();
  const [s, setS] = useState(null);
  const [card, setCard] = useState({ number: '4242 4242 4242 4242', exp: '12 / 34', cvc: '123', name: '' });
  const [err, setErr] = useState(sp.get('cancelled') ? 'Payment was cancelled — you can try again.' : '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api(`/api/checkout/${ref}`).then(setS).catch((e) => setErr(e.message)); }, [ref]);

  const pay = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const r = await api(`/api/checkout/${ref}/confirm`, { method: 'POST', body: { cardNumber: card.number } });
      await refreshMe();
      nav(s.kind === 'plan' ? '/plan?paid=1' : `/orders/${r.orderId}?paid=1`);
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  if (!s) return <div className="card narrow"><ErrorMsg error={err} />{!err && 'Loading checkout…'}</div>;
  return (
    <form className="card narrow checkout" onSubmit={pay} data-testid="checkout">
      <div className="testmode">TEST MODE · mock checkout · no real charge</div>
      <h1>{s.description}</h1>
      {s.kind === 'order' && <p className="muted">Pickup {when(s.payload.pickupDate, s.payload.pickupWindow)}</p>}
      {s.kind === 'plan' && <p className="muted">{DAYS_LONG[s.payload.dayOfWeek]}s · {win(s.payload.windowId)} · billed every 4 weeks</p>}
      <PriceSummary quote={s.quote} note={false} perLabel={s.kind === 'plan' ? 'today (first 4 weeks)' : ''} />
      <fieldset className="cardform">
        <legend>Card details</legend>
        <label>Card number<input value={card.number} onChange={(e) => setCard({ ...card, number: e.target.value })} inputMode="numeric" data-testid="card-number" /></label>
        <div className="grid2">
          <label>Expiry<input value={card.exp} onChange={(e) => setCard({ ...card, exp: e.target.value })} /></label>
          <label>CVC<input value={card.cvc} onChange={(e) => setCard({ ...card, cvc: e.target.value })} /></label>
        </div>
        <p className="fine">Stripe-style test cards: <code>4242 4242 4242 4242</code> succeeds · <code>4000 0000 0000 0002</code> is declined. {meta.paymentsMode === 'mock' ? 'No Stripe keys configured — nothing leaves this computer.' : ''}</p>
      </fieldset>
      <ErrorMsg error={err} />
      {s.status === 'succeeded' ? <Link className="btn primary big block" to={s.kind === 'plan' ? '/plan' : `/orders/${s.orderId}`}>Already paid — view</Link>
        : <button className="btn primary big block" disabled={busy} data-testid="pay">{busy ? 'Processing…' : `Pay ${money(s.amountCents)} (test)`}</button>}
    </form>
  );
}

export function Orders() {
  const [orders, setOrders] = useState(null);
  useEffect(() => { api('/api/orders').then(setOrders); }, []);
  return (
    <div className="stack">
      <h1>Your orders</h1>
      {orders === null ? <p className="muted">Loading…</p> : orders.length ? orders.map((o) => <OrderCard key={o.id} o={o} />) : <p className="muted">No orders yet. <Link to="/book">Book your first pickup</Link>.</p>}
    </div>
  );
}

function DayWindowPicker({ dow, windowId, onChange }) {
  const wins = WINDOWS.filter((w) => w.days.includes(dow));
  return (
    <>
      <div className="chips">{[1, 2, 3, 4, 5, 6].map((n) => <button type="button" key={n} className={`chip ${dow === n ? 'sel' : ''}`} onClick={() => { const w = WINDOWS.find((x) => x.days.includes(n) && x.id === windowId) || WINDOWS.find((x) => x.days.includes(n)); onChange(n, w.id); }}>{DAYS[n]}</button>)}</div>
      <div className="chips">{wins.map((w) => <button type="button" key={w.id} className={`chip ${windowId === w.id ? 'sel' : ''}`} onClick={() => onChange(dow, w.id)}>{w.label}</button>)}</div>
    </>
  );
}

export function Plan() {
  const { me, refreshMe, meta } = useApp();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const sub = me.subscription;
  const [plan, setPlan] = useState('weekly_standard');
  const [dow, setDow] = useState(2);
  const [windowId, setWindowId] = useState('pm1');
  const [edit, setEdit] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (sub) { setDow(sub.day_of_week); setWindowId(sub.window_id); } }, [sub?.id]);

  const act = async (fn) => { setErr(''); setBusy(true); try { await fn(); await refreshMe(); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  const subscribe = () => act(async () => {
    const r = await api('/api/checkout/plan', { method: 'POST', body: { plan, dayOfWeek: dow, windowId } });
    if (r.redirectUrl) window.location.href = r.redirectUrl; else nav(`/checkout/${r.ref}`);
  });

  if (sub) {
    const p = PLANS[sub.plan];
    const upcoming = sub.status === 'active' && sub.nextPickup ? planDates(sub.nextPickup.pickup_date, p.cadenceWeeks, 4) : [];
    return (
      <div className="stack">
        <h1>Your plan</h1>
        {sp.get('paid') && <div className="alert ok">✓ Subscribed — payment received (mock). Your first pickup is booked.</div>}
        <section className="card" data-testid="plan-manage">
          <div className="row-between"><h2>{p.name}</h2><span className={`badge sub-${sub.status}`} data-testid="plan-status">{sub.status}</span></div>
          <dl className="kv">
            <dt>Price</dt><dd>{money(sub.price_cents)} + HST every 4 weeks ({p.perBag})</dd>
            <dt>Pickup</dt><dd>{DAYS_LONG[sub.day_of_week]}s, {win(sub.window_id)} · every {p.cadenceWeeks === 1 ? 'week' : '2 weeks'} · 1 {TIERS[p.tier].name} bag each</dd>
            <dt>Next pickup</dt><dd>{sub.nextPickup ? <Link to={`/orders/${sub.nextPickup.id}`}>{when(sub.nextPickup.pickup_date, sub.nextPickup.pickup_window)}</Link> : '—'}</dd>
            <dt>Next billing</dt><dd>{sub.status === 'active' ? fmtDate(sub.next_billing_date) : '— (not billed while paused)'}</dd>
            <dt>Price locked until</dt><dd>{fmtDate(sub.price_lock_until, { month: 'short', day: 'numeric', year: 'numeric' })}</dd>
          </dl>
          {upcoming.length > 0 && <p className="muted small">Upcoming: {upcoming.map((x) => fmtDate(x)).join(' · ')}</p>}
          {edit ? (
            <div className="stack">
              <DayWindowPicker dow={dow} windowId={windowId} onChange={(a, b) => { setDow(a); setWindowId(b); }} />
              <div className="row gap"><button className="btn primary" disabled={busy} onClick={() => act(async () => { await api(`/api/subscription/${sub.id}`, { method: 'PUT', body: { dayOfWeek: dow, windowId } }); setEdit(false); })}>Save schedule</button><button className="btn ghost" onClick={() => setEdit(false)}>Cancel</button></div>
            </div>
          ) : (
            <div className="row gap wrap">
              {sub.status !== 'cancelled' && <button className="btn ghost" onClick={() => setEdit(true)}>Change day / window</button>}
              {sub.status === 'active' && <button className="btn ghost" disabled={busy} data-testid="plan-pause" onClick={() => act(() => api(`/api/subscription/${sub.id}/pause`, { method: 'POST' }))}>Pause plan</button>}
              {sub.status === 'paused' && <button className="btn primary" disabled={busy} data-testid="plan-resume" onClick={() => act(() => api(`/api/subscription/${sub.id}/resume`, { method: 'POST' }))}>Resume plan</button>}
              <button className="btn danger ghost" disabled={busy} data-testid="plan-cancel" onClick={() => window.confirm('Cancel your plan? Scheduled plan pickups will be cancelled.') && act(() => api(`/api/subscription/${sub.id}/cancel`, { method: 'POST' }))}>Cancel plan</button>
            </div>
          )}
          <ErrorMsg error={err} />
        </section>
        <p className="fine">Plans are billed every 4 weeks in advance and include priority windows and a 6-month price lock. Pause before your next billing date to skip it. Missed pickups aren't refunded unless {BRAND.name} caused them.</p>
      </div>
    );
  }

  const q = pricePlan(plan);
  const start = firstOnOrAfter(addDays(meta.today, 1), dow);
  return (
    <div className="stack">
      <h1>Plans</h1>
      <p className="muted">Same pickup slot every week or two. Billed every 4 weeks in advance, 6-month price lock, priority windows.</p>
      <div className="plans">
        {Object.values(PLANS).map((p) => (
          <button key={p.id} type="button" className={`tier ${plan === p.id ? 'sel' : ''}`} onClick={() => setPlan(p.id)} data-testid={`plan-${p.id}`}>
            <span className="tname">{p.name}</span><span className="tprice">{money(p.priceCents)}<small>/4 wks</small></span>
            <span className="tlbs">{p.bagsPer4Weeks} {TIERS[p.tier].name} bags</span><span className="tblurb">{p.perBag}</span>
          </button>
        ))}
      </div>
      <section className="card">
        <h2>Pickup day &amp; window</h2>
        <DayWindowPicker dow={dow} windowId={windowId} onChange={(a, b) => { setDow(a); setWindowId(b); }} />
        <p className="muted small">First pickup: {fmtDate(start)} · {win(windowId)}, then every {PLANS[plan].cadenceWeeks === 1 ? 'week' : '2 weeks'}.</p>
      </section>
      <section className="card">
        <PriceSummary quote={q} note={false} perLabel="every 4 weeks" />
        <ErrorMsg error={err} />
        <button className="btn primary big block" disabled={busy} onClick={subscribe} data-testid="plan-subscribe">Subscribe · {money(q.totalCents)}</button>
      </section>
    </div>
  );
}

export function Preferences() {
  const { me, refreshMe } = useApp();
  const [p, setP] = useState(me.prefs);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const set = (k) => (e) => setP({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async (e) => {
    e.preventDefault(); setErr(''); setMsg('');
    try { await api('/api/me/preferences', { method: 'PUT', body: p }); await refreshMe(); setMsg('Saved — these print on every order sheet, including upcoming pickups.'); } catch (x) { setErr(x.message); }
  };
  const sel = (k, label) => <label>{label}<select value={p[k]} onChange={set(k)} data-testid={`pref-${k}`}>{PREF_OPTIONS[k].map((o) => <option key={o}>{o}</option>)}</select></label>;
  return (
    <form className="card narrow stack" onSubmit={save} data-testid="prefs-form">
      <h1>Laundry preferences</h1>
      <p className="muted">Saved to your profile and attached to every order. Our laundromat partner sees them with your customer ID only.</p>
      <div className="grid2">{sel('detergent', 'Detergent')}{sel('softener', 'Fabric softener')}</div>
      <div className="grid2">{sel('bleach', 'Bleach')}{sel('washTemp', 'Wash temperature')}</div>
      <div className="grid2">{sel('dryerHeat', 'Dryer heat')}{sel('folding', 'Folding style')}</div>
      {sel('sort', 'Sorting')}
      <label>Hang-dry items<input value={p.hangDryItems} onChange={set('hangDryItems')} placeholder="e.g. 2 silk blouses, wool sweater" data-testid="pref-hangDryItems" /></label>
      <label className="check"><input type="checkbox" checked={p.hangDryActivewear} onChange={set('hangDryActivewear')} /> Hang-dry anything activewear / elastane (returned unfolded in a separate bag)</label>
      <label className="check"><input type="checkbox" checked={p.separateKids} onChange={set('separateKids')} /> Bag kids' clothes separately</label>
      <label>Allergies / sensitivities<input value={p.allergies} onChange={set('allergies')} placeholder="Prints in bold on the order sheet" /></label>
      <label>Building access<input value={p.buildingAccess} onChange={set('buildingAccess')} placeholder="Concierge, buzzer, door drop OK?" /></label>
      <label>Special instructions <small className="muted">({(p.notes || '').length}/{NOTES_MAX})</small><textarea maxLength={NOTES_MAX} rows={3} value={p.notes} onChange={set('notes')} data-testid="pref-notes" /></label>
      {msg && <div className="alert ok" data-testid="prefs-saved">{msg}</div>}
      <ErrorMsg error={err} />
      <button className="btn primary big">Save preferences</button>
    </form>
  );
}
