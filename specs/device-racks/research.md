---
type: research
id: RESEARCH-device-racks
title: Device containers, macros, and unified modulation
status: open
owner: The Sourdaw team
sources:
  - Ableton Live (Racks/Macros), Bitwig Studio (modulators), FL Studio (Patcher), Reason (rack)
  - CLAP and VST3 modulation specifications; rtrb / ArcSwap / AtomicF32 literature
---

# Research: Device containers, macros, and unified modulation

## Question

How should device racks, macro knobs, and a modulation system be architected so
that a nested authoring model compiles to a real-time-safe engine schedule and
supports glitch-free topology changes and cross-format plugin modulation?

## Findings

### R-001 — Dual representation: nested UI tree, flat audio schedule

- **Claim:** Racks are authored as a nested tree (chains within chains) but must
  compile to the engine's flat `Vec<ProcessTask>` schedule; the two
  representations are kept deliberately separate.
- **Evidence:** Ableton's rack UI vs its internal processing order; cache-local
  flat iteration is required on the audio thread.
- **Confidence:** high
- **Bears on:** tree model (AC-001), flatten (AC-002).

### R-002 — Additive modulation with visual feedback is the superior model

- **Claim:** Bitwig's additive modulation (sources sum onto a base value, each
  shown as a ring around the knob) is clearer and more composable than
  destination-replacement models.
- **Evidence:** Bitwig modulators are widely cited as best-in-class; additive
  summation composes predictably where replacement does not.
- **Confidence:** high
- **Bears on:** additive modulation (AC-005).

### R-003 — A sparse matrix fits real modulation density

- **Claim:** Most parameters have zero or few modulation sources, so storing
  only non-zero connections (sparse) is more efficient than a dense
  source×target matrix.
- **Evidence:** Typical patches connect a handful of modulators; a dense matrix
  wastes memory and iteration.
- **Confidence:** high
- **Bears on:** sparse storage (AC-005).

### R-004 — Control-rate evaluation with interpolation avoids zipper noise

- **Claim:** Evaluating modulation once per control block and linearly
  interpolating to audio rate removes stepping artifacts at acceptable cost.
- **Evidence:** Standard synth practice; per-sample evaluation of every modulator
  is unnecessary and expensive.
- **Confidence:** high
- **Bears on:** control-rate interpolation (AC-006).

### R-005 — Atomic schedule swap enables glitch-free topology changes

- **Claim:** Compile the new rack topology off the audio thread and publish via
  `ArcSwap`; the audio thread adopts it at a buffer boundary. Parameter values
  flow via `AtomicF32` / `rtrb` without locks.
- **Evidence:** `ArcSwap` for pointer swap, `AtomicF32` for scalar params, `rtrb`
  for event queues are the established lock-free trio.
- **Confidence:** high
- **Bears on:** atomic swap (AC-003), live edits (AC-010).

### R-006 — CLAP and VST3 model modulation differently

- **Claim:** CLAP supports polyphonic per-note modulation natively; VST3 has no
  equivalent and must receive modulation as parameter automation, so macro/mod
  behavior degrades on VST3.
- **Evidence:** CLAP note-expression / per-voice modulation spec vs VST3's
  parameter model.
- **Confidence:** high
- **Bears on:** plugin delivery (AC-009) and the blocking parity question.

## Open questions

- [ ] Q-001 — VST3 modulation degradation: monophonic parameter automation as
  the fallback, and how is the loss of per-note modulation surfaced to the user?
- [ ] Q-002 — Macro curve shaping (linear/exponential/custom) — in v1 or later?
- [ ] Q-003 — At what connection count does the sparse matrix need a different
  structure?

## Recommendation

Build on R-001's dual representation: author as a tree, compile to a flat
schedule, swap atomically (R-005). Adopt Bitwig-style additive modulation (R-002)
with sparse storage (R-003) and control-rate interpolation (R-004). Resolve the
CLAP/VST3 parity question (Q-001 / R-006) before the plugin-delivery path is
written, since it changes the user-facing modulation contract.

---

## Restored from source

The sections below were restored verbatim from the original long-form research
report (`research/features/device-racks.md` at commit `bb84b0e`) during the docs
migration. They carry the detailed mechanics, UX-pattern recommendations, and
engineering notes that the condensed findings above summarize. Wording is kept
verbatim where practical.

### Best UX patterns to adopt (item 3, item 4)

UX finding from the survey of Ableton, Bitwig, FL Studio, and Reason: **Live 12
expanded macro knobs from 8 to 16 per Rack**, and 16 macros is the current
industry direction (Reason 12 expanded its Combinator to 32 knobs/faders and 32
buttons). The home spec deliberately chooses 8 macros (AC-004 / R5) for v1; this
research note records that the surveyed state of the art has moved to 16.

The strongest patterns across the industry for a new DAW:

- **Colored arc rings on every modulated knob** (Bitwig's approach) — this is the
  gold standard for at-a-glance modulation visibility. Blue for monophonic, green
  for polyphonic, with animated instantaneous-value indicators.
- **Drag-to-set-depth interaction** — more intuitive than separate Min/Max sliders
  or formula plugins. Drag direction sets polarity; drag distance sets depth.
- **Dedicated mapping mode with parameter highlighting** — both Ableton and Bitwig
  use this. It creates a clear mental model: "I am now assigning connections."
- **Right-click context menu** as a secondary mapping entry point — "Map to Macro
  3" is the most discoverable pathway for new users.
- **Centralized mapping inspector** — a table listing all macro-to-parameter
  connections with editable depth, curve, and inversion per row. Essential when
  one macro controls 5+ parameters.
- **Additive/relative modulation model** (Bitwig) over destructive/absolute
  (Ableton) — preserving base parameter values while modulation adds an offset is
  strictly more flexible.

### Flat compiled schedule: Kahn's algorithm, buffer coloring, feedback, parallelism (item 6)

The dominant approach in production audio engines is the **flat compiled
schedule**: topologically sort the audio graph into a linear array of process
entries whenever topology changes (not per audio callback), then on the audio
thread simply iterate this array.

At compile time, the user-facing tree is walked and **flattened into a single
DAG**. Each Rack creates a Split node (copies input to N branches) and a Mix node
(sums N branches). Nested Racks recursively expand their own Split/Mix pairs. The
resulting flat DAG is topologically sorted via **Kahn's algorithm** (BFS-based),
which naturally identifies parallel groups — all nodes with in-degree 0 at the
same "wave" can execute concurrently on a pre-created real-time thread pool.

Kahn's algorithm is preferred over DFS-based topological sort because it exposes
parallelism levels explicitly, is iterative (no stack overflow risk), and has
built-in cycle detection. The `audio_graph` Rust crate implements exactly this
pattern with typed ports and parallel group detection. Buffer allocation uses
**graph coloring** to minimize the pool size — buffers whose lifetimes don't
overlap share the same slot.

**Feedback loops** require explicit handling: insert a `FeedbackDelay` node that
breaks the cycle by outputting the previous block's data. Since it has no
dependency on the current block's computation, it sorts to the top of the
schedule. Within-node feedback (e.g., a filter's recursive path) is handled
internally at sample rate by each processor — this is how FAUST resolves the `~`
operator.

For **parallel execution within a single audio callback**, Tracktion Graph
demonstrates the pattern: each node has an atomic dependency counter. When a node
completes, it decrements successors' counters; when a counter reaches zero, any
worker thread can claim that node. A minimum block size threshold (~128–256
samples) should gate multi-threaded dispatch, since synchronization overhead
dominates for small blocks. On macOS, use Audio Workgroups to inform the OS that
worker threads share the audio deadline.

Concrete Rust data structures for the compiled schedule:

```rust
type NodeIndex = u32;
type BufferIndex = u16;

struct ScheduleEntry {
    node_index: NodeIndex,
    input_buffers: SmallVec<[BufferIndex; 4]>,
    output_buffers: SmallVec<[BufferIndex; 4]>,
    parallel_group: u16,
}

struct CompiledSchedule {
    entries: Vec<ScheduleEntry>,
    buffer_pool: Vec<Vec<f32>>,  // Pre-allocated, contiguous
    nodes: Vec<Box<dyn AudioProcessor>>,
    parallel_groups: Vec<Vec<NodeIndex>>,
}
```

Key Rust crates for reference: **`audio_graph`** (Kahn's algorithm, typed ports,
parallel groups), **`hexodsp`** (pre-compiled NodeProg uploaded to RT thread via
ring buffer), **`fundsp`** (compile-time graph composition with zero-cost
abstractions), and **`auxide`** (explicit `Plan::compile()` → runtime pattern).

### Audio-rate modulation handling (item 5)

**Processing follows the u-he pattern** (Urs Heckmann, developer of Diva/Zebra):
evaluate the matrix at **control rate** (every 16–64 samples), then linearly
interpolate between ticks at audio rate using pre-computed deltas. This eliminates
zipper noise at minimal CPU cost.

For **audio-rate modulation** (FM synthesis, audio-rate LFOs above ~500 Hz), flag
specific slots as `AUDIO_RATE` and evaluate them per sample in a separate inner
loop, distinct from the control-rate evaluation. Bears on R-004 / AC-006 (control
rate vs audio rate) and the home spec's R8 audio-rate requirement.

### Crossfade for seamless rack-topology transitions (item 1)

For truly seamless transitions — especially when removing effects that have tails
— a **crossfade** between old and new schedules eliminates discontinuities.
Process both schedules for a brief window (**5–10 ms**, ~220–440 samples at
44.1 kHz), linearly blending: `output = old * (1 - t) + new * t`. After the
crossfade completes, release the old schedule. The atomic swap (R-005) happens
first; the crossfade window is processed across the swap boundary so the audio
thread blends old-and-new output rather than hard-cutting. The home spec defers
this to a follow-up (v1 uses a hard swap).

### Delay compensation after topology change (item 2)

**Delay compensation** must be recalculated after every topology change. Walk the
graph from inputs to outputs, summing each node's reported latency (CLAP:
`CLAP_EXT_LATENCY`; VST3: `getLatencySamples()`). At merge points where parallel
paths converge, insert compensation delay buffers on shorter paths:
`compensation[i] = max_path_latency - path_latency[i]`. Both CLAP and VST3 provide
callbacks (`clap_host_latency.changed()` and VST3 restart flags) for plugins to
report latency changes dynamically. The home spec lists automatic delay
compensation across parallel chains as a v1 non-goal (assumes zero-latency
devices), so this is recorded here as the research-backed approach for the
follow-up.
