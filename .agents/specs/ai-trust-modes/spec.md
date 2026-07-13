---
type: spec
id: SPEC-ai-trust-modes
title: Explicit trust modes for AI operations
status: draft
owner: The Sourdaw team
sources:
  - intake/differentiators.md
  - intake/full-spec.md
  - intake/future-spec.md
---

# Explicit trust modes for AI operations

## Intent

Every AI-assisted action declares its autonomy and reversibility before it runs, and
the chosen mode is enforced by execution logic — not just shown in the UI. Branch-first
is the default for stochastic generation; no AI action may silently replace mainline
creative material unless the user explicitly chose a destructive mode.

## Non-goals

- The variants system the create-branch mode writes into (see `variation-native-clips`).
- The runtime strip that shows engine/fallback state (see `runtime-transparency`).
- Provenance marking of machine-generated material (see `export-provenance`).
- The specific AI generators (MIDI/audio generation pipelines own their own specs).

## Requirements

### AC-001 — A trust mode is attached to every AI action

Every AI runtime action must carry one trust mode from the set: suggest-only,
create-branch, apply-reversible, replace-selection, destructive-commit, analyze-only.

Verify with: `pnpm test:run -- trustMode`

### AC-002 — Suggest-only never mutates project truth

When an action runs in suggest-only mode, output must appear as ghost clips/notes.

Verify with: `pnpm test:run -- executeWithTrustMode`

### AC-003 — Create-branch writes a variant, never mainline

When an action runs in create-branch mode, output must land in a new variant.

Verify with: `pnpm test:run -- executeWithTrustMode`

### AC-004 — Replace/destructive require confirmation

When an action runs in replace-selection or destructive-commit mode, execution must
require explicit confirmation before mutating content.

Verify with: `pnpm test:run -- executeWithTrustMode`

### AC-005 — Enforcement is in the execution planner

Trust-mode enforcement must occur in the dispatch/execution path shared by all AI
entry points, not in any single UI surface, so a forbidden overwrite cannot occur.

Verify with: `pnpm test:run -- aiDispatchTrustEnforcement`

### AC-006 — Sensible per-feature defaults

Generation features must default to create-branch and analysis features to
analyze-only, overridable per invocation.

Verify with: `pnpm test:run -- trustModeDefaults`

### AC-007 — Suggest-only leaves project stores unchanged

When an action runs in suggest-only mode, the project stores (MIDI, tracks) must be
unchanged.

Verify with: `pnpm test:run -- executeWithTrustMode`

### AC-008 — Create-branch leaves the active timeline clip untouched

When an action runs in create-branch mode, the active timeline clip must be untouched.

Verify with: `pnpm test:run -- executeWithTrustMode`

### AC-009 — Trust mode is changed only through the agent command surface

An AI agent must set or change an action's trust mode only through the
`set_trust_mode` agent command, never by mutating the `RuntimeAction.trustMode`
field or project state directly outside the agent command surface.

Verify with: `pnpm test:run -- setTrustModeCommand`

### AC-010 — Destructive AI operations spawn new artifacts, not in-place overwrites

When an AI operation in a non-destructive mode (suggest-only, create-branch,
apply-reversible, analyze-only) produces output, it must create new clips/tracks
or reversible undo entries rather than overwriting the original artifact; only
replace-selection and destructive-commit modes may modify an original, and only
after the AC-004 confirmation.

Verify with: `pnpm test:run -- executeWithTrustMode`

## Open questions

- [ ] (non-blocking) Should "background refine only" be a distinct seventh mode (as in
  future-spec) or a flag on create-branch? Default: a flag, to keep the set small.

- [ ] (non-blocking) Central policy engine (deferred-gap from intake/future-spec.md,
  "Cross-feature system design / 3. Policy engine"): future-spec calls for a single
  central policy layer that controls six things at once — (1) trust-mode defaults,
  (2) rights gating, (3) provenance requirements, (4) runtime fallback behavior,
  (5) collaboration permissions, and (6) auto-promotion to higher fidelity. Only the
  trust-mode-defaults slice is in this spec's scope (see AC-006, which sets per-feature
  defaults at the action level). Open: whether trust-mode defaults should be sourced
  from a shared policy layer (so role-based and rights-aware overrides resolve in one
  place) versus the per-feature declaration AC-006 uses now. The other five concerns
  belong to the rights/provenance, runtime, and collaboration features; collaboration
  also wants trust-mode defaults to differ by user role (future-spec collaboration
  model). Non-blocking for v1 because action-level defaults satisfy AC-006 without the
  central layer.

- [ ] (non-blocking) Full agent command surface (deferred-gap from intake/future-spec.md,
  "Cross-feature system design / 4. Agent interface"): future-spec specifies a stable
  internal command surface the agent uses and must not bypass —
  `create_intent`, `normalize_intent`, `plan_actions`, `run_engine`, `create_branch`,
  `merge_branch`, `capture_memory`, `extract_performance_dna`, `apply_performance_dna`,
  `query_capabilities`, `explain_unavailability`, `set_trust_mode`, `generate_provenance`,
  `export_with_policy`, `promote_fidelity`, `attach_constraints`, `log_decision` — with
  the hard rule "the agent must never mutate project state directly outside this surface."
  Of these, only `set_trust_mode` is in this spec's scope and is now covered by AC-009;
  the remaining commands are owned by their respective feature specs (intent, variants,
  capture, performance DNA, capabilities, provenance, fidelity, constraints, decisions).
  Open: where the surface is defined and how the "no direct mutation" invariant is
  enforced estate-wide (not just for `set_trust_mode`). Non-blocking for trust modes.

- [ ] (non-blocking) AI UX philosophy / integration patterns (deferred-gap from
  intake/full-spec.md, "15. AI UX philosophy — integration patterns"): full-spec states
  every AI feature must satisfy four conditions simultaneously — **Transparency**
  (show every module/setting the AI chose; e.g. show the EQ curve, show gain changes
  numerically; never apply processing without a visual representation), **Control**
  (three tiers: (1) macro view = single intensity slider + accept/reject, (2) module
  view = individual parameters, (3) full manual edit; default AI intensity to 60-70%,
  not 100%), **Relevance** (detect or let the user specify genre/style; reference tracks
  are the primary mechanism for defining sonic targets), and **Reversibility** (all AI
  operations create undoable entries; destructive operations create new clips/tracks
  rather than modifying originals — the in-scope slice is now AC-010). It also names two
  concrete patterns: the **"learn" button** (press record, AI analyzes during playback,
  requires a minimum of 4 seconds of audio, result appears immediately but is not
  committed until the user confirms; works for EQ, mastering, dynamics, any spectral
  processing) and **ghost clips for AI suggestions** (40% opacity, subtle colored border,
  AI indicator icon; accept with Enter/double-click, dismiss with Escape, play on hover
  for quick audition — this is the visual contract behind suggest-only, AC-002). Plus
  placement rules (always-visible vs one-click right-click vs toggleable panel vs
  Cmd+K palette; AI is not a separate mode) and a "what NOT to build" list (no full song
  generation from text, no auto-arrange without asking, no credit/token systems, no AI
  content vendor lock-in — all outputs must be standard audio/MIDI). Most of this is
  cross-cutting AI-UX philosophy owned by the AI surfaces themselves; only the
  reversibility guarantee (AC-010) and the ghost-clip suggest-only contract (AC-002)
  fall under trust modes. Open: whether the 60-70% default intensity, the learn-button
  4-second/confirm-before-commit flow, and the ghost-clip visual spec (opacity, accept
  keys) should be normative requirements here or in the per-surface AI specs.
  Non-blocking for trust modes.

## Affected areas

- `src/modules/AiRuntime/` (TrustMode model, RuntimeAction field, dispatch enforcement)
- `src/modules/Arrangement/useCases/clip/` (ghost clip path for suggest-only)
- `src/modules/Workspace/presentations/views/PromptBar.tsx` (mode selector + scope display)

## Dropped from sources

- Engine-declared supported trust modes (future-spec L technical) — deferred until the
  engine rack lands (`engine-visibility-swap`); v1 enforces at the action level.
