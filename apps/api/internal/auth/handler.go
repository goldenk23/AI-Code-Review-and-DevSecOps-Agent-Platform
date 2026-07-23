package auth

import (
	"crypto/rand"   // generates cryptographically secure random numbers (used for OAuth state)
	"encoding/hex"  //  converts bytes to hex string.
	"encoding/json" //encodes/decodes JSON responses
	"fmt"
	"net/http" // Go's built-in HTTP server & handlers

	"github.com/jackc/pgx/v5/pgxpool" // PostgreSQL connection pool driver (pgx v5)
)

type Handler struct {
	DB *pgxpool.Pool // Database connection pool
}

//  LoginHandler redirects the user to GitHub's OAuth authorization page.
func (h *Handler) LoginHandler(w http.ResponseWriter, r *http.Request) {
	state := generateRandomState()                           // Generate a random state string for CSRF protection
	http.Redirect(w, r, GetAuthURL(state), http.StatusFound) // Redirect user to GitHub's OAuth page
}

// callbackHandler handles the callback from GitHub after user authorization.
func (h *Handler) CallbackHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()                // Get the request context for cancellation and timeouts
	code := r.URL.Query().Get("code") // Get the temporary code from the query parameters

	if code == "" {
		http.Error(w, "Missing code in callback", http.StatusBadRequest)
		return
	}
	// step1: Exchange the temporary code for an access token
	accessToken, err := ExchangeCodeForToken(ctx, code)
	if err != nil {
		http.Error(w, "Failed to exchange code for token", http.StatusInternalServerError)
		return
	}

	// step2: Get the user's GitHub profile
	user, err := GetUser(ctx, accessToken)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to get user: %v", err), http.StatusInternalServerError)
		return
	}

	// step3: Save user to the database
	encToken, err := EncryptToken(accessToken)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to encrypt token: %v", err), http.StatusInternalServerError)
		return
	}
	_, err = h.DB.Exec(ctx,
		`INSERT INTO users (github_id, username, oauth_token_encrypted) VALUES ($1, $2, $3) ON CONFLICT (github_id) DO UPDATE SET username = $2, oauth_token_encrypted = $3`,
		user.ID,
		user.Login,
		encToken,
	)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to save user: %v", err), http.StatusInternalServerError)
		return
	}
	//STEP4: Redirect user to the frontend with a success message
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message":  "Login successful",
		"username": user.Login,
	})
}

func generateRandomState() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}
