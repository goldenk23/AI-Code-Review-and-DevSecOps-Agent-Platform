package github

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
)

// PostComment publishes a review comment on a pull request via
// POST /repos/{owner}/{repo}/pulls/{pr_number}/comments. commitSHA is optional
// and omitted from the payload when empty. Returns an error unless GitHub
// responds 201 Created.
func (c *client) PostComment(ctx context.Context, owner, repo string, prNumber int, body, token, commitSHA string) error {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/pulls/%d/comments", owner, repo, prNumber)

	payload := map[string]string{"body": body}
	if commitSHA != "" {
		payload["commit_id"] = commitSHA
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal comment payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(payloadBytes))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "AI-Code-Review-Bot")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to perform request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("GitHub API returned status %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}

// FindExistingComment returns the id of a PR comment whose body contains tag,
// or 0 if none matches. GitHub exposes PR comments on the issues endpoint
// (GET /repos/{owner}/{repo}/issues/{pr_number}/comments). A malformed JSON
// reply is treated as "no match" rather than failing the run.
func (c *client) FindExistingComment(ctx context.Context, owner, repo string, prNumber int, tag, token string) (int64, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/issues/%d/comments", owner, repo, prNumber)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return 0, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "AI-Code-Review-Bot")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("failed to perform request: %w", err)
	}
	defer resp.Body.Close()

	var comments []struct {
		ID   int64  `json:"id"`
		Body string `json:"body"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&comments); err != nil {
		return 0, nil
	}

	for _, comment := range comments {
		if strings.Contains(comment.Body, tag) {
			return comment.ID, nil
		}
	}

	return 0, nil
}

// CreateComment posts a new PR comment via
// POST /repos/{owner}/{repo}/issues/{pr_number}/comments. Returns an error
// unless GitHub responds 201 Created.
func (c *client) CreateComment(ctx context.Context, owner, repo string, prNumber int, body, token string) error {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/issues/%d/comments", owner, repo, prNumber)

	payload, err := json.Marshal(map[string]string{"body": body})
	if err != nil {
		return fmt.Errorf("failed to marshal comment payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "AI-Code-Review-Bot")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to perform request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		return fmt.Errorf("failed to post comment: HTTP %d", resp.StatusCode)
	}
	return nil
}

// UpdateComment edits an existing comment in place via
// PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}, keeping one
// comment per run instead of posting a duplicate on re-runs. Returns an error
// unless GitHub responds 200 OK.
func (c *client) UpdateComment(ctx context.Context, owner, repo string, commentID int64, body, token string) error {
	url := fmt.Sprintf(
		"https://api.github.com/repos/%s/%s/issues/comments/%s",
		owner, repo, strconv.FormatInt(commentID, 10),
	)

	payload, err := json.Marshal(map[string]string{"body": body})
	if err != nil {
		return fmt.Errorf("failed to marshal comment payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "PATCH", url, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "AI-Code-Review-Bot")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to perform request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to update comment: HTTP %d", resp.StatusCode)
	}
	return nil
}

// PostReviewComment creates a PR review comment anchored to specific lines,
// rendering a native GitHub ```suggestion block.
func (c *client) PostReviewComment(ctx context.Context, owner, repo string, prNumber int, body, path, commitSHA string, startLine, line int, token string) error {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/pulls/%d/comments", owner, repo, prNumber)

	// https://docs.github.com/en/rest/pulls/comments?apiVersion=2022-11-28#create-a-review-comment-for-a-pull-request
	payload := map[string]interface{}{
		"body":      body,
		"commit_id": commitSHA,
		"path":      path,
		"line":      line,
		"side":      "RIGHT",
	}

	// start_line is required for multi-line comments.
	if startLine > 0 && startLine != line {
		payload["start_line"] = startLine
		payload["start_side"] = "RIGHT"
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal review comment payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(payloadBytes))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "AI-Code-Review-Bot")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to perform request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("GitHub API returned status %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}
