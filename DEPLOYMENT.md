# Beginner Deployment Guide (AWS + $200 credit)

This guide takes you from "I have never deployed anything" to "my platform is
live on the internet with HTTPS." Follow it top to bottom. Every command is
copy-paste ready. Nothing here assumes prior deployment experience.

Take your time. Expect the whole thing to take about **1.5–2 hours** the first
time.

---

## 1. The big picture (read this once)

Your project is made of 6 small programs that talk to each other:

| Program | What it does |
|---|---|
| **web** | The dashboard you see in the browser (Next.js) |
| **api** | The backend brain (Go) |
| **worker** | Clones repos, runs tests/security scans, calls the AI (Python) |
| **ai-service** | Talks to the AI model (Python) |
| **postgres** | The database (stores runs, findings, users) |
| **redis** | A job queue (api hands jobs to worker through it) |

You do **not** install these one by one. They are packaged as **Docker
containers**. Think of Docker like shipping containers: each program sits in
its own sealed box with everything it needs, and one command starts all the
boxes together.

There is also a 7th piece added only in production:

- **gateway (Caddy)** — the front door. It's the only part exposed to the
  internet. It automatically gets a free HTTPS certificate and forwards
  visitors to the right program inside.

**The plan:** rent one small computer from Amazon (an "EC2 instance"), install
Docker on it, copy your code onto it, and run one command. Done.

---

## 2. About cost and the free tier (important, honest version)

- AWS's *always-free* servers have only 1 GB of memory. That is **too small** to
  build this project — it will freeze. Don't use those.
- Instead you'll use a slightly bigger paid server (a `t3.medium`, ~4 GB memory).
  It costs roughly **$1 per day** (~$30/month). Your $200 credit comfortably
  covers **5–6 months**.
- You'll set up a **billing alarm** (Part 11) so AWS emails you if spending
  climbs unexpectedly. This is your safety net.

> A live GitHub app must stay running to receive events, so you generally keep
> the server **on**. If you only want to demo it occasionally, you can **stop**
> the server between demos to save credit (Part 10) — but while stopped, it
> can't receive GitHub webhooks.

---

## 3. Things to gather before you start

Open a notes file and collect these. You'll paste them in later.

1. **An AWS account** — https://aws.amazon.com (you said you already have credit).
2. **A GitHub account** (you have one).
3. **An OpenCode Go API key** — the AI model key this project uses.
   Get it at https://opencode.ai/auth . Without it, the AI service refuses to
   start.
4. **Your code on GitHub.** If your project isn't already pushed to a GitHub
   repository, do that first (a **private** repo is fine and recommended).
   You'll clone it onto the server later.

You will *create* two more things during the guide (a domain name and a GitHub
OAuth app), so don't worry about those yet.

---

## 4. Launch your server (EC2)

An **EC2 instance** is just a computer you rent from Amazon by the hour.

1. Sign in to AWS. In the top search bar, type **EC2** and open it.
2. **Top-right: pick a Region** close to you (e.g. `Mumbai`, `N. Virginia`).
   Remember which one — everything lives in the region you choose.
3. Click **Launch instance**.
4. **Name:** `ai-review-platform`
5. **Application and OS Images:** choose **Ubuntu**, version **24.04 LTS**
   (free-tier-eligible label is fine — the OS is free, you pay for the machine).
6. **Instance type:** pick **`t3.medium`**.
   (This is the ~4 GB machine. `t3.micro` is too small and will fail the build.)
7. **Key pair (login):** click **Create new key pair**.
   - Name: `ai-review-key`
   - Type: RSA, Format: **`.pem`**
   - Click **Create** — your browser downloads `ai-review-key.pem`.
   - **Keep this file safe.** It's the only key to your server. If you lose it,
     you lose access.
8. **Network settings** → click **Edit**, then set the firewall rules
   (called a **Security Group**). Add these **inbound rules**:
   - **SSH**, port **22**, Source **My IP** (so only you can log in).
   - **HTTP**, port **80**, Source **Anywhere (0.0.0.0/0)**.
   - **HTTPS**, port **443**, Source **Anywhere (0.0.0.0/0)**.
   That's all. Every other port stays closed — the app's internal ports are not
   exposed to the internet on purpose.
9. **Configure storage:** change the disk to **30 GB** (gp3). The default 8 GB
   fills up when building Docker images.
10. Click **Launch instance**.

### Give it a permanent address (Elastic IP)

By default a server's public address changes every time it restarts. That would
break your domain and GitHub links. Fix it once:

1. EC2 left menu → **Elastic IPs** → **Allocate Elastic IP address** → **Allocate**.
2. Select the new address → **Actions → Associate Elastic IP address**.
3. Choose your `ai-review-platform` instance → **Associate**.

Now note down this **Elastic IP** (e.g. `13.234.56.78`). This is your server's
permanent address.

> Elastic IPs are free **while attached to a running instance**. If you later
> terminate the server, release the Elastic IP too, or AWS charges a small
> hourly fee for holding an unused one.

---

## 5. Get a free domain name (DuckDNS)

HTTPS certificates and GitHub logins need a real **domain name**, not a raw IP
address. DuckDNS gives you one for free in two minutes.

1. Go to https://www.duckdns.org and sign in (with GitHub — easiest).
2. In the box, type a name you like, e.g. `mycodereview`, and click **add domain**.
   You now own **`mycodereview.duckdns.org`**.
3. In the **current ip** field for that domain, paste your **Elastic IP** from
   Part 4 and click **update ip**.

Test it (on your own Windows machine, in a terminal):

```
ping mycodereview.duckdns.org
```

It should show your Elastic IP. If it does, your domain points at your server.

> Wherever this guide says `mycodereview.duckdns.org`, use **your** name.

---

## 6. Connect to your server (SSH)

**SSH** means "securely open a terminal on the remote computer."

On Windows, open **PowerShell** in the folder where `ai-review-key.pem` was
downloaded (usually `Downloads`), then:

```powershell
# Lock down the key file's permissions (Windows requires this once)
icacls.exe ai-review-key.pem /reset
icacls.exe ai-review-key.pem /grant:r "$($env:USERNAME):(R)"
icacls.exe ai-review-key.pem /inheritance:r

# Log in (replace with YOUR Elastic IP)
ssh -i ai-review-key.pem ubuntu@13.234.56.78
```

The first time it asks "Are you sure you want to continue connecting?" — type
`yes`. You're now inside your server. Your prompt changes to something like
`ubuntu@ip-172-31-...:~$`. **Everything from here runs on the server**, not your
PC.

---

## 7. Install Docker on the server

Copy-paste this whole block into the server terminal:

```bash
# Download and run Docker's official installer
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Let your user run Docker without typing "sudo" every time
sudo usermod -aG docker ubuntu
```

Now **log out and back in** so that group change takes effect:

```bash
exit
```
Then SSH in again (same command as Part 6). Verify Docker works:

```bash
docker --version
docker compose version
```

Both should print a version number.

### Add a safety net for memory (swap)

Building the images uses a lot of memory. This adds 2 GB of "backup memory" so
the build can't run out and freeze:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 8. Put your code on the server

Your code lives on GitHub. Clone it onto the server. Replace the URL with your
repository's URL (find it via the green **Code** button on your repo page):

```bash
git clone https://github.com/YOUR-USERNAME/YOUR-REPO.git app
cd app
```

- If your repo is **private**, GitHub will ask for a username and password.
  The "password" must be a **Personal Access Token**, not your login password.
  Create one at https://github.com/settings/tokens (classic token, `repo`
  scope), and paste it when prompted.
- If your repo is **public**, it just clones with no prompt.

You should now be inside the project folder (`~/app`). Confirm the key files are
here:

```bash
ls docker-compose.yml deploy.env.example
```

Both filenames should print back.

---

## 9. Create the secret settings files

The app reads secrets from small files named `.env`. These are **not** in Git
(on purpose — secrets must never be committed), so you create them now, directly
on the server.

### 9a. Generate your secret values

Run this once and **copy the output into your notes** — you'll paste these
values in the next steps:

```bash
echo "API_KEY=$(openssl rand -hex 32)"
echo "SESSION_SECRET=$(openssl rand -hex 32)"
echo "GITHUB_WEBHOOK_SECRET=$(openssl rand -hex 32)"
echo "TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"
```

Each line prints a name and a long random value. These are strong, unique
secrets — exactly what production needs.

### 9b. The main file: `.env` (in the project root)

Create it with the built-in editor `nano`:

```bash
nano .env
```

Paste the following, then **replace** the placeholder values with **your**
domain and **your** generated secrets from step 9a:

```dotenv
ENVIRONMENT=production
APP_DOMAIN=mycodereview.duckdns.org
APP_ORIGIN=https://mycodereview.duckdns.org
GITHUB_CALLBACK_URL=https://mycodereview.duckdns.org/auth/github/callback

# GitHub usernames allowed to log in (comma-separated). Use YOUR username.
ALLOWED_GITHUB_USERS=your-github-username

# Paste your generated values here:
API_KEY=paste-your-API_KEY-here
SESSION_SECRET=paste-your-SESSION_SECRET-here

# Keep false unless you fully trust every repo/PR you review (see note below).
RUN_REPOSITORY_TESTS=false

# The database password. The value after "review:" MUST match POSTGRES_PASSWORD.
POSTGRES_PASSWORD=paste-your-POSTGRES_PASSWORD-here
DATABASE_URL=postgres://review:paste-your-POSTGRES_PASSWORD-here@postgres:5432/ai_review
```

Save and exit nano: press **Ctrl+O**, then **Enter**, then **Ctrl+X**.

> Two rules that will bite you if ignored:
> - `POSTGRES_PASSWORD` and the password inside `DATABASE_URL` must be
>   **identical**.
> - `API_KEY` and `SESSION_SECRET` must be **different** from each other.

### 9c. The API's secrets file: `apps/api/.env`

```bash
cp apps/api/.env.example apps/api/.env
nano apps/api/.env
```

Change these lines (leave the rest as-is — the production `.env` overrides the
URL/port lines automatically):

```dotenv
GITHUB_CLIENT_ID=      # you'll fill this in Part 10
GITHUB_CLIENT_SECRET=  # you'll fill this in Part 10
GITHUB_WEBHOOK_SECRET=paste-your-GITHUB_WEBHOOK_SECRET-here
TOKEN_ENCRYPTION_KEY=paste-your-TOKEN_ENCRYPTION_KEY-here
```

Leave `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` empty for now — you'll get
those in Part 10 and come back. Save and exit (Ctrl+O, Enter, Ctrl+X).

### 9d. The AI service's key: `apps/ai-service/.env`

```bash
cp apps/ai-service/.env.example apps/ai-service/.env
nano apps/ai-service/.env
```

Set your OpenCode Go key from Part 3:

```dotenv
OPENCODE_GO_API_KEY=your-opencode-go-api-key
```

Save and exit.

### 9e. The worker's file: `apps/worker/.env`

This one just needs to exist; the important values come from the root `.env`.

```bash
cp apps/worker/.env.example apps/worker/.env
```

> **Security note on `RUN_REPOSITORY_TESTS`:** when `true`, the worker runs the
> test scripts *from the repositories it reviews*. Only ever set that to `true`
> if you completely trust every repo and every pull-request author, because
> you'd be running their code on your server. Leave it `false` for a public or
> shared deployment.

---

## 10. Create the GitHub OAuth app (the "Sign in with GitHub" button)

This is what lets you log into the dashboard with GitHub.

1. Go to https://github.com/settings/developers → **OAuth Apps** →
   **New OAuth App**.
2. Fill in:
   - **Application name:** `AI Code Review Platform` (anything)
   - **Homepage URL:** `https://mycodereview.duckdns.org`
   - **Authorization callback URL:**
     `https://mycodereview.duckdns.org/auth/github/callback`
     (this must match `GITHUB_CALLBACK_URL` in your root `.env` exactly)
3. Click **Register application**.
4. Copy the **Client ID**.
5. Click **Generate a new client secret** and copy the secret (you only see it
   once).

Now put them into the API's secret file on the server:

```bash
nano apps/api/.env
```
Fill in:
```dotenv
GITHUB_CLIENT_ID=the-client-id-you-copied
GITHUB_CLIENT_SECRET=the-client-secret-you-copied
```
Save and exit.

---

## 11. Launch the platform 🚀

From inside the `~/app` folder, run the one command that builds and starts
everything in production mode:

```bash
docker compose --profile production up -d --build
```

- `--profile production` turns on the HTTPS gateway and a safety check.
- `--build` builds all the app images (first time takes **10–15 minutes** — be
  patient; lots of text scrolls by).
- `-d` runs it in the background.

When it finishes, check what's running:

```bash
docker compose ps
```

You want to see the services (postgres, redis, api, ai-service, worker, web,
gateway) as `running` / `healthy`. The `migrate` and `production-check`
services show `exited (0)` — that's correct, they run once and stop.

Watch it come alive (Caddy fetching the HTTPS certificate takes ~30 seconds):

```bash
docker compose logs -f gateway
```
Press **Ctrl+C** to stop watching logs (this does **not** stop the server).

Now open your dashboard in a browser:

```
https://mycodereview.duckdns.org
```

You should see the login screen with a padlock (valid HTTPS). Click **Sign in
with GitHub** and authorize. You should land on the dashboard.

> If the browser warns about the certificate, wait a minute and refresh —
> Caddy may still be issuing it. See Troubleshooting if it persists.

---

## 12. Connect GitHub webhooks (so PRs trigger reviews)

A **webhook** is GitHub phoning your server every time something happens (like a
pull request opening). This is what actually kicks off a review.

Pick a repository you want reviewed, then:

1. On that repo: **Settings → Webhooks → Add webhook**.
2. **Payload URL:** `https://mycodereview.duckdns.org/webhooks/github`
3. **Content type:** `application/json`
4. **Secret:** paste the **`GITHUB_WEBHOOK_SECRET`** value from step 9a
   (must match the one in `apps/api/.env`).
5. **Which events?** choose **Let me select individual events**, tick
   **Pull requests**, untick everything else.
6. **Add webhook.**

GitHub sends a test "ping." Refresh the webhook page — a green check under
**Recent Deliveries** means your server received it.

---

## 13. Test the whole thing end-to-end

1. In the repo you added the webhook to, open a **pull request** (even a tiny
   one — change a README line on a new branch and open a PR).
2. Within a few seconds, a new run appears on your dashboard at
   `https://mycodereview.duckdns.org`.
3. Watch it move through the steps (tests → security scan → AI review).
4. When it finishes, the AI's summary is posted as a **comment on your PR**.

If that happens: **you have successfully deployed a real, internet-facing,
multi-service application with HTTPS.** 🎉

---

## 14. Everyday operations (your cheat sheet)

All commands run from `~/app` on the server (SSH in first).

| I want to... | Command |
|---|---|
| See what's running | `docker compose ps` |
| Watch all logs live | `docker compose logs -f` |
| Watch one service | `docker compose logs -f worker` |
| Restart everything | `docker compose --profile production restart` |
| Stop everything (keeps data) | `docker compose --profile production down` |
| Start again | `docker compose --profile production up -d` |

**Update after you change the code (push to GitHub, then on the server):**
```bash
cd ~/app
git pull
docker compose --profile production up -d --build
```

**Save credit when you don't need it running:** stop the *whole EC2 instance*
from the AWS console (EC2 → select instance → **Instance state → Stop**). You
stop paying for compute while stopped (you still pay a few cents for the 30 GB
disk). Start it again from the same menu. Because you used an **Elastic IP**,
the address stays the same — but update DuckDNS only if you ever change it.
While stopped, GitHub webhooks won't be received.

---

## 15. Set a billing alarm (do this now, it's free)

So AWS warns you before your credit runs low:

1. AWS search bar → **Billing and Cost Management**.
2. Left menu → **Budgets** → **Create budget**.
3. Choose **Zero spend budget** or a **Monthly cost budget** of, say, **$40**.
4. Enter your email for alerts → **Create budget**.

Now if spending crosses your threshold, AWS emails you.

---

## 16. Troubleshooting

**The page won't load / certificate warning won't go away.**
- Check the gateway logs: `docker compose logs gateway`.
- Caddy can only get a certificate if your domain points at the server AND
  ports 80 + 443 are open. Re-check: DuckDNS IP = your Elastic IP (Part 5), and
  Security Group has HTTP(80) + HTTPS(443) open to Anywhere (Part 4).

**`docker compose up` fails on `production-check`.**
- That guard enforces production settings. Make sure in the root `.env`:
  `ENVIRONMENT=production`, `APP_DOMAIN` is your real domain (not `localhost`),
  and both `APP_ORIGIN` and `GITHUB_CALLBACK_URL` start with `https://`.

**The `api` container keeps restarting.**
- Usually a bad secret. Check `docker compose logs api`. Common causes:
  - `API_KEY` or `SESSION_SECRET` shorter than 32 characters, or they're equal
    to each other.
  - `TOKEN_ENCRYPTION_KEY` not exactly 64 hex characters (regenerate with
    `openssl rand -hex 32`).
  - `GITHUB_WEBHOOK_SECRET` shorter than 32 characters.
  - `DATABASE_URL` password doesn't match `POSTGRES_PASSWORD`.

**"Sign in with GitHub" fails or loops.**
- The OAuth app's **Authorization callback URL** must exactly equal
  `GITHUB_CALLBACK_URL` in root `.env` (same domain, `https`, same path).
- Your GitHub username must be listed in `ALLOWED_GITHUB_USERS`.

**Webhook shows a red X in GitHub.**
- The **Secret** on the webhook must match `GITHUB_WEBHOOK_SECRET` in
  `apps/api/.env`. Payload URL must be `https://your-domain/webhooks/github`.

**Runs get stuck or the AI step fails.**
- Check `docker compose logs worker` and `docker compose logs ai-service`.
- The most common cause is a missing/invalid `OPENCODE_GO_API_KEY` in
  `apps/ai-service/.env`.

**Build froze / server feels stuck.**
- You likely ran out of memory. Confirm you're on a `t3.medium` and that you
  added the 2 GB swap file (Part 7). Then retry the build.

**I edited a `.env` file — do I need to rebuild?**
- No rebuild needed for env changes. Just restart:
  `docker compose --profile production up -d`. (Rebuild only when the *code*
  changes.)

---

## 17. Quick reference: what each secret is for

| Secret | Where | Purpose |
|---|---|---|
| `API_KEY` | root `.env` | Shared password protecting the backend `/api` routes |
| `SESSION_SECRET` | root `.env` | Signs your login session cookie |
| `POSTGRES_PASSWORD` | root `.env` | Database password (must match `DATABASE_URL`) |
| `GITHUB_WEBHOOK_SECRET` | `apps/api/.env` | Proves webhooks really came from GitHub |
| `TOKEN_ENCRYPTION_KEY` | `apps/api/.env` | Encrypts stored GitHub tokens (64 hex chars) |
| `GITHUB_CLIENT_ID` / `_SECRET` | `apps/api/.env` | Your GitHub OAuth app (the login button) |
| `OPENCODE_GO_API_KEY` | `apps/ai-service/.env` | The AI model key |

Keep all of these private. Never commit `.env` files to Git (they're already
ignored).
