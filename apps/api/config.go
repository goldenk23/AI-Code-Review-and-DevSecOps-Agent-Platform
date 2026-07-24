package main

import (
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
)

func validateDeploymentConfig() error {
	environment := strings.ToLower(strings.TrimSpace(os.Getenv("ENVIRONMENT")))
	if environment == "" || environment == "development" || environment == "test" {
		return nil
	}

	required := []string{
		"DATABASE_URL", "REDIS_ADDR", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET",
		"GITHUB_WEBHOOK_SECRET", "TOKEN_ENCRYPTION_KEY", "PORT", "GITHUB_CALLBACK_URL",
		"API_KEY", "SESSION_SECRET", "ALLOWED_GITHUB_USERS", "CORS_ALLOWED_ORIGIN", "WORKER_METRICS_URL",
	}
	for _, name := range required {
		if strings.TrimSpace(os.Getenv(name)) == "" {
			return fmt.Errorf("%s must be set when ENVIRONMENT=%s", name, environment)
		}
	}

	for _, name := range []string{"GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"} {
		lower := strings.ToLower(os.Getenv(name))
		if strings.Contains(lower, "your-") || strings.Contains(lower, "change-me") || strings.Contains(lower, "replace-with") {
			return fmt.Errorf("%s must not be a placeholder", name)
		}
	}
	databaseURL, err := url.Parse(os.Getenv("DATABASE_URL"))
	if err != nil || databaseURL.Host == "" || databaseURL.User == nil {
		return fmt.Errorf("DATABASE_URL must use non-development credentials")
	}
	password, hasPassword := databaseURL.User.Password()
	if !hasPassword || password == "reviewpass" || strings.Contains(password, "replace-with") {
		return fmt.Errorf("DATABASE_URL must use non-development credentials")
	}

	for _, name := range []string{"API_KEY", "SESSION_SECRET", "GITHUB_WEBHOOK_SECRET"} {
		value := os.Getenv(name)
		lower := strings.ToLower(value)
		if len(value) < 32 || strings.Contains(lower, "change-me") || strings.Contains(lower, "dev-local") || strings.Contains(lower, "replace-with") {
			return fmt.Errorf("%s must be a non-placeholder secret of at least 32 characters", name)
		}
	}
	if os.Getenv("API_KEY") == os.Getenv("SESSION_SECRET") {
		return fmt.Errorf("API_KEY and SESSION_SECRET must be different")
	}

	key, err := hex.DecodeString(os.Getenv("TOKEN_ENCRYPTION_KEY"))
	if err != nil || len(key) != 32 || strings.Trim(os.Getenv("TOKEN_ENCRYPTION_KEY"), "0") == "" {
		return fmt.Errorf("TOKEN_ENCRYPTION_KEY must be a non-zero 64-character hex key")
	}
	port, err := strconv.Atoi(os.Getenv("PORT"))
	if err != nil || port < 1 || port > 65535 {
		return fmt.Errorf("PORT must be a valid TCP port")
	}
	for _, name := range []string{"GITHUB_CALLBACK_URL", "CORS_ALLOWED_ORIGIN"} {
		u, err := url.Parse(os.Getenv(name))
		if err != nil || u.Scheme != "https" || u.Host == "" {
			return fmt.Errorf("%s must be an absolute https URL", name)
		}
	}
	metricsURL, err := url.Parse(os.Getenv("WORKER_METRICS_URL"))
	if err != nil || metricsURL.Host == "" || (metricsURL.Scheme != "http" && metricsURL.Scheme != "https") {
		return fmt.Errorf("WORKER_METRICS_URL must be an absolute http(s) URL")
	}
	return nil
}
