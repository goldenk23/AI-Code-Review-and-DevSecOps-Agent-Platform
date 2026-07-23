package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// passHandler is the downstream handler; a 200 means the middleware let the
// request through.
var passHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
})

func statusFor(h http.Handler, key string) int {
	req := httptest.NewRequest(http.MethodGet, "/api/analyses", nil)
	if key != "" {
		req.Header.Set("X-API-Key", key)
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr.Code
}

func TestRequireAPIKey_CorrectKeyPasses(t *testing.T) {
	t.Setenv("API_KEY", "secret")
	if code := statusFor(RequireAPIKey(passHandler), "secret"); code != http.StatusOK {
		t.Fatalf("correct key: got %d, want 200", code)
	}
}

func TestRequireAPIKey_WrongOrMissingKeyRejected(t *testing.T) {
	t.Setenv("API_KEY", "secret")
	if code := statusFor(RequireAPIKey(passHandler), "wrong"); code != http.StatusUnauthorized {
		t.Fatalf("wrong key: got %d, want 401", code)
	}
	if code := statusFor(RequireAPIKey(passHandler), ""); code != http.StatusUnauthorized {
		t.Fatalf("missing key: got %d, want 401", code)
	}
}

func TestRequireAPIKey_UnsetAllowsForDev(t *testing.T) {
	t.Setenv("API_KEY", "")
	if code := statusFor(RequireAPIKey(passHandler), ""); code != http.StatusOK {
		t.Fatalf("unset API_KEY should allow (dev fallback): got %d, want 200", code)
	}
}
