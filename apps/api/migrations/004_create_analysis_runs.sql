-- Analysis runs table: one full review pass over a PR
CREATE TABLE IF NOT EXISTS analysis_runs (
    id           BIGSERIAL PRIMARY KEY,
    repo_id      BIGINT NOT NULL REFERENCES repositories(id),
    pr_id        BIGINT NOT NULL REFERENCES pull_requests(id),
    status       VARCHAR(20) NOT NULL DEFAULT 'queued',
    trigger      VARCHAR(20) NOT NULL,
    commit_sha   VARCHAR(40) NOT NULL,
    started_at   TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(repo_id, pr_id, commit_sha)
);