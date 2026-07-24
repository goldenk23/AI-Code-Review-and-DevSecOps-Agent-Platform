package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
)

// GitHubUser represents user info we get from GitHub's API.
type GitHubUser struct {
	ID        int64  `json:"id"`
	Login     string `json:"login"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
}

// GetAuthURL returns the GitHub OAuth authorization URL.
func GetAuthURL(state string) string {
	clientID := os.Getenv("GITHUB_CLIENT_ID")
	callbackURL := os.Getenv("GITHUB_CALLBACK_URL")

	u, err := url.Parse("https://github.com/login/oauth/authorize")
	if err != nil {
		panic(err)
	}

	q := u.Query()
	q.Set("client_id", clientID)
	q.Set("redirect_uri", callbackURL)
	q.Set("scope", "repo")
	q.Set("state", state)
	u.RawQuery = q.Encode()

	return u.String()
}

// ExchangeCodeForToken trades the temporary OAuth code for an access token.
func ExchangeCodeForToken(ctx context.Context, code string) (string, error) {
	clientID := os.Getenv("GITHUB_CLIENT_ID")
	clientSecret := os.Getenv("GITHUB_CLIENT_SECRET")

	payload := url.Values{
		"client_id":     {clientID},
		"client_secret": {clientSecret},
		"code":          {code},
	}

	req, err := http.NewRequestWithContext(ctx, "POST",
		"https://github.com/login/oauth/access_token",
		strings.NewReader(payload.Encode()))
	if err != nil {
		return "", err
	}

	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var result struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}

	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("failed to parse token response: %w (body: %s)", err, string(body))
	}
	if result.Error != "" {
		return "", fmt.Errorf("GitHub error: %s", result.Error)
	}
	if result.AccessToken == "" {
		// GitHub returned a non-2xx (e.g. 403 "bad_verification_code" when the
		// same code is exchanged twice) but no top-level `error` field. Surface
		// the raw body so the caller sees why the token exchange failed instead
		// of a silent empty token that later breaks GetUser.
		return "", fmt.Errorf("GitHub returned no access_token (HTTP %d): %s", resp.StatusCode, string(body))
	}
	return result.AccessToken, nil
}

// GetUser fetches the authenticated user's profile from GitHub.
func GetUser(ctx context.Context, accessToken string) (*GitHubUser, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/user", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	// GitHub returns 401 when the access token is empty/invalid. Without this
	// check we'd unmarshal an empty body into a zero-value user and silently
	// upsert a user with github_id=0, which breaks later lookups.
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub /user returned HTTP %d: %s", resp.StatusCode, string(body))
	}

	var user GitHubUser
	if err := json.Unmarshal(body, &user); err != nil {
		return nil, fmt.Errorf("failed to parse user response: %w (body: %s)", err, string(body))
	}
	if user.ID == 0 || user.Login == "" {
		return nil, fmt.Errorf("GitHub returned an incomplete user profile: %+v", user)
	}
	return &user, nil
}

type GitHubRepository struct {
	ID       int64  `json:"id"`
	FullName string `json:"full_name"`
	Owner    struct {
		Login string `json:"login"`
	} `json:"owner"`
}

// GetRepositories returns repositories the authenticated user can access.
// Following GitHub's Link header keeps the mapping correct for accounts with
// more than one page of repositories.
func GetRepositories(ctx context.Context, accessToken string) ([]GitHubRepository, error) {
	nextURL := "https://api.github.com/user/repos?per_page=100&affiliation=owner,collaborator,organization_member"
	var repositories []GitHubRepository
	for page := 0; nextURL != ""; page++ {
		if page >= 100 {
			return nil, fmt.Errorf("GitHub repository pagination exceeded 100 pages")
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, nextURL, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+accessToken)
		req.Header.Set("Accept", "application/vnd.github+json")
		req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return nil, err
		}
		body, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			return nil, readErr
		}
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("GitHub /user/repos returned HTTP %d: %s", resp.StatusCode, string(body))
		}
		var pageRepositories []GitHubRepository
		if err := json.Unmarshal(body, &pageRepositories); err != nil {
			return nil, fmt.Errorf("failed to parse repositories response: %w", err)
		}
		repositories = append(repositories, pageRepositories...)
		nextURL = githubNextLink(resp.Header.Get("Link"))
	}
	return repositories, nil
}

func githubNextLink(linkHeader string) string {
	for _, link := range strings.Split(linkHeader, ",") {
		parts := strings.Split(link, ";")
		if len(parts) < 2 || strings.TrimSpace(parts[1]) != `rel="next"` {
			continue
		}
		return strings.Trim(strings.TrimSpace(parts[0]), "<>")
	}
	return ""
}
