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

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/goldenk23/ai-devsecops-reviewer/api/internal/queue"
	"go.uber.org/zap"
)
// Handler struct holds dependencies for webhook processing
type Handler struct {
	DB *pgxpool.Pool // Database connection pool
	GitHub GitHubClientInterface
	Queue QueueClientInterface
}

type GitHubClientInterface interface {
	GetPRDiff(ctx context.Context, owner, repo string, prNumber int, token string) (string, error)
}

type QueueClientInterface interface {
	EnqueueAnalysis(ctx context.Context, payload queue.Payload) error
}

// QueuePayload represents the data sent to the celery worker
type QueuePayload struct {
	RunID        int64  `json:"run_id"`
	RepoFullName string `json:"repo_full_name"`
	PRNumber     int    `json:"pr_number"`
	PRTitle      string `json:"pr_title"`
	HeadSHA      string `json:"head_sha"`
	Branch       string `json:"branch"`
}

// VerifySignature checks that the webhook really came from GitHub.
func VerifySignature(secret string, body []byte, signature string) bool {
	if len(signature) < 8 || signature[:7] != "sha256=" {
		return false
	}

	providedHash := signature[7:]

	mac := hmac.New(sha256.New, []byte(secret))// start a fingerprint machine that uses SHA-256 and our secret as the key. The secret needs to be bytes ([]byte), not text, so we convert.
	mac.Write(body)// feed the raw message body in
	expectedHash := hex.EncodeToString(mac.Sum(nil))//finish and get the fingerprint bytes. nil means "don't add anything extra before the result."

	// convert those raw bytes into hex text like a3f9b2... so we can compare strings to strings.
	providedBytes, _ := hex.DecodeString(providedHash)
	expectedBytes, _ := hex.DecodeString(expectedHash)

	return hmac.Equal(providedBytes, expectedBytes)
}

// GitHubWebhookPayload represents the important fields from a PR webhook
//GitHub's actual payload is huge and has tons of fields we don't care about. This struct says: "I only want these fields, please ignore the rest."
//The json:"..." tags match the field names GitHub actually uses in their JSON. If the JSON has a field we didn't list, it's silently skipped.
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
// HandleGitHubWebhook is the main webhook handler

/**
- w http.ResponseWriter → the thing we write our answer into. We're sending a response back to GitHub.
- r *http.Request → the incoming request. Has headers, body, method, etc.
- This exact signature (w http.ResponseWriter, r *http.Request) is what Go's HTTP server requires. Match it or the server won't accept your function.
*/
func(h *Handler) HandleGitHubWebhook(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Step 1: Read the request body
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close() // ensure the body is closed after reading

	// Step 2: Verify the signature
	secret := os.Getenv("GITHUB_WEBHOOK_SECRET")
	signature := r.Header.Get("X-Hub-Signature-256")

	if !VerifySignature(secret, body, signature) {
		http.Error(w, "Invalid signature", http.StatusUnauthorized)
		return
	}

	// Step 3: Check the event type
	/**
	- GitHub fires webhooks for many events: pushes, comments, stars, etc. We only care about PRs.
	- w.WriteHeader(http.StatusOK) → set status to 200 OK.
	Because if we'd return an error, GitHub would think we failed and retry sending the same webhook up to 8 times over 24 hours. We don't want that. So we politely say "got it, thanks, but ignoring."
	*/
	eventType := r.Header.Get("X-GitHub-Event")
	if eventType != "pull_request" {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"message":"ignored: not a pull_request event"}`))
		return
	}

	// Step 4: Parse the webhook payload

	/**
	- var payload GitHubWebhookPayload → "create an empty payload box of this type." var is the keyword for declaring a variable when you want to be explicit about the type. (We don't use := here because there's no value to assign — Go gives it the zero value automatically.)

	- json.Unmarshal(body, &payload) → read the JSON bytes and fill the payload struct with the matching fields.
	*/
	var payload GitHubWebhookPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		http.Error(w, "Failed to parse webhook payload", http.StatusBadRequest)
		return
	}

	// step 5: Only process relevant actions (opened, reopened, synchronize)
	action := payload.Action
	if action != "opened" && action != "reopened" && action != "synchronize" {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(fmt.Sprintf(`{"message":"ignored: action %s"}`, action)))
		return
	}

	// step 6: save the repo to database
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

	// save the PR to database
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

		// Step 8: Create an analysis run (idempotent)
	var runID int64
	err = h.DB.QueryRow(ctx, `
		INSERT INTO analysis_runs (repo_id, pr_id, status, trigger, commit_sha)
		VALUES ($1, $2, 'queued', 'webhook', $3)
		ON CONFLICT (repo_id, pr_id, commit_sha) DO NOTHING
		RETURNING id
	`, repoId, prID, payload.PullRequest.Head.SHA).Scan(&runID)
	if err != nil {
		// "no rows" means the run already exists (idempotent — skip)
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"message":"run already exists, skipping"}`))
		return
	}

	// step 9: Enqueue the analysis job to Celery worker

	/**
	- if h.Queue != nil → only try if we actually have a queue set up. In tests or local dev we might not. This avoids a crash (calling a method on nil would panic).

	- Inside the {}, we build a QueuePayload using named fields. Go lets you write QueuePayload{ FieldName: value, Field2: value }. Order doesn't matter, you can skip fields (skipped ones get zero values). It's clearer than positional init.

	- We pass it to EnqueueAnalysis, which sends it to the worker queue. The worker (apps/worker) reads it from the queue and starts the AI review.

	- If the enqueue fails, we only log it. We don't return an error. Why? Because we already saved the run to the DB. The run stays in queued status, and we can have a background job retry sending it to the queue. This is more durable than failing the whole request.
	*/

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
			// Structured log: run_id + repo + pr are fields so a log
			// aggregator can filter/alert on them, not parse a string.
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
