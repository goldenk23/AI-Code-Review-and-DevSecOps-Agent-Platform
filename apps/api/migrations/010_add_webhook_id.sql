-- Add webhook_id to repositories so we can delete the hook on disconnect.
-- Also add a unique index on full_name so ConnectRepository can upsert by name.
ALTER TABLE repositories
  ADD COLUMN IF NOT EXISTS webhook_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS repositories_full_name_key
  ON repositories (full_name);
