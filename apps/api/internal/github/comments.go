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

/**
PostComment publishes a summary comment on a GitHub pull request.

It POSTs to GitHub's "create a review comment on a PR" REST endpoint:
   POST /repos/{owner}/{repo}/pulls/{pr_number}/comments

What each parameter is for:
  - ctx        : lifecycle/cancellation for the HTTP call.
  - owner, repo: the GitHub repo to comment on, e.g. owner="acme", repo="web".
  - prNumber   : the pull request number the run was triggered by.
  - body       : the Markdown text of the comment (we built this from findings).
  - token      : a GitHub OAuth token, used as a Bearer credential.
  - commitSHA  : optional commit SHA to anchor the comment to a specific commit.
                 (GitHub accepts it on this endpoint as `commit_id`; if empty,
                 we omit it so the server still accepts the request.)

Returns nil on a 201 Created (GitHub's success status for comment creation),
or an error containing GitHub's response body on failure.
*/
func (c *client) PostComment(ctx context.Context, owner, repo string, prNumber int, body, token, commitSHA string) error {
	// Build the URL: /repos/{owner}/{repo}/pulls/{pr}/comments
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/pulls/%d/comments", owner, repo, prNumber)

	// Build the JSON payload GitHub expects: {"body": "...", "commit_id": "..."}.
	// We use a map so we can skip commit_id when commitSHA is empty.
	payload := map[string]string{"body": body}
	if commitSHA != "" {
		payload["commit_id"] = commitSHA
	}
	// json.Marshal turns the map into a JSON byte slice (the request body).
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal comment payload: %w", err)
	}

	// Build an HTTP request with our cancellation context.
	// bytes.NewReader(payloadBytes) gives us an io.Reader over the JSON body.
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(payloadBytes))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	// Auth + content negotiation headers, same pattern as the other endpoints.
	// Bearer token authenticates us; the v3+json Accept tells GitHub "give me
	// the modern REST API"; User-Agent is required by GitHub's API policy.
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "AI-Code-Review-Bot")

	// Actually send the request.
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to perform request: %w", err)
	}
	// Always close the response body so we don't leak a connection.
	defer resp.Body.Close()

	// GitHub returns 201 Created on success for this endpoint, not 200.
	if resp.StatusCode != http.StatusCreated {
		// Read the body for the error message so the caller can debug.
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("GitHub API returned status %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}

/**
FindExistingComment searches a PR's comment list for one that already contains
our review's "tag" (a unique marker we put in every comment we write, such as
"<!-- ai-review-tag:run-42 -->"). Returning an existing comment's id lets the
caller UPDATE that comment instead of posting a duplicate on a re-run.

It GETs GitHub's "list issue comments" endpoint:
    GET /repos/{owner}/{repo}/issues/{pr_number}/comments

Note: GitHub treats PR comments as "issue comments" — they live on the same
endpoint as regular issue comments, which is why the URL says "issues" not
"pulls".

What each parameter is for:
  - ctx        : lifecycle/cancellation for the HTTP call.
  - owner, repo: the GitHub repo, e.g. owner="acme", repo="web".
  - prNumber   : the pull request number the run was triggered by.
  - tag        : a short unique string we embed in our comment's body so we
                 can recognize "this is our comment" later.
  - token      : a GitHub OAuth token, used as a Bearer credential.

Returns:
  - the comment id (>0) if an existing comment containing `tag` was found,
  - 0 if no matching comment was found (caller should create a new one),
  - an error only if the HTTP request itself failed (network down, etc.).
  A malformed JSON reply is silently treated as "no comments" — we'd rather
  say "nothing to update" than crash the whole run over a weird response.
*/
func (c *client) FindExistingComment(ctx context.Context, owner, repo string, prNumber int, tag, token string) (int64, error) {
	/*
	   Step 1: Build the URL we want to call.
	   %s/%s/issues/%d/comments fills in owner, repo, and prNumber.
	   We use the "issues" endpoint because on GitHub a PR is a kind of issue,
	   so PR comments are stored as issue comments.
	*/
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/issues/%d/comments", owner, repo, prNumber)

	/*
	   Step 2: Build a GET request. The body is nil because a GET request has
	   no request body — we are only asking GitHub to send us data.
	   http.NewRequestWithContext attaches our `ctx` so the request can be
	   cancelled if the caller's context expires (e.g. a timeout).
	*/
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return 0, fmt.Errorf("failed to create request: %w", err)
	}

	/*
	   Step 3: Set the same headers every GitHub REST call needs:
	     - Authorization: Bearer <token>  -> proves who we are.
	     - Accept: application/vnd.github+json -> "the modern REST API, please".
	     - User-Agent: AI-Code-Review-Bot -> GitHub requires a User-Agent on
	       every request; without it GitHub rejects the call with 403.
	*/
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "AI-Code-Review-Bot")

	/*
	   Step 4: Actually send the request using the shared HTTPClient pinned
	   to `c` (see client.go). resp holds GitHub's reply.
	*/
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("failed to perform request: %w", err)
	}
	// Always close the body when we're done so we don't leak a connection.
	defer resp.Body.Close()

	/*
	   Step 5: Decode the JSON reply into a Go slice (list) of comments.
	   We only care about two fields per comment, so we declare an anonymous
	   struct right here instead of a named type:
	     - ID   int64  -> GitHub's numeric id for this comment (used to PATCH it).
	     - Body string -> the Markdown text the comment contains.
	   We declare `comments` as a slice (the `[]`) because GitHub returns a
	   LIST of comments, not one.
	*/
	var comments []struct {
		ID   int64  `json:"id"`
		Body string `json:"body"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&comments); err != nil {
		/*
		   If the body wasn't valid JSON (e.g. an empty reply or an error
		   page), we treat it as "no comments found" rather than failing
		   the whole run. Return (0, nil) means "no match, no error".
		*/
		return 0, nil
	}

	/*
	   Step 6: Walk through every comment and see if its body mentions our
	   `tag` string. strings.Contains is a simple substring check — it
	   returns true if `tag` appears anywhere inside `comment.Body`.
	   The first match wins: we return that comment's id right away.
	*/
	for _, comment := range comments {
		if strings.Contains(comment.Body, tag) {
			return comment.ID, nil
		}
	}

	// Nothing matched. 0 means "please create a brand new comment".
	return 0, nil
}

/**
CreateComment posts a brand new PR comment to GitHub.

This is what we call when FindExistingComment returned 0 (no prior comment to
update). It POSTs to GitHub's "create an issue comment" endpoint:
    POST /repos/{owner}/{repo}/issues/{pr_number}/comments

GitHub treats PR comments as issue comments, which is why the URL says
"issues" — same reason as in FindExistingComment above.

What each parameter is for:
  - ctx        : lifecycle/cancellation for the HTTP call.
  - owner, repo: the GitHub repo, e.g. owner="acme", repo="web".
  - prNumber   : the pull request number to comment on.
  - body       : the Markdown text of the comment (built from findings).
  - token      : a GitHub OAuth token, used as a Bearer credential.

Returns nil on a 201 Created (GitHub's success status for "you made a thing"),
or an error otherwise (e.g. 401 if the token is bad, 404 if the repo/PR is
wrong, 403 if the token lacks permission to comment).
*/
func (c *client) CreateComment(ctx context.Context, owner, repo string, prNumber int, body, token string) error {
	/*
	   Step 1: Build the URL. Same shape as FindExistingComment but the HTTP
	   method will be POST instead of GET.
	*/
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/issues/%d/comments", owner, repo, prNumber)

	/*
	   Step 2: Build the JSON request body GitHub expects. A comment is just
	   a map with one key, "body", whose value is the Markdown text.
	   json.Marshal turns that map into a JSON byte slice like:
	     {"body": "## AI Review\n..."}
	*/
	payload, err := json.Marshal(map[string]string{"body": body})
	if err != nil {
		return fmt.Errorf("failed to marshal comment payload: %w", err)
	}

	/*
	   Step 3: Build the POST request. bytes.NewReader wraps our JSON bytes
	   into an io.Reader, which is what http.NewRequest wants for the body.
	*/
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	/*
	   Step 4: Same required headers as before, plus Content-Type: application/json
	   because this request HAS a body — we must tell GitHub what format it's in
	   or it won't know how to parse it.
	*/
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "AI-Code-Review-Bot")

	/*
	   Step 5: Send the request.
	*/
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to perform request: %w", err)
	}
	defer resp.Body.Close()

	/*
	   Step 6: Check the status code. GitHub returns 201 Created (not 200 OK)
	   when a POST successfully makes a new resource. If we got anything else,
	   the create failed and we surface the status code to the caller.
	*/
	if resp.StatusCode != http.StatusCreated {
		return fmt.Errorf("failed to post comment: HTTP %d", resp.StatusCode)
	}
	return nil
}

/**
UpdateComment edits an existing PR comment in place instead of posting a new one.

We call this when FindExistingComment returned a real comment id — meaning our
bot has already posted on this PR for this run before. Rather than spam a brand
new comment on every re-run, we PATCH (partially update) the old one so the
PR's timeline stays tidy: one comment that always shows the latest findings.

It PATCHes GitHub's "update an issue comment" endpoint:
    PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}

Note: the URL has no PR number this time — a comment id already uniquely
identifies one comment across all of GitHub, so the PR isn't needed.

What each parameter is for:
  - ctx        : lifecycle/cancellation for the HTTP call.
  - owner, repo: the GitHub repo, e.g. owner="acme", repo="web".
  - commentID  : the id of the existing comment we want to replace the body of.
                 (This number came from FindExistingComment.)
  - body       : the new Markdown text for the comment.
  - token      : a GitHub OAuth token, used as a Bearer credential.

Returns nil on a 200 OK (GitHub's success status for "you updated a thing"),
or an error otherwise.
*/
func (c *client) UpdateComment(ctx context.Context, owner, repo string, commentID int64, body, token string) error {
	/*
	   Step 1: Build the URL. strconv.FormatInt(commentID, 10) turns the
	   int64 id into a base-10 string like "1729". We do it this way rather
	   than %d because the user's reference snippet did; both produce the
	   same URL.
	*/
	url := fmt.Sprintf(
		"https://api.github.com/repos/%s/%s/issues/comments/%s",
		owner, repo, strconv.FormatInt(commentID, 10),
	)

	/*
	   Step 2: Build the new body. Same JSON shape as CreateComment: just
	   {"body": "..."}. GitHub replaces the entire comment body with this.
	*/
	payload, err := json.Marshal(map[string]string{"body": body})
	if err != nil {
		return fmt.Errorf("failed to marshal comment payload: %w", err)
	}

	/*
	   Step 3: Build the PATCH request. PATCH is the HTTP verb for "change
	   part of an existing resource" — exactly what we want here.
	*/
	req, err := http.NewRequestWithContext(ctx, "PATCH", url, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	/*
	   Step 4: Same headers as CreateComment.
	*/
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "AI-Code-Review-Bot")

	/*
	   Step 5: Send the request.
	*/
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to perform request: %w", err)
	}
	defer resp.Body.Close()

	/*
	   Step 6: Check the status code. For a successful PATCH, GitHub returns
	   200 OK (unlike POST which returns 201 Created). Anything else means
	   the update failed.
	*/
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to update comment: HTTP %d", resp.StatusCode)
	}
	return nil
}