-- Analysis jobs table: individual steps within a run
CREATE TABLE IF NOT EXISTS analysis_jobs (
    id           BIGSERIAL PRIMARY KEY,
    run_id       BIGINT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    job_type     VARCHAR(30) NOT NULL,
    status       VARCHAR(20) NOT NULL DEFAULT 'queued',
    attempts     INTEGER NOT NULL DEFAULT 0,
    exit_code    INTEGER,
    logs         TEXT,
    started_at   TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);