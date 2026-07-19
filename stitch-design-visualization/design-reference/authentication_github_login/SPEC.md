# SPEC — Authentication (`/login`) — "Sign in to CodePulse AI"

Textual transcription of `screen.png`. Full-viewport dark page, NO nav bar.

## Background
- Near-black (#0e0e0e) with a very faint square grid pattern (thin lines, ~40px cells) and subtle dark radial glows in the top-left and bottom-right corners.

## Centered auth card (~545px wide, vertically centered)
Card: #161616 bg, 1px #232323 border, ~12px radius. Three stacked regions:

### 1. Header region (~40px padding, centered)
- Icon tile: ~56px rounded square (#232323 bg, subtle border) containing a lavender/indigo **terminal prompt icon** (`>_`).
- H1: **"Sign in to CodePulse AI"** — ~30px bold white, centered.
- Subtitle: "Secure your repositories with AI-powered DevSecOps analysis." — 14px muted gray, centered.

### 2. Form region (separated by 1px divider, ~32px padding)
- **Primary button**: full-width, **white/near-white background, black text**, bold 15px — GitHub mark (octocat) icon + "Sign in with GitHub". ~6px radius, ~52px tall.
- Divider row: thin lines either side of centered uppercase mono 11px label: `OR ENTER SECRETS` — muted gray.
- Field label: `ACCESS TOKEN` — uppercase mono 11px muted, left-aligned.
- **Input**: full-width, darker-than-card bg (#0a0a0a), 1px border, mono text. Leading `>` prompt character in lavender, placeholder `ghp_***********************` in muted gray mono. Focus ring: 1px indigo.
- **Secondary button**: full-width, dark gray (#232323) bg, white bold text: "Authenticate via CLI". ~52px tall.

### 3. Footer strip (darker bg #0e0e0e, 1px top border, ~16px padding)
- Left: mono 12px — `Status:` in muted gray, then `Awaiting Credentials` in **orange/amber** (#f79009).
- Right: `v2.4.1` — mono 12px muted gray.
