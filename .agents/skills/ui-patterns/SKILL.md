---
name: ui-patterns
description: >-
  Build and review React presentation-layer UI for the DAW: presentation-only
  components, dense editor surfaces on a renderer not the DOM, accessibility and
  failure states built into the component shape, theming through tokens. ALWAYS
  apply when writing or reviewing React components, hooks, contexts, or view
  models, when touching accessibility or keyboard behavior, when building
  timeline / waveform / piano-roll / automation / spectrogram surfaces, or when
  styling presentation. Do not put validation, persistence, undo, or
  engine-control logic into a hook, view model, or renderer hot path. Skip
  engine/DSP/Rust work, pure business-rule or data-model changes, and build
  tooling config.
---

## Purpose

Presentation code that owns business truth, dense editors rendered as giant DOM forests, a11y bolted on late, or hand-memoized components that fight the React Compiler all produce the same outcome: untestable UI and RT-adjacent work on the wrong thread. This skill keeps the presentation layer presentation-only.

## Core rules

### 1. Presentation only

Components, hooks, and view models bind controls to semantics, layout, and read surfaces. They must not become the primary home of validation, persistence, undo orchestration, or engine control. Presentation must not import repositories, handlers, or engine: **same-module** `presentation-no-direct-*` (**error**); **cross-module** deep private `cross-module-index-only` (**error**). React stays in presentation (`react-only-in-presentation`).

**Why:** business rules in the tree duplicate across surfaces and couple domain logic to React lifecycle.

### 2. React owns layout; renderer surfaces own pixels

Use Canvas/WebGL/WebGPU-style renderers for timeline lanes, waveforms, piano roll, automation, spectrograms, dense overlays, and hot-path meters — not giant DOM forests. React owns chrome, layout, and accessibility semantics around complex surfaces. Renderers may draw, hit-test, and run pointer/render loops; they must not own business writes. Writes still go through explicit actions.

**Why:** DOM-per-clip does not scale; a renderer that mutates truth is an undocumented write path.

### 3. Hooks stay thin; leaf components stay dumb

Hooks bind presentation to explicit actions and read surfaces. Leaf `presentations/components/` must not import useCases or business stores (`components-no-usecase-access`, `components-no-business-store-access`, `components-no-usecase-transitively`). Views and hooks compose; pass props into leaves.

**Why:** fat hooks and business-aware leaves become untestable mini-use-cases in the React tree.

### 4. Accessibility is part of component design

Prefer real buttons, inputs, sliders, lists, dialogs, menus, and labels. Toggle/pressed semantics must be explicit for transport, mute/solo, arm, and similar controls. Core workflows stay keyboard-operable where feasible. Dense surfaces still need accessible support in surrounding chrome.

**Why:** semantics retrofitted after the fact produce visual-only controls that fail a11y and often keyboard use.

### 5. Styling is systematic

Use design tokens and project-standard primitives. Optimize for dark-UI legibility, dense but readable layouts, long-session usability, and stable affordances. Avoid one-off styling systems per feature.

**Why:** fragmented styling becomes unmaintainable under DAW density.

### 6. No happy-path-only coding

Plan for audio-thread failure, async projection failure, network failure, and unavailable rendering backends: error boundaries, fallback UIs, structured pending/error for async UI. Platform-dependent renderer selection must preserve a working fallback, such as WebGPU to Canvas.

**Why:** a DAW depends on an audio thread and async projections that genuinely fail.

### 7. Prefer plain, compiler-friendly components

Do not hand-write `useMemo`, `useCallback`, or `React.memo` — the React Compiler owns memoization. No `forwardRef` (ref is a regular prop in React 19). Never render with `&&` — use ternary or early `return null`. Consume Context with `use()`, not `useContext`.

**Why:** hand memoization fights the compiler; `&&` silently renders `0`/`''`; `forwardRef` is obsolete.

### 8. View models stay presentation-focused; writes go through actions

View models shape data for display. Validation, persistence, cross-feature mutation, and undo semantics belong elsewhere. A renderer may interpret interactions; authoritative writes still go through use cases / `executeAppAction`.

**Why:** a view model or hit-test handler that writes truth is a use case in the wrong clothes.

## What does not belong

- Engine/DSP/Rust implementation.
- Pure business-rule or data-model changes with no presentation surface.
- Build tooling and package config.
- Gaming architecture rules by moving business logic into hooks labeled “UI”.

## Anti-patterns

### CRITICAL — Hook owns business truth

❌ Wrong: hook validates, persists, and orchestrates undo for a domain edit.

✅ Correct: hook calls an explicit action/use case and binds read surfaces.

### CRITICAL — Renderer writes authoritative state

❌ Wrong: canvas pointer handler calls `trackStore.set` or mutates project truth inline.

✅ Correct: interpret interaction → dispatch explicit action.

### CRITICAL — Manual memoization / `forwardRef` / `&&` render

❌ Wrong: `useMemo`/`useCallback`/`React.memo`, `forwardRef`, or `{count && <Badge />}`.

✅ Correct: plain components; `ref` as prop; ternary or early return.

### HIGH — Dense editor as DOM forest

❌ Wrong: one DOM node per clip/note for a full timeline.

✅ Correct: renderer surface; React for layout and chrome.

### HIGH — A11y bolted on late

❌ Wrong: div-with-onClick transport controls, keyboard after the fact.

✅ Correct: semantic controls and keyboard built into the component shape.

### HIGH — Component imports useCases or business stores

❌ Wrong: leaf `presentations/components/*` imports foreign `useCases` or business `stores`.

✅ Correct: views/hooks compose; pass props into leaf components.

## References

- [docs/05-accessibility.md](../../../docs/05-accessibility.md) — a11y patterns for the app.
- [docs/architecture/03-typescript-module.md](../../../docs/architecture/03-typescript-module.md) — presentation layer placement.
- `.dependency-cruiser.cjs` — `components-no-*`, `presentation-no-*`, `react-only-in-presentation`.
