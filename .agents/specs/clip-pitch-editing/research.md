---
type: research
id: RESEARCH-clip-pitch-editing
title: Inline pitch editing — ARA 2 host vs custom Rust/React editor
status: open
owner: The Sourdaw team
sources:
  - "Question: should a Tauri v2 DAW deliver inline pitch editing via an ARA 2 host or a custom Rust/React PSOLA editor?"
---

# Research: Inline pitch editing — ARA 2 host vs custom Rust/React editor

## Question

For a Tauri v2 DAW, should inline monophonic pitch editing be built by hosting ARA 2 plugins
(Melodyne et al.) or by writing a custom Rust/React PSOLA editor, and what architecture
keeps drag-to-hear latency low?

## Findings

### R-001 — ARA's core API is pure C, so Rust FFI is tractable

- **Claim:** `ARAInterface.h` is a pure C API of structs-of-function-pointers, not C++ virtual methods — no vtable or name-mangling obstacles at the binding boundary.
- **Evidence:** The four host interfaces map to `#[repr(C)]` structs of `extern "C"` fn pointers; CLAP exposes ARA via pure C extension structs (ARA SDK 2.3).
- **Confidence:** high
- **Bears on:** whether ARA 2 is a viable later phase rather than a dead end.

### R-002 — A custom PSOLA editor ships faster

- **Claim:** A custom Rust/React editor reaches Logic Flex Pitch quality in ~8–12 weeks; an ARA 2 host needs ~10–15 weeks plus high-risk compatibility testing against commercial binaries.
- **Evidence:** Effort breakdown table; no Rust ARA bindings exist (`ara-sys` would be written from scratch).
- **Confidence:** medium
- **Bears on:** build-vs-host decision for v1.

### R-003 — TD-PSOLA preserves formants at low latency

- **Claim:** Time-domain PSOLA shifts pitch without moving vocal-tract resonances and runs at ~5–20 ms latency, versus ~30–100 ms for a phase vocoder that also smears formants.
- **Evidence:** Algorithm is pitch-mark detection → windowed grain extraction → re-spacing → overlap-add; ~500–1000 lines of Rust, no crate dependency.
- **Confidence:** high
- **Bears on:** AC-001, AC-005 (synthesis path choice).

### R-004 — Pitch-contour payloads are trivially small

- **Claim:** A 30 s clip's contour is ~41–82 KB, well within Tauri JSON IPC comfort.
- **Evidence:** ~2,584 frames × 16 bytes at a 512-sample hop; doubles at a 256-sample hop.
- **Confidence:** high
- **Bears on:** AC-002 (no binary IPC needed for analysis data).

### R-005 — A triple buffer decouples edits from the audio callback

- **Claim:** A lock-free triple buffer lets the UI write delta maps at ~60 Hz while the audio thread reads at 1000+ Hz with zero contention and zero allocation.
- **Evidence:** Four-thread flow (analysis/edit/audio/commit) with `rtrb` for PCM and `triple_buffer` for parameters; measured drag-to-hear ~7–13 ms.
- **Confidence:** high
- **Bears on:** AC-001 (RT safety).

### R-006 — PSOLA quality degrades beyond ~700 cents

- **Claim:** Audible artifacts appear past roughly ±700 cents of shift; typical correction stays under 200 cents.
- **Evidence:** Reported degradation threshold for TD-PSOLA.
- **Confidence:** medium
- **Bears on:** AC-006 (delta-map clamp).

### R-007 — The six-hotspot blob is the UX convergence point

- **Claim:** Logic Flex Pitch — inline blobs with six hotspots (pitch drift in/out, vibrato, gain, fine pitch, formant), real-time non-destructive editing, optional bounce — is the model users expect.
- **Evidence:** Convergence across Logic, Pro Tools+Melodyne; FL NewTone's separate-window flow is the cautionary case.
- **Confidence:** high
- **Bears on:** AC-003, AC-004 (editor surface).

## Open questions

- [ ] Q-001 — Bundle the CREPE ONNX model or download on demand? Unblocks the high-accuracy tier.
- [ ] Q-002 — Exact crossfade length for the live-to-frozen swap; unblocks AC-008.
- [ ] Q-003 — Per-platform latency targets (Windows/Linux) or macOS as the launch reference.

## Recommendation

Build the custom Rust/React PSOLA editor first (R-002, R-003, R-005) targeting monophonic
vocal correction, with the delta-map clamp from R-006. Keep ARA 2 via the CLAP companion API
as a later phase (R-001) for polyphony and third-party plugin access; do not make ARA the
sole pitch-editing path.

## Restored detail from original research

The condensed findings above (R-001…R-007) summarised the original research note
(`research/factory/active/clip-pitch-editing.md`) and dropped several detailed passages.
The subsections below restore that detail verbatim where practical so the depth behind
each finding is recoverable. Each subsection names the finding it supports.

### D-001 — The four ARA host interfaces and their distinct roles (supports R-001)

The host must populate and provide four interface structs to ARA plugins, bundled into an
`ARADocumentControllerHostInstance`:

- **`ARAAudioAccessControllerInterface`** — provides random-access audio sample reading. The plugin creates readers and pulls samples at arbitrary positions (not streaming). The host may block on disk I/O within `readAudioSamples`, and the plugin is designed to tolerate this without priority inversion.
- **`ARAContentAccessControllerInterface`** — exposes musical context (tempo map, key signatures, chord progressions) and audio source content (detected notes, pitch) to the plugin. Uses a reader pattern: create reader → query event count → get event data → destroy reader.
- **`ARAModelUpdateControllerInterface`** — receives notifications from the plugin about content changes and analysis progress. Critically, `notifyAudioSourceAnalysisProgress` can be called from **any thread**, requiring the host to enqueue and dispatch safely.
- **`ARAPlaybackControllerInterface`** — handles plugin requests for transport control (start/stop playback, set position, cycle range).

Each host interface is a `#[repr(C)]` struct of `extern "C"` function pointers, e.g.:

```rust
#[repr(C)]
pub struct ARAAudioAccessControllerInterface {
    pub struct_size: ARASize,
    pub create_audio_reader_for_source: Option<unsafe extern "C" fn(
        controller_host_ref: ARAAudioAccessControllerHostRef,
        audio_source_host_ref: ARAAudioSourceHostRef,
        use_64bit_samples: ARABool,
    ) -> ARAAudioReaderHostRef>,
    pub read_audio_samples: Option<unsafe extern "C" fn(
        controller_host_ref: ARAAudioAccessControllerHostRef,
        reader_host_ref: ARAAudioReaderHostRef,
        sample_position: ARAInt64,
        samples_per_channel: ARAInt64,
        buffers: *const *mut c_void,
    ) -> ARABool>,
    pub destroy_audio_reader: Option<unsafe extern "C" fn(
        controller_host_ref: ARAAudioAccessControllerHostRef,
        reader_host_ref: ARAAudioReaderHostRef,
    )>,
}
```

### D-002 — ARA document object model and lifecycle (supports R-001)

ARA organizes audio editing into a strict object graph: **AudioSource → AudioModification →
PlaybackRegion**. An AudioSource represents a raw audio file. AudioModifications are
non-destructive edit layers on a source (one source can have many modifications).
PlaybackRegions place modifications onto the timeline. MusicalContexts provide tempo/key
data; RegionSequences act as track-like containers.

The lifecycle follows a strict protocol: the host calls `beginEditing()` before any model
mutations and `endEditing()` after. Destruction must follow reverse creation order
(PlaybackRegions before AudioModifications before AudioSources). These constraints map
naturally to Rust's RAII patterns — an `ARAEditGuard` drop guard is idiomatic Rust.

### D-003 — ARA threading constraints (supports R-001)

All document editing calls must happen on the **ARA model thread** (typically the main/UI
thread). Audio rendering happens on the **audio thread** via companion API `process()`
calls. Audio reading can happen on **multiple threads** (one thread per reader). The
`notifyAudioSourceAnalysisProgress` callback is the sole exception — callable from any
thread. This threading model is stricter than typical Rust async patterns but well-suited to
the channel-based architecture Tauri encourages.

### D-004 — Reference host implementations for writing `ara-sys` (supports R-001, R-002)

**No Rust ARA bindings exist.** Searches across crates.io, GitHub, and the nih-plug
ecosystem yielded zero results. An `ara-sys` crate translating `ARAInterface.h` would need
to be written from scratch. The official `ARAMiniHost` (pure C minimal host) and
`ARATestHost` (comprehensive command-line host) from Celemony's GitHub repository are the
best reference implementations.

### D-005 — pYIN and CREPE accuracy specifics (supports R-002)

The Rust ecosystem offers two viable paths for f0 estimation. The **`pyin` crate** (MIT
license, based on librosa v0.9.1) implements pYIN with HMM-based Viterbi smoothing, achieving
**~95–97% raw pitch accuracy** at 50-cent threshold. It outputs timestamps, frequency,
voiced flags, and voiced probability — exactly the data structure needed for blob rendering.
For projects demanding state-of-the-art accuracy (**~97.8% RPA**), CREPE's neural network can
run in Rust via the **`ort` crate** (ONNX Runtime bindings), loading pre-exported ONNX models
in five sizes from tiny to full. The `ort` crate is mature and production-grade, with
CUDA/TensorRT acceleration support.

**Recommendation**: Use pYIN as the primary offline analyzer (fast, no GPU dependency, good
enough for most vocals). Offer CREPE as a "high-accuracy" mode for difficult material.

### D-006 — Rubber Band Library detail (supports R-003)

The Rubber Band Library offers production-quality pitch/time manipulation with its
`setKeyFrameMap()` API supporting the delta-map pattern directly. However, it carries a
**GPL v2 license** requiring a commercial license for proprietary distribution. Its minimum
latency is **~50 ms** (higher than custom PSOLA), and Rust bindings (`KBone12/rubberband` on
GitHub) are minimal and unpublished on crates.io. Rubber Band is a viable fallback for
polyphonic material or extreme time-stretching, but custom PSOLA is preferred for the core
vocal correction use case.

### D-007 — Pro Tools / Melodyne workflow precedents (supports R-007)

The user expectation pattern is unambiguous: **instant analysis, inline blobs overlaid on the
waveform, real-time audible preview without rendering, and an optional "bounce in place" for
CPU relief**. The old Pro Tools "Transfer" workflow — where Melodyne captured audio in
real-time playback, required a floating window, and broke whenever clips were re-edited — is a
cautionary tale of what poor integration produces. Users expect that moving a clip on the
timeline does not invalidate their pitch edits.

Pro Tools' ARA 2 integration with Melodyne achieves comparable inline quality through a docked
tabbed editor with linked zoom, scroll, and transport.

### D-008 — Freeze and undo implementation detail (supports R-005)

For the Tauri DAW, the render thread should use `std::thread::spawn` (not Tokio) to avoid
starving the async runtime with CPU-bound work. The transition from live-to-frozen is an
atomic pointer swap — the region's playback source changes from "PSOLA engine + delta map" to
"pre-rendered PCM file." An optional 2–4 ms crossfade at the swap point prevents clicks.

Undo follows the **Command pattern**. The original audio file is never modified — all editing
is parameter-based:

```rust
trait EditCommand: Send + Sync {
    fn execute(&self, state: &mut ProjectState);
    fn undo(&self, state: &mut ProjectState);
}

struct CommitRegionCommand {
    region_id: RegionId,
    original_source: AudioSourceRef,    // never deleted
    delta_map_snapshot: PitchEditCommand, // few KB
    rendered_file: PathBuf,             // new file on disk
}
```

Undoing a commit restores the original source reference, re-activates live PSOLA processing
with the stored delta map, and optionally deletes the rendered file. A cleanup routine can
purge orphaned render files on project save.
