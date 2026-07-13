---
type: spec
id: SPEC-runtime-transparency
title: Runtime transparency strip
status: draft
owner: The Sourdaw team
sources:
  - intake/differentiators.md
  - intake/full-spec.md
  - intake/future-spec.md
---

# Runtime transparency strip

## Intent

The user must always be able to tell whether they are hearing a cached result, a
preview, a downgraded fallback, or a final render — and why. A persistent, compact
Runtime Strip (integrated into the existing status bar) reports runtime class,
session mode, fidelity tier, fallback state, and queue state in blunt language, with
expandable details. Make every hidden fallback a visible fallback reason.

## Non-goals

- Choosing or switching engines (see `engine-visibility-swap`).
- Choosing session modes (see `session-modes`); this strip displays the active mode.
- The capability model that explains availability (see existing `chrome-first-capability`).

## Requirements

### AC-001 — Runtime class and fidelity are always visible

The status bar must show the active runtime class (browser-wasm / native-rust /
hybrid) and the current fidelity tier at all times during a session.

Verify with: `pnpm test:run -- StatusBar`

### AC-002 — Fallbacks surface with machine-readable reasons

When any component falls back to a lower-quality path, the strip must show a fallback
indicator whose expandable detail names the component, the reason, and the degradation.

Verify with: `pnpm test:run -- runtimeTransparencyStore`

### AC-003 — Blunt status vocabulary

Playback state must be reported using explicit states (e.g. ready, preview render,
downgraded — missing component, stale — needs re-render, blocked by capability).

Verify with: `pnpm test:run -- runtimeStatusVocabulary`

### AC-004 — Queue and staleness are reported

The strip must surface pending render count and stale-phrase count, derived from the
existing render queue store.

Verify with: `pnpm test:run -- runtimeTransparencyStore`

### AC-005 — Expandable details explain selection

Clicking the strip must reveal why the current engine/tier was selected, why any
fallback happened, and what would improve quality.

Verify with: `manual` — trigger a WebGPU-unavailable fallback and confirm the detail panel explains it

### AC-006 — LLM status and grammar fallback surface in the strip

The strip must reflect the AI-runtime status transitions emitted by the single LLM
entry point — `loading` → `ready`/`generating` → `ready`/`error` — and, when a
schema-constrained (grammar) generation falls back to an unconstrained retry on the
same backend, must show that as a fallback with the failed-component reason rather
than silently degrading.

Verify with: `pnpm test:run -- runtimeTransparencyStore`

## Open questions

- [ ] (non-blocking) Colored-dot semantics (green production / amber preview / red
  degraded) — confirm with design; does not block the data model.
- [ ] (non-blocking) (deferred-gap from intake/audit-deferred-fixes.md) Group C — AI
  runtime architecture (the deferred "AI runtime transparency surfacing" scope, items
  I-02/I-04). This is a backend consolidation refactor, not a strip-only requirement,
  but it owns the data the strip reads, so the strip's AI-runtime segment depends on
  it landing. Substantive detail to preserve:
  - **One LLM entry point (C1, I-02):** a single `invokeLlm` use case at
    `src/modules/AiRuntime/useCases/llm/invokeLlm.ts` with one signature
    (`{ messages, mode: 'chat'|'tools'|'schema', tools?, schema?, onToken?, abortSignal? }`).
    It resolves the backend order via `getBackendChain()`, iterates backends with one
    fallback policy across all three modes (logging and falling through on failure),
    **owns the `llmStatusStore` transitions** (`loading` → `ready`/`generating` →
    `ready` or `error`) that AC-006 surfaces, honors `abortSignal`, and throws a single
    `LlmInvocationError` chaining the underlying messages when every backend fails.
  - **Grammar/schema fallback in one place (C1):** for `mode: 'schema'`, attempt the
    schema-constrained call first, then retry the same backend without `response_format`
    if it throws — this is the hidden grammar fallback AC-006 makes visible.
  - **Call-site consolidation (C2):** the three current dispatch sites
    (`sendChatMessage`, `executeDsoEdit.invokeLlm`, `inference.generateToolCalls`) stop
    iterating backends themselves and call `invokeLlm` with the right `mode`; the
    private `invokeLlm` helper inside `executeDsoEdit` is deleted.
  - **Per-document AI undo (C3, I-04):** `executeDsoEdit.commitDsos` records each
    touched doc's `Automerge.getHeads(doc)` before/after as `{ docId, headsBefore,
    headsAfter }` instead of a whole-bundle `saveSnapshot()`; the observable bound is
    that an AI edit touching one MIDI note writes only O(size of that note's document)
    of undo data. (Tangential to the strip's display; carried for losslessness.)
  This spec displays AI-runtime state; it does not own the consolidation work — that
  lives in the consolidated-audit Group C scope. Non-blocking for the strip's data
  model, which can read `llmStatusStore` regardless of how dispatch is structured.

## Affected areas

- `src/modules/Workspace/stores/` (runtime transparency store, aggregation)
- `src/modules/Workspace/presentations/views/StatusBar.tsx`
- reads `platformCapabilities`, `capabilityStore`, `renderQueueStore`

## Dropped from sources

- The engine-chain segment with mid-session swap — that is `engine-visibility-swap`,
  which extends this strip rather than living here.
- A separate full-screen transparency panel — kept in the status bar by design.
