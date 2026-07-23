package github

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

/**
This is the phone. It has one part: HTTPClient, which is Go's built-in tool for making web requests.
*/
type client struct {
	HTTPClient *http.Client
}

/**
- func NewClient() *Client → a standalone function (not a method — no receiver in parentheses) that takes no arguments and returns a pointer to a Client.

- &Client{ ... } → creates a new Client and gives back its address (the & means "address of"). So the caller gets a pointer, not a copy.

- &http.Client{} → creates a fresh, default http.Client with no custom settings (timeouts, transport, etc.). The empty {} means "use the defaults." .Set a timeout here, like &http.Client{Timeout: 30 * time.Second}, so a slow GitHub doesn't hang you forever.
*/
func NewClient() *client {
	return &client{
		HTTPClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// GetPRDiff fetches the diff for a pull request
func (c *client) GetPRDiff(ctx context.Context, owner, repo string, prNumber int, token string) (string, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/pulls/%d", owner, repo, prNumber)

	/**
	- http.NewRequestWithContext(ctx, "GET", url, nil) → build an HTTP request object. The WithContext variant attaches our cancellation timer to the request (so if the user cancels, GitHub call also stops). "GET" is the HTTP method. nil is the body — GET requests typically have no body.
	*/
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	/**
	- Authorization: Bearer <token> → GitHub's required way to say "I'm allowed to access this." Bearer is a keyword from the OAuth standard. "Bearer "+token is string concatenation (Go uses +).
	- Accept: application/vnd.github.v3.diff → tells GitHub "I want the response in .diff format" (the raw patch text). Without this, GitHub returns JSON metadata instead of the diff.
	- User-Agent: AI-Code-Review-Bot → identifies who's calling. GitHub requires a User-Agent; if you skip it, they reject the request.
	*/
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

// GetPRFiles fetches the list of changed files in a PR

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
