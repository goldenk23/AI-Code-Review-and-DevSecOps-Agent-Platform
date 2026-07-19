# SPEC — Automation settings (`/automation`)

Textual transcription of `screen.png`. Dark theme.

## Top nav
- Brand **"CodePulse AI"**; links Dashboard, Repositories, Security, **Automation** (active, indigo underline); right: bell, gear, avatar.

## Page header
- H1: **"Automation Settings"** — ~32px bold white.
- Subtitle: "Configure AI agent behavior, scanning triggers, and review style for automated PR analysis."

## Layout: main column (~65%) + right sidebar (~35%)

### Main column — three stacked settings cards (#161616 bg, 1px border, 8px radius, ~24px padding, ~24px gap)

**Card 1 — "Scan Triggers"** (lightning bolt icon + 16px semibold title, 1px divider under header)
- Setting row 1: bold label **"PR Webhooks"**, description "Automatically scan new pull requests and commits." (13px muted). Right: **toggle switch ON** — indigo track, white thumb with a checkmark.
- 1px divider.
- Setting row 2: **"Scheduled Scans"**, "Run full repository analysis daily at 00:00 UTC." Right: **toggle OFF** — gray track, thumb left.

**Card 2 — "Threshold Gates"** (gavel icon + title)
- Checkbox row 1: filled indigo checkbox (white check) + **"Block PR if High findings are found"**; sub-line: "Fails the CI/CD pipeline if high severity issues are detected."
- Checkbox row 2: checked + **"Require verification for Critical findings"**; sub: "Mandates human approval for any finding classified as Critical before merging."

**Card 3 — "AI Review Personality"** (robot/psychology icon + title)
- Slider group 1: label **"Verbosity"** bold, current value right-aligned muted: `Balanced`. Slider track thin gray, indigo thumb at ~50%. Endpoint labels beneath: `Concise` (left) / `Detailed` (right), 12px muted.
- Slider group 2: **"Strictness"**, value `Strict (Style + Sec)`, thumb ~65%. Endpoints: `Permissive` / `Pedantic`.

Below the cards, right-aligned: **"Save Configuration"** primary button — solid indigo (#6366f1) bg, white text, ~8px radius.

### Right sidebar — "Integration Status" card
- Header: calendar/plug icon + **"Integration Status"**, divider.
- Row: icon tile (rounded square, dark, `<>` code icon in lavender) + **"GitHub App"** bold white; beneath: green dot + `Connected & Active` 13px.
- Divider. Key/value rows: `Last Sync:` → `2m ago` (right, mono); `Permissions:` → `Read & Write` (indigo/lavender link-styled).
- Full-width secondary button: **"Manage Connection"** — dark gray bg, border, white text.
