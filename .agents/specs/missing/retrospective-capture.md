# Retrospective capture

## Context

Reference research: `.agents/research/features/retrospective-capture.md`.

Retrospective capture is an always-on background buffer that lets the user recover what they _just played_ after the fact — without having armed a track or pressed Record first. When transport is stopped (or even running on an un-armed track), the user noodles on a controller, plays something good, realises it wasn't recorded, and presses a single **Capture** button (or hotkey). The last N seconds / bars of MIDI (and optionally the input bus audio) are materialised as a new clip on the timeline, with inferred tempo and loop boundaries where applicable.

The goal is to eliminate the "psychological tax of recording" — the creative inhibition caused by needing to arm a track, set up a cue, and hit Record before playing. Ableton's _Capture MIDI_ is the reference UX; the research file documents how it and other DAWs implement this pattern, and the real-time constraints that make it non-trivial.

**How this differs from neighbouring features:**

- **Retroactive punch recording** (existing partial implementation in `Transport`) overlaps with this feature only in that both materialise MIDI/audio that wasn't explicitly recorded. Punch recording assumes the track _is_ armed and the transport _is_ running, and it replaces a region on the timeline defined by punch-in/punch-out markers. Retrospective capture has no punch region, no arming requirement, and typically runs while the transport is stopped. Both may share the underlying MIDI input FIFO, but the trigger, UI, and destination are different.
- **Capture Inbox** (see `.agents/specs/global/future-spec.md`) is a completely separate concept: a docked panel collecting AI-generated ideas, voice prompts, and intent artifacts. It has nothing to do with MIDI/audio buffers. The name overlap is unfortunate but intentional elsewhere — this spec does not touch Capture Inbox.

---

## Goal

Provide an always-on MIDI (and optional input-bus audio) rolling capture that lets the user materialise the last N seconds / bars of performance into a clip on demand, with inferred tempo and loop length, without ever allocating, locking, or blocking on the audio thread.

---

## User-visible behavior

- While the app is running, every incoming MIDI event on every active port is continuously recorded into a rolling buffer. The user never arms anything.
- If an input audio bus is selected for retrospective capture, the last N seconds of raw PCM on that bus are also held in a rolling buffer.
- At any time (transport stopped or running), the user presses **Capture** (button in the transport bar, global hotkey bindable, default `Shift+C`). A modal affordance briefly appears: _"Captured: 7.8 bars @ 118 BPM → snapped to 8 bars. [Accept] [Adjust window] [Discard]"_.
- On Accept, a new MIDI (or audio) clip appears on the timeline:
    - If the transport was stopped and no tempo was set by the user, the inferred tempo is applied to the newly-created clip (the project tempo is not silently changed).
    - Clip length is snapped to the nearest power-of-two bar count.
    - Playhead position: at the current edit cursor by default, overridable via the Adjust control.
- Captured clips are ordinary timeline clips from that point on — they save, reload, edit, and render like any other clip.
- The capture window (seconds / bars) is user-configurable: `Last 30 seconds`, `Last 8 bars`, `Last loop iteration`, or a custom value.

---

## Scope

### In scope

- Rolling MIDI event ring buffer (fixed-size eviction, per-port, per-channel).
- Rolling audio ring buffer for **one selected input bus** (mono or stereo).
- Capture command (button + hotkey) that snapshots and materialises a clip.
- Tempo inference from MIDI inter-onset intervals when transport is stopped and no clips provide a reference tempo.
- Power-of-two bar-length inference (1, 2, 4, 8, 16 bars).
- Non-RT worker-thread snapshot pipeline.
- Orphaned-note recovery (synthetic Note-Offs for held notes at capture time).
- Persistence of captured clips across project save / reload.

### Non-goals (explicitly out of scope)

- **Multi-track always-on audio recording.** Disk and RAM cost is prohibitive for v1. Only one input bus at a time.
- **Audio capture beyond the selected input bus.** No track-output capture, no bus-mix capture, no master-bus capture in v1.
- **Audio tempo detection** (beat tracking from PCM). MIDI only for tempo inference — the research explicitly notes that MIDI IOI analysis is orders of magnitude simpler than audio onset detection.
- **Time-signature inference.** Default 4/4. The research confirms no DAW currently does this; we do not attempt it either.
- **Automatic note quantisation** on captured material. Ableton explicitly avoids this; we follow suit.
- **Persisting the ring buffer itself** across app restarts. Ring buffers are ephemeral.
- **Capture Inbox integration.** Unrelated feature (see Context).
- **Replacement of retroactive punch recording.** The existing punch recording code paths continue to exist; this feature may share the MIDI input FIFO with them but does not delete or rewrite them.

---

## Requirements

### R1 — Rolling MIDI event FIFO

A fixed-size, lock-free, allocation-free MIDI event ring buffer with eviction:

- Capacity: **16,384 events** (matches Ableton's proven sizing; see Design decisions).
- Each entry is per-port and per-channel tagged, timestamped with **absolute audio-frame count** (monotonically increasing `i64`) and **absolute wall-clock time** (for sessions where transport never ran).
- Eviction policy: when full, batch-evict the oldest **1,024 events** to amortise the cost — bounded and predictable, never a full-buffer sweep.
- Alongside the ring: a **128 × 16 active-note tracking table** (note × channel) for orphaned-note recovery at capture time. Every Note-On updates the table; every Note-Off clears it. Sustain-pedal state (CC #64) tracked analogously.
- **Capture-time synthesis of orphaned events:** when the captured window begins with a note whose original Note-On fell outside the ring (evicted), inject a **synthetic Note-On at the window start** so the clip starts cleanly. Symmetrically, inject a **synthetic Note-Off at the window end** for any note still held at capture time. Both behaviors use the active-note table above.
- **Acceptance:**
    - Fills and evicts correctly under a 30-minute idle-then-burst synthetic load (30 min no events, then a fixture-driven burst exceeding 16,384 events in < 1 s).
    - The MIDI input callback path allocates zero bytes — verified by `assert_no_alloc`-style guard in debug builds.
    - Orphaned notes are recovered at capture time (held-note fixture: 4 s held chord, capture mid-hold → captured clip contains the chord with a synthetic Note-Off at the capture boundary).

### R2 — Rolling input-bus audio SPSC ring

An overwriting, lock-free SPSC ring buffer for PCM on the selected input bus:

- Default capacity: **last 60 s** of audio at the project sample rate (configurable by the user; hard cap 5 minutes).
- Mono or stereo interleaved `f32`; sized to the nearest power-of-two frame count above the configured duration (enables `& mask` index wrapping).
- Monotonic `AtomicU64` write position; consumer snapshot uses an acquire load and computes `start = write_pos - window_frames`.
- Memory pre-allocated at startup; pages pre-faulted; `mlock` / `VirtualLock` on platforms where available.
- **Acceptance:**
    - The CPAL input callback performs zero allocations and acquires no locks — verified by `assert_no_alloc` in debug and by a dedicated RT-safety test (see Test plan).
    - Snapshot read from a non-RT worker thread produces byte-exact PCM for a known-input fixture (sine-wave generator feeding the bus for 10 s, capture `last 5 s` → snapshot matches the reference buffer modulo the wrap boundary).
    - A 2–3 s **safety margin** is enforced: a capture spanning more than `capacity − margin_frames` is flagged partial and truncated rather than silently returning corrupted data.

### R3 — Capture command

The user-facing trigger that materialises a clip from the rolling buffers:

- Invocation: button in the transport bar, plus a bindable global hotkey (default `Shift+C`).
- User-selectable capture window: `Last 30 seconds`, `Last 60 seconds`, `Last 8 bars`, `Last 4 bars`, `Last loop iteration`, or a custom value (seconds or bars).
- Behavior:
    - If the window is expressed in **bars**, it is resolved against the current project tempo if set, or against the inferred tempo (R4) if unset.
    - If the window is expressed in **seconds**, resolution is direct.
- Output:
    - A new clip is created at the current edit cursor (default) or at an inferred start time (user-selectable via Adjust affordance).
    - For MIDI captures, the clip contains the exact event window with orphaned-note recovery applied (R1).
    - For audio captures, the clip references a newly-written audio file (worker thread, R6).
- **Acceptance:**
    - Given a MIDI fixture replayed via a virtual port (192 events over 8 bars at a fixed tempo), `Capture last 8 bars` produces a clip whose MIDI event stream is **byte-equal** to the reference fixture (after orphaned-note recovery is applied deterministically to both sides of the comparison).
    - The Capture button is disabled (with tooltip) when the ring buffer is empty — no silent no-op.

### R4 — Tempo inference from MIDI IOI histogram

When transport is stopped and no enclosing clip imposes a tempo, infer tempo from captured MIDI:

- Algorithm: **IOI histogram** over consecutive Note-On events, 1 ms bins, with velocity weighting (louder notes receive greater histogram weight).
- Valid tempo range: **80–160 BPM** (octave-ambiguity resolution matches Ableton — see Design decisions). Out-of-range estimates are folded by doubling or halving until in range.
- Minimum sample size: **≥ 16 Note-On events** in the capture window. Below this, tempo is not inferred — the project tempo is used and the UI surfaces _"not enough notes to infer tempo"_.
- Optional refinement: log-Gaussian-weighted autocorrelation peak search centred at 120 BPM, applied only when histogram analysis is ambiguous (multiple peaks within 5% of each other).
- **Velocity weighting improves downbeat detection** (separate from tempo estimation). Louder notes are more likely to fall on strong beats; using velocity to weight IOI histogram contributions helps phrase-start inference even when tempo is already known.
- **Acceptance:**
    - Given a MIDI fixture played at a known tempo (e.g. 110 BPM) with ±5 BPM of human jitter, the inferred tempo is within **±2 BPM** of the reference over ≥ 16 notes. Fixture set must cover 90, 110, 130, 150 BPM at minimum.
    - A fixture played at 70 BPM is reported as 140 BPM (octave fold), confirmed by unit test.
    - Fewer than 16 notes returns `None` / no inference, not a confident wrong answer.

### R5 — Power-of-two bar-length inference

Captured clips snap to a clean bar length:

- Candidate lengths: **1, 2, 4, 8, 16 bars**.
- Given the event span in bars `span_bars = note_span_frames / (frames_per_bar)`, pick the closest candidate by the following rule:
    - If `span_bars ≥ 0.875 × candidate` and `span_bars ≤ 1.25 × candidate`, snap to that candidate.
    - Otherwise, snap to the next larger candidate.
    - Ties (equidistant between two candidates) resolve **upward** — a 6-bar phrase snaps to 8, not 4, to avoid truncating the tail.
- Any material preceding the inferred phrase start sits before the clip's start marker (accessible but not part of the loop region).
- **Phrase anchoring (informative).** When ambiguous, prefer the longest phrase that fits a power-of-two bar count **anchored at the most likely downbeat**. User guidance to end phrases on the downbeat (Ableton convention: "end on the first beat of the next bar") improves anchoring; the algorithm may use the final Note-On as a downbeat anchor and search backward.
- **Acceptance:**
    - A 7.8-bar phrase snaps to 8 bars.
    - A 3.1-bar phrase snaps to 4 bars (3.1 / 4 = 0.775 < 0.875 ratio → snap upward).
    - A 2.25-bar phrase snaps to 2 bars (2.25 / 2 = 1.125 ≤ 1.25 → 2 wins).
    - A 5.0-bar phrase snaps to 8 bars (ties-upward rule).

### R6 — Non-RT snapshot pipeline

All file I/O, clip creation, and project-tree mutations occur off the RT audio / MIDI threads:

- A dedicated **worker thread** (`std::thread::spawn`, not Tokio) owns:
    - A secondary rolling copy of audio (drained from the RT ring via `rtrb`) — the authoritative capture source.
    - The capture request queue (SPSC from UI thread).
    - The pre-allocated pool of linear snapshot buffers (4 × max capture duration, configurable).
- On capture:
    - UI thread reads `write_position`, sends a `CaptureRequest` to the worker.
    - Worker copies from its rolling buffer into a pool-acquired linear buffer, writes a WAV via `hound`, constructs clip metadata.
    - Clip metadata is handed to the frontend via a Tauri event; the Arrangement module's existing clip-creation use case ingests it.
- **Acceptance:**
    - Audio xrun counter (reported by CPAL / the engine) remains **zero** during a capture operation under a synthetic stress load (64-sample buffer, 10 simultaneous tracks playing, capture triggered mid-playback). Repeatable in CI under the engine integration harness.
    - The MIDI input callback's measured p99.9 latency does not regress during a capture vs. a non-capture baseline (measured in a dedicated bench; threshold: no more than 5% regression).

### R7 — Persistence

- Captured MIDI clips serialise into the project file via the existing MIDI clip serialisation path — no new on-disk format.
- Captured audio clips reference WAV files written into the project's audio assets directory, under `captures/<iso-timestamp>-<short-id>.wav`.
- Ring buffers themselves are **ephemeral** — never persisted. On app restart, the buffers are empty.
- **Acceptance:**
    - Capture → save project → close → reopen → the captured clip is present with identical MIDI/audio content (byte-equal MIDI, byte-equal audio file reference).
    - Deleting the project's captures directory orphans the audio clip but does not crash — the clip surfaces as a missing-asset placeholder using the existing missing-asset path.

---

## Constraints

- Must follow the domain-driven module architecture (`AGENTS.md`). New functionality lives in a module whose boundary is enforced by `pnpm deps:validate`. See Design decisions for module placement.
- **RT-safety (backend):** no allocation, no mutex acquisition, no I/O, no blocking syscalls on the CPAL audio callback or MIDI callback. Enforced by `assert_no_alloc` in debug and by RT-safety tests in CI (see `.agents/skills/web-audio-engine/SKILL.md` for the Web Audio analogue of this rule; the Rust/CPAL side follows the same contract per `.agents/skills/tauri-platform/SKILL.md`).
- **RT deadline context (informative).** At 48 kHz, a 256-sample buffer implies ~5.3 ms callback budget; at 64 samples, ~1.3 ms. Mutex acquisition is banned because of priority inversion; on Apple platforms, Objective-C message dispatch is unsafe on RT paths because the runtime uses internal locks.
- **Large binary payloads.** Prefer `tauri-specta` for event contracts; if PCM previews or bulk assets must cross the IPC boundary, use the project's established binary/Response path rather than JSON-shaping multi-megabyte blobs.
- **State discipline (frontend):** capture clip creation goes through a use case, not directly from UI. Follow `.agents/skills/state-and-write-paths/SKILL.md`.
- **Clip creation reuse:** the capture flow MUST terminate in the existing Arrangement clip-creation use cases. Do not introduce a parallel clip factory. If the existing use case does not support the needed input shape, extend it or add an adjacent use case in the same module — not a bypass.
- **Tauri event plumbing:** use `tauri-specta` for the `capture-complete` event contract. No stringly-typed payloads.
- **UI patterns:** Capture button and modal follow `.agents/skills/ui-patterns/SKILL.md`. Hotkey registration uses the existing keyboard shortcut registry (do not introduce a parallel one).

---

## Design decisions

### Decision: Overwriting ring buffer vs. growing buffer

**Chosen:** Fixed-capacity overwriting SPSC ring (for both MIDI and audio).

**Considered and rejected:**

- **Growing buffer** (append and re-allocate on capacity hit). Rejected: requires allocation on the RT thread, which is a hard violation of the RT contract (see `AGENTS.md` — all audio-thread code: no allocation, no mutex locks, no blocking).
- **Unbounded queue drained to disk** (e.g. write-to-disk-as-you-go). Rejected: cost scales with session length, not with the user's actual capture need. A user who plays for 3 hours and never captures should pay zero disk cost.

### Decision: MIDI FIFO capacity = 16,384 events with 1,024-event batch eviction

**Chosen:** 16,384 events, eviction of 1,024 at a time when full.

**Considered and rejected:**

- **Cubase's 100,000-event buffer.** Rejected: research shows this provides only ~20 seconds of capture under MPE density — the capacity looks generous on paper but fails on the expressive-controller case that matters most. Ableton's 16,384 with smart eviction is a better-tested tradeoff.
- **Single-event eviction** (drop oldest on every new event once full). Rejected: per-event bookkeeping has higher amortised cost than batch eviction; batch eviction aligns with cache-line-sized copies.
- **Time-based eviction** (drop everything older than N seconds). Rejected: requires a timestamp scan on every write, which is allocation-free but unbounded in worst case.

### Decision: Tempo inference via IOI histogram + velocity weighting

**Chosen:** Inter-onset-interval histogram at 1 ms resolution, velocity-weighted, range-folded to 80–160 BPM.

**Considered and rejected:**

- **Autocorrelation of the onset train.** Rejected as the _primary_ method: the research identifies it as a refinement that disambiguates ties, not a first-pass estimator. Keeping it as an optional refinement inside R4 preserves the tool.
- **Beat-tracking on audio.** Rejected: out of scope for v1, and substantially harder than MIDI IOI analysis per the research.
- **Widening the valid tempo range** (e.g. 60–200 BPM). Rejected: reintroduces the octave-ambiguity failure mode Ableton specifically solved by narrowing the range to 80–160. A user whose genuine tempo is 70 BPM gets a clip at 140 BPM and can halve it with one click; a user whose ambiguous 120 BPM gets mis-folded to 60 has no obvious fix.

### Decision: Module placement

**Chosen:** New module `src/modules/RetrospectiveCapture/` owning the frontend state, use cases (`triggerCapture`, `configureCaptureWindow`, `updateCaptureRolling`), and presentation (`CaptureButton`, `CaptureModal`). Backend lives in a new `daw-engine` submodule for the ring buffers and the worker thread. The clip-creation terminus routes into `Arrangement` use cases via the module public surface.

**Considered and rejected:**

- **Put it inside `Transport`.** Rejected: Transport is about the transport state machine (play / stop / record / position). Retrospective capture crosses transport/MIDI/audio/clip boundaries — belongs in its own module.
- **Put it inside `Arrangement`.** Rejected: Arrangement owns the timeline/clip model but has nothing to do with live input buffering.

### Decision: Worker thread is `std::thread::spawn`, not Tokio

**Chosen:** Plain OS thread for the capture worker.

**Considered and rejected:**

- **Tokio task.** Rejected per research and per `.agents/skills/tauri-platform/SKILL.md`: async runtimes add scheduling variability and are explicitly discouraged for audio-worker threads in Tauri v2 integrations.

---

## Acceptance criteria

- [ ] R1 — MIDI FIFO fills and evicts under fixture; zero allocation on MIDI callback verified by `assert_no_alloc`.
- [ ] R2 — Audio ring passes byte-exact snapshot test; zero allocation on CPAL input callback.
- [ ] R3 — Capture command produces byte-equal MIDI clip for a known fixture; disabled-state handled.
- [ ] R4 — Tempo inference within ±2 BPM on four-tempo fixture set with ≥ 16 notes each; octave fold case passes.
- [ ] R5 — Bar-length snap cases (7.8, 3.1, 2.25, 5.0) all resolve per spec table.
- [ ] R6 — Zero xruns during synthetic-stress capture under the engine integration harness.
- [ ] R7 — Capture → save → reopen round-trip is byte-equal for MIDI and audio.
- [ ] `pnpm deps:validate` passes with zero violations.
- [ ] `pnpm typecheck` passes with zero errors.
- [ ] All new Vitest and Rust unit + integration tests pass.
- [ ] RT-safety test (cargo-based, running the audio + MIDI callbacks under `assert_no_alloc`) passes.

---

## Implementation notes

- **Reuse first.** The project's existing lock-free primitives (check `daw-engine` for current `rtrb` or `ringbuf` usage) MUST be reused before introducing new crates. Survey the `daw-engine` workspace before adding dependencies.
- **Crate stack alignment (research, non-binding).** Prefer `rtrb` for the CPAL↔worker SPSC; consider `basedrop` / `rtrb_basedrop` if deferred deallocation of RT-visible pointers is required; `ringbuf` / `StaticRb` remains an alternative where const-generic static storage fits. Meadowlark **Creek** is prior art for RT-safe disk streaming with an IO-server thread and may be consulted when sizing the worker-thread drain loop. Production references for `ort`-class RT usage (TEI, Magika) are informational only.
- **Ardour / JACK prior art.** Ardour uses a dedicated "Butler" thread that drains per-track ring buffers to disk files via a cross-thread signal; JACK's `capture_client.c` demonstrates the canonical pattern of an RT callback writing to a ring plus a non-blocking `pthread_mutex_trylock` to wake the disk thread. Our worker-thread poll loop is a simpler variant of the same pattern.
- **MIDI FIFO sharing with punch recording.** If retroactive punch recording already reads from a MIDI input FIFO, this feature extends that FIFO rather than creating a parallel one. Audit the existing MIDI input path first; surface a finding if a parallel path is unavoidable.
- **Clip creation reuse.** The `Arrangement` module exposes existing use cases for creating MIDI and audio clips. The capture flow uses those via the module's public surface — no bypass, no direct store mutation, no shadow clip-factory.
- **Hotkey registration.** Find the existing keyboard shortcut registry (likely under `src/modules/App/` or similar) and register the Capture hotkey there. Do not ship a second shortcut system.
- **Pre-allocation.** Touch every page of every ring buffer at startup to pre-fault physical RAM. `mlock` / `VirtualLock` is platform-guarded; a no-op fallback is acceptable where unsupported but should log a startup warning.
- **Error surfaces.** Partial captures (safety-margin truncation), empty captures (no events in window), and tempo-inference failures all need explicit UI copy — no silent fallbacks.

---

## Test plan

- [ ] **Unit — MIDI ring buffer (Rust).** Fill to capacity, verify batch-eviction of oldest 1,024; idle-then-burst fixture over 30 minutes simulated via timestamp injection.
- [ ] **Unit — Audio ring buffer (Rust).** Known sine-wave fill, snapshot a sub-region, verify byte-exact against reference; wrap-boundary case covered.
- [ ] **Unit — Orphaned-note recovery.** Fixture: hold chord across a forced eviction; capture; assert synthetic Note-Offs injected with correct timestamps.
- [ ] **Unit — Tempo inference (Rust).** Four-fixture set at 90, 110, 130, 150 BPM with ±5 BPM jitter; assert within ±2 BPM; octave-fold fixture at 70 BPM asserts 140 BPM output; sub-16-note fixture asserts `None`.
- [ ] **Unit — Bar-length snap (Rust or TS, depending on where the function lives).** Table-driven test over the four cases in R5.
- [ ] **Integration — RT safety.** Run the CPAL input callback and MIDI input callback under `assert_no_alloc` for 60 s of simulated input; assert zero allocations.
- [ ] **Integration — end-to-end capture.** Virtual MIDI port feeds a fixture; trigger capture via the use case directly (not via UI); assert clip byte-equal to fixture after orphaned-note recovery.
- [ ] **Integration — persistence round-trip.** Capture → save project → close → reopen → read captured clip; assert byte-equal MIDI, byte-equal audio file hash.
- [ ] **Integration — xrun-free capture under load.** Harness: 10 tracks playing, 64-sample audio buffer, fire capture mid-playback; assert xrun counter == 0.
- [ ] **Manual — UX.** Click Capture with empty buffer → button disabled with tooltip. Click Capture with < 16 notes → clip created with project tempo and a "tempo not inferred" toast. Click Capture with a ~7.8-bar phrase → modal shows 8-bar snap with the detected BPM; Accept → clip lands on timeline at edit cursor.

---

## Open questions

- [ ] **[CRITICAL]** What is the minimum supported RAM configuration, and therefore the default audio ring size we can safely allocate? 60 s stereo at 48 kHz is ~22 MB, which is trivially safe, but if future variants bump to 5 minutes + 8 channels (~880 MB per research), the cap becomes user-facing. Need a decision on: (a) the default cap (proposed: 60 s stereo at 48 kHz = ~22 MB), (b) the hard maximum exposed in settings (proposed: 5 min stereo = ~110 MB), (c) behavior on low-RAM machines (detect, warn, auto-downgrade?). Blocks R2.
- [ ] **[MAJOR]** Capture policy when the window contains silence / no events. Options: (a) warn and offer to extend the window to the nearest non-silent region, (b) capture anyway and let the user discard, (c) disable Capture entirely when the buffer content in the window is below a threshold. Does not block implementation of R1/R2/R3 core paths but blocks final UX polish.
- [ ] **[MAJOR]** Does the existing retroactive punch recording already own a MIDI input FIFO we should extend? If yes, this spec's R1 is an extension task, not a new component. If no, R1 is new. Needs a short audit before the implementing task is scoped.
- [ ] **[MINOR]** Multi-input audio capture for v2. Noted as a non-goal for v1; filed here so the ring-buffer API doesn't get baked in a way that forecloses it.
- [ ] **[MINOR]** Capture-hotkey default. `Shift+C` is a placeholder — confirm it does not collide with existing bindings.
- [ ] **[MINOR]** Do we want a "Capture and keep buffering" vs. "Capture and flush" affordance? Relevant when the user wants to rapidly capture several takes without the previous take bleeding into the next window.

---

## Tradeoffs and risks

- **Memory footprint.** A default configuration consumes ~22 MB (audio) + ~1 MB (MIDI) + ~20 KB (note table) ≈ 23 MB of permanently-resident RAM per session. On constrained machines this is non-trivial; the `[CRITICAL]` open question above gates the final numbers.
- **Tempo inference false confidence.** A user playing rubato or with strong syncopation will produce a histogram with no clear peak. Mitigation: the ≥ 16-note threshold + the "no confident answer" path must be wired end-to-end, or users will ship clips at nonsense tempos.
- **Orphaned-note edge cases.** A held note that crosses a 16,384-event eviction is the worst case. The 128 × 16 active-note table handles this, but bugs here produce stuck notes on capture — the symptom is loud and disorienting. Test coverage for orphaned notes should be over-invested in.
- **Safety-margin mis-tuning.** If the 2–3 s margin is too tight, a capture under heavy CPU load returns a silently-truncated clip. If it's too loose, the usable capture window shrinks from the user's perspective. The margin value should be measured, not guessed, on the target hardware tier.
- **Worker-thread backpressure.** If the worker thread falls behind its secondary-buffer drain loop (unexpected but possible under an adversarial `rtrb` configuration), the authoritative capture source drifts from the live ring. The poll interval (~10 ms per research) and the secondary buffer size need explicit sizing — documented as an implementation note above.
- **Feature-adoption risk.** If Capture is slow, unreliable, or produces clips at the wrong tempo, users will disable it once and never try again. The correctness bar is higher than for features users have to deliberately opt into.

## Implementation Status

- **What is implemented**: Nothing.
- **What is not implemented**: The `RetrospectiveCapture` module, MIDI/audio rolling ring buffers in the Rust engine, tempo inference logic, and the UI commands.
- **What is done well**: N/A.
- **What needs refactoring**: N/A.
