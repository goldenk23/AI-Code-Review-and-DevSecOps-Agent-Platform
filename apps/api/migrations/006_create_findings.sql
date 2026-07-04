-- Findings table: the actual review comments (bugs, security issues)
CREATE TABLE IF NOT EXISTS findings (
    id                  BIGSERIAL PRIMARY KEY,
    run_id              BIGINT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    file_path           VARCHAR(500) NOT NULL,
    line_start          INTEGER,
    line_end            INTEGER,
    severity            VARCHAR(10) NOT NULL,
    category            VARCHAR(30) NOT NULL,
    title               VARCHAR(255) NOT NULL,
    description         TEXT NOT NULL,
    evidence            TEXT,
    confidence          NUMERIC(3,2),
    verification_status VARCHAR(30) NOT NULL DEFAULT 'unverified',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);