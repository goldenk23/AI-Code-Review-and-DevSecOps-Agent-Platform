/**
This file create Api endpoints to check job status, and minimal Next.js dashboard to display it.
*/

package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
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