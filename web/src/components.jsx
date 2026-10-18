import React from 'react';
import { BRAND, STATUSES, STATUS_LABEL, TIERS, PLANS, ADDONS } from '../../shared/config.js';
import { money, fmtDate, windowById, prefFlags } from '../../shared/logic.js';

export function Logo({ size = 32, light = false }) {
  const navy = light ? '#fff' : BRAND.colors.primary;
  return (
    <span className="logo" style={{ height: size }}>
      <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden="true">
        <circle cx="60" cy="60" r="50" fill="none" stroke={navy} strokeWidth="12" />
        <circle cx="60" cy="60" r="30" fill={BRAND.colors.accent} />
        <path d="M43 64 Q53 46 65 60 T83 56" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" />
      </svg>
      <span className="wordmark" style={{ fontSize: size * 0.95, color: navy }}>{BRAND.wordmark}</span>
    </span>
  );
}

export const StatusBadge = ({ status }) => <span className={`badge st-${status}`}>{STATUS_LABEL[status] || status}</span>;
export const win = (id) => windowById(id)?.label || id;
export const when = (date, windowId) => `${fmtDate(date)} · ${win(windowId)}`;
export const fmtTime = (iso) => new Date(iso).toLocaleString('en-CA', { timeZone: 'America/Toronto', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function Progress({ status }) {
  if (status === 'cancelled') return <div className="progress cancelled">Cancelled</div>;
  const idx = STATUSES.findIndex((s) => s.id === status);
  return (
    <ol className="progress">
      {STATUSES.map((s, i) => <li key={s.id} className={i < idx ? 'done' : i === idx ? 'current' : ''}><span className="dot" /><span className="lbl">{s.label}</span></li>)}
    </ol>
  );
}

export function PriceSummary({ quote, note = true, perLabel }) {
  if (!quote) return null;
  return (
    <div className="price">
      {quote.lines.map((l, i) => <div key={i} className={`row ${l.cents < 0 ? 'disc' : ''}`}><span>{l.label}</span><span>{money(l.cents)}</span></div>)}
      <div className="row sub"><span>Subtotal</span><span>{money(quote.subtotalCents - (quote.discountCents || 0))}</span></div>
      <div className="row"><span>HST (13%, Ontario)</span><span>{money(quote.hstCents)}</span></div>
      <div className="row total"><span>Total {perLabel || ''}</span><span>{money(quote.totalCents)} CAD</span></div>
      {note && <p className="fine">Prices are per bag, before 13% HST, with pickup and next-day delivery included (no delivery fee).</p>}
    </div>
  );
}

export function Flags({ prefs }) {
  const f = prefFlags(prefs);
  if (!f.length) return null;
  return <span className="flags">{f.map((x) => <span key={x.label} className={`flag ${x.color}`} title={x.label}>● {x.label}</span>)}</span>;
}

export function PrefsList({ prefs, compact = false }) {
  if (!prefs) return null;
  const rows = [
    ['Detergent', prefs.detergent], ['Softener', prefs.softener], ['Bleach', prefs.bleach], ['Wash temp', prefs.washTemp],
    ['Dryer heat', prefs.dryerHeat], ['Hang-dry', [prefs.hangDryItems, prefs.hangDryActivewear && 'all activewear/elastane'].filter(Boolean).join('; ') || '—'],
    ['Folding', prefs.folding], ['Sort', prefs.sort], ['Kids separate', prefs.separateKids ? 'Yes' : 'No'],
    ['Allergies', prefs.allergies || '—'], ['Building access', prefs.buildingAccess || '—'], ['Notes', prefs.notes || '—'],
  ];
  const shown = compact ? rows.filter(([k, v]) => !['Kids separate', 'Sort', 'Bleach', 'Wash temp'].includes(k) || (v && !['No', 'None', 'Cold', 'Lights/darks/towels separated'].includes(v))) : rows;
  return (
    <dl className={`prefs ${compact ? 'compact' : ''}`}>
      {shown.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd className={k === 'Allergies' && v !== '—' ? 'allergy' : ''}>{v}</dd></React.Fragment>)}
    </dl>
  );
}

export const PHOTO_STAGES = [
  { id: 'pickup', label: 'Pickup', hint: 'Sealed bag + tag at your door' },
  { id: 'intake', label: 'At laundromat', hint: 'Contents laid out at intake' },
  { id: 'delivery', label: 'Delivery', hint: 'Bag at door / concierge' },
];
export function PhotoSlots({ photos = [], onUpload, canUpload = () => false, busy }) {
  return (
    <div className="photos">
      {PHOTO_STAGES.map((s) => {
        const p = [...photos].reverse().find((x) => x.stage === s.id);
        return (
          <figure key={s.id} className={`slot ${p ? 'has' : 'empty'}`}>
            {p ? <a href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt={`${s.label} photo`} /></a>
              : <div className="ph"><span>📷</span><small>No photo yet</small></div>}
            <figcaption><b>{s.label}</b><small>{p ? fmtTime(p.at) : s.hint}</small></figcaption>
            {onUpload && canUpload(s.id) && (
              <label className="btn small ghost upl">{busy === s.id ? 'Uploading…' : p ? 'Retake' : 'Add photo'}
                <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files[0] && onUpload(s.id, e.target.files[0])} />
              </label>
            )}
          </figure>
        );
      })}
    </div>
  );
}

export const orderTitle = (o) => o.plan ? `${PLANS[o.plan]?.name} pickup` : `${TIERS[o.tier]?.name} · ${o.bagCount} bag${o.bagCount > 1 ? 's' : ''}`;
export const extrasText = (o) => [
  o.plan && o.extraBags ? `+${o.extraBags} extra bag` : null,
  o.hangDryCount ? `${o.hangDryCount} hang-dry` : null, o.sameDay ? 'Same-day' : null,
  ...Object.entries(o.comforters || {}).filter(([, q]) => q > 0).map(([k, q]) => `${q}× ${ADDONS.comforters[k]?.name}`),
].filter(Boolean).join(' · ');

export function Stepper({ value, onChange, min = 0, max = 20, label }) {
  return (
    <div className="stepper" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`less ${label}`}>−</button>
      <span>{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`more ${label}`}>+</button>
    </div>
  );
}

export const ErrorMsg = ({ error }) => (error ? <div className="alert error" role="alert">{error}</div> : null);
