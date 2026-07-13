---
name: llm-action-bridge
description: >-
  Route AI-generated intent through a typed, validated action registry before it
  touches DAW state. ALWAYS apply when building or reviewing copilot/AI features,
  prompt handling, voice-command flows, structured-output parsing, or tool/action
  registries — even if the change looks like a small prompt tweak or one new
  action. Do not let model output mutate React state, call engine objects, or run
  commands without validation and the normal action boundary. Skip non-AI feature
  work, model/inference tuning with no action execution, and UI styling.
---

## Purpose

The AI layer must never directly mutate arbitrary app state. Its job is to interpret user intent and emit structured actions that the app validates and executes through the same write paths humans use. Skipping that bridge — free-form tool calls into stores, engine, or DOM — is how model mistakes become irreversible project damage.

## Core rules

### 1. The model outputs actions, not arbitrary mutations

Model output is structured actions (or a plan of actions), not ad-hoc store writes, engine calls, or React setState. Execution always goes through the normal command/action boundary after validation.

**Why:** unconstrained model writes bypass undo, ownership, and every domain invariant.

### 2. The action registry must be explicit

Every executable AI action is a named, typed entry with a known payload shape and an owning execution path. Grow the registry one validated action at a time — do not start with “chatbot can do anything”.

Good early targets map to existing commands: add/rename track, set tempo, toggle playback, mute/solo, create bus, insert plugin, apply preset, navigate/reveal, arm recording.

**Why:** an open-ended tool surface is an open-ended corruption surface.

### 3. Separate planning from execution

Planning (interpret prompt → propose actions) is separate from execution (validate → run through the app boundary). Do not execute as a side effect of parsing.

**Why:** conflating plan and execute makes partial failures and user confirmation impossible.

### 4. Validate all model output before execution

Check structure, bounds, ID existence, and capability before any write. Rejected actions must not partially apply.

**Why:** models emit confident nonsense; validation is the last line before truth mutates.

### 5. Keep inference placement free; execution placement fixed

Where the model runs (cloud, local, browser) can vary. Where actions execute must not — always the same validated path as non-AI code.

**Why:** a privileged AI write path that skips Command/use cases is a second architecture.

### 6. Design actions to be specific and reversible

Prefer actions that are specific, composable, easy to validate, intent-aligned, undo/redo-compatible, and reviewable in logs/history.

**Why:** vague mega-actions cannot be validated, undone, or explained.

### 7. Gate risky operations behind confirmation

Require explicit user confirmation before: destructive actions, multi-target/bulk changes, ambiguous target selection, surprising side effects, expensive or irreversible workflows.

Shape: AI proposes → validation → (confirm if required) → execute → observe.

**Why:** bulk delete from a bad parse is worse than a refused action.

### 8. Make AI execution observable

For any prompt, be able to answer: (1) what the model proposed, (2) what validation accepted, (3) what actually executed, (4) what failed and why.

**Why:** without those four answers, partial model wrongness is undiagnosable.

## What does not belong

- Free-form natural language executed as code or shell.
- Model output writing stores/engine/DOM directly.
- Inference hyperparameter tuning with no action execution path.
- UI chrome for chat that does not touch the action bridge (pure styling).

## Anti-patterns

### CRITICAL — Model writes truth/runtime directly

❌ Wrong: tool handler calls `trackStore.set` or engine APIs from raw model JSON.

✅ Correct: model emits a registry action → validate → `executeAppAction` / owning use case.

### CRITICAL — Unvalidated execution

❌ Wrong: parse JSON and run immediately.

✅ Correct: schema + bounds + ID + capability checks; reject before write.

### HIGH — Privileged AI write path

❌ Wrong: special “AI service” that mutates project state outside Command/use cases.

✅ Correct: same write boundary as keyboard/UI.

### HIGH — Stringly dispatch

❌ Wrong: `switch (actionName: string)` with untyped payloads.

✅ Correct: typed registry entries with payload schemas.

### MEDIUM — Planning conflated with execution

❌ Wrong: “plan” step that already mutated state.

✅ Correct: immutable plan object, then a separate execute step (with confirm when required).

## References

- [docs/architecture/03-typescript-module.md](../../../docs/architecture/03-typescript-module.md) — use cases and command surfaces actions must hit.
- [docs/03-state-management.md](../../../docs/03-state-management.md) — who may write which state.
