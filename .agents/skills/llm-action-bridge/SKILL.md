---

name: llm-action-bridge
description: Apply when building or reviewing AI/copilot features, prompt handling, voice-command flows, structured-output parsing, tool/action registries, or execution of AI-generated actions. This is the authoritative skill for connecting local AI to safe DAW behavior.

---

# SKILL: llm-action-bridge

## Purpose

The AI layer must not directly mutate arbitrary state.

Its job is to interpret user intent and emit structured actions that the app validates and executes.

This skill exists to keep AI integration:

- typed
- auditable
- deterministic enough for control tasks
- architecturally safe
- reversible where possible
- isolated from direct UI/runtime mutation

---

## Core model

### The model outputs actions, not arbitrary mutations

Preferred flow:

```text
User prompt
-> local or native inference
-> structured action(s)
-> validation
-> optional confirmation
-> action execution
-> normal state/runtime updates
```

The model must not:

- mutate React state directly
- call engine objects directly
- execute arbitrary code
- bypass the command/action layer
- reach into hidden internals
- invent unsupported operations at runtime

### The action registry must be explicit

Actions should be:

- named
- typed
- validated
- executable through a known registry
- easy to audit
- constrained to what the app actually supports

Do not hide execution behind magical dynamic dispatch unless it remains transparent and strongly typed.

---

## Planning vs execution

### Planning

The model may help:

- interpret ambiguous language
- propose one or more actions
- suggest a sequence of steps
- infer likely targets based on context

### Execution

Execution must remain deterministic and architecture-compliant.

The execution layer must:

- validate action structure
- validate referenced IDs/targets
- enforce ranges and domain rules
- require confirmation for risky operations where needed
- call the same action/command boundary used by the rest of the app

AI does not get a privileged write path.

---

## Validation rules

All model output must be validated before execution.

Validation should confirm:

- known action type
- correct payload shape
- sane numeric bounds
- required IDs exist
- referenced resources/capabilities are available
- action order is sensible if multiple actions are emitted
- destructive or broad-scope operations are gated appropriately

Do not trust raw model output.

---

## Action design

Good AI-driven actions are:

- specific
- composable
- easy to validate
- aligned to user intent
- compatible with undo/redo
- reviewable in logs/history where appropriate

Good early AI targets include:

- add track
- rename track
- set tempo
- toggle playback
- mute/solo
- create bus
- insert plugin
- apply preset
- navigate to a panel or view
- select or reveal an object
- arm recording

Do not start with uncontrolled “chatbot can do anything” behavior.

---

## Runtime placement

### Inference and execution are separate concerns

Inference may run:

- browser-local for lightweight tasks
- native-side for heavier local models

Execution still goes through the same app action layer either way.

### Keep the action layer deterministic

The model may be probabilistic.
Execution must not be.

---

## Confirmation policy

Require confirmation when appropriate for:

- destructive actions
- multi-target/bulk changes
- ambiguous target selection
- operations likely to surprise the user
- expensive or irreversible workflows

A useful design is:

- AI proposes
- app validates
- user confirms when needed
- command executes normally

---

## Observability

AI action execution should be easy to inspect.

Prefer systems where it is possible to answer:

- what did the model propose?
- what did validation accept?
- what actually executed?
- what failed and why?

This is important for debugging, safety, and trust.

---

## Anti-patterns

### 1. Model mutates arbitrary app state

Wrong:

- model directly edits stores, UI state, engine internals, or plugin handles

Right:

- model emits structured actions

### 2. Free-form chat output as control surface

Wrong:

- execution logic depends on vague natural-language prose

Right:

- structured, validated actions

### 3. Hidden dynamic dispatch

Wrong:

- action execution is hard to audit or depends on stringly magical runtime behavior

Right:

- explicit action registry

### 4. No validation before execution

Wrong:

- raw model output executes directly

Right:

- validate first, then execute

### 5. AI path bypasses normal architecture

Wrong:

- AI gets special permission to mutate truth or runtime directly

Right:

- AI uses the same action/command boundary as everything else

### 6. Planning and execution collapse together

Wrong:

- model output is treated as directly executable truth

Right:

- planning can be flexible; execution remains rigid and validated

---

## Review checklist

Before accepting AI-control code, verify:

1. Does the model emit structured actions rather than arbitrary mutations?
2. Is there an explicit action registry?
3. Is all model output validated?
4. Does execution go through the normal action/command boundary?
5. Are destructive or ambiguous operations gated appropriately?
6. Does the AI layer avoid direct access to UI/runtime internals?
7. Is planning separate from execution?
8. Would this still be safe if the model output were partially wrong?

---
