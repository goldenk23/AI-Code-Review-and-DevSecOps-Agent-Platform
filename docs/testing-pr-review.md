# Testing a PR review

Real GitHub webhook → platform runs → comment posted back to the PR.

## Steps

1. **Start everything:** `.\start.ps1` from the repo root.
   This brings up Postgres + Redis and the Go API (8080), worker, AI
   service (8000), and dashboard (3000).
2. **Sign in** on `http://localhost:3000/login` via GitHub OAuth. This
   stores your OAuth token in the `users` table; the worker later uses it
   to post the review comment back to the PR. Without this step the review
   runs but `post-comments` returns `500 no user token available`.
3. **Expose the API publicly.** GitHub needs a public URL to deliver the
   webhook to, so run (in a new terminal):
   ```powershell
   ngrok http 8080
   ```
   ngrok prints a forwarding line like:
   ```
   Forwarding  https://xxxx-203-0-113-5.ngrok.app -> http://localhost:8080
   ```
   Copy that **https** URL — you'll paste it into GitHub in the next
   step with `/webhooks/github` appended, e.g.
   `https://xxxx-203-0-113-5.ngrok.app/webhooks/github`.
   Any placeholder URL won't validate on GitHub; you must use the one
   ngrok prints for this session. (Free-tier ngrok URLs are random per
   session, so redo step 3 + step 4 whenever you restart ngrok.)
4. **Add the webhook** on your **public** GitHub repo:
   Settings → Webhooks → Add webhook, and fill in:

   | GitHub field | Value |
   |---|---|
   | Payload URL | the https URL from step 3, with `/webhooks/github` appended |
   | Content type | `application/json` |
   | Secret | `testsecret123` (matches `GITHUB_WEBHOOK_SECRET` in `apps/api/.env`) |
   | Events | ☑ **Let me select individual events** → check **Pull requests** only |

   The repo must be public — the worker does `git clone` with no auth token.
5. **Open a PR** from a non-main branch. The worker runs
   `git diff main...HEAD`, so a PR from main to main gives an empty diff:
   ```bash
   git checkout -b fix/something
   # make a change
   git commit -am "fix: something"
   git push -u origin fix/something
   # open the PR on GitHub: base=main, compare=fix/something
   ```

## Watch

Dashboard: `http://localhost:3000` — new run shows in ~5s, goes
`queued → running → completed`.

```powershell
Get-Content .\logs\worker.log -Wait -Tail 5
```

Final: the worker calls `POST /api/analyses/{run_id}/post-comments` on the
API, which posts a Markdown summary comment back to the GitHub PR using your
signed-in user's OAuth token.

## If it breaks

| Symptom | Cause |
|---|---|
| `401 Invalid signature` in GitHub deliveries | `GITHUB_WEBHOOK_SECRET` in `apps/api/.env` doesn't match the GitHub form (restart API after editing) |
| Run `failed: git clone failed: not found` | repo is private or name is wrong |
| Run `failed: git checkout failed` | `head.ref` branch doesn't exist on remote — use a real pushed branch |
| `500 no user token available` | nobody signed in via `/login` |
| Comment never appears on PR | signed-in user can't comment on that repo |