# Grinder Modular Rig Graph

## Context

The current Grinder implementation is still a fixed signal chain rather than a Guitar Rig style modular environment.

Grounding from the current codebase:

- `crates/daw-dsp/src/grinder/engine.rs` hardcodes the signal flow as input -> gate -> fixed pre-pedal slots -> preamp/tone stack/power amp/transformer -> cabinet/speaker -> fixed post-pedal slots -> output.
- `src/modules/Grinder/models/GrinderPatch.ts` exposes `prePedals`, `postPedals`, `routingMode`, `neuralPlacement`, and other fields that imply richer routing, but the runtime only supports a small fixed set of slot-mapped pedals.
- `src/modules/Grinder/useCases/grinderParamBridge/loadGrinderPatchWithAudio.ts` and `src/modules/AudioEngine/services/grinderProcessor.ts` translate the current patch into a static parameter map such as `preOverdriveDrive`, `postFuzzLevel`, `mic1Distance`, etc. There is no dynamic block graph or arbitrary module ordering.
- The Grinder audit at `.agents/audits/grinder/control-deck.md` now explicitly calls out the absence of real routing behavior and the gap between the patch/UI contract and the actual DSP path.
- The repo already has two relevant patterns this feature should reuse:
  - Vanilla `Store<T>` state per module/instance.
  - Progressive disclosure via `uiLevel` / Play-Shape-Build-Route-Lab style panel organization in Fermenter, Proof, Gluten, Crust, and Dutch Oven.

This spec defines how Grinder evolves from a fixed amp chain into a modular rig environment with Guitar Rig level control over ordering, parallel routing, amp/cab placement, macros, and snapshots, while keeping the audio thread real-time safe.

## Goal

Grinder becomes a true modular guitar rig. Users can build, reorder, split, merge, snapshot, and macro-control rigs made of pedals, amps, cabinets, captures, and utility blocks instead of being restricted to hardcoded pre/post slots.

## User-visible behavior

The user opens Grinder and sees a real rig editor rather than a fixed pedal strip. They can drag blocks into the rig, reorder them, create parallel lanes, run dual amps, place cabinets and neural captures intentionally, save named snapshots, and map multiple parameters to macros. The rig remains stable while editing, and old Grinder patches still load as equivalent starter rigs.

At a minimum, the user can:

- Add and remove rig blocks from a browser of Grinder-native modules.
- Drag blocks earlier or later in the chain.
- Split one path into parallel lanes and merge it again.
- Run two amp/cab branches in parallel and blend them.
- Bypass, solo, duplicate, and rename blocks.
- Save rigs as presets and store multiple snapshots inside a rig.
- Control multiple assigned parameters from a small set of macros.
- See CPU/latency feedback and understand which blocks are active.

## Scope

### In scope

- Replace Grinder's fixed slot model with a versioned rig-graph patch model.
- Migrate existing Grinder presets and saved patches into graph-based rigs.
- Add a modular Grinder editor UI with block browser, lane canvas, and block inspector.
- Support drag-to-reorder, duplicate, delete, bypass, and solo for rig blocks.
- Support split and merge routing primitives for parallel paths.
- Support dual-amp and dual-cab rigs through the graph model rather than decorative `routingMode` metadata.
- Add macro controls and rig snapshots/scenes at the Grinder patch level.
- Compile the editable graph into a real-time-safe DSP execution plan.
- Replace the fixed `preOverdriveDrive` style bridge path with graph-aware synchronization.
- Preserve the current progressive disclosure pattern by fitting the rig editor into Play / Shape / Build / Route / Lab.

### Non-goals

- Hosting arbitrary third-party plugins inside Grinder.
- Shipping a generic patch-cable environment for the whole DAW.
- Supporting feedback loops or arbitrary cyclic graphs in v1.
- Shipping every effect category Guitar Rig has ever offered.
- Reworking other plugin modules to use the Grinder graph model.
- Solving the broader remaining high-gain voicing work outside the graph/control architecture.
- Any destructive rename/move of existing Grinder files unless a later implementation spec explicitly calls for it.

## Requirements

1. **Graph-based patch contract**
   Grinder must store its rig as a versioned graph model rather than only `prePedals` and `postPedals`.

2. **Backward-compatible migration**
   Every existing Grinder patch and factory preset must migrate to a graph-based rig automatically and preserve equivalent audible ordering.

3. **Modular rig blocks**
   The graph must support at least these block families in v1:
   - `input`
   - `gate`
   - `compressor`
   - `overdrive`
   - `distortion`
   - `fuzz`
   - `eq`
   - `amp`
   - `cab`
   - `ir-loader`
   - `neural-capture`
   - `gain`
   - `split`
   - `merge`
   - `output`

4. **Deterministic routing model**
   The graph must be a directed acyclic graph with one input root and one output root. Arbitrary cycles are forbidden in v1.

5. **Parallel lanes**
   Users must be able to create at least one split into two parallel lanes, place different blocks in each lane, and merge them back together with per-lane level/pan controls.

6. **Dual-amp rigs**
   Users must be able to run two independent amp/cab or amp/capture branches in parallel and blend them before output.

7. **Block operations**
   The UI must support create, reorder, duplicate, delete, bypass, solo, rename, and move-between-lanes operations for blocks.

8. **Macros**
   A rig must expose 8 user-assignable macros. Each macro can target multiple block parameters with independent min/max ranges and polarity.

9. **Snapshots**
   A rig must support at least 8 named snapshots/scenes. A snapshot stores block bypass states, macro values, and selected parameter overrides without duplicating the full rig graph.

10. **Real-time-safe graph compilation**
    Editable graph state must not be traversed directly on the audio thread. It must be compiled on a non-RT path into a deterministic execution plan that is atomically swapped into the DSP engine.

11. **Graph-aware bridge**
    The current fixed param bridge must be replaced or extended with a graph-aware load/update path. Dynamic block identity and ordering must reach the DSP engine without relying on hardcoded `preX` / `postX` parameter names.

12. **Progressive disclosure**
    Grinder's UI must retain the repo's progressive disclosure model:
    - `Play`: rig preset, master macros, snapshot switching, high-level meters.
    - `Shape`: selected block quick controls and main amp voice controls.
    - `Build`: full chain editing, add/remove/reorder blocks.
    - `Route`: split/merge editing, lane balance, dual-amp layout, cab/capture placement.
    - `Lab`: advanced per-block parameters, diagnostics, graph inspection, CPU/latency details.

13. **Honest UI contract**
    Every visible routing control in Grinder must correspond to real graph/DSP behavior. Decorative routing metadata is not allowed once this ships.

14. **Architecture compliance**
    The implementation must remain inside established module boundaries and pass `pnpm deps:validate` with zero new violations.

## Constraints

- Keep the work inside the `Grinder` module unless a truly shared primitive is demonstrably reused by another module.
- Reuse Vanilla stores and existing store/use-case patterns; do not introduce Zustand, Redux, or ad-hoc component-local graph truth.
- Do not traverse or mutate the editable graph on the audio thread.
- Do not use mutexes, blocking waits, or heap allocation on the audio thread for graph swap or graph execution.
- The browser/worklet path and the Tauri/native path must use the same logical graph contract even if transport differs.
- Preserve existing Grinder presets and user projects via migration.
- Prefer existing native drag/pointer interaction patterns already used in the repo over introducing a new drag/drop framework unless implementation proves that existing patterns cannot support the rig editor cleanly.

## Design decisions

### Decision: replace fixed pre/post arrays with a versioned rig graph

**Chosen:** introduce a versioned `rigGraph` as the authoritative patch representation and treat old `prePedals` / `postPedals` as migration input only.

**Why:** the current slot model fundamentally cannot express Guitar Rig style reordering, splits, dual amps, or block-local identities.

**Rejected:**

- Extending the existing `prePedals` / `postPedals` arrays with more slot types.
  Rejected because it still hardcodes topology and keeps routing as special cases instead of first-class data.
- Keeping both fixed slots and graph as equal runtime truths.
  Rejected because dual truth would guarantee desync bugs and a permanent maintenance burden.

### Decision: DAG, not arbitrary patch cables

**Chosen:** v1 supports a directed acyclic graph with explicit `split` and `merge` nodes.

**Why:** this captures the routing depth most guitar users actually need while remaining compilable into a stable RT-safe plan.

**Rejected:**

- Fully arbitrary cable graph with cycles/feedback.
  Rejected because it is harder to validate, harder to make RT-safe, and much broader than the current product need.

### Decision: compile graph edits off the audio thread

**Chosen:** UI/store state produces an editable graph; a use case validates and compiles it into a `CompiledRigPlan` that the DSP engine swaps atomically.

**Why:** the current engine is already oriented around deterministic stage execution, and RT safety requires avoiding dynamic graph traversal on the audio thread.

**Rejected:**

- Traversing the live graph object per sample/block.
  Rejected for RT safety and performance reasons.

### Decision: keep the rig environment Grinder-native in v1

**Chosen:** v1 modular blocks are Grinder-native blocks only, plus an extension seam for future first-party rack effects.

**Why:** this delivers Guitar Rig level routing/control without coupling Grinder v1 to the entire plugin-host surface.

**Rejected:**

- Embedding arbitrary first-party or third-party plugins inside Grinder from day one.
  Rejected because it turns the feature into a plugin-host architecture project rather than a Grinder routing project.

### Decision: reuse current progressive disclosure instead of inventing a second editor mode system

**Chosen:** the modular rig editor fits into Play / Shape / Build / Route / Lab.

**Why:** the repo already uses this pattern and users should not have to learn a second disclosure language just for Grinder.

## Acceptance criteria

- [ ] A new Grinder spec-grounded graph model exists in the Grinder module, with versioning and explicit node/edge identities.
- [ ] A migration test proves current factory presets and legacy saved Grinder patches load into graph-based rigs without losing equivalent block order or enabled states.
- [ ] The rig editor can create, reorder, duplicate, bypass, solo, rename, and delete blocks through dedicated Grinder use cases.
- [ ] The rig editor can create one split into two lanes and merge those lanes back to output.
- [ ] A dual-amp rig preset exists and audibly differs from a single-amp equivalent because both branches are active in the compiled plan.
- [ ] A macro-assignment test proves one macro can drive at least two parameters on different blocks with independent ranges.
- [ ] A snapshot test proves switching snapshots changes bypass/macro/override state without mutating the underlying rig graph structure.
- [ ] A validation test rejects cyclic graphs and graphs missing input/output roots.
- [ ] A compiled-plan test proves the audio thread consumes a stable compiled plan rather than traversing editable graph objects directly.
- [ ] A DSP/bridge test proves block order changes alter the rendered signal path.
- [ ] Grinder Play / Shape / Build / Route / Lab fixture tests cover the new modular editor visibility contract.
- [ ] `pnpm deps:validate` passes with zero violations.

## Implementation notes

### Patch model

The current `GrinderPatch` should evolve toward:

- `rigGraphVersion`
- `rigBlocks`
- `rigConnections`
- `rigLayout`
- `macros`
- `snapshots`
- legacy migration input fields marked as deprecated or removed after migration

Suggested block shape:

```ts
type GrinderRigBlockKind =
    | 'input'
    | 'gate'
    | 'compressor'
    | 'overdrive'
    | 'distortion'
    | 'fuzz'
    | 'eq'
    | 'amp'
    | 'cab'
    | 'ir-loader'
    | 'neural-capture'
    | 'gain'
    | 'split'
    | 'merge'
    | 'output';

type GrinderRigBlock = {
    id: string;
    kind: GrinderRigBlockKind;
    label: string;
    enabled: boolean;
    params: Record<string, number | boolean | string>;
};

type GrinderRigConnection = {
    id: string;
    from_block_id: string;
    from_port: string;
    to_block_id: string;
    to_port: string;
};
```

The exact field names can change in implementation, but block and connection identity must be explicit and durable.

### Migration

Migration must map the current fixed topology into a starter graph:

- `input`
- optional `gate`
- migrated pre blocks in their current order
- `amp`
- `cab` and/or `neural-capture` according to current patch behavior
- migrated post blocks in their current order
- `output`

The existing `routingMode` field should not survive as decorative metadata. Its behaviors should either become real graph presets or be removed.

### Store and use cases

Keep graph truth in Grinder stores/use cases, not in component-local state. Expected use-case surface includes functions equivalent to:

- `addGrinderRigBlock`
- `removeGrinderRigBlock`
- `moveGrinderRigBlock`
- `duplicateGrinderRigBlock`
- `toggleGrinderRigBlockBypass`
- `soloGrinderRigBlock`
- `connectGrinderRigBlocks`
- `disconnectGrinderRigBlocks`
- `setGrinderMacroAssignment`
- `setGrinderSnapshot`
- `compileGrinderRigGraph`

Names can change, but one behavior per file still applies.

### Bridge and engine

The fixed param map in `grinderProcessor.ts` and `loadGrinderPatchWithAudio.ts` is not sufficient for this feature. The implementation should move toward:

- a serialized graph payload from TS to the worklet / native bridge
- validation and compilation on a non-RT side
- atomic publication of a compiled execution plan to the DSP engine

The compiled plan should flatten execution into a stable ordered structure, for example:

- node list
- lane mix operations
- split/merge operations
- per-node parameter payloads

This keeps RT execution deterministic and avoids per-block dynamic dispatch through editable JS objects.

### UI layout

Recommended Grinder layout:

- Left rail: block browser grouped by `Utilities`, `Dynamics`, `Drive`, `Amp`, `Cab`, `Capture`, `Routing`.
- Center canvas: chain/lane view with drag reorder and split/merge visualization.
- Right inspector: selected block controls, macro assignments, block meters.
- Top strip: preset selector, snapshot selector, macro knobs, CPU/latency indicator.

### Existing pattern reuse

- Reuse Vanilla store patterns from `src/infra/store/`.
- Reuse current progressive disclosure patterns already present in Grinder/Fermenter/Proof rather than inventing a second mode system.
- Reuse existing app drag/pointer list interactions where practical before introducing a new dependency.

## Test plan

- [ ] Add Grinder patch migration tests under `src/modules/Grinder/models/__tests__/`.
- [ ] Add Grinder store/use-case tests for block add/remove/reorder/connect/disconnect/macro/snapshot operations.
- [ ] Add Grinder panel tests for Play / Shape / Build / Route / Lab visibility and key interactions.
- [ ] Add bridge tests for graph serialization and graph-to-audio update flow.
- [ ] Add DSP/engine tests for compiled graph ordering, split/merge behavior, dual-amp behavior, and cycle rejection.
- [ ] Run targeted Grinder Vitest suites.
- [ ] Run targeted Grinder DSP/Rust tests.
- [ ] Run `pnpm deps:validate`.

## Open questions

- [ ] **[MINOR]** Should v1 macros expose only knob-style controls, or also footswitch-style boolean assignments for live rig toggles?
- [ ] **[MINOR]** Should snapshots support smooth morphing between values in v1, or only instant recall?
- [ ] **[MINOR]** Should the first implementation cap rigs at a fixed complexity budget such as 32 blocks / 2 split regions / 2 amp branches?
- [ ] **[MINOR]** Do we want an FX-loop/send-return block in v1, or is split/merge enough for the first modular release?

## Tradeoffs and risks

- Moving Grinder to a graph model is the right architecture for Guitar Rig level control, but it is materially more complex than adding a few more fixed slots.
- Migration quality matters. If old Grinder patches do not land in equivalent starter rigs, users will lose trust immediately.
- A graph editor without tight validation will create impossible or confusing states; validation must be a first-class part of the model, not a UI afterthought.
- Keeping the first implementation Grinder-native limits breadth, but it keeps scope defensible and avoids collapsing into a generic plugin-hosting project.
- This feature will surface the remaining Grinder DSP quality issues more clearly because users will be able to build much more revealing high-gain and parallel rigs.
