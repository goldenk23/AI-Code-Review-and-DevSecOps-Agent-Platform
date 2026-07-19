# SPEC — Dashboard index (`/`) — "Overview / Recent runs"

Textual transcription of `screen.png` for agents without vision. Dark theme, near-black page background (~#131313/#0a0a0a).

## Top nav bar (full width, 1px bottom border #232323)

- Left: brand wordmark **"AI Code Review & DevSecOps"** — large, bold, serif-leaning display font, white.
- Center-left nav links (horizontal, ~32px gap): **Dashboard** (active: white text + indigo underline bar beneath it), Repositories, Security, Automation (inactive: muted gray #a0a0a0).
- Right: **"Sign in with GitHub"** button — dark gray background (#1c1b1b), 1px border, white text, person/GitHub circle icon on the left, ~8px radius, ~40px tall.

## Page header (inside ~1200px centered container, ~48px below nav)

- H1: **"Overview"** — ~32px bold white.
- Subtitle below: "Monitor recent analysis runs across all repositories." — 14px muted gray.
- Right-aligned on the same row: **"Trigger Analysis"** primary button — soft indigo/lavender background (#c0c1ff-ish), dark indigo text, play-triangle icon left of label, ~8px radius.

## "Recent runs" card (full container width)

Card: background #161616 (one step lighter than page), 1px border #232323, ~8px radius.

### Card header (~24px padding)
- Title: **"Recent runs"** — 16px semibold white.
- Below: "Last 50 runs, auto-refresh every 5s" — 12px muted, followed by a small blue dot (live indicator).
- Top-right corner: circular-arrow **refresh icon** button, muted gray.

### Table
- Header row: slightly darker strip, muted 12px labels: **Run # | Status | Trigger | Commit | Created** (Created is right-aligned).
- Rows separated by 1px #232323 borders; row hover = background lightens to #1a1a1a. Each row is a link to `/runs/{id}`.
- Row contents (all technical values in Geist Mono):
  - **Run #**: mono, e.g. `#42`.
  - **Status**: pill badge with leading dot — `running` (blue #1570ef, tinted bg, dot pulses), `completed` (green #12b76a), `failed` (red #d92d20).
  - **Trigger**: small gray bordered tag, mono lowercase: `webhook`, `manual`, `schedule`.
  - **Commit**: small commit-node icon + 7-char mono SHA, e.g. `a1b2c3d`.
  - **Created**: right-aligned mono relative time: `just now`, `2m ago`, `15m ago`, `1h ago`.
- Example rows in the mock:
  1. `#42` · running · webhook · `a1b2c3d` · just now
  2. `#41` · completed · webhook · `8f9e0d1` · 2m ago
  3. `#40` · failed · manual · `b4c5d6e` · 15m ago
  4. `#39` · completed · schedule · `7a8b9c0` · 1h ago

### Card footer (darker strip, 1px top border)
- Left: blue dot + "2 runs active" — 13px, white-ish.
- Right: `system status: operational` — 12px mono, muted gray.

## States (from the brief)
- Empty: centered icon + "No analyses yet — open a PR on a connected repo to trigger one."
- Loading: 8 skeleton rows (`animate-pulse`).
- Error: red-tinted card with message + Retry button.
