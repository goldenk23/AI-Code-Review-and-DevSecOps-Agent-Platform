---
name: Proton Syntax
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#3a3939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353534'
  on-surface: '#e5e2e1'
  on-surface-variant: '#c7c4d7'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#908fa0'
  outline-variant: '#464554'
  surface-tint: '#c0c1ff'
  primary: '#c0c1ff'
  on-primary: '#1000a9'
  primary-container: '#8083ff'
  on-primary-container: '#0d0096'
  inverse-primary: '#494bd6'
  secondary: '#c8c6c5'
  on-secondary: '#313030'
  secondary-container: '#4a4949'
  on-secondary-container: '#bab8b7'
  tertiary: '#ffb783'
  on-tertiary: '#4f2500'
  tertiary-container: '#d97721'
  on-tertiary-container: '#452000'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e1e0ff'
  primary-fixed-dim: '#c0c1ff'
  on-primary-fixed: '#07006c'
  on-primary-fixed-variant: '#2f2ebe'
  secondary-fixed: '#e5e2e1'
  secondary-fixed-dim: '#c8c6c5'
  on-secondary-fixed: '#1c1b1b'
  on-secondary-fixed-variant: '#474646'
  tertiary-fixed: '#ffdcc5'
  tertiary-fixed-dim: '#ffb783'
  on-tertiary-fixed: '#301400'
  on-tertiary-fixed-variant: '#703700'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353534'
  border-dark: '#232323'
  border-light: '#e5e7eb'
  text-primary: '#ededed'
  text-muted: '#a0a0a0'
  critical: '#9b1c1c'
  high: '#d92d20'
  medium: '#f79009'
  low: '#667085'
  info: '#1570ef'
  success: '#12b76a'
typography:
  headline-lg:
    fontFamily: Geist Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  subheading:
    fontFamily: Geist Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-base:
    fontFamily: Geist Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-muted:
    fontFamily: Geist Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  caption:
    fontFamily: Geist Sans
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  code-base:
    fontFamily: Geist Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
  code-sm:
    fontFamily: Geist Mono
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 16px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  container-max: 1200px
  gutter: 1rem
  margin-page: 2rem
  stack-dense: 0.5rem
  stack-normal: 1rem
  inset-card: 1.25rem
---

## Brand & Style

The design system is a high-performance, dark-mode-native aesthetic tailored for AI Code Review and DevSecOps professionals. It draws inspiration from the "developer-obsessed" design movements of Vercel and Linear, emphasizing precision, speed, and technical clarity.

The visual style is **Modern Corporate Minimalist** with a **Technical Edge**. It prioritizes information density and semantic signaling over decorative flourishes. The interface feels like an extension of the developer's terminal—focused and utilitarian—while maintaining the sophisticated polish of a modern SaaS platform. Key attributes include:

- **Data-First Hierarchy:** Using Geist Mono for technical identifiers (SHAs, paths, exit codes) to differentiate "system data" from "narrative content."
- **Functional Color:** Color is reserved almost exclusively for status and severity signaling, ensuring that attention is only drawn when action is required.
- **Subtle Layering:** Depth is communicated through 1px borders and slight tonal shifts rather than traditional shadows, creating a "flat but layered" architectural feel.

## Colors

The palette is optimized for long-duration focus. The **Dark Mode** (default) utilizes a deep black (`#0a0a0a`) to eliminate glare, while the **Light Mode** provides a high-contrast alternative for accessibility.

### Semantic Mapping
- **Accent:** Indigo (`#6366f1`) is the primary interactive brand color, used for primary actions and highlights.
- **Severity & Status:** These are shared tokens to create a unified mental model for the user. Red always indicates failure or critical risk, while Emerald always indicates completion or safety.
- **Surface Tiers:** Use `secondary` (`#111111`) for elevated cards and sidebars, and a slightly lighter `muted` tier (`#1a1a1a`) for nested wells or code blocks.
- **Alpha-Tinting:** For badges and alerts, use the named color with a 10% opacity background and a 100% opacity text/border for a "soft tinted" effect.

## Typography

This design system uses a dual-stack typographic approach. **Geist Sans** handles the narrative and organizational structure, while **Geist Mono** is employed for all technical metadata.

- **Monospace Usage:** Use `code-base` or `code-sm` for commit SHAs, file paths, line numbers, and confidence scores. This distinguishes "verified system data" from user-generated content.
- **Hierarchy:** Maintain high contrast between headings and body text through weight rather than just size.
- **Mobile Scaling:** For mobile screens, `headline-lg` should scale down to 24px with a 32px line height to prevent excessive wrapping.

## Layout & Spacing

The layout philosophy is based on a **Fixed Grid** with high information density. 

- **Grid System:** A 12-column grid is used for primary layouts. For detail views, a common pattern is the 70/30 split: 70% main content (code review, finding details) and 30% sticky sidebar (metadata, severity, timestamps).
- **Rhythm:** An 8px base unit drives all spacing. Dense interfaces (like the Findings table) should use 4px or 8px increments, while high-level dashboard containers use 16px to 24px.
- **Breakpoints:**
  - **Mobile (<768px):** Single column, margins reduced to 16px. Sidebars reflow to the bottom or become hidden behind a toggle.
  - **Tablet (768px - 1024px):** 12-column fluid grid, 24px margins.
  - **Desktop (>1024px):** Fixed 1200px container, centered.

## Elevation & Depth

In this design system, depth is achieved through **Tonal Layers** and **Low-Contrast Outlines**.

- **Surfaces:** The base background is the deepest layer. Secondary containers (cards, sidebars) use a slightly lighter hex (`#111111`) to appear "raised." 
- **Borders:** All containers must have a 1px solid border (`#232323`). This provides the primary definition between elements.
- **Overlays:** Modals and dropdowns should use a subtle backdrop blur (8px to 12px) with a semi-transparent background to maintain context without visual clutter.
- **Shadows:** Avoid heavy drop shadows. If necessary for modals, use a tight, 4px blur with 40% opacity, tinted to the background color to keep the look "flat."

## Shapes

The shape language is **Soft** and precise.

- **Base Radius:** 4px (`0.25rem`) is the default for buttons, input fields, and small badges.
- **Large Radius:** 8px (`0.5rem`) for cards and primary layout containers.
- **Badges:** While the system is generally "Soft," status badges (pill shapes) may use `rounded-full` to distinguish them as discrete status indicators.

## Components

- **Buttons:** Primary buttons use the Indigo accent with white text. Secondary buttons use a ghost style (border only) or a subtle gray background. Hover states should result in a 10% brightness increase.
- **Status Badges:** Use a "soft-tint" approach. E.g., a "Critical" badge has a background of `rgba(155, 28, 28, 0.1)`, a border of `rgba(155, 28, 28, 0.3)`, and text of `#9b1c1c`.
- **Input Fields:** Dark background (`#0a0a0a`), 1px border (`#232323`), and Geist Mono for code-related inputs. Focus state uses a 1px Indigo ring.
- **Cards:** Cards are the primary container. They should have a 1px border, no shadow, and use the `#111111` background. Header areas within cards should be separated by a 1px divider.
- **Data Tables:** Sticky headers with a semi-transparent background and blur. Row hover states should trigger a background shift to `#1a1a1a`.
- **Severity Indicators:** Always accompanied by a geometric icon (e.g., a square for info, a triangle for medium, a diamond for critical) to ensure accessibility for colorblind users.