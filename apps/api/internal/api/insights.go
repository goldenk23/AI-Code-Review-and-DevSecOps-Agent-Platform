package api

import (
	"encoding/json"
	"net/http"
	"strconv"
)

// Insights handlers compute aggregated DevSecOps metrics by joining
// repositories -> analysis_runs -> findings. They back the Repositories
// and Security dashboard pages.
//
// Conventions follow the existing handler.go list endpoints:
//   - JSON via map[string]interface{} with snake_case keys matching TS types
//   - ::text cast on every TIMESTAMPTZ so the API returns ISO-8601 strings
//   - nullable columns scanned into *T pointers -> JSON null
//   - empty list -> JSON null (the frontend's getList normalizes to [])
//
// `gradeForCounts` maps (critical, high, medium) counts to a letter grade
// the way an org dashboard would: A=clean, B=negligible, C=action required.
// It's intentionally a simple rubric -- a real product would use weighted
// formulas -- but it's deterministic and explains the intuition.
func gradeForCounts(critical, high, medium int) string {
	switch {
	case critical > 0:
		return "C"
	case high > 0:
		return "B"
	case medium > 0:
		return "B"
	default:
		return "A"
	}
}

// ListRepositories returns all repositories with per-repo aggregates:
// last scan time, total run count, and finding counts broken down by
// severity (for the bento card slot indicators + the grade letter).
//
// Joining repositories LEFT JOIN analysis_runs LEFT JOIN findings means
// repos that were added but never had a webhook fire still appear (with
// zero counts and a null last_scan_at). The findings join is scoped to
// the *latest* run per repo via a sub-select so we don't double-count
// findings from stale runs when a PR was re-scanned on a new commit.
func (h *Handlers) ListRepositories(w http.ResponseWriter, r *http.Request) {
	rows, err := h.DB.Query(r.Context(), `
		SELECT
			r.id,
			r.full_name,
			r.owner,
			(SELECT MAX(ar.created_at)::text
			    FROM analysis_runs ar WHERE ar.repo_id = r.id) AS last_scan_at,
			(SELECT COUNT(*) FROM pull_requests pr WHERE pr.repo_id = r.id) AS total_prs,
			(SELECT COUNT(*) FROM analysis_runs ar WHERE ar.repo_id = r.id) AS total_runs,
			(SELECT COUNT(*) FROM analysis_runs ar WHERE ar.repo_id = r.id AND ar.status = 'running') AS active_runs,
			COALESCE((
				SELECT COUNT(f.id) FROM findings f
				JOIN analysis_runs ar2 ON ar2.id = f.run_id
				WHERE ar2.repo_id = r.id
				  AND ar2.id = (SELECT MAX(id) FROM analysis_runs WHERE repo_id = r.id)
				  AND f.severity = 'critical'
			), 0) AS critical,
			COALESCE((
				SELECT COUNT(f.id) FROM findings f
				JOIN analysis_runs ar2 ON ar2.id = f.run_id
				WHERE ar2.repo_id = r.id
				  AND ar2.id = (SELECT MAX(id) FROM analysis_runs WHERE repo_id = r.id)
				  AND f.severity = 'high'
			), 0) AS high,
			COALESCE((
				SELECT COUNT(f.id) FROM findings f
				JOIN analysis_runs ar2 ON ar2.id = f.run_id
				WHERE ar2.repo_id = r.id
				  AND ar2.id = (SELECT MAX(id) FROM analysis_runs WHERE repo_id = r.id)
				  AND f.severity = 'medium'
			), 0) AS medium,
			COALESCE((
				SELECT COUNT(f.id) FROM findings f
				JOIN analysis_runs ar2 ON ar2.id = f.run_id
				WHERE ar2.repo_id = r.id
				  AND ar2.id = (SELECT MAX(id) FROM analysis_runs WHERE repo_id = r.id)
				  AND f.severity = 'low'
			), 0) AS low
		FROM repositories r
		ORDER BY r.full_name
	`)
	if err != nil {
		http.Error(w, "failed to query repositories", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type repoRow struct {
		ID          int64
		FullName    string
		Owner       string
		LastScanAt  *string
		TotalPRs    int
		TotalRuns   int
		ActiveRuns  int
		Critical    int
		High        int
		Medium      int
		Low         int
	}
	var items []repoRow
	for rows.Next() {
		var r repoRow
		if err := rows.Scan(&r.ID, &r.FullName, &r.Owner, &r.LastScanAt,
			&r.TotalPRs, &r.TotalRuns, &r.ActiveRuns,
			&r.Critical, &r.High, &r.Medium, &r.Low); err != nil {
			http.Error(w, "failed to scan repository row", http.StatusInternalServerError)
			return
		}
		items = append(items, r)
	}

	out := make([]map[string]interface{}, 0, len(items))
	for _, r := range items {
		grade := gradeForCounts(r.Critical, r.High, r.Medium)
		scanning := r.ActiveRuns > 0
		out = append(out, map[string]interface{}{
			"id":            r.ID,
			"full_name":     r.FullName,
			"owner":         r.Owner,
			"last_scan_at":  r.LastScanAt,
			"total_runs":    r.TotalRuns,
			"total_prs":     r.TotalPRs,
			"active_runs":   r.ActiveRuns,
			"scanning":      scanning,
			"grade":         grade,
			"critical":      r.Critical,
			"high":          r.High,
			"medium":        r.Medium,
			"low":           r.Low,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	// Always encode an array (possibly empty) rather than null -- our
	// frontend `getList` would normalize anyway, but `make` already gives
	// us a non-nil slice so we get [] for free.
	json.NewEncoder(w).Encode(out)
}

// ListFindings returns findings across all runs (newest first), optionally
// filtered by `?severity=critical` or `?repo_id=…`. Backs the Security
// page's "Recent Findings" table. The repo full_name is JOIN'd in so the
// security page can show which repo each finding belongs to without making
// a second call.
//
// `limit` defaults to 100; capped at 500 to keep the response sane.
func (h *Handlers) ListFindings(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit := 100
	if l := q.Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}

	// Build the WHERE clauses dynamically. We always have at least the
	// limit; severity and repo_id are optional filters.
	sql := `
		SELECT f.id, f.run_id, f.file_path, f.line_start, f.line_end,
		       f.severity, f.category, f.title, f.description, f.evidence,
		       f.confidence, f.verification_status, f.created_at::text,
		       r.full_name AS repo_full_name,
		       ar.commit_sha AS commit_sha
		FROM findings f
		JOIN analysis_runs ar ON ar.id = f.run_id
		JOIN repositories r ON r.id = ar.repo_id
	`
	args := []interface{}{}
	argIdx := 1
	where := []string{}
	if s := q.Get("severity"); s != "" {
		where = append(where, "f.severity = $"+strconv.Itoa(argIdx))
		args = append(args, s)
		argIdx++
	}
	if rid := q.Get("repo_id"); rid != "" {
		if id, err := strconv.ParseInt(rid, 10, 64); err == nil {
			where = append(where, "r.id = $"+strconv.Itoa(argIdx))
			args = append(args, id)
			argIdx++
		}
	}
	if len(where) > 0 {
		sql += "WHERE " + joinStrings(where, " AND ") + " "
	}
	sql += "ORDER BY f.created_at DESC LIMIT " + strconv.Itoa(limit)

	rows, err := h.DB.Query(r.Context(), sql, args...)
	if err != nil {
		http.Error(w, "failed to query findings", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var out []map[string]interface{}
	for rows.Next() {
		var (
			id, runID                              int64
			filePath, severity, category, title   string
			description                            string
			repoFullName, commitSha               string
			lineStart, lineEnd                    *int
			evidence                              *string
			confidence                            *float64
			createdAt                             string
			verification                          string
		)
		if err := rows.Scan(&id, &runID, &filePath, &lineStart, &lineEnd,
			&severity, &category, &title, &description, &evidence,
			&confidence, &verification, &createdAt,
			&repoFullName, &commitSha); err != nil {
			http.Error(w, "failed to scan findings row", http.StatusInternalServerError)
			return
		}
		out = append(out, map[string]interface{}{
			"id":                  id,
			"run_id":              runID,
			"file_path":           filePath,
			"line_start":          lineStart,
			"line_end":            lineEnd,
			"severity":            severity,
			"category":            category,
			"title":               title,
			"description":         description,
			"evidence":            evidence,
			"confidence":          confidence,
			"verification_status": verification,
			"created_at":          createdAt,
			"repo_full_name":      repoFullName,
			"commit_sha":          commitSha,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

// InsightsSummary returns a single JSON object with org-wide KPIs:
//   - total_repos, total_runs
//   - findings count by severity (critical/high/medium/low/info)
//   - verified vs unverified finding counts
//   - vulnerable_repos = count of distinct repos with at least one finding
//   - avg_fix_time_hours = avg(completed_at - created_at) across finished runs
//   - last_week_critical / last_week_high -- deltas from the previous 7d window
//
// The Security page renders these directly as its KPI strip.
func (h *Handlers) InsightsSummary(w http.ResponseWriter, r *http.Request) {
	var (
		totalRepos, totalRuns           int
		critical, high, medium, low, info int
		verified, unverified            int
		vulnerableRepos                 int
		avgFixHours                     *float64
		lastWeekCritical               int
		prevWeekCritical               int
	)
	err := h.DB.QueryRow(r.Context(), `
		SELECT
			(SELECT COUNT(*) FROM repositories) AS total_repos,
			(SELECT COUNT(*) FROM analysis_runs) AS total_runs,
			(SELECT COUNT(*) FROM findings WHERE severity = 'critical') AS critical,
			(SELECT COUNT(*) FROM findings WHERE severity = 'high') AS high,
			(SELECT COUNT(*) FROM findings WHERE severity = 'medium') AS medium,
			(SELECT COUNT(*) FROM findings WHERE severity = 'low') AS low,
			(SELECT COUNT(*) FROM findings WHERE severity = 'info') AS info,
			(SELECT COUNT(*) FROM findings WHERE verification_status = 'verified_by_static_analysis') AS verified,
			(SELECT COUNT(*) FROM findings WHERE verification_status = 'unverified') AS unverified,
			(SELECT COUNT(DISTINCT ar.repo_id)
			   FROM findings f JOIN analysis_runs ar ON ar.id = f.run_id) AS vulnerable_repos,
			(SELECT AVG(EXTRACT(EPOCH FROM (ar.completed_at - ar.created_at)) / 3600.0)
			   FROM analysis_runs ar
			   WHERE ar.status IN ('completed','failed')
			     AND ar.completed_at IS NOT NULL) AS avg_fix_hours,
			(SELECT COUNT(*) FROM findings WHERE severity = 'critical'
			   AND created_at >= now() - interval '7 days') AS last_week_critical,
			(SELECT COUNT(*) FROM findings WHERE severity = 'critical'
			   AND created_at >= now() - interval '14 days'
			   AND created_at <  now() - interval '7 days') AS prev_week_critical
	`).Scan(&totalRepos, &totalRuns, &critical, &high, &medium, &low, &info,
		&verified, &unverified, &vulnerableRepos, &avgFixHours,
		&lastWeekCritical, &prevWeekCritical)
	if err != nil {
		http.Error(w, "failed to query insights summary", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"total_repos":          totalRepos,
		"total_runs":           totalRuns,
		"findings": map[string]interface{}{
			"critical": critical,
			"high":     high,
			"medium":   medium,
			"low":      low,
			"info":     info,
		},
		"verified":                       verified,
		"unverified":                      unverified,
		"vulnerable_repos":                vulnerableRepos,
		"avg_fix_time_hours":             avgFixHours,
		"critical_delta_last_week":       lastWeekCritical - prevWeekCritical,
	})
}

// FindingsOverTime returns daily counts of findings, grouped by severity,
// for the last `?days=30` days. Backs the Security page's trend chart.
//
// Series shape:
//   [{ "date": "2026-07-19", "critical": 3, "high": 8, "medium": 12, "low": 4, "info": 1 }, ...]
//
// Days with no findings still appear in the series (with zeros) so the
// chart line doesn't have gaps. We LEFT JOIN a generate_series of dates
// against findings so empty days materialize naturally.
func (h *Handlers) FindingsOverTime(w http.ResponseWriter, r *http.Request) {
	days := 30
	if d := r.URL.Query().Get("days"); d != "" {
		if n, err := strconv.Atoi(d); err == nil && n > 0 && n <= 365 {
			days = n
		}
	}

	rows, err := h.DB.Query(r.Context(), `
		SELECT
			d::date::text AS day,
			COUNT(f.id) FILTER (WHERE f.severity = 'critical') AS critical,
			COUNT(f.id) FILTER (WHERE f.severity = 'high')     AS high,
			COUNT(f.id) FILTER (WHERE f.severity = 'medium')   AS medium,
			COUNT(f.id) FILTER (WHERE f.severity = 'low')      AS low,
			COUNT(f.id) FILTER (WHERE f.severity = 'info')     AS info
		FROM generate_series(
			(now()::date - ($1 - 1) * interval '1 day')::date,
			now()::date,
			interval '1 day'
		) AS d
		LEFT JOIN findings f ON f.created_at::date = d
		GROUP BY d
		ORDER BY d ASC
	`, days)
	if err != nil {
		http.Error(w, "failed to query findings over time", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var out []map[string]interface{}
	for rows.Next() {
		var day string
		var crit, highV, med, lowV, info int
		if err := rows.Scan(&day, &crit, &highV, &med, &lowV, &info); err != nil {
			http.Error(w, "failed to scan trend row", http.StatusInternalServerError)
			return
		}
		out = append(out, map[string]interface{}{
			"date":    day,
			"critical": crit,
			"high":     highV,
			"medium":   med,
			"low":      lowV,
			"info":     info,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

// MostVulnerableRepos returns the top N repositories by critical+high
// finding count across *all* their runs. Backs the Security page's right
// sidebar. `?limit=5` default; capped at 50.
func (h *Handlers) MostVulnerableRepos(w http.ResponseWriter, r *http.Request) {
	limit := 5
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 50 {
			limit = n
		}
	}

	rows, err := h.DB.Query(r.Context(), `
		SELECT
			r.id,
			r.full_name,
			r.owner,
			COUNT(f.id) FILTER (WHERE f.severity = 'critical') AS critical,
			COUNT(f.id) FILTER (WHERE f.severity = 'high')     AS high,
			COUNT(f.id) AS findings_total,
			MAX(ar.created_at)::text AS last_scan_at
		FROM repositories r
		JOIN analysis_runs ar ON ar.repo_id = r.id
		JOIN findings f ON f.run_id = ar.id
		GROUP BY r.id, r.full_name, r.owner
		ORDER BY (COUNT(f.id) FILTER (WHERE f.severity = 'critical')) DESC,
		         (COUNT(f.id) FILTER (WHERE f.severity = 'high')) DESC,
		         COUNT(f.id) DESC
		LIMIT $1
	`, limit)
	if err != nil {
		http.Error(w, "failed to query vulnerable repos", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var out []map[string]interface{}
	for rows.Next() {
		var id int64
		var fullName, owner, lastScanAt string
		var crit, highV, total int
		if err := rows.Scan(&id, &fullName, &owner, &crit, &highV, &total, &lastScanAt); err != nil {
			http.Error(w, "failed to scan vuln repo row", http.StatusInternalServerError)
			return
		}
		out = append(out, map[string]interface{}{
			"id":           id,
			"full_name":    fullName,
			"owner":        owner,
			"critical":     crit,
			"high":          highV,
			"findings_total": total,
			"last_scan_at": lastScanAt,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

// joinStrings is a tiny helper to avoid importing strings just for Join.
// The existing handler.go already imports strings; this keeps insights.go
// self-contained without dragging in another import.
func joinStrings(parts []string, sep string) string {
	if len(parts) == 0 {
		return ""
	}
	out := parts[0]
	for _, p := range parts[1:] {
		out += sep + p
	}
	return out
}