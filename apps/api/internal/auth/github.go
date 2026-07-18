package auth

import (
	"context"
	"encoding/json" //to convert JSON text into Go structs (and back)

	"fmt"
	"io" //to read response bodies.

	"net/http" //to make HTTP requests.

	"net/url" //to build/query URLs safely.

	"os"
	"strings" //to create a string reader
)

// GitHubUser represents user info we get from GitHub's API.
type GitHubUser struct {
	ID        int64  `json:"id"`         // GitHub's unique user ID.
	Login     string `json:"login"`      // GitHub username.
	Name      string `json:"name"`       // GitHub display name.
	AvatarURL string `json:"avatar_url"` // URL to the user's avatar image.
}

// GetAuthURL returns the GitHub OAuth authorization URL.
func GetAuthURL(state string) string {
	clientID := os.Getenv("GITHUB_CLIENT_ID")
	callbackURL := os.Getenv("GITHUB_CALLBACK_URL") // is where GitHub will redirect user after they approve login.

	u, err := url.Parse("https://github.com/login/oauth/authorize") //Parses (breaks down) the base GitHub OAuth URL into a `url.URL` object so we can modify it

	if err != nil {
		panic(err)
	}

	q := u.Query() //returns the query parameters of the URL (the stuff after `?`).

	q.Set("client_id", clientID)       // Tell GitHub which app is requesting access
	q.Set("redirect_uri", callbackURL) // After user approves, send them back to this URL
	q.Set("scope", "repo")             // What permissions we want (repo = full repo access)
	q.Set("state", state)              // Secret random string - verifies response is legit, not fake
	u.RawQuery = q.Encode()            // Convert map back to URL string format

	// example output: https://github.com/login/oauth/authorize?client_id=ABC&redirect_uri=...&scope=repo&state=xyz

	return u.String()
}

// ExchangeCodeForToken trades the temporary "code" for a permanent "access token".After the user approves on GitHub, GitHub redirects them back with a temporary `code`. We trade that code for a permanent __access token__.

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

	req.Header.Set("Accept", "application/json") // GitHub will return JSON instead of URL-encoded string

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	//defer = "do this later, when function finishes"
	// resp.Body.Close() = free up resources
	defer resp.Body.Close() //Closes the response when the function ends.

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var result struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}

	if err := json.Unmarshal(body, &result); err != nil { // Converts JSON bytes → Go struct. If parsing fails, return error
		return "", fmt.Errorf("failed to parse token response: %w (body: %s)", err, string(body))
	}
	if result.Error != "" {
		return "", fmt.Errorf("GitHub error: %s", result.Error)
	}
	if result.AccessToken == "" {
		// GitHub returned a non-2xx (e.g. 403 "bad_verification_code" when the
		// same code is exchanged twice) but no top-level `error` field. Surface
		// the raw body so the caller sees WHY the token exchange failed instead
		// of a silent empty token that later breaks GetUser.
		return "", fmt.Errorf("GitHub returned no access_token (HTTP %d): %s", resp.StatusCode, string(body))
	}
	return result.AccessToken, nil
}

// GetUser uses acess token to fetch user info from GitHub's API.
func GetUser(ctx context.Context, accessToken string) (*GitHubUser, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/user", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)  // GitHub expects the access token in the Authorization header.
	req.Header.Set("Accept", "application/vnd.github+json") //GitHub's API versioning. This header tells GitHub we want the latest version of the API.

	resp, err := http.DefaultClient.Do(req)// Sends the request to GitHub's API and gets the response.
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close() //Closes the response when the function ends.

   /**
   io.ReadAll() takes the data from GitHub's response and stores it in your computer's RAM (temporary memory) so your program can work with it.
	Once stored in RAM, you can search, parse, or use the data however you want.
   */
	body, err := io.ReadAll(resp.Body)// Reads the entire response body into memory. This is safe because GitHub's user API response is small.
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
	if err := json.Unmarshal(body, &user); err != nil { // Converts JSON bytes → Go struct. If parsing fails, return error
		return nil, fmt.Errorf("failed to parse user response: %w (body: %s)", err, string(body))
	}
	if user.ID == 0 || user.Login == "" {
		return nil, fmt.Errorf("GitHub returned an incomplete user profile: %+v", user)
	}
	return &user, nil
}
