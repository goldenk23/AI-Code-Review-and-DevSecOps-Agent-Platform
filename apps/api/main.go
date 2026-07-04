package main

import (
	"log" // print messages to the terminal
	"net/http" //Go's built-in tool to create an HTTP server.

	"os"  //read environment variables (like `PORT`).

	"github.com/go-chi/chi/v5"// chi=a lightweight router (decides which URL goes to which function)
	"github.com/go-chi/chi/v5/middleware" //helpers that run before/after requests (logging, recovery, etc.).

	"github.com/joho/godotenv" //reads variables from a `.env` file.

)

func main() {
	
	// load .env file
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8000" // default port if not specified
	}

	// Create a new chi router
	r := chi.NewRouter()

	// Add middleware (these run on every request)
	r.Use(middleware.Logger)    // log each request
	r.Use(middleware.Recoverer) // recover from panics so the server doesn't crash
	r.Use(middleware.RequestID) // add a unique ID to each request for 
	
	// health check endpoint used by docker to ckeck if the API is alive
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	// Api routes
	r.Route("/api", func(r chi.Router) {
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte(`{"service":"ai-review-api","version":"0.1.0"}`))
		})
	})

	// start the server
	log.Printf("API server is starting on port %s...", port)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatalf("Error starting server: %v", err)
	}

}