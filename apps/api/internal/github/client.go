package github

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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
