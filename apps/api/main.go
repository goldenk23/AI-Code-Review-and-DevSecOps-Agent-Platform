package main

import (
	"context"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/joho/godotenv"
	"go.uber.org/zap"

	"github.com/goldenk23/ai-devsecops-reviewer/api/internal/api"
	"github.com/goldenk23/ai-devsecops-reviewer/api/internal/auth"
	"github.com/goldenk23/ai-devsecops-reviewer/api/internal/database"
	"github.com/goldenk23/ai-devsecops-reviewer/api/internal/github"
	"github.com/goldenk23/ai-devsecops-reviewer/api/internal/queue"
	"github.com/goldenk23/ai-devsecops-reviewer/api/internal/webhook"
)

// corsMiddleware locks the API to a single configurable origin (NOT "*") since
// the dashboard is the only browser client. Override with CORS_ALLOWED_ORIGIN.
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

// zapLogger attaches a request-scoped zap logger to the request context.
func zapLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		logger := zap.L().With(
			zap.String("method", r.Method),
			zap.String("path", r.URL.Path),
			zap.String("remote", r.RemoteAddr),
		)
		ctx := r.Context()
		_ = logger
		_ = ctx
		next.ServeHTTP(w, r)
	})
}

func main() {
	logger, err := zap.NewProduction()
	if err != nil {
		// The logger failed to initialize, so panic and let the supervisor surface it.
		panic("failed to initialize zap logger: " + err.Error())
	}
	defer logger.Sync()
	zap.ReplaceGlobals(logger)

	if err := godotenv.Load(); err != nil {
		// Not fatal -- many deployments inject env vars directly.
		logger.Info("no .env file found, relying on process environment")
	}
	if err := validateDeploymentConfig(); err != nil {
		logger.Fatal("invalid deployment configuration", zap.Error(err))
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8000"
	}

	dbpool, err := database.NewPool(context.Background())
	if err != nil {
		logger.Fatal("failed to connect to PostgreSQL", zap.Error(err))
	}
	defer dbpool.Close()
	logger.Info("connected to PostgreSQL")

	authHandler := &auth.Handler{DB: dbpool}

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

	apiHandlers := &api.Handlers{DB: dbpool, Queue: queueClient}

	r := chi.NewRouter()

	r.Use(corsMiddleware)
	r.Use(zapLogger)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestID)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	// Worker health check -- proxied here so the browser only ever talks to one
	// host and avoids CORS against the worker's Prometheus metrics endpoint.
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

	r.Get("/auth/github", authHandler.LoginHandler)
	r.Get("/auth/github/callback", authHandler.CallbackHandler)
	r.Get("/auth/session", authHandler.SessionHandler)
	r.Post("/auth/logout", authHandler.LogoutHandler)

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
		// The worker hits this once it has saved all findings to post/update
		// the review-summary comment on the PR.
		r.Post("/analyses/{id}/post-comments", apiHandlers.PostComments)

		r.Get("/repositories", apiHandlers.ListRepositories)

		// Optional ?severity=&repo_id=&limit= filters.
		r.Get("/findings", apiHandlers.ListFindings)

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

	logger.Info("API server starting", zap.String("port", port))
	if err := http.ListenAndServe(":"+port, r); err != nil {
		logger.Fatal("server failed", zap.Error(err))
	}
}
