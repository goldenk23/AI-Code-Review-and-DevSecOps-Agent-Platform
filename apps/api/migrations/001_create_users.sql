-- Users table: people who log in via GitHub OAuth
CREATE TABLE IF NOT EXISTS users (
    id                   BIGSERIAL PRIMARY KEY,
    github_id            BIGINT NOT NULL UNIQUE,
    username             VARCHAR(255) NOT NULL,
    oauth_token_encrypted TEXT NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);