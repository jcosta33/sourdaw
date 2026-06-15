# Action catalog and observability reference

Bundled resource for the `llm-action-bridge` skill. Relocated here to keep the
SKILL.md body inside the practical length target; nothing in this file is
optional reading once you are designing or reviewing concrete AI actions.

---

## Good early AI targets

Start the action registry from a small, well-understood set of operations. These
are specific, composable, easy to validate, intent-aligned, and (where it
applies) undo/redo-compatible and reviewable in logs/history. Do not start with
uncontrolled "chatbot can do anything" behavior — grow the registry one
validated action at a time.

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

Each of these maps cleanly to an existing command/action on the app's normal
write path. That mapping is the test of whether an action belongs in the early
registry: if there is no existing command boundary to route it through, it is not
an early target — it is new app behavior that must be designed and validated
independently first.

---

## What good AI-driven actions have in common

When deciding whether a proposed action belongs in the registry, check it
against these properties:

- **specific** — names one operation, not a vague capability.
- **composable** — can be sequenced with other actions without special casing.
- **easy to validate** — its payload shape and bounds are checkable before execution.
- **aligned to user intent** — corresponds to something the user could ask for in plain language.
- **compatible with undo/redo** — executes through the same boundary that records history.
- **reviewable in logs/history where appropriate** — leaves a trace a human can inspect.

---

## Observability: the four questions

AI action execution must be easy to inspect. Prefer systems where, for any given
prompt, it is possible to answer all four of these from logs or history:

1. **What did the model propose?** — the raw structured action(s) emitted before validation.
2. **What did validation accept?** — the subset that passed structure, bounds, ID, and capability checks.
3. **What actually executed?** — the commands that ran through the normal action/command boundary.
4. **What failed and why?** — rejected actions with the specific validation or execution reason.

This is load-bearing for debugging, safety, and trust. A bridge that can answer
"the AI did something" but not these four questions is not observable enough — a
partially-wrong model output becomes undiagnosable.

---

## Confirmation policy: when to require a human gate

Require explicit user confirmation before execution for:

- **destructive actions** — anything that deletes or overwrites user work.
- **multi-target / bulk changes** — operations touching many objects at once.
- **ambiguous target selection** — when the referenced target could not be resolved unambiguously.
- **operations likely to surprise the user** — effects the user did not obviously ask for.
- **expensive or irreversible workflows** — anything costly to undo or impossible to reverse.

The shape that satisfies this policy:

```text
AI proposes
-> app validates
-> user confirms when needed
-> command executes normally
```
