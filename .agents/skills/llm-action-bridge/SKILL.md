---
name: llm-action-bridge
description: >-
    Route AI-generated intent through a typed, validated action registry before it
    touches DAW state. ALWAYS apply when building or reviewing copilot/AI features,
    prompt handling, voice-command flows, structured-output parsing, or tool/action
    registries — even if the change looks like a small prompt tweak or one new
    action. Skip non-AI feature work, model/inference tuning with no action
    execution, and UI styling.
---

## Purpose

The AI layer interprets intent and emits structured actions. It never mutates app state directly. Free-form tool calls into stores, engine, or DOM are how model mistakes become irreversible project damage.

## Rules

### 1. The model outputs actions, not mutations

Model output is structured actions, or a plan of actions — never ad-hoc store writes, engine calls, or React setState. Execution goes through the normal command/action boundary after validation.

**Why:** unconstrained model writes bypass undo, ownership, and every domain invariant.

**Enforced by:** `src/modules/Command/useCases/__tests__/agentControlBoundary.spec.ts` for the voice route; otherwise review only.

### 2. The action registry is explicit

Every executable AI action is a named, typed entry with a known payload shape and an owning execution path. Never execute model output as code or shell. Grow the registry one validated action at a time — never start from "the chatbot can do anything". Start with actions that map to existing commands.

**Why:** an open-ended tool surface is an open-ended corruption surface.

**Enforced by:** `src/modules/Command/useCases/__tests__/executableAppActionRegistry.spec.ts` and `commandRegistryCompleteness.spec.ts`.

### 3. Separate planning from execution

Planning (prompt → proposed actions) is separate from execution (validate → run through the app boundary). Never execute as a side effect of parsing.

**Why:** conflating plan and execute makes partial failures and user confirmation impossible.

**Enforced by:** review only.

### 4. Validate all model output before execution

Check structure, bounds, ID existence, and capability before any write. A rejected action must not partially apply.

**Why:** models emit confident nonsense; validation is the last line before truth mutates.

**Enforced by:** `src/modules/Command/useCases/__tests__/commandBatchPreflight.spec.ts` (rejection before the first handler effect).

### 5. Inference placement is free; execution placement is fixed

Where the model runs — cloud, local, browser — can vary. Where actions execute cannot: always the same validated path as non-AI code.

**Why:** a privileged AI write path that skips Command/use cases is a second architecture.

**Enforced by:** review only.

### 6. Actions are specific, undoable, and cheap to validate

Each registry entry names one bounded effect: declared typed arguments, the target capabilities each argument must satisfy, and a risk level (`ExecutableAppActionRisk` in `executableAppActionRegistry.ts`). Prefer several small actions over one broad action, and give each a replay (undo) path through the command boundary.

**Why:** vague mega-actions cannot be validated, undone, or explained.

**Enforced by:** `executableAppActionRegistry.spec.ts` (every descriptor has a valid risk level and a unique action type); specificity and undoability are otherwise review only.

### 7. Gate risky operations behind confirmation

Require explicit user confirmation before destructive actions, multi-target or bulk changes, ambiguous target selection, surprising side effects, and expensive or irreversible workflows.

The shape is: AI proposes → validation → confirm if required → execute → observe.

**Why:** bulk delete from a bad parse is worse than a refused action.

**Enforced by:** the risk-to-confirmation map in `getExecutableCommandConfirmation.ts` is observed by `commandRegistryCompleteness.spec.ts` (confirmation required exactly when risk is not `bounded-reversible`, for every registered command); the confirmation reason text is review only. `appActionExecutionPolicy.spec.ts` covers the app-action execution policy's confirmation, not the registration map. `commandApprovalBoundary.spec.ts` covers approval-binding consumption, not the map.

### 8. Make AI execution observable

For any prompt, answer: what the model proposed, what validation accepted, what actually executed, and what failed and why.

**Why:** without those four answers, partial model wrongness is undiagnosable.

**Enforced by:** review only.

### 9. Preserve qualifiers through prompt segmentation

When a multi-action prompt is segmented, retain each action's exclusions, qualifiers, and reference ambiguity without borrowing adjacent action text. Exact identifiers never erase genuine ambiguity.

**Why:** clause boundaries are a parsing convenience, not permission to widen a destructive action or collapse competing targets.

**Enforced by:** review only (probe: `review-stances/correctness.md`).

### 10. Deterministic execution needs complete admission

Deterministic execution requires a grammar that consumes the whole request and resolves every target uniquely. Reserved context references resolve before unquoted display names; an unquoted multiword value is semantic input unless a bounded grammar proves it literal. Fuzzy rank, partial text, context availability, and the first matching registry entry are discovery evidence only and never authorize an action.

**Why:** once a partial proposal reaches validation, approval, and receipts, the omitted intent cannot be reconstructed and an ambiguity can look like a deliberate edit.

**Enforced by:** review only (probe: `review-stances/correctness.md`).

### 11. Source authority and protections come from the original request text

Masked text supports discovery and segmentation only. Every proposal route derives source authority, selection sets, and protections from the original request text, parsed once and quote-aware. An incomplete explicit protection is a rejection, never an empty permission set, and protections are enforced after final target resolution, compiler overrides included.

**Why:** a project-name placeholder can resemble executable grammar, and a qualifier split away from an action still limits what the whole request authorizes.

**Enforced by:** review only (probe: `review-stances/correctness.md`).

## References

- [docs/architecture/03-typescript-module.md](../../../docs/architecture/03-typescript-module.md) — use cases and command surfaces actions must hit.
- [docs/03-state-management.md](../../../docs/03-state-management.md) — who may write which state.
- Review probes for dispatcher context, segmentation, admission, and protections: `../review-stances/correctness.md`.
