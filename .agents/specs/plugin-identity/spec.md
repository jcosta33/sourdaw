---
type: spec
id: SPEC-plugin-identity
title: Plugin visual identity
status: done
owner: The Sourdaw team
sources:
  - self
---

# Plugin visual identity

## Intent

Give every Sourdaw plugin a distinct, immediately recognizable color identity layered
on the shared industrial-dark surface hierarchy, so a user can tell two plugins apart
at a glance while the whole family stays visually cohesive.

## Non-goals

- Foundational surface, typography, and signal tokens — owned by the design system.
- Layout primitives — owned by the layout-components spec.
- Plugin icon glyph design.

## Requirements

### AC-001 — Each plugin defines a namespaced accent token

Every plugin must declare its primary accent color as a namespaced CSS variable
(e.g. `--plugin-grinder-accent`).

Verify with: `manual` — grep `main.css` for each plugin's namespaced accent variable

### AC-002 — Primary accents are separated on the color wheel

No two active plugins' primary accents may sit within 30° of each other on the hue
wheel.

Verify with: `manual` — compute the hue of each primary accent and confirm ≥30° pairwise separation

### AC-003 — Active-state colors meet AA contrast

Every active-state color must meet WCAG 2.1 AA (4.5:1) contrast against the plugin's
own panel background.

Verify with: `manual` — measure each active color's contrast ratio on `#111111` and `#050505`

### AC-004 — Each plugin exposes the standard surface utilities

Every plugin module must define `{module}-faceplate`, `{module}-window`, and
`{module}-tab-active` utilities that inherit the shared base surfaces.

Verify with: `manual` — confirm each module CSS defines the three utilities

### AC-005 — Plugin browser cards carry the plugin's identity

Each plugin card in the browser must render a primary-color accent bar and an icon
container themed with the plugin's faceplate utility.

Verify with: `manual` — open the plugin browser and confirm each card shows its accent bar and themed icon

### AC-006 — Adding a plugin follows the identity checklist

A new plugin must add its color entry and pass the no-collision checklist (≥30°
separation, AA contrast, required utilities) before merge.

Verify with: `manual` — run the verification checklist against a candidate new plugin theme

### AC-007 — Known near-collisions stay resolved to distinct colors

The previously-identified near-collision pairs must each render a visibly distinct
primary color: Fermenter must not reuse Bacteria's mint, Dutch Oven and Crust must
not share an identical copper, Yeast must not match Levain's coral, and Scoring must
not sit on Proof's cyan.

Verify with: `manual` — confirm Fermenter is sage (not mint), Dutch Oven is amber and Crust is peach (not the same copper), Yeast is rose (not Levain's coral), and Scoring is indigo (not Proof's cyan); the resolved assignments are recorded in `.agents/specs/plugin-identity/research.md#color-separation-analysis-recovered`

## Open questions

- [ ] (non-blocking) Should the no-collision check become an explicit local gate, or remain a
  reviewer checklist item? A checklist item satisfies the requirement today.

## Affected areas

- `src/styles/utilities/modules/*.css` (per-plugin faceplate/window/tab utilities)
- `src/main.css` (accent tokens, shared crumbs utilities)
- the plugin browser card component and its accent/icon styling

## Dropped from sources

- Re-embedding the full per-plugin hex palette and CSS module templates — those live
  with the implementation and the design system; the spec states the rules, not the
  values. The recovered per-plugin Plugin Color Matrix (13 plugins × primary/secondary
  hex + rationale) and the named-accent design-token reference are preserved in
  `.agents/specs/plugin-identity/research.md#plugin-color-matrix-recovered`.
- The measured Quick Reference Contrast Ratios table (11 colors on `#111111` and
  `#050505`, all passing) — evidence for AC-003, not a separate requirement; preserved
  in `.agents/specs/plugin-identity/research.md#quick-reference-contrast-ratios-recovered`.
- The energy-level glow-opacity tuning table — an implementation nicety, not a
  verifiable requirement; preserved in
  `.agents/specs/plugin-identity/research.md#glow-intensity--energy-level-table-recovered`.
