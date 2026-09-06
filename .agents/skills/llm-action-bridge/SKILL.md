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

## Core rules

### 1. The model outputs actions, not mutations

Model output is structured actions, or a plan of actions — never ad-hoc store writes, engine calls, or React setState. Execution goes through the normal command/action boundary after validation.

**Why:** unconstrained model writes bypass undo, ownership, and every domain invariant.

### 2. The action registry is explicit

Every executable AI action is a named, typed entry with a known payload shape and an owning execution path. Never execute model output as code or shell. Grow the registry one validated action at a time — never start from "the chatbot can do anything". Start with actions that map to existing commands.

**Why:** an open-ended tool surface is an open-ended corruption surface.

### 3. Separate planning from execution

Planning (prompt → proposed actions) is separate from execution (validate → run through the app boundary). Never execute as a side effect of parsing.

**Why:** conflating plan and execute makes partial failures and user confirmation impossible.

### 4. Validate all model output before execution

Check structure, bounds, ID existence, and capability before any write. A rejected action must not partially apply.

**Why:** models emit confident nonsense; validation is the last line before truth mutates.

### 5. Inference placement is free; execution placement is fixed

Where the model runs — cloud, local, browser — can vary. Where actions execute cannot: always the same validated path as non-AI code.

**Why:** a privileged AI write path that skips Command/use cases is a second architecture.

### 6. Actions are specific, undoable, and cheap to validate

**Why:** vague mega-actions cannot be validated, undone, or explained.

### 7. Gate risky operations behind confirmation

Require explicit user confirmation before destructive actions, multi-target or bulk changes, ambiguous target selection, surprising side effects, and expensive or irreversible workflows.

The shape is: AI proposes → validation → confirm if required → execute → observe.

**Why:** bulk delete from a bad parse is worse than a refused action.

### 8. Make AI execution observable

For any prompt, answer: what the model proposed, what validation accepted, what actually executed, and what failed and why.

**Why:** without those four answers, partial model wrongness is undiagnosable.

### 9. Preserve qualifiers through prompt segmentation

When a multi-action prompt is segmented, retain each action's exclusions, qualifiers, and reference ambiguity without borrowing adjacent action text. Test connector and punctuation variants, and mutate literal-ID versus display-name and Unicode-overlap evidence so exact identifiers never erase genuine ambiguity.

**Why:** clause boundaries are a parsing convenience, not permission to widen a destructive action or collapse competing targets.

### 10. Prove complete deterministic admission

Deterministic execution requires a grammar that consumes the whole request and resolves every target uniquely. Test a complete exact command across the registry before applying open-ended complexity heuristics. Resolve reserved context references before unquoted display names, and treat unquoted multiword values as semantic input unless a bounded grammar proves that the whole value is literal. Fuzzy search rank, partial text, context availability, or the first matching registry entry are discovery evidence only; they never authorize an action.

**Why:** once a partial proposal reaches validation, approval, and receipts, the omitted intent cannot be reconstructed and an ambiguity can look like a deliberate edit.

### 11. Keep source authority and protections on original request text

Masked text supports intent discovery and segmentation; it never proves literal source syntax or target authority. Compiler-resolved identities validate selector structure, but deterministic, direct, and compiler-backed proposals must derive source authority from the same original request text and the same complete selection set; a primary selection field does not prove that the selection is unique. Reserved selection phrases apply only outside quotes so quoted project names remain literal references. Parse quote boundaries once with an offset-preserving scanner that treats in-word apostrophes as content. Extract preservation clauses quote-aware from the original whole request, resolve every bounded list member independently while retaining whole-name evidence, and conservatively union every protected candidate. An incomplete explicit protection is a rejection, not an empty permission set. Enforce protections after final target resolution including compiler overrides, and carry protected objects into the application-owned proposal scope.

**Why:** a project-name placeholder can resemble executable grammar, while a qualifier split away from an action still limits what the whole request authorizes.

## References

- [docs/architecture/03-typescript-module.md](../../../docs/architecture/03-typescript-module.md) — use cases and command surfaces actions must hit.
- [docs/03-state-management.md](../../../docs/03-state-management.md) — who may write which state.
