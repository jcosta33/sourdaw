---
name: llm-action-bridge
type: agent-guide
description: >-
  Route AI-generated intent through a typed, validated action registry before it
  touches DAW state. ALWAYS apply this skill when building or reviewing
  copilot/AI features, prompt handling, voice-command flows, structured-output
  parsing, or tool/action registries — even if the change looks like a small
  prompt tweak or one new action. Do not let model output mutate React state,
  call engine objects, or run commands directly without validation and the
  normal action boundary. Skip this skill for non-AI feature work,
  model/inference tuning with no action execution, or UI styling tasks.
---

# Skill: llm-action-bridge

## Purpose

The AI layer must never directly mutate arbitrary app state. Its job is to
interpret user intent and emit structured actions that the app validates and
executes through the same boundary as everything else. This skill prevents the
failure mode where a probabilistic model gets a privileged write path —
silently editing stores, calling engine internals, or executing a partially-
wrong output as if it were truth.

The bridge keeps AI integration typed, auditable, deterministic enough for
control tasks, architecturally safe, reversible where possible, and isolated
from direct UI/runtime mutation.

---

## Core rules

### 1. The model outputs actions, not arbitrary mutations

The only sanctioned flow is one direction, prompt to execution:

```text
User prompt
-> local or native inference
-> structured action(s)
-> validation
-> optional confirmation
-> action execution
-> normal state/runtime updates
```

The model must **not**: mutate React state directly, call engine objects
directly, execute arbitrary code, bypass the command/action layer, reach into
hidden internals, or invent unsupported operations at runtime.

_Why: a model is probabilistic; if its output can write directly, a single
hallucinated field corrupts truth or runtime with no checkpoint in between._

### 2. The action registry must be explicit

Actions must be named, typed, validated, executable through a known registry,
easy to audit, and constrained to what the app actually supports. Do not hide
execution behind magical dynamic dispatch unless it remains transparent and
strongly typed.

_Why: an explicit registry is the audit surface — you cannot reason about what
the AI can do if dispatch is stringly-typed or resolved at runtime._

### 3. Separate planning from execution

The model **may** plan: interpret ambiguous language, propose one or more
actions, suggest a sequence of steps, and infer likely targets from context.
Execution **must** stay deterministic and architecture-compliant — it validates
action structure, validates referenced IDs/targets, enforces ranges and domain
rules, requires confirmation for risky operations where needed, and calls the
same action/command boundary the rest of the app uses.

_Why: planning can be flexible because it is reversible up to the execution
gate; execution cannot, so it must be rigid. AI does not get a privileged write
path._

### 4. Validate all model output before execution

Never trust raw model output. Validation must confirm: known action type,
correct payload shape, sane numeric bounds, required IDs exist, referenced
resources/capabilities are available, sensible action order when multiple
actions are emitted, and that destructive or broad-scope operations are gated
appropriately.

_Why: the model is the untrusted edge of the system; validation is the only
place a malformed or out-of-range action is caught before it reaches state._

### 5. Keep inference placement free, execution placement fixed

Inference may run browser-local for lightweight tasks or native-side for heavier
local models. Execution still goes through the same app action layer either way.
The model may be probabilistic; the execution layer must not be.

_Why: where the model runs is a performance/cost decision; how its output
executes is a safety invariant, and the two must not be coupled._

### 6. Design actions to be specific and reversible

Good AI-driven actions are specific, composable, easy to validate, aligned to
user intent, compatible with undo/redo, and reviewable in logs/history where
appropriate. Do not start with uncontrolled "chatbot can do anything" behavior;
grow the registry from a small set of validated targets (see
[Bundled resources](#bundled-resources)).

_Why: an action that routes through the normal command boundary inherits
undo/redo and history for free; an ad-hoc mutation does not, and cannot be
reversed when the model is wrong._

### 7. Gate risky operations behind confirmation

Require user confirmation for destructive actions, multi-target/bulk changes,
ambiguous target selection, operations likely to surprise the user, and
expensive or irreversible workflows. The shape: AI proposes, app validates, user
confirms when needed, command executes normally.

_Why: the model cannot judge the cost of being wrong; the human confirmation
gate is where that judgment lives for the operations that matter._

### 8. Make AI execution observable

It must be possible to answer, for any prompt: what did the model propose, what
did validation accept, what actually executed, and what failed and why. The full
four-question observability contract and the confirmation triggers live in
[Bundled resources](#bundled-resources).

_Why: a partially-wrong model output is undiagnosable unless every stage leaves
a trace; observability is what makes debugging, safety, and trust possible._

---

## What does not belong

- **Model/inference internals** — prompt engineering depth, model selection, and
  local-vs-native inference tuning that produces no executed action belong with
  the AI feature's own design notes, not this bridge. This skill governs the
  boundary from structured action to executed state, not the model behind it.
- **The concrete command/action implementations** — the handler and command
  boundary itself is owned by the app's state and write-path discipline. This
  skill says AI must route through that boundary; it does not redefine it. If a
  state/write-path guide is installed, see `../state-and-write-paths/SKILL.md`.
- **Generic UI/presentation concerns** — how a confirmation dialog looks or where
  a copilot panel sits is presentation work, not bridge work.

---

## Anti-patterns

### CRITICAL — Model writes truth/runtime directly

❌ Model edits stores, React state, engine objects, or plugin handles  
✅ Structured actions → validate → `executeAppAction` / command registry

### CRITICAL — Unvalidated execution

❌ Raw model JSON drives handlers with no schema/bounds/ID checks  
✅ Validate type, payload, bounds, IDs, capabilities before execute

### HIGH — Privileged AI write path

❌ Special AI-only mutators that bypass undo/command describe  
✅ Same boundary as UI and shortcuts (`state-and-write-paths`)

### HIGH — Stringly dispatch

❌ Dynamic `eval`-like action names with no registry  
✅ Explicit typed action registry

### MEDIUM — Planning conflated with execution

❌ Flexible multi-step plan executed as one unvalidated blob  
✅ Plan freely; execute step-by-step through the rigid gate

---

## Self-review gate

Before accepting any AI-control change, answer each question below in writing and
paste the supporting output. **Not complete until every answer is written and the
`pnpm deps:validate` and `pnpm typecheck` output appears verbatim below the answers.**

1. Does the model emit structured actions rather than arbitrary mutations?
2. Is there an explicit action registry the new action is registered in?
3. Is all model output validated before execution (type, shape, bounds, IDs, capabilities, order)?
4. Does execution go through the normal action/command boundary — no privileged AI write path?
5. Are destructive, bulk, or ambiguous operations gated behind confirmation?
6. Does the AI layer avoid direct access to UI/runtime internals?
7. Is planning kept separate from execution?
8. Would this still be safe if the model output were partially wrong? Name the stage that catches the bad field.
9. Can you answer the four observability questions for a sample prompt (proposed / accepted / executed / failed)?

Then paste, verbatim and fenced:

- `pnpm deps:validate` output (dependency-boundary validation — proves the AI layer did not import across a boundary).
- `pnpm typecheck` output (proves the action payloads are typed end to end).

A question answered without its pasted evidence reads Unverified, not Pass. The
review is not done until both command outputs are present.

---

## Bundled resources

- `references/action-catalog.md` — the early-target action list, the properties
  shared by good AI-driven actions, the four-question observability contract, and
  the full confirmation-policy trigger list. Read it when designing or reviewing
  concrete actions.
