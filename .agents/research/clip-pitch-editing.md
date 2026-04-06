# Clip-native deep editing: ARA 2 vs custom Rust pitch editor

**A custom React/Rust pitch editor is the recommended path for a Tauri v2 DAW.** While ARA 2 host implementation in Rust is surprisingly feasible — the SDK is a pure C API, not C++, making FFI clean — the custom approach delivers faster time-to-market, tighter UX integration, and eliminates a GPL/commercial licensing dependency on third-party plugins. The ARA 2 route requires **10–15 engineer-weeks** just to reach parity with Melodyne's host-side contract, plus ongoing compatibility testing against commercial plugins. A custom PSOLA-based editor can ship a Logic Flex Pitch–quality experience in **8–12 weeks** using existing Rust crates (`pyin`, `rtrb`, `ort`) with full control over the inline editing UX. The pitch contour data for a 30-second clip is only **~48 KB** — trivially small for Tauri IPC — and end-to-end drag-to-hear latency lands at **7–13 ms** using a triple-buffer architecture.

---

## What users actually expect from inline pitch editing

The three dominant DAW implementations reveal a clear UX convergence. **Logic Pro's Flex Pitch** sets the gold standard for native integration: enable Flex on a track, analysis runs automatically, note blobs appear inline in the Audio Track Editor with six draggable hotspots (pitch drift start/end, vibrato, gain, fine pitch, formant). Editing is fully **real-time and non-destructive** — no commit step required. Pro Tools' ARA 2 integration with Melodyne achieves comparable inline quality through a docked tabbed editor with linked zoom, scroll, and transport. FL Studio's NewTone, by contrast, operates as a separate-window plugin requiring manual audio import/export — a workflow universally regarded as high-friction.

The user expectation pattern is unambiguous: **instant analysis, inline blobs overlaid on the waveform, real-time audible preview without rendering, and an optional "bounce in place" for CPU relief**. The old Pro Tools "Transfer" workflow — where Melodyne captured audio in real-time playback, required a floating window, and broke whenever clips were re-edited — is a cautionary tale of what poor integration produces. Users expect that moving a clip on the timeline does not invalidate their pitch edits.

For this project, Logic's approach is the model to follow: a native editor panel within the main arrangement view, non-destructive processing, and a simple "bounce in place" for committing. The 6-hotspot system (pitch drift in/out, vibrato, formant, gain, fine pitch per note) represents the minimum viable editing surface for professional vocal correction.

---

## ARA 2 host implementation is feasible but expensive

### The API is C, not C++ — a critical discovery

The single most important technical finding is that **ARA's core API (`ARAInterface.h`) is a pure C API using structs of function pointers**, not C++ virtual methods. The C++ Library layer (`ARA_Library/`) is an optional convenience wrapper. This eliminates the biggest feared obstacle for Rust FFI — no vtable compatibility issues, no C++ name mangling, no complex inheritance hierarchies at the binding boundary.

Each host interface is a `#[repr(C)]` struct of `extern "C"` function pointers:

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

### Four host interfaces must be implemented

The host must populate and provide four interface structs to ARA plugins, bundled into an `ARADocumentControllerHostInstance`:

- **`ARAAudioAccessControllerInterface`** — provides random-access audio sample reading. The plugin creates readers and pulls samples at arbitrary positions (not streaming). The host may block on disk I/O within `readAudioSamples`, and the plugin is designed to tolerate this without priority inversion.
- **`ARAContentAccessControllerInterface`** — exposes musical context (tempo map, key signatures, chord progressions) and audio source content (detected notes, pitch) to the plugin. Uses a reader pattern: create reader → query event count → get event data → destroy reader.
- **`ARAModelUpdateControllerInterface`** — receives notifications from the plugin about content changes and analysis progress. Critically, `notifyAudioSourceAnalysisProgress` can be called from **any thread**, requiring the host to enqueue and dispatch safely.
- **`ARAPlaybackControllerInterface`** — handles plugin requests for transport control (start/stop playback, set position, cycle range).

### The document model and lifecycle

ARA organizes audio editing into a strict object graph: **AudioSource → AudioModification → PlaybackRegion**. An AudioSource represents a raw audio file. AudioModifications are non-destructive edit layers on a source (one source can have many modifications). PlaybackRegions place modifications onto the timeline. MusicalContexts provide tempo/key data; RegionSequences act as track-like containers.

The lifecycle follows a strict protocol: the host calls `beginEditing()` before any model mutations and `endEditing()` after. Destruction must follow reverse creation order (PlaybackRegions before AudioModifications before AudioSources). These constraints map naturally to Rust's RAII patterns — an `ARAEditGuard` drop guard is idiomatic Rust.

### Threading constraints are strict but manageable

All document editing calls must happen on the **ARA model thread** (typically the main/UI thread). Audio rendering happens on the **audio thread** via companion API `process()` calls. Audio reading can happen on **multiple threads** (one thread per reader). The `notifyAudioSourceAnalysisProgress` callback is the sole exception — callable from any thread. This threading model is stricter than typical Rust async patterns but well-suited to the channel-based architecture Tauri encourages.

### Companion API: CLAP is the Rust-native path

ARA 2 attaches to plugin formats as an extension. For VST3, this uses COM-style interfaces (`IPlugInEntryPoint`) requiring vtable-compatible structs — doable via `vst3-sys` but adds complexity. For CLAP, ARA uses **pure C extension structs** finalized in ARA SDK 2.3 (November 2025). Given CLAP's C-native design and the existing `clap-sys` Rust crate, **CLAP is the strongly recommended companion API** for a Rust host. VST3 support can be added later.

### What doesn't exist yet

**No Rust ARA bindings exist.** Searches across crates.io, GitHub, and the nih-plug ecosystem yielded zero results. An `ara-sys` crate translating `ARAInterface.h` would need to be written from scratch. The official `ARAMiniHost` (pure C minimal host) and `ARATestHost` (comprehensive command-line host) from Celemony's GitHub repository are the best reference implementations.

### Effort estimate for ARA 2 host in Rust

| Component                                          | Weeks      | Risk     |
| -------------------------------------------------- | ---------- | -------- |
| `ara-sys` crate (C type definitions)               | 1–2        | Low      |
| Host interface implementations with safe wrappers  | 3–4        | Medium   |
| CLAP ARA extension integration                     | 0.5        | Low      |
| VST3 ARA entry point (via `vst3-sys`)              | 1–2        | Medium   |
| Document model management (lifecycle, edit guards) | 2–3        | Medium   |
| Thread-safe audio reader implementation            | 1–2        | Medium   |
| Testing against Melodyne, Auto-Tune, RX            | 2–4        | **High** |
| **Total**                                          | **~10–15** |          |

The testing phase carries the highest risk: commercial ARA plugins may exercise undocumented behaviors, edge cases in the struct versioning (`structSize` pattern), or timing assumptions that only surface with real-world use.

---

## Custom editor architecture delivers tighter integration

### Pitch detection: pYIN for reliability, CREPE for accuracy

The Rust ecosystem offers two viable paths for f0 estimation. The **`pyin` crate** (MIT license, based on librosa v0.9.1) implements pYIN with HMM-based Viterbi smoothing, achieving **~95–97% raw pitch accuracy** at 50-cent threshold. It outputs timestamps, frequency, voiced flags, and voiced probability — exactly the data structure needed for blob rendering. For projects demanding state-of-the-art accuracy (**~97.8% RPA**), CREPE's neural network can run in Rust via the **`ort` crate** (ONNX Runtime bindings), loading pre-exported ONNX models in five sizes from tiny to full. The `ort` crate is mature and production-grade, with CUDA/TensorRT acceleration support.

**Recommendation**: Use pYIN as the primary offline analyzer (fast, no GPU dependency, good enough for most vocals). Offer CREPE as a "high-accuracy" mode for difficult material.

### TD-PSOLA is the right synthesis algorithm

For monophonic vocal pitch correction, **TD-PSOLA (Time-Domain Pitch Synchronous Overlap and Add) is the optimal choice** over phase vocoding. PSOLA inherently preserves formants — shifting pitch without moving the vocal tract resonances — which is exactly what pitch correction requires. A phase vocoder shifts formants with pitch, producing the "chipmunk effect" unless a separate formant correction stage is added. PSOLA also offers significantly lower latency (**~5–20 ms** vs **~30–100 ms** for phase vocoders) and lower computational cost.

The algorithm operates by: detecting pitch marks aligned with waveform peaks, extracting windowed grains (2× pitch period, Hann windowed) centered at each mark, repositioning marks at the target pitch period, and overlap-adding the grains. For pitch correction specifically, the ratio between original and target pitch at each time point determines the new mark spacing. Quality degrades beyond **~700 cents** of shift, but typical pitch corrections rarely exceed 200 cents.

**No PSOLA crate exists on crates.io**, but the algorithm is straightforward to implement in **~500–1000 lines of Rust** using `rustfft` for any spectral analysis and standard windowing functions. A `tdpsola` crate does appear in some package listings but may be minimal.

### Rubber Band Library as an alternative engine

The Rubber Band Library offers production-quality pitch/time manipulation with its `setKeyFrameMap()` API supporting the delta-map pattern directly. However, it carries a **GPL v2 license** requiring a commercial license for proprietary distribution. Its minimum latency is **~50 ms** (higher than custom PSOLA), and Rust bindings (`KBone12/rubberband` on GitHub) are minimal and unpublished on crates.io. Rubber Band is a viable fallback for polyphonic material or extreme time-stretching, but custom PSOLA is preferred for the core vocal correction use case.

---

## IPC data structures and real-time data flow

### Pitch contour payloads are trivially small

For a **30-second clip** at 44.1 kHz with a 512-sample hop (the pYIN default), the analysis produces **~2,584 frames**. Each frame requires 16 bytes (time, frequency, confidence, voiced flag), totaling **~41 KB**. Even at a finer 256-sample hop, the total is only ~82 KB. This is well within Tauri's JSON serialization comfort zone — no binary optimization needed for pitch data.

```rust
// Sent from Rust → React after analysis
#[derive(Serialize, Deserialize)]
struct PitchContour {
    points: Vec<PitchPoint>,
    sample_rate: u32,
    hop_size: u32,
    algorithm: String,  // "pyin" | "crepe"
}

#[derive(Serialize, Deserialize)]
struct PitchPoint {
    time_ms: f32,
    frequency_hz: f32,
    confidence: f32,
    voiced: bool,
}

// Sent from React → Rust when user edits blobs
#[derive(Serialize, Deserialize)]
struct PitchEditCommand {
    region_id: String,
    segments: Vec<NoteSegment>,
}

#[derive(Serialize, Deserialize)]
struct NoteSegment {
    start_ms: f32,
    end_ms: f32,
    detected_pitch_hz: f32,
    target_pitch_hz: f32,       // user-set target
    pitch_drift_in: f32,        // cents, start transition
    pitch_drift_out: f32,       // cents, end transition
    vibrato_depth: f32,         // 0.0–1.0 scale factor
    formant_shift_cents: f32,
}

// Internal: compiled delta map for the audio thread
struct CompiledDeltaMap {
    // Per-hop pitch ratio (target/original), pre-interpolated
    ratios: Vec<f32>,
    hop_size: usize,
}
```

### The critical data flow pipeline

The system operates across four threads with two lock-free bridges:

**Analysis flow** (one-time, per region): The frontend calls `invoke("analyze_pitch", { regionId })` passing a `Channel<AnalysisProgress>` for streaming updates. Rust spawns analysis on the Tokio thread pool. The `pyin` crate processes the audio file, and partial results stream to React via `channel.send()`. On completion, the full `PitchContour` returns as the command response. React renders blobs on a Canvas/WebGL pitch-time grid.

**Edit flow** (interactive, per drag): When the user drags a blob, React debounces at **~60 Hz** and calls `invoke("apply_pitch_edit", { regionId, segments })`. The Rust command handler compiles the segments into a `CompiledDeltaMap` (per-hop pitch ratios) and publishes it via a **triple buffer** (`triple_buffer` crate). The audio thread reads the latest delta map on every callback — **lock-free, never blocking**.

**Audio flow** (real-time, continuous): The `cpal` audio callback reads pre-buffered PCM from an `rtrb` ring buffer (fed by a disk I/O thread), reads the current delta map from the triple buffer reader, applies TD-PSOLA with per-hop pitch ratios, and writes to the output buffer. End-to-end latency from drag to audible change: **~7–13 ms** (1–2 ms IPC + <1 ms triple buffer propagation + 5–10 ms audio buffer).

**Commit flow** (background): A dedicated `std::thread::spawn` render thread reads the source audio, applies PSOLA offline (faster than real-time), and writes a new WAV file. On completion, an `AtomicBool` flag flips the region's playback source from live processing to the rendered file. The audio thread checks this flag every callback — seamless transition with no glitch.

---

## Freeze, commit, and undo without data loss

### Background bounce keeps the audio thread running

The universal DAW pattern is **offline rendering on a dedicated thread**: read source audio from disk, apply the full processing chain faster than real-time, write to a new file in a `rendered/` subdirectory. The audio thread continues normal playback throughout. Pro Tools' Freeze creates `-FZ` suffixed files; Logic's Bounce in Place produces a new region on the same or adjacent track.

For the Tauri DAW, the render thread should use `std::thread::spawn` (not Tokio) to avoid starving the async runtime with CPU-bound work. The transition from live-to-frozen is an atomic pointer swap — the region's playback source changes from "PSOLA engine + delta map" to "pre-rendered PCM file." An optional 2–4 ms crossfade at the swap point prevents clicks.

### Undo architecture: command pattern with reference preservation

The original audio file is **never modified** — all editing is parameter-based. Undo storage per edit action is just the old and new `NoteSegment` arrays (a few KB). Undo after a commit stores the original source reference plus the edit parameters; unfreezing restores live processing. This follows the **Command pattern**:

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

Undoing a commit restores the original source reference, re-activates live PSOLA processing with the stored delta map, and optionally deletes the rendered file. Storage overhead per commit is one audio file on disk (same duration as the region). A cleanup routine can purge orphaned render files on project save.

---

## Head-to-head comparison and recommendation

| Factor                       | ARA 2 Host                                               | Custom Rust/React Editor                       |
| ---------------------------- | -------------------------------------------------------- | ---------------------------------------------- |
| **Development effort**       | 10–15 weeks                                              | 8–12 weeks                                     |
| **Plugin ecosystem access**  | Melodyne, Auto-Tune, RX, 13+ ARA plugins                 | None — first-party only                        |
| **UX integration depth**     | Limited by plugin's UI (docked but opaque)               | Full control — inline blobs, hotspots, theming |
| **Pitch correction quality** | Melodyne-tier (best in class)                            | Good (pYIN + PSOLA); excellent with CREPE      |
| **Polyphonic support**       | Yes (Melodyne Studio DNA)                                | No (PSOLA is monophonic)                       |
| **Licensing risk**           | Celemony SDK is Apache 2.0; plugins are commercial       | All MIT/Apache-2.0 Rust crates                 |
| **Rust FFI complexity**      | Moderate (C API, but large surface area ~100+ functions) | Low (all native Rust)                          |
| **Testing risk**             | **High** — must work with commercial plugin binaries     | Low — fully controlled                         |
| **Runtime dependency**       | Requires users to own Melodyne/etc.                      | Zero external dependencies                     |
| **Latency (edit-to-hear)**   | Plugin-dependent (~20–50 ms typical)                     | **~7–13 ms** (triple buffer + PSOLA)           |
| **Maintenance burden**       | Must track ARA SDK updates, plugin compatibility         | Internal codebase only                         |

### The recommendation: build custom first, add ARA later

**Phase 1 (ship in 8–12 weeks):** Build the custom Rust/React pitch editor with pYIN analysis, TD-PSOLA synthesis, and the triple-buffer IPC architecture described above. This delivers a Logic Flex Pitch–class experience with full inline UX control, the lowest possible latency, and zero licensing encumbrances. Target monophonic vocal correction — the highest-demand use case.

**Phase 2 (when market demands it):** Add ARA 2 host support via CLAP companion API. Start with the `ara-sys` crate translating `ARAInterface.h`, implement the four host interfaces, and test against Melodyne Essential (which ships bundled with many DAWs). This unlocks polyphonic editing, third-party plugin access, and the "Melodyne inside your DAW" marketing story. The custom editor and ARA can coexist — offer the native editor as the default and ARA plugins as an advanced option.

**Do not** attempt ARA 2 as the sole pitch editing solution. It introduces a hard dependency on third-party commercial plugins for a core feature, limits UX customization to whatever the plugin exposes, and carries significant testing risk against closed-source binaries. The custom path gives you a shipping product faster with better integration, while ARA remains a high-value Phase 2 addition.

---

## Conclusion

Three insights emerge from this analysis that may not be obvious. First, **ARA 2's pure C API design makes Rust FFI far more tractable than the "C++ SDK" label suggests** — the function-pointer-table pattern is essentially the same abstraction Rust traits compile to, just manually constructed. This means ARA isn't a dead end; it's a viable Phase 2 investment. Second, **the pitch contour data pipeline is not the hard problem** — at 41–82 KB per region, it's smaller than a typical JSON API response. The hard problem is the real-time synthesis thread, and PSOLA's simplicity (no FFT, no phase tracking, just windowed overlap-add) makes it uniquely suited to Rust's zero-cost abstractions and guaranteed memory safety. Third, **the triple-buffer pattern is the architectural linchpin** — it decouples the IPC command handler from the audio callback completely, letting the UI thread write new delta maps at 60 Hz while the audio thread reads at 1000+ Hz, with zero contention and zero allocation. This single crate choice (`triple_buffer`) eliminates an entire class of real-time audio bugs that plague C++ DAWs using mutex-guarded shared state.
