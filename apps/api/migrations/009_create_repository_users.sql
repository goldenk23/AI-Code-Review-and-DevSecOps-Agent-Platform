-- Map each repository to users whose OAuth token can access it. A repository
-- may be shared by several users; the most recently refreshed link is used.
CREATE TABLE IF NOT EXISTS repository_users (
    repo_id    BIGINT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    linked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (repo_id, user_id)
);

-- Backfill personal repositories for existing installations. Organization and
-- collaborator repositories are linked on the user's next OAuth login.
INSERT INTO repository_users (repo_id, user_id)
SELECT r.id, u.id
FROM repositories r
JOIN users u ON lower(u.username) = lower(r.owner)
ON CONFLICT (repo_id, user_id) DO NOTHING;
