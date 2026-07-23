# Production deployment

The included production profile runs Postgres, Redis, migrations, API, AI service, workers, Next.js, and Caddy TLS ingress. Only ports 80/443 are public; direct service ports bind to host loopback.

## 1. DNS and firewall

Point `review.example.com` at the host. Allow inbound TCP 80/443 and UDP 443. Keep 3000, 5432, 6379, 8000, 8080, and 9090 private.

## 2. Configure secrets

```powershell
Copy-Item deploy.env.example .env
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/worker/.env.example apps/worker/.env
Copy-Item apps/ai-service/.env.example apps/ai-service/.env
```

Fill root `.env` with the real domain and distinct random `API_KEY`, `SESSION_SECRET`, and database password. In `apps/api/.env`, set:

- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
- `GITHUB_WEBHOOK_SECRET`
- `TOKEN_ENCRYPTION_KEY` (`openssl rand -hex 32`)

In `apps/ai-service/.env`, set `OPENCODE_GO_API_KEY`. Compose overrides local service URLs from the app-level files. When `ENVIRONMENT=production`, the API refuses to start with missing, placeholder, short, all-zero, development-database, or non-HTTPS public settings.

## 3. Configure GitHub

- OAuth callback: `https://review.example.com/auth/github/callback`
- Webhook URL: `https://review.example.com/webhooks/github`
- Webhook content type: `application/json`
- Webhook secret: the same `GITHUB_WEBHOOK_SECRET`
- Event: pull requests

Users should sign in once after deployment so accessible personal, organization, and collaborator repositories are mapped to their OAuth token. Private clones and comments then use a token linked to the run's repository rather than a global user.

## 4. Deploy

```powershell
docker compose --profile production up -d --build
docker compose ps
docker compose logs -f migrate api worker gateway
```

The one-shot `migrate` service applies every SQL file in filename order with `ON_ERROR_STOP=1`; API and workers start only after it succeeds. Migrations are forward-only, so back up Postgres before upgrading.

Verify:

```powershell
curl.exe https://review.example.com/health
curl.exe -I https://review.example.com/login
```

Caddy obtains and renews certificates automatically. If a cloud load balancer or Kubernetes ingress already terminates TLS, omit the `production` profile, expose only the ingress, and keep all internal HTTP URLs private.

## Multi-host/platform deployment

Deploy the same four images independently and set these internal addresses per service:

| Service | Required internal settings |
|---|---|
| API | `DATABASE_URL`, `REDIS_ADDR`, `WORKER_METRICS_URL`, `PORT=8080` |
| Worker | `DATABASE_URL`, `REDIS_URL`, `AI_SERVICE_URL`, `API_BASE_URL`, `API_KEY` |
| Web | `API_INTERNAL_URL`, `API_KEY`, `SESSION_SECRET` |
| AI service | `OPENCODE_GO_API_KEY` |

Run the migration job once before rolling out API/workers. Terminate public TLS at the platform ingress and route only `/webhooks/*` and `/health` to API; route all other public paths to web. Never expose `/internal/*`, Postgres, Redis, AI service, or worker metrics publicly.

Scale workers with:

```powershell
docker compose up -d --scale worker=3
```

Each worker consumes the shared Redis queue. Use distinct metrics ports only when workers run directly on one host rather than in Compose.

## Operational notes

- Persist and back up `postgres_data`; Redis contains queued/DLQ jobs and should also be persisted.
- Rotate `API_KEY`, `SESSION_SECRET`, webhook, OAuth, database, LLM, and encryption secrets through your secret manager—not image layers.
- `.dockerignore` excludes every app `.env` file from builds.
- The worker executes repository test commands. For untrusted public/fork PRs, run workers in an isolated sandbox with restricted network/CPU/memory; the included worker container is suitable only for trusted repositories.
