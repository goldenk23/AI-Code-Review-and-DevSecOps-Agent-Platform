# SPEC — Repositories (`/repositories`) — "Security health overview"

Textual transcription of `screen.png`. Dark theme.

## Top nav (variant used on this screen)
- Brand: **"CodePulse AI"** — bold, white with lavender tint.
- Nav links: Dashboard, **Repositories** (active: white + indigo underline), Security, Automation.
- Right side: search input (dark, bordered, magnifier icon, placeholder `Search repositories...` in mono, with `⌘ K` keycaps), then bell icon, gear icon, and a circular user avatar.

## Page header
- H1: **"Repositories"** — ~32px bold white.
- Subtitle: "Manage and monitor security posture across all connected codebases." — 14px muted.
- Right-aligned: **"Filter"** button (dark bg, border, filter-lines icon) and **"Connect Repo"** primary button (soft indigo/lavender bg, dark indigo text, `+` icon).

## Summary strip (mono, 13px, single row, ~24px below header)
`12 Repositories Found` (white) · green check icon + `8 Healthy` (green #12b76a) · amber warning triangle + `3 Warning` (#f79009) · red clock/alert icon + `1 Critical` (#d92d20).
Right-aligned: grid-view / list-view toggle icon buttons (grid active — lighter bg).

## Repo cards grid (3 columns desktop, ~16px gap)

Each card: #161616 bg, 1px #232323 border, 8px radius, ~20px padding.

Card anatomy:
- Top row: folder/copy icon tile (small rounded square, dark) + **repo name** bold white mono-ish (e.g. `acme-corp/api-gateway`) with grade tile top-right.
- **Grade tile**: ~36px rounded square, letter grade in serif bold — `A` green tint (green border + green text), `B` amber tint, `C` red tint, `?` gray (scanning).
- Meta line under name: `Node.js · Last scan: 2m ago` — 13px mono muted.
- 1px divider.
- Bottom stats row, two columns:
  - **Active PRs**: label 12px mono muted; below: PR arrow icon + count bold white (e.g. `4`).
  - **Open Findings**: label; below: red square dot + count, amber square dot + count (e.g. `0` `2`).
- Critical card extra: red 1px border on the whole card + red `⚠ Action Req` label bottom-right.
- Scanning card variant: spinner-style icon, name, indigo mono text `Scanning in progress...`, greyed stats with `Analyzing` placeholder; indigo-tinted border.

Mock data:
| Repo | Lang | Last scan | Grade | Active PRs | Findings (crit/med) |
|---|---|---|---|---|---|
| acme-corp/api-gateway | Node.js | 2m ago | A | 4 | 0 / 2 |
| acme-corp/auth-service | Go | 15m ago | B | 12 | 0 / 8 |
| acme-corp/payment-worker | Python | 1h ago | C (red border, Action Req) | 2 | 3 / 15 |
| acme-corp/web-client | React | 5m ago | A | 7 | 0 / 0 |
| acme-corp/data-pipeline | — | scanning | ? | 1 | Analyzing |
