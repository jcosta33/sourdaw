# Local-First Deterministic LLM-Driven DAW Editing — AI Implementation Guide

## Purpose

This guide defines a deterministic, local-first orchestration framework for **LLM-assisted Digital Audio Workstation editing**.

It is designed for two execution targets:

- **browser-native** operation using **WebLLM**
- **native desktop** operation using **mistral.rs**

The orchestration layer is backed by a **Rust validation and application engine** that is responsible for:

- canonical project-state normalization
- deterministic patch generation and application
- semantic validation
- undo/redo integrity
- lock-free handoff into the audio engine
- low-latency streaming UX

The core design principle is:

> The LLM is a constrained planner, not the final authority over project state.

---

# 1. System Goals

The system must:

1. run locally, without requiring cloud execution
2. preserve project structural integrity under all conditions
3. guarantee syntactically valid machine outputs
4. reject semantically invalid edits before they touch the engine
5. support low-latency streaming feedback
6. remain safe under concurrent user edits
7. provide preview-before-commit UX for high-impact changes
8. integrate with real-time audio constraints without locks or allocations on the audio thread

---

# 2. High-Level Architecture

The system should be decomposed into five layers:

1. **Project State Layer**
2. **LLM Planning Layer**
3. **Structured Output / Streaming Layer**
4. **Rust Validation + Patch Compiler Layer**
5. **Runtime Application Layer**

```text
User Intent
   ↓
State Selection / Prompt Assembly
   ↓
Local LLM (WebLLM or mistral.rs)
   ↓
Structured DSO Output
   ↓
Incremental Parser
   ↓
Rust DSO Compiler → RFC 6902 Patch + Inverse Patch
   ↓
Semantic Validation
   ↓
Preview / Ghost Overlay
   ↓
Commit
   ↓
Engine Snapshot Update
```

---

# 3. Project State Representation

## 3.1 Core Problem

Native DAW project formats are usually:

- deeply nested
- verbose
- array-heavy
- sensitive to positional drift
- expensive in tokens

This makes them poor direct prompt targets for 7B–8B local models.

## 3.2 Required Strategy

Represent the editable DAW state as a **normalized, token-efficient logical state** rather than raw XML or raw engine internals.

The LLM should receive:

- stable IDs
- flattened entity maps
- human-readable semantic summaries
- only the detail needed for the requested edit

It should not receive the entire full-fidelity session unless explicitly required.

---

# 4. EASE Encoding

## 4.1 Definition

Use **Explicitly Addressed Sequence Encoding (EASE)** for all sequence-like collections that the model may edit.

Instead of positional arrays, encode ordered collections as:

- stable key-value dictionaries
- explicit display order lists

### Bad

```json
{
    "tracks": [
        { "id": "t1", "name": "Vocals" },
        { "id": "t2", "name": "Drums" }
    ]
}
```

### Good

```json
{
    "tracks": {
        "ax": { "name": "Vocals" },
        "by": { "name": "Drums" }
    },
    "track_order": ["ax", "by"]
}
```

## 4.2 Why

Array-based state causes **index drift**:

- deleting item 0 shifts every later index
- small local models are weak at sequential re-indexing
- multi-step edits often target the wrong entity after intermediate changes

EASE eliminates this by decoupling:

- **identity** from **position**
- **storage** from **display order**

## 4.3 Requirements

Use EASE for:

- tracks
- clips
- lanes
- sends
- device chains
- mixer channels
- markers
- scene-like entities
- automation lane registries

---

# 5. Project Normalization and Topology

## 5.1 Flattening Rules

Flatten the project into relational collections.

Suggested top-level maps:

- `tracks`
- `clips`
- `devices`
- `channels`
- `routes`
- `groups`
- `markers`
- `tempo_map`
- `arrangement`
- `automation_headers`

Each entity should store only IDs to related entities.

### Example

```json
{
    "tracks": {
        "ax": {
            "name": "Vocals",
            "channel_id": "ch01",
            "clip_ids": ["cp11", "cp12"],
            "device_chain_id": "dc88"
        }
    }
}
```

## 5.2 Full-Fidelity vs Logical State

Maintain two views:

### Logical State

Compact, prompt-oriented, human-readable summary of:

- track names
- clip ranges
- routing graph
- device chain names
- selected plugin parameters
- high-level automation summaries

### Physical State

Full engine state including:

- MIDI notes
- automation points
- waveforms
- envelopes
- plugin state blobs
- editor UI state

The LLM should consume the **Logical State** by default.

---

# 6. Selective State Injection

## 6.1 Principle

Never put the full project into every prompt.

Use **Selective State Injection** to reduce:

- attention dilution
- token waste
- “lost in the middle” errors
- accidental edits on irrelevant data

## 6.2 Default Global Context

Include only:

- project metadata
- selected region summary
- currently visible tracks
- selected entities
- relevant routing
- active constraints
- recent user edits if needed for continuity

## 6.3 On-Demand Detail Expansion

Inject full detail only when the task explicitly needs it.

Examples:

### Request:

“Transpose these selected MIDI notes up a minor third.”

Inject:

- selected clip note list
- note timing
- note pitches
- quantization context

Do **not** inject:

- entire session routing graph
- unrelated tracks
- every automation lane

---

# 7. Edit Representation: Hybrid DSO-Patch Model

## 7.1 Core Rule

The LLM must not directly author arbitrary engine mutations.

Instead:

1. the LLM emits **Domain-Specific Operations (DSOs)**
2. Rust compiles DSOs into **atomic RFC 6902 JSON Patches**
3. Rust validates and applies those patches

## 7.2 Why

Raw JSON Pointer generation is high-entropy and brittle.

DSOs reduce model burden by letting the model express intent like:

- `duplicate_clip`
- `move_clip`
- `transpose_notes`
- `split_clip`
- `set_track_volume`
- `create_send`
- `mute_track`
- `insert_device`
- `colorize_region`
- `humanize_midi`
- `ripple_delete_range`

Instead of forcing the model to hallucinate low-level pointer paths.

## 7.3 Example DSO

```json
{
    "op": "duplicate_clip",
    "clip_id": "cp11",
    "destination_track_id": "by",
    "destination_start_beats": 64.0
}
```

---

# 8. DSO Compiler

## 8.1 Responsibilities

The Rust compiler layer must:

- parse structured DSO output
- resolve IDs to canonical state
- expand one DSO into one or more atomic edits
- generate forward patch
- generate inverse patch
- attach precondition checks
- emit preview artifacts
- hand validated patch bundles to the application layer

## 8.2 Patch Bundle Structure

```rust
pub struct PatchBundle {
    pub tests: Vec<JsonPatchOp>,
    pub patch: Vec<JsonPatchOp>,
    pub inverse_patch: Vec<JsonPatchOp>,
    pub affected_entities: Vec<EntityId>,
    pub preview: PreviewPlan,
}
```

---

# 9. RFC 6902 Patch Discipline

## 9.1 Patch Ordering

Every patch bundle must begin with `test` operations before any mutation.

This implements optimistic concurrency control.

### Example

```json
[
    { "op": "test", "path": "/tracks/ax/name", "value": "Vocals" },
    { "op": "replace", "path": "/tracks/ax/name", "value": "Lead Vox" }
]
```

## 9.2 Why

If the user changes state while the model is generating:

- the patch should fail safely
- the system should not apply stale assumptions
- the DSO should be rebased or regenerated

---

# 10. Inverse Patches and Undo

## 10.1 Requirement

Every accepted edit must produce a reversible inverse.

Undo must be:

- exact
- deterministic
- independent of re-running the model

## 10.2 Strategy

Generate inverse patches by comparing:

- pre-edit canonical state
- post-compiled canonical state

Or by mechanically inverting each patch op when safe.

### Inversion rules

- `replace` → `replace` with prior value
- `add` → `remove`
- `remove` → `add` with removed value
- `move` / `copy` → explicit inverse patch sequence, not assumed shorthand

## 10.3 History Model

Store:

- original DSO
- compiled patch
- inverse patch
- validation report
- affected entity list
- timestamp
- user approval state

---

# 11. Structured Output Control

## 11.1 Goal

LLM output must be syntactically constrained during decoding, not cleaned up afterward.

## 11.2 Browser Path

Use **WebLLM** with structured decoding support.

Recommended output modes:

- JSON schema constrained output
- grammar-constrained output
- fixed DSO schema families

## 11.3 Native Path

Use **mistral.rs** with:

- schema-constrained structured output
- grammar-constrained decoding where needed

## 11.4 Rule

The model should emit one of:

- a typed DSO list
- a typed planning object
- a typed moderation / refusal object
- a typed diagnostic object

Never raw freeform “maybe-JSON”.

---

# 12. Grammar-Constrained Decoding

## 12.1 Logit Masking

At each decoding step, the runtime must restrict candidate tokens to those valid under the current grammar/schema state.

Conceptually:

$$
T_{next} = \arg\max_{t \in V}\left\{P(t \mid \text{context}) \cdot \mathbb{I}(t \text{ valid under grammar})\right\}
$$

Invalid tokens are masked out.

## 12.2 Practical Implication

This guarantees:

- structural validity
- key spelling correctness where schema constrains keys
- enum adherence
- object shape compliance within supported grammar features

It does **not** guarantee:

- semantic correctness
- musical correctness
- safe routing
- non-overlapping timeline edits
- plugin parameter legality beyond the schema’s expressiveness

Those remain Rust-layer responsibilities.

---

# 13. Schema Design Rules for Structured Output

## 13.1 Keep Schemas Simple

Prefer:

- flat objects
- enums
- discriminated unions
- bounded arrays
- explicit required fields

Avoid pushing too much logic into grammar/schema constraints.

## 13.2 Do Not Rely on Grammar for Everything

Treat these as **backend validation duties**, not grammar duties:

- uniqueness across a collection
- route acyclicity
- timeline non-overlap
- floating-point safety
- engine-specific plugin constraints
- musical-theory invariants

## 13.3 Recommended Output Envelope

```json
{
  "kind": "edit_plan",
  "intent": "duplicate chorus vocal clip to second chorus",
  "dsos": [ ... ],
  "moderation": "allow"
}
```

---

# 14. Streaming Output and Incremental Parsing

## 14.1 Requirement

The UI must react to structured output while it is still being generated.

A naive “buffer all text then `JSON.parse`” path is unacceptable for large structured outputs.

## 14.2 Incremental Parser Requirement

Use a stateful incremental JSON parser such as:

- `jsonmodem` on Rust-side streaming paths
- a partial/incremental JSON parser in browser-side UI if direct browser parsing is needed

The parser must:

- maintain nesting state across chunks
- surface partial field completion
- avoid repeated full-document reparsing
- support early abort on moderation or invalid sentinel states

## 14.3 Streaming Events

The parser should emit events like:

- object start
- key seen
- scalar updated
- array item appended
- field completed
- document completed

This enables:

- progressive UI rendering
- partial plan previews
- early validation hooks
- moderation interrupts

---

# 15. Moderation and Early Abort Hooks

## 15.1 Sentinel Fields

Reserve fields such as:

```json
{
  "moderation": "allow" | "block" | "needs_confirmation"
}
```

These should appear early in the schema whenever possible.

## 15.2 Behavior

If the streaming parser sees:

- `"block"`
- destructive action without approval
- unsupported tool family
- high-risk batch delete request

then inference can be aborted before the rest of the structure completes.

---

# 16. Semantic Rebase and Concurrency

## 16.1 Problem

The user can keep editing while the model is thinking.

## 16.2 Rule

Every model-produced edit must target a specific base revision.

```rust
pub struct EditRequest {
    pub base_revision: u64,
    pub selected_state_hash: u128,
    pub intent: String,
}
```

## 16.3 If Base Revision Mismatches

On `test` failure:

1. reject patch application
2. preserve the DSO plan
3. fetch updated canonical state
4. re-run compilation or regeneration
5. present rebased preview

This is **semantic rebase**, not silent corruption.

---

# 17. Rust Validation Layer

## 17.1 Principle

The Rust backend is the final arbiter of validity.

It must enforce:

- engine invariants
- musical invariants
- routing invariants
- temporal invariants
- parameter range safety
- undo integrity

## 17.2 Parse, Don’t Validate

Deserialize structured output into strongly-typed Rust types.

Prefer making illegal states unrepresentable.

Example:

```rust
#[derive(Deserialize)]
pub struct SetTrackVolume {
    pub track_id: StableId,
    #[garde(range(min = -120.0, max = 12.0))]
    pub volume_db: f32,
}
```

Use:

- `serde`
- `schemars`
- `garde` or equivalent declarative validation
- domain types for beats, bars, normalized gain, etc.

---

# 18. Timeline Integrity

## 18.1 Requirement

Clip operations must not silently create illegal overlaps where the DAW model forbids them.

## 18.2 Data Structure

Use interval trees or interval-overlap indices for timeline checks.

Suitable pattern:

- per-track interval index
- query proposed clip range
- collect collisions
- either reject or auto-resolve based on operation contract

## 18.3 Validation Behaviors

Depending on track semantics:

- reject overlap
- trim earlier clip
- trim later clip
- auto-ripple
- create lane split
- require user confirmation

This policy must be explicit per track or per editing mode.

---

# 19. Routing Safety

## 19.1 Requirement

No edit may introduce an illegal routing loop.

## 19.2 Strategy

Treat channel/send routing as a directed graph.

Validate:

- acyclicity where the engine requires it
- no self-loop unless explicitly legal
- send count / bus count limits
- no output-to-input cycles that would destabilize the engine

Use:

- DAG checks
- topological validation
- explicit edge constraints

---

# 20. Parameter Safety

## 20.1 Requirement

All engine-facing parameter edits must be checked against authoritative plugin or device metadata.

## 20.2 Rules

The backend must:

- clamp or reject out-of-range values
- snap enums to valid variants only
- reject writes to read-only parameters
- reject writes to unloaded or unavailable devices
- normalize units before application

Never trust the model’s units or naming blindly.

---

# 21. Musical Semantics

## 21.1 Scope

Some edits need domain-aware validation beyond raw structure.

Examples:

- transposition with enharmonic spelling
- chord voicing legality
- scale-aware note insertion
- tempo-map continuity
- bar/beat consistency
- quantization grid validity

## 21.2 Rule

Make music-theory validation optional but pluggable.

Do not hardwire all creative decisions as failures.
Different modes can be:

- strict
- assistive
- permissive
- experimental

---

# 22. Runtime Data Exchange

## 22.1 Browser Path

If the browser build needs zero-copy exchange between worker and audio-adjacent logic, use `SharedArrayBuffer` only in a cross-origin-isolated environment.

## 22.2 Native Path

On desktop, prefer:

- shared immutable snapshots
- lock-free command queues
- bounded SPSC ring buffers
- atomic revision pointers

## 22.3 Snapshot Format

Use a compact schema for state exchange.

Good options:

- FlatBuffers
- Cap’n Proto
- compact binary snapshot format
- immutable arena-backed structures

The runtime engine should consume snapshots, not ad hoc mutable JSON blobs.

---

# 23. Real-Time Audio Constraints

## 23.1 Absolute Rule

The audio thread must remain:

- lock-free
- allocation-free
- non-blocking
- deterministic

## 23.2 Forbidden on Audio Thread

- JSON parsing
- graph mutation
- LLM inference
- patch compilation
- filesystem I/O
- large allocations
- mutex waits
- hash-map growth
- schema validation

## 23.3 Allowed Pattern

1. background thread builds validated snapshot
2. snapshot is atomically published
3. audio thread reads current snapshot via wait-free handle

A practical pattern is:

- `ArcSwap` or equivalent RCU-like snapshot publication
- SPSC command queue for fine-grained events

---

# 24. Browser Execution Concerns

## 24.1 WebLLM Constraints

Browser inference must account for:

- GPU memory pressure
- model load latency
- device loss
- worker lifecycle instability
- per-tab memory ceilings

## 24.2 Requirements

The browser implementation must:

- explicitly release prior model resources before switching models
- handle `deviceLost`
- expose model-ready state
- separate UI worker from inference worker where useful
- support cancellation mid-generation

## 24.3 Fallback Behavior

If the local browser model cannot fit or initialize:

- disable AI edit generation gracefully
- keep deterministic patch application available
- allow desktop/native fallback where applicable

---

# 25. Native Execution Concerns

## 25.1 mistral.rs Path

Use native inference for:

- larger local models
- lower generation latency
- more predictable memory behavior
- tighter integration with Rust validation

## 25.2 Rules

- keep inference isolated from real-time engine threads
- bound queue sizes
- support cancellation
- stream structured output incrementally
- log model/runtime provenance for reproducibility

---

# 26. Model Selection Strategy

## 26.1 Baseline Recommendation

Use **Qwen2.5-Coder-7B-Instruct** as the primary baseline for:

- state transformation
- structured editing
- DSO planning
- deterministic patch-oriented tasks

Rationale:

- strong text-code grounding
- good structural fidelity
- strong performance on data transformation workflows
- long context support

## 26.2 Secondary Model

Use **Qwen3-8B** or equivalent for tasks that need:

- more nuanced instruction following
- stronger multi-step reasoning
- richer planning
- optional multimodal expansion in adjacent workflows

## 26.3 Design Rule

Do not couple the architecture to one model family.

Abstract model capability flags:

```rust
pub struct ModelProfile {
    pub supports_json_schema: bool,
    pub supports_cfg: bool,
    pub supports_streaming: bool,
    pub native_context_tokens: usize,
    pub preferred_for_structured_edits: bool,
    pub preferred_for_reasoning: bool,
}
```

---

# 27. Prompting Strategy

## 27.1 System Contract

The model prompt should define:

- that it is an edit planner
- that it must output only the constrained schema
- that it must not invent IDs
- that it must use only provided stable identifiers
- that ambiguous requests should resolve to a typed clarification object, not freeform prose

## 27.2 Few-Shot Examples

Provide few-shot examples for:

- clip duplication
- track mutation
- note transposition
- routing edits
- refusal / clarification cases
- “no-op” cases

## 27.3 Negative Guidance

Explicitly forbid:

- raw JSON Pointer invention
- index-based referencing
- edits to absent IDs
- unscoped bulk destructive actions

---

# 28. UX: Preview-Then-Commit

## 28.1 Principle

The system must preserve user agency.

AI-proposed changes should normally appear as **previews** before final commit.

## 28.2 Ghost Track Pattern

Render timeline edits as:

- semi-transparent clips
- proposed automation overlays
- ghost notes in MIDI editor
- provisional routing overlays
- staged mixer changes

These are not yet part of canonical state.

## 28.3 Actions

User can:

- accept
- reject
- tweak
- regenerate
- compare alternatives

---

# 29. Visualizing Diffs

## 29.1 Requirement

Edits must be explained semantically, not only as low-level patch logs.

## 29.2 Human-Readable Diff Labels

Examples:

- “Duplicated chorus vocal clip to bar 65”
- “Muted drum bus send to reverb”
- “Shifted selected hi-hats forward by 10 ms”
- “Added 12 ghost notes to snare clip”

## 29.3 MIDI Diff Visualization

For note edits, useful views include:

- note-on additions
- deleted notes
- velocity deltas
- timing deviation heatmaps
- density overlays between original and proposed variation

---

# 30. Autonomy and Steerability

## 30.1 User Controls

Provide explicit controls for:

- creativity / autonomy
- strictness
- scope of edit
- target track/group
- harmonic safety
- destructive edit permissions

## 30.2 Engine Mapping

These controls can map to:

- model temperature
- prompt framing
- allowed DSO families
- numeric ranges
- validation strictness modes

## 30.3 Important Rule

Do not expose raw sampling settings as the only user control.
Translate them into meaningful music-editing metaphors.

---

# 31. Failure Taxonomy

| Category    | Failure Mode                   | Mitigation                                   |
| ----------- | ------------------------------ | -------------------------------------------- |
| Structural  | invalid JSON / invalid nesting | grammar-constrained decoding                 |
| Referential | invented or wrong IDs          | EASE + strict schema + backend ID resolution |
| Temporal    | stale base state               | RFC 6902 `test` ops + semantic rebase        |
| Semantic    | wrong edit intent              | few-shot contracts + preview UX              |
| Musical     | illegal overlap or routing     | interval tree + DAG validation               |
| Operational | race with user edits           | revision checks + rebasing                   |
| Runtime     | browser OOM / device loss      | cancellation + fallback + resource disposal  |
| Safety      | destructive batch edits        | moderation fields + confirmation gates       |

---

# 32. Safety and Approval Policy

## 32.1 Auto-Apply Allowed

Low-risk edits may auto-apply:

- mute/unmute
- rename track
- recolor clip
- set track volume within safe range
- toggle bypass

## 32.2 Preview Required

Medium/high-impact edits should require preview:

- clip moves
- bulk timeline shifts
- MIDI generation
- routing changes
- insert/delete device
- destructive trimming
- region deletion
- tempo-map changes

## 32.3 Explicit Confirmation Required

Always gate:

- mass delete
- remove tracks
- overwrite routing graph
- flatten/commit destructive rendering
- delete automation lanes
- delete takes or comp data

---

# 33. Browser + Native Unified API

Expose one orchestration interface to the rest of Sourdaw.

```rust
pub trait DawEditOrchestrator {
    fn request_edit(&self, req: EditRequest) -> EditJobId;
    fn stream_events(&self, job: EditJobId) -> EditEventStream;
    fn approve_preview(&self, preview_id: PreviewId) -> Result<CommitId>;
    fn reject_preview(&self, preview_id: PreviewId) -> Result<()>;
    fn cancel_job(&self, job: EditJobId) -> Result<()>;
}
```

The implementation can route internally to:

- browser WebLLM execution
- native mistral.rs execution
- offline stub / disabled mode

---

# 34. Recommended Rust Types

```rust
pub struct CanonicalProjectState {
    pub revision: u64,
    pub tracks: BTreeMap<StableId, Track>,
    pub clips: BTreeMap<StableId, Clip>,
    pub channels: BTreeMap<StableId, Channel>,
    pub routes: Vec<RouteEdge>,
    pub order: ProjectOrder,
}

pub struct DsoPlan {
    pub intent: String,
    pub dsos: Vec<Dso>,
    pub moderation: ModerationDecision,
}

pub enum ModerationDecision {
    Allow,
    NeedsConfirmation,
    Block,
}

pub enum Dso {
    DuplicateClip(DuplicateClip),
    MoveClip(MoveClip),
    SetTrackVolume(SetTrackVolume),
    CreateSend(CreateSend),
    InsertDevice(InsertDevice),
    HumanizeMidi(HumanizeMidi),
}
```

---

# 35. Implementation Plan

## Phase 1 — Deterministic State Core

1. canonical project schema
2. EASE encoding
3. selective state injection
4. revision tracking
5. patch compiler
6. inverse patch generation

## Phase 2 — Structured Output Runtime

1. DSO schema design
2. browser structured generation
3. native structured generation
4. incremental JSON parser
5. moderation sentinels
6. streaming event bus

## Phase 3 — Semantic Validation

1. interval tree timeline checks
2. routing DAG checks
3. parameter metadata validation
4. clip and lane invariants
5. strict typed deserialization
6. semantic rebase flow

## Phase 4 — UX Layer

1. ghost track preview
2. semantic diff labels
3. MIDI diff views
4. autonomy controls
5. confirm/reject/apply flows

## Phase 5 — Real-Time Integration

1. snapshot publication
2. SPSC queues
3. audio-safe patch application boundary
4. browser/native cancellation
5. model lifecycle management

---

# 36. Minimal Build Summary

If an AI agent needs the shortest faithful implementation brief, use this:

1. Represent DAW state as a normalized logical model, not raw project XML.
2. Replace positional arrays with **EASE**: stable IDs plus explicit order lists.
3. Inject only the state relevant to the current request.
4. Make the LLM output typed **DSOs**, not raw engine mutations.
5. Compile DSOs into RFC 6902 patches with leading `test` ops and stored inverse patches.
6. Use grammar/schema-constrained decoding in both browser and native runtimes.
7. Parse streamed JSON incrementally so the UI can react before generation completes.
8. Treat the Rust backend as the final authority for semantic validity.
9. Validate overlaps with interval trees, routing with DAG checks, and parameters against engine metadata.
10. Never mutate canonical project state directly from LLM output; stage edits as previews first.
11. Publish validated state into the engine through lock-free snapshots and queues only.
12. Use ghost previews, semantic diffs, and autonomy controls to preserve user agency.

---

# mistral.rs-Specific Implementation Guide for Deterministic, Local-First DAW Editing

## Purpose

This guide defines the **native Rust backend** architecture for deterministic, local-first LLM-driven DAW editing using **mistral.rs**.

It is specifically designed for this use case:

- natural-language editing of DAW project state
- strict structural correctness
- low-latency streaming UX
- preview-before-commit behavior
- no cloud dependency
- no direct LLM mutation of canonical project state
- strong semantic validation in Rust
- lock-free separation from the real-time audio engine

This is not a generic chat backend. It is a production-oriented orchestration layer for **structured DAW edit planning**.

---

# 1. Core Design Principle

The native backend must follow this rule:

> The model is a constrained planner. Rust is the source of truth.

That means:

- the model proposes **typed edit plans**
- Rust compiles those plans into canonical patches
- Rust validates all engine invariants
- the DAW applies only validated, approved edits

The model never gets authority to mutate the project directly.

---

# 2. Why mistral.rs Is the Right Native Runtime

mistral.rs is a strong fit for this workflow because it provides:

- a pure Rust inference stack
- direct integration through the Rust SDK
- builder-based model loading
- local inference on CPU, CUDA, or Metal depending on build/runtime
- request-level structured constraints
- streaming chat responses
- request builders with explicit sampling control
- tool-calling support when needed
- paged attention and prefix caching controls
- direct support for quantized local models

For deterministic DAW editing, the most important mistral.rs capabilities are:

- `TextModelBuilder` / `ModelBuilder`
- `RequestBuilder`
- `Constraint::JsonSchema`
- `Constraint::Llguidance`
- `stream_chat_request`
- per-request sampling controls
- explicit model lifecycle control in Rust

---

# 3. High-Level Native Architecture

Use a five-layer backend:

1. **Canonical Project State Layer**
2. **Inference Orchestrator**
3. **Structured Output + Streaming Layer**
4. **Validation + Patch Compiler**
5. **Commit / Snapshot Publication Layer**

```text
User Intent
   ↓
Prompt Assembler
   ↓
mistral.rs Inference Engine
   ↓
Structured DSO Stream
   ↓
Incremental Parser
   ↓
Rust Validator / DSO Compiler
   ↓
Patch Bundle + Inverse Patch + Preview
   ↓
User Approval
   ↓
Canonical State Commit
   ↓
Immutable Snapshot Publication to Audio Runtime
```

---

# 4. Process Topology

## 4.1 Required Thread Separation

Never run inference on the audio thread.

Recommended process/thread layout:

- **UI thread / frontend IPC handler**
- **LLM orchestrator task**
- **mistral.rs model task(s)**
- **validator/compiler task**
- **audio runtime thread / callback**

## 4.2 Hard Rule

The audio thread must never perform:

- token generation
- JSON parsing
- DSO compilation
- patch validation
- graph mutation
- filesystem I/O
- model loading
- allocator-heavy work
- blocking locks

---

# 5. Canonical Project State

## 5.1 Required Representation

Do not feed raw DAW XML or raw engine internals to the model.

Maintain two views:

### Logical State

Prompt-oriented, compact, human-readable state including:

- track names
- clip ranges
- routing summary
- selected devices
- important plugin parameters
- selected region summary

### Physical State

Full engine state including:

- notes
- automation points
- waveforms
- plugin blobs
- editor-only state
- low-level render/cache data

The model sees the **Logical State** by default.

## 5.2 Normalization

Normalize the project into flat entity maps linked by stable IDs.

Recommended top-level collections:

- `tracks`
- `clips`
- `devices`
- `channels`
- `routes`
- `groups`
- `markers`
- `tempo_map`
- `automation_headers`

---

# 6. EASE Encoding

## 6.1 Requirement

Use **Explicitly Addressed Sequence Encoding (EASE)** for model-facing sequence data.

Do not use raw positional arrays for editable collections.

### Bad

```json
{
    "tracks": [
        { "id": "t1", "name": "Vocals" },
        { "id": "t2", "name": "Drums" }
    ]
}
```

### Good

```json
{
    "tracks": {
        "ax": { "name": "Vocals" },
        "by": { "name": "Drums" }
    },
    "track_order": ["ax", "by"]
}
```

## 6.2 Why

This prevents:

- index drift
- stale positional references
- wrong-target edits after deletions or insertions
- array arithmetic failures in smaller local models

## 6.3 Apply EASE To

- tracks
- clips
- lanes
- buses
- sends
- device chains
- markers
- arrangement scenes or sections
- automation lane registries

---

# 7. Selective State Injection

## 7.1 Rule

Never prompt the model with the full session by default.

## 7.2 Default Prompt Context

Include only:

- selected entities
- visible entities
- current time range
- relevant routing neighborhood
- active constraints
- recent confirmed edits if needed

## 7.3 On-Demand Expansion

Inject full detail only when the task needs it.

Examples:

### Inject full note data for:

- transpose selected notes
- quantize selected clip
- humanize hi-hats
- remove overlapping notes in current phrase

### Do not inject full note data for:

- rename track
- mute bus
- move audio clip
- create send
- recolor region

This reduces:

- latency
- token pressure
- hallucination surface
- accidental edits on irrelevant entities

---

# 8. Edit Representation: Use DSOs

## 8.1 Core Rule

The model must emit **Domain-Specific Operations (DSOs)**, not raw engine mutations.

Examples:

- `duplicate_clip`
- `move_clip`
- `split_clip`
- `set_track_volume`
- `toggle_mute`
- `transpose_notes`
- `insert_device`
- `create_send`
- `ripple_delete_range`
- `humanize_midi`

## 8.2 Why

This lets Rust own:

- path resolution
- state lookup
- patch expansion
- inverse patch creation
- safety checks
- semantic validation

## 8.3 Example DSO

```json
{
    "kind": "edit_plan",
    "intent": "duplicate the selected vocal clip to bar 65",
    "moderation": "allow",
    "dsos": [
        {
            "op": "duplicate_clip",
            "clip_id": "cp11",
            "destination_track_id": "ax",
            "destination_start_beats": 64.0
        }
    ]
}
```

---

# 9. Structured Output in mistral.rs

## 9.1 Use RequestBuilder Constraints

mistral.rs exposes structured constraints directly through `RequestBuilder::set_constraint(...)`.

Supported constraint families include:

- `Constraint::JsonSchema`
- `Constraint::Regex`
- `Constraint::Lark`
- `Constraint::Llguidance`
- `Constraint::None`

## 9.2 Recommended Default

For DAW edit planning, use:

- `Constraint::JsonSchema` as the default
- `Constraint::Llguidance` only for advanced grammar workflows that exceed JSON Schema expressiveness
- `Regex` only for narrow single-field formats
- `Lark` only when you deliberately need a custom grammar language

## 9.3 Why JsonSchema Is the Default

Because the output object is naturally:

- typed
- bounded
- schema-driven
- easy to version
- easy to deserialize with `serde`
- easy to audit in production

---

# 10. Recommended Schema Design

## 10.1 Keep Schemas Narrow

Prefer:

- flat objects
- enums
- discriminated unions
- bounded arrays
- explicit required fields
- `additionalProperties: false` for deterministic planning objects

Do not overload the schema with engine semantics that belong in Rust validation.

## 10.2 Example Rust-Side Schema Source

Use `schemars` to derive JSON Schema from your Rust edit-plan types.

```rust
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "op")]
pub enum Dso {
    #[serde(rename = "duplicate_clip")]
    DuplicateClip {
        clip_id: String,
        destination_track_id: String,
        destination_start_beats: f64,
    },
    #[serde(rename = "set_track_volume")]
    SetTrackVolume {
        track_id: String,
        volume_db: f32,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct EditPlan {
    pub kind: String,
    pub intent: String,
    pub moderation: ModerationDecision,
    pub dsos: Vec<Dso>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub enum ModerationDecision {
    #[serde(rename = "allow")]
    Allow,
    #[serde(rename = "needs_confirmation")]
    NeedsConfirmation,
    #[serde(rename = "block")]
    Block,
}
```

Then serialize the schema and pass it to `Constraint::JsonSchema`.

---

# 11. mistral.rs Request Construction

## 11.1 Recommended Request Pattern

Use `RequestBuilder` rather than bare chat helpers whenever you need deterministic edit planning.

### Recommended baseline

```rust
use mistralrs::{Constraint, RequestBuilder, TextMessageRole};

let request = RequestBuilder::new()
    .set_constraint(Constraint::JsonSchema(edit_plan_schema))
    .set_sampler_temperature(0.1)
    .set_sampler_top_p(0.9)
    .set_sampler_max_len(512)
    .enable_thinking(false)
    .add_message(TextMessageRole::System, system_prompt)
    .add_message(TextMessageRole::User, user_instruction)
    .add_message(TextMessageRole::User, logical_state_json);
```

## 11.2 Sampling Rules

For deterministic DAW editing:

- low temperature
- bounded max length
- conservative top-p
- no uncontrolled creative sampling in the commit path
- disable thinking mode by default

---

# 12. Tool Calling: Supported but Not Primary

## 12.1 mistral.rs Capability

mistral.rs supports tool calling across its Rust and OpenAI-compatible interfaces.

## 12.2 Recommendation for This Use Case

Do **not** make tool calling the primary control plane for DAW edits.

Use:

- **schema-constrained DSO output** as the primary edit protocol
- tool calling only for secondary workflows such as:
    - search
    - retrieval
    - documentation lookup
    - optional analysis helpers
    - explicit user-authorized non-edit tools

## 12.3 Why

For deterministic DAW editing, DSO output is easier to:

- validate
- audit
- diff
- replay
- invert for undo
- rebase on concurrent state changes

---

# 13. Streaming in mistral.rs

## 13.1 Required Path

Use `stream_chat_request(...)` for interactive editing surfaces.

This enables:

- progressive UI feedback
- early moderation detection
- preview prewarming
- lower perceived latency

## 13.2 Example

```rust
use futures::StreamExt;
use mistralrs::{Response, ChatCompletionChunkResponse, ChunkChoice, Delta};

let mut stream = model.stream_chat_request(request).await?;

while let Some(chunk) = stream.next().await {
    if let Response::Chunk(ChatCompletionChunkResponse { choices, .. }) = chunk {
        if let Some(ChunkChoice {
            delta: Delta { content: Some(content), .. },
            ..
        }) = choices.first()
        {
            // forward partial content into incremental parser
            handle_chunk(content);
        }
    }
}
```

## 13.3 Rule

Do not wait for the full response string before starting downstream work.

---

# 14. Incremental Parsing Layer

## 14.1 Requirement

Use a stateful incremental parser to consume streamed structured output.

Do not repeatedly re-parse the full buffer on every token chunk.

## 14.2 Responsibilities

The parser should emit events such as:

- key discovered
- scalar fragment updated
- object complete
- array item complete
- moderation sentinel discovered
- full document complete

## 14.3 Outcomes

This enables:

- immediate action labels
- ghost-preview precomputation
- early abort on `"moderation": "block"`
- sub-document validation hooks
- responsive UI while the model is still generating

---

# 15. Moderation Sentinel Design

## 15.1 Include Early Moderation Field

Put moderation near the top of the schema:

```json
{
    "kind": "edit_plan",
    "moderation": "allow",
    "intent": "...",
    "dsos": []
}
```

## 15.2 Behavior

If streaming parser observes:

- `"block"`
- unsupported edit family
- ambiguous destructive request
- missing target reference

then:

- abort the generation stream if practical
- discard provisional commit path
- surface refusal/confirmation UI

---

# 16. Model Loading with TextModelBuilder

## 16.1 Recommended Builder Path

For text planning models, use `TextModelBuilder`.

Typical setup:

```rust
use mistralrs::{TextModelBuilder, IsqType, PagedAttentionMetaBuilder};

let model = TextModelBuilder::new("Qwen/Qwen2.5-Coder-7B-Instruct")
    .with_isq(IsqType::Q4K)
    .with_logging()
    .with_paged_attn(|| PagedAttentionMetaBuilder::default().build())?
    .with_prefix_cache_n(Some(8))
    .build()
    .await?;
```

## 16.2 Builder Knobs That Matter for This Use Case

Important controls include:

- `with_isq(...)`
- `with_paged_attn(...)`
- `with_prefix_cache_n(...)`
- `with_device(...)`
- `with_force_cpu(...)`
- `with_hf_revision(...)`
- `with_chat_template(...)` only if a model requires explicit override

---

# 17. Quantization Strategy

## 17.1 Use Quantized Models by Default

For interactive DAW editing, quantized models are usually the right baseline.

Typical choices:

- Q4K / Q4-class for broad deployability
- Q8-class if hardware headroom is strong and latency remains acceptable

## 17.2 Rule

Do not maximize model size blindly.

Prefer:

- predictable latency
- stable structured output
- moderate context efficiency
- bounded memory usage

over:

- huge reasoning model size with unstable runtime performance

---

# 18. Paged Attention and Prefix Cache

## 18.1 Paged Attention

Enable paged attention where supported, especially for:

- longer logical state windows
- repeated edit sessions
- lower fragmentation under streaming workloads

## 18.2 Prefix Cache

Use `with_prefix_cache_n(...)` to retain repeated prompt prefixes across requests.

This is valuable because DAW editing prompts often reuse:

- system contract
- schema instructions
- project-state envelope
- stable task framing

## 18.3 Recommendation

Use prefix caching for:

- interactive multi-turn editing sessions
- repeated edits within the same project

Do not depend on it for correctness; it is a performance optimization.

---

# 19. Prompt Contract

## 19.1 System Prompt Requirements

The system prompt must say that the model:

- is a deterministic DAW edit planner
- must output only the constrained structured object
- must use only provided stable IDs
- must not invent tracks, clips, devices, or routes
- must choose `needs_confirmation` for destructive edits
- must choose `block` when the request cannot be mapped safely

## 19.2 Few-Shot Coverage

Provide few-shot examples for:

- no-op
- clarification required
- rename track
- duplicate clip
- move clip
- set track volume
- destructive edit requiring confirmation
- invalid or missing ID case

---

# 20. Model Recommendation Strategy

## 20.1 Baseline Recommendation

Use a coding-strong instruct model as the baseline planner for structured editing tasks.

A practical native default is a **Qwen-family instruct or coder-oriented model** in the 7B–8B class when hardware allows, because the task is closer to:

- structured transformation
- typed planning
- schema-constrained generation

than to open-ended conversation.

## 20.2 Operational Rule

Profile your actual target hardware and choose the smallest model that reliably satisfies:

- structured fidelity
- acceptable latency
- stable memory use
- acceptable concurrency under real DAW use

## 20.3 Thinking Mode

`RequestBuilder::enable_thinking(...)` exists, but for deterministic edit planning:

- default it to `false`
- enable only in explicit “reasoning” or “draft plan” modes
- never depend on hidden reasoning text for correctness

Correctness must come from:

- structured output
- validation
- preview
- approval

---

# 21. Canonical Patch Compilation

## 21.1 Core Rule

The model produces DSOs.
Rust compiles them into:

- RFC 6902 patch
- inverse patch
- semantic diff labels
- preview plan

## 21.2 Patch Bundle Type

```rust
pub struct PatchBundle {
    pub tests: Vec<JsonPatchOp>,
    pub patch: Vec<JsonPatchOp>,
    pub inverse_patch: Vec<JsonPatchOp>,
    pub affected_entities: Vec<StableId>,
    pub preview: PreviewPlan,
}
```

## 21.3 Leading `test` Operations

Every patch bundle must begin with `test` ops to guarantee optimistic concurrency safety.

If state changed while the model was generating:

- patch fails safely
- no partial mutation
- rebase path is triggered

---

# 22. Semantic Rebase

## 22.1 Problem

The user can continue editing while the native model is generating.

## 22.2 Required Request Envelope

```rust
pub struct EditRequest {
    pub base_revision: u64,
    pub selected_state_hash: u128,
    pub intent: String,
    pub target_entities: Vec<StableId>,
}
```

## 22.3 On Patch Failure

If a leading `test` op fails:

1. reject patch application
2. preserve original intent
3. refresh logical state
4. regenerate or recompile preview against new revision
5. present rebased proposal

Never silently apply stale edits.

---

# 23. Rust Semantic Validation Layer

## 23.1 Principle

mistral.rs gives syntactic control.
Rust must enforce semantic truth.

## 23.2 Required Validation Domains

- timeline integrity
- routing safety
- parameter safety
- entity existence
- track-type compatibility
- clip/lane policy
- undo integrity
- optional music-theory correctness

## 23.3 Type-Driven Design

Deserialize model output into strongly typed Rust structures using:

- `serde`
- `schemars`
- validation layer such as `garde` or equivalent domain validators

Illegal states should be hard to represent.

---

# 24. Timeline Integrity

## 24.1 Requirement

Clip edits must not create illegal overlaps where the engine forbids them.

## 24.2 Data Structure

Use interval indices or interval trees per track/lane.

Typical behavior:

- query for overlap in `[start, end]`
- collect collisions
- apply track policy:
    - reject
    - trim existing
    - trim incoming
    - lane split
    - ripple shift
    - require confirmation

## 24.3 Rule

This belongs in Rust validation, not in the model prompt or schema.

---

# 25. Routing Safety

## 25.1 Requirement

No edit may introduce an illegal routing loop.

## 25.2 Strategy

Treat routing as a directed graph.

Validate:

- no illegal cycles
- no invalid self-loop
- send count and bus limits
- no engine-crashing feedback edges

## 25.3 Rule

Routing proposals may be suggested by the model, but acceptance depends entirely on Rust-side graph validation.

---

# 26. Parameter Safety

## 26.1 Requirement

All parameter changes must be validated against authoritative engine metadata.

## 26.2 Backend Duties

- clamp or reject out-of-range values
- reject writes to missing parameters
- reject writes to unloaded devices
- resolve units before application
- enforce plugin automation mode if relevant

The model is not trusted to know valid parameter ranges.

---

# 27. Undo and Inverse Patches

## 27.1 Requirement

Undo must be exact and independent of rerunning the model.

## 27.2 Strategy

Generate inverse patches from the pre-edit canonical state.

Store:

- DSO plan
- forward patch
- inverse patch
- semantic diff label
- affected entities
- approval metadata

## 27.3 Rule

Do not reconstruct undo from intent text.
Always store the actual inverse patch bundle.

---

# 28. Preview-Then-Commit UX

## 28.1 Mandatory Pattern

Use preview-before-commit for all non-trivial edits.

## 28.2 Ghost Preview Types

Render:

- ghost clips
- ghost MIDI notes
- ghost automation overlays
- ghost routing changes
- ghost mixer-state previews

## 28.3 User Actions

User can:

- accept
- reject
- regenerate
- tweak prompt
- cycle variations
- inspect diff

No preview object is canonical until explicit commit.

---

# 29. Semantic Diff Presentation

## 29.1 Human-Readable Labels

Examples:

- “Duplicated selected vocal clip to bar 65”
- “Raised drum bus volume by 1.2 dB”
- “Muted send to plate reverb”
- “Transposed selected bass notes down one octave”

## 29.2 MIDI Diff Visualization

For note edits, expose:

- inserted notes
- deleted notes
- moved notes
- velocity changes
- timing shift overlays
- density heatmaps for rhythmic difference

---

# 30. Orchestrator API Design

## 30.1 Suggested Trait

```rust
pub trait NativeDawEditOrchestrator {
    fn submit_edit(&self, req: EditRequest) -> EditJobId;
    fn cancel_edit(&self, job: EditJobId) -> anyhow::Result<()>;
    fn stream_events(&self, job: EditJobId) -> EditEventStream;
    fn approve_preview(&self, preview: PreviewId) -> anyhow::Result<CommitId>;
    fn reject_preview(&self, preview: PreviewId) -> anyhow::Result<()>;
}
```

## 30.2 Internal Stages

- prompt assembly
- model request creation
- stream parsing
- DSO deserialization
- validation
- patch compilation
- preview publication
- commit on approval

---

# 31. Lock-Free Engine Publication

## 31.1 Rule

The audio runtime consumes immutable snapshots or bounded command queues.

## 31.2 Recommended Pattern

Use:

- `ArcSwap` or equivalent RCU-like snapshot publication
- bounded SPSC queues for fine-grained control events
- immutable project snapshots for graph and arrangement changes

## 31.3 Forbidden

Do not:

- mutate engine graphs directly from the LLM stream
- hold mutexes in the audio callback
- deserialize JSON in the audio callback
- perform patch application in the audio callback

---

# 32. Runtime Resilience

## 32.1 Failure Classes

Handle:

- model load failure
- device unavailability
- OOM under large model choice
- stream interruption
- malformed structured output
- validation rejection
- revision mismatch
- user cancellation

## 32.2 Recovery Rules

### Model load failure

- suggest smaller quantized model
- keep deterministic non-AI editing available

### Stream interruption

- preserve user intent
- discard incomplete proposal
- allow retry

### Validation failure

- never apply patch
- surface exact failure reason
- allow regenerate with same intent

### Revision mismatch

- trigger semantic rebase

---

# 33. Deployment Strategy

## 33.1 Library Integration vs Sidecar

Two valid native deployment modes:

### In-Process Rust Integration

Best when:

- the DAW is already Rust-heavy
- you want tight validator coupling
- you want minimal IPC overhead

### Sidecar Service

Best when:

- you want failure isolation
- you want optional model restarts
- you want easier profiling and model replacement

## 33.2 Recommendation

If the DAW core is already Rust and snapshot-based, prefer **in-process integration** for edit planning and validation, while still keeping the model runtime off the audio thread.

---

# 34. Example End-to-End Flow

1. User says: “Duplicate the selected vocal clip to the second chorus.”
2. Prompt assembler builds logical-state prompt using EASE IDs.
3. `RequestBuilder` is created with:
    - low temperature
    - bounded max length
    - `Constraint::JsonSchema`
4. `stream_chat_request` begins.
5. Incremental parser sees:
    - `moderation = allow`
    - `op = duplicate_clip`
6. DSO object completes.
7. Rust validator resolves IDs and compiles patch bundle.
8. Preview layer renders ghost clip at destination.
9. User approves.
10. Patch applies to canonical state.
11. Immutable snapshot is published to engine.
12. Undo stack stores inverse patch.

---

# 35. Implementation Plan

## Phase 1 — Native Inference Core

1. add `mistralrs` crate
2. implement model loader with `TextModelBuilder`
3. add quantized model selection
4. add paged attention and prefix cache tuning
5. add stream-based request path

## Phase 2 — Structured Edit Protocol

1. define Rust DSO types
2. derive JSON Schema with `schemars`
3. wire `Constraint::JsonSchema`
4. build prompt contract
5. add moderation sentinel field

## Phase 3 — Validation + Patch Compiler

1. parse DSO into typed structs
2. compile RFC 6902 patches
3. generate inverse patches
4. add timeline overlap validation
5. add routing DAG validation
6. add parameter safety checks

## Phase 4 — Preview UX

1. ghost-track generation
2. semantic diff labels
3. MIDI diff overlays
4. approval/reject actions

## Phase 5 — Concurrency and Commit Safety

1. revision IDs
2. patch `test` ops
3. semantic rebase
4. snapshot publication
5. lock-free command queues

---

# 36. Minimal Build Summary

If an AI agent needs the shortest faithful mistral.rs-specific brief, use this:

1. Use `TextModelBuilder` to load one native planning model and keep it warm off the audio thread.
2. Represent DAW state as a normalized logical model with stable IDs and EASE ordering.
3. Use `RequestBuilder::set_constraint(Constraint::JsonSchema(...))` so the model emits only typed DSO plans.
4. Stream with `stream_chat_request` and parse incrementally instead of buffering the entire response.
5. Treat tool calling as secondary; use schema-constrained DSO output as the main edit protocol.
6. Compile DSOs into RFC 6902 patches with leading `test` ops and stored inverse patches.
7. Validate timeline overlaps, routing cycles, and parameter ranges in Rust before preview or commit.
8. Render non-trivial edits as ghost previews before applying them.
9. Publish approved changes to the engine through immutable snapshots or lock-free queues only.
10. Keep all inference, parsing, validation, and patching away from the real-time audio thread.

---

## Additional Implementation Considerations

### 1. Chunk Taxonomy for Prompt Assembly

To make selective state injection concrete and repeatable, the project state should be partitioned into a small set of stable prompt domains. A practical default taxonomy is:

- **Arrangement**: tracks, clips, clip placement, regions, markers, selected time range
- **Mixer and Devices**: channels, inserts, sends, buses, device chains, key exposed parameters
- **Automation**: automation lane headers, selected lane summaries, targeted point windows
- **Global Transport**: tempo map, meter changes, loop range, timeline selection, locator state
- **Performance Context**: selected entities, current focus panel, recent approved edits, active user constraints

The prompt builder should inject one or more of these domains depending on the user request, plus a compact summary of the rest of the session.

### 2. Project Summary Contract

In addition to the focused state slice, every edit request should include a short project summary that gives the model enough context to reason safely without loading the full session.

Recommended fields:

- project revision
- total track count
- selected track IDs
- selected clip IDs
- visible timeline range
- active transport context
- high-level routing summary
- relevant edit constraints
- recent approved edit summaries

Example:

```json
{
    "project_revision": 1842,
    "track_count": 12,
    "selected_tracks": ["ax"],
    "selected_clips": ["cp11"],
    "visible_range_beats": [32, 96],
    "routing_summary": "Vocals -> Vox Bus -> Master; Drums -> Drum Bus -> Master",
    "recent_edits": ["Muted reverb send on Drum Bus", "Renamed track ax to Lead Vox"]
}
```

This summary should be treated as a reusable prompt primitive for all edit classes.

### 3. Single Edit-Orchestration Entrypoint

The backend should expose one canonical edit-orchestration entrypoint rather than many loosely-coupled edit endpoints.

That entrypoint should own the complete lifecycle:

1. accept user intent and base revision
2. assemble prompt state
3. invoke the model
4. parse streamed structured output
5. deserialize DSOs
6. compile patches
7. validate semantics
8. generate preview artifacts
9. register forward and inverse history entries
10. commit only after approval when required

This keeps all edit safety, history, and preview behavior centralized and auditable.

### 4. Evaluation Harness for DAW Edit Planning

Model selection should be driven by a fixed DAW-specific evaluation suite rather than general coding benchmarks alone.

The harness should include representative tasks such as:

- rename track
- duplicate clip
- move clip to target bar
- insert device on selected track
- set plugin parameter
- create send
- transpose selected MIDI notes
- split clip at cursor
- ripple-delete range
- refuse ambiguous destructive request
- request confirmation for high-impact edits

Each test case should score at least:

- schema adherence
- correct target identification
- semantic correctness
- patch validity
- validation pass rate
- regeneration rate
- latency
- token usage

This evaluation suite should be run against every candidate local model and after every prompt-contract revision.

### 5. Preview and Diff as a Required Contract

Preview generation should not be treated as optional UI polish. For any edit that changes timeline content, routing, device topology, or MIDI structure, the backend should emit a preview plan alongside the compiled patch bundle.

Every preview should include:

- affected entities
- semantic action label
- human-readable diff summary
- ghost-overlay payload
- commit classification:
    - auto-apply
    - preview-required
    - confirmation-required

This ensures that preview-then-commit is enforced consistently across the system.

### 6. History Envelope

Each accepted edit should be stored as a structured history envelope, not just as a raw undo patch.

Recommended history record:

```json
{
    "intent": "Duplicate the selected vocal clip to the second chorus",
    "base_revision": 1842,
    "approved_revision": 1843,
    "dsos": [
        {
            "op": "duplicate_clip",
            "clip_id": "cp11",
            "destination_track_id": "ax",
            "destination_start_beats": 64.0
        }
    ],
    "patch": [
        /* forward patch */
    ],
    "inverse_patch": [
        /* inverse patch */
    ],
    "affected_entities": ["cp11", "cp77", "ax"],
    "summary": "Duplicated selected vocal clip to bar 65"
}
```

This makes undo, redo, replay, audit, and regression testing more robust.

### 7. Streaming Parser Contract

Streaming structured output should be treated as a first-class interface between inference and validation.

The parser layer should emit events such as:

- moderation field observed
- intent field completed
- DSO item completed
- full document completed
- parse error

This allows the system to:

- show progressive action labels
- warm preview generation before full completion
- abort early on blocked or unsafe outputs
- reduce perceived latency in the editing workflow

### 8. Prompt-Assembly Policy

Prompt assembly should be deterministic and rule-based.

Given an edit request, the system should explicitly derive:

- which project domains to include
- which entity IDs are in scope
- which constraints are active
- which recent edits are relevant
- whether full note or automation detail is required

This policy should be implemented as code, not improvised inside prompt templates.

### 9. Recommended Operational Rule

The system should treat the model as responsible for **planning intent**, while the backend remains responsible for:

- state selection
- identifier resolution
- patch construction
- semantic validation
- preview generation
- history registration
- commit authorization

That separation should remain explicit across all implementations.
