package main

import (
	"context"
	"log"      // print messages to the terminal
	"net/http" //Go's built-in tool to create an HTTP server.

	"os" //read environment variables (like `PORT`).

	"github.com/go-chi/chi/v5"            // chi=a lightweight router (decides which URL goes to which function)
	"github.com/go-chi/chi/v5/middleware" //helpers that run before/after requests (logging, recovery, etc.).

	"github.com/joho/godotenv" //reads variables from a `.env` file.

	"github.com/goldenk23/ai-devsecops-reviewer/api/internal/auth"
	"github.com/goldenk23/ai-devsecops-reviewer/api/internal/database"
	"github.com/goldenk23/ai-devsecops-reviewer/api/internal/webhook"
	"github.com/goldenk23/ai-devsecops-reviewer/api/internal/github"
	"github.com/goldenk23/ai-devsecops-reviewer/api/internal/queue"
	"github.com/goldenk23/ai-devsecops-reviewer/api/internal/api"
)

// corsMiddleware adds CORS headers so the browser (localhost:3000) can call
// this API (localhost:8080) without being blocked by the same-origin policy.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	
	// load .env file
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8000" // default port if not specified
	}

	// connect to the database
	dbpool, err := database.NewPool(context.Background())
	if err != nil {
		log.Fatalf("Error connecting to the database: %v", err)
	}
	defer dbpool.Close() // close the database connection when the main function exits
	log.Println("Connected to the PostgreSQL database")

	// create the auth handler
	authHandler := &auth.Handler{DB: dbpool}// create the auth handler with the database connection

	// craete webhook handler
	ghclient :=github.NewClient() // create a new GitHub client
	queueClient := queue.NewClient("localhost:6379")
	webhookHandler := &webhook.Handler{DB: dbpool, GitHub: ghclient, Queue: queueClient}
	
	//create api handler
	apiHandlers := &api.Handlers{DB: dbpool}
	
	// Create a new chi router
	r := chi.NewRouter()

	// Add middleware (these run on every request)
	r.Use(corsMiddleware)       // allow cross-origin requests from the frontend
	r.Use(middleware.Logger)    // log each request
	r.Use(middleware.Recoverer) // recover from panics so the server doesn't crash
	r.Use(middleware.RequestID) // add a unique ID to each request for 
	
	// health check endpoint used by docker to ckeck if the API is alive
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})
	// Auth routes
	r.Get("/auth/github", authHandler.LoginHandler)
	r.Get("/auth/github/callback", authHandler.CallbackHandler)

	// Api routes
	r.Route("/api", func(r chi.Router) {
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
	})

	r.Post("/webhooks/github", webhookHandler.HandleGitHubWebhook)

	// start the server
	log.Printf("API server is starting on port %s...", port)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatalf("Error starting server: %v", err)
	}

}