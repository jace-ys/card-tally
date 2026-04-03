-- Statement sources
CREATE TABLE statements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    format TEXT NOT NULL CHECK (format IN ('amex', 'yonder')),
    source_filename TEXT,
    imported_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_statements_format ON statements(format);

-- Ledger lines
CREATE TABLE entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    statement_id INTEGER NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
    txn_date TEXT NOT NULL,
    merchant_raw TEXT NOT NULL,
    merchant_key TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    payee TEXT,
    lifecycle TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'deferred', 'paid_archived')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_entries_statement ON entries(statement_id);
CREATE INDEX idx_entries_lifecycle ON entries(statement_id, lifecycle);

-- One row per normalized merchant key (case-insensitive key stored as lowercase)
-- Exactly one row per normalized merchant_key; `active` toggles application without duplicate keys.
CREATE TABLE rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant_key TEXT NOT NULL UNIQUE,
    payee TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-format anchor for "where to resume" next month (basic fields)
CREATE TABLE import_cursors (
    format TEXT PRIMARY KEY CHECK (format IN ('amex', 'yonder')),
    last_anchor_date TEXT,
    last_anchor_merchant_key TEXT,
    last_anchor_amount_cents INTEGER,
    last_statement_id INTEGER REFERENCES statements(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
