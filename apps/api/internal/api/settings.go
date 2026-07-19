package api

import (
	"encoding/json"
	"net/http"
)

// Settings holds the Automation page's review-pipeline configuration.
// The row is a singleton (id=1); GET returns it, PUT upserts it.
//
// Schema (migration 007):
//   - pr_webhooks_enabled      bool   default true
//   - scheduled_scans_enabled  bool   default false
//   - block_on_high            bool   default true
//   - require_critical_verified bool  default true
//   - ai_verbosity             int    1..3   default 2  (concise/balanced/detailed)
//   - ai_strictness            int    1..4   default 3  (permissive..pedantic)
//
// The defaults intentionally match what the worker's hardcoded behaviour
// already is (PR webhooks on, no scheduled scans, fed-up gates), so this
// endpoint going live is a no-op for existing deployments.

const settingsID = 1

// GetSettings returns the singleton settings row. If the row is missing
// (e.g. fresh database where migration 007 ran but no PUT has happened),
// we synthesize the default values on the fly so the Automation page
// still renders correctly.
func (h *Handlers) GetSettings(w http.ResponseWriter, r *http.Request) {
	var (
		prWebhooks, scheduled, blockHigh, requireCritVerified bool
		verbosity, strictness                                  int
	)
	err := h.DB.QueryRow(r.Context(), `
		SELECT pr_webhooks_enabled, scheduled_scans_enabled,
		       block_on_high, require_critical_verified,
		       ai_verbosity, ai_strictness
		FROM settings WHERE id = $1
	`, settingsID).Scan(&prWebhooks, &scheduled, &blockHigh, &requireCritVerified,
		&verbosity, &strictness)

	resp := map[string]interface{}{
		// defaults
		"pr_webhooks_enabled":      true,
		"scheduled_scans_enabled":  false,
		"block_on_high":            true,
		"require_critical_verified": true,
		"ai_verbosity":             2,
		"ai_strictness":            3,
	}
	if err == nil {
		resp["pr_webhooks_enabled"] = prWebhooks
		resp["scheduled_scans_enabled"] = scheduled
		resp["block_on_high"] = blockHigh
		resp["require_critical_verified"] = requireCritVerified
		resp["ai_verbosity"] = verbosity
		resp["ai_strictness"] = strictness
	}
	// On err != nil we fall through with defaults -- the only error we
	// handle is "no rows", which is fine. Anything else (DB down) should
	// surface later on the PUT path.

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

type settingsBody struct {
	PrWebhooks              *bool `json:"pr_webhooks_enabled"`
	ScheduledScans          *bool `json:"scheduled_scans_enabled"`
	BlockOnHigh             *bool `json:"block_on_high"`
	RequireCriticalVerified *bool `json:"require_critical_verified"`
	AIVerbosity             *int  `json:"ai_verbosity"`
	AIStrictness            *int  `json:"ai_strictness"`
}

// UpdateSettings upserts the singleton settings row. Only fields the
// client sends are updated -- nil-pointers in settingsBody mean "leave
// alone". This is a partial-update pattern familiar to anyone who's
// used PATCH-style PUTs.
//
// We use ON CONFLICT to keep this idempotent: the row exists (inserted
// by migration 007) so the conflict path is the common one; the INSERT
// path handles a fresh database where the migration was skipped.
func (h *Handlers) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	var b settingsBody
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	// Read current values so we can fall back to them for omitted fields.
	var (
		prWebhooks, scheduled, blockHigh, requireCritVerified bool
		verbosity, strictness                                  int
	)
	err := h.DB.QueryRow(r.Context(), `
		SELECT pr_webhooks_enabled, scheduled_scans_enabled,
		       block_on_high, require_critical_verified,
		       ai_verbosity, ai_strictness
		FROM settings WHERE id = $1
	`, settingsID).Scan(&prWebhooks, &scheduled, &blockHigh, &requireCritVerified,
		&verbosity, &strictness)
	if err != nil {
		// Row missing -- use code defaults until the INSERT below fills it.
		prWebhooks, scheduled, blockHigh, requireCritVerified = true, false, true, true
		verbosity, strictness = 2, 3
	}

	if b.PrWebhooks != nil {
		prWebhooks = *b.PrWebhooks
	}
	if b.ScheduledScans != nil {
		scheduled = *b.ScheduledScans
	}
	if b.BlockOnHigh != nil {
		blockHigh = *b.BlockOnHigh
	}
	if b.RequireCriticalVerified != nil {
		requireCritVerified = *b.RequireCriticalVerified
	}
	if b.AIVerbosity != nil {
		verbosity = clamp(*b.AIVerbosity, 1, 3)
	}
	if b.AIStrictness != nil {
		strictness = clamp(*b.AIStrictness, 1, 4)
	}

	_, err = h.DB.Exec(r.Context(), `
		INSERT INTO settings (id, pr_webhooks_enabled, scheduled_scans_enabled,
		                      block_on_high, require_critical_verified,
		                      ai_verbosity, ai_strictness, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, now())
		ON CONFLICT (id) DO UPDATE SET
			pr_webhooks_enabled       = EXCLUDED.pr_webhooks_enabled,
			scheduled_scans_enabled   = EXCLUDED.scheduled_scans_enabled,
			block_on_high             = EXCLUDED.block_on_high,
			require_critical_verified = EXCLUDED.require_critical_verified,
			ai_verbosity              = EXCLUDED.ai_verbosity,
			ai_strictness             = EXCLUDED.ai_strictness,
			updated_at                = now()
	`, settingsID, prWebhooks, scheduled, blockHigh, requireCritVerified,
		verbosity, strictness)
	if err != nil {
		http.Error(w, "failed to save settings", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"pr_webhooks_enabled":       prWebhooks,
		"scheduled_scans_enabled":   scheduled,
		"block_on_high":             blockHigh,
		"require_critical_verified": requireCritVerified,
		"ai_verbosity":              verbosity,
		"ai_strictness":             strictness,
	})
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}