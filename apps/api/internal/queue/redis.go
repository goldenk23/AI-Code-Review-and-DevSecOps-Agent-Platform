package queue

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/redis/go-redis/v9"
)

// Client wraps a Redis connection for enqueuing jobs
type Client struct {
	Redis *redis.Client
}

// Payload is the data we send to the Python worker
type Payload struct {
	RunID        int64  `json:"run_id"`
	RepoFullName string `json:"repo_full_name"`
	PRNumber     int    `json:"pr_number"`
	PRTitle      string `json:"pr_title"`
	HeadSHA      string `json:"head_sha"`
	Branch       string `json:"branch"`
}

func NewClient(addr string) *Client {
	rdb := redis.NewClient(&redis.Options{
		Addr: addr,
	})
	return &Client{Redis: rdb}
}

// EnqueueAnalysis pushes a job to the Redis list for the Python worker
func (c *Client) EnqueueAnalysis(ctx context.Context, payload Payload) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	// LPUSH adds the message to the left of the list
	// The worker uses BRPOP which removes from the right
	// This gives us FIFO (first in, first out) order
	err = c.Redis.LPush(ctx, "ai_review_jobs", body).Err()
	if err != nil {
		return fmt.Errorf("failed to enqueue job: %w", err)
	}

	return nil
}