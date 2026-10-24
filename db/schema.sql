-- SQLite base schema. db.js adds integer-centavo snapshots and additive migrations.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
 phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
 password_hash TEXT NOT NULL, salt TEXT NOT NULL, created TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL, variety TEXT NOT NULL, weight INTEGER NOT NULL CHECK(weight > 0),
 price INTEGER NOT NULL CHECK(price > 0), stock INTEGER NOT NULL CHECK(stock >= 0), tag TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '', texture TEXT NOT NULL DEFAULT '',
 cooking TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
 image TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY, customer TEXT, phone TEXT, address TEXT,
 method TEXT, status TEXT, total INTEGER, created TEXT, items TEXT,
 user_id TEXT REFERENCES users(id), payment_method TEXT NOT NULL DEFAULT 'cash',
 payment_status TEXT NOT NULL DEFAULT 'Unpaid', delivery_fee INTEGER NOT NULL DEFAULT 0, dispatch_at TEXT
);
-- server.js also migrates earlier prototypes to this schema without discarding history.
CREATE TABLE IF NOT EXISTS order_items (
 id INTEGER PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
 product_id INTEGER NOT NULL REFERENCES products(id), name TEXT NOT NULL,
 weight INTEGER NOT NULL, price INTEGER NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0)
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id),
 role TEXT NOT NULL CHECK(role IN ('customer','admin')), expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS stock_movements (
 id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id),
 delta INTEGER NOT NULL, reason TEXT NOT NULL, created TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS order_events (
 id INTEGER PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
 status TEXT NOT NULL, created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS order_events_order ON order_events(order_id);
