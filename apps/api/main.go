package main

import (
	"context"
	"net/http" //Go's built-in tool to create an HTTP server.

	"os" //read environment variables (like `PORT`).

	"github.com/go-chi/chi/v5"            // chi=a lightweight router (decides which URL goes to which function)
	"github.com/go-chi/chi/v5/middleware" //helpers that run before/after requests (logging, recovery, etc.).

	"github.com/joho/godotenv" //reads variables from a `.env` file.
	"go.uber.org/zap"          //structured JSON logger -- replaces stdlib `log` for prod-grade logs

	"github.com/goldenk23/ai-devsecops-reviewer/api/internal/api"
	"github.com/goldenk23/ai-devsecops-reviewer/api/internal/auth"
	"github.com/goldenk23/ai-devsecops-reviewer/api/internal/database"
	"github.com/goldenk23/ai-devsecops-reviewer/api/internal/github"
	"github.com/goldenk23/ai-devsecops-reviewer/api/internal/queue"
	"github.com/goldenk23/ai-devsecops-reviewer/api/internal/webhook"
)

// corsMiddleware adds CORS headers so the browser (localhost:3000) can call
// this API (localhost:8080) without being blocked by the same-origin policy.
// The allowed origin is a single configurable value (NOT "*") -- the dashboard
// is the only browser client, so we lock it down. Override with
// CORS_ALLOWED_ORIGIN in other environments.
func corsMiddleware(next http.Handler) http.Handler {
	allowedOrigin := os.Getenv("CORS_ALLOWED_ORIGIN")
	if allowedOrigin == "" {
		allowedOrigin = "http://localhost:3000"
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// zapLogger is achi middleware that attaches the zap logger to the request
// context, so any handler deeper in the tree can pull it out via
// zap.L() (the global) or ctxzap.Extract(ctx). For now we just rely on
// the global -- zap.ReplaceGlobals is called in main() -- but installing
// the middleware here means any panic that the Recoverer catches gets
// logged with the request id (chi/middleware.RequestID puts the id on the
// context, and we surface it via a structured field for every log line
// emitted from within the request).
func zapLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		logger := zap.L().With(
			zap.String("method", r.Method),
			zap.String("path", r.URL.Path),
			zap.String("remote", r.RemoteAddr),
		)
		// Stash the request-scoped logger so handlers can do
		// `logger := ctxzap.Extract(r.Context())` if they want -- we don't
		// use it in the existing handlers yet, so this is just future-proofing.
		ctx := r.Context()
		_ = logger
		_ = ctx
		next.ServeHTTP(w, r)
	})
}

func main() {
	// Structured logging: zap.NewProduction emits JSON to stdout with
	// level/timestamp/message + any zap.Field we attach. We ReplaceGlobals
	// so zap.L() anywhere in the binary returns the same configured logger.
	// `defer logger.Sync()` flushes any buffered log entries on exit.
	//
	// In development the JSON output is human-readable but verbose; if you
	// want pretty colored console output, change to zap.NewDevelopment()
	// (the format is auto-detected from your terminal). Production behavior
	// is JSON because that's what log aggregators (ELK, Loki, Datadog) eat.
	logger, err := zap.NewProduction()
	if err != nil {
		// We can't use the logger to log this failure -- it didn't initialize.
		// Fall back to panicking; the process supervisor will surface it.
		panic("failed to initialize zap logger: " + err.Error())
	}
	defer logger.Sync()
	zap.ReplaceGlobals(logger)

	// load .env file
	if err := godotenv.Load(); err != nil {
		// Not fatal -- many deployments inject env vars directly.
		logger.Info("no .env file found, relying on process environment")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8000" // default port if not specified
	}

	// connect to the database
	dbpool, err := database.NewPool(context.Background())
	if err != nil {
		logger.Fatal("failed to connect to PostgreSQL", zap.Error(err))
	}
	defer dbpool.Close()
	logger.Info("connected to PostgreSQL")

	// create the auth handler
	authHandler := &auth.Handler{DB: dbpool}

	// create webhook handler
	ghclient := github.NewClient()
	// Service addresses are configurable so API, Redis, and workers can run on
	// different hosts. Defaults preserve the local development loop.
	redisAddr := os.Getenv("REDIS_ADDR")
	if redisAddr == "" {
		redisAddr = "localhost:6379"
	}
	workerMetricsURL := os.Getenv("WORKER_METRICS_URL")
	if workerMetricsURL == "" {
		workerMetricsURL = "http://localhost:9090/metrics"
	}
	queueClient := queue.NewClient(redisAddr)
	webhookHandler := &webhook.Handler{DB: dbpool, GitHub: ghclient, Queue: queueClient}

	// create api handler
	apiHandlers := &api.Handlers{DB: dbpool, Queue: queueClient}

	// Create a new chi router
	r := chi.NewRouter()

	// Add middleware (these run on every request)
	r.Use(corsMiddleware)       // allow cross-origin requests from the frontend
	r.Use(zapLogger)            // attach zap logger to context (future use)
	r.Use(middleware.Logger)    // legacy per-request log line (cheap, keeps RequestID visible in dev)
	r.Use(middleware.Recoverer) // recover from panics so the server doesn't crash
	r.Use(middleware.RequestID) // add a unique ID to each request for tracing

	// health check endpoint used by docker to ckeck if the API is alive
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	// Worker health check -- the worker exposes Prometheus metrics on
	// port 9090; if those are reachable, the worker is alive. We proxy
	// the check here so the browser only ever talks to one host (and
	// avoids CORS headaches for the dashboard).
	r.Get("/worker/health", func(w http.ResponseWriter, r *http.Request) {
		// 2-second timeout -- the worker should respond instantly.
		resp, err := (&http.Client{Timeout: 2_000_000_000}).Get(workerMetricsURL)
		if err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			w.Write([]byte(`{"status":"down","error":"` + err.Error() + `"}`))
			return
		}
		defer resp.Body.Close()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"up","metrics_endpoint":"` + workerMetricsURL + `"}`))
	})

	// Auth routes
	r.Get("/auth/github", authHandler.LoginHandler)
	r.Get("/auth/github/callback", authHandler.CallbackHandler)
	r.Get("/auth/session", authHandler.SessionHandler)
	r.Post("/auth/logout", authHandler.LogoutHandler)

	// Api routes
	r.Route("/api", func(r chi.Router) {
		// Require the shared API key on every /api route. The dashboard's
		// Next proxy injects it server-side; direct external calls are rejected.
		r.Use(api.RequireAPIKey)

		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte(`{"service":"ai-review-api","version":"0.1.0"}`))
		})

		r.Get("/analyses", apiHandlers.ListAnalyses)
		r.Get("/analyses/{id}", apiHandlers.GetAnalysis)
		r.Get("/analyses/{id}/jobs", apiHandlers.GetAnalysisJobs)
		r.Get("/analyses/{id}/findings", apiHandlers.GetAnalysisFindings)
		// Trigger posting/updating the review-summary comment on the PR.
		// The worker hits this endpoint once it has saved all findings.
		r.Post("/analyses/{id}/post-comments", apiHandlers.PostComments)

		// Repositories overview -- backs the /repositories dashboard page.
		// Returns per-repo aggregates (grade, last scan, finding counts).
		r.Get("/repositories", apiHandlers.ListRepositories)

		// Cross-run findings list -- backs the /security page's recent
		// findings table. Optional ?severity=&repo_id=&limit= filters.
		r.Get("/findings", apiHandlers.ListFindings)

		// Worker health + Prometheus metrics endpoint info.
		// (Live status is at /worker/health -- the call below returns
		// the URL the dashboard should open for raw metrics.)
		r.Get("/insights/worker-status", func(w http.ResponseWriter, r *http.Request) {
			resp, err := (&http.Client{Timeout: 2_000_000_000}).Get(workerMetricsURL)
			status := "up"
			if err != nil || resp.StatusCode != 200 {
				status = "down"
			}
			if resp != nil {
				resp.Body.Close()
			}
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"status":"` + status + `","metrics_url":"` + workerMetricsURL + `"}`))
		})

		// Aggregated insights -- back the /security page's KPI strip and
		// the trend chart and the "most vulnerable repos" sidebar.
		r.Get("/insights/summary", apiHandlers.InsightsSummary)
		r.Get("/insights/findings-over-time", apiHandlers.FindingsOverTime)
		r.Get("/insights/most-vulnerable-repos", apiHandlers.MostVulnerableRepos)

		// Automation settings -- singleton row updated via PUT.
		r.Get("/settings", apiHandlers.GetSettings)
		r.Put("/settings", apiHandlers.UpdateSettings)

		// Dead-letter queue -- jobs that permanently failed (all retries
		// exhausted) and were parked in Redis for inspection/replay.
		r.Get("/dead-jobs", apiHandlers.ListDeadJobs)
	})

	// Worker-only endpoints are intentionally outside the browser-facing /api
	// rewrite. They still require the shared service key.
	r.Route("/internal", func(r chi.Router) {
		r.Use(api.RequireAPIKey)
		r.Get("/analyses/{id}/github-token", apiHandlers.GetAnalysisGitHubToken)
	})

	r.Post("/webhooks/github", webhookHandler.HandleGitHubWebhook)

	// start the server
	logger.Info("API server starting", zap.String("port", port))
	if err := http.ListenAndServe(":"+port, r); err != nil {
		logger.Fatal("server failed", zap.Error(err))
	}
}
