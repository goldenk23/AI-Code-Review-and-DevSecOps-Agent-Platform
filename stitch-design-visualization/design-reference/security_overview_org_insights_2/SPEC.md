# SPEC — Security overview (`/security`) — "Org insights"

Textual transcription of `screen.png`. Dark theme.

## Top nav
- Brand: shield icon + **"CodePulse AI"** in lavender/indigo-tinted bold.
- Links: Dashboard, Repositories, **Security** (active, indigo underline), Automation.
- Right: search, bell, gear icons + avatar.

## Page header
- H1: **"Security Overview"** — ~32px bold white (sans, heavier/geometric on this screen).
- Subtitle: "Aggregated DevSecOps metrics across all organization repositories." — muted.
- Right: `LAST SCANNED: 2 MINS AGO` uppercase mono 11px muted + **"Filter"** button (dark, bordered, icon).

## KPI stat cards — 4 across, equal width, ~16px gap
Card: #161616, 1px border, 8px radius, ~20px padding, plus a thin colored progress bar flush along the bottom edge.

1. **Critical Findings** — label 14px muted + small red gem/diamond icon top-right. Value: **14** huge (~40px) bold **red**. Delta line: red up-trend icon + `+3 vs last week` 12px. Bottom bar: red, ~25% filled.
2. **High Findings** — red/orange warning triangle icon. Value: **42** in orange-red. Delta: green down-trend + `-12 vs last week`. Bottom bar: orange-red, ~35%.
3. **Avg. Time to Fix** — blue clock icon. Value: **4.2** white bold + `days` smaller muted suffix. Delta: green `-0.8 days`. Bottom bar: blue, ~65%.
4. **Vulnerable Repos** — amber folder icon. Value: **18** white bold `/ 142` muted. Sub: `12% of total` 12px muted. Bottom bar: amber, ~12%.

## Lower two-column region (~65% / ~35%)

### Left: "Findings Over Time" card
- Header: title 16px semibold + legend right: red dot `Critical`, orange-red dot `High`.
- Body: line/area chart region on a faint grid, x-axis mono labels `Jan Feb Mar Apr May Jun`. (In the mock the series lines are barely visible — implement as a standard dual-line/area chart in critical red and high orange-red on a subtle grid.)

### Right: "Most Vulnerable Repos" card
- Header row: title + `View All` link (red-tinted or accent, right-aligned), header separated by divider/darker strip.
- List rows (divided by 1px borders): folder icon tile + repo name white 14px + meta line mono muted (`nodejs · main`), right side: two small tinted count chips — red chip (gem icon + critical count), red/orange chip (triangle icon + high count).
- Mock data:
  - auth-service-api — nodejs · main — 6 / 12
  - payment-gateway — golang · production — 4 / 8
  - frontend-dashboard — react · develop — 2 / 15
  - legacy-batch-jobs — java · master — 2 / 5

Note: `security_overview_org_insights_1/` is an alternate iteration of this page. It has NO screenshot — its `code.html` is the only reference for it. Prefer this spec (version 2).
