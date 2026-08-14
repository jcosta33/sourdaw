---
type: spec
id: SPEC-multi-resolution-sessions
title: Multi-resolution sessions (Fidelity Matrix)
status: draft
owner: The Sourdaw team
sources:
  - intake/future-spec.md
---

# Multi-resolution sessions (Fidelity Matrix)

## Intent

Let one project hold multiple fidelity tiers (sketch → preview → review → final) of the
same semantic source instead of splitting into separate "lite" and "full" copies. A
Fidelity Matrix tracks each asset's tier and freshness; the user promotes a selection or
section to a higher tier and lower/higher realizations share lineage.

## Non-goals

- Hardware-adaptive session modes that pick engines by machine class (see existing
  `session-modes`).
- Freeze/flatten/bounce mechanics (see existing `freeze-flatten-bounce`).
- The render/queue scheduler internals beyond what tier promotion needs.

## Requirements

### AC-001 — One source, many realizations

An artifact must hold multiple realizations linked to a single semantic source.

Verify with: `pnpm cargo:test -- -p daw-core multi_resolution_shared_source`

### AC-002 — Fidelity Matrix surfaces state

A Fidelity Matrix must show, per asset, its tier (sketch/preview/review/final) and
freshness (current, stale, promoted-from-lower, awaiting-HQ-replacement).

Verify with: `pnpm test:run -- fidelityMatrixState`

### AC-003 — Section promotion without whole-project rerender

Promoting a section to a higher tier must render only that section, leaving other assets'
tiers untouched.

Verify with: `pnpm test:run -- fidelitySectionPromotion`

### AC-004 — Cross-device tier continuity

A project sketched in the browser with lightweight engines must open on desktop and
generate HQ replacements without losing edits or intent links.

Verify with: `manual` — sketch in browser, open on desktop, promote to final, confirm edits and intent links survive

### AC-005 — Shared lineage, not orphan files

Lower-tier and higher-tier outputs of one source must share lineage; a promoted output
must reference the source it replaced, not become an unrelated file.

Verify with: `pnpm cargo:test -- -p daw-core multi_resolution_lineage`

### AC-006 — Save format does not duplicate semantic data

The save format must not duplicate the semantic data across tiers.

Verify with: `pnpm cargo:test -- -p daw-core multi_resolution_shared_source`

## Open questions

- [ ] (non-blocking) Whether overnight/background render is in-scope here or a separate
  render-queue feature. Default: the matrix requests; the queue is separate.

## Affected areas

- `crates/daw-core/` (artifact realizations, lineage), project save format
- Fidelity Matrix UI, promotion/render-request flow

## Dropped from sources

- Background render farms / sidecars — listed under desktop responsibilities; out of scope here.
