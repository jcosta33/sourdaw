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

Components, hooks, and view models bind controls to semantics, layout, and read surfaces. They are not the home of validation, persistence, undo orchestration, or engine control. Presentation code must not import its module's repositories, handlers, services, validators or transformers, or anything under `engine/`, `runtime/`, `worklets/` or `workers/`; it reaches them through use cases. The boundary is closed from the other side too: `presentations/stores/` and `presentations/context/` are private to presentation, so non-presentation code never imports them, even in the same module, and leaf components do not import presentation stores — they take props or go through a hook (full list: `architecture` rule 5). React stays in presentation. Writes leave presentation as actions (rule 8). Business logic parked in a hook labelled “UI” is boundary evasion, not presentation.

**Why:** business rules in the tree duplicate across surfaces and couple domain logic to the React lifecycle.

**Enforced by:** dependency-cruiser `react-only-in-presentation`, `presentation-no-direct-repositories`, `presentation-no-direct-handlers`, `presentation-no-direct-services-validators-transformers`, `presentation-no-engine-runtime-imports`, `presentation-stores-private-even-intra-module`, `presentation-context-private-even-intra-module`, `components-no-presentation-store-access`; logic hidden in a hook is review only.

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

Use design tokens and project-standard primitives from `src/components/ui/`, tuned for dark-UI legibility at DAW density. No one-off styling system per feature. Use a primitive's existing variants where it has them (`Button`'s CVA `variant` and `size`). A recurring look becomes a variant on the primitive — a `class-variance-authority` variant following `src/components/ui/button.tsx` — rather than a long `className` pile repeated at call sites. One-off layout classes passed through `className` are fine: the primitives merge it through `cn` (`#/utils/Styles/cn`, clsx plus tailwind-merge).

**Why:** fragmented styling is unmaintainable at DAW density.

**Enforced by:** review only (contrast probe 6: `review-stances/rendered-ui-layout.md`).

### 6. No happy-path-only coding

The audio thread, async projections, the network, and rendering backends genuinely fail. Build error boundaries, fallback UIs, and structured pending/error state for async UI. Platform-dependent renderer selection must preserve a working fallback, such as WebGPU to Canvas.

**Why:** a failure with no designed state leaves a blank or frozen surface mid-session.

**Enforced by:** review only.

### 7. Compiler-friendly components

React Compiler owns memoization: never add `useMemo`, `useCallback`, or `React.memo`. Never wrap a component in `forwardRef`; React 19 passes `ref` as an ordinary prop. Prefer a ternary or early `return null` over render `&&`. Consume Context with `use()`, not `useContext`. Lint runs only in PR CI, so this rule is where an author learns the bans in time.

**Why:** hand memoization duplicates what the compiler derives and goes stale when dependencies change; leaky non-boolean `&&` (e.g. `0 && …`) silently renders `0`/`''`.

**Enforced by:** ESLint `sourdaw/no-manual-memoization`, `@eslint-react/no-forward-ref` and `@eslint-react/no-leaked-conditional-rendering` (all error, PR CI); `use()` over `useContext` is review only.

### 8. View models shape display; writes go through actions

View models shape data for display. Validation, persistence, cross-feature mutation, and undo semantics belong elsewhere. A renderer or view model may interpret interactions; authoritative writes go through use cases or an action dispatch, never a business-store write from presentation (`state-and-write-paths` rule 3).

A dispatch a person triggered — a click, a key, a drop, a menu choice — goes through `executeUserAppAction` from `#/modules/Command/useCases`, never a bare `void executeAppAction(...)`. The admission gates (a repair-required or brief-locked project) refuse by rejecting; `executeUserAppAction` turns that `AppActionConflictError` into a warning notification and resolves, and rethrows every other failure unchanged. Because it resolves after a refusal, resolution does not mean the action ran: never chain success behaviour (closing a dialog, showing "saved", advancing a flow) on its `.then` as if it did. A caller that must know whether the action ran awaits `executeAppAction` itself and handles the rejection. Programmatic, agent, and handler dispatch use `executeAppAction` directly.

**Why:** a view model that writes truth is a use case in the wrong clothes, and a dropped dispatch promise turns a refusal the user must see into an unhandled rejection.

**Enforced by:** dependency-cruiser `presentation-no-direct-repositories` and `presentation-no-direct-handlers`; `src/modules/Command/useCases/__tests__/executeUserAppAction.spec.ts` for the notify-and-resolve and rethrow contract; choosing the entry point and direct store writes are review only.

## References

- [docs/05-accessibility.md](../../../docs/05-accessibility.md) — a11y patterns for the app.
- [docs/architecture/03-typescript-module.md](../../../docs/architecture/03-typescript-module.md) — presentation layer placement.
- `.dependency-cruiser.cjs` — `components-no-*`, `presentation-no-*`, `react-only-in-presentation`.
- `.dependency-cruiser.reachability.cjs` — `components-no-usecase-transitively`.
- Review probes for dock allocation, status strips and footer disclosure: `../review-stances/rendered-ui-layout.md`.
