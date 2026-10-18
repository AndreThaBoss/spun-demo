// Tiny SQLite wrapper using sql.js (pure WebAssembly — no native build step).
// The database lives in memory and is written to data/spun.db after every write.
import initSqlJs from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'spun.db');
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');

const SQL = await initSqlJs();
let db;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('customer','driver','admin','partner')),
  name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, phone TEXT,
  customer_code TEXT, address_line TEXT, unit TEXT, city TEXT, postal_code TEXT,
  photo_consent INTEGER DEFAULT 0, partner_id INTEGER, listed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, address TEXT, hours TEXT
);
CREATE TABLE IF NOT EXISTS preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id), data TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL REFERENCES users(id),
  plan TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','cancelled')),
  day_of_week INTEGER NOT NULL, window_id TEXT NOT NULL,
  start_date TEXT NOT NULL, next_billing_date TEXT NOT NULL, price_lock_until TEXT,
  price_cents INTEGER NOT NULL, payment_ref TEXT,
  created_at TEXT DEFAULT (datetime('now')), paused_at TEXT, cancelled_at TEXT
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES users(id), partner_id INTEGER, driver_id INTEGER,
  subscription_id INTEGER, tier TEXT NOT NULL, bag_count INTEGER NOT NULL,
  extra_bags INTEGER DEFAULT 0, hang_dry_count INTEGER DEFAULT 0, same_day INTEGER DEFAULT 0,
  comforters TEXT DEFAULT '{}',
  pickup_date TEXT NOT NULL, pickup_window TEXT NOT NULL,
  delivery_date TEXT NOT NULL, delivery_window TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled', prefs TEXT NOT NULL, address TEXT NOT NULL,
  line_items TEXT NOT NULL, subtotal_cents INTEGER, discount_cents INTEGER, hst_cents INTEGER, total_cents INTEGER,
  payment_status TEXT DEFAULT 'unpaid', payment_ref TEXT, route_seq INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, status TEXT NOT NULL,
  at TEXT NOT NULL, by_user_id INTEGER, note TEXT
);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('pickup','intake','delivery')),
  path TEXT NOT NULL, uploaded_by INTEGER, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL, ref TEXT NOT NULL,
  kind TEXT NOT NULL, amount_cents INTEGER NOT NULL, status TEXT NOT NULL,
  customer_id INTEGER, order_id INTEGER, subscription_id INTEGER, payload TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT, postal_code TEXT, address TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`;

export function open({ fresh = false } = {}) {
  if (!fresh && fs.existsSync(DB_PATH)) db = new SQL.Database(fs.readFileSync(DB_PATH));
  else db = new SQL.Database();
  db.exec(SCHEMA);
  return db;
}
export function save() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}
export function all(sql, params = []) {
  const st = db.prepare(sql);
  st.bind(params);
  const rows = [];
  while (st.step()) rows.push(st.getAsObject());
  st.free();
  return rows;
}
export const get = (sql, params = []) => all(sql, params)[0];
export function run(sql, params = [], { persist = true } = {}) {
  db.run(sql, params);
  const id = db.exec('SELECT last_insert_rowid() AS id')[0]?.values[0][0];
  if (persist) save();
  return id;
}
export const dbExists = () => fs.existsSync(DB_PATH);
