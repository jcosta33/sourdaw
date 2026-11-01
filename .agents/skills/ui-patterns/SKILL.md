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

## Rules

### 1. Presentation only

Components, hooks, and view models bind controls to semantics, layout, and read surfaces. They are not the home of validation, persistence, undo orchestration, or engine control, and they must not import repositories, handlers, or engine (`architecture` rule 5). React stays in presentation. Business logic parked in a hook labelled “UI” is boundary evasion, not presentation.

**Why:** business rules in the tree duplicate across surfaces and couple domain logic to the React lifecycle.

**Enforced by:** dependency-cruiser `react-only-in-presentation`, `presentation-no-direct-repositories`, `presentation-no-direct-handlers`, `presentation-no-engine-runtime-imports`; logic hidden in a hook is review only.

### 2. React owns layout; renderer surfaces own pixels

Draw timeline lanes, waveforms, piano roll, automation, spectrograms, dense overlays, and hot-path meters on a Canvas/WebGL/WebGPU-style renderer, never a giant DOM forest. React owns chrome, layout, and accessibility semantics around the surface; the renderer draws, hit-tests, and runs pointer/render loops.

**Why:** DOM-per-clip does not scale.

**Enforced by:** review only.

### 3. Hooks stay thin; leaf components stay dumb

Hooks bind presentation to explicit actions and read surfaces. Leaf `presentations/components/` must not import useCases or business stores. Views and hooks compose; pass props into leaves.

**Why:** fat hooks and business-aware leaves are untestable mini-use-cases hiding in the React tree.

**Enforced by:** dependency-cruiser `components-no-usecase-access`, `components-no-business-store-access`, and `components-no-usecase-transitively` (`.dependency-cruiser.reachability.cjs`); hook thickness is review only.

### 4. Accessibility is part of component design

Reach for real buttons, inputs, sliders, lists, dialogs, menus, and labels before anything custom. Toggle/pressed semantics must be explicit for transport, mute/solo, arm, and similar controls. Core workflows stay keyboard-operable. Dense surfaces still need accessible support in the surrounding chrome.

**Why:** semantics retrofitted after the fact produce visual-only controls that fail a11y and usually keyboard use too.

**Enforced by:** ESLint `jsx-a11y-x` rules (for example `interactive-supports-focus`) for markup; pressed semantics and keyboard operability are review only.

### 5. Styling is systematic

Use design tokens and project-standard primitives, tuned for dark-UI legibility at DAW density. No one-off styling system per feature. Extend CVA variants on `src/components/ui/` primitives; do not dump a long `className` pile onto `Button` / `Input` / other `ui/` primitives at the call site.

**Why:** fragmented styling is unmaintainable at DAW density.

**Enforced by:** review only (contrast probe 6: `review-stances/rendered-ui-layout.md`).

### 6. No happy-path-only coding

The audio thread, async projections, the network, and rendering backends genuinely fail. Build error boundaries, fallback UIs, and structured pending/error state for async UI. Platform-dependent renderer selection must preserve a working fallback, such as WebGPU to Canvas.

**Why:** a failure with no designed state leaves a blank or frozen surface mid-session.

**Enforced by:** review only.

### 7. Compiler-friendly components

Prefer a ternary or early `return null` over render `&&`. Consume Context with `use()`, not `useContext`.

**Why:** leaky non-boolean `&&` (e.g. `0 && …`) silently renders `0`/`''`.

**Enforced by:** ESLint `@eslint-react/no-leaked-conditional-rendering` (error); `use()` over `useContext` is review only.

### 8. View models shape display; writes go through actions

View models shape data for display. Validation, persistence, cross-feature mutation, and undo semantics belong elsewhere. A renderer or view model may interpret interactions; authoritative writes go through use cases / `executeAppAction`.

**Why:** a view model that writes truth is a use case in the wrong clothes.

**Enforced by:** dependency-cruiser `presentation-no-direct-repositories` and `presentation-no-direct-handlers`; direct store writes are review only.

## References

- [docs/05-accessibility.md](../../../docs/05-accessibility.md) — a11y patterns for the app.
- [docs/architecture/03-typescript-module.md](../../../docs/architecture/03-typescript-module.md) — presentation layer placement.
- `.dependency-cruiser.cjs` — `components-no-*`, `presentation-no-*`, `react-only-in-presentation`.
- `.dependency-cruiser.reachability.cjs` — `components-no-usecase-transitively`.
- Review probes for dock allocation, status strips and footer disclosure: `../review-stances/rendered-ui-layout.md`.
