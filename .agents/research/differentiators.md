# Sourdaw — Real Differentiators Worth Building

## Product direction

Do not try to invent a “musical operating system.”
Do not build a semantic bureaucracy.
Do not ship panels, logs, and drawers that explain creativity instead of accelerating it.

Build the parts that solve real production pain:

- too many alternate versions
- expressive performance data getting flattened or lost
- ideas living outside the session
- browser/desktop projects drifting apart
- AI doing opaque or destructive things
- users not knowing what engine, quality, or fallback they are hearing

The winning version of Sourdaw is:

**a fast, local-first DAW with branch-native creation, durable expression, integrated project memory, explicit AI control, and honest runtime transparency**

---

# Core principles

## 1. Music first

Every advanced system must make writing, editing, arranging, performing, comping, and comparing faster.

## 2. Branch first, never chaos first

Alternatives should be native to the session, not hacked together with duplicate tracks and muted clips.

## 3. Preserve meaning, not just bytes

Performance expression, version lineage, and user intent should survive edits, transforms, exports, and runtime changes wherever possible.

## 4. No invisible state

If playback, rendering, AI, or runtime conditions changed what the user is hearing, the DAW must say so clearly.

## 5. AI must be subordinate

AI can suggest, branch, transform, or refine. It must not silently overwrite, obscure authorship, or hide its operating mode.

## 6. Browser and desktop are one project

The same session must remain coherent across light preview, browser editing, and heavyweight native rendering.

## 7. Advanced features must stay lightweight

No feature should require users to think like a systems architect to finish a song.

---

# The features that are actually worth building

## 1. Variation-native clips, takes, and branches

### Why this matters

This is one of the clearest opportunities to beat traditional DAWs.

Modern music production is branch-heavy:

- alternate choruses
- different vocal comps
- multiple sound design passes
- arrangement experiments
- mix variants
- AI-assisted alternates
- collaborator proposals

Today this usually becomes:

- duplicate tracks
- disabled lanes
- renamed clips
- “final_v12_real”
- lost edits
- broken context

Sourdaw should make alternatives a first-class session structure.

### Outcome

Any clip, section, take, generated result, or mix state can hold structured variants that are easy to audition, compare, promote, merge, archive, and revisit.

### What the user should be able to do

- Create alternate versions of a clip or section without duplicating track structure
- Audition variants in context on the timeline
- Compare two or more variants side by side
- Promote one variant to mainline instantly
- Keep rejected variants as attached history, not clutter
- Merge useful aspects from one branch into another
- Receive collaborator or AI proposals as branches, never silent replacement

### UX

- Every clip and section gets a visible **Variants** affordance
- Variants appear as siblings, not hidden internal states
- Common actions:
    - audition
    - compare
    - promote to mainline
    - archive
    - keep as shadow
    - merge selected attributes
- Diff summaries should be human-readable:
    - notes changed
    - timing changed
    - feel changed
    - sound changed
    - mix changed

### Technical direction

- Every artifact has lineage metadata:
    - original
    - forked
    - derived
    - merged
- Variants inherit source context and append transform history
- Branch merges should support:
    - note merge
    - phrase replace
    - timing merge
    - expressive merge
    - mix-state merge

### Minimum quality bar

A user must be able to generate or record three alternate choruses, audition them in place, keep two as attached history, and merge the phrasing from one with the timbral treatment of another without session clutter.

---

## 2. Unified performance expression model

### Why this matters

This is the deepest musical feature in the spec.

Most DAWs still split expressive performance across unrelated representations:

- notes
- velocity
- CC lanes
- pitch bend
- automation
- MPE gestures
- synth-specific modulation
- engine-specific render curves

That fragmentation is bad for editing and bad for portability.

Sourdaw should preserve expression in a higher-level internal model so performance survives translation between devices, protocols, plugins, and renderers.

### Outcome

Performance is edited semantically, not just as disconnected transport data.

### The model should preserve

- timing feel
- microtiming
- dynamic contour
- accent profile
- vibrato behavior
- pitch drift
- onset character
- sustain character
- release character
- pressure or aftertouch shape
- timbral bias
- phrase energy
- note role in texture

### What the user should be able to do

- Copy notes only
- Copy expression only
- Copy notes plus expression
- Transfer feel from one phrase to another
- Extract expressive behavior from performance
- Reapply expressive behavior to a new instrument or render engine
- Move material between richer and poorer targets with a clear degradation report

### UX

Create a **Performance Editor** with synchronized views:

- phrase view
- note view
- lane view

Each note can expose a compact expression capsule with the most useful parameters, not a wall of technical fields.

Visual overlays should make feel visible:

- timing heat
- dynamic contour
- pitch drift
- pressure shape
- articulation markers
- phrase energy

### Technical direction

Use one internal canonical model above:

- MIDI 1.0
- MPE
- MIDI 2.0
- CLAP note expression
- engine-native modulation or render curves

Translation adapters can degrade outward, but the internal session should keep the richer semantics.

### Minimum quality bar

A phrase recorded with rich expression should be editable semantically, copied with feel intact, moved to a less expressive target with an honest portability report, and later recover richer detail if moved back to a capable target.

---

## 3. Per-note expressive portability

### Why this matters

This is the practical extension of the unified expression model.

If Sourdaw becomes the canonical keeper of expressive note-level semantics, it can solve one of the ugliest problems in digital performance:
great phrasing dying when material crosses engines or formats.

### Outcome

Note-level expressive intent stays durable even when the playback target changes.

### The user should always know

- what was preserved
- what was approximated
- what was dropped
- what was transformed

### UX

Whenever material moves between instruments, plugins, protocols, or render engines, show a lightweight **Portability Report**:

- preserved
- approximated
- downgraded
- unavailable

Provide mapping strategies:

- literal
- expressive-equivalent
- conservative
- target-optimized

### Technical direction

Support fallback projections such as:

- note-level pitch to channel approximation
- note-level timbre to automation
- rich curves to engine-native bundles

Keep the original richer semantics in session memory whenever possible.

### Minimum quality bar

No expressive downgrade should happen silently.

---

## 4. Capture-anything project memory

### Why this matters

Creative work is not just clips and automation.
Real sessions include:

- voice notes
- melody hums
- rough lyrics
- screenshots
- comments
- references
- bookmarks
- “fix this later” thoughts
- quick room recordings
- client or collaborator notes

Today that material gets scattered across phones, notes apps, chat threads, folders, and memory.

Sourdaw should pull it into the project.

### Outcome

Anything relevant to the song or session can be captured, linked to timeline context, searched later, and converted into action.

### Supported inputs

- voice notes
- spoken instructions
- humming
- text notes
- screenshots
- reference audio
- collaborator comments
- timeline bookmarks
- quick gesture captures
- plugin or chain snapshots

### What the user should be able to do

- capture instantly from anywhere
- attach a memory item to bars, clips, tracks, or sections
- transcribe a voice memo
- jump from transcript text to timeline location
- turn a captured note into a task, branch, or intent
- keep original raw capture and derived result linked together

### UX

Create a **Capture Inbox** that is always close at hand and never feels like a second app.

The golden rule:
capture must be lower friction than leaving the DAW.

### Technical direction

Every memory artifact should support:

- raw payload
- derived payload
- linked scope
- timestamp
- tags
- transcript
- search index
- relationships to branches, tasks, or decisions

### Minimum quality bar

A user must be able to record a spoken note like “make bars 17 to 21 hit harder,” attach it to that range, find it later in search, and convert it into an actionable operation without losing the original memo.

---

## 5. Explicit trust modes for AI operations

### Why this matters

AI in music tools becomes unacceptable the moment it acts opaquely or destructively.

Users need to know:

- what will happen
- how far the action reaches
- whether the result branches or replaces
- how easy it is to undo
- whether the output is deterministic or probabilistic

### Outcome

Every AI action declares its autonomy and reversibility before it runs.

### Trust modes

Keep them simple and universal:

- suggest only
- create branch
- apply reversible delta
- replace selection
- destructive commit
- analyze only

### UX

Every AI surface should show:

- selected trust mode
- affected scope
- whether timeline content changes
- whether a branch is created
- whether result is reversible
- whether provenance flags machine generation or machine transformation

Branch-first should be the default for stochastic generation.

### Technical direction

Trust mode must be enforced by execution logic, not just shown in UI.

An engine cannot be allowed to overwrite canonical material if the active mode forbids it.

### Minimum quality bar

No AI-assisted action may silently replace mainline creative material unless the user explicitly chose a destructive mode.

---

## 6. Runtime transparency

### Why this matters

In a hybrid browser/native AI-capable DAW, users can easily lose trust if they do not know what they are hearing.

They need to know whether playback is:

- preview or final
- downgraded or full quality
- cached or freshly rendered
- local or fallback
- limited by runtime or hardware

### Outcome

The DAW always explains the current execution state in plain language.

### UX

Add a persistent, compact **Runtime Strip** showing:

- runtime class
- current session mode
- compute backend
- active engine path
- fidelity tier
- queue state
- fallback state
- whether playback is preview or final

Expandable details should answer:

- why this engine was selected
- why a fallback happened
- what is blocked
- what would improve quality
- whether the result is deterministic
- whether this output is current or stale

### Status language must be blunt

Use states like:

- ready
- preview render
- final render
- downgraded fallback
- queued
- blocked by capability
- blocked by missing component
- failed, recoverable
- failed, needs attention

### Technical direction

Every long-running or stateful process must emit structured status events that the UI can query.

### Minimum quality bar

The user must always be able to tell whether they are hearing:

- a cached result
- a preview result
- a downgraded result
- a final render

No hidden fallback paths.

---

## 7. Hardware-adaptive session modes

### Why this matters

A browser/native DAW lives or dies on whether the same project remains usable across weak and strong machines.

Users should not have to manually rebuild a session because:

- WebGPU is absent
- VRAM is limited
- native plugin hosting is unavailable
- battery mode is active
- heavy engines are missing

### Outcome

The session adapts to runtime and hardware conditions without losing project meaning.

### The modes should be practical

Use a small set of clear session modes:

- sketch
- preview
- review
- full production
- final render

These are not marketing labels.
They are execution policies.

### UX

Users can choose a bias such as:

- preserve interactivity
- prioritize quality
- conserve power
- background refine

Unavailable features must explain why in plain language.

### Technical direction

The planner should choose compatible engine tiers and render paths based on:

- session mode
- hardware profile
- runtime availability
- user policy
- transport state

Fallbacks must be visible and non-destructive.

### Minimum quality bar

A project opened on a lightweight browser runtime must stay editable and musically meaningful, while the same project on desktop can upgrade render quality and capabilities without breaking continuity.

---

## 8. Capability-aware feature planning

### Why this matters

Creative tools get frustrating when controls fail silently or appear unavailable for no visible reason.

In Sourdaw, availability will depend on:

- runtime
- hardware
- protocol
- plugin support
- engine support
- model availability
- target format

You need one coherent way to explain capability, compatibility, and degradation.

### Outcome

The system can answer:

- can this run here?
- why not?
- what is the closest compatible path?
- what will degrade if forced?

### UX

Do not expose a giant technical graph to normal users.
Expose clear explanations in context.

Good examples:

- this target supports only channel-wide modulation
- object preview requires a compatible renderer
- native plugin hosting is unavailable in browser mode
- this operation needs a model pack that is not installed

### Technical direction

Maintain a live internal capability graph across:

- devices
- plugins
- runtimes
- engines
- installed components
- export targets

Use it for feature planning, not hardcoded one-off rules.

### Minimum quality bar

Every unavailable advanced feature must be explainable from a single coherent capability model.

---

## 9. Negotiated instrument semantics

### Why this matters

Devices and plugins should not be treated as anonymous byte sinks when richer semantics are discoverable.

If an endpoint supports:

- per-note pitch
- pressure
- articulation systems
- MPE behavior
- note-expression features
- custom controller meaning

Sourdaw should discover that and adapt editing intelligently.

### Outcome

Instrument behavior becomes more self-describing and less manually configured.

### UX

When loading a compatible device or instrument, show:

- discovered identity
- expressive features
- articulation support
- note-expression support
- suggested editor profile

Offer a safe “adopt detected semantics” flow, but always allow override.

### Technical direction

Support discovery and normalized mapping for:

- articulation sets
- note expression
- drum maps
- controller roles
- key-switch or equivalent behaviors
- expressive capability tiers

### Minimum quality bar

If discovery works, it should materially improve editing.
If discovery fails, the session must degrade gracefully to generic control without confusion.

---

# Features that support the core, but must stay restrained

## A. Engine visibility and swappability

Visible engine choice is useful.
A giant “engine rack” philosophy is not.

Keep the useful parts:

- what engine made this
- what backend is active
- can I compare two engines
- can I swap engines without losing context

Do not make musicians manage an AI infrastructure dashboard unless it directly improves results.

## B. Lightweight goal attachment

There is value in attaching a request like:

- make this chorus wider
- tighten this groove
- keep this melody singable
- darken this pad without losing attack

But this must feel like practical annotation plus actionable tooling, not a formal ontology of creativity.

Keep it lightweight, local, and optional.

## C. Passive decision memory

Some decisions are worth preserving:

- why a chorus variant won
- why an edit was approved
- why a client-requested version differs

This should be generated from user actions where possible, not turned into mandatory documentation.

---

# What not to overbuild

## 1. Do not turn intent into project bureaucracy

No giant object model that asks users to manage statuses, evidence references, and satisfaction scores unless there is a real payoff.

## 2. Do not make provenance a mainstream headline

Provenance can matter for export, rights, and disclosure, but it should support professional workflows quietly unless the user explicitly needs it.

## 3. Do not prioritize deep spatial architecture before the DAW wins at core production

Spatial and object workflows are real, but they are not the main reason users will adopt a new browser-native DAW.

## 4. Do not drown the product in side panels

Every panel must earn its existence by accelerating real work, not by making the system sound advanced.

## 5. Do not let metadata outrun immediacy

A DAW should feel fast, tactile, and musical.
The semantic layer must serve that, not compete with it.

---

# Recommended build order

## Phase 1 — The real differentiators

Build first:

- variation-native clips and branches
- runtime transparency
- trust modes for AI
- capture inbox
- browser/desktop project continuity
- capability-based fallback explanations

## Phase 2 — Musical depth

Then build:

- unified performance expression model
- per-note portability
- instrument semantics discovery
- richer compare and merge workflows

## Phase 3 — Support systems

Then add:

- lightweight goal attachment
- passive decision memory
- export-oriented provenance
- selective engine comparison

---

# Success criteria

Sourdaw is on the right path when it can do all of the following cleanly:

1. Let users create and manage alternates without duplicate-track mess
2. Preserve expressive performance meaning across edits and target changes
3. Capture rough ideas and notes directly inside the session
4. Keep AI actions explicit, reversible, and branch-friendly
5. Tell users exactly what render path and quality tier they are hearing
6. Adapt gracefully between browser and desktop without project drift
7. Explain feature availability and fallback behavior clearly
8. Discover richer instrument behavior when available without depending on it
9. Stay fast and musical even with all of the above in play

---

# Final product statement

Sourdaw should be built as:

**a branch-native, expression-preserving, local-first DAW that keeps ideas, alternates, and execution state visible and under the user’s control**

That is the real future-facing product.

Not a theory of music software.

A better instrument for making records.
