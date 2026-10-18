import React, { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp, homeFor } from '../App.jsx';
import { STATUS_LABEL } from '../../../shared/config.js';
import { money } from '../../../shared/logic.js';
import { StatusBadge, Progress, PrefsList, Flags, PhotoSlots, ErrorMsg, when, fmtTime, orderTitle, extrasText } from '../components.jsx';

// Actions each role can take from each status (mirrors server TRANSITIONS)
export const ACTIONS = {
  driver: { scheduled: [['picked_up', 'Mark picked up']], picked_up: [['at_laundromat', 'Dropped at laundromat']], ready: [['delivered', 'Mark delivered']] },
  partner: { picked_up: [['at_laundromat', 'Received at laundromat']], at_laundromat: [['ready', 'Mark ready']] },
  admin: { scheduled: [['picked_up', 'Mark picked up'], ['cancelled', 'Cancel order']], picked_up: [['at_laundromat', 'Mark at laundromat']], at_laundromat: [['ready', 'Mark ready']], ready: [['delivered', 'Mark delivered']] },
  customer: { scheduled: [['cancelled', 'Cancel pickup']] },
};
export const UPLOAD_STAGES = { driver: ['pickup', 'delivery'], partner: ['intake'], admin: ['pickup', 'intake', 'delivery'], customer: [] };

export function useOrderActions(setOrder) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const advance = async (o, status) => {
    if (status === 'cancelled' && !window.confirm('Cancel this order?')) return;
    setErr(''); setBusy(status);
    try { setOrder(await api(`/api/orders/${o.id}/status`, { method: 'POST', body: { status } })); } catch (x) { setErr(x.message); } finally { setBusy(''); }
  };
  const upload = async (o, stage, file) => {
    setErr(''); setBusy(stage);
    const form = new FormData(); form.append('stage', stage); form.append('photo', file);
    try { setOrder(await api(`/api/orders/${o.id}/photos`, { method: 'POST', form })); } catch (x) { setErr(x.message); } finally { setBusy(''); }
  };
  return { busy, err, advance, upload };
}

export function OrderDetail() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const { me } = useApp();
  const nav = useNavigate();
  const role = me.user.role;
  const [o, setO] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [loadErr, setLoadErr] = useState('');
  const { busy, err, advance, upload } = useOrderActions(setO);
  useEffect(() => { api(`/api/orders/${id}`).then(setO).catch((e) => setLoadErr(e.message)); if (role === 'admin') api('/api/drivers').then(setDrivers); }, [id]);
  if (loadErr) return <div className="card narrow"><ErrorMsg error={loadErr} /><Link to={homeFor(role)}>Back</Link></div>;
  if (!o) return <p className="muted pad">Loading…</p>;
  const assign = async (driverId) => setO(await api(`/api/orders/${o.id}/assign`, { method: 'POST', body: { driverId } }));
  const actions = ACTIONS[role]?.[o.status] || [];

  return (
    <div className="stack order-detail" data-testid="order-detail">
      <button className="back" onClick={() => nav(-1)}>← Back</button>
      {sp.get('paid') && <div className="alert ok" data-testid="paid-banner">✓ Booked and paid (mock test payment {o.paymentRef}). We'll text you when your bag is picked up.</div>}
      <div className="row-between"><div><h1>{orderTitle(o)}</h1><div className="muted">Order #{o.code}{role !== 'customer' && <> · {o.customer.name ? `${o.customer.name} (${o.customer.customerCode})` : `Customer ${o.customer.customerCode}`}</>}</div></div><StatusBadge status={o.status} /></div>
      <Progress status={o.status} />

      {(actions.length > 0 || role === 'admin') && (
        <section className="card actions">
          {actions.map(([st, label]) => <button key={st} className={`btn ${st === 'cancelled' ? 'danger ghost' : 'primary'}`} disabled={!!busy} onClick={() => advance(o, st)} data-testid={`action-${st}`}>{busy === st ? 'Saving…' : label}</button>)}
          {role === 'admin' && (
            <label className="inline">Driver
              <select value={o.driver?.id || ''} onChange={(e) => assign(e.target.value)} data-testid="assign-driver"><option value="">Unassigned</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
            </label>
          )}
          <ErrorMsg error={err} />
        </section>
      )}

      <section className="card">
        <h2>Photos</h2>
        <PhotoSlots photos={o.photos} busy={busy} onUpload={(stage, f) => upload(o, stage, f)} canUpload={(s) => UPLOAD_STAGES[role]?.includes(s) && o.status !== 'cancelled'} />
      </section>

      <div className="grid2 top">
        <section className="card">
          <h2>Details</h2>
          <dl className="kv">
            <dt>Pickup</dt><dd>{when(o.pickupDate, o.pickupWindow)}</dd>
            <dt>Delivery</dt><dd>{when(o.deliveryDate, o.deliveryWindow)}{o.sameDay ? ' (same-day)' : ''}</dd>
            {o.address && <><dt>Address</dt><dd>{o.address}</dd></>}
            <dt>Bags</dt><dd>{o.bagCount} · tags {o.bagTags.join(', ')}</dd>
            {extrasText(o) && <><dt>Extras</dt><dd>{extrasText(o)}</dd></>}
            <dt>Driver</dt><dd>{o.driver?.name || 'Unassigned'}</dd>
            {o.customer.phone && role !== 'customer' && <><dt>Phone</dt><dd>{o.customer.phone}</dd></>}
          </dl>
        </section>
        <section className="card">
          <h2>Timeline</h2>
          <ol className="timeline" data-testid="timeline">
            {o.events.map((e, i) => (
              <li key={i} className={`st-${e.status}`}><b>{STATUS_LABEL[e.status]}</b><small>{fmtTime(e.at)}{e.by_name ? ` · ${e.by_name}` : ''}</small>{e.note && <span className="note">{e.note}</span>}</li>
            ))}
          </ol>
        </section>
      </div>

      <section className="card">
        <h2>Preferences for this order <Flags prefs={o.prefs} /></h2>
        <PrefsList prefs={o.prefs} />
      </section>

      {o.lineItems && (
        <section className="card">
          <h2>Payment</h2>
          <div className="price">
            {o.lineItems.map((l, i) => <div key={i} className={`row ${l.cents < 0 ? 'disc' : ''}`}><span>{l.label}</span><span>{money(l.cents)}</span></div>)}
            <div className="row"><span>HST (13%)</span><span>{money(o.hstCents)}</span></div>
            <div className="row total"><span>Total</span><span>{money(o.totalCents)} CAD</span></div>
          </div>
          <p className="fine">Status: {o.paymentStatus === 'plan' ? 'covered by plan' : o.paymentStatus} {o.paymentRef ? `· ref ${o.paymentRef}` : ''} (mock / test mode)</p>
        </section>
      )}
    </div>
  );
}
