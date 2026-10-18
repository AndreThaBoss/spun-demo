import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { STATUSES, PLANS, BRAND } from '../../../shared/config.js';
import { money, fmtDate } from '../../../shared/logic.js';
import { StatusBadge, Flags, ErrorMsg, when, win, orderTitle, extrasText } from '../components.jsx';
import { ACTIONS } from './order.jsx';

const FILTERS = [{ id: 'all', label: 'All' }, ...STATUSES, { id: 'cancelled', label: 'Cancelled' }];

export function OpsOrders() {
  const { me } = useApp();
  const role = me.user.role;
  const nav = useNavigate();
  const [status, setStatus] = useState(role === 'partner' ? 'at_laundromat' : 'all');
  const [q, setQ] = useState('');
  const [orders, setOrders] = useState(null);
  const [summary, setSummary] = useState({ counts: {} });
  const [drivers, setDrivers] = useState([]);
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => { api(`/api/orders?status=${status}&q=${encodeURIComponent(q)}`).then(setOrders); }, [status, q, tick]);
  useEffect(() => { api('/api/admin/summary').then(setSummary); if (role === 'admin') api('/api/drivers').then(setDrivers); }, [tick]);
  const total = Object.values(summary.counts).reduce((a, b) => a + b, 0);

  const advance = async (o, st) => {
    setErr('');
    if (st === 'cancelled' && !window.confirm(`Cancel order ${o.code}?`)) return;
    try { await api(`/api/orders/${o.id}/status`, { method: 'POST', body: { status: st } }); setTick((t) => t + 1); } catch (x) { setErr(x.message); }
  };
  const assign = async (o, driverId) => { try { await api(`/api/orders/${o.id}/assign`, { method: 'POST', body: { driverId } }); setTick((t) => t + 1); } catch (x) { setErr(x.message); } };

  return (
    <div className="stack">
      <div className="row-between wrap">
        <div><h1>{role === 'partner' ? `${me.user.name.replace(' (partner)', '')} — orders` : 'All orders'}</h1>
          {role === 'partner' && <p className="muted small">Privacy: you see customer IDs and preferences only — no names, addresses or phone numbers.</p>}</div>
        <input className="search" placeholder={role === 'partner' ? 'Search order # / customer ID' : 'Search order #, name, address'} value={q} onChange={(e) => setQ(e.target.value)} data-testid="ops-search" />
      </div>
      <div className="chips scroll" data-testid="status-filter">
        {FILTERS.map((f) => (
          <button key={f.id} className={`chip ${status === f.id ? 'sel' : ''}`} onClick={() => setStatus(f.id)} data-testid={`filter-${f.id}`}>
            {f.label} <span className="count">{f.id === 'all' ? total : summary.counts[f.id] || 0}</span>
          </button>
        ))}
      </div>
      <ErrorMsg error={err} />
      {orders === null ? <p className="muted">Loading…</p> : orders.length === 0 ? <p className="card muted">No orders with this status.</p> : (
        <div className="table-wrap">
          <table className="orders" data-testid="ops-table">
            <thead><tr><th>Order</th><th>Customer</th><th>Pickup</th><th>Delivery</th><th>Bags / extras</th><th>Preferences</th><th>Status</th>{role === 'admin' && <th>Driver</th>}<th>Action</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} data-testid={`row-${o.code}`}>
                  <td data-label="Order"><Link to={`/orders/${o.id}`}><b>#{o.code}</b></Link><div className="muted small">{orderTitle(o)}</div></td>
                  <td data-label="Customer">{role === 'partner' ? <b>{o.customer.customerCode}</b> : <><b>{o.customer.name}</b><div className="muted small">{o.address}</div></>}</td>
                  <td data-label="Pickup">{when(o.pickupDate, o.pickupWindow)}</td>
                  <td data-label="Delivery">{when(o.deliveryDate, o.deliveryWindow)}</td>
                  <td data-label="Bags">{o.bagCount} <span className="muted small">{o.bagTags[0]}{o.bagCount > 1 ? '…' : ''}</span>{extrasText(o) && <div className="small">{extrasText(o)}</div>}</td>
                  <td data-label="Prefs" className="small"><Flags prefs={o.prefs} /><div>{o.prefs.detergent} · {o.prefs.softener} softener · {o.prefs.dryerHeat} heat · fold: {o.prefs.folding}</div>{o.prefs.hangDryItems && <div>Hang-dry: {o.prefs.hangDryItems}</div>}{o.prefs.allergies && <div className="allergy">⚠ {o.prefs.allergies}</div>}</td>
                  <td data-label="Status"><StatusBadge status={o.status} /></td>
                  {role === 'admin' && <td data-label="Driver"><select value={o.driver?.id || ''} onChange={(e) => assign(o, e.target.value)} data-testid={`assign-${o.code}`}><option value="">Unassigned</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></td>}
                  <td data-label="Action" className="nowrap">
                    {(ACTIONS[role]?.[o.status] || []).filter(([st]) => st !== 'cancelled').map(([st, label]) => <button key={st} className="btn small primary" onClick={() => advance(o, st)} data-testid={`adv-${o.code}-${st}`}>{label}</button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function OpsOverview() {
  const { meta } = useApp();
  const [s, setS] = useState(null);
  const [msg, setMsg] = useState('');
  const load = () => api('/api/admin/summary').then(setS);
  useEffect(() => { load(); }, []);
  const reset = async () => { if (!window.confirm('Reset all demo data? Uploaded photos stay on disk; DB is re-seeded.')) return; await api('/api/admin/reset', { method: 'POST' }); setMsg('Demo data reset.'); load(); };
  if (!s) return <p className="muted">Loading…</p>;
  return (
    <div className="stack">
      <h1>Overview</h1>
      <div className="route-stats card">
        {STATUSES.map((st) => <Link key={st.id} to="/ops"><b>{s.counts[st.id] || 0}</b><small>{st.label}</small></Link>)}
      </div>
      <div className="grid2 top">
        <section className="card">
          <h2>Service zone</h2>
          <p><b>{meta.zone.name}</b> — postal prefixes: {meta.zone.prefixes.map((p) => <code key={p}>{p}</code>)}</p>
          <p className="fine">Change in <code>shared/config.js</code> (DEFAULT_ZONE) or set <code>SERVICE_ZONE_PREFIXES=M8V,M8W</code> in <code>.env</code>.</p>
          <p>Payments mode: <b>{meta.paymentsMode}</b> · Collected (mock, incl. HST): <b>{money(s.revenueCents)}</b></p>
        </section>
        <section className="card">
          <h2>Waitlist <span className="count">{s.waitlist.length}</span></h2>
          <table className="mini" data-testid="waitlist-table"><tbody>{s.waitlist.map((w) => <tr key={w.id}><td><b>{w.name}</b><div className="muted small">{w.email}</div></td><td>{w.postal_code}</td><td className="muted small">{w.address}</td></tr>)}</tbody></table>
        </section>
      </div>
      <section className="card">
        <h2>Subscriptions</h2>
        <div className="table-wrap">
          <table className="mini" data-testid="subs-table">
            <thead><tr><th>Customer</th><th>Plan</th><th>Status</th><th>Slot</th><th>Next billing</th><th>Price / 4 wks</th></tr></thead>
            <tbody>{s.subscriptions.map((x) => <tr key={x.id}><td>{x.customer_name} <span className="muted small">{x.customer_code}</span></td><td>{x.planName}</td><td><span className={`badge sub-${x.status}`}>{x.status}</span></td><td>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][x.day_of_week]} {win(x.window_id)}</td><td>{x.status === 'active' ? fmtDate(x.next_billing_date) : '—'}</td><td>{money(x.price_cents)} + HST</td></tr>)}</tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <h2>Demo tools</h2>
        <button className="btn danger ghost" onClick={reset} data-testid="reset-demo">Reset demo data</button> {msg && <span className="muted">{msg}</span>}
      </section>
    </div>
  );
}
