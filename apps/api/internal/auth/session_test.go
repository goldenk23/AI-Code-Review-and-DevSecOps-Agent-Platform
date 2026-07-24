package auth

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSessionTokenRoundTrip(t *testing.T) {
	t.Setenv("SESSION_SECRET", strings.Repeat("s", 32))
	token, err := NewSessionToken(42, "octocat", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := ParseSessionToken(token)
	if err != nil {
		t.Fatal(err)
	}
	if claims.UserID != 42 || claims.Username != "octocat" {
		t.Fatalf("unexpected claims: %+v", claims)
	}
}

func TestSessionTokenRejectsTamperingAndExpiry(t *testing.T) {
	t.Setenv("SESSION_SECRET", strings.Repeat("s", 32))
	token, err := NewSessionToken(1, "octocat", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseSessionToken("x" + token[1:]); err == nil {
		t.Fatal("tampered token was accepted")
	}
	expired, err := NewSessionToken(1, "octocat", -time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseSessionToken(expired); err == nil {
		t.Fatal("expired token was accepted")
	}
}

func TestSessionCookieIsSecureInProduction(t *testing.T) {
	t.Setenv("ENVIRONMENT", "production")
	recorder := httptest.NewRecorder()
	SetSessionCookie(recorder, "token")
	cookie := recorder.Result().Cookies()[0]
	if !cookie.HttpOnly || !cookie.Secure {
		t.Fatalf("production session cookie must be HttpOnly and Secure: %+v", cookie)
	}
}

func TestEncryptionKeyRequiredInProduction(t *testing.T) {
	t.Setenv("ENVIRONMENT", "production")
	t.Setenv("TOKEN_ENCRYPTION_KEY", "")
	if _, err := EncryptToken("token"); err == nil {
		t.Fatal("missing production encryption key was accepted")
	}
}



func TestGitHubUserAllowlist(t *testing.T) {
	t.Setenv("ENVIRONMENT", "production")
	t.Setenv("ALLOWED_GITHUB_USERS", "octocat, Mona")
	if !githubUserAllowed("mona") || githubUserAllowed("mallory") {
		t.Fatal("production GitHub allowlist was not enforced")
	}
	t.Setenv("ENVIRONMENT", "development")
	t.Setenv("ALLOWED_GITHUB_USERS", "")
	if !githubUserAllowed("any-local-user") {
		t.Fatal("development should allow login without an allowlist")
	}
}
