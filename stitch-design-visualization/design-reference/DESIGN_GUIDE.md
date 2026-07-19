# DESIGN GUIDE — READ THIS FIRST (for AI agents without vision)

This folder contains the Google Stitch design for the **AI Code Review & DevSecOps (CodePulse AI)** dashboard.

**You cannot view the `screen.png` files. You do NOT need to.** Every screen has been
transcribed into an exhaustive text specification by a vision-capable model. Treat the
text specs as the single source of truth for what the design looks like.

## How to use this folder

1. Read `proton_syntax/DESIGN.md` — the design system (colors, typography, spacing, elevation, shapes, component rules).
2. Read `stitch_prompt.md` — the product brief, tech stack constraints, exact file structure, and API contract.
3. For each screen you build, read BOTH of these files in its folder:
   - `SPEC.md` — a pixel-accurate textual description of the screenshot (layout, every visible element, exact colors, spacing, states). **Written specifically so a text-only agent can reproduce the visual design.**
   - `code.html` — the raw Stitch-generated HTML/Tailwind for that screen. Use it to extract exact class combinations, hex values, and markup structure. Do NOT copy it verbatim (it uses CDN Tailwind + Material Symbols); translate it into the project's Next.js + Tailwind v4 conventions.

## Screens

| Folder | Route | Spec |
|---|---|---|
| `dashboard_index_recent_runs/` | `/` (Dashboard index — recent runs table) | `SPEC.md` |
| `run_detail_42/` | `/runs/[id]` (Run detail — findings, jobs, summary) | `SPEC.md` |
| `authentication_github_login/` | `/login` (GitHub OAuth sign-in) | `SPEC.md` |
| `repositories_security_health_overview/` | `/repositories` (Repo health cards) | `SPEC.md` |
| `security_overview_org_insights_2/` | `/security` (Org-wide security metrics) | `SPEC.md` |
| `automation_workflow_settings/` | `/automation` (Agent settings) | `SPEC.md` |
| `security_overview_org_insights_1/` | alternate version of `/security` — **no screenshot exists**; its `code.html` is the only reference | — |

## Global visual identity (applies to every screen)

- **Dark-mode-native.** Page background is near-black (`#0a0a0a`–`#131313`). Cards are one tonal step lighter (`#111`/`#1c1b1b`) with a 1px `#232323` border. NO drop shadows — depth comes from tonal layering + 1px borders.
- **Top nav bar** (not a sidebar): brand wordmark left ("AI Code Review & DevSecOps" serif-style bold, or "CodePulse AI" in indigo-tinted white), then horizontal nav links: Dashboard, Repositories, Security, Automation. Active link is white with an indigo underline; inactive links are muted gray. Right side: search icon / "Sign in with GitHub" button (dark, bordered, GitHub mark icon) or avatar + bell + gear icons when signed in. Nav bar has a 1px bottom border.
- **Accent color:** indigo `#6366f1`. Primary buttons: soft indigo background (`#c7c8ff`-ish tint in the mocks) with dark indigo text, or solid indigo with white text; 6–8px radius.
- **Typography:** Geist Sans for UI text, Geist Mono for ALL technical data — SHAs, file paths, timestamps like "2m ago", exit codes, counters, statuses in footers.
- **Badges:** small pills, soft-tint style — `bg-{color}/10 text-{color} border border-{color}/30`. Status badges have a small leading dot (pulsing when running).
- **Severity colors:** critical `#9b1c1c`, high `#d92d20`, medium `#f79009`, low `#667085`, info `#1570ef`. Status: queued `#667085`, running `#1570ef`, completed `#12b76a`, failed `#d92d20`.
- **Content container:** centered, max-width ~1200px, ~32px page margins, page title as large bold heading (~32px) with a one-line muted subtitle beneath.
