-- Add suggested_patch column for AI findings + widen verification_status
-- to admit the two new patch-verification states ('verified_by_test',
-- 'failed_verification'). The existing column is just VARCHAR(30) with no
-- CHECK constraint, so new values are accepted automatically -- we only
-- need to add the column for the suggestion itself.
ALTER TABLE findings
    ADD COLUMN IF NOT EXISTS suggested_patch TEXT;