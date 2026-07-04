-- Pull requests table: PRs we've seen webhooks for
CREATE TABLE IF NOT EXISTS pull_requests (
    id          BIGSERIAL PRIMARY KEY,
    repo_id     BIGINT NOT NULL REFERENCES repositories(id),
    pr_number   INTEGER NOT NULL,
    head_sha    VARCHAR(40) NOT NULL,
    author      VARCHAR(255) NOT NULL,
    title       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(repo_id, pr_number)
);