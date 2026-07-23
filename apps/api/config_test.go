package main

import (
	"strings"
	"testing"
)

func setValidDeploymentConfig(t *testing.T) {
	t.Helper()
	values := map[string]string{
		"ENVIRONMENT": "production", "DATABASE_URL": "postgres://review:strong-password@db/app", "REDIS_ADDR": "redis:6379",
		"GITHUB_CLIENT_ID": "client", "GITHUB_CLIENT_SECRET": "client-secret",
		"GITHUB_WEBHOOK_SECRET": strings.Repeat("w", 32), "TOKEN_ENCRYPTION_KEY": strings.Repeat("ab", 32),
		"PORT": "8080", "GITHUB_CALLBACK_URL": "https://review.example.com/auth/github/callback",
		"API_KEY": strings.Repeat("a", 32), "SESSION_SECRET": strings.Repeat("s", 32),
		"CORS_ALLOWED_ORIGIN": "https://review.example.com", "WORKER_METRICS_URL": "http://worker:9090/metrics",
	}
	for key, value := range values {
		t.Setenv(key, value)
	}
}

func TestValidateDeploymentConfig(t *testing.T) {
	setValidDeploymentConfig(t)
	if err := validateDeploymentConfig(); err != nil {
		t.Fatal(err)
	}
}

func TestValidateDeploymentConfigRejectsMissingOrInsecureValues(t *testing.T) {
	setValidDeploymentConfig(t)
	t.Setenv("SESSION_SECRET", "")
	if err := validateDeploymentConfig(); err == nil {
		t.Fatal("missing SESSION_SECRET was accepted")
	}

	setValidDeploymentConfig(t)
	t.Setenv("GITHUB_CALLBACK_URL", "http://review.example.com/auth/github/callback")
	if err := validateDeploymentConfig(); err == nil {
		t.Fatal("non-HTTPS callback was accepted")
	}

	setValidDeploymentConfig(t)
	t.Setenv("API_KEY", "replace-with-64-hex-charactersxxxxxxxx")
	if err := validateDeploymentConfig(); err == nil {
		t.Fatal("placeholder API_KEY was accepted")
	}
}

func TestValidateDeploymentConfigSkipsDevelopment(t *testing.T) {
	t.Setenv("ENVIRONMENT", "development")
	if err := validateDeploymentConfig(); err != nil {
		t.Fatal(err)
	}
}
