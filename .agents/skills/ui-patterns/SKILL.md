---

name: ui-patterns
description: Apply when building or reviewing React UI, accessibility behavior, dense editor surfaces, view composition, renderer surfaces, Tailwind styling, or presentation-layer patterns. This is the authoritative skill for frontend UI implementation.

---

# SKILL: ui-patterns

## Purpose

This skill exists to keep frontend work:

- accessible
- React-friendly
- renderer-aware
- architecturally clean
- consistent in layout/styling behavior
- honest about where presentation stops and business logic begins

The frontend should be the best possible interface to the DAW, not a second business layer.

---

## Core principles

### 1. Presentation only

React components, hooks, and contexts belong to presentation.

They may:

- render views
- subscribe to projections/stores
- call actions
- coordinate view-scoped state
- manage refs and render loops
- bind controls to semantics

They must not become the primary home of business rules.

### 2. React owns layout; renderer surfaces own pixels

Use React for:

- layout
- routing
- panels
- toolbars
- forms
- controls
- inspectors
- summaries
- accessibility semantics around complex surfaces

Use Canvas/WebGL/WebGPU-style renderers for:

- timeline lanes
- waveform fields
- piano roll
- automation surfaces
- spectrograms
- dense overlays
- hot-path meters

Do not render dense editor surfaces as giant DOM forests.

### 3. Hooks should stay thin

Hooks may bind UI to:

- actions
- projections
- selectors
- telemetry
- refs

Hooks should not become:

- the business layer
- the persistence layer
- the engine controller
- the undo/redo coordinator

### 4. Accessibility is part of component design

A11y is not a post-processing step.

Transport controls, faders, toggles, lists, dialogs, and dense surfaces must be designed with semantics and keyboard behavior in mind.

### 5. Styling should be systematic

Use the project’s design tokens/component system consistently.

Do not fragment styling into many unrelated local approaches.

---

## React implementation guidance

### Prefer plain components

Write simple components first.

Do not add manual memoization patterns by default.
Keep component logic simple and compiler-friendly.

### Keep view models presentation-focused

Presentation-layer shaping is fine.

Presentation-layer ownership of:

- validation
- persistence
- cross-feature mutation
- undo semantics
  is not fine.

### Suspense/error boundaries where appropriate

Async UI should use a structured pending/error model.
Do not scatter ad hoc loading/error handling everywhere when a boundary is the cleaner fit.

---

## Accessibility guidance

### Use semantic controls first

Prefer real buttons, inputs, sliders, lists, dialogs, menus, and labels.

Only drop to custom semantics when native semantics genuinely cannot represent the interaction.

### Toggle semantics must be explicit

Transport buttons, mute/solo controls, arm buttons, and similar controls must expose clear pressed/selected/checked semantics.

### Keyboard support is required for core workflows

Core operations should remain keyboard-operable where feasible:

- transport
- dialogs
- track navigation
- selection movement
- common editor interactions

### Dense surfaces still need accessible support around them

Canvas/WebGL/WebGPU surfaces may own the pixels, but surrounding UI still needs to expose accessible pathways, status, and controls where possible.

---

## Dense editor surfaces

### Renderer surfaces are presentation hot paths, not business layers

They may own:

- drawing
- hit testing
- pointer interaction hot paths
- render-loop orchestration

They must not quietly become:

- business write owners
- persistence orchestrators
- hidden command executors without explicit boundaries

### Fallbacks matter

If a renderer backend is platform-dependent, fallback paths must be designed intentionally rather than treated as negligible.

---

## Styling guidance

### Use token-driven theming

Prefer consistent theme variables and utility patterns over arbitrary one-off styling.

### Use established UI primitives

Prefer project-standard primitives for:

- buttons
- sliders
- dialogs
- lists
- menus
- forms

### Optimize for DAW ergonomics

Prioritize:

- legibility in dark UI
- dense but readable layouts
- long-session usability
- stable control affordances

---

## Anti-patterns

### 1. Hook owns business workflow

Wrong:

- hook validates, mutates truth, coordinates runtime, and manages undo/history

Right:

- hook binds presentation to explicit actions and read surfaces

### 2. Dense surface rendered as giant DOM tree

Wrong:

- timeline or piano roll rendered as thousands of DOM nodes on hot paths

Right:

- renderer surface for dense pixels, React for layout and orchestration

### 3. Accessibility bolted on late

Wrong:

- visual-only controls with weak semantics

Right:

- semantics built into component design

### 4. Styling fragmentation

Wrong:

- ad hoc styling systems proliferate for the same class of UI

Right:

- consistent token/component usage

### 5. View models become business models

Wrong:

- presentation structures own validation, persistence, or cross-feature write logic

Right:

- keep them presentation-focused

### 6. Renderer owns hidden truth mutation

Wrong:

- renderer hot path mutates authoritative state without explicit action boundaries

Right:

- renderer may interpret interactions, but writes still go through explicit actions

---

## Review checklist

Before accepting frontend UI code, verify:

1. Is this presentation code rather than business logic?
2. Are hooks thin and boundary-respecting?
3. Are dense rendering surfaces using the correct rendering model?
4. Are semantics and keyboard behavior reasonable?
5. Is accessibility built into the component shape?
6. Does styling follow the project’s token/component system?
7. Did the change reduce or increase presentation/business coupling?
8. Did any renderer or view-model code quietly become a hidden business layer?

---
