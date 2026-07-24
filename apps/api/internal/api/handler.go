package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/goldenk23/ai-devsecops-reviewer/api/internal/auth"
	"github.com/goldenk23/ai-devsecops-reviewer/api/internal/github"
	"github.com/goldenk23/ai-devsecops-reviewer/api/internal/queue"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handlers struct {
	DB    *pgxpool.Pool
	Queue *queue.Client
}

// ListAnalyses returns analysis runs, newest first. Optional `?repo_id=N`
// narrows the list to one repository. repositories is JOINed so each row
// carries repo_full_name for cross-repo listings.
func (h *Handlers) ListAnalyses(w http.ResponseWriter, r *http.Request) {
	sql := `
		SELECT ar.id, ar.status, ar.trigger, ar.commit_sha, ar.created_at::text,
		       r.full_name AS repo_full_name
		FROM analysis_runs ar
		JOIN repositories r ON r.id = ar.repo_id
	`
	args := []interface{}{}
	if rid := r.URL.Query().Get("repo_id"); rid != "" {
		if id, err := strconv.ParseInt(rid, 10, 64); err == nil {
			sql += "WHERE ar.repo_id = $1 "
			args = append(args, id)
		}
	}
	sql += "ORDER BY ar.created_at DESC LIMIT 50"

	rows, err := h.DB.Query(r.Context(), sql, args...)
	if err != nil {
		http.Error(w, "failed to query runs", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var runs []map[string]interface{}
	for rows.Next() {
		var id int64
		var status, trigger, commitSHA, createdAt, repoFullName string
		rows.Scan(&id, &status, &trigger, &commitSHA, &createdAt, &repoFullName)
		runs = append(runs, map[string]interface{}{
			"id": id, "status": status, "trigger": trigger,
			"commit_sha": commitSHA, "created_at": createdAt,
			"repo_full_name": repoFullName,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(runs)
}

// GetAnalysis returns details of a specific analysis run.
func (h *Handlers) GetAnalysis(w http.ResponseWriter, r *http.Request) {
	runID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	var id int64
	var status, trigger, commitSHA string
	var startedAt, completedAt, errorMsg *string

	err = h.DB.QueryRow(r.Context(), `
		SELECT id, status, trigger, commit_sha, 
		       started_at::text, completed_at::text, error
		FROM analysis_runs WHERE id = $1
	`, runID).Scan(&id, &status, &trigger, &commitSHA, &startedAt, &completedAt, &errorMsg)

	if err != nil {
		http.Error(w, "analysis not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id": id, "status": status, "trigger": trigger,
		"commit_sha": commitSHA, "started_at": startedAt,
		"completed_at": completedAt, "error": errorMsg,
	})
}

// GetAnalysisJobs returns all jobs for a specific analysis run.
func (h *Handlers) GetAnalysisJobs(w http.ResponseWriter, r *http.Request) {
	runID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	rows, err := h.DB.Query(r.Context(), `
		SELECT id, job_type, status, attempts, exit_code, 
		       started_at::text, completed_at::text
		FROM analysis_jobs WHERE run_id = $1 ORDER BY id
	`, runID)
	if err != nil {
		http.Error(w, "failed to query jobs", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var jobs []map[string]interface{}
	for rows.Next() {
		var id int64
		var jobType, status string
		var attempts int
		var exitCode *int
		var startedAt, completedAt *string
		rows.Scan(&id, &jobType, &status, &attempts, &exitCode, &startedAt, &completedAt)
		jobs = append(jobs, map[string]interface{}{
			"id": id, "job_type": jobType, "status": status,
			"attempts": attempts, "exit_code": exitCode,
			"started_at": startedAt, "completed_at": completedAt,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(jobs)
}

// GetAnalysisFindings returns all findings for a specific analysis run.
func (h *Handlers) GetAnalysisFindings(w http.ResponseWriter, r *http.Request) {
	runID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	rows, err := h.DB.Query(r.Context(), `
		SELECT id, file_path, line_start, line_end, severity, category,
		       title, description, evidence, confidence, verification_status, suggested_patch
		FROM findings WHERE run_id = $1 ORDER BY 
		       CASE severity 
		         WHEN 'critical' THEN 1 WHEN 'high' THEN 2 
		         WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 
		       END
	`, runID)
	if err != nil {
		http.Error(w, "failed to query findings", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var findings []map[string]interface{}
	for rows.Next() {
		var id int64
		var filePath, severity, category, title, description, verificationStatus string
		var lineStart, lineEnd *int
		var evidence, suggestedPatch *string
		var confidence *float64
		rows.Scan(&id, &filePath, &lineStart, &lineEnd, &severity, &category,
			&title, &description, &evidence, &confidence, &verificationStatus, &suggestedPatch)
		findings = append(findings, map[string]interface{}{
			"id": id, "file_path": filePath, "line_start": lineStart,
			"line_end": lineEnd, "severity": severity, "category": category,
			"title": title, "description": description, "evidence": evidence,
			"confidence": confidence, "verification_status": verificationStatus,
			"suggested_patch": suggestedPatch,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(findings)
}

func (h *Handlers) githubTokenForRun(ctx context.Context, runID int64) (string, error) {
	var encryptedToken string
	err := h.DB.QueryRow(ctx, `
		SELECT u.oauth_token_encrypted
		FROM analysis_runs ar
		JOIN repository_users ru ON ru.repo_id = ar.repo_id
		JOIN users u ON u.id = ru.user_id
		WHERE ar.id = $1
		ORDER BY ru.linked_at DESC
		LIMIT 1
	`, runID).Scan(&encryptedToken)
	if err != nil {
		return "", err
	}
	return auth.DecryptToken(encryptedToken)
}

// GetAnalysisGitHubToken supplies the worker with the token linked to this
// run's repository. The route is internal and protected by the service API key.
func (h *Handlers) GetAnalysisGitHubToken(w http.ResponseWriter, r *http.Request) {
	runID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	token, err := h.githubTokenForRun(r.Context(), runID)
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		http.Error(w, "failed to load repository token", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(map[string]string{"token": token})
}

// PostComments posts the analysis findings to the GitHub PR that triggered the
// run: findings with a patch go out as inline suggestion review comments, the
// rest are rolled into a single top-level summary comment (created once, then
// updated in place on re-runs).
func (h *Handlers) PostComments(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	runID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	var repoFullName, commitSHA string
	var prNumber int
	err = h.DB.QueryRow(ctx, `
		SELECT r.full_name, ar.commit_sha, pr.pr_number
		FROM analysis_runs ar
		JOIN repositories r ON ar.repo_id = r.id
		JOIN pull_requests pr ON ar.pr_id = pr.id
		WHERE ar.id = $1
	`, runID).Scan(&repoFullName, &commitSHA, &prNumber)
	if err != nil {
		http.Error(w, "analysis run not found", http.StatusNotFound)
		return
	}

	// ORDER BY severity so the most serious findings print first in the comment.
	rows, err := h.DB.Query(ctx, `
		SELECT severity, category, file_path, title, description, confidence, COALESCE(suggested_patch, '')
		FROM findings WHERE run_id = $1 ORDER BY severity
	`, runID)
	if err != nil {
		http.Error(w, "failed to query findings", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	tag := commentTag(runID)

	token, err := h.githubTokenForRun(ctx, runID)
	if err != nil {
		http.Error(w, fmt.Sprintf("no repository token available: %v", err), http.StatusInternalServerError)
		return
	}

	owner, repo := parseRepoFullName(repoFullName)

	ghClient := github.NewClient()

	var b strings.Builder
	b.WriteString(commentTag(runID) + "\n\n")
	b.WriteString(fmt.Sprintf("## AI Code Review & DevSecOps Agent Platform - Run #%d\n\n", runID))
	count := 0

	for rows.Next() {
		var severity, category, filePath, title, description, patch string
		var confidence float64
		if err := rows.Scan(&severity, &category, &filePath, &title, &description, &confidence, &patch); err != nil {
			continue
		}

		if patch != "" {
			snippet, startLine, endLine := parsePatchForGitHub(patch)
			if snippet != "" && endLine > 0 {
				body := fmt.Sprintf("**%s**\n%s\n\n```suggestion\n%s\n```", title, description, snippet)
				// Best-effort: don't abort the whole run if one review comment fails.
				_ = ghClient.PostReviewComment(ctx, owner, repo, prNumber, body, filePath, commitSHA, startLine, endLine, token)
			}
		} else {
			count++
			icon := ""
			switch severity {
			case "critical", "high":
				icon = "🚨"
			case "medium":
				icon = "⚠️"
			default:
				icon = "ℹ️"
			}
			b.WriteString(fmt.Sprintf("- %s **[%s]** %s - `%s` - %s (%.2f)\n",
				icon, severity, category, filePath, title, confidence))
		}
	}

	comment := b.String()
	if count == 0 {
		comment += "🎉 **No unpatched findings!** The AI either fixed everything or found no issues.\n"
	}

	existingID, err := ghClient.FindExistingComment(ctx, owner, repo, prNumber, tag, token)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to find existing comment: %v", err), http.StatusInternalServerError)
		return
	}

	if existingID > 0 {
		err = ghClient.UpdateComment(ctx, owner, repo, existingID, comment, token)
		if err != nil {
			http.Error(w, fmt.Sprintf("failed to update comment: %v", err), http.StatusInternalServerError)
			return
		}
	} else {
		err = ghClient.CreateComment(ctx, owner, repo, prNumber, comment, token)
		if err != nil {
			http.Error(w, fmt.Sprintf("failed to post comment: %v", err), http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "comment posted",
	})
}

// parseRepoFullName splits a GitHub "full_name" ("acme/web") into owner and
// repo. Returns two empty strings if the input isn't exactly two parts.
func parseRepoFullName(fullName string) (string, string) {
	parts := strings.Split(fullName, "/")
	if len(parts) == 2 {
		return parts[0], parts[1]
	}
	return "", ""
}

func parsePatchForGitHub(patch string) (snippet string, startLine int, endLine int) {
	lines := strings.Split(patch, "\n")
	var out []string

	hunkRegex := regexp.MustCompile(`^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@`)

	inHunk := false
	for _, line := range lines {
		if !inHunk {
			matches := hunkRegex.FindStringSubmatch(line)
			if len(matches) > 0 {
				inHunk = true
				startLine, _ = strconv.Atoi(matches[1])

				oldCount := 1
				if matches[2] != "" {
					oldCount, _ = strconv.Atoi(matches[2])
				}

				if oldCount == 0 {
					endLine = startLine
				} else {
					endLine = startLine + oldCount - 1
				}
			}
			continue
		}

		if line == "" {
			out = append(out, "")
			continue
		}

		if strings.HasPrefix(line, "+") {
			out = append(out, strings.TrimPrefix(line, "+"))
		} else if strings.HasPrefix(line, " ") {
			out = append(out, strings.TrimPrefix(line, " "))
		} else if strings.HasPrefix(line, "-") {
			// skip removed lines
		} else if strings.HasPrefix(line, "\\") {
			// skip "\ No newline at end of file"
		} else if strings.HasPrefix(line, "@@") {
			// only single-hunk patches are supported
			break
		}
	}

	return strings.TrimSuffix(strings.Join(out, "\n"), "\n"), startLine, endLine
}

// commentTag builds a hidden HTML-comment marker embedded in every review
// comment. GitHub keeps raw HTML comments out of the rendered view, so
// FindExistingComment can match it in the raw body to update in place instead
// of posting duplicates. The run id keys uniqueness: a new run on the same PR
// creates a fresh comment rather than overwriting the previous run's.
func commentTag(runID int64) string {
	return fmt.Sprintf("<!-- ai-review-run:%d -->", runID)
}

// ListDeadJobs returns up to 50 permanently-failed jobs from the Redis
// dead-letter queue, newest first. Non-destructive: jobs stay in the DLQ
// until explicitly replayed or cleared. Backs the /dead-jobs dashboard page.
func (h *Handlers) ListDeadJobs(w http.ResponseWriter, r *http.Request) {
	jobs, err := h.Queue.DeadJobs(r.Context(), 50)
	if err != nil {
		http.Error(w, "failed to read dead-letter queue", http.StatusInternalServerError)
		return
	}
	// Wrap as RawMessage so the response is a JSON array of objects rather than
	// an array of escaped strings, which is what the dashboard expects.
	raw := make([]json.RawMessage, len(jobs))
	for i, j := range jobs {
		raw[i] = json.RawMessage(j)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(raw)
}
