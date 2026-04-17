# Sourdaw Future-DAW Unified Specification

## Mission

Transform Sourdaw from a local-first browser/native DAW into a capability-aware musical operating system built around:

- creative intent as a first-class object
- durable expressive performance data
- variation-native composition and editing
- object-based and format-flexible mixing
- capture-anything project memory
- adaptive browser/desktop execution
- a visible model-and-engine rack
- negotiated instrument semantics
- a live capabilities graph
- per-note expressive portability
- decision memory
- explicit trust modes for AI
- exportable provenance
- multi-resolution sessions
- constraint-driven composition
- runtime-native transparency

Sourdaw already exposes the right foundation: browser DAW workflow, local-first processing, peer-to-peer collaboration, CRDT sync, local AI inference, and a shared browser/desktop project story. The public site describes it as a DAW “that lives in your browser but works like a native app,” and the desktop page describes a “shared project format” with “zero conversion friction,” while the privacy policy states that projects and audio are processed on-device, collaboration is peer-to-peer, and local AI runs on the user’s machine. [oai_citation:0‡Sourdaw](https://www.sourdaw.studio/workflow)

---

## Product thesis

The next generation DAW should stop treating audio, MIDI, automation, plugins, AI, and collaboration as separate feature silos. It should instead model a project as a graph of:

- musical intent
- semantic performance
- transformations
- engines
- capabilities
- provenance
- render targets
- user decisions

The user remains the director. AI, plugins, generators, analyzers, and renderers are subordinate systems that can propose, transform, or execute, but never hide state or erase authorship boundaries. This matches both modern AI UX guidance on transparency and system-status visibility, and the direction of emerging media provenance standards. [oai_citation:1‡Nielsen Norman Group](https://www.nngroup.com/articles/visibility-system-status/)

---

## Non-negotiable principles

### 1. Human direction, machine execution

Every generative or assistive feature must preserve user authority over:

- when to run
- what scope to affect
- whether output is advisory, reversible, or destructive
- whether output becomes canonical or remains a branch

### 2. Intent is durable session data

Natural-language goals, structured constraints, decisions, and rationales must be saved in the project, not trapped in ephemeral chats.

### 3. Semantics survive translation

Where possible, Sourdaw must preserve musical meaning such as articulation, vibrato, pressure, role, phrasing, note-level timbral intention, and render target intent, instead of flattening to raw MIDI bytes or automation curves.

### 4. Runtime changes must not break the project model

The same session must remain coherent across:

- browser lightweight mode
- browser enhanced mode
- desktop preview mode
- desktop full mode
- offline HQ render mode

### 5. AI operations must be inspectable

Users must always be able to see:

- what engine ran
- what inputs were used
- what trust mode applied
- what changed
- how to reproduce
- how to revert
- how to branch

### 6. Provenance is operational, not decorative

Provenance must drive:

- trust display
- export policy
- rights gating
- collaborator confidence
- reproducibility
- client deliverables

### 7. Recognition over recall

Advanced systems should be visible and discoverable through contextual UI, not hidden behind memorized commands or “magic” side effects. That is especially important in a DAW that mixes direct manipulation, AI actions, and multi-runtime execution. [oai_citation:2‡Nielsen Norman Group](https://www.nngroup.com/articles/visibility-system-status/)

---

## Target architecture

## Layer 1: Core project graph

Persistent domain objects:

- Project
- Section
- Track
- Clip
- Note
- PerformanceDNA
- Intent
- Decision
- Variation
- EngineBinding
- CapabilityDescriptor
- ProvenanceManifest
- ConstraintSet
- RenderTarget
- RuntimeProfile
- MemoryArtifact

## Layer 2: Semantic services

Pure domain services:

- intent parser and normalizer
- performance translator
- branch/merge engine
- capability resolver
- provenance manager
- trust-policy evaluator
- constraint solver
- render planner
- semantic search indexer
- session memory linker

## Layer 3: Execution adapters

Runtime-specific adapters:

- browser local adapter
- browser WebGPU adapter
- desktop native adapter
- desktop sidecar adapter
- offline background render adapter
- plugin host adapter
- MIDI 1.0 / MIDI 2.0 adapter
- CLAP/VST/AU abstraction layer

## Layer 4: UI surface

Primary UI systems:

- arrangement timeline
- semantic inspector
- intent panel
- performance DNA editor
- variation tree
- provenance/trust drawer
- capabilities console
- model-and-engine rack
- capture inbox
- render target and fidelity selector
- runtime transparency strip

---

## Shared project graph additions

## Intent

Represents a desired musical or production outcome.

Required fields:

- `id`
- `scope`: project | section | track | clip | selection
- `author`
- `created_at`
- `updated_at`
- `natural_language`
- `normalized_goals`
- `constraints`
- `target_artifacts`
- `trust_mode`
- `status`: draft | active | satisfied | partially_satisfied | rejected
- `evidence_refs`
- `decision_refs`

Examples:

- “make this chorus wider without harshness”
- “double this lead with a breathy whisper texture”
- “reharmonize bar 21 but keep soprano top note singable”
- “render these strings with more bow urgency but less attack noise”

## PerformanceDNA

A semantic expression container that can map across MIDI, MPE, MIDI 2.0, CLAP note expression, automation, and AI renderers.

Core dimensions:

- timing feel
- microtiming offsets
- dynamic contour
- accent profile
- articulation tags
- onset sharpness
- sustain behavior
- release behavior
- vibrato spec
- pitch drift
- pressure/aftertouch curve
- timbral bias
- role in texture: lead | support | rhythmic | pad | bass | FX
- phrase energy
- note-level expression payloads

## Variation

Represents an alternate realization of any artifact.

Required fields:

- `parent_artifact_id`
- `variant_kind`: melody | harmony | voicing | sound | vocal_render | mix | mastering | arrangement | prompt_result | human_take
- `generation_method`
- `engine_binding`
- `source_refs`
- `diff_summary`
- `acceptance_state`: sandbox | candidate | chosen | rejected | merged

## Decision

Represents why a human or team chose one path over another.

Required fields:

- `scope`
- `summary`
- `reason`
- `linked_intents`
- `alternatives_considered`
- `outcome`
- `author`
- `timestamp`

## CapabilityDescriptor

Describes what a device, plugin, engine, runtime, or session target can do.

Required fields:

- `entity_type`: device | plugin | engine | runtime | session_target
- `protocols_supported`
- `resolution_limits`
- `per_note_support`
- `spatial_support`
- `automation_support`
- `midi_profile_support`
- `render_modes`
- `latency_profile`
- `format_exports`
- `provenance_support`
- `rights_constraints`
- `resource_requirements`

## ProvenanceManifest

Project-internal provenance object, later exportable to C2PA-compatible structures.

Required fields:

- `asset_ref`
- `created_by`
- `input_ingredients`
- `tools_used`
- `engines_used`
- `model_refs`
- `transform_history`
- `human_vs_machine_labels`
- `signing_state`
- `integrity_hashes`
- `rights_flags`

---

# Feature specifications

## A. Creative intent layer

### Outcome

The user can express high-level goals in natural language or structured form and attach them to any scope in the project. Intent becomes a persistent, queryable, actionable object.

### Why

Most DAWs only store actions, not goals. Tomorrow’s DAW must remember what the user was trying to achieve, not just which knobs moved. This makes AI useful, auditable, and reversible.

### UX requirements

- Add an **Intent Lane** at project, section, track, and clip level.
- Add a global **Intent Panel** with filters by status, scope, and owner.
- Every intent must show:
    - plain-language statement
    - normalized targets
    - attached constraints
    - related artifacts
    - actions taken
    - current satisfaction estimate
- Intent creation modes:
    - free text
    - template
    - from selection
    - from failed result
    - from collaborator comment
    - from captured voice note
- Suggested templates:
    - lift / darken / widen / tighten / soften / humanize / energize
    - reharmonize under constraints
    - generate doubles
    - match performance feel
    - reduce masking
    - fit target format
- Intent must be visible inline near affected material, not buried in a chat tab.

### Technical requirements

- Implement intent normalization into structured goal categories:
    - timbral
    - dynamic
    - spatial
    - harmonic
    - rhythmic
    - expressive
    - arrangement
    - technical
    - rights / provenance
- Implement a planner that converts intent plus capability graph into candidate action plans.
- Candidate plans must declare:
    - scope
    - engines needed
    - estimated runtime
    - trust mode
    - affected artifacts
    - reversibility
- Intent should never mutate the session directly. It produces either:
    - suggestions
    - branches
    - reversible deltas
    - queued renders

### Acceptance criteria

- An intent attached to a clip can generate at least three action plans.
- Intent can survive save/load, collaboration sync, and browser-to-desktop transition.
- Intent can be marked satisfied or unresolved and linked to decisions.
- Intent search returns both natural-language text and normalized meaning.

---

## B. Unified performance DNA editing

### Outcome

The user edits expressive musical performance semantically, not just through disconnected MIDI notes, CC lanes, pitch bends, and automation curves.

### Why

MPE, MIDI 2.0, and CLAP all move toward per-note expression, higher resolution, and richer semantics. MIDI 2.0 adds improved per-note control and more expressive messages, MPE is explicitly designed for per-note pitch and timbre changes, and CLAP supports per-note automation and modulation. Sourdaw should build a unified expression model above all of them. [oai_citation:3‡MIDI.org](https://midi.org/midi-2-0)

### UX requirements

- Add a **Performance DNA Editor** with three synchronized views:
    - phrase view
    - note view
    - lane view
- Each note can expose a compact expression capsule:
    - pressure
    - pitch drift
    - vibrato
    - brightness bias
    - onset style
    - sustain style
    - release style
    - articulation tag
- Provide copy modes:
    - copy notes only
    - copy notes + expression
    - copy expression only
    - transfer feel to another track
- Add “Extract Performance DNA” from:
    - MIDI phrases
    - MPE takes
    - audio transients and pitch analysis
    - AI-generated results
- Add “Apply Performance DNA” to:
    - MIDI instrument track
    - vocal synthesis track
    - automation target
    - other branch variant
- Add visual overlays:
    - velocity heat
    - pressure curves
    - drift bands
    - articulation badges
    - vibrato envelopes

### Technical requirements

- Internal canonical representation must be note-centric and span-centric, not transport-format-centric.
- Implement translators:
    - MIDI 1.0 ↔ PerformanceDNA
    - MPE ↔ PerformanceDNA
    - MIDI 2.0 UMP/per-note controllers ↔ PerformanceDNA
    - CLAP per-note modulation ↔ PerformanceDNA
    - AI vocal/instrument renderer control curves ↔ PerformanceDNA
- Preserve high-resolution data internally even if export target is lower resolution.
- Add conflict-aware merge for concurrent edits to the same phrase under CRDT sync.
- Add a confidence score when reconstructing PerformanceDNA from audio.

### Acceptance criteria

- A phrase recorded with MPE can be edited semantically and re-rendered to a non-MPE target without losing intent.
- A MIDI phrase can export to MIDI 1.0, MPE, MIDI 2.0, or engine-native curves with graceful degradation.
- Copy/paste and clip split preserve attached performance semantics.

---

## C. Variation-native clips and branches

### Outcome

Every clip, section, mix state, and generated asset can have branchable variations without duplicate-track chaos.

### Why

AI-era creation is variant-heavy. Users no longer work on one canonical line at a time. They compare alternatives. The DAW must model that directly.

### UX requirements

- Every clip has a **Variants** button.
- Variants open in a **Variation Stack**:
    - list view
    - side-by-side compare
    - timeline audition
    - merge/cherry-pick
- Types of variants:
    - melody
    - harmony
    - voicing
    - sound design
    - vocal render
    - mix treatment
    - lyric
    - spatialization
    - mastering target
- Add a **branch timeline** for sections and full-song arrangements.
- Add **promote to mainline**, **archive**, **compare against current**, and **keep as shadow** actions.
- Add lightweight diff summaries:
    - note diff
    - timing diff
    - energy diff
    - timbral diff
    - spatial diff
    - provenance diff
- Variants must be visible as siblings, not hidden versions.

### Technical requirements

- Artifact IDs must support lineage:
    - original
    - derived
    - merged
    - forked
- Diff engine must compute semantic deltas, not just binary changes.
- Branch merges must support:
    - note-level cherry-pick
    - automation range cherry-pick
    - phrase replace
    - performance DNA merge
    - mix snapshot merge
- Variants must inherit provenance and append transform history.
- Generated variants must store their source inputs and engine bindings.

### Acceptance criteria

- A user can generate three alternate choruses, audition them in place, and merge the vocal phrasing from one with the mix treatment of another.
- A collaborator can propose a branch without overwriting the mainline.
- Variant lineage survives export/import within Sourdaw’s project format.

---

## D. Object-based and format-flexible mixing

### Outcome

Users author one mix graph that can target stereo, binaural, bed/object workflows, and future spatial outputs without rebuilding the session.

### Why

Dolby Atmos production already relies on DAW-authored audio plus positional metadata routed to a renderer, and ADM is a standardized metadata model for technical audio description. Sourdaw should generalize this into a format-flexible mixing architecture rather than adding spatial audio as a bolt-on mode. [oai_citation:4‡Dolby Professional](https://professional.dolby.com/content-creation/Dolby-Atmos-for-content-creators/)

### UX requirements

- Add **Render Target** switcher:
    - stereo
    - headphones binaural
    - 5.1 / 7.1.2 bed
    - bed + objects
    - ADM export
    - future renderer targets
- Tracks can be declared as:
    - channel track
    - bed member
    - object source
    - scene object
    - listener-adaptive source
- Spatial editing must exist in:
    - lane view
    - 2D room view
    - 3D object inspector
- Each object must support:
    - position
    - spread
    - divergence
    - motion
    - priority
    - render fallback behavior
- The user must be able to author one semantic mix and preview downmix consequences.

### Technical requirements

- Internal mix graph separates source semantics from renderer target.
- Add `SpatialSourceDescriptor` with:
    - source type
    - object metadata
    - bed membership
    - binaural preferences
    - downmix priorities
- Implement export adapters:
    - stereo render
    - binaural render
    - ADM metadata package
    - renderer handoff package
- Track signal path must support metadata streams alongside audio streams.
- Capability graph must declare which runtime/device can preview which target.

### Acceptance criteria

- One session can switch between stereo preview and object-based preview without rebuilding routing.
- Downmix preview highlights conflicts or likely masking changes.
- ADM-style metadata can be serialized from the internal graph.

---

## E. Capture-anything project memory

### Outcome

Anything relevant to the creative process can be captured directly into the session as linked, searchable artifacts.

### Supported inputs

- voice notes
- spoken instructions
- humming or melodic sketches
- room recordings
- MIDI gestures
- screenshots
- text notes
- collaborator comments
- plugin snapshots
- reference audio
- transcript snippets
- timeline bookmarks

### Why

The creative process includes intent, memory, rationale, and rough references. Avid’s transcript workflow shows the value of timeline-linked text and editability; Sourdaw should go wider and treat all project memory as first-class. [oai_citation:5‡Avid](https://kb.avid.com/pkb/articles/en_US/faq/Pro-Tools-Speech-to-Text-FAQ)

### UX requirements

- Add **Capture Inbox** docked panel.
- Universal hotkey: capture from anywhere.
- A capture can be linked to:
    - project
    - section
    - track
    - clip
    - selection
    - timestamp range
- Voice notes should auto-transcribe when possible.
- Transcript words should jump to the linked timeline location.
- Captures support:
    - tags
    - intent conversion
    - task conversion
    - branch creation
    - decision linking
- Add “drop zone” for references onto timeline locations.

### Technical requirements

- `MemoryArtifact` schema:
    - id
    - type
    - timestamp
    - linked scope
    - raw payload
    - derived payload
    - transcript
    - embeddings
    - intent refs
    - decision refs
    - provenance
- Add local indexing:
    - text index
    - audio embedding index
    - phrase similarity index
- Add low-friction background processing queue:
    - speech transcription
    - melody extraction
    - beat alignment
    - semantic tagging
- All derived artifacts must remain linked to original raw input.

### Acceptance criteria

- A spoken note can be captured, transcribed, attached to bars 17–21, converted into an Intent, and later surfaced in search.
- A hummed melody can be turned into a candidate clip without losing the original capture.
- Captures remain available offline and sync safely in local-first collaboration.

---

## F. Hardware-adaptive session modes

### Outcome

The same project adapts intelligently to changing execution environments without forcing the user to manually reconfigure everything.

### Session modes

- sketch
- preview
- review
- full-production
- offline-HQ-render

### Runtime classes

- browser CPU
- browser WebGPU
- desktop integrated GPU
- desktop discrete GPU
- desktop sidecar render node

### UX requirements

- Add a **Session Mode Selector** in the transport/status area.
- Add runtime badges:
    - current mode
    - compute backend
    - latency class
    - fidelity class
- Offer user-facing policies:
    - preserve interactivity
    - prioritize quality
    - background render aggressively
    - conserve memory
    - favor battery
- Every unavailable feature must explain why:
    - “requires desktop native plugin host”
    - “requires WebGPU”
    - “requires >8 GB VRAM”
    - “requires model pack not installed”

### Technical requirements

- Define `RuntimeProfile`:
    - platform
    - compute backends
    - memory budget
    - audio I/O capabilities
    - plugin host availability
    - supported model tiers
    - max preview fidelity
    - concurrency limits
- Render planner chooses engine tier based on:
    - session mode
    - hardware profile
    - clip priority
    - transport state
    - user policy
- Add background promotion workflow:
    - lightweight preview now
    - HQ branch or replacement later
- Engine bindings must be portable:
    - same semantic target, different backend

### Acceptance criteria

- A project opened in browser lightweight mode remains editable and uses reduced engines.
- The same project on desktop upgrades preview and final render capability automatically.
- Engine fallbacks are visible and non-destructive.

---

## G. Model-and-engine rack

### Outcome

Sourdaw exposes models and non-plugin engines as visible, routable, inspectable components of the session.

### Why

Tomorrow’s DAW should not hide generative and analytical systems behind one-off dialogs. They should be rackable, comparable, and replaceable.

### Supported engine classes

- generator
- renderer
- analyzer
- converter
- classifier
- search/embedding engine
- provenance signer
- rights policy checker
- spatial renderer
- mastering policy engine

### UX requirements

- Add an **Engine Rack** per track and per project.
- Rack slots show:
    - engine name
    - engine type
    - backend
    - model pack
    - quality tier
    - trust mode
    - provenance behavior
    - estimated runtime
- Every engine has four operating modes:
    - advisory
    - branch output
    - replace selection
    - background refine
- Engine compare mode:
    - A/B/C compare
    - latency and fidelity summaries
    - cost in memory and time
- Allow drag-and-drop replacement of engines while preserving intent bindings.

### Technical requirements

- `EngineBinding` schema:
    - engine id
    - version
    - backend
    - input contracts
    - output contracts
    - capability claims
    - quality tiers
    - resource profile
    - trust mode defaults
    - provenance hooks
- All engines must implement:
    - dry-run capability query
    - validation of inputs
    - render estimate
    - output reproducibility metadata
- Engine outputs must declare determinism:
    - deterministic
    - seeded stochastic
    - nondeterministic

### Acceptance criteria

- A user can swap one vocal renderer for another without losing attached intent or provenance history.
- Two engines can generate competing branches from the same source scope.
- Engine status is visible in the runtime transparency strip.

---

## H. Negotiated instrument semantics

### Outcome

Sourdaw understands what a device or plugin means, not just what bytes it receives.

### Why

MIDI 2.0 Profiles and Property Exchange allow devices to declare behavior and resources; this is the basis for self-configuring instrument semantics. MIDI 2.0 explicitly defines Profiles and Property Exchange, and Property Exchange exists to get and set resources between devices. [oai_citation:6‡MIDI.org](https://midi.org/midi-2-0)

### UX requirements

- When connecting a device or loading a plugin, Sourdaw should show:
    - discovered identity
    - supported profile(s)
    - expressive features
    - articulation maps
    - note expression support
    - preferred editor layout
- Add an **Instrument Semantics Inspector**.
- Show user-friendly concepts:
    - supports per-note pitch
    - supports pressure
    - supports articulation switching
    - supports strum mode
    - supports MPE
    - supports MIDI 2.0 profile X
- Offer “adopt discovered semantics” when safe.

### Technical requirements

- Instrument adapter layer must support:
    - MIDI-CI / Property Exchange
    - profile detection
    - plugin descriptor introspection
    - custom Sourdaw capability descriptors
- Build normalized semantic categories:
    - expressive pitch
    - timbral expression
    - articulation set
    - drum mapping
    - key-switch model
    - note-expression model
    - controller map
- Cache and version instrument semantics per endpoint/plugin build.
- Allow manual override and user-authored semantics templates.

### Acceptance criteria

- On compatible endpoints, Sourdaw can populate a usable editor profile automatically.
- Semantic discovery failures degrade gracefully to generic MIDI behavior.
- Manual overrides survive future rediscovery.

---

## I. Capabilities graph

### Outcome

The DAW maintains a live graph of what every device, plugin, engine, runtime, and render target can do.

### Why

A future DAW spanning browser, desktop, MIDI 1.0, MIDI 2.0, CLAP, and native engines needs a single place to reason about feature availability.

### UX requirements

- Add a **Capabilities Console**.
- For any selected entity, show:
    - supported protocols
    - per-note support
    - modulation depth
    - spatial support
    - export targets
    - provenance support
    - latency
    - memory cost
    - fidelity tiers
- Show incompatibility explanations:
    - “track requests per-note expression, plugin only supports channel-wide modulation”
    - “requested render target needs object metadata but selected engine only outputs stereo”
- Provide “best fit” suggestions.

### Technical requirements

- Model the graph as nodes and typed edges:
    - runtime supports engine
    - engine supports render target
    - plugin supports note expression
    - device exposes profile
    - model pack available locally
- Add a resolver that answers:
    - can feature X run here?
    - what is the best compatible chain?
    - what degrades if forced?
- Graph must update dynamically on:
    - device connect/disconnect
    - runtime switch
    - model install/remove
    - plugin scan
    - project open

### Acceptance criteria

- Any unavailable control in the UI can explain its unavailability using the capabilities graph.
- Feature planning uses the graph rather than hardcoded UI rules.
- Graph state is queryable by agents and automation.

---

## J. Per-note expressive portability

### Outcome

Expressive note-level data remains durable and portable across instruments, plugin formats, and render engines.

### Why

MIDI 2.0 expands per-note expression, MPE already enables per-note pitch and timbre variation, and CLAP supports per-note automation/modulation. Sourdaw should become the canonical keeper of note-level expression rather than leaving it trapped in any one protocol. [oai_citation:7‡MIDI.org](https://midi.org/midi-2-0)

### UX requirements

- Add **Portability Report** when moving material between engines:
    - preserved
    - approximated
    - dropped
    - transformed
- Let users choose mapping strategies:
    - literal
    - expressive-equivalent
    - conservative
    - target-optimized
- Provide visual indication when per-note detail is being downgraded.

### Technical requirements

- Implement translation rules:
    - per-note pitch
    - per-note pressure
    - note release velocity
    - note-specific timbre controls
    - note expression envelopes
- Track portability loss explicitly in provenance and diff summaries.
- Support fallback compaction:
    - note-level → channel-wide approximation
    - note-level → automation lane projection
    - note-level → renderer-native curve bundle

### Acceptance criteria

- Moving a phrase from a CLAP-capable synth to a basic MIDI target produces a visible degradation report and a user-selectable mapping strategy.
- Re-upgrading to a richer target should recover stored semantics if still available internally.

---

## K. Session memory of decisions

### Outcome

Sourdaw stores why choices were made, not just which files survived.

### UX requirements

- Add a **Decision Log** panel.
- Decisions can be created from:
    - accepted intent result
    - branch merge
    - capture note
    - collaborator review
    - export approval
- Decision cards should support:
    - summary
    - rationale
    - linked alternatives
    - linked intent
    - linked artifacts
    - linked provenance
- Add “show me why this exists” in context menus.

### Technical requirements

- Every branch merge, accepted AI result, and promoted render can optionally emit a Decision object.
- Search must index decisions alongside clips and notes.
- Decision history should be timeline-aware and scope-aware.

### Acceptance criteria

- A user can inspect a chosen chorus and see which alternatives were rejected and why.
- Decision logs sync across collaborators and survive export/import in project format.

---

## L. Trust modes for AI operations

### Outcome

Every AI-assisted action declares its autonomy and reversibility before it runs.

### Trust modes

- suggest only
- create branch
- apply reversible delta
- replace selection
- destructive commit
- background refine only
- observe/analyze only

### UX requirements

- Add a trust-mode selector on every AI action surface.
- Trust mode must be visible in:
    - intent panel
    - engine rack
    - operation confirmation
    - provenance
- Default trust mode should be conservative.
- The UI must explain consequences:
    - whether timeline changes
    - whether branches are created
    - whether provenance marks it as machine-generated
    - whether undo alone is sufficient

### Technical requirements

- Trust modes are enforced in the execution planner, not just the UI.
- Engines declare which trust modes they support.
- Destructive operations require explicit confirmation or policy permission.
- Branch-first should be the default for stochastic generation.

### Acceptance criteria

- No AI action can silently overwrite canonical material if its trust mode disallows it.
- Trust mode is recorded in provenance and decision history.

---

## M. Exportable provenance

### Outcome

Exports can carry verifiable provenance describing origin, edits, tools, and machine involvement.

### Why

C2PA defines Content Credentials as cryptographically signed provenance describing origin and edits, and explicitly includes audio in scope. Sourdaw should map internal provenance to exportable manifests wherever possible. [oai_citation:8‡C2PA](https://c2pa.org/)

### UX requirements

- Add **Provenance Drawer** for any asset.
- Add export options:
    - no provenance
    - project-internal provenance only
    - embedded/attached signed provenance when supported
- Show a clear human/machine contribution summary:
    - human recorded
    - human edited
    - AI generated
    - AI transformed
    - AI assisted
- Add policy warnings:
    - unsigned export
    - unverifiable external asset
    - non-shippable model used
    - mixed-rights ingredients

### Technical requirements

- Internal provenance graph stores:
    - source ingredients
    - transform chain
    - engine/model versions
    - trust mode
    - user approvals
    - integrity hashes
- Export adapters:
    - internal JSON manifest
    - sidecar manifest
    - C2PA-compatible packaging where feasible
- Signed provenance is optional but architecture must support it.
- Provenance must remain stable under branch merges and format transcodes where possible.

### Acceptance criteria

- A bounced stem can include a structured provenance summary.
- The export flow can block or warn based on rights/provenance policy.
- Users can inspect provenance before publishing.

---

## N. Multi-resolution sessions

### Outcome

One project can exist at multiple fidelity tiers without splitting into separate “lite” and “full” copies.

### Resolution dimensions

- audio quality
- model quality
- render depth
- spatial fidelity
- analysis precision
- plugin oversampling
- stem availability
- provenance/signing completeness

### UX requirements

- Add a **Fidelity Matrix** per project and per asset:
    - sketch
    - preview
    - review
    - final
- Show whether an item is:
    - current
    - stale
    - promoted from lower tier
    - awaiting HQ replacement
- Users can request:
    - render current selection at higher tier
    - promote whole section
    - render overnight
    - lock final

### Technical requirements

- Each artifact can hold multiple realizations linked to one semantic source.
- The planner decides whether to reuse lower-tier assets or queue a replacement.
- Lower-tier and higher-tier outputs must share lineage, not become unrelated files.
- Project save format should not duplicate semantic data across tiers.

### Acceptance criteria

- A user can sketch in browser with lightweight engines, then open the same project on desktop and generate HQ replacements without losing edits or intent links.
- Section-level promotion is possible without forcing whole-project rerender.

---

## O. Constraint-driven composition

### Outcome

Generative assistance respects explicit musical, technical, and rights constraints.

### Constraint classes

- harmonic
- melodic range
- voice-leading
- orchestration
- articulation availability
- instrument capability
- timing/groove
- lyric syllable count
- singability
- render target
- rights/provenance
- engine availability
- session mode

### UX requirements

- Add a **Constraints Editor**.
- Constraints can be attached to:
    - intent
    - track
    - section
    - generation operation
- Present constraints as readable chips and expandable rules.
- Support:
    - hard constraints
    - soft preferences
    - banned outcomes
- Add ready-made constraint templates:
    - keep top line singable
    - no parallel fifths
    - stay within sampled articulation set
    - preserve kick space
    - write only for current object target budget
    - avoid unsupported per-note features

### Technical requirements

- Generative engines must consume normalized constraint payloads.
- Constraint solver should validate:
    - feasibility
    - contradictions
    - dependency on unavailable capabilities
- If constraints cannot be satisfied, the system should explain which ones conflict.

### Acceptance criteria

- A user can request a reharmonization that preserves the melody range and excludes unsupported articulations, and the system either produces constrained branches or explains infeasibility.
- Constraints are stored and replayable.

---

## P. Runtime-native transparency

### Outcome

The DAW visibly explains what the engine stack is doing right now.

### Why

Users trust complex systems more when system status is legible. This is especially critical when local AI, plugin hosting, browser/desktop runtimes, and background renders coexist. [oai_citation:9‡Nielsen Norman Group](https://www.nngroup.com/articles/visibility-system-status/)

### UX requirements

- Add a persistent **Runtime Transparency Strip** showing:
    - active runtime
    - compute backend
    - current session mode
    - selected engine
    - fidelity tier
    - queue state
    - cache state
    - provenance state
    - fallback state
- Expandable details panel:
    - why this engine was chosen
    - estimated remaining time
    - why fallback happened
    - what would improve quality
    - whether output is deterministic
- Use clear states:
    - ready
    - analyzing
    - generating branch
    - preview render
    - HQ render queued
    - stale preview
    - blocked by capability
    - blocked by rights policy
    - failed, recoverable
    - failed, manual attention required

### Technical requirements

- Every long-running operation must emit structured lifecycle events.
- Status events must be queryable by UI, automation, and agents.
- Fallbacks must include machine-readable reasons:
    - no WebGPU
    - plugin not available on browser
    - insufficient VRAM
    - model pack missing
    - target format unsupported
    - trust mode restriction
- Status must be attached to relevant artifact scope where possible.

### Acceptance criteria

- The user can always tell whether they are hearing:
    - a preview render
    - a final render
    - a downgraded fallback
    - a cached result
- Every hidden fallback currently in the system must become a visible fallback reason.

---

# Cross-feature system design

## 1. Canonical internal representation

Internally, Sourdaw should preserve a richer semantic model than any external transport format.

Priority order:

1. project semantics
2. performance semantics
3. provenance
4. constraints
5. decisions
6. branch lineage
7. external transport projection

Never let export formats become the source of truth.

## 2. Branch-first generation

Any stochastic or large transform should default to branch output, not silent in-place replacement.

## 3. Policy engine

Add a central policy layer controlling:

- trust mode defaults
- rights gating
- provenance requirements
- runtime fallback behavior
- collaboration permissions
- auto-promotion to higher fidelity

## 4. Agent interface

Expose a stable internal command surface:

- `create_intent`
- `normalize_intent`
- `plan_actions`
- `run_engine`
- `create_branch`
- `merge_branch`
- `capture_memory`
- `extract_performance_dna`
- `apply_performance_dna`
- `query_capabilities`
- `explain_unavailability`
- `set_trust_mode`
- `generate_provenance`
- `export_with_policy`
- `promote_fidelity`
- `attach_constraints`
- `log_decision`

The agent must never mutate project state directly outside this surface.

---

# UI structure

## Main layout

- Top: arrangement and transport
- Center: editor canvas
- Bottom: performance lanes / transcript / object lanes / branch diff
- Right: semantic inspector
- Left: project browser, capture inbox, variation tree, capabilities console
- Bottom status strip: runtime transparency

## Key panels

- Intent Panel
- Performance DNA Editor
- Variation Stack
- Capabilities Console
- Instrument Semantics Inspector
- Engine Rack
- Provenance Drawer
- Decision Log
- Constraints Editor
- Capture Inbox
- Fidelity Matrix

## Interaction rules

- never hide destructive consequences
- never hide fallback reasons
- always show branch lineage for generated material
- preserve direct manipulation wherever possible
- contextual tips over generic tutorials
- every advanced feature must have a visible state model

This follows strong usability guidance for recognition over recall and visibility of system status, both of which are especially important in gesture-heavy or state-heavy creative tools. [oai_citation:10‡Nielsen Norman Group](https://www.nngroup.com/articles/visibility-system-status/)

---

# Collaboration model

## Requirements

- CRDT-safe for semantic objects, not just raw notes
- concurrent edits allowed on:
    - intents
    - decisions
    - memory artifacts
    - variants
    - performance DNA
- branch proposals preferred over overwrite conflicts
- semantic conflict views for:
    - harmony disagreement
    - expressive disagreement
    - different chosen takes
    - differing provenance status
    - incompatible constraint sets

## Rules

- collaborator-generated branches must be attributable
- trust mode defaults may differ by user role
- provenance must include collaborator identity where available

The architecture should stay aligned with local-first practice: user data lives on devices, collaboration is peer-to-peer where possible, and sync operates on durable local state rather than cloud-owned canonical state. [oai_citation:11‡Sourdaw](https://sourdaw.studio/privacy?utm_source=chatgpt.com)

---

# Browser vs desktop split

## Browser-first responsibilities

- editing
- intent
- capture
- lightweight generation
- semantic search
- branch management
- provenance inspection
- lower-tier preview
- local-first collaboration

## Desktop-first responsibilities

- native plugin hosting
- ASIO/CoreAudio low-latency I/O
- heavyweight model execution
- large model packs
- high-fidelity final rendering
- advanced spatial preview
- expanded provenance signing
- offline background render farms / sidecars

This stays consistent with Sourdaw’s stated browser/desktop continuum and shared project format. [oai_citation:12‡Sourdaw](https://www.sourdaw.studio/desktop)

---

# Build order

## Phase 1: foundational graph

Implement:

- Intent
- Variation
- Decision
- CapabilityDescriptor
- RuntimeProfile
- ProvenanceManifest skeleton
- agent command surface

## Phase 2: visible system status

Implement:

- runtime transparency strip
- capabilities console
- trust modes
- branch-first AI execution
- fidelity matrix

## Phase 3: expressive semantics

Implement:

- PerformanceDNA model
- translators for MIDI/MPE/CLAP/MIDI 2.0
- performance editor
- portability reports

## Phase 4: project memory and decisions

Implement:

- capture inbox
- transcript integration
- decision log
- intent conversion from memory artifacts
- semantic search

## Phase 5: object-based and adaptive execution

Implement:

- format-flexible mix graph
- object metadata lanes
- runtime-adaptive planner
- browser/desktop promotion flow

## Phase 6: provenance and constraints

Implement:

- operational provenance
- export policy
- constraint editor
- constrained generation plumbing

---

# Minimum quality bar

Do not ship any of these features if they are:

- opaque
- uninspectable
- destructive by default
- recall-heavy
- brittle across browser/desktop transition
- incapable of preserving lineage
- hidden behind magic AI phrasing
- impossible to explain when unavailable

---

# Agent success criteria

The implementation agent succeeds when Sourdaw can do all of the following coherently:

1. Store high-level user intent as persistent project data.
2. Preserve and translate expressive note-level semantics across targets.
3. Create and manage branching alternatives without duplicate-track mess.
4. Author a single mix graph that can target multiple output formats.
5. Capture voice notes, references, transcripts, and comments as searchable, linked memory.
6. Adapt session behavior across browser and desktop runtimes without losing project meaning.
7. Treat models and non-plugin engines as visible rack components.
8. Discover or declare instrument semantics and expose them to the user.
9. Maintain a live capabilities graph that explains what is possible and why.
10. Produce portability reports when expressive data downgrades across targets.
11. Preserve decision history and rationale.
12. Require explicit trust modes for AI operations.
13. Export useful provenance and enforce rights-aware policies.
14. Maintain multiple fidelity tiers for the same semantic session.
15. Run constrained composition/generation rather than unconstrained prompt roulette.
16. Make runtime state and fallback reasons visible at all times.

---

# Final directive

Implement the system as a semantic, local-first, capability-aware DAW platform.

Do not optimize first for minimalism.
Do not optimize first for imitation of legacy DAW metaphors.
Do not hide system complexity behind fake simplicity.

Instead:

---

## Implementation Status

**What is implemented:**
- None. This is a visionary specification for the "future" of Sourdaw.

**What is not implemented:**
- All layers and features described, including the Creative Intent layer, Performance DNA, Variation-native clips, and Capability-aware execution.

**What is done well:**
- Provides a clear and ambitious roadmap for the platform.

**What needs refactoring:**
- N/A
