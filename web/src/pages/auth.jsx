import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { BRAND, TIERS } from '../../../shared/config.js';
import { normalizePostal, money } from '../../../shared/logic.js';
import { Logo, ErrorMsg } from '../components.jsx';

const ROLE_INFO = {
  customer: 'Book pickups, plans, preferences, tracking',
  driver: "Today's route, photos, picked up / delivered",
  partner: 'Laundromat view — customer IDs only (privacy)',
  admin: 'All orders, assign drivers, waitlist, plans',
};

export function Welcome() {
  const { login, meta } = useApp();
  const [users, setUsers] = useState([]);
  useEffect(() => { api('/api/demo-users').then(setUsers); }, []);
  return (
    <div className="welcome">
      <section className="hero">
        <Logo size={44} light />
        <h1>{BRAND.tagline}</h1>
        <p>Laundry pickup &amp; delivery for {meta.zone.name}. Per-bag pricing from {money(TIERS.small.priceCents)}, 2-hour pickup windows, back the next day.</p>
        <Link to="/signup" className="btn accent big">Get started — check my address</Link>
      </section>
      <section className="card">
        <h2>Demo logins</h2>
        <p className="muted">No passwords in this prototype — tap a person to act as them.</p>
        <div className="demo-users">
          {users.map((u) => (
            <button key={u.id} className="demo-user" onClick={() => login(u.id)} data-testid={`login-${u.email}`}>
              <span className={`role role-${u.role}`}>{u.role}</span>
              <span className="who"><b>{u.name}</b><small>{u.role === 'customer' ? `${u.unit ? u.unit + '-' : ''}${u.addressLine} · ${u.postalCode}` : ROLE_INFO[u.role]}</small></span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

export function Signup() {
  const { login, meta } = useApp();
  const [f, setF] = useState({ name: '', email: '', phone: '', addressLine: '', unit: '', city: 'Toronto', postalCode: '', buildingAccess: '', photoConsent: false });
  const [zone, setZone] = useState(null);
  const [err, setErr] = useState('');
  const [waitlisted, setWaitlisted] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  useEffect(() => {
    const pc = normalizePostal(f.postalCode);
    if (pc.length < 7) { setZone(null); return; }
    api('/api/zone-check', { method: 'POST', body: { postalCode: pc } }).then(setZone);
  }, [f.postalCode]);

  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const r = await api('/api/signup', { method: 'POST', body: f });
      if (r.waitlisted) setWaitlisted(r); else await login(r.user.id);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  if (waitlisted) return (
    <div className="card narrow center-text" data-testid="waitlist">
      <div className="big-emoji">📍</div>
      <h1>We're not in {waitlisted.postalCode.slice(0, 3)} yet</h1>
      <p>{BRAND.name} is piloting in <b>{waitlisted.zone}</b> ({waitlisted.prefixes.join(', ')}) first. You're on the waitlist — we'll email <b>{f.email}</b> as soon as we reach your area.</p>
      <p className="muted">Thanks for helping us decide where to go next.</p>
      <div className="row gap wrap" style={{ justifyContent: 'center' }}><button className="btn ghost" onClick={() => { setWaitlisted(null); setF({ ...f, postalCode: '', addressLine: '' }); }}>Try another address</button><Link className="btn" to="/">Back to start</Link></div>
    </div>
  );

  return (
    <form className="card narrow" onSubmit={submit} data-testid="signup-form">
      <h1>Create your account</h1>
      <p className="muted">We currently serve <b>{meta.zone.name}</b> — postal codes starting with {meta.zone.prefixes.join(', ')}.</p>
      <label>Full name<input value={f.name} onChange={set('name')} autoComplete="name" required /></label>
      <div className="grid2">
        <label>Email<input type="email" value={f.email} onChange={set('email')} autoComplete="email" required /></label>
        <label>Mobile (for pickup texts)<input type="tel" value={f.phone} onChange={set('phone')} autoComplete="tel" /></label>
      </div>
      <label>Street address<input value={f.addressLine} onChange={set('addressLine')} placeholder="e.g. 2121 Lake Shore Blvd W" autoComplete="address-line1" required /></label>
      <div className="grid3">
        <label>Unit<input value={f.unit} onChange={set('unit')} placeholder="1408" /></label>
        <label>City<input value={f.city} onChange={set('city')} /></label>
        <label>Postal code<input value={f.postalCode} onChange={set('postalCode')} placeholder="M8V 0C8" autoComplete="postal-code" required /></label>
      </div>
      {zone && (zone.valid
        ? <div className={`alert ${zone.inZone ? 'ok' : 'warn'}`} data-testid="zone-status">{zone.inZone ? `✓ ${zone.postalCode} is in our service zone.` : `${zone.postalCode} is outside our pilot zone — you can still join the waitlist.`}</div>
        : <div className="alert warn">That doesn't look like a Canadian postal code yet.</div>)}
      <label>Building access (concierge, buzzer, door drop OK?)<input value={f.buildingAccess} onChange={set('buildingAccess')} placeholder="Concierge 24/7, parcel room OK" /></label>
      <label className="check"><input type="checkbox" checked={f.photoConsent} onChange={set('photoConsent')} /> I understand {BRAND.name} photographs my bags and laundry at pickup, at the laundromat and on delivery, only to prove pickup/delivery and item condition (kept 90 days).</label>
      <ErrorMsg error={err} />
      <button className="btn primary big" disabled={busy}>{zone && zone.valid && !zone.inZone ? 'Join the waitlist' : 'Create account'}</button>
      <p className="muted small">Already a customer? <Link to="/">Pick a demo login</Link>.</p>
    </form>
  );
}
