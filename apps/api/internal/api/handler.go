/**
This file create Api endpoints to check job status, and minimal Next.js dashboard to display it.
*/

package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/goldenk23/ai-devsecops-reviewer/api/internal/github"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handlers struct {
	DB *pgxpool.Pool
}

// ListAnalyses returns all analysis runs
func (h *Handlers) ListAnalyses(w http.ResponseWriter, r *http.Request) {
	rows, err := h.DB.Query(r.Context(), `
		SELECT id, status, trigger, commit_sha, created_at::text
		FROM analysis_runs ORDER BY created_at DESC LIMIT 50
	`)
	if err != nil {
		http.Error(w, "failed to query runs", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var runs []map[string]interface{}
	for rows.Next() {
		var id int64
		var status, trigger, commitSHA, createdAt string
		rows.Scan(&id, &status, &trigger, &commitSHA, &createdAt)
		runs = append(runs, map[string]interface{}{
			"id": id, "status": status, "trigger": trigger,
			"commit_sha": commitSHA, "created_at": createdAt,
		})
	}

	/**
		### 7. `json.NewEncoder(w).Encode(runs)`

	- `json.NewEncoder(w)` = create a JSON encoder that writes to the response (`w`).
	- `.Encode(runs)` = convert the `runs` list into JSON and write it out.
	- The result looks like:

	```json
	[
	{"id": 1, "status": "completed", "trigger": "webhook", "commit_sha": "abc123", "created_at": "2026-07-16T..."},
	{"id": 2, "status": "running", ...}
	]
	```
	*/
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
		       title, description, evidence, confidence, verification_status
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
		var evidence *string
		var confidence *float64
		rows.Scan(&id, &filePath, &lineStart, &lineEnd, &severity, &category,
			&title, &description, &evidence, &confidence, &verificationStatus)
		findings = append(findings, map[string]interface{}{
			"id": id, "file_path": filePath, "line_start": lineStart,
			"line_end": lineEnd, "severity": severity, "category": category,
			"title": title, "description": description, "evidence": evidence,
			"confidence": confidence, "verification_status": verificationStatus,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(findings)
}

/**
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
		SELECT severity, category, file_path, title, confidence
		FROM findings WHERE run_id = $1 ORDER BY severity
	`, runID)
	if err != nil {
		http.Error(w, "failed to query findings", http.StatusInternalServerError)
		return
	}
	// defer rows.Close() makes sure the cursor is released when the function
	// returns - even on an early error return. Skipping this leaks DB connections.
	defer rows.Close()

	// STEP 3: Build the Markdown comment from those raw rows.
	// We pass runID not just for the header line but also to build a unique
	// hidden "tag" (an HTML comment) that we embed in the body, so we can
	// later recognize "this is our comment for run #X" and update it in place
	// instead of spamming a brand-new comment on every re-run. See the helper below.
	comment := buildCommentBody(rows, runID)
	// The tag is the same marker the helper wrote into the body. We repeat it
	// here so FindExistingComment can look for it among the PR's comments.
	tag := commentTag(runID)

	// STEP 4: Get a GitHub OAuth token so we can call GitHub's API.
	//
	// MVP shortcut: grab the token of the first user in the database. A real
	// product would scope this to whoever triggered the run, or use a GitHub
	// App installation token. We name the column oauth_token_encrypted but
	// treat it as a raw token here for the MVP (no decryption yet).
	var token string
	err = h.DB.QueryRow(ctx, "SELECT oauth_token_encrypted FROM users LIMIT 1").Scan(&token)
	if err != nil {
		// No token means we cannot authenticate with GitHub at all -> HTTP 500.
		http.Error(w, "no user token available", http.StatusInternalServerError)
		return
	}

	// STEP 5: Split "acme/web" into owner="acme" and repo="web".
	// GitHub's REST API needs owner and repo as SEPARATE path parameters, but
	// we store them combined as full_name. parseRepoFullName does the split.
	owner, repo := parseRepoFullName(repoFullName)

	// STEP 6: Send the comment to GitHub.
	//
	// github.NewClient() returns our thin wrapper around GitHub's REST API.
	// We use the "issue comments" endpoint (a PR is a kind of issue on GitHub)
	// rather than the "review comment" endpoint used by the older PostComment
	// function, because a summary comment isn't anchored to a specific line.
	//
	// Behavior on re-runs: instead of posting a duplicate comment every time,
	// we first search the PR's comments for one containing our tag. If we find
	// one, we UPDATE its body in place; only if there's no prior comment do we
	// create a brand-new one. This keeps the PR's timeline tidy.
	ghClient := github.NewClient()

	// FindExistingComment returns the id of an existing comment that already
	// contains our tag, or 0 if there is no such comment. We pass the tag we
	// built above so it knows what substring to search for.
	existingID, err := ghClient.FindExistingComment(ctx, owner, repo, prNumber, tag, token)
	if err != nil {
		// Network error (couldn't even reach GitHub). Surface it to the caller.
		http.Error(w, fmt.Sprintf("failed to find existing comment: %v", err), http.StatusInternalServerError)
		return
	}

	// Branch on whether we found an existing comment.
	if existingID > 0 {
		// Update the existing comment in place with the freshly built body.
		// Line 27? Whatever — UpdateComment does the PATCH.
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

/**
buildCommentBody walks through a rows cursor (the findings we just queried)
and produces a single Markdown string ready to be posted to the GitHub PR.

We use strings.Builder because we're concatenating many small pieces into one
potentially large string. Builder is much cheaper than repeated "+=".

Note: pgx.Rows is the type returned by h.DB.Query. It gives us rows.Next() to
advance the cursor and rows.Scan(...) to read column values into Go variables.
The Scan order MUST match the SELECT clause order - out-of-order columns panic.
*/
func buildCommentBody(rows pgx.Rows, runID int64) string {
	// strings.Builder is Go's efficient string accumulator. We append many
	// small pieces and call .String() once at the end. Cheaper than "+=".
	var b strings.Builder

	// Hidden tag line: an HTML comment is invisible when GitHub renders the
	// Markdown, but we can still see it in the raw comment body. The tag is a
	// unique string per run, so FindExistingComment can later pick OUR comment
	// out of all the comments on this PR. We put it at the very top so it shows
	// up even if a future bug truncates the body somewhere below.
	b.WriteString(commentTag(runID) + "\n\n")

	// Header of the GitHub comment.
	// We use the project's own name ("AI Code Review & DevSecOps Agent Platform")
	// rather than a generic "AI Review Summary", so PR readers know which system
	// produced the comment and can find the dashboard / docs easily.
	b.WriteString(fmt.Sprintf("## AI Code Review & DevSecOps Agent Platform - Run #%d\n\n", runID))

	// Loop through every finding row returned by the SQL query.
	// rows.Next() returns true if there's another row, false when done (or on error).
	count := 0
	for rows.Next() {
		var severity, category, filePath, title string
		var confidence float64
		// Scan reads the 5 columns of the current row into our variables.
		// The order matches: SELECT severity, category, file_path, title, confidence
		if err := rows.Scan(&severity, &category, &filePath, &title, &confidence); err != nil {
			// On a scan error we stop and ship whatever comment we have so far.
			break
		}

		// One Markdown bullet per finding. Example output:
		//   - **[high]** security - `src/auth.go` - SQL Injection (0.95)
		b.WriteString(fmt.Sprintf(
			"- **[%s]** %s - `%s` - %s (%.2f)\n",
			severity, category, filePath, title, confidence,
		))
		count++
	}

	// If there were no findings at all, say so explicitly. A silent comment
	// would leave the PR author wondering whether the scan even ran.
	// The explicit "_No issues found._" line proves the analysis completed cleanly.
	if count == 0 {
		b.WriteString("_No issues found._\n")
	}

	return b.String()
}

/**
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

/**
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