ALTER TABLE entries ADD COLUMN dedup_key TEXT;

CREATE UNIQUE INDEX idx_entries_dedup_key ON entries(dedup_key) WHERE dedup_key IS NOT NULL;
