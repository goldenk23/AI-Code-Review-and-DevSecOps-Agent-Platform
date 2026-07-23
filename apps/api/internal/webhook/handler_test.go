// usage: cd apps/api && go test ./internal/webhook/ -v
package webhook

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

// TestVerifySignature_Valid confirms a correctly-signed payload is accepted.
func TestVerifySignature_Valid(t *testing.T) {
	secret := "testsecret123"
	body := []byte(`{"action":"opened"}`)

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	sig := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	if !VerifySignature(secret, body, sig) {
		t.Fatal("expected signature to be valid, got false")
	}
}

// TestVerifySignature_WrongSecret confirms a different secret rejects.
func TestVerifySignature_WrongSecret(t *testing.T) {
	body := []byte(`{"action":"opened"}`)
	mac := hmac.New(sha256.New, []byte("real-secret"))
	mac.Write(body)
	sig := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	if VerifySignature("different-secret", body, sig) {
		t.Fatal("expected signature to be invalid, got true")
	}
}

// TestVerifySignature_MalformedHeader confirms a non-sha256 prefix is rejected.
func TestVerifySignature_MalformedHeader(t *testing.T) {
	if VerifySignature("s", []byte("x"), "md5=abc") {
		t.Fatal("expected malformed header to be rejected")
	}
}
