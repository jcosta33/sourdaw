# Node View — Visual Graph Editor for Device Routing

## Goal

The user toggles Node View (from the View menu or `Cmd+G`). The currently-selected track's device chain appears as a node graph: Input → Device₁ → Device₂ → … → Output, with connection lines between them. The user can drag nodes, drag from an output port to an input port to add a connection (creating a send or a parallel branch), right-click a node to bypass, delete, or inspect parameters. Closing Node View collapses back to the linear insert view. All edits sync both ways: rearranging nodes reorders the linear insert list; bypassing a node in linear view bypasses it in the graph.

## Current state

The data layer is complete, with one caveat: the stored graph is **an independent editable surface** — it is not derived live from track device state, and the audit cannot find any code that applies node-view edits back to the track.

What exists:
- `src/modules/Plugin/stores/nodeView.ts` — `ProcessingNodeType` (10 types: `input | output | effect | instrument | mixer | splitter | merger | send | return | sidechain`), `ProcessingNode` (geometry + bypass + color), `NodeConnection` (from/to with indexed ports), `NodeViewState` (nodes + connections + viewport + `visible`), `NODE_COLORS`.
- `src/modules/Plugin/useCases/nodeView/`:
  - `buildFromDeviceChain` — given a `trackId` + `[{id,name}]`, writes a straight-line graph (Input → devices → Output) into `nodeViewStore`.
  - `addNode`, `removeNode`, `moveNode`, `toggleBypass` — node-level ops.
  - `connectNodes`, `disconnectNodes` — edge-level ops (dedup, no self-loops).
  - `setViewport` — pan / zoom.
  - `toggleNodeView` — flips `visible`.
- `src/modules/Command/models/AppAction.ts:371` — `{ type: 'toggleNodeView'; payload?: undefined }`.
- `miscCommands.ts:213-219` — Command Palette entry `toggle-node-view`.

What is missing:
- No renderer — no React component, no SVG/Canvas, no drag/drop.
- No back-application — editing the graph does not change `Track.devices` ordering, does not add sends, does not change bypass in the Track model. The graph is orphan state.
- No device connection semantics beyond the trivial chain. `Track.sends: Send[]` exists but there is no mapping to `send`/`return` node types in node-view.
- No sync from Track edits to nodeView — adding a device in linear view does not update the graph.
- No handler / UI entry point beyond the single `toggleNodeView` action.

## Design

### Rendering: React Flow

Evaluated options:
- **React Flow** (MIT, ~12 KB gz core + ~30 KB plugins) — purpose-built, handles drag, edge rendering, mini-map, viewport, pan/zoom out of the box. Integrates with our existing state model if we pass node/edge arrays and let its controlled `onNodesChange`/`onEdgesChange` write back to `nodeViewStore`.
- **Custom Canvas renderer** — flexible, but requires implementing viewport math, drag, hit-testing, bezier edges, mini-map. Several weeks of work.
- **SVG + plain React** — doable but drags with many nodes (>50) become laggy without virtualisation.

Decision: **React Flow**. Controlled mode. Our store remains source of truth; React Flow is a view. This matches the existing store-driven architecture.

### Bidirectional sync with track devices

The nodeView store is a **reflection**, not a copy. The rule:

1. `Track.devices` is the source of truth for the primary signal chain (serialised to `ProjectData`).
2. `Track.sends` is the source of truth for routing.
3. `nodeViewStore` is derived when the user **opens** the view for a track (`buildFromDeviceChain` already does this), and is reconciled back on every user edit.

Reconcile on write: every node-view use-case that would change the chain (`connectNodes`, `disconnectNodes`, `moveNode` in some cases, `removeNode`, `toggleBypass`) also dispatches a corresponding `Track` AppAction:

| Node-view op                      | Translates to                              |
|-----------------------------------|--------------------------------------------|
| `moveNode` (reorder)              | `{ type: 'reorderDevice', ... }`           |
| `removeNode` (device node)        | `{ type: 'removeDevice', payload: { trackId, deviceId } }` |
| `toggleBypass` (device)           | `{ type: 'toggleDeviceBypass', ... }`      |
| `connectNodes` with `fromNode.type === 'send'` → `toNode.type === 'return'` (a bus return) | `{ type: 'addSend', ... }` |
| `disconnectNodes` of a send→return edge | `{ type: 'removeSend', ... }` |
| `addNode` (effect) | opens the device browser to pick the concrete type, then `{ type: 'addDevice', ... }` |

Sync from track → nodeView: when a track's devices/sends change while the view is open, the view subscribes to `trackStore` and runs a **preserving reconcile**:
- Nodes keep their `(x, y)` positions if their `deviceId` is unchanged.
- New devices are appended to the right with auto-layout.
- Removed devices' nodes and incident edges are dropped.

### Node types — semantic mapping

| Node type     | Represents                                           | Ports in/out |
|---------------|------------------------------------------------------|--------------|
| `input`       | Track's pre-device input (MIDI or audio)             | 0 / 1        |
| `output`      | Track's post-chain signal before fader               | 1 / 0        |
| `effect`      | A `Device` in `track.devices`                        | 1 / 1        |
| `instrument`  | A `Device` that is a generator (builtin-synth, SFZ)  | 0 / 1        |
| `mixer`       | Sum node                                             | N / 1        |
| `splitter`    | Split into parallel paths                            | 1 / N        |
| `merger`      | Sum of multiple paths                                | N / 1        |
| `send`        | A `Send` on the track                                | 1 / 1        |
| `return`      | A bus track's input (cross-track)                    | 1 / 1        |
| `sidechain`   | External input to a sidechain-aware device           | 0 / 1 (logical) |

### Visual layout

Auto-layout on `buildFromDeviceChain` already does left-to-right single row. For richer graphs with sends/returns, use a simple layered layout: BFS from input, assign column = layer; assign rows within a column to minimise edge crossings (naïve sort by first-input-row).

A "Re-Layout" button in the toolbar re-runs auto-layout.

## API surface

```ts
// Existing use-cases — expose via AppActions
type NodeViewActions =
    | { type: 'toggleNodeView'; payload?: undefined } // EXISTS
    | { type: 'openNodeViewForTrack'; payload: { trackId: string } }
    | { type: 'addNodeManually'; payload: { trackId: string; nodeType: ProcessingNodeType; x: number; y: number } }
    | { type: 'moveNode'; payload: { nodeId: string; x: number; y: number } }
    | { type: 'removeNode'; payload: { nodeId: string } }
    | { type: 'connectNodes'; payload: { fromNodeId: string; fromOutput: number; toNodeId: string; toInput: number } }
    | { type: 'disconnectNodes'; payload: { connectionId: string } }
    | { type: 'toggleNodeBypass'; payload: { nodeId: string } }
    | { type: 'setNodeViewport'; payload: { panX: number; panY: number; zoom: number } }
    | { type: 'relayoutNodeView'; payload?: undefined }; // runs auto-layout

// New use-cases
// src/modules/Plugin/useCases/nodeView/relayoutGraph.ts
export function relayoutGraph(): void;

// src/modules/Plugin/useCases/nodeView/reconcileFromTrack.ts
/** Called when trackStore changes while nodeView is open. Preserves positions. */
export function reconcileFromTrack(trackId: string): void;

// src/modules/Plugin/useCases/nodeView/applyNodeOpToTrack.ts
/**
 * Translate a node-view edit into the corresponding Track/Send AppActions.
 * Called from each of connect/disconnect/move/remove/toggleBypass use-cases.
 */
export function applyNodeOpToTrack(op: NodeOp): void;

// Queries (new)
export function getNodeById(id: string): ProcessingNode | undefined;
export function getConnectionsForNode(id: string): { incoming: NodeConnection[]; outgoing: NodeConnection[] };
```

## UI / UX

- **Entry point** — View menu → "Node View" (or `Cmd+G`). Opens an overlay replacing the track's linear insert row for the selected track.
- **Canvas** — React Flow `<ReactFlow>` filling the content area of the current inspector panel. Source of nodes: `nodeViewStore.nodes` mapped to React Flow's node shape.
- **Toolbar** (top-right of canvas) — `Re-Layout`, `Zoom In/Out/Fit`, `Close`.
- **Node chrome** — rounded rect, colour from `NODE_COLORS[type]`, label centered, input ports on the left, output ports on the right, bypass indicator (small stripe) when bypassed.
- **Interactions**:
  - Drag a node → updates `(x, y)` via `moveNode`.
  - Drag from an output port to an input port → creates a connection. If valid, dispatches `connectNodes` (→ `applyNodeOpToTrack` if crossing `send`/`return`).
  - Right-click a node → context menu: Bypass, Delete, Rename, "Open Parameter Panel" (for effects/instruments).
  - Right-click canvas → context menu: "Add Effect…" (opens device browser), "Add Send", "Re-Layout".
  - Shift-click an edge to delete.
- **Mini-map** — React Flow built-in, bottom-right.
- **Graph error states** — invalid cycles, disconnected nodes, send to non-existent return are surfaced with a red outline and a toast.

## Data model / persistence

Two approaches were considered:

**A. Persist the graph.** Save `NodeViewState` (minus `visible`) in `ProjectData`. Pros: user's node positions persist across sessions. Cons: two sources of truth diverging on schema changes.

**B. Persist only node positions.** Save `Record<deviceId, { x: number; y: number }>`; rebuild the topology from `Track.devices`/`Track.sends` on open. Pros: one source of truth for topology. Cons: loses arbitrary user additions (e.g. a merger node not backed by a real device).

Decision: **B, with an extension field for non-device nodes.**

```ts
type ProjectData = {
    // ...
    nodeView?: {
        trackLayouts: Record<string /* trackId */, {
            nodePositions: Record<string /* nodeId | deviceId */, { x: number; y: number }>;
            viewport: { panX: number; panY: number; zoom: number };
            /** Nodes not backed by a Device — user-added mixers, splitters, mergers */
            extraNodes: ProcessingNode[];
            /** Edges specifically created in the graph (sends are not here — those live in Track.sends) */
            extraEdges: NodeConnection[];
        }>;
    };
};
```

Hydration: load layouts; topology is rebuilt on `openNodeViewForTrack`. Migration: new optional field.

## Integration points

- `src/modules/Plugin/useCases/nodeView/` — the 9 existing use-cases stay; add `relayoutGraph`, `reconcileFromTrack`, `applyNodeOpToTrack`.
- `src/modules/Plugin/handlers/` — new directory with 10 handlers (9 existing actions + new ones). Wire through `getPluginHostHandlers.ts`.
- `src/modules/Arrangement/useCases/track/` — consume `reorderDevice`, `removeDevice`, `toggleDeviceBypass`, `addSend`, `removeSend` — these already exist (inspect to confirm). No new AppActions for these if they are already wired.
- `src/modules/Workspace/presentations/views/NodeView/NodeViewCanvas.tsx` — NEW. React Flow container.
- `src/modules/Workspace/presentations/views/NodeView/NodeComponent.tsx` — NEW. Custom React Flow node with port chrome.
- `src/modules/Workspace/presentations/views/NodeView/EdgeComponent.tsx` — NEW. Styled edge with delete-on-click.
- `src/modules/Arrangement/stores/trackStore.ts` — subscribe hook: when a track's devices/sends change AND nodeView is open for that track, call `reconcileFromTrack`.
- `src/modules/Project/useCases/projectPersistence/helpers/hydrateModuleStoresFromProjectData.ts` — extend for `nodeView.trackLayouts`.
- `package.json` — add `reactflow@^11`.

## Risks / open questions

- **React Flow size** — core + bezier edges + mini-map lands around 60 KB gz. Acceptable for a feature behind a toggle. Lazy-load the module via dynamic `import()` when first opened.
- **Bidirectional sync races** — user drags an edge in node-view, simultaneous CRDT patch from a peer adds a device. Reconcile must be deterministic. Decision: `reconcileFromTrack` always re-derives the topology; user-only edits (extraNodes/extraEdges) overlay on top. No merge conflict.
- **Custom node types in the graph** — the `mixer`, `splitter`, `merger` nodes don't map to any existing track primitive. For v1, they are **visual-only** annotations; they don't change DSP routing. The graph will render them but warn "Purely visual — no audio effect." A v2 could promote them into real Web Audio nodes.
- **Loops** — the existing `connectNodes` prevents self-loops but not longer cycles. For v1, reject any connection that would create a cycle via a simple DFS check in `connectNodes`. Feedback routing in audio graphs is inherently risky and scoped out of v1.
- **Per-track vs. project-wide graph** — decision is per-track (matches the audit's "within a track"). A project-wide graph across tracks is a different feature.
- **Performance** — a track with 12 devices + 4 sends is ~20 nodes + 20 edges, trivial for React Flow. A project-wide view would be thousands of nodes; not a concern for v1.
- **Undo** — each node-view op already flows through `executeAppAction`, so undo is inherited. Moving a node without a corresponding track change (just position) is **not** in the undo stack — position is UI-only. The spec explicitly excludes position changes from undo.
- **Open question**: the store currently has `activeTrackId` — how does it update when the user changes track selection in the tracklist? Hook into the existing selection store and call `openNodeViewForTrack(selectedTrackId)` when `visible === true`.

## Milestones

### M1 — Use-case completion (one session)
- `relayoutGraph`, `reconcileFromTrack`, `applyNodeOpToTrack` use-cases.
- Cycle detection in `connectNodes`.
- 9 AppActions + handlers in `Plugin/handlers/`.
- Unit tests covering each.

### M2 — Renderer with React Flow (one session)
- `NodeViewCanvas`, `NodeComponent`, `EdgeComponent`.
- Lazy-load `reactflow`.
- Initial read-only view: open for selected track, show nodes + edges from store.
- Viewport persistence (pan/zoom writes to store).

### M3 — Interactive edits (one session)
- Drag node → dispatch `moveNode`.
- Drag port-to-port → dispatch `connectNodes`.
- Right-click menus: bypass, delete, add effect (opens device browser).
- Edge deletion.
- Round-trip test: a drag in the graph reorders `Track.devices`.

### M4 — Track ↔ Graph reconcile (one session)
- Subscribe `trackStore`, run `reconcileFromTrack` with position preservation.
- `applyNodeOpToTrack` translator covering all 7 op kinds.
- Tests: adding a device in linear view shows up in graph; deleting in graph removes from linear.

### M5 — Persistence + sends (one session)
- `ProjectData.nodeView.trackLayouts` schema + hydration + serialisation.
- Send/return node pairs driven by `Track.sends` and bus tracks.
- Tests: save/load with 2 tracks, one with a send, graph reloads at correct positions.

## Tests

- **Use-case unit** — each of 9 existing ops has tests; add tests for `relayoutGraph`, `reconcileFromTrack`, `applyNodeOpToTrack`, cycle rejection.
- **Reconcile preservation** — open view for track with 3 devices, move one node, add a 4th device via linear view; assert reconcile preserves the 3 moved positions and appends the 4th to the right.
- **Reconcile pruning** — remove a device in linear view; assert its node and all incident edges are dropped from nodeView.
- **Translation to Track ops** — each of the 7 op kinds produces the expected `AppAction` (mocked dispatcher).
- **Cycle rejection** — connecting a back-edge returns a typed error and does not mutate the store.
- **Persistence** — save nodeView with custom positions + an extra mixer node + a viewport; reload; assert full equivalence.
- **Integration** — open node-view for a track, connect send node to return node, assert `Track.sends` gains a corresponding `Send` entry.
- **Performance** — with 50 nodes, initial render < 100 ms on a CI runner; drag at 60 fps (snapshot timing).
- **E2E (Playwright)** — toggle node view, drag a node to reorder devices, close, assert the linear view reflects the new order.
