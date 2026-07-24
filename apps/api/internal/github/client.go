package github

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type client struct {
	HTTPClient *http.Client
}

func NewClient() *client {
	return &client{
		HTTPClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// GetPRDiff fetches the diff for a pull request.
func (c *client) GetPRDiff(ctx context.Context, owner, repo string, prNumber int, token string) (string, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/pulls/%d", owner, repo, prNumber)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github.v3.diff")
	req.Header.Set("User-Agent", "AI-Code-Review-Bot")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to perform request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("GitHub API returned status %d: %s", resp.StatusCode, string(body))
	}
	diff, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response body: %w", err)
	}
	return string(diff), nil
}

// Webhook represents a GitHub repository webhook.
type Webhook struct {
	ID     int64  `json:"id"`
	Active bool   `json:"active"`
	Config struct {
		URL string `json:"url"`
	} `json:"config"`
}

// CreateWebhook installs a pull_request webhook on the given repo using the
// caller's OAuth token. Returns the webhook ID GitHub assigned, or an error.
// GitHub returns 422 if a webhook with the same URL already exists.
func (c *client) CreateWebhook(ctx context.Context, owner, repo, webhookURL, secret, token string) (int64, error) {
	body, _ := json.Marshal(map[string]interface{}{
		"name":   "web",
		"active": true,
		"events": []string{"pull_request"},
		"config": map[string]string{
			"url":          webhookURL,
			"content_type": "json",
			"secret":       secret,
		},
	})
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/hooks", owner, repo)
	req, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(body)))
	if err != nil {
		return 0, fmt.Errorf("create webhook request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "AI-Code-Review-Bot")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("create webhook: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusCreated {
		// 422 means a webhook with this URL already exists (e.g. a prior
		// connect attempt created the hook but failed before saving to the
		// DB). Make this idempotent: look up the existing hook and return
		// its ID so the caller can proceed to persist the repo.
		if resp.StatusCode == http.StatusUnprocessableEntity {
			if id, findErr := c.findWebhookByURL(ctx, owner, repo, webhookURL, token); findErr == nil && id != 0 {
				return id, nil
			}
		}
		return 0, fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, string(respBody))
	}
	var hook Webhook
	if err := json.Unmarshal(respBody, &hook); err != nil {
		return 0, fmt.Errorf("decode webhook response: %w", err)
	}
	return hook.ID, nil
}

// findWebhookByURL lists the repo's webhooks and returns the ID of the one
// whose config URL matches webhookURL, or 0 if none match.
func (c *client) findWebhookByURL(ctx context.Context, owner, repo, webhookURL, token string) (int64, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/hooks", owner, repo)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return 0, fmt.Errorf("list webhooks request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "AI-Code-Review-Bot")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("list webhooks: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("list webhooks returned %d: %s", resp.StatusCode, string(respBody))
	}
	var hooks []Webhook
	if err := json.Unmarshal(respBody, &hooks); err != nil {
		return 0, fmt.Errorf("decode webhooks list: %w", err)
	}
	for _, h := range hooks {
		if h.Config.URL == webhookURL {
			return h.ID, nil
		}
	}
	return 0, nil
}

// DeleteWebhook removes a webhook from the given repo.
func (c *client) DeleteWebhook(ctx context.Context, owner, repo string, hookID int64, token string) error {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/hooks/%d", owner, repo, hookID)
	req, err := http.NewRequestWithContext(ctx, "DELETE", url, nil)
	if err != nil {
		return fmt.Errorf("delete webhook request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "AI-Code-Review-Bot")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("delete webhook: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

type PRFile struct {
	Filename  string `json:"filename"`
	Status    string `json:"status"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
	Patch     string `json:"patch"`
}

// GetPRFiles fetches the list of changed files in a PR.
func (c *client) GetPRFiles(ctx context.Context, owner, repo string, prNumber int, token string) ([]PRFile, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/pulls/%d/files", owner, repo, prNumber)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github.v3.diff")
	req.Header.Set("User-Agent", "AI-Code-Review-Bot")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to perform request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("GitHub API returned status %d: %s", resp.StatusCode, string(body))
	}

	var files []PRFile
	if err := json.NewDecoder(resp.Body).Decode(&files); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return files, nil
}
