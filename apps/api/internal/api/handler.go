/**
This file create Api endpoints to check job status, and minimal Next.js dashboard to display it.
*/

package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/goldenk23/ai-devsecops-reviewer/api/internal/auth"
	"github.com/goldenk23/ai-devsecops-reviewer/api/internal/github"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handlers struct {
	DB *pgxpool.Pool
}

// ListAnalyses returns analysis runs, newest first.
//
// Optional `?repo_id=N` filter narrows the list to one repository -- this
// is what the /repositories page's "click a repo" flow uses: it redirects
// to /?repo_id=N and the dashboard calls this endpoint with that filter.
//
// We JOIN repositories so we can also return repo_full_name -- the
// dashboard shows the repo name on each row when listing across repos.
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

// GetAnalysis returns details of a specific analysis run
func (h *Handlers) GetAnalysis(w http.ResponseWriter, r *http.Request) {
	/**

	runID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	Get the "id" from the URL (e.g. /runs/42 → "42"), convert it to a 64-bit integer (base 10), and store the number in runID and any error in err.

	*/

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

// GetAnalysisJobs returns all jobs for a specific analysis run
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

// GetAnalysisFindings returns all findings for a specific analysis run
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

/*
*
PostComments posts a summary of the analysis findings as a comment on the
GitHub pull request that triggered the run.

High-level flow:
 1. Read the analysis-run ID from the URL (e.g. /api/analyses/42/comments).
 2. Look up which repo, commit, and PR that run belongs to (from Postgres).
 3. Pull all the findings the worker saved for that run.
 4. Turn those findings into a Markdown comment via buildCommentBody.
 5. Grab a GitHub OAuth token from the database so we can authenticate.
 6. Ask our GitHub client to post the comment to the PR.
 7. Reply with a small JSON message so the caller knows it worked.
*/
func (h *Handlers) PostComments(w http.ResponseWriter, r *http.Request) {
	// r.Context() carries cancellation: if the client disconnects, the context
	// is cancelled and the DB/GitHub calls below will abort early instead of
	// running to completion uselessly.
	ctx := r.Context()

	// chi.URLParam(r, "id") pulls the "{id}" segment out of the matched route.
	// For "/api/analyses/42/comments" it returns the string "42".
	// strconv.ParseInt(base 10, 64-bit) converts "42" -> the int64 42.
	// If the user sent /analyses/abc, conversion fails -> HTTP 400 Bad Request.
	runID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	// STEP 1: Find the repo full_name, commit SHA, and PR number for this run.
	//
	// We JOIN three tables because a single analysis_runs row only stores
	// foreign keys (repo_id, pr_id) - the actual repo name and PR number live
	// in the repositories and pull_requests tables.
	//   analysis_runs ar  - one row per "we ran a review on this PR"
	//   repositories   r   - one row per tracked GitHub repo (has full_name)
	//   pull_requests  pr  - one row per PR we've seen (has pr_number)
	//
	// QueryRow = we expect exactly ONE row (run IDs are unique).
	// .Scan(...) copies the three selected columns into our local variables.
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
		// No row came back -> the run ID doesn't exist -> HTTP 404 Not Found.
		http.Error(w, "analysis run not found", http.StatusNotFound)
		return
	}

	// STEP 2: Fetch every finding the worker saved for this run.
	//
	// Query (not QueryRow) because we expect MANY rows (one per finding).
	// ORDER BY severity makes the most serious findings print first in the
	// comment, so a human scanning GitHub sees the important stuff up top.
	rows, err := h.DB.Query(ctx, `
		SELECT severity, category, file_path, title, description, confidence, COALESCE(suggested_patch, '')
		FROM findings WHERE run_id = $1 ORDER BY severity
	`, runID)
	if err != nil {
		http.Error(w, "failed to query findings", http.StatusInternalServerError)
		return
	}
	// defer rows.Close() makes sure the cursor is released when the function
	// returns - even on an early error return. Skipping this leaks DB connections.
	defer rows.Close()

	tag := commentTag(runID)

	var encToken string
	err = h.DB.QueryRow(ctx, "SELECT oauth_token_encrypted FROM users LIMIT 1").Scan(&encToken)
	if err != nil {
		http.Error(w, "no user token available", http.StatusInternalServerError)
		return
	}
	// Decrypt the stored token before using it to call GitHub.
	token, err := auth.DecryptToken(encToken)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to decrypt stored token: %v", err), http.StatusInternalServerError)
		return
	}

	owner, repo := parseRepoFullName(repoFullName)

	ghClient := github.NewClient()

	// STEP 7: We'll split findings into two buckets:
	// - Those WITH a patch -> send as inline GitHub PR review comments.
	// - Those WITHOUT a patch -> accumulate into a top-level summary comment.
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
			// Natively post to GitHub Copilot-style inline PR review comment!
			snippet, startLine, endLine := parsePatchForGitHub(patch)
			if snippet != "" && endLine > 0 {
				body := fmt.Sprintf("**%s**\n%s\n\n```suggestion\n%s\n```", title, description, snippet)
				// Best-effort posting; we don't abort the whole run if one review comment fails.
				_ = ghClient.PostReviewComment(ctx, owner, repo, prNumber, body, filePath, commitSHA, startLine, endLine, token)
			}
		} else {
			// Accumulate for top-level summary comment
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
		// Network error (couldn't even reach GitHub). Surface it to the caller.
		http.Error(w, fmt.Sprintf("failed to find existing comment: %v", err), http.StatusInternalServerError)
		return
	}

	// Branch on whether we found an existing comment.
	if existingID > 0 {
		err = ghClient.UpdateComment(ctx, owner, repo, existingID, comment, token)
		if err != nil {
			http.Error(w, fmt.Sprintf("failed to update comment: %v", err), http.StatusInternalServerError)
			return
		}
	} else {
		// No existing comment for this run → create a new one. This is the
		// first time we're posting review results for this run.
		err = ghClient.CreateComment(ctx, owner, repo, prNumber, comment, token)
		if err != nil {
			http.Error(w, fmt.Sprintf("failed to post comment: %v", err), http.StatusInternalServerError)
			return
		}
	}

	// STEP 7: Success - reply with a small JSON body so the caller knows it worked.
	// Content-Type tells the browser/curl how to interpret the body.
	w.Header().Set("Content-Type", "application/json")
	// json.NewEncoder(w).Encode writes the map as JSON straight to the response:
	//   {"message":"comment posted"}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "comment posted",
	})
}

/*
*
parseRepoFullName splits a GitHub "full_name" like "acme/web" into its
owner ("acme") and repo ("web") parts.

GitHub's REST API takes owner and repo as SEPARATE path parameters, e.g.

	POST /repos/{owner}/{repo}/pulls/{pr_number}/comments

but the database stores them combined as the single string "acme/web".
This helper does the split.

If the input isn't exactly two parts (e.g. "web" or "a/b/c"), we return two
empty strings so the caller can notice something is wrong.
*/
func parseRepoFullName(fullName string) (string, string) {
	// strings.Split returns a slice of substrings. "acme/web" -> ["acme", "web"].
	parts := strings.Split(fullName, "/")
	// We only expect exactly 2 parts. Any other shape means the data is malformed,
	// so we refuse to guess and let the caller handle it.
	if len(parts) == 2 {
		return parts[0], parts[1]
	}
	return "", ""
}

func parsePatchForGitHub(patch string) (snippet string, startLine int, endLine int) {
	lines := strings.Split(patch, "\n")
	var out []string

	// e.g. @@ -2,7 +2,7 @@
	hunkRegex := regexp.MustCompile(`^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@`)

	inHunk := false
	for _, line := range lines {
		if !inHunk {
			matches := hunkRegex.FindStringSubmatch(line)
			if len(matches) > 0 {
				inHunk = true
				startLine, _ = strconv.Atoi(matches[1])

				oldCount := 1 // default to 1 if missing
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
			// skip
		} else if strings.HasPrefix(line, "\\") {
			// skip "\ No newline at end of file"
		} else if strings.HasPrefix(line, "@@") {
			// multi-hunk patch? We only support single hunk for now, break
			break
		}
	}

	return strings.TrimSuffix(strings.Join(out, "\n"), "\n"), startLine, endLine
}

/*
*
commentTag builds the hidden marker we embed in every review comment so we can
recognize our own comment later and update it instead of posting a duplicate.

The tag is a Markdown HTML comment of the form:

	<!-- ai-review-run:42 -->

Why an HTML comment? GitHub renders Markdown but leaves raw HTML comments in
the source invisible in the rendered view — so humans see a clean comment while
our FindExistingComment function can still grep for "ai-review-run:42" in the
raw body to identify which comment is ours.

The run id is the uniqueness key: one comment per run, updated in place across
re-runs of the same run. Using the run id (instead of, say, the PR number) means
a brand-new run on the same PR correctly creates a fresh comment rather than
overwriting the previous run's comment.
*/
func commentTag(runID int64) string {
	return fmt.Sprintf("<!-- ai-review-run:%d -->", runID)
}
