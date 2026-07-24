package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	DB *pgxpool.Pool
}

// LoginHandler redirects the user to GitHub's OAuth authorization page.
func (h *Handler) LoginHandler(w http.ResponseWriter, r *http.Request) {
	state, err := generateRandomState()
	if err != nil {
		http.Error(w, "failed to start OAuth flow", http.StatusInternalServerError)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: OAuthStateCookieName, Value: state, Path: "/", HttpOnly: true,
		Secure: secureCookies(), SameSite: http.SameSiteLaxMode,
		MaxAge: 600, Expires: time.Now().Add(10 * time.Minute),
	})
	http.Redirect(w, r, GetAuthURL(state), http.StatusFound)
}

// callbackHandler handles the callback from GitHub after user authorization.
func (h *Handler) CallbackHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")
	stateCookie, err := r.Cookie(OAuthStateCookieName)
	if code == "" || state == "" || err != nil || subtle.ConstantTimeCompare([]byte(state), []byte(stateCookie.Value)) != 1 {
		http.Error(w, "invalid OAuth callback", http.StatusBadRequest)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: OAuthStateCookieName, Value: "", Path: "/", HttpOnly: true,
		Secure: secureCookies(), SameSite: http.SameSiteLaxMode, MaxAge: -1,
	})

	accessToken, err := ExchangeCodeForToken(ctx, code)
	if err != nil {
		http.Error(w, "failed to exchange code for token", http.StatusBadGateway)
		return
	}
	user, err := GetUser(ctx, accessToken)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to get user: %v", err), http.StatusBadGateway)
		return
	}
	if !githubUserAllowed(user.Login) {
		http.Error(w, "GitHub user is not allowed for this deployment", http.StatusForbidden)
		return
	}
	repositories, err := GetRepositories(ctx, accessToken)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to list repositories: %v", err), http.StatusBadGateway)
		return
	}
	encToken, err := EncryptToken(accessToken)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to encrypt token: %v", err), http.StatusInternalServerError)
		return
	}

	tx, err := h.DB.Begin(ctx)
	if err != nil {
		http.Error(w, "failed to start user sync", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	var userID int64
	err = tx.QueryRow(ctx,
		`INSERT INTO users (github_id, username, oauth_token_encrypted)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (github_id) DO UPDATE
		 SET username = EXCLUDED.username, oauth_token_encrypted = EXCLUDED.oauth_token_encrypted
		 RETURNING id`,
		user.ID, user.Login, encToken,
	).Scan(&userID)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to save user: %v", err), http.StatusInternalServerError)
		return
	}
	if _, err = tx.Exec(ctx, "DELETE FROM repository_users WHERE user_id = $1", userID); err != nil {
		http.Error(w, fmt.Sprintf("failed to refresh repository access: %v", err), http.StatusInternalServerError)
		return
	}
	for _, repo := range repositories {
		var repoID int64
		err = tx.QueryRow(ctx,
			`INSERT INTO repositories (github_repo_id, full_name, owner)
			 VALUES ($1, $2, $3)
			 ON CONFLICT (github_repo_id) DO UPDATE
			 SET full_name = EXCLUDED.full_name, owner = EXCLUDED.owner
			 RETURNING id`,
			repo.ID, repo.FullName, repo.Owner.Login,
		).Scan(&repoID)
		if err != nil {
			http.Error(w, fmt.Sprintf("failed to sync repository: %v", err), http.StatusInternalServerError)
			return
		}
		if _, err = tx.Exec(ctx,
			`INSERT INTO repository_users (repo_id, user_id) VALUES ($1, $2)
			 ON CONFLICT (repo_id, user_id) DO UPDATE SET linked_at = now()`, repoID, userID,
		); err != nil {
			http.Error(w, fmt.Sprintf("failed to link repository: %v", err), http.StatusInternalServerError)
			return
		}
	}
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit user sync", http.StatusInternalServerError)
		return
	}

	sessionToken, err := NewSessionToken(userID, user.Login, sessionLifetime)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to create session: %v", err), http.StatusInternalServerError)
		return
	}
	SetSessionCookie(w, sessionToken)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "Login successful", "username": user.Login,
	})
}

func (h *Handler) SessionHandler(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(SessionCookieName)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	claims, err := ParseSessionToken(cookie.Value)
	if err != nil || !githubUserAllowed(claims.Username) {
		ClearSessionCookie(w)
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(claims)
}

func (h *Handler) LogoutHandler(w http.ResponseWriter, r *http.Request) {
	ClearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func githubUserAllowed(username string) bool {
	configured := strings.TrimSpace(os.Getenv("ALLOWED_GITHUB_USERS"))
	if configured == "" {
		environment := strings.ToLower(os.Getenv("ENVIRONMENT"))
		return environment == "" || environment == "development" || environment == "test"
	}
	for _, allowed := range strings.Split(configured, ",") {
		if strings.EqualFold(strings.TrimSpace(allowed), username) {
			return true
		}
	}
	return false
}

func generateRandomState() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
