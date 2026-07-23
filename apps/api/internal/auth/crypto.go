package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
)

// encryptionKey returns the 32-byte AES key from the TOKEN_ENCRYPTION_KEY env
// var (expected as 64 hex chars = 32 bytes). If unset, we use a fixed dev key
// so the app still runs locally — but we log a warning so nobody ships it.
func encryptionKey() ([]byte, error) {
	hexKey := os.Getenv("TOKEN_ENCRYPTION_KEY")
	if hexKey == "" {
		if environment := os.Getenv("ENVIRONMENT"); environment != "" && environment != "development" && environment != "test" {
			return nil, errors.New("TOKEN_ENCRYPTION_KEY is required outside development/test")
		}
		return make([]byte, 32), nil
	}
	key, err := hex.DecodeString(hexKey)
	if err != nil || len(key) != 32 {
		return nil, fmt.Errorf("TOKEN_ENCRYPTION_KEY must be 64 hex chars (32 bytes), got %d bytes", len(key))
	}
	return key, nil
}

// EncryptToken encrypts plaintext using AES-GCM and returns a hex string
// containing nonce + ciphertext, safe to store in a TEXT column.
func EncryptToken(plaintext string) (string, error) {
	key, err := encryptionKey()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	// The nonce must be unique per encryption. Random is the simplest way.
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	// Seal appends the ciphertext + auth tag to the nonce.
	sealed := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return hex.EncodeToString(sealed), nil
}

// DecryptToken reverses EncryptToken. Returns an error if the key is wrong
// or the ciphertext was tampered with (GCM detects both).
func DecryptToken(hexCiphertext string) (string, error) {
	key, err := encryptionKey()
	if err != nil {
		return "", err
	}
	data, err := hex.DecodeString(hexCiphertext)
	if err != nil {
		return "", errors.New("invalid ciphertext (not hex)")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return "", errors.New("ciphertext too short")
	}
	nonce, ciphertext := data[:nonceSize], data[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", errors.New("decryption failed (wrong key or tampered)")
	}
	return string(plaintext), nil
}
