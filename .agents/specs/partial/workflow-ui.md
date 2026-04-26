# Workflow UI — Advanced Features

## Context

Sourdaw has a mature foundation: arrangement timeline with clip editing (split, glue, trim, crossfade, fade, warp, loop), a 6-tool editing system (select/cut/draw/automation/stretch/marquee), a comping/take-lane system with group comping, VCA group assignments (each `Track` can reference a `VcaGroup` via `vcaGroupId`; group gain is folded into each assigned track's effective engine gain via `applyVcaGains`), freeze/bounce, a macro recorder, mixer snapshots, tempo maps with interpolation, markers/sections, a punch/loop recording system, follow actions, track alternatives, a scratch pad, and a comprehensive snap grid (16 options including triplets and dotted values).

**Note on VCA:** What currently exists is a VCA _group_ assignment mechanism applied to regular tracks. A distinct **VCA fader track** type (a channel strip that controls the gain of assigned tracks _without audio passing through it_, with explicit post-fader send scaling) does not exist in the codebase — `TrackKind` is limited to `'audio' | 'midi' | 'bus' | 'master' | 'folder'`. Section K below specifies this missing capability.

The MIDI editor supports: note CRUD, move/resize/draw/paint/lasso/rubber-band, step input, chord stamping, strum, ghost notes, arpeggiator, groove extraction/application, and transforms (quantize, transpose, humanize, scale velocities, invert, retrograde). Velocity, pressure, pitch bend, slide, and probability lanes exist. Pattern instances provide linked/pooled clips.

Despite this depth, the following capability gaps remain. This spec translates the consolidated workflow & UI research (`.agents/research/features/workflow-ui.md`) into verifiable requirements for the missing layers, plus essential MIDI editor workflow interactions and DAW power-user patterns that every professional DAW ships.

**Related specs (do not duplicate):**

- `../consolidated/implementation-gaps.md` — DSP internals, Factory Suite instruments, collaboration, plugin hosting, composition standards, immersive audio
- `../ui/design-system.md` — visual design system, component specs, CSS techniques

---

## Goal

After implementation, Sourdaw adds: professional MIDI editor interactions (Alt+drag duplicate, legato, velocity ramping, split/join, quick-swap tools, multi-clip editing, slip editing), modulation halos on knobs, professional spectrum analysis/spectrogram via WebGPU, simultaneous session+arrangement views, ripple insert/move (delete already exists), AI ghost clips, WebGPU-accelerated automation rendering, a procedural modulation routing system, intelligent sample library with analysis/embeddings/similarity search/2D maps/drag-out, expanded clip alias overrides and variation lanes, deep per-note MPE expression editing, VCA fader tracks as a distinct mixer track type (no audio through the strip, post-fader sends scaled by VCA gain), and a hardware controller profile/scripting ecosystem.

---

## User-visible behavior

### A. MIDI Editor — Professional Interactions

The piano roll currently supports basic note operations but lacks the muscle-memory interactions that define a professional MIDI editing workflow.

#### A1. Alt+Drag to Duplicate Notes

Hold Alt (Option on macOS), then drag selected notes. Instead of moving, the original notes remain in place and a copy is created at the drop position. The copies become the new selection. Snaps to grid. Undo creates a single entry ("Duplicate N notes"). If Alt+drag starts on an unselected note, that note is first selected (same as current move behavior), then the selection is duplicated. Alt+drag on empty space remains rubber-band selection (existing behavior preserved). This is the single most expected MIDI editing shortcut in any DAW.

#### A2. Ctrl/Cmd+D — Duplicate Selection Forward

Duplicates the current note selection, placing copies immediately after the last note in the selection (offset by the selection's total time span). Repeated presses stack duplicates sequentially. If no notes are selected, duplicates the entire clip content.

#### A3. Quick-Swap Tool (Hold to Temporarily Switch)

**Note: this is a workspace-level feature affecting both arrangement and piano roll contexts, listed here because it most impacts MIDI editing flow.**

Holding a tool shortcut key (S, C, D, T, E) temporarily activates that tool; releasing returns to the previous tool. Example: while in Select mode, hold D to draw a note, release to return to Select. This eliminates constant tool switching. The existing tool shortcuts (S/C/D/T/E) currently require a press-to-toggle; this adds a hold-to-temporary-swap behavior (press-and-release within 300ms = permanent switch; hold beyond 300ms = temporary swap).

#### A4. Legato — Extend Notes to Next

Select notes, press L (or context menu "Legato"). Each selected note's duration extends (or contracts) so its end meets the start of the next note on the same pitch. If no subsequent note exists on that pitch, the note extends to the next note on any pitch in the selection. Eliminates gaps between notes without overlap.

#### A5. Note Split at Cursor

With notes selected, press Shift+S (or context menu "Split at Cursor"). Each selected note that spans the playhead position is split into two notes at that beat. Both halves retain the original velocity and expression data. If no selected note spans the cursor, no action. (Shift+S chosen over Alt+S to avoid conflict with the global 'S' tool shortcut; Shift+key is free in the piano roll's keyDown handler for alphabetic keys.)

#### A6. Join / Glue Selected Notes

Select two or more adjacent notes on the same pitch, press J (or context menu "Join"). Merges them into a single note spanning the first note's start to the last note's end. Velocity takes the first note's value. If selected notes are non-adjacent or on different pitches, only pitch-matched adjacent groups are joined.

#### A7. Velocity Ramp Across Selection

Select multiple notes. In the velocity lane, hold Shift and drag to draw a linear ramp from the first selected note's velocity to the target velocity at the drag endpoint. All notes in between are interpolated linearly. Allows quick crescendo/decrescendo shaping without the context menu.

#### A8. Velocity Drawing with Pencil (Continuous)

When the velocity lane is visible, clicking and dragging in a continuous motion paints velocity values onto all notes under the cursor's path. The existing `NotePropertyLane` supports clicking individual velocity bars to set discrete values; this adds continuous drag-through painting where the cursor trajectory defines the velocity curve across multiple notes in a single gesture — essential for drawing crescendo/decrescendo shapes freehand.

#### A9. Multi-Clip Editing

Open multiple MIDI clips simultaneously in a single piano roll view. Notes from each clip are color-coded by their source clip. Edits apply to whichever clip owns the note being manipulated. A clip selector in the toolbar controls which clip receives newly drawn notes. Notes from non-focused clips render semi-transparently and are directly editable (click to select, drag to move, etc.) — distinct from the existing "Ghost Notes" toggle which shows read-only preview notes from adjacent clips. Both systems can be active simultaneously: ghost notes remain read-only references; multi-clip notes are fully interactive.

#### A10. Slip Editing (Move Content Within Clip Boundaries)

Hold Ctrl/Cmd+Shift and drag inside a clip in the arrangement to slide the clip's internal content (MIDI notes or audio waveform) earlier or later without moving the clip boundaries. The clip start/end stays fixed; the content inside shifts. For audio clips, this adjusts the existing `audioOffsetBeats` field (non-destructive). For MIDI clips, a new `midiOffsetBeats` field on the clip model stores the offset (non-destructive — note `startBeat` values are not mutated; the offset is applied at render and playback time). Undo label: "Slip clip content".

#### A11. In-Place MIDI Editing

Toggle an inline piano roll directly in the arrangement timeline (no separate editor window needed). Notes render inside the clip region on the arrangement, scaled to the track's height. Basic editing (select, move, draw, delete) works directly. Double-click to expand into the full piano roll editor. This is the Ableton/Bitwig pattern of seeing notes directly on the arrangement.

#### A12. Constrain to Scale

When a scale is selected in the piano roll toolbar (scale selector already exists), a "Constrain" toggle locks all note input and movement to scale degrees only. Moving a note up/down skips non-scale pitches. Drawing notes only places on scale degrees. This differs from the existing "Fold to Scale" which hides non-scale rows — Constrain works with the full keyboard visible but snaps pitches.

#### A13. Note Preview on Hover

When hovering over a note in the piano roll (without clicking), after a 200ms delay, play a short audition of that note's pitch at its velocity through the track's instrument. The existing `playAuditionNote` on mouse-down is the mechanism — extend it to hover with a debounce. Configurable in preferences (on/off).

### B. Arrangement — Professional Clip Interactions

#### B1. Alt+Drag to Duplicate Clips

Hold Alt and drag a selected clip (or clip selection) to duplicate instead of move — identical to Alt+drag for notes (A1). The original clip stays; copies land at the drop position. Single undo entry. If Alt+drag starts on an unselected clip, that clip is first selected (same as current move behavior), then duplicated. Alt+drag on empty space remains rubber-band selection (existing behavior preserved).

#### B2. Ctrl/Cmd+D — Duplicate Clips Forward

Duplicates selected clips, placing copies immediately after the selection (offset by the selection's time span). Repeated presses stack. If no clips are selected, the command is a no-op (unlike A2 which duplicates entire clip content — at the arrangement level, duplicating "everything" is too destructive to be a default).

#### B3. Ripple Insert and Ripple Move

Ripple delete already exists (`rippleDelete/`). Add:

- **Ripple insert**: pasting or drawing a clip in ripple mode pushes subsequent clips forward by the inserted clip's duration.
- **Ripple move**: moving a clip in ripple mode adjusts subsequent clips to fill the gap at the source and make room at the destination.
- Both respect the existing per-track vs all-tracks ripple toggle.

#### B4. Time Selection (Range Selection)

A time range selection tool (or Shift+click on the beat ruler) that selects a time span across all or specific tracks — independent of clip boundaries. Operations on the time selection: delete (with ripple), insert silence, duplicate range, bounce range to new clip, set loop from selection, export range.

#### B5. Loop Selection — Set Loop from Selection

Select clips or a time range, press Ctrl/Cmd+L. The transport loop region snaps to the selection's start/end beats. If a time range (B4) is active, use that range. If clips are selected, use the earliest start to the latest end.

#### B6. Scrub Playback

Click-and-hold then drag on the beat ruler to scrub the playhead position with audio preview. This extends the existing click-to-seek behavior (single click still seeks without scrub). Dragging speed controls playback speed (1:1 ratio). Release stops scrub. The transport does not enter play mode — this is a preview-only interaction. Differentiation: click-and-release = seek (existing); click-and-drag = scrub (new).

### C. Visualization

#### C1. Modulation Halos (Bitwig-style)

Colored arcs around knobs showing modulation range. Real-time animation showing current value at 30fps. Color-coded by modulation source using oklch color system (`colorPresets.ts`). Implementation: CSS `conic-gradient` with `--mod-amount` CSS custom property updated from JS. GPU-composited by browser — no Canvas or WebGPU needed for these scattered DOM elements.

**Live preview**: hovering a modulation source over an unconnected target auditions the modulation range before the connection is committed. Vital synth's hover-to-audition pattern.

#### C2. Spectrum Analyzer (FabFilter Pro-Q style)

Real-time FFT display with:

- Configurable resolution (FFT window size)
- Perceptual tilt (frequency weighting curve)
- Adjustable release speed (hold/decay of peaks)
- 60fps rendering via WebGPU — FFT data uploaded as `Float32Array` to GPU storage buffer each frame
- **Spectrum Grab**: hover to freeze the current spectrum for inspection
- **Collision detection**: overlapping frequency ranges across multiple tracks are visually highlighted
- Reuses existing `spectrumMath.ts` FFT utilities for data preparation
- Consolidates the three existing `SpectrumAnalyzer.tsx` implementations (Fermenter, Workspace, Bacteria) into a single shared WebGPU-backed component

#### C3. Spectrogram (Waterfall / iZotope RX style)

Frequency on Y-axis, time on X-axis, amplitude as heatmap color. WebGPU-rendered, sharing the same GPU pipeline as the spectrum analyzer (C2). Supports waveform + spectrogram composite overlay mode.

### D. Layout

#### D1. Session + Arrangement Side-by-Side

Both session view clip launcher and arrangement timeline are simultaneously visible (no tab-switching — unlike Ableton). The existing `SessionView.tsx` (SCENE_COUNT=8, per-track clip slots) appears as a vertical panel alongside the arrangement timeline. Resizable split. Both share the same transport and track model.

### E. AI Integration

#### E1. Ghost MIDI Clips

AI-generated MIDI clips appear as semi-transparent, dashed-border elements with a blue/purple tint — visually distinct from committed clips. Follows the GitHub Copilot ghost-text pattern applied to the timeline.

**Controls:**

- Accept: Tab or click on the ghost clip
- Dismiss: Escape
- Cycle alternatives: Alt+] (next) / Alt+[ (previous)
- In-progress generation: animated shimmer/pulse on the ghost clip area

Ghost MIDI clips are ephemeral — they exist only in the UI layer, never in the project model, until explicitly accepted. Acceptance converts them into a normal committed clip.

#### E2. Ghost Audio Clips

AI-generated audio suggestions (e.g., a generated drum loop, a rendered sung vocal, a re-voiced source) appear on audio tracks as semi-transparent, dashed-border regions with the waveform drawn in reduced contrast (desaturated or lower-alpha stroke). They follow E1's visual language and control grammar, extended for audio.

**Controls:**

- Audition: pressing Space (or clicking a dedicated "preview" affordance on the ghost) plays the ghost buffer in-place through the track's full processing chain (inserts, sends, bus) so the user hears the suggestion as it would sound committed. Stopping transport stops the audition. Auditioning does not mutate the project model.
- Accept: Tab or click on the ghost clip — materializes into a committed audio clip. The underlying rendered buffer is written to project sample storage (same path as bounce/freeze output), and the clip receives a normal `sampleId` / `audioOffsetBeats` reference.
- Dismiss: Escape — discards the ghost buffer and releases the decoded memory.
- Cycle alternatives: Alt+] / Alt+[ — same pattern as E1. Alternatives are kept as distinct pre-decoded buffers until one is accepted or the user leaves the suggestion scope.

**Provenance metadata:** Each ghost audio clip carries read-only metadata: generating model identifier + version, prompt / structured input, generation timestamp, and generation seed. Accepting copies these fields onto the committed clip (new `aiProvenance?: AiProvenance` field on the Clip model), so the project retains the origin of generated audio for later recall and re-generation. Dismissing discards the metadata along with the buffer.

Ghost audio clips are UI-layer only until accepted (same invariant as E1) — they never appear in project-model serialization, render output, or undo history until acceptance.

#### E3. Ghost Automation Overlays

AI-suggested automation curves (e.g., the volume riding suggestion produced by R-F3.2, dynamics smoothing, side-chain response, loudness correction) render translucent on the target automation lane, distinct from committed automation in both opacity and stroke weight. The existing committed curve remains drawn at full opacity underneath; the ghost curve is drawn at reduced opacity (≈40%) above it. The same blue/purple ghost tint used in E1 is applied to distinguish the suggestion from a user-drawn curve.

**Controls:**

- Diff view toggle: a per-lane toggle reveals a color-coded delta between the committed and suggested curves (e.g., green fill where the ghost is above the committed value, red fill where below). The delta layer is additive — it does not replace either curve's rendering.
- Accept (whole): Tab or click the ghost overlay — replaces the committed segment in the ghost's time range with the suggested curve in a single undoable operation labelled "Accept automation suggestion".
- Partial accept: when a time range is active (R-B4), Tab accepts only the intersection of the ghost and the time range; the remainder of the ghost is discarded.
- Dismiss: Escape — discards the ghost overlay entirely.

Ghost automation overlays are UI-layer only until accepted (same invariant as E1) — they do not appear in render output or in automation lane serialization. This section makes the ghost-automation surface a first-class capability; R-F3.2 is the producer that emits suggestions into this surface.

#### E4. Ghost Routing / Send Suggestions — Deferred

AI-suggested routing changes (send destinations, send levels, bus assignments) are **out of scope for v1**. A non-destructive preview of routing requires a shadow routing graph at the engine level — the audio must actually be routed through the suggested topology for the preview to be meaningful. This is a substantially larger engine change than ghost clips or ghost automation (both of which are purely data overlays), and the workflow payoff at this stage is unclear. Revisit once E1–E3 ship and user demand surfaces.

#### E5. Hybrid Deployment — Web tier vs Rust tier

Every AI feature in this spec targets a specific execution tier. The tier is a design-time property of the feature, not a runtime toggle, and is chosen per the following rule: interactive / real-time feedback runs in the browser Web tier; offline / heavy / quality-focused processing runs in the Rust tier via Tauri commands. Mixed features (e.g., quick preview in the Web tier, final render in the Rust tier) explicitly name both paths.

Tier assignments for features referenced in this spec:

- **Web tier (in-browser):** ghost clip UI state and interactions (E1, E2, E3), modulation halos (C1), spectrum analyzer and spectrogram (C2, C3), WebGPU automation canvas (F1), modulator graph (F2), automation comping UI (F3.1), cross-track linking (F3.3), sample library musical analysis when run interactively (G1 — via Web Workers), embedding search and 2D map (G2, G3), drag-out adapters (G4), MPE editing (I), hardware controller scripts (J).
- **Rust tier (Tauri):** offline / batch variants of sample analysis (G1 fallback on very large libraries), heavy ML audio generation used to produce ghost audio buffers for E2 (e.g., DiffSinger, ACE-Step — see `audio-generation.md`), heavy embedding model inference when the Web runtime cannot host the model, and the eventual batch volume-riding analyzer referenced by F3.2.
- **Mixed:** R-F3.2 AI volume riding — the analyzer may run in either tier depending on project size; the ghost automation surface (E3) is identical.

Features not listed above default to the Web tier. Any feature added later that runs on the Rust tier must document the tier choice in its spec and cite the reason (model size, latency target, CPU / memory pressure).

### F. Automation

#### F1. WebGPU Unified Timeline Rendering

A single WebGPU canvas overlays the entire timeline area, rendering all automation curves, waveforms, fills, and nodes. This replaces the current per-lane Canvas 2D / `GlutenCurve` rendering for performance at scale.

**Architecture:**

- React manages DOM elements (lane headers, controls, labels, menus) via virtualized scrolling
- The WebGPU renderer is fully decoupled from React's rendering cycle — reads from a vanilla store
- Extends the existing `createWebGpuRenderer.ts` pattern (WGSL shaders, vertex attributes, batch rendering, `MAX_RECTS = 32768` budget)

**Curve rendering pipeline:** Tessellated line strips with MSAA 4x. Bezier/curved segments subdivided into short line segments on CPU, expanded into screen-aligned quads on GPU.

**Fallback:** `GlutenCurve` / Canvas 2D path remains functional when WebGPU is unavailable. The existing renderer is the fallback, not a removed path.

#### F2. Procedural Modulation System (Bitwig-style)

LFO, envelope, and step sequencer modulator types, each connectable to any automatable parameter. Modulators are first-class objects in the project model (persisted, undoable). Follows the existing `ModulationLFO.tsx` and `CCGenerator.ts` patterns.

Modulator output feeds into modulation halos (C1) for visual feedback. Connected to the existing automation 3-layer architecture (track absolute, clip relative, automation objects).

#### F3. Automation Power Features

- **Automation comping**: Record multiple automation passes (extends the existing take-lane/comping infrastructure — `TakeLane`, `CompRegion` — to automation lanes, not just audio/MIDI clips), then comp the best sections.
- **AI-assisted volume riding**: Analyze audio dynamics (via `AudioAnalysis` module) and suggest automation curves to maintain a target perceived loudness. Suggestions appear as ghost automation (similar to ghost clips, E1).
- **Cross-track automation linking**: Define mathematical relationships (offset, scale, invert, custom expression) between parameters on different tracks. When the source parameter changes, linked targets update according to the relationship.

### G. Intelligent Sample Library

The existing `SampleLibrary/` module provides local-first file scanning, IndexedDB persistence, `FileProvider` abstraction (browser/Tauri), `SampleRecord` metadata (format, tags, favorites), and folder tree UI. The following intelligence layers are missing.

#### G1. Musical Analysis (Stage 3)

All analysis runs asynchronously in Web Workers — never blocks the UI thread. Results stored as optional fields on `SampleRecord`.

- **BPM detection**: Onset-envelope and autocorrelation or tempogram-style analysis.
- **Key detection**: Chroma-based pitch-class analysis with tonal-window filtering.
- **Descriptor extraction**: Spectral centroid, spectral flatness, spectral crest, RMS/loudness proxy, transient density, inharmonicity estimate.

#### G2. Embedding & Semantic Search

- Pluggable embedding model via `interface EmbeddingModel`. Recommended families: CLAP-style multimodal, OpenL3-style perceptual. Treat as hot-swappable — the search/map infrastructure is model-agnostic.
- Each sample maps to a vector representation. Full-precision vectors stored in OPFS (browser) or desktop cache (Tauri).
- ANN search via HNSW index stored separately from vectors. Sub-100ms query latency for libraries up to 100k samples.
- **"Find similar sound"** action on any sample or preset — returns ranked results by embedding distance.

#### G3. 2D Spatial Map

UMAP dimensionality reduction from embedding vectors to 2D coordinates. GPU-backed rendering (WebGPU if available) for point clouds up to 100k samples. Pre-computed map coordinates stored in sample metadata for instant rendering (no recomputation on open). Interactive: pan, zoom, select, audition samples directly from the map. Users browse by **timbral proximity** — nearby points sound similar.

#### G4. DAW Drag-Out & Auditioning

- Drag samples from library browser into timeline or sampler via HTML5 drag (browser) or native file promise (desktop: Windows virtual file transfer, macOS file promise providers).
- Adapter layer via `interface DragOutProvider` supporting rendered variants: tempo-cropped, pitch-shifted, or normalized.
- **Contextual auditioning**: drag-anything-anywhere with perfect tempo/key sync preview before dropping. The audition engine time-stretches and pitch-shifts the sample in real time to match the project tempo/key.
- **Smart collections & auto-tagging**: AI-driven categorization (kick, snare, dark, atmospheric, pad, lead, etc.) upon import. Tags stored in `SampleRecord.tags`.
- **Intelligence surfacing**: "Recently used" and "last-used chain" intelligent ranking in browser results.

### H. Clip Aliases & Pattern References

The existing `patternInstance/` system (linked/pooled MIDI clips with `propagateParentChanges`) and `AutomationObject.poolId` provide the foundation. Missing:

#### H1. Automation Clips as Reusable Objects

Automation clips become first-class reusable objects — drag an automation shape onto any lane, link instances via the existing `poolId` pattern. Edits to the source propagate to all instances.

#### H2. Per-Instance Overrides

Instances of a shared clip (MIDI or automation) can override specific properties (individual note velocities, specific automation points, transposition) while remaining linked to the source for all other changes. Override tracking extends the existing `patternInstance` propagation — overridden fields skip propagation; non-overridden fields continue to sync. "Reset override" reverts a field to the parent value.

#### H3. Variation Lanes

Dedicated lanes within a track for choruses, fills, alt endings, and other variations. Selectable per playback pass or scene. Extends the existing `TrackAlternative` system (which already stores alternatives per track with `activeAlternativeId`) — variation lanes make alternatives visible and switchable in the timeline UI, not just the track header.

#### H4. Groove Templates

Apply quantization/swing groove templates at project-wide or clip-local scope. The existing `grooveExtraction/` system extracts grooves; this adds: a groove template library (built-in presets + user-saved), a groove intensity slider (0–100%), and groove application as a non-destructive overlay (removable, not baked into note positions).

### I. MPE Expression Editing

The existing `Levain/ExpressionPanel.tsx` provides per-clip CC1/CC11 expression editing with dynamics curves. `MidiNote` already carries `pressure`, `slide`, and `pitchBend` fields. The following per-note expression depth is missing.

#### I1. Note Expression Lanes

Dedicated lanes attached to individual note objects (not per-clip) for: pitch bend, timbre (CC74), pressure (aftertouch), and release velocity. Each lane shows only the expression data for the selected note(s). When multiple notes are selected, lanes show overlaid curves.

#### I2. Per-Note Transforms

Random, spread, and humanize operations applied at the note-expression level (not just note timing/velocity). Example: humanize pressure curves across selected notes to add natural variation.

#### I3. Modulation Recording

Record physical controller movements (mod wheel, expression pedal, breath controller) directly into note-bound expression data — not just clip-level CC lanes. The recording maps controller input to the currently focused expression dimension of selected notes.

#### I4. MPE Density Management

Visualization strategy for dense MPE data: collapse or dim expression overlays in the main piano roll to prevent clutter. Expand-on-hover reveals expression detail for individual notes. A dedicated "Expression View" mode shows full per-note lanes below the piano roll (similar to the existing VelocityLane/PressureLane/SlideLane/PitchBendLane pattern, but per-note instead of per-clip).

### J. Hardware Controller Ecosystem

The existing `MidiDevicePicker.tsx` (Web MIDI device selection), `midiLearnStore` (MIDI Learn), and `MidiSection.tsx` (MIDI preferences) provide the base layer. Missing:

#### J1. Controller Profiles

Auto-detection of connected MIDI controllers with visual mapping overlays for popular hardware (Ableton Push, Novation Launchpad, Arturia KeyStep, etc.). When a known controller connects, its profile loads automatically, mapping pads/knobs/faders to DAW functions without manual MIDI Learn.

#### J2. Open Scripting Layer

JavaScript/TypeScript API allowing third-party controller scripts to: register parameter mappings, respond to MIDI/OSC input, control DAW parameters, update LED/display feedback, and define custom modes. Scripts execute in a sandboxed Web Worker with a restricted API surface (no filesystem, no network — only DAW parameter read/write and MIDI I/O).

#### J3. Shared Mappings

Import/export system for custom device/macro mappings as a portable JSON format. Users can share controller configurations. Client-side only — distribution infrastructure (marketplace, server) is out of scope.

### K. VCA Fader Tracks

The codebase exposes VCA as a group-assignment mechanism: tracks carry `vcaGroupId`, and `applyVcaGains` multiplies a group's gain into each assigned track's effective engine gain. It does **not** provide a distinct VCA fader track type with its own channel strip, and there is no logic that distinguishes how post-fader sends should behave when a VCA gain is applied (sends currently read from the already-multiplied effective gain, which is incorrect for a true VCA).

This section adds VCA fader tracks as a first-class track type — the professional mixer convention where a single fader remote-controls the level of many channels without audio flowing through the VCA strip itself.

#### K1. VCA Fader Track as Distinct Track Type

Add `'vca'` to `TrackKind`. A VCA track renders its own mixer channel strip with a fader, name, color, and solo/mute controls, but has no clip lane, no devices, no inputs, no audio meters, and no outputs in the audio graph. Creating a VCA track is a first-class action (project model, undo, persistence) — not a side effect of grouping. A VCA track replaces the current `VcaGroup` entity's role as the "owner" of a group (existing projects migrate: each `VcaGroup` becomes a `Track` of kind `'vca'` named after the group; `vcaGroupId` on assigned tracks continues to reference it by id).

#### K2. Audio Does Not Pass Through the VCA Strip

The VCA fader's value is a **gain multiplier** applied to each assigned track's post-fader summing point. Audio from assigned tracks routes directly to each track's configured output (bus/master) — it never enters the VCA track's signal path. The VCA track has no input node in `AudioEngine` and no meter feed. This is the structural difference from a bus/group: a bus sums audio; a VCA scales gain on other channels in-place.

#### K3. Post-Fader Send Scaling

When a track assigned to a VCA has a post-fader send, the send level must be scaled by the VCA's gain multiplier (because a physical VCA sits between the track fader and the post-fader tap). Pre-fader sends are **not** affected by VCA gain. The current `applyVcaGains` path pre-multiplies the track's engine gain, which happens to scale post-fader sends as a side effect on a single track, but it does not model pre-fader sends correctly and cannot be inspected/overridden independently. The new implementation must compute the VCA multiplier explicitly at the send-level routing stage, not by mutating the track's base gain.

#### K4. Mute / Solo Semantics

Muting a VCA track mutes all assigned tracks (audibly silent, but assigned tracks remain individually un-muted in the model). Soloing a VCA track solos all assigned tracks. Un-assigning a track from a muted VCA restores the track's audible state without toggling its own mute flag.

#### K5. Assignment UI

Regular tracks expose a "VCA" selector (already present in `TrackVcaSection.tsx`) that lists available VCA tracks by name. Selecting a VCA track sets `vcaGroupId` to that track's id. A VCA track's inspector shows the list of tracks currently assigned to it (read-only; assignment is initiated from the assigned track's side for consistency with existing UI patterns).

#### K6. No Meters, No Clip Lane, No Devices

The VCA channel strip explicitly hides: peak/RMS meters, clip lane in the arrangement timeline, device slots, input/output selectors, and send list. It shows: name, color, level fader with dB readout, mute, solo, and the list of assigned tracks.

---

## Scope

### In scope:

- All features listed in User-visible behavior above (A1–K6, including ghost-preview AI surfaces E1–E3 and the hybrid-tier decision E5)
- MIDI editor interaction model (keyboard/mouse gestures, modifier keys, tool behaviors)
- WebGPU rendering architecture for automation and spectrum visualization
- Data architecture for sample analysis, embeddings, and vector search
- Interaction model for ghost clips, modulation halos, and drag-out
- Controller profile detection and scripting API surface

### Non-goals (explicitly out of scope):

- Visual design tokens, surface colors, typography, CSS techniques (covered by `../ui/design-system.md`)
- DSP implementation details for filters, oscillators, envelopes (covered by `../consolidated/implementation-gaps.md`)
- Factory Suite instruments (separate specs exist)
- Collaboration features (covered by `../consolidated/implementation-gaps.md`)
- Plugin hosting / CLAP migration (covered by `../consolidated/implementation-gaps.md`)
- Immersive audio / Dolby Atmos (covered by `../consolidated/implementation-gaps.md`)
- Specific ML model training or dataset creation for embeddings
- Server-side infrastructure for shared mappings distribution
- AI-suggested routing / send / bus-assignment previews (explicitly deferred — see R-E4)
- A numeric trust / confidence score or ranking formula for AI suggestions (research-only — see Open questions)
- Features that already exist and work: basic note CRUD, move/resize/draw, paint mode, lasso mode, step input, chord stamping, strum, ghost notes display, arpeggiator, groove extraction, quantize/transpose/humanize/scale velocities/invert/retrograde, velocity/pressure/pitchBend/slide/probability lanes, clip split/glue/trim/crossfade/fade/warp/loop, comping/take-lanes/group comping/flatten, VCA group assignments on regular tracks (but **not** a VCA fader track type — see §K), freeze/bounce, macro recorder, mixer snapshots, tempo maps, markers/sections, punch/loop recording, follow actions, track alternatives, scratch pad, ripple delete, the 6-tool editing system

---

## Phasing / release gates

This spec covers 11 feature areas. They are **not** implemented as one unit — each phase below is an independently releasable slice with its own binding requirement set and verifiable completion gate. A phase is not "done" until every listed requirement's acceptance criteria pass and the phase-level exit gate is satisfied. Phases may be worked on in parallel across branches, but a phase merges to main only when its own gate passes.

The requirement ids below (R-X#) are the authoritative binding between a phase and its scope. Anything not listed in a phase's scope is explicitly deferred.

### Phase 1 — Core editing interactions

**Scope:** R-A1, R-A2, R-A3, R-A4, R-A5, R-A6, R-A7, R-A8, R-B1, R-B2, R-B3.1, R-B3.2, R-B3.3.
**Exit gate:** AC-A1 through AC-A8 and AC-B1 through AC-B3 all pass; AC-Z1, AC-Z2, AC-Z3, AC-Z4 pass; no new keyboard shortcut conflict regressions in the existing shortcut test suite.

### Phase 2 — Advanced editing

**Scope:** R-A9, R-A10, R-A11, R-A12, R-A13, R-B4, R-B5, R-B6.
**Exit gate:** AC-A9 through AC-A13 and AC-B4 through AC-B6 all pass; `midiOffsetBeats` round-trips through project save/load without data loss.

### Phase 3 — WebGPU visualization foundation

**Scope:** R-C1.1, R-C1.2, R-C1.3, R-C1.4, R-C2.1, R-C2.2, R-C2.3, R-C2.4, R-C2.5, R-C3.1, R-F1.1, R-F1.2, R-F1.3, R-F1.4, R-F1.5, R-F1.6.
**Exit gate:** AC-C1, AC-C2, AC-C2b, AC-C3, AC-F1 all pass at their numeric performance thresholds on the reference machine; the WebGPU-disabled fallback path passes an integration test that renders all lanes in Canvas 2D.

### Phase 4 — Modulation & automation power

**Scope:** R-F2.1, R-F2.2, R-F2.3, R-F3.1, R-F3.2, R-F3.3.
**Exit gate:** AC-F2, AC-F3a, AC-F3b, AC-F3c pass; modulator output is observable in a modulation halo (AC-C1 link) end-to-end in one integration test.

### Phase 5 — Sample intelligence

**Scope:** R-G1.1, R-G1.2, R-G1.3, R-G2.1, R-G2.2, R-G2.3, R-G2.4, R-G3.1, R-G3.2, R-G4.1, R-G4.2, R-G4.3, R-G4.4, R-G4.5.
**Exit gate:** AC-G1, AC-G2, AC-G3, AC-G4 all pass at their numeric thresholds (main-thread long-task count 0, p95 query <100 ms, top-10 precision ≥ 0.8, map ≥30 fps).

### Phase 6 — Clip aliases & MPE

**Scope:** R-H1, R-H2, R-H3, R-H4, R-I1, R-I2, R-I3, R-I4.
**Exit gate:** AC-H1 through AC-H4 and AC-I1 through AC-I4 all pass; per-instance override field set is documented in the module's README or spec.

### Phase 7 — Layout & AI

**Scope:** R-D1.1, R-D1.2, R-E1.1, R-E1.2, R-E1.3, R-E1.4, R-E1.5, R-E2.1, R-E2.2, R-E2.3, R-E2.4, R-E3.1, R-E3.2, R-E3.3, R-E4, R-E5.
**Exit gate:** AC-D1, AC-E1, AC-E2, AC-E3, AC-E4, AC-E5 all pass; ghost-clip, ghost-audio, and ghost-automation state is confirmed to be purely UI-layer (searches for ghost-clip, ghost-audio, and ghost-automation state in project-model and automation-lane serializers all return no hits); each AI feature targeted by this phase has its execution tier recorded per R-E5.

### Phase 8 — Hardware controllers

**Scope:** R-J1, R-J2, R-J3.
**Exit gate:** AC-J1, AC-J2, AC-J3 pass; controller-script Worker sandbox rejects filesystem/network API calls in a security test.

### Phase 9 — VCA fader tracks

**Scope:** R-K1, R-K2, R-K3, R-K4, R-K5, R-K6.
**Exit gate:** AC-K1 through AC-K6 pass; migration from a legacy project containing `VcaGroup` entries is idempotent and reversible (re-saving does not modify the resulting project tree again).

### Cross-cutting gates (apply to every phase)

- `pnpm deps:validate` passes with zero violations.
- `pnpm typecheck` passes with no errors.
- Every new interaction introduced in the phase has an undo entry with a descriptive label.
- No new keyboard shortcut introduced by the phase conflicts with shortcuts already in use (verified by shortcut registry check).

### Sequencing constraints

- Phase 4 depends on Phase 3 (modulation halos require the CSS halo primitive introduced in R-C1).
- Phase 5's map rendering (R-G3.1) depends on Phase 3's WebGPU infrastructure (`createWebGpuRenderer.ts` extensions).
- Phase 9 is independent of all other phases and may ship first.
- All other phases may interleave.

---

## Requirements

### MIDI Editor — Professional Interactions

1. **R-A1** — Alt+drag (Option+drag on macOS) on selected notes in the piano roll duplicates the selection at the drop position. Original notes remain. Copies become the new selection. Snaps to grid. Single undo entry. Alt+drag on unselected note = select then duplicate. Alt+drag on empty = rubber band (preserved).
2. **R-A2** — Ctrl/Cmd+D duplicates the note selection forward, offset by the selection's time span. Repeated presses stack. No selection = duplicates entire clip content.
3. **R-A3** — Holding a tool shortcut key (S/C/D/T/E) beyond 300ms temporarily activates that tool; releasing returns to the previous tool. Press-and-release within 300ms = permanent switch (current behavior preserved).
4. **R-A4** — Legato command (L key or context menu): each selected note's duration extends/contracts so its end meets the start of the next note on the same pitch. Fallback: next note on any pitch in selection.
5. **R-A5** — Split at cursor (Shift+S or context menu): selected notes spanning the playhead are split into two notes at that beat. Both halves retain velocity and expression data.
6. **R-A6** — Join (J key or context menu): adjacent selected notes on the same pitch merge into a single note. Non-adjacent or different-pitch notes are unaffected.
7. **R-A7** — Velocity ramp: in the velocity lane, Shift+drag draws a linear ramp across the time range. All notes in range are interpolated linearly between the start and end velocity values.
8. **R-A8** — Velocity painting: continuous drag-through in the velocity lane paints velocity values onto all notes under the cursor's path in a single gesture (extends existing click-to-set with freehand painting).
9. **R-A9** — Multi-clip editing: multiple MIDI clips can be open simultaneously in one piano roll. Notes color-coded by source clip. A clip selector controls which clip receives new notes. Non-focused clip notes are semi-transparent and directly editable (distinct from existing read-only "Ghost Notes" feature).
10. **R-A10** — Slip editing: Ctrl/Cmd+Shift+drag inside a clip slides internal content without moving clip boundaries. Uses `audioOffsetBeats` for audio clips; adds new `midiOffsetBeats` field for MIDI clips (non-destructive — note data unchanged, offset applied at render/playback).
11. **R-A11** — In-place MIDI editing: an inline piano roll renders notes directly inside clip regions on the arrangement timeline, scaled to track height. Basic editing (select, move, draw, delete) works inline. Double-click expands to full editor.
12. **R-A12** — Constrain to scale: when a scale is selected, a "Constrain" toggle locks all note input and movement to scale degrees. Pitches snap to the nearest scale degree. Works with full keyboard visible (unlike "Fold" which hides rows).
13. **R-A13** — Note preview on hover: after 200ms hover delay over a note, play a short audition via `playAuditionNote`. Configurable on/off in preferences.

### Arrangement — Professional Clip Interactions

14. **R-B1** — Alt+drag on selected clips in the arrangement duplicates instead of moving. Same pattern as R-A1 (Alt+drag on unselected clip = select then duplicate; Alt+drag on empty = rubber band preserved).
15. **R-B2** — Ctrl/Cmd+D duplicates selected clips forward, offset by selection timespan. No selection = no-op (unlike R-A2 which falls back to full clip content).
16. **R-B3.1** — Ripple insert: pasting or drawing a clip in ripple mode pushes subsequent clips forward by the inserted clip's duration.
17. **R-B3.2** — Ripple move: moving a clip in ripple mode closes the gap at the source and opens space at the destination.
18. **R-B3.3** — Both ripple insert and move respect the existing per-track vs all-tracks ripple toggle.
19. **R-B4** — Time selection: Shift+click on beat ruler selects a time range across tracks. Operations: delete (with ripple option), insert silence, duplicate range, bounce to new clip, set loop, export.
20. **R-B5** — Loop from selection (Ctrl/Cmd+L): sets transport loop region to the selected clips' or time range's start/end beats.
21. **R-B6** — Scrub playback: click-and-drag on the beat ruler scrubs the playhead with audio preview (extends existing click-to-seek; single click still seeks). Drag speed = playback speed. Release stops scrub. Transport does not enter play mode.

### Visualization

22. **R-C1.1** — Knobs with active modulation sources display a colored conic-gradient arc showing the modulation range, updated at 30fps via `--mod-amount` CSS custom property.
23. **R-C1.2** — Arc color determined by modulation source identity using oklch color system.
24. **R-C1.3** — GPU-composited rendering via CSS conic-gradient (no Canvas/WebGPU for halos).
25. **R-C1.4** — Hovering a modulation source over an unconnected target auditions the modulation range (live preview).
26. **R-C2.1** — Spectrum analyzer: real-time FFT at 60fps via WebGPU with configurable resolution, perceptual tilt, and adjustable release speed.
27. **R-C2.2** — FFT data uploaded as `Float32Array` to GPU storage buffer each frame.
28. **R-C2.3** — Spectrum Grab: hover to freeze the current spectrum.
29. **R-C2.4** — Collision detection: overlapping frequency ranges across tracks visually highlighted.
30. **R-C2.5** — Consolidates three existing SpectrumAnalyzer implementations into a single shared WebGPU-backed component, reusing `spectrumMath.ts`.
31. **R-C3.1** — Spectrogram: frequency/time/amplitude heatmap, WebGPU-rendered, with waveform overlay mode.

### Layout

32. **R-D1.1** — Session view and arrangement timeline simultaneously visible without tab-switching.
33. **R-D1.2** — Extends existing `SessionView.tsx`; resizable split; shared transport and track model.

### AI Integration

34. **R-E1.1** — Ghost MIDI clips render as semi-transparent, dashed-border, blue/purple-tinted elements.
35. **R-E1.2** — Accept (Tab/click), dismiss (Escape), cycle alternatives (Alt+]/[).
36. **R-E1.3** — In-progress generation shows animated shimmer/pulse.
37. **R-E1.4** — Ghost MIDI clips are UI-only until accepted; not in project model.
38. **R-E1.5** — Acceptance converts ghost MIDI clip to committed clip in the project model.
39. **R-E2.1** — Ghost audio clips render on audio tracks with the same dashed-border / semi-transparent / blue-purple-tinted visual language as ghost MIDI clips, with the waveform drawn in a desaturated or reduced-alpha stroke distinguishable from committed audio clips. In-progress generation shows the same shimmer/pulse as R-E1.3.
40. **R-E2.2** — Audition: pressing Space (or clicking a dedicated preview affordance on the ghost) plays the ghost buffer in-place through the track's full inserts / sends / bus routing without mutating the project model. Stopping transport stops the audition.
41. **R-E2.3** — Accept (Tab or click on the ghost clip) materializes the ghost into a committed audio clip: the rendered buffer is written to project sample storage via the same path used for bounce/freeze output, and the clip becomes a normal audio clip with `sampleId` / `audioOffsetBeats`. Dismiss (Escape) discards the buffer and frees memory. Cycle alternatives (Alt+] / Alt+[) cycles between distinct pre-decoded alternative buffers.
42. **R-E2.4** — Each ghost audio clip carries read-only provenance metadata: generating model identifier and version, prompt or structured input, generation timestamp, and generation seed. On accept, these fields are copied onto the committed clip via a new optional `aiProvenance` field on the Clip model. Ghost audio clips are UI-layer only until accepted — they do not appear in project-model serialization, render output, or undo history until acceptance.
43. **R-E3.1** — Ghost automation overlays render on the target automation lane at reduced opacity (≈40%) with the same blue/purple ghost tint as E1/E2. The existing committed curve remains drawn at full opacity underneath the overlay. Ghost overlays are UI-layer only until accepted — they do not appear in render output or automation lane serialization.
44. **R-E3.2** — A per-lane "diff" toggle renders a color-coded delta between the committed curve and the ghost overlay (e.g., green fill where the ghost is above the committed value, red fill where below). The delta layer is additive — it does not replace either curve's rendering.
45. **R-E3.3** — Accept (Tab or click): replaces the committed segment in the ghost's time range with the suggested curve in a single undoable operation labelled "Accept automation suggestion". When a time range (R-B4) is active, Tab accepts only the intersection of the ghost and the time range; the remainder of the ghost is discarded. Dismiss (Escape) discards the overlay entirely.
46. **R-E4** — Ghost routing / send suggestions are explicitly **out of scope for v1**. No routing, send destination, send level, or bus assignment is previewed as a ghost in this spec's scope. Any feature work producing routing changes in v1 commits directly rather than previewing. Revisit after E1–E3 ship.
47. **R-E5** — Each AI feature defined or referenced in this spec has a documented execution tier (Web, Rust, or Mixed). The tier assignments in the "Hybrid Deployment" section of User-visible behavior are binding: features listed as Web tier run in-browser (main thread or Web Worker); features listed as Rust tier run via Tauri commands / sidecar; features listed as Mixed name both paths and make the tier choice explicit at the call site. New AI features added to the codebase after this spec must declare their tier in their spec before implementation.

### Automation

48. **R-F1.1** — Single WebGPU canvas overlays entire timeline, rendering all automation curves/fills/nodes.
49. **R-F1.2** — React DOM elements (headers, controls) remain in DOM layer with virtualized scrolling.
50. **R-F1.3** — WebGPU renderer reads from vanilla store, decoupled from React rendering cycle.
51. **R-F1.4** — Curve rendering: tessellated line strips with MSAA 4x; Bezier segments subdivided on CPU, expanded to screen-aligned quads on GPU.
52. **R-F1.5** — Extends `createWebGpuRenderer.ts` pattern; minimum `MAX_RECTS = 32768` per frame.
53. **R-F1.6** — Graceful fallback to `GlutenCurve`/Canvas 2D when WebGPU unavailable.
54. **R-F2.1** — LFO, envelope, and step sequencer modulator types, connectable to any automatable parameter.
55. **R-F2.2** — Modulators are first-class project model objects (persisted, undoable).
56. **R-F2.3** — Modulator output feeds into modulation halos (R-C1) for visual feedback.
57. **R-F3.1** — Automation comping: extends existing `TakeLane`/`CompRegion` infrastructure to automation lanes.
58. **R-F3.2** — AI volume riding: suggests automation curves for target loudness via `AudioAnalysis` module. Suggestions appear as ghost automation via R-E3.
59. **R-F3.3** — Cross-track automation linking: mathematical relationships (offset, scale, invert, expression) between parameters on different tracks.

### Sample Library Intelligence

60. **R-G1.1** — BPM detection via onset-envelope/autocorrelation. Result stored in `SampleRecord` metadata. Runs in Web Worker.
61. **R-G1.2** — Key detection via chroma-based pitch-class analysis. Result stored in `SampleRecord` metadata.
62. **R-G1.3** — Descriptor extraction: spectral centroid, flatness, crest, RMS/loudness, transient density, inharmonicity. Results stored in `SampleRecord` metadata.
63. **R-G2.1** — Pluggable `interface EmbeddingModel`. At least one implementation (CLAP or OpenL3 family).
64. **R-G2.2** — HNSW ANN index with sub-100ms query latency for 100k samples. Index stored separately from vectors.
65. **R-G2.3** — Vectors stored in OPFS (browser) or desktop cache (Tauri).
66. **R-G2.4** — "Find similar sound" action on any sample/preset returns ranked results by embedding distance.
67. **R-G3.1** — UMAP 2D map with GPU-backed rendering for 100k+ point clouds.
68. **R-G3.2** — Pre-computed coordinates stored in metadata; interactive pan/zoom/select/audition.
69. **R-G4.1** — Drag-out from library to timeline/sampler: HTML5 drag (browser), native file promise (desktop).
70. **R-G4.2** — `interface DragOutProvider` supporting tempo-cropped, pitch-shifted, and normalized variants.
71. **R-G4.3** — Contextual auditioning: tempo/key sync preview before drop.
72. **R-G4.4** — Auto-tagging on import (kick, snare, dark, atmospheric, pad, lead, etc.) stored in `SampleRecord.tags`.
73. **R-G4.5** — "Recently used" and "last-used chain" intelligent ranking in browser.

### Clip Aliases & Pattern References

74. **R-H1** — Automation clips as reusable objects with `poolId` linking. Edits propagate to all instances.
75. **R-H2** — Per-instance overrides on shared clips. Overridden fields skip propagation; non-overridden fields sync. "Reset override" reverts to parent.
76. **R-H3** — Variation lanes: make existing `TrackAlternative` system visible/switchable in the timeline UI. Selectable per playback pass or scene.
77. **R-H4** — Groove template library (built-in + user-saved), intensity slider (0–100%), non-destructive application (removable overlay).

### MPE Expression Editing

78. **R-I1** — Per-note expression lanes for pitch bend, CC74 (timbre), pressure, release velocity. Show data for selected note(s); overlay when multiple selected.
79. **R-I2** — Per-note transforms: random, spread, humanize on expression data (not just timing/velocity).
80. **R-I3** — Record controller input (mod wheel, expression pedal, breath) into note-bound expression data for selected notes.
81. **R-I4** — MPE density management: collapse/dim expression overlays in piano roll. Expand-on-hover. Dedicated "Expression View" mode with full per-note lanes.

### Hardware Controller Ecosystem

82. **R-J1** — Controller profiles: auto-detect connected hardware, load mapping profile automatically.
83. **R-J2** — Scripting API: JS/TS scripts in sandboxed Web Worker. Register mappings, respond to MIDI, control parameters, update hardware feedback.
84. **R-J3** — Shared mappings: import/export as portable JSON. Client-side only.

### VCA Fader Tracks

85. **R-K1** — `TrackKind` is extended with `'vca'`. VCA tracks are created as first-class project model objects (undoable, persisted, serializable). Existing `VcaGroup` entities migrate 1:1 to VCA tracks; assigned tracks' `vcaGroupId` continues to reference the migrated track's id. The migration runs once per project load and is idempotent.
86. **R-K2** — VCA tracks have no input node, no device chain, no output routing, and no audio meters in `AudioEngine`. No audio buffer passes through a VCA track under any routing configuration.
87. **R-K3** — The effective gain for an assigned track becomes `trackGain × vcaGain` for its direct output, and `sendLevel × vcaGain` for each of its **post-fader** sends. Pre-fader sends are not scaled by VCA gain. The VCA multiplier is applied at the send-routing stage, not by mutating `Track.gain` or the track's base engine gain (i.e. `applyVcaGains` is reworked — it no longer calls `engineSetTrackGain` with a pre-multiplied value).
88. **R-K4** — Muting a VCA track silences all assigned tracks without toggling their individual `muted` flags. Soloing a VCA track solos all assigned tracks (additive with existing solo logic). Un-assigning a track from a muted VCA restores audibility immediately.
89. **R-K5** — The VCA selector in `TrackVcaSection.tsx` lists VCA tracks by name. A VCA track's inspector shows a read-only list of assigned tracks.
90. **R-K6** — The VCA channel strip renders: name, color, level fader with dB readout, mute, solo, and assigned-track list. It does **not** render: meters, clip lane, device slots, input/output selectors, send list.

---

## Constraints

- Must follow the domain-driven module architecture (`AGENTS.md`): modules as bounded contexts, cross-module imports via contract barrels only
- One function per file for useCases and repositories
- Vanilla Store (`createStore`/`useStore`) for all new cross-domain UI state
- No `useMemo`, `useCallback`, or `React.memo` — React Compiler handles memoization
- No `forwardRef` — `ref` is a regular prop in React 19
- Prefer `type` over `interface` (except for pluggable extension points: `EmbeddingModel`, `DragOutProvider`)
- TypeScript soundness: no `any` or assertion escapes without justification
- Never render with `&&` — use ternaries or early returns
- All audio-thread code: no allocation, no mutex locks, no blocking
- `pnpm deps:validate` must pass with zero violations
- WebGPU features must degrade gracefully when WebGPU is unavailable
- Sample analysis (R-G1) must run in Web Workers
- All new interactions must integrate with the existing undo system (`pushUndoEntry`) with descriptive labels
- New keyboard shortcuts must not conflict with existing shortcuts (S/C/D/B/T/E for tools, arrow keys for nudge, Delete/Backspace for delete, Ctrl+A/C/X/V for clipboard, Shift+click for add-to-selection, Alt+drag for rubber band on empty space). New shortcuts introduced by this spec: L (legato), J (join), Shift+S (split), Ctrl/Cmd+D (duplicate forward), Ctrl/Cmd+L (loop from selection), Alt+drag on note/clip (duplicate), Alt+]/[ (cycle ghost clip alternatives)
- Visual styling defers to `../ui/design-system.md` — this spec defines behavior, not appearance

---

## Design decisions

### Decision: Alt+drag for duplication vs dedicated duplicate tool

**Chosen:** Alt+drag modifier on existing move gesture.

**Considered and rejected:** A separate "duplicate" tool in the toolbar — rejected because Alt+drag is the universal DAW convention (Ableton, Logic, Cubase, FL Studio, Bitwig, Reaper all use it). A separate tool adds friction. The modifier approach is zero-UI-cost and matches muscle memory from every other DAW.

### Decision: Quick-swap tool via hold duration vs modifier key

**Chosen:** Hold duration (>300ms = temporary, <300ms = permanent switch).

**Considered and rejected:** Using a modifier key (e.g., Ctrl+S for temporary select) — rejected because modifier keys are already heavily used (Shift = add to selection, Alt = duplicate/rubber band, Ctrl/Cmd = system shortcuts). Duration-based detection reuses the existing shortcut keys without new bindings. Bitwig and Reaper both use this hold-to-swap pattern.

### Decision: WebGPU unified timeline canvas vs per-lane canvases

**Chosen:** Single WebGPU canvas overlaying the entire timeline.

**Considered and rejected:** Per-lane individual canvases — rejected because synchronizing multiple GPU contexts is wasteful and creates compositing artifacts. A single canvas with shared vertex buffer is simpler and more performant.

### Decision: CSS conic-gradient for modulation halos vs Canvas/WebGPU

**Chosen:** CSS `conic-gradient` with custom properties.

**Considered and rejected:** Canvas or WebGPU rendering — rejected because halos are per-knob DOM decorations. CSS custom properties let the modulation engine update at 30fps while the browser handles compositing natively.

### Decision: HNSW for vector search vs alternatives

**Chosen:** HNSW approximate nearest-neighbor index.

**Considered and rejected:** Brute-force (O(n) per query, too slow at 100k+), VP-trees/ball-trees (inferior recall/latency ratio at typical embedding dimensions).

### Decision: UMAP for 2D map vs t-SNE

**Chosen:** UMAP.

**Considered and rejected:** t-SNE — less global structure preservation, slower on large datasets, no incremental update support.

### Decision: In-place MIDI editing scope

**Chosen:** Basic inline editing (select, move, draw, delete) in arrangement; double-click for full editor.

**Considered and rejected:** Full-featured inline editing — rejected because the arrangement track height constrains the UI. Complex operations (expression editing, velocity lanes, multi-clip editing) require the full piano roll's vertical space. The inline view is for quick tweaks; the full editor is for deep work.

### Decision: Hybrid Web / Rust tier assignment for AI features

**Chosen:** Interactive / real-time AI features run in the browser Web tier (main thread or Web Worker). Heavy offline / quality-focused AI inference (e.g., singing synthesis, full-song generation, large embedding models) runs in the Rust tier via Tauri commands or Python sidecar. The tier is a design-time property per feature, documented per R-E5, not a runtime toggle.

**Considered and rejected:** (a) Browser-only — rejected because current neural singing / full-song generation models exceed browser WASM/ONNX practical limits for quality, and would either degrade output or push model size past what OPFS can realistically cache per user. (b) Rust-only — rejected because interactive features (ghost UI, modulation halos, spectrum, WebGPU automation, drag-out, MPE editing) require sub-16ms latency that a Tauri IPC round-trip cannot consistently deliver for every UI event. (c) Dynamic runtime tier selection — rejected because it hides a significant performance/behavior cliff from the developer and complicates testing. Explicit per-feature tier assignment is auditable and predictable.

This decision is grounded in `.agents/research/features/ai.md` § 1 (Rust-tier analysis for BPM/Key/Pitch) and `.agents/research/pipelines/audio-generation.md` (Rust-tier singing synthesis via ONNX Runtime + Python sidecar for heavy models). The consolidated tier assignments for this spec's AI features are listed in User-visible behavior § E5.

---

## Acceptance criteria

### MIDI Editor

- [ ] **AC-A1** — Alt+drag on selected notes creates duplicates at drop position; originals remain; single undo entry
- [ ] **AC-A2** — Ctrl/Cmd+D duplicates selection forward by selection timespan; repeated presses stack
- [ ] **AC-A3** — Holding tool key >300ms temporarily swaps; releasing returns to previous tool
- [ ] **AC-A4** — Legato (L) extends each note to meet the next note on the same pitch
- [ ] **AC-A5** — Split at cursor (Shift+S) splits selected notes at playhead; both halves retain velocity/expression
- [ ] **AC-A6** — Join (J) merges adjacent same-pitch notes; non-adjacent/different-pitch notes unaffected
- [ ] **AC-A7** — Shift+drag in velocity lane draws linear ramp across notes in range
- [ ] **AC-A8** — Drag-through in velocity lane paints continuous velocity values across multiple notes in a single gesture
- [ ] **AC-A9** — Multiple clips open in single piano roll; notes color-coded; clip selector for new notes; non-focused clip notes editable (distinct from read-only Ghost Notes)
- [ ] **AC-A10** — Ctrl/Cmd+Shift+drag slides clip content without moving boundaries; non-destructive for both audio (`audioOffsetBeats`) and MIDI (new `midiOffsetBeats`)
- [ ] **AC-A11** — Inline piano roll renders notes in arrangement clip regions; basic editing works; double-click expands
- [ ] **AC-A12** — Constrain toggle locks note input/movement to scale degrees with full keyboard visible
- [ ] **AC-A13** — Hovering over a note for 200ms plays audition; preference toggle available

### Arrangement

- [ ] **AC-B1** — Alt+drag on clips duplicates instead of moving
- [ ] **AC-B2** — Ctrl/Cmd+D duplicates selected clips forward
- [ ] **AC-B3** — Ripple insert pushes subsequent clips; ripple move fills source gap and opens destination space
- [ ] **AC-B4** — Time selection via beat ruler; supports delete/insert silence/duplicate/bounce/set loop/export
- [ ] **AC-B5** — Ctrl/Cmd+L sets loop region from selection
- [ ] **AC-B6** — Click-and-drag on beat ruler scrubs playhead with audio preview; single click still seeks

### Visualization

- [ ] **AC-C1** — On a knob with an active modulation source, the halo arc is rendered (CSS `conic-gradient` with `--mod-amount`); a DevTools performance trace while the modulator sweeps shows the halo updating at a sustained ≥30 frames per second (dropped frames <10% over a 5 s window) on a reference machine (M1 MacBook Air, Chrome stable). Arc color is derived from the modulation source's identity; live preview arc appears on hover over an unconnected target.
- [ ] **AC-C2** — Spectrum analyzer sustains ≥58 fps over a 10 s window while 4 tracks are playing audio, measured via `requestAnimationFrame` timestamps on the reference machine. FFT data is uploaded as a `Float32Array` to a GPU storage buffer each frame (verified by shader reflection / buffer inspection). Spectrum Grab freezes the displayed curve within 16 ms of hover enter. Collision detection visually highlights overlapping frequency ranges across ≥2 concurrently playing tracks.
- [ ] **AC-C3** — Spectrogram renders frequency/time heatmap with waveform overlay mode; waterfall scroll is continuous (no dropped columns) at 60 fps for the same 4-track reference workload.
- [ ] **AC-C2b** — Three existing SpectrumAnalyzer implementations (Fermenter, Workspace, Bacteria) are deleted and replaced by a single shared WebGPU-backed component; `rg "class SpectrumAnalyzer"` and file search show exactly one implementation file remaining.

### Layout

- [ ] **AC-D1** — Session view and arrangement visible simultaneously; resizable split

### AI Integration

- [ ] **AC-E1** — Ghost MIDI clips render with correct visual treatment; accept/dismiss/cycle all functional; not in project model until accepted
- [ ] **AC-E2** — A ghost audio clip renders on an audio track with the visual treatment defined in R-E2.1 (dashed border, semi-transparent fill, desaturated waveform stroke), distinguishable in a DOM/visual audit from a committed audio clip. Pressing Space while the ghost is focused plays the buffer through the track's full insert/send/bus chain (verified by metering a downstream insert receive signal); transport stop halts audition within one buffer period. Pressing Tab writes the rendered buffer to project sample storage and replaces the ghost with a committed clip whose `sampleId` resolves in the sample repository, in one undoable operation. Pressing Escape removes the ghost and releases its decoded buffer (verified by dropping the entry from the ghost-buffer cache). Alt+] and Alt+[ cycle between at least two pre-decoded alternatives. A search for ghost-audio state in project serializers returns no hits — ghost audio never persists before accept. Committed clips carry a non-empty `aiProvenance` field populated with the generating model id + version, prompt, timestamp, and seed used at generation time.
- [ ] **AC-E3** — A ghost automation overlay renders on the target lane at reduced opacity (verified via computed style: overlay alpha ≤ 0.5 while the committed curve alpha = 1). The diff toggle draws a color-coded delta layer between the two curves (green where ghost > committed, red where ghost < committed) without replacing either curve. Pressing Tab with no active time range replaces the committed curve in the ghost's time range with the suggested curve in exactly one undoable entry labelled "Accept automation suggestion" (verified by reading the undo stack). With a time range (R-B4) active, Tab replaces only the intersection; the non-intersecting portion of the ghost is discarded and is not committed. Pressing Escape removes the overlay without touching the committed curve. A search for ghost-automation state in automation lane serializers returns no hits — ghost overlays never persist before accept.
- [ ] **AC-E4** — No code path in v1 produces a ghost preview for routing, sends, or bus assignments. A repository search for ghost-routing state returns no hits in `src/`. Any AI-suggested routing change that ships in v1 mutates routing directly rather than previewing.
- [ ] **AC-E5** — Every AI feature implemented in v1 has a documented execution tier (Web, Rust, or Mixed) either in this spec, in the feature's own spec, or in a `README` adjacent to its module. A grep for features tagged `@aiTier` across AI-related modules returns one tag per feature. A runtime check of the E2 generation path running DiffSinger or ACE-Step executes in the Rust tier (verified by the presence of a Tauri command / sidecar invocation in the call stack, not a browser-side model load).

### Automation

- [ ] **AC-F1** — WebGPU automation canvas renders curves, fills, and nodes at ≥58 fps sustained over a 10 s window with a stress-test project of 50 automation lanes × 500 breakpoints each, measured on the reference machine. DOM lane headers and controls remain interactive (click latency under 50 ms) during playback. Renderer reads from the vanilla store with zero React re-renders during a sustained playhead sweep (verified via React DevTools profiler showing zero commits in the automation subtree). Disabling WebGPU via feature flag falls back to `GlutenCurve`/Canvas 2D and still renders all lanes (fps target does not apply to the fallback path).
- [ ] **AC-F2** — LFO/envelope/step-sequencer modulators connect to parameters; output visible in modulation halos
- [ ] **AC-F3a** — Automation comping uses take-lane infrastructure on automation lanes
- [ ] **AC-F3b** — AI volume riding suggests ghost automation curves
- [ ] **AC-F3c** — Cross-track linking updates targets when source changes

### Sample Library

- [ ] **AC-G1** — Importing a 1 000-sample test folder populates BPM, key, and descriptor fields in `SampleRecord` for every sample on completion. During the analysis run, the main-thread long-task count (>50 ms) is 0 measured over the full analysis window via the Performance Observer API — analysis occurs entirely in a Web Worker.
- [ ] **AC-G2** — "Find similar sound" returns ranked results in <100 ms (p95, measured over 100 queries) on a 100 000-sample library on the reference machine. Ranking is defined as ascending distance in the embedding model's native metric (cosine for CLAP, L2 for OpenL3). For a labelled evaluation set of 200 queries drawn from a tagged sample bank (e.g. `{kick, snare, hat, pad, lead, bass}`), top-10 precision (fraction of the top-10 results sharing at least one tag with the query's primary tag) ≥ 0.8. The HNSW index file is stored separately from the vector file on disk/OPFS (verified by listing storage).
- [ ] **AC-G3** — 2D map renders a 100 000-point cloud at ≥30 fps during pan/zoom on the reference machine, via WebGPU where available (Canvas 2D fallback does not need to meet the fps target but must remain interactive). Pre-computed UMAP coordinates are read from `SampleRecord` metadata — no UMAP recomputation occurs on open (verified by absence of the UMAP worker message during open).
- [ ] **AC-G4** — Drag-out works in both environments: in the browser, dragging a sample onto an OS window outside the app produces a file on drop (HTML5 `DataTransfer` with `application/octet-stream`); on desktop (Tauri), the same gesture produces a native OS file via file-promise APIs. Contextual auditioning plays the sample time-stretched to the project tempo and pitch-shifted to the project key before drop, with audible preview starting within 100 ms of hover enter. Auto-tagging populates `SampleRecord.tags` on import for each sample in the test set.

### Clip Aliases

- [ ] **AC-H1** — Automation clips link via poolId; edits propagate
- [ ] **AC-H2** — Per-instance overrides persist; non-overridden fields sync; "Reset override" works
- [ ] **AC-H3** — Variation lanes visible/switchable in timeline (extends TrackAlternative)
- [ ] **AC-H4** — Groove templates: library, intensity slider, non-destructive application

### MPE Expression

- [ ] **AC-I1** — Per-note expression lanes for pitch/CC74/pressure/release velocity; overlay for multi-selection
- [ ] **AC-I2** — Per-note humanize/random/spread on expression data
- [ ] **AC-I3** — Controller recording maps to note-bound expression for selected notes
- [ ] **AC-I4** — Dense MPE data collapses; expand-on-hover; dedicated Expression View mode

### Hardware Controllers

- [ ] **AC-J1** — Known controller auto-detected; mapping profile loads automatically
- [ ] **AC-J2** — Scripting API: JS/TS in Worker sandbox; can register mappings and control parameters
- [ ] **AC-J3** — Mappings import/export as JSON

### VCA Fader Tracks

- [ ] **AC-K1** — `TrackKind` includes `'vca'`; creating a VCA track produces a persisted `Track` with `kind === 'vca'`, undoable via the existing undo system. Loading a project that predates this change and contained `VcaGroup` entries produces one VCA track per former group, with `vcaGroupId` on assigned tracks resolving to the migrated track. Running migration twice yields the same project tree (idempotent).
- [ ] **AC-K2** — Inspection of the `AudioEngine` graph after creating a VCA track and routing 4 audio tracks to it shows: no audio input node, no output node, and no meter feed for the VCA track. Bypassing the VCA (setting its gain to unity) leaves the rendered audio bit-identical to removing the VCA track entirely from the graph.
- [ ] **AC-K3** — For an assigned track with a post-fader send to a reverb bus, reducing the VCA gain by 6 dB reduces the reverb bus input contribution from that track by 6 dB (verified via bus-level metering or offline render). Pre-fader sends from the same track show no change when the VCA gain moves. `applyVcaGains` no longer calls `engineSetTrackGain` with a pre-multiplied value (verified by reading the updated source).
- [ ] **AC-K4** — Muting a VCA track silences all assigned tracks at the engine output; the assigned tracks' `muted` flag in the model remains `false`. Un-assigning a track from a muted VCA restores its audibility immediately without any mute toggle on the track itself. Soloing a VCA track solos all assigned tracks.
- [ ] **AC-K5** — The VCA selector in `TrackVcaSection.tsx` lists all tracks of kind `'vca'` by name; selecting one sets the assigned track's `vcaGroupId` correctly. A VCA track's inspector renders a read-only list of assigned track names.
- [ ] **AC-K6** — Visual audit of a VCA channel strip confirms the strip renders only: name, color, fader, dB readout, mute, solo, and assigned-track list. Meters, clip lane, device slots, input/output selectors, and send list are absent from the DOM (verified by React test querying for those roles/elements).

### Global

- [ ] **AC-Z1** — `pnpm deps:validate` passes with zero violations
- [ ] **AC-Z2** — `pnpm typecheck` passes with no errors
- [ ] **AC-Z3** — All new interactions have undo/redo entries with descriptive labels
- [ ] **AC-Z4** — No new keyboard shortcut conflicts with existing shortcuts

---

## Implementation notes

### Existing code to modify (MIDI editor interactions)

The primary file for piano roll interactions is `src/modules/Workspace/presentations/hooks/usePianoRollInteractions.ts` (866 lines). Key integration points:

- **Alt+drag duplicate (R-A1)**: In `handleMouseDown`, when `hit` exists and `e.altKey` is true, instead of entering `mode: 'move'`, enter `mode: 'duplicate'`. In `handleMouseUp`, create copies at final positions instead of moving originals. The `dragPreviewRef` already supports multi-note move previews — reuse for duplicate preview with a visual indicator (e.g., dashed outlines for originals). When `hit` is null and `e.altKey` is true, the existing rubber-band path fires unchanged (line 278).
- **Quick-swap (R-A3)**: Requires tracking keydown/keyup timing in the tool selector. The tool shortcuts are defined in `Workspace/models/EditingTool.ts` (`TOOL_SHORTCUTS`). Add a `toolSwapTimer` ref in the tool selector component.
- **Legato (R-A4)**: New use case in `MIDI/useCases/midiNoteTransforms/legatoNotes.ts`. Sorts selected notes by startBeat per pitch, extends each duration to the next note's startBeat.
- **Split (R-A5)**: New use case in `MIDI/useCases/midiNoteTransforms/splitNoteAtBeat.ts`. Splits a note into two, preserving expression.
- **Join (R-A6)**: New use case in `MIDI/useCases/midiNoteTransforms/joinNotes.ts`. Merges adjacent same-pitch notes.
- **Split (R-A5)**: Uses Shift+S (not Alt+S) to avoid conflict with the global 'S' → select tool shortcut. The piano roll's `handleKeyDown` must check `e.shiftKey && e.key === 's'` and call `e.stopPropagation()` to prevent the tool selector from intercepting the 'S' key.
- **Slip editing (R-A10)**: Requires adding `midiOffsetBeats?: number` to the Clip model. The piano roll renderer and MIDI scheduling code must apply this offset when reading note positions. This keeps slip non-destructive for MIDI (matching audio's `audioOffsetBeats` pattern).
- **Velocity ramp (R-A7)**: Modification to `VelocityLane.tsx` / `NotePropertyLane` — detect Shift+drag to compute linear interpolation across the time range.

### Existing code to modify (Arrangement interactions)

- **Alt+drag duplicate (R-B1)**: In `useTimelineInteractions.ts`, add Alt modifier detection to clip drag. When Alt is held, clone clips at drop instead of moving.
- **Ripple insert/move (R-B3)**: Extend `rippleDelete/` use cases. Add `planRippleInsert.ts` and `planRippleMove.ts` following the existing `planRippleDelete.ts` pattern.
- **Time selection (R-B4)**: New state in `WorkspaceState` (or a new store): `timeSelection: { startBeat, endBeat, trackIds } | null`. Beat ruler click handler detects Shift modifier.

### Existing patterns to extend

- **WebGPU rendering**: `createWebGpuRenderer.ts` in Arrangement module — WGSL shaders, vertex attributes, batch rendering. Automation renderer (R-F1) and spectrum visualizers (R-C2, R-C3) follow this pattern.
- **Pattern pooling**: `patternInstance/` and `AutomationObject.poolId` — extend for automation clips (R-H1) and per-instance overrides (R-H2).
- **Sample library**: `SampleLibrary/` module `SampleRecord` type — extend with optional analysis fields. Embedding/vector subsystem may warrant a new module or service within `AudioAnalysis`.
- **Comping**: `TakeLane`/`CompRegion`/`groupComping` — extend to automation lanes for automation comping (R-F3.1).
- **Track alternatives**: `TrackAlternative` model — variation lanes (R-H3) make these visible in the timeline.
- **Expression editing**: `Levain/ExpressionPanel.tsx` + existing `VelocityLane`/`PressureLane`/`SlideLane`/`PitchBendLane` in Workspace — generalize the per-clip pattern to per-note (R-I1).

### New modules likely needed

- `HardwareController` module for controller profiles, scripting API, and mapping management (R-J1–J3)
- Embedding/vector infrastructure may fit within `AudioAnalysis` or as a new `SampleIntelligence` module

### Performance-critical areas

- WebGPU automation rendering (R-F1): shader compilation at init only; renderer must not block main thread
- Sample analysis (R-G1): entirely in Web Workers
- Vector search (R-G2): HNSW ops <100ms for 100k samples
- Modulation halos (R-C1): batch CSS custom property updates in a single `requestAnimationFrame`
- Spectrum analyzer (R-C2): `Float32Array` transfer to GPU without intermediate copies
- Piano roll ephemeral drag preview (already established pattern): no midiStore mutations during drag — commit only on mouseUp

---

## Test plan

### MIDI Editor

- [ ] **Manual** — Select notes, Alt+drag: verify originals stay and copies land at drop; verify undo removes copies
- [ ] **Manual** — Press Ctrl/Cmd+D three times: verify three sequential duplications stacked forward
- [ ] **Manual** — Hold D key for >500ms then release: verify draw tool activates and deactivates; verify quick tap <200ms permanently switches
- [ ] **Manual** — Select notes with gaps, press L: verify each note extends to the next note on same pitch
- [ ] **Manual** — Place playhead mid-note, select note, press Shift+S: verify note splits into two at playhead
- [ ] **Manual** — Select adjacent same-pitch notes, press J: verify single merged note; verify non-adjacent notes unchanged
- [ ] **Manual** — Select notes, Shift+drag in velocity lane: verify linear ramp from start to end
- [ ] **Manual** — Click-drag through velocity lane across multiple notes in a single gesture: verify continuous velocity painting
- [ ] **Manual** — Open two clips in piano roll: verify color-coded notes; verify edits go to correct clip
- [ ] **Manual** — Ctrl/Cmd+Shift+drag clip content: verify boundaries stay fixed, content slides
- [ ] **Manual** — Toggle inline editing: verify notes visible in arrangement; draw a note inline; double-click to expand
- [ ] **Manual** — Select scale in piano roll, enable Constrain: verify note draw only places on scale degrees; verify move snaps to scale degrees; verify full keyboard still visible
- [ ] **Manual** — Hover over a note for 300ms: verify audition plays; toggle off in preferences: verify no audition

### Arrangement

- [ ] **Manual** — Alt+drag clip: verify original stays, copy at destination; single undo; verify Alt+drag on empty = rubber band unchanged
- [ ] **Manual** — Select clips, press Ctrl/Cmd+D: verify copies placed after selection; press again: verify stacking; verify no-op with no selection
- [ ] **Manual** — Enable ripple, paste clip: verify subsequent clips push forward
- [ ] **Manual** — Enable ripple, move clip: verify gap closes at source, space opens at destination
- [ ] **Manual** — Shift+click beat ruler: verify time range selection; test delete-with-ripple on selection
- [ ] **Manual** — Select clips, press Ctrl/Cmd+L: verify loop region matches selection bounds
- [ ] **Manual** — Click-drag on beat ruler: verify audio scrub at drag speed

### Layout & AI

- [ ] **Manual** — Open session view alongside arrangement: verify both visible simultaneously; resize split; verify shared transport
- [ ] **Manual** — Trigger AI clip generation: verify ghost clip appears with semi-transparent dashed visual; press Tab to accept: verify clip commits to project model; press Escape on next ghost: verify dismissal; press Alt+]: verify alternative cycles

### Visualization & Automation

- [ ] **Manual** — Connect modulation source to knob: verify colored arc, 30fps animation, color by source
- [ ] **Manual** — Hover modulation source over unconnected target: verify preview arc appears
- [ ] **Manual** — Play audio, open spectrum analyzer: verify 60fps FFT. Hover to freeze. Enable collision view.
- [ ] **Manual** — Open spectrogram: verify heatmap renders. Toggle waveform overlay.
- [ ] **Manual** — Open automation lanes: verify WebGPU canvas renders curves. Verify DOM controls interactive. Disable WebGPU: verify Canvas 2D fallback.
- [ ] **Manual** — Create LFO modulator, connect to parameter: verify output in modulation halo; create envelope modulator: verify same; create step sequencer: verify same
- [ ] **Manual** — Record multiple automation passes on same lane: verify take lanes appear; comp regions: verify correct segments play; flatten: verify merged automation
- [ ] **Manual** — AI volume riding: analyze track, verify ghost automation suggestion appears; accept: verify committed curve
- [ ] **Manual** — Cross-track linking: define scale relationship between two parameters; change source: verify target follows

### Sample Library

- [ ] **Manual** — Import samples: verify BPM/key/descriptors appear in metadata; verify UI stays responsive
- [ ] **Manual** — "Find similar sound" on a sample: verify ranked results return; verify <100ms on 100k library
- [ ] **Manual** — Open 2D map: verify point cloud; pan/zoom/select/audition
- [ ] **Manual** — Drag sample to timeline: verify drop; test tempo-cropped variant

### Clip Aliases & Groove

- [ ] **Manual** — Create automation clip, link instance: verify edits propagate; apply override; verify override sticks; Reset override: verify reverts
- [ ] **Manual** — Open variation lanes in timeline: verify TrackAlternative content visible; switch active variation: verify playback follows
- [ ] **Manual** — Apply groove template to clip: verify quantization/swing applied; adjust intensity slider: verify gradual change; remove: verify notes return to original positions

### MPE Expression

- [ ] **Manual** — Select notes, open per-note lanes: verify expression data per note; humanize expression
- [ ] **Manual** — Record mod wheel while notes selected: verify expression data written to note-bound lanes (not clip CC)
- [ ] **Manual** — Dense MPE data: verify piano roll collapses/dims overlays; hover over note: verify expression detail expands

### Hardware Controllers

- [ ] **Manual** — Connect Push/Launchpad: verify auto-detect, profile loads, mappings work
- [ ] **Manual** — Write controller script that maps a knob to track volume: verify parameter control and feedback
- [ ] **Manual** — Export mapping as JSON; reimport on clean install: verify mappings restored
- [ ] **Automated** — `pnpm deps:validate` passes with zero violations
- [ ] **Automated** — `pnpm typecheck` passes with no errors

---

## Open questions

- [ ] **[MINOR]** Which embedding model checkpoint (CLAP vs OpenL3) should be the default? Resolve by benchmarking available WASM/ONNX models during implementation. Recommendation: CLAP for richer semantic understanding.
- [ ] **[MINOR]** Should the controller scripting API use a sandboxed Worker or iframe? Recommendation: Web Worker with restricted API surface — no filesystem, no network, only DAW parameter read/write and MIDI I/O.
- [ ] **[MINOR]** Minimum viable controller profile set for initial release? Recommendation: Push 2, Launchpad X, KeyStep.
- [ ] **[MINOR]** Should groove templates be project-embedded or standalone files? Recommendation: both — embedded by default with import/export.
- [ ] **[MINOR]** For automation comping, should it directly reuse `TakeLane`/`CompRegion` types or create parallel types for automation? Recommendation: reuse the same types — automation lanes are structurally identical to clip lanes for comping purposes.
- [ ] **[MINOR]** Quick-swap tool hold threshold — 300ms is the proposed value. Should this be user-configurable? Recommendation: hardcode 300ms initially; make configurable if user feedback demands it.
- [ ] **[MINOR]** Trust / confidence scoring for AI suggestions — a "trust formula" to rank or gate ghost suggestions (e.g., combining model confidence, historical user acceptance rate, and source diversity) is **research-only** for now: no such formula is defined in `.agents/research/features/ai.md` or adjacent AI research files, and introducing one in the spec without an empirical basis would be speculative. The ghost-preview requirements in this spec (R-E1, R-E2, R-E3) intentionally operate on binary present/absent suggestions. Revisit once real usage data exists. Recommendation: open a follow-up research brief when ghost-preview usage metrics become available.

---

## Tradeoffs and risks

- **WebGPU availability**: Not universally available. Spec requires graceful fallback, but fallback (Canvas 2D/GlutenCurve) will have lower performance with dense automation. The existing renderer is already functional — WebGPU is a progressive enhancement.
- **Embedding model size**: CLAP/OpenL3 models are 100MB+. Lazy loading + OPFS storage mitigate download/storage pressure. The feature should be opt-in on first use.
- **HNSW memory at scale**: For 500k+ sample libraries, index memory may hit browser limits. Mitigated by paginated loading and configurable size limits.
- **Multi-clip piano roll complexity**: Color-coding and cross-clip editing interactions add significant complexity to `usePianoRollInteractions.ts` (already 866 lines). Consider extracting into a separate `useMultiClipEditing` hook.
- **Scope breadth**: 90 requirements across 11 feature areas. Phasing, exit gates, and sequencing constraints are defined in the `## Phasing / release gates` section — do not duplicate or re-scope those bindings here.
- **Procedural modulation surface area**: "Connect anything to anything" is vast. Start with a curated parameter set; expand incrementally.
- **Controller scripting security**: Third-party scripts in a Worker sandbox are safe but limit API capability (no direct DOM access). Trade-off: security vs power. The restricted API is the right default.
- **In-place MIDI editing vs full editor**: Inline editing at arrangement track height constrains vertical space. Only basic operations are feasible inline — complex editing requires the full piano roll. This is an intentional scope limit, not a gap.

---

## Implementation Status

**What is implemented:**

- R-B3.2 (Ripple Delete move) and R-B3.3 (Ripple toggle) are implemented via the `ripple-delete-ownership.md` refactor.
- Basic note CRUD (R-A1-A2 partially) and tool switching (R-A3) exist but the advanced modifiers (Alt+drag) and timing-based switching are not fully verified against this spec's strict ACs.

**What is not implemented:**

- The vast majority of the 11 feature areas, including WebGPU visualizations (halos, spectrogram), Sample intelligence (UMAP, HNSW), and VCA fader tracks.

**What is done well:**

- Clear phasing and release gates defined for a massive UX overhaul.

**What needs refactoring:**

- N/A
