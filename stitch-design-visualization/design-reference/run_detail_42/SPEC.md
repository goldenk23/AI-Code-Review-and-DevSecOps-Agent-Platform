# SPEC — Run detail (`/runs/[id]`) — mock shows run #42

Textual transcription of `screen.png`. Dark theme. Same top nav as dashboard (here "Repositories" shows as active with indigo underline; right side has a search icon then the "Sign in with GitHub" button).

## Layout

Two-column: **left main column ~70%**, **right sidebar ~30%** (sticky). ~24px gutter. Content in ~1200px centered container.

## Left column

1. **Breadcrumb**: `Runs  >  #42` — 13px muted gray, chevron separator; `#42` mono.
2. **Run header**:
   - H1: PR title, e.g. **"Update dependencies and refactor auth"** — ~30px bold white.
   - Immediately right of the title: status badge — pill, green tint: dot/check icon + `COMPLETED` uppercase 11px mono, `bg-green/10 text-#12b76a border-green/30`.
   - Below: commit-node icon + full SHA in mono muted gray: `a1b2c3d4e5f6g7h8i9j0`.
3. **Findings section**:
   - Section header row: **"Findings (12)"** — 18px semibold white — with two filter dropdown buttons right-aligned: "All Severities" and "All Categories" (dark bg, 1px border, 13px).
   - **Finding card** (repeats; #161616 bg, 1px #232323 border, 8px radius, ~20px padding):
     - Top row of badges: severity badge — e.g. `⚠ HIGH` uppercase mono, red tint pill (#d92d20 at /10 bg, /30 border) — then category tag: `security` in a plain gray bordered tag.
     - Title: **"Insecure password hashing"** — 16px bold white.
     - File path row: document icon + `src/auth.ts:12` — 13px Geist Mono, muted.
     - Description: normal 14px gray-white text, 1.5 line height: "The use of MD5 for password hashing is insecure and vulnerable to collision attacks. It is recommended to use a stronger algorithm such as bcrypt or Argon2."
     - **Evidence / diff block**: darker inset well (#0e0e0e), mono 13px, line numbers:
       - removed line: strikethrough, red-tinted row: `11 const crypto = require('crypto');`
       - highlighted red row: `12 const hash = crypto.createHash('md5').update(password).digest('hex');`
       - added green-tinted row: `12 const hash = await bcrypt.hash(password, 10);`
     - Second card in mock: `⚠ MEDIUM` (amber #f79009 tint) + `performance` tag, title "N+1 Query detected", path `src/resolvers/user.ts:45`, description about DataLoader/eager fetching, no evidence block.

## Right sidebar (sticky, ~30%)

1. **"Post comment to PR" action button** — full-width, soft indigo/lavender bg (#c0c1ff-ish) with dark indigo text, comment icon, ~10px radius, inside a bordered card. Sits at the top of the sidebar.
2. **"Run Summary" card** — card with 16px semibold header "Run Summary" separated by 1px divider, then label/value rows (label 13px muted left, value right-aligned; technical values in mono):
   - Commit → `a1b2c3d`
   - Trigger → `pull_request` (mono)
   - Created → `10:42 AM`
   - Started → `10:43 AM`
   - Duration → `2m 14s` (bold white)
3. **"Jobs" card** — header "Jobs", then one row per job:
   - green dot + `test` (mono) ........ right: `45s` muted mono
   - green dot + `semgrep` ........ `1m 12s`
   - gray dot + ~~`npm_audit`~~ (strikethrough, greyed) ........ `skipped`

## Notes from the brief
- If run failed: red-tinted error card with mono error text under the header.
- Evidence longer than 200 chars hides behind a "Show evidence" disclosure.
- Confidence footer on finding cards: "confidence 0.95" — value colored by threshold (≥0.9 strong/green, 0.5–0.9 medium/amber, <0.5 weak/red).
- Post-comment button disabled while run is queued/running; spinner during mutation; success/error text after.
