---
name: ui-patterns
type: agent-guide
description: >-
  Build and review React presentation-layer UI for the DAW: presentation-only
  components, dense editor surfaces on a renderer not the DOM, accessibility and
  failure states built into the component shape, theming through tokens.
  ALWAYS apply this skill when writing or reviewing React components, hooks,
  contexts, or view models, when touching accessibility or keyboard behavior, when
  building timeline / waveform / piano-roll / automation / spectrogram surfaces, or
  when styling presentation — even if it looks like a "simple" component or a
  one-line style tweak. Do not put validation, persistence, undo, or engine-control
  logic into a hook, view model, or renderer hot path directly. Skip this skill for
  engine/DSP/Rust work, pure business-rule or data-model changes, and build tooling
  config.
---

# Skill: ui-patterns

## Purpose

This is the authoritative skill for frontend UI implementation in the DAW. It exists to stop
the presentation layer from quietly becoming a second business layer — hooks that mutate
truth, view models that own validation and persistence, renderer hot paths that execute
hidden commands — and to stop "happy-path-only" UI that ignores pending, loading, and
failure states. The frontend should be the best possible interface to the DAW, not a place
where business rules accrete.

The failure mode this prevents: code that compiles, renders, and looks done, but has buried
write authority outside explicit action boundaries, skipped a11y semantics, or assumed
every async dependency succeeds.

## Core rules

### 1. Presentation only
React components, hooks, and contexts belong to presentation. They may render views,
subscribe to projections/stores, call actions, coordinate view-scoped state, manage refs and
render loops, and bind controls to semantics. They must not become the primary home of
business rules.
_Why: when business rules leak into presentation, truth has two owners and the DAW's data
model can no longer be reasoned about from the engine/core layer alone._

### 2. React owns layout; renderer surfaces own pixels
Use React for layout, routing, panels, toolbars, forms, controls, inspectors, summaries, and
the accessibility semantics around complex surfaces. Use Canvas/WebGL/WebGPU-style renderers
for timeline lanes, waveform fields, piano roll, automation surfaces, spectrograms, dense
overlays, and hot-path meters. Do not render dense editor surfaces as giant DOM forests.
_Why: thousands of DOM nodes on an interaction hot path destroy frame budget; the DOM is the
wrong tool for per-pixel dense editor surfaces._ Full backend/fallback guidance:
`references/dense-surfaces.md`.

### 3. Hooks stay thin
Hooks may bind UI to actions, projections, selectors, telemetry, and refs. Hooks must not
become the business layer, the persistence layer, the engine controller, or the undo/redo
coordinator.
_Why: a "thick" hook hides cross-feature mutation behind a render-time call, making writes
untraceable and undo semantics inconsistent._

### 4. Accessibility is part of component design
A11y is not a post-processing step. Transport controls, faders, toggles, lists, dialogs, and
dense surfaces must be designed with semantics and keyboard behavior in mind from the start.
_Why: semantics retrofitted after the fact produce visual-only controls that screen readers
and keyboard users cannot operate, and the redesign cost is far higher later._ Detailed
semantics, toggle, and keyboard rules: `references/accessibility.md`.

### 5. Styling is systematic
Use the project's design tokens / component system consistently. Do not fragment styling into
many unrelated local approaches for the same class of UI.
_Why: one-off styling for each instance of the same control drifts visually and makes
dark-UI legibility and long-session ergonomics impossible to maintain._ Token/primitive/
ergonomics detail: `references/styling.md`.

### 6. Evaluate the holistic application state — no happy-path-only coding
When implementing UI you must evaluate the holistic state of the application. Ask: Does the UI
update optimistically? Are pending and loading states explicitly handled? What happens if the
network request fails, or the audio thread crashes? Implement error boundaries, fallback UIs,
and graceful degradation for any component that depends on async data or external state.
Assume everything that can fail will fail.
_Why: a DAW depends on an audio thread and async projections that genuinely do fail; UI that
only models success leaves the user stranded with no feedback when they do._

### 7. Prefer plain, compiler-friendly components
Write simple components first. Do not add manual memoization patterns by default; keep
component logic simple and compiler-friendly.
_Why: premature memoization adds surface area the compiler already handles and obscures the
data flow a reviewer needs to follow._

### 8. Keep view models presentation-focused
Presentation-layer shaping of data is fine. Presentation-layer ownership of validation,
persistence, cross-feature mutation, or undo semantics is not.
_Why: a view model that owns validation or persistence is a business model wearing a
presentation name — the exact coupling rule 1 forbids, hidden one layer down._

### 9. Writes go through explicit actions, even from renderers
Renderer surfaces may own drawing, hit testing, pointer-interaction hot paths, and
render-loop orchestration, and may interpret interactions. They must not become business
write owners, persistence orchestrators, or hidden command executors. Writes still go through
explicit actions with explicit boundaries.
_Why: a renderer that mutates authoritative state inside its hot path is an undocumented
command path no reviewer or undo system can see._

## What does not belong

- Business rules, validation, persistence, undo/redo coordination, and engine control —
  these live behind explicit actions in the core/engine layers, not in components, hooks,
  view models, or renderer hot paths. (Architecture-boundary enforcement, if a sibling guide
  is installed: `../architecture-violations/SKILL.md`.)
- DSP / Web Audio engine internals and RT-audio constraints — out of scope here; that is
  engine work, not presentation.
- Project command values (test/lint/build/typecheck/validate). These resolve from the
  consuming repo's `AGENTS.md` Commands table via the `cmd*` slots named in the self-review
  gate — never hardcode them into a component or this skill.

## Anti-patterns

| Temptation | Do instead |
| --- | --- |
| Hook validates, mutates truth, coordinates runtime, and manages undo/history | Hook binds presentation to explicit actions and read surfaces |
| Timeline or piano roll rendered as thousands of DOM nodes on hot paths | Renderer surface for dense pixels; React for layout and orchestration |
| Visual-only controls with weak semantics, a11y bolted on late | Semantics and keyboard behavior built into the component shape |
| Ad hoc styling systems proliferate for the same class of UI | Consistent token / component usage |
| Presentation structures own validation, persistence, or cross-feature write logic | Keep view models presentation-focused |
| Renderer hot path mutates authoritative state without an action boundary | Renderer interprets interactions; writes go through explicit actions |
| Async UI assumes the request/audio thread always succeeds | Error boundaries, pending/loading states, fallback UIs, graceful degradation |
| Manual memoization sprinkled by default | Plain components first; let the compiler optimize |

## Self-review gate

Before declaring frontend UI work complete, write a Self-review section and answer every
question below with a written trace — checkboxes alone do not count. Resolve command names
against the consuming repo's `AGENTS.md` Commands table; if a slot is missing or undefined,
ask the user rather than inventing a command.

1. Is this presentation code rather than business logic?
2. Are hooks thin and boundary-respecting?
3. Are dense rendering surfaces using the correct rendering model (renderer, not DOM forest)?
4. Are semantics and keyboard behavior reasonable for the core workflows touched?
5. Is accessibility built into the component shape, not bolted on?
6. Does styling follow the project's token / component system?
7. Are pending, loading, and failure states explicitly handled, with boundaries/fallbacks?
8. Did the change reduce rather than increase presentation/business coupling?
9. Did any renderer or view-model code quietly become a hidden business layer?

Then paste real command output into the Self-review — do not summarize with "all passing":

- `cmdValidate` output (dependency-boundary validation — proves no presentation→business
  coupling was introduced). **Not complete until the verbatim `cmdValidate` output appears in
  the Self-review section.**
- `cmdTypecheck` output (types clean across the blast radius).
- `cmdTest` output for the touched UI, and `cmdLint` if styling/structure changed.

Not complete until every question above has a written answer beneath it and the `cmdValidate`
output is pasted verbatim.

## Bundled resources

- `references/accessibility.md` — semantic-controls-first rule, explicit toggle semantics,
  required keyboard support for core workflows, and a11y around dense surfaces.
- `references/dense-surfaces.md` — what renderer surfaces may and must not own, and
  intentional platform-dependent fallback design.
- `references/styling.md` — token-driven theming, project-standard UI primitives, and
  DAW ergonomics (dark-UI legibility, density, long-session usability, stable affordances).
