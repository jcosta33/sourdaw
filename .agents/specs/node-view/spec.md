---
type: spec
id: SPEC-node-view
title: Node view — visual graph editor for device routing
status: retired
owner: The Sourdaw team
sources:
    - 'Originating design note: node-view graph editor (.agents/specs/node-view/)'
---

# Node view — visual graph editor for device routing

## Intent

Render the selected track's device chain as an editable node graph (Input → devices →
Output, plus sends/returns) where edits sync bidirectionally with `Track.devices` and
`Track.sends`. The track model stays the source of truth; the graph is a reconciled
reflection.

## Non-goals

- A project-wide cross-track graph (this view is per-track).
- Feedback / cyclic audio routing.
- Promoting visual-only `mixer`/`splitter`/`merger` nodes into real DSP routing (v1 = annotation).
- Putting node _position_ changes onto the undo stack (position is UI-only state).

## Requirements

### AC-001 — Graph derived from track on open

Opening the view for a track must build the graph from `Track.devices` and `Track.sends`
(Input → devices → Output), not from independently stored topology.

Verify with: `pnpm test:run -- nodeView`

### AC-002 — Edits apply back to the track

A graph edit (reorder, remove, bypass, send connect/disconnect) must dispatch the
corresponding `Track` action so `Track.devices`/`Track.sends` reflect the change.

Verify with: `pnpm test:run -- nodeView`

### AC-003 — Position-preserving reconcile

When the track's devices/sends change while the view is open, reconcile must keep the
`(x,y)` of nodes whose `deviceId` is unchanged, append new devices, and drop removed ones.

Verify with: `pnpm test:run -- nodeView`

### AC-004 — Cycle rejection

A connection that would create a cycle must be rejected with a typed error and must not
mutate the store.

Verify with: `pnpm test:run -- nodeView`

### AC-005 — Send/return mapping

Connecting a `send` node to a `return` node must add a corresponding `Send` to
`Track.sends`.

Verify with: `pnpm test:run -- nodeView`

### AC-006 — Layout persistence round-trip

Saving and reloading a project must restore node positions, viewport, and user-added extra
nodes/edges while rebuilding topology from the track.

Verify with: `pnpm test:run -- nodeView`

### AC-007 — Lazy-loaded renderer

The React Flow renderer must be loaded via dynamic import only when the view is first
opened, not in the initial bundle.

Verify with: `manual` — inspect the network/chunk graph; reactflow chunk loads on first open

### AC-008 — Node-view module isolation

The feature must not introduce cross-module internal imports; track edits flow through
existing `Track` actions.

Verify with: `pnpm deps:validate`

### AC-009 — Node-view entry point and toggle

The view must be reachable from the View menu and the `Cmd+G` shortcut, both routing
through the `toggle-node-view` Command Palette entry / `toggleNodeView` action that flips
the view's `visible` state.

Verify with: `pnpm test:run -- nodeView` (and inspect `miscCommands.ts` `toggle-node-view` entry, formerly at line 213)

### AC-018 — Overlay substitutes for the linear insert row

Opening the view must present an overlay that _replaces_ the selected track's linear insert
row; closing must collapse back to that linear insert view. Toggling `visible` (AC-009) is
the trigger, but this AC binds the view-substitution semantics — overlay shown in place of
the insert row when open, insert row restored when closed.

Verify with: `pnpm test:run -- nodeView` (assert the overlay replaces the linear insert row on open and the insert row is restored on close)

### AC-019 — Routing-change announcements for screen-readers

The node graph must announce store-driven routing changes to assistive technology: adding or
removing a send or sidechain edge must emit an `aria-live="polite"` (`role="status"`)
announcement (e.g. "Added send X to Y" / "Removed sidechain"), so the change is not silent
to screen-readers. This is the live-region change feedback beyond AC-017's static per-node
labels.

Verify with: `pnpm test:run -- nodeView` (assert an aria-live/role=status region updates when a send or sidechain edge is added or removed)

### AC-010 — Re-Layout capability

A Re-Layout toolbar button must re-run auto-layout for the open graph via a
`relayoutNodeView` action backed by a `relayoutGraph` use-case.

Verify with: `pnpm test:run -- nodeView`

### AC-011 — Graph error states

Invalid graph conditions — cycles, disconnected nodes, and a `send` connected to a
non-existent `return` — must be surfaced with a red outline on the offending node and a
toast, beyond the AC-004 cycle rejection.

Verify with: `pnpm test:run -- nodeView`

### AC-012 — Node and canvas context-menu controls

A node's right-click context menu must offer Rename and (for effects/instruments) Open
Parameter Panel.

Verify with: `manual` — open the node context menu and the canvas context menu; confirm the listed entries appear

### AC-013 — Renderer UI affordances

The renderer must provide a mini-map, Zoom In/Out/Fit controls, node chrome (label,
input ports left / output ports right, bypass indicator), and shift-click on an edge to
delete it.

Verify with: `manual` — open the node view; confirm mini-map, zoom controls, node chrome, and shift-click edge deletion

### AC-014 — Data-layer surface preserved

The data layer must expose the 10 `ProcessingNodeType` values (`input | output | effect |
instrument | mixer | splitter | merger | send | return | sidechain`), the `NODE_COLORS`
map, and the nine existing node-view use-cases (`buildFromDeviceChain`, `addNode`,
`removeNode`, `moveNode`, `toggleBypass`, `connectNodes`, `disconnectNodes`,
`setViewport`, `toggleNodeView`).

Verify with: `pnpm test:run -- nodeView` (and inspect `src/modules/Plugin/stores/nodeView.ts` and `src/modules/Plugin/useCases/nodeView/`)

### AC-015 — Send/return disconnect removal

Disconnecting a `send` node from a `return` node must remove the corresponding `Send`
from `Track.sends`.

Verify with: `pnpm test:run -- nodeView`

### AC-016 — Canvas context-menu controls

The canvas right-click menu must offer Add Effect… and Add Send.

Verify with: `manual` — open the canvas context menu; confirm the listed entries appear

### AC-017 — Keyboard navigation and screen-reader labels

The node graph must be keyboard-navigable — tab cycles through nodes, Enter focuses the
tabbed node — and each node must carry a screen-reader label matching that node's
track / bus / device name.

Verify with: `pnpm test:run -- nodeView` (assert tab order across nodes, Enter-to-focus, and per-node accessible name)

## Open questions

- [ ] Q-001 — On track-selection change while the view is `visible`, should it auto-reopen
      for the newly selected track, and how is that wired to the selection store?
- [ ] Q-002 — Do visual-only `mixer`/`splitter`/`merger` nodes persist as `extraNodes`, or
      are they dropped on reload until promoted to real routing?
- [ ] Q-003 — Reconcile-vs-edit race ordering when a remote/CRDT patch arrives mid-drag.
- [ ] Q-004 — Project-wide routing-visualization graph (deferred-gap from intake/implementation-gaps.md,
      item 7.8d "Routing Visualization"; non-blocking). The gap asks for a force-directed node graph
      (d3-force or equivalent) visualizing track → bus → device routing plus sends and sidechain wiring,
      **read-only in v1** (editing is a follow-up). This conflicts with this spec's per-track, editable
      scope and the Non-goal "A project-wide cross-track graph"; capture here rather than fold into the
      per-track requirements. Open sub-questions: (a) is this a separate project-wide view or an
      extension of this one; (b) the renderer — React Flow (this spec) vs a force-directed d3-force
      layout (the gap); (c) whether sidechain wiring is shown as edges in the project-wide graph
      (this spec models `sidechain` only as a `ProcessingNodeType`, AC-014).
- [ ] Q-005 — Interactive pan/zoom performance target (deferred-gap from intake/implementation-gaps.md,
      item 7.8d "Routing Visualization"; non-blocking). The gap's acceptance bar: the routing graph must
      render a 64-track project with 8 busses and 16 sends at **≥ 30 fps** interactive (pan / zoom) on the
      reference machine, verified via a Playwright perf capture. No equivalent throughput/fps budget exists
      for this spec's per-track React Flow canvas; decide whether a per-track fps target and a Playwright
      perf capture apply here, and what node/edge count defines the reference case for a single track.
      (restored detail) The original design note's Tests section proposed a concrete per-track budget that
      no requirement currently carries: with **50 nodes, initial render < 100 ms on the declared baseline machine**, and
      **drag at 60 fps** (snapshot timing). Decide whether to adopt these per-track numbers as the
      reference case or supersede them with the gap's interactive ≥ 30 fps bar.
- [ ] Q-006 — Stray-edge / compaction path for sidechain routing (restored detail; forward gap).
      Adjacent to this spec's `sidechain` `ProcessingNodeType` (AC-014): the Routing module's
      `removeSidechainRoute` (`removeSidechainRoute.ts:5-19`) does not validate route existence and there
      is no compaction path, so an engine `sidechainConnection` with no corresponding store entry is never
      cleaned up. The Routing audit proposed a `compactSidechainConnections` use-case that diffs engine
      state against store state. Decide whether the node graph should surface or trigger such compaction
      when a `sidechain` edge has no backing route, or whether this stays wholly within the Routing module.

## Known risks

- Adjacent ordering hazard in sidechain wiring (Routing module, observed):
  `addSidechainRoute.ts:51-54` writes `sidechainStore.set(...)` _before_ calling
  `wireSidechainRoute`. If the wire fails, the store holds a phantom route and its
  subscribers — including this node graph when it reflects a `sidechain` edge (AC-014) —
  re-render with a route that has no audio effect. (Today both calls are synchronous and
  `wireSidechainRoute` early-returns on missing strips, so it cannot throw in practice; the
  risk is latent on the contract, not active.)

## Affected areas

- `src/modules/Plugin/useCases/nodeView/` (reconcile, relayout, apply-op-to-track, cycle check)
- `src/modules/Plugin/handlers/` (node-view AppAction handlers)
- `src/modules/Workspace/presentations/views/NodeView/` (React Flow canvas, node, edge)
- `src/modules/Arrangement/` track store subscription + device/send actions (consumer)
- project persistence (`nodeView.trackLayouts` schema + hydration)

## Dropped from sources

- Project-wide graph across tracks — a distinct feature, not this spec.
- Real-DSP `mixer`/`splitter`/`merger` nodes — v1 renders them as visual-only annotations.
- Feedback / cyclic routing — explicitly rejected by the cycle check.
- The session-by-session milestone breakdown (M1–M5) — delivery planning, not spec content.
