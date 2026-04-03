-- Payee master list (entries and rules reference by id)
CREATE TABLE payees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    shortcut_slot INTEGER CHECK (shortcut_slot IS NULL OR (shortcut_slot >= 1 AND shortcut_slot <= 9)),
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_payees_sort ON payees(sort_order);

CREATE UNIQUE INDEX idx_payees_shortcut_unique ON payees(shortcut_slot)
WHERE shortcut_slot IS NOT NULL;

-- Seed from existing string payees on entries and rules
INSERT INTO payees (name, sort_order)
SELECT name, (ROW_NUMBER() OVER (ORDER BY name) - 1)
FROM (
    SELECT DISTINCT trim(payee) AS name FROM entries
    WHERE payee IS NOT NULL AND trim(payee) != ''
    UNION
    SELECT DISTINCT trim(payee) AS name FROM rules
    WHERE payee IS NOT NULL AND trim(payee) != ''
);

ALTER TABLE entries ADD COLUMN payee_id INTEGER REFERENCES payees(id) ON DELETE SET NULL;

UPDATE entries
SET payee_id = (SELECT id FROM payees WHERE payees.name = trim(entries.payee))
WHERE payee IS NOT NULL AND trim(payee) != '';

CREATE TABLE rules_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    format TEXT NOT NULL CHECK (format IN ('amex', 'yonder')),
    merchant_key TEXT NOT NULL,
    merchant_exact TEXT NOT NULL,
    payee_id INTEGER NOT NULL REFERENCES payees(id) ON DELETE RESTRICT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(format, merchant_key)
);

INSERT INTO rules_new (id, format, merchant_key, merchant_exact, payee_id, active, created_at, updated_at)
SELECT
    r.id,
    'amex',
    r.merchant_key,
    r.merchant_key,
    (SELECT id FROM payees WHERE payees.name = trim(r.payee)),
    r.active,
    r.created_at,
    r.updated_at
FROM rules r;

DROP TABLE rules;
ALTER TABLE rules_new RENAME TO rules;

CREATE INDEX idx_rules_format_key ON rules(format, merchant_key);

ALTER TABLE entries DROP COLUMN payee;

ALTER TABLE statements ADD COLUMN display_label TEXT;
