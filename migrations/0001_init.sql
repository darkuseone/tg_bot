CREATE TABLE users (
  user_id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  source TEXT
);

CREATE TABLE purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  product TEXT NOT NULL,
  charge_id TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL,
  purchased_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  refunded INTEGER NOT NULL DEFAULT 0,
  delivered INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX idx_one_active_purchase
  ON purchases (user_id, product)
  WHERE refunded = 0;

CREATE TABLE charge_log (
  charge_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  product TEXT,
  amount INTEGER NOT NULL,
  payload TEXT NOT NULL,
  outcome TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE product_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  file_id TEXT NOT NULL,
  file_name TEXT,
  caption TEXT,
  kind TEXT NOT NULL
);

CREATE INDEX idx_product_files_product ON product_files (product, sort_order);

CREATE TABLE media_files (
  slot TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  user_id INTEGER PRIMARY KEY,
  state TEXT NOT NULL,
  data TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE broadcasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE broadcast_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  broadcast_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  leased_at TEXT,
  last_error TEXT,
  UNIQUE (broadcast_id, user_id)
);

CREATE INDEX idx_broadcast_pending ON broadcast_recipients (status, id);
