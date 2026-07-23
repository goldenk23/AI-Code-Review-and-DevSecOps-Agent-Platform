package api

import (
	"crypto/subtle"
	"net/http"
	"os"

	"go.uber.org/zap"
)

// RequireAPIKey guards the /api routes with a shared secret sent in the
// X-API-Key header. The Next.js dashboard injects this header server-side (in
// proxy.ts), so the browser never holds the key and a request that skips the
// dashboard -- e.g. a direct curl to the API host -- is rejected.
//
// If API_KEY is unset we log a warning and allow the request. That keeps local
// `go run` / start.ps1 working out of the box and mirrors the dev-key fallback
// in auth/crypto.go. Set API_KEY (and the matching web-side value) in any
// shared or deployed environment.
func RequireAPIKey(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		expected := os.Getenv("API_KEY")
		if expected == "" {
			zap.L().Warn("API_KEY not set -- /api routes are UNAUTHENTICATED (dev only)")
			next.ServeHTTP(w, r)
			return
		}
		// Constant-time compare so a wrong key can't be teased out by timing.
		// ConstantTimeCompare also returns 0 on a length mismatch.
		got := r.Header.Get("X-API-Key")
		if subtle.ConstantTimeCompare([]byte(got), []byte(expected)) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}
