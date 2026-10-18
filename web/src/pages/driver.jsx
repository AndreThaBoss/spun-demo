import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { fmtDate, addDays, isServiceDay } from '../../../shared/logic.js';
import { StatusBadge, Flags, PrefsList, ErrorMsg, win, extrasText } from '../components.jsx';
import { useOrderActions } from './order.jsx';

function Stop({ stop, onChange, isAdmin }) {
  const [o, setO] = useState(stop.order);
  const [open, setOpen] = useState(!stop.done);
  const { busy, err, advance, upload } = useOrderActions((x) => { setO(x); onChange(); });
  const stage = stop.kind === 'pickup' ? 'pickup' : 'delivery';
  const photo = [...o.photos].reverse().find((p) => p.stage === stage);
  const done = stop.kind === 'pickup' ? o.status !== 'scheduled' : o.status === 'delivered';
  const target = stop.kind === 'pickup' ? 'picked_up' : 'delivered';
  const canAct = stop.kind === 'pickup' ? o.status === 'scheduled' : o.status === 'ready';
  return (
    <li className={`card stop ${done ? 'done' : ''} kind-${stop.kind}`} data-testid={`stop-${o.code}-${stop.kind}`}>
      <button className="stop-head" onClick={() => setOpen(!open)}>
        <span className="seq">{done ? '✓' : stop.seq}</span>
        <span className="stop-main">
          <span className="row-between"><b>{o.customer.name}</b><span className={`kind ${stop.kind}`}>{stop.kind === 'pickup' ? 'PICKUP' : 'DELIVERY'}</span></span>
          <span className="addr">{o.address}</span>
          <span className="muted small">{win(stop.window)} · {o.bagCount} bag{o.bagCount > 1 ? 's' : ''} {extrasText(o) && `· ${extrasText(o)}`}</span>
          <Flags prefs={o.prefs} />
        </span>
      </button>
      {open && (
        <div className="stop-body">
          <div className="row-between"><span className="muted small">#{o.code} · tags {o.bagTags.join(', ')}</span><StatusBadge status={o.status} /></div>
          {o.prefs.buildingAccess && <div className="alert info small">🏢 {o.prefs.buildingAccess}</div>}
          {o.prefs.notes && <div className="alert info small">📝 {o.prefs.notes}</div>}
          <details><summary>Laundry preferences</summary><PrefsList prefs={o.prefs} compact /></details>
          {stop.kind === 'delivery' && o.status === 'at_laundromat' && <div className="alert warn small">Not ready yet at the laundromat — collect when partner marks it Ready.</div>}
          <div className="photo-row">
            {photo ? <img src={photo.url} alt={`${stage} photo`} className="thumb" /> : <div className="thumb ph">📷</div>}
            <div className="stack-sm">
              <b>Photo {stage === 'pickup' ? '1: sealed bag + tag' : '4: bag at door/concierge'}</b>
              {(canAct || isAdmin) && (
                <label className="btn ghost">{busy === stage ? 'Uploading…' : photo ? 'Retake photo' : 'Take photo'}
                  <input type="file" accept="image/*" capture="environment" hidden data-testid={`photo-${o.code}-${stage}`} onChange={(e) => e.target.files[0] && upload(o, stage, e.target.files[0])} />
                </label>
              )}
            </div>
          </div>
          <div className="row gap wrap">
            {canAct && <button className="btn primary big" disabled={!!busy || !photo} onClick={() => advance(o, target)} data-testid={`mark-${o.code}-${target}`}>{stop.kind === 'pickup' ? 'Mark picked up' : 'Mark delivered'}</button>}
            {stop.kind === 'pickup' && o.status === 'picked_up' && <button className="btn ghost" disabled={!!busy} onClick={() => advance(o, 'at_laundromat')} data-testid={`drop-${o.code}`}>Dropped at laundromat</button>}
            <Link to={`/orders/${o.id}`} className="btn ghost">Details</Link>
          </div>
          {canAct && !photo && <p className="fine">Photo required before marking {stop.kind === 'pickup' ? 'picked up' : 'delivered'}.</p>}
          <ErrorMsg error={err} />
        </div>
      )}
    </li>
  );
}

export function DriverRoute() {
  const { meta, me } = useApp();
  const [date, setDate] = useState(meta.routeDay);
  const [data, setData] = useState(null);
  const [tick, setTick] = useState(0);
  const [drivers, setDrivers] = useState([]);
  const [driverId, setDriverId] = useState('');
  const isAdmin = me.user.role === 'admin';
  useEffect(() => { if (isAdmin) api('/api/drivers').then(setDrivers); }, []);
  useEffect(() => { api(`/api/driver/route?date=${date}${driverId ? `&driverId=${driverId}` : ''}`).then(setData); }, [date, tick, driverId]);
  const shift = (n) => { let d = addDays(date, n); while (!isServiceDay(d)) d = addDays(d, n); setDate(d); };
  const stops = data?.stops || [];
  const remaining = stops.filter((s) => !s.done).length;
  return (
    <div className="stack driver">
      <div className="row-between">
        <button className="btn ghost small" onClick={() => shift(-1)} aria-label="Previous day">‹</button>
        <div className="center-text"><h1>{date === meta.today ? "Today's route" : 'Route'}</h1><div className="muted">{fmtDate(date, { weekday: 'long', month: 'long', day: 'numeric' })}</div></div>
        <button className="btn ghost small" onClick={() => shift(1)} aria-label="Next day">›</button>
      </div>
      {meta.today !== meta.routeDay && date === meta.routeDay && <div className="alert info small">Today ({fmtDate(meta.today)}) is Sunday — closed. Showing the next service day.</div>}
      {isAdmin && <label className="inline">Driver <select value={driverId} onChange={(e) => setDriverId(e.target.value)}><option value="">All drivers</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
      <div className="route-stats card">
        <div><b>{stops.length}</b><small>stops</small></div>
        <div><b>{stops.filter((s) => s.kind === 'pickup').length}</b><small>pickups</small></div>
        <div><b>{stops.filter((s) => s.kind === 'delivery').length}</b><small>deliveries</small></div>
        <div><b>{remaining}</b><small>left</small></div>
      </div>
      {data?.partner && <div className="muted small">Partner drop / collect (mid-day run): <b>{data.partner.name}</b>, {data.partner.address}</div>}
      {data === null ? <p className="muted">Loading…</p> : stops.length === 0 ? <p className="muted card">No stops on this day.</p> : (
        <ol className="stops">{stops.map((s) => <Stop key={`${s.order.id}-${s.kind}-${date}`} stop={s} isAdmin={isAdmin} onChange={() => setTick((t) => t + 1)} />)}</ol>
      )}
    </div>
  );
}
