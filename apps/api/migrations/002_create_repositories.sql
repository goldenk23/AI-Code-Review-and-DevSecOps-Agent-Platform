-- Repositories table: GitHub repos that users have added
CREATE TABLE IF NOT EXISTS repositories (
    id              BIGSERIAL PRIMARY KEY,
    github_repo_id  BIGINT NOT NULL UNIQUE,
    full_name       VARCHAR(255) NOT NULL,
    owner           VARCHAR(255) NOT NULL,
    webhook_id      VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);