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

## References

- [docs/architecture/03-typescript-module.md](../../../docs/architecture/03-typescript-module.md) — use cases and command surfaces actions must hit.
- [docs/03-state-management.md](../../../docs/03-state-management.md) — who may write which state.
