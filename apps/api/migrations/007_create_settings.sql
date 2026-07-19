-- Settings table -- singleton row backing the Automation page.
-- id is fixed at 1 so PUT /api/settings can ON CONFLICT upsert predictably.
-- Defaults mirror the worker's existing hardcoded behavior so the
-- page going live is a no-op for current deployments.
CREATE TABLE IF NOT EXISTS settings (
    id                          INTEGER PRIMARY KEY DEFAULT 1,
    pr_webhooks_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
    scheduled_scans_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
    block_on_high              BOOLEAN NOT NULL DEFAULT TRUE,
    require_critical_verified  BOOLEAN NOT NULL DEFAULT TRUE,
    ai_verbosity               INTEGER NOT NULL DEFAULT 2 CHECK (ai_verbosity BETWEEN 1 AND 3),
    ai_strictness              INTEGER NOT NULL DEFAULT 3 CHECK (ai_strictness BETWEEN 1 AND 4),
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT singleton_settings CHECK (id = 1)
);

-- Seed the single row with defaults so GET /api/settings always succeeds.
INSERT INTO settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;