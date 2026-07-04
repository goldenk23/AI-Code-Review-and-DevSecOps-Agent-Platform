package database //This file belongs to the `database` package


import (
	"context" //used to control timeouts/cancellation (e.g., "stop if this takes too long").

	"fmt" //for formatting error messages.

	"os" //to read environment variables.


	"github.com/jackc/pgx/v5/pgxpool" //a PostgreSQL driver for Go that manages a __pool of database connections__.

)

// NewPool creates a connection pool to PostgreSQL.
// A "pool" keeps multiple connections open so we don't reconnect on every request.
func NewPool(ctx context.Context) (*pgxpool.Pool, error) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return nil, fmt.Errorf("DATABASE_URL not set")
	}

	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		return nil, fmt.Errorf("failed to create pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return pool, nil
}