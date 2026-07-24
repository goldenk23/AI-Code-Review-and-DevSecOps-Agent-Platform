package webhook

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"

	"github.com/goldenk23/ai-devsecops-reviewer/api/internal/queue"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

type Handler struct {
	DB     *pgxpool.Pool
	GitHub GitHubClientInterface
	Queue  QueueClientInterface
}

type GitHubClientInterface interface {
	GetPRDiff(ctx context.Context, owner, repo string, prNumber int, token string) (string, error)
}

type QueueClientInterface interface {
	EnqueueAnalysis(ctx context.Context, payload queue.Payload) error
}

type QueuePayload struct {
	RunID        int64  `json:"run_id"`
	RepoFullName string `json:"repo_full_name"`
	PRNumber     int    `json:"pr_number"`
	PRTitle      string `json:"pr_title"`
	HeadSHA      string `json:"head_sha"`
	Branch       string `json:"branch"`
}

// VerifySignature validates the HMAC-SHA256 signature GitHub sends in the
// X-Hub-Signature-256 header against the request body and shared secret.
func VerifySignature(secret string, body []byte, signature string) bool {
	if len(signature) < 8 || signature[:7] != "sha256=" {
		return false
	}

	providedHash := signature[7:]

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	expectedHash := hex.EncodeToString(mac.Sum(nil))

	providedBytes, _ := hex.DecodeString(providedHash)
	expectedBytes, _ := hex.DecodeString(expectedHash)

	return hmac.Equal(providedBytes, expectedBytes)
}

// GitHubWebhookPayload captures the PR-webhook fields we act on; other fields
// in GitHub's payload are ignored during unmarshaling.
type GitHubWebhookPayload struct {
	Action      string `json:"action"`
	PullRequest struct {
		Number int    `json:"number"`
		Title  string `json:"title"`
		Head   struct {
			SHA string `json:"sha"`
			Ref string `json:"ref"`
		} `json:"head"`
		User struct {
			Login string `json:"login"`
		} `json:"user"`
	} `json:"pull_request"`
	Repository struct {
		ID       int64  `json:"id"`
		Name     string `json:"name"`
		FullName string `json:"full_name"`
		Owner    struct {
			Login string `json:"login"`
		} `json:"owner"`
	} `json:"repository"`
}

func (h *Handler) HandleGitHubWebhook(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	secret := os.Getenv("GITHUB_WEBHOOK_SECRET")
	signature := r.Header.Get("X-Hub-Signature-256")

	if !VerifySignature(secret, body, signature) {
		http.Error(w, "Invalid signature", http.StatusUnauthorized)
		return
	}

	// Return 200 for events we ignore so GitHub doesn't retry them for 24h.
	eventType := r.Header.Get("X-GitHub-Event")
	if eventType != "pull_request" {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"message":"ignored: not a pull_request event"}`))
		return
	}

	var payload GitHubWebhookPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		http.Error(w, "Failed to parse webhook payload", http.StatusBadRequest)
		return
	}

	action := payload.Action
	if action != "opened" && action != "reopened" && action != "synchronize" {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(fmt.Sprintf(`{"message":"ignored: action %s"}`, action)))
		return
	}

	var repoId int64
	err = h.DB.QueryRow(ctx,
		`INSERT INTO repositories (github_repo_id, full_name, owner)
	VALUES ($1, $2, $3)
	ON CONFLICT (github_repo_id) DO UPDATE SET full_name = $2, owner = $3
	RETURNING id`,
		payload.Repository.ID,
		payload.Repository.FullName,
		payload.Repository.Owner.Login,
	).Scan(&repoId)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to save repository: %v", err), http.StatusInternalServerError)
		return
	}

	var prID int64
	err = h.DB.QueryRow(ctx, `
		INSERT INTO pull_requests (repo_id, pr_number, head_sha, author, title)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (repo_id, pr_number) DO UPDATE
		SET head_sha = $3, author = $4, title = $5
		RETURNING id
	`, repoId, payload.PullRequest.Number, payload.PullRequest.Head.SHA,
		payload.PullRequest.User.Login, payload.PullRequest.Title).Scan(&prID)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to save PR: %v", err), http.StatusInternalServerError)
		return
	}

	var runID int64
	err = h.DB.QueryRow(ctx, `
		INSERT INTO analysis_runs (repo_id, pr_id, status, trigger, commit_sha)
		VALUES ($1, $2, 'queued', 'webhook', $3)
		ON CONFLICT (repo_id, pr_id, commit_sha) DO NOTHING
		RETURNING id
	`, repoId, prID, payload.PullRequest.Head.SHA).Scan(&runID)
	if err != nil {
		// No rows returned means the run already exists (idempotent -- skip).
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"message":"run already exists, skipping"}`))
		return
	}

	// Enqueue failures are logged but not fatal: the run is already persisted
	// as 'queued' and can be retried out of band.
	if h.Queue != nil {
		err = h.Queue.EnqueueAnalysis(ctx, queue.Payload{
			RunID:        runID,
			RepoFullName: payload.Repository.FullName,
			PRNumber:     payload.PullRequest.Number,
			PRTitle:      payload.PullRequest.Title,
			HeadSHA:      payload.PullRequest.Head.SHA,
			Branch:       payload.PullRequest.Head.Ref,
		})
		if err != nil {
			zap.L().Error("failed to enqueue analysis job",
				zap.Int64("run_id", runID),
				zap.String("repo", payload.Repository.FullName),
				zap.Int("pr_number", payload.PullRequest.Number),
				zap.Error(err))
		}
	}
	zap.L().Info("created analysis run",
		zap.Int64("run_id", runID),
		zap.String("repo", payload.Repository.FullName),
		zap.Int("pr_number", payload.PullRequest.Number),
		zap.String("commit_sha", payload.PullRequest.Head.SHA))

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "webhook processed",
		"run_id":  runID,
	})
}
