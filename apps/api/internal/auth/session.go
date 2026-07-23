package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	SessionCookieName    = "cp-session"
	OAuthStateCookieName = "cp-oauth-state"
	sessionLifetime      = 24 * time.Hour
)

type SessionClaims struct {
	UserID    int64  `json:"uid"`
	Username  string `json:"username"`
	ExpiresAt int64  `json:"exp"`
}

func sessionSecret() ([]byte, error) {
	secret := os.Getenv("SESSION_SECRET")
	if len(secret) < 32 {
		return nil, errors.New("SESSION_SECRET must be at least 32 characters")
	}
	return []byte(secret), nil
}

func NewSessionToken(userID int64, username string, lifetime time.Duration) (string, error) {
	secret, err := sessionSecret()
	if err != nil {
		return "", err
	}
	claims := SessionClaims{UserID: userID, Username: username, ExpiresAt: time.Now().Add(lifetime).Unix()}
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(encoded))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return encoded + "." + signature, nil
}

func ParseSessionToken(token string) (*SessionClaims, error) {
	secret, err := sessionSecret()
	if err != nil {
		return nil, err
	}
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return nil, errors.New("invalid session token")
	}
	provided, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, errors.New("invalid session signature")
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(parts[0]))
	if !hmac.Equal(provided, mac.Sum(nil)) {
		return nil, errors.New("invalid session signature")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, errors.New("invalid session payload")
	}
	var claims SessionClaims
	if err := json.Unmarshal(payload, &claims); err != nil || claims.UserID <= 0 || claims.Username == "" {
		return nil, errors.New("invalid session payload")
	}
	if claims.ExpiresAt <= time.Now().Unix() {
		return nil, errors.New("session expired")
	}
	return &claims, nil
}

func SetSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name: SessionCookieName, Value: token, Path: "/", HttpOnly: true,
		Secure: secureCookies(), SameSite: http.SameSiteLaxMode,
		MaxAge: int(sessionLifetime.Seconds()), Expires: time.Now().Add(sessionLifetime),
	})
}

func ClearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: SessionCookieName, Value: "", Path: "/", HttpOnly: true,
		Secure: secureCookies(), SameSite: http.SameSiteLaxMode,
		MaxAge: -1, Expires: time.Unix(1, 0),
	})
}

func secureCookies() bool {
	return strings.EqualFold(os.Getenv("ENVIRONMENT"), "production") ||
		strings.EqualFold(os.Getenv("COOKIE_SECURE"), "true")
}
