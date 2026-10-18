import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Routes, Route, Navigate, NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { api, getUserId, setUserId } from './api.js';
import { BRAND } from '../../shared/config.js';
import { Logo } from './components.jsx';
import { Welcome, Signup } from './pages/auth.jsx';
import { CustomerHome, Book, Checkout, Orders, Plan, Preferences } from './pages/customer.jsx';
import { OrderDetail } from './pages/order.jsx';
import { DriverRoute } from './pages/driver.jsx';
import { OpsOrders, OpsOverview } from './pages/ops.jsx';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);
export const homeFor = (role) => ({ customer: '/home', driver: '/driver', admin: '/ops', partner: '/ops' }[role] || '/');

const NAV = {
  customer: [['/home', 'Home', '⌂'], ['/book', 'Book', '+'], ['/orders', 'Orders', '≡'], ['/plan', 'Plan', '↻'], ['/prefs', 'Prefs', '✎']],
  driver: [['/driver', 'Route', '➜']],
  admin: [['/ops', 'Orders', '≡'], ['/ops/overview', 'Overview', '▦'], ['/driver', 'Routes', '➜']],
  partner: [['/ops', 'Orders', '≡']],
};

export default function App() {
  const [meta, setMeta] = useState(null);
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();
  const loc = useLocation();

  const refreshMe = useCallback(async () => {
    if (!getUserId()) { setMe(null); return null; }
    try { const m = await api('/api/me'); setMe(m); return m; } catch { setUserId(null); setMe(null); return null; }
  }, []);
  useEffect(() => { document.title = `${BRAND.name} — laundry pickup & delivery (prototype)`; api('/api/meta').then(setMeta); refreshMe().finally(() => setLoading(false)); }, [refreshMe]);
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);

  const login = async (id) => { setUserId(id); const m = await refreshMe(); nav(homeFor(m?.user.role)); };
  const logout = () => { setUserId(null); setMe(null); nav('/'); };

  if (loading || !meta) return <div className="center pad">Loading…</div>;
  const role = me?.user.role;
  const wide = role === 'admin' || role === 'partner';
  const guard = (roles, el) => (!me ? <Navigate to="/" /> : roles.includes(role) ? el : <Navigate to={homeFor(role)} />);

  return (
    <Ctx.Provider value={{ meta, me, refreshMe, login, logout }}>
      <div className={`app ${wide ? 'wide' : ''} ${me ? 'authed' : ''}`}>
        <header className="topbar">
          <Link to={me ? homeFor(role) : '/'} className="brand"><Logo size={30} /></Link>
          {me && <nav className="topnav">{NAV[role].map(([to, label]) => <NavLink key={to} to={to} end>{label}</NavLink>)}</nav>}
          {me ? (
            <button className="userchip" onClick={logout} title="Switch demo user">
              <span className={`role role-${role}`}>{role}</span><span className="uname">{me.user.name.split(' ')[0]}</span><span className="switch">Switch</span>
            </button>
          ) : <span className="proto-tag">Prototype</span>}
        </header>
        <main className="main">
          <Routes>
            <Route path="/" element={me ? <Navigate to={homeFor(role)} /> : <Welcome />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/home" element={guard(['customer'], <CustomerHome />)} />
            <Route path="/book" element={guard(['customer'], <Book />)} />
            <Route path="/checkout/:ref" element={guard(['customer'], <Checkout />)} />
            <Route path="/orders" element={guard(['customer'], <Orders />)} />
            <Route path="/orders/:id" element={guard(['customer', 'driver', 'admin', 'partner'], <OrderDetail />)} />
            <Route path="/plan" element={guard(['customer'], <Plan />)} />
            <Route path="/prefs" element={guard(['customer'], <Preferences />)} />
            <Route path="/driver" element={guard(['driver', 'admin'], <DriverRoute />)} />
            <Route path="/ops" element={guard(['admin', 'partner'], <OpsOrders />)} />
            <Route path="/ops/overview" element={guard(['admin'], <OpsOverview />)} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
          <footer className="foot">{BRAND.name} prototype · {meta.zone.name} pilot · Payments: <b>{meta.paymentsMode === 'mock' ? 'mock (test mode, no charges)' : 'Stripe TEST mode'}</b></footer>
        </main>
        {me && NAV[role].length > 1 && (
          <nav className="bottomnav">{NAV[role].map(([to, label, icon]) => <NavLink key={to} to={to} end><span className="ico">{icon}</span>{label}</NavLink>)}</nav>
        )}
      </div>
    </Ctx.Provider>
  );
}
