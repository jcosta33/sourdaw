---
name: ui-patterns
description: >-
    Build and review React presentation-layer UI for the DAW: presentation-only
    components, dense editor surfaces on a renderer not the DOM, accessibility and
    failure states built into the component shape, theming through tokens. ALWAYS
    apply when writing or reviewing React components, hooks, contexts, or view
    models, when touching accessibility or keyboard behavior, when building
    timeline / waveform / piano-roll / automation / spectrogram surfaces, or when
    styling presentation. Skip engine/DSP/Rust work, pure business-rule or
    data-model changes, and build tooling config.
---

## Purpose

The presentation layer stays presentation-only. Business truth in the tree, dense editors as DOM forests, and accessibility bolted on late all end the same way: untestable UI and RT-adjacent work on the wrong thread.

## Core rules

### 1. Presentation only

Components, hooks, and view models bind controls to semantics, layout, and read surfaces. They are not the home of validation, persistence, undo orchestration, or engine control, and they must not import repositories, handlers, or engine (`architecture` rule 5). React stays in presentation (`react-only-in-presentation`). Business logic parked in a hook labelled “UI” is boundary evasion, not presentation. Business rules in the tree duplicate across surfaces and couple domain logic to the React lifecycle.

### 2. React owns layout; renderer surfaces own pixels

Draw timeline lanes, waveforms, piano roll, automation, spectrograms, dense overlays, and hot-path meters on a Canvas/WebGL/WebGPU-style renderer, never a giant DOM forest. React owns chrome, layout, and accessibility semantics around the surface; the renderer draws, hit-tests, and runs pointer/render loops. DOM-per-clip does not scale.

### 3. Hooks stay thin; leaf components stay dumb

Hooks bind presentation to explicit actions and read surfaces. Leaf `presentations/components/` must not import useCases or business stores (`components-no-usecase-access`, `components-no-business-store-access`, `components-no-usecase-transitively`). Views and hooks compose; pass props into leaves. Fat hooks and business-aware leaves are untestable mini-use-cases hiding in the React tree.

### 4. Accessibility is part of component design

Reach for real buttons, inputs, sliders, lists, dialogs, menus, and labels before anything custom. Toggle/pressed semantics must be explicit for transport, mute/solo, arm, and similar controls. Core workflows stay keyboard-operable. Dense surfaces still need accessible support in the surrounding chrome. Semantics retrofitted after the fact produce visual-only controls that fail a11y and usually keyboard use too.

### 5. Styling is systematic

Use design tokens and project-standard primitives, tuned for dark-UI legibility at DAW density. No one-off styling system per feature: fragmented styling is unmaintainable at that density.

### 6. No happy-path-only coding

The audio thread, async projections, the network, and rendering backends genuinely fail. Build error boundaries, fallback UIs, and structured pending/error state for async UI. Platform-dependent renderer selection must preserve a working fallback, such as WebGPU to Canvas.

### 7. Compiler-friendly components

Prefer a ternary or early `return null` over render `&&`; leaky non-boolean `&&` (e.g. `0 && …`) is **error** lint and silently renders `0`/`''`. Consume Context with `use()`, not `useContext`.

### 8. View models shape display; writes go through actions

View models shape data for display. Validation, persistence, cross-feature mutation, and undo semantics belong elsewhere. A renderer or view model may interpret interactions; authoritative writes go through use cases / `executeAppAction`. One that writes truth is a use case in the wrong clothes.

## References

- [docs/05-accessibility.md](../../../docs/05-accessibility.md) — a11y patterns for the app.
- [docs/architecture/03-typescript-module.md](../../../docs/architecture/03-typescript-module.md) — presentation layer placement.
- `.dependency-cruiser.cjs` — `components-no-*`, `presentation-no-*`, `react-only-in-presentation`.
- `.dependency-cruiser.reachability.cjs` — `components-no-usecase-transitively`.
