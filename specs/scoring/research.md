---
type: research
id: RESEARCH-scoring
title: Video scoring and SMPTE sync
status: open
owner: The Sourdaw team
sources:
  - "Question: how should a Tauri DAW sync audio to video, do SMPTE math, and extract/export video?"
---

# Research: Video scoring and SMPTE sync

## Question

How should a Tauri DAW synchronise the transport to a video file, represent SMPTE
timecode exactly, and handle audio extraction, scene-marker detection, and video export?

## Findings

### R-001 — Rational SMPTE math avoids drift

- **Claim:** SMPTE timecode (incl. 29.97/59.94 drop-frame) must be represented as exact rationals; floating-point frame math accumulates drift over long sessions.
- **Evidence:** the `vtc` crate (rational timecode); drop-frame definition (NTSC 30000/1001).
- **Confidence:** high
- **Bears on:** AC-002 (SMPTE math correctness).

### R-002 — A phase-locked loop locks audio clock to video clock

- **Claim:** A PLL that nudges the audio playback rate toward the video's reported time keeps long-form A/V in sync without audible pitch jumps; `requestVideoFrameCallback` provides per-frame timestamps.
- **Evidence:** `requestVideoFrameCallback` spec; PLL resync patterns in media players.
- **Confidence:** medium
- **Bears on:** AC-003 (PLL sync), AC-001 (master clock).

### R-003 — The video clock is the master during scoring

- **Claim:** When scoring, the video element (not the audio engine) is the transport master; the audio engine slaves to it so picture is never dropped.
- **Evidence:** standard post-production sync discipline; source design notes.
- **Confidence:** medium
- **Bears on:** AC-001.

### R-004 — FFmpeg (via a Rust binding) does extraction and export

- **Claim:** Audio extraction from the video and final muxed video export are best handled by FFmpeg through a Rust binding (`rsmpeg` / `ffmpeg-next`) rather than browser APIs.
- **Evidence:** FFmpeg codec coverage; `rsmpeg`/`ffmpeg-next` maturity; licensing review needed (LGPL/GPL components).
- **Confidence:** medium
- **Bears on:** AC-004 (extraction), AC-006 (export), the licensing open question.

### R-005 — Scene-cut detection seeds markers

- **Claim:** Content-based scene-cut detection (frame-difference / histogram thresholds) can auto-place hit-point markers that the composer then adjusts.
- **Evidence:** PySceneDetect approach; FFmpeg `select='gt(scene,...)'`.
- **Confidence:** low
- **Bears on:** AC-005 (scene detection).

## Open questions

- [ ] Q-001 — FFmpeg licensing: which build (LGPL vs GPL) is shippable, and is it bundled or system-resolved?
- [ ] Q-002 — PLL correction window / max rate deviation before audible artefacts.
- [ ] Q-003 — Scene-detection default threshold and whether it ships on by default.

## Recommendation

Make the video element the transport master during scoring (R-003), represent timecode as
exact rationals (R-001), and lock audio to picture via a PLL fed by
`requestVideoFrameCallback` (R-002). Use an FFmpeg Rust binding for extraction and export
(R-004) once the licensing question (Q-001) is settled, and treat scene detection (R-005)
as an assistive, off-by-default seed.

> Note on master-clock direction: the summary above (R-003) and the condensed findings
> R-001..R-005 say the *video* is the transport master. The original research note
> (restored verbatim below) reaches the opposite conclusion: the **Rust CPAL audio thread
> is the master clock and the `<video>` element is slaved to it via `playbackRate`**. The
> restored section is the authoritative source; the condensed findings inverted it during
> migration. See "Restored from research/factory/active/scoring.md" below.

---

## Restored from research/factory/active/scoring.md

The following section is restored verbatim from the original research note
(`research/factory/active/scoring.md` at commit `bb84b0e`). Content here was dropped during
the migration that produced the condensed R-001..R-005 findings above. Where the condensed
findings and this restored note disagree (notably the master-clock direction), this restored
note is the authoritative source.

### Synchronizing video and audio clocks in a Tauri v2 DAW

**The core solution to the clock-drift problem is treating the HTML5 `<video>` element like a voltage-controlled oscillator in a phase-locked loop (PLL), where the Rust CPAL audio thread provides the master clock and `playbackRate` micro-adjustments slave the video to it.** This approach achieves ±10ms sync accuracy — well within the ±1 frame tolerance required for professional video scoring. The architecture uses an `AtomicU64` sample counter in the real-time audio thread, a 100Hz Rust poller thread pushing updates via Tauri's `Channel` IPC, and `requestVideoFrameCallback` on the frontend to measure drift and apply corrections. Video decoding must happen in the browser's native `<video>` element (hardware-accelerated), not in Rust, because sending **~150MB/s** of decoded frame data across Tauri's IPC bridge is infeasible. For video file operations (audio extraction, re-muxing bounced stems), `ffmpeg-next` or `rsmpeg` provides the full pipeline in Rust. SMPTE timecode math demands rational arithmetic — never floating point — with the `vtc` crate offering a battle-tested Rust implementation.

---

#### How Logic Pro, Cubase, and Pro Tools handle video scoring

Professional DAWs solve the "two timelines" problem — SMPTE timecode (linear, absolute) vs. bars/beats (tempo-dependent, musical) — through specialized tools that let composers align musical structure to picture events.

**Logic Pro** uses a global Movie track displaying filmstrip thumbnails, a floating video window that follows the playhead, and a three-tier marker system: standard markers (tempo-relative), SMPTE-locked markers (absolute time), and Scene markers (auto-generated by analyzing scene cuts). Its Tempo Operations window provides **"Create Constant Tempo"** — the primary film scoring tool — where you lock a timecode position and a bar/beat position, and Logic calculates the required tempo. Beat Mapping allows dragging beat lines onto markers but is considered less flexible than Cubase's approach.

**Cubase's Time Warp tool** is widely regarded as the most intuitive tempo-mapping interface for film scoring. You place markers on a linear-time Marker Track at hitpoint positions, then drag bars/beats in the ruler directly onto those markers. Cubase auto-calculates tempo changes in real time. Its **"Set Timecode at Cursor"** command elegantly aligns any bar position to any timecode. Cubase treats video as draggable events on a Video Track (supporting multiple files per project, unlike Logic's one-movie limit) and offers configurable thumbnail caching with adjustable memory allocation.

**Pro Tools** uses **"Identify Beat"** — a dialog-based approach where you position the cursor at a timecode and specify "this is Bar X, Beat Y." Beat Detective can analyze audio transients across multiple tracks and generate tempo maps. **Digital Performer's** Chunks feature deserves mention: it maintains independent tempo maps per cue, completely avoiding the cascade problem where tempo changes in one cue shift all subsequent cues.

Every professional DAW shares these universal UI patterns: a floating resizable video window (often on a second monitor), dual time displays showing SMPTE and bars/beats simultaneously, color-coded markers with SMPTE-lock capability, a visual tempo track with jump and ramp node types, and per-track timebase switching (sample-locked vs. tick-locked). The standard workflow is: import video → set frame rate and SMPTE offset (typically `01:00:00:00`) → spot hitpoints as SMPTE-locked markers → build tempo map → compose with aligned grid → lock regions to SMPTE → export stems.

---

#### Solving clock drift with a PLL-style sync loop

The browser's presentation clock and the CPAL audio hardware clock run on **independent oscillators** with typical drift of 20–100 parts per million. At 50 ppm, two clocks diverge by roughly **30ms every 10 minutes** — enough to become visible and audible in a scoring session. The ITU perceptual threshold is +45ms (audio early) to −125ms (audio late), but professional DAWs target ±1 frame (**±33–42ms** depending on frame rate).

**`requestVideoFrameCallback`** is the critical API for this architecture. Unlike `timeupdate` events (which fire at unpredictable 4–66Hz intervals) or `requestAnimationFrame` (which fires at display refresh rate, not video frame rate), `requestVideoFrameCallback` fires exactly once per video frame and provides a `metadata.mediaTime` field — the actual presentation timestamp of the displayed frame. This is the ground truth for what the video element is currently showing, far more reliable than polling `currentTime`.

The sync algorithm implements three correction tiers inspired by the **MediaSync/timingsrc library** (the most battle-tested open-source reference, from the W3C Multi-device Timing Community Group):

- **Large drift (>300ms):** Hard seek via `video.currentTime = audioPosition`. Seeks are asynchronous and variable-latency (10–200ms depending on codec GOP structure), so overshoot the target slightly and let rate correction handle convergence.
- **Medium drift (10–300ms):** PLL-style `playbackRate` adjustment. A proportional gain of **0.3–0.5 × error** with a small integral term corrects drift smoothly. Sub-percent rate changes (e.g., `1.002` or `0.998`) work reliably in Chromium and WebKit. The MediaSync library proves this approach achieves **echoless synchronization** even across network-connected devices.
- **Converged (<10ms):** Reset `playbackRate` to `1.0` and decay the integral accumulator.

```javascript
video.requestVideoFrameCallback((now, metadata) => {
    const drift = audioPlayheadSecs - metadata.mediaTime;
    if (Math.abs(drift) > 0.3) {
        video.currentTime = audioPlayheadSecs + 0.05; // overshoot for seek latency
        integralError = 0;
    } else if (Math.abs(drift) > 0.01) {
        integralError += drift * 0.016;
        video.playbackRate = Math.max(0.5, Math.min(2.0, 1.0 + 0.5 * drift + 0.01 * integralError));
    } else {
        video.playbackRate = 1.0;
        integralError *= 0.95;
    }
    video.requestVideoFrameCallback(syncLoop);
});
```

Key implementation details: always mute the `<video>` element (`video.muted = true`) since the DAW provides all audio. Use the `presentedFrames` counter from the callback metadata to detect dropped frames. Allow **1–3 seconds of pre-roll** for the PLL to converge before meaningful content begins. The `preservesPitch` property (default `true`) applies pitch correction during rate adjustments, but disabling it may reduce processing latency.

A critical limitation of `<video>.currentTime`: the W3C TPAC 2019 working group confirmed it is **"not precise enough to identify individual video frames."** Internal rounding may land on the end of the previous frame rather than the start of the target. There is no frame-number-based seeking in the standard. This is why `requestVideoFrameCallback`'s `mediaTime` is essential — it reports the actual PTS of the composited frame.

---

#### SMPTE timecode math requires rational arithmetic

The most critical implementation rule: **never represent frame rates as floating-point numbers.** The NTSC rate commonly called "29.97" is actually **30000/1001** (29.97002997..., a repeating decimal). Using `29.97` directly accumulates errors that break sync within minutes. All standard rates have exact rational representations:

| Rate name | Exact rational | Frame duration |
| --------- | -------------- | -------------- |
| 23.976    | 24000/1001     | 1001/24000 s   |
| 24        | 24/1           | 1/24 s         |
| 25        | 25/1           | 1/25 s         |
| 29.97     | 30000/1001     | 1001/30000 s   |
| 30        | 30/1           | 1/30 s         |

**Drop-frame timecode** (29.97 DF) exists because at 30000/1001 fps, non-drop timecode drifts from wall-clock time by **~3.6 seconds per hour** (~108 frames). The rule: skip frame numbers 00 and 01 at the start of every minute, except minutes divisible by 10. This drops 18 frame numbers per 10 minutes (108 per hour), nearly eliminating the drift. The residual error over 24 hours is approximately **−2.6 frames** (86.4ms) — broadcast facilities reset via "jam sync" to GPS daily.

The canonical frame-number-to-drop-frame conversion (Andrew Duncan's formula):

```
D = frameNumber / 17982          // 10-minute blocks
M = frameNumber % 17982          // remainder within block
frameNumber += 18*D + 2*((M - 2) / 1798)   // adjust (if M >= 2)
// Then extract HH:MM:SS;FF via standard modular arithmetic with timeBase=30
```

For sample-to-timecode mapping, the relationship `frame = floor(sample × frameRateNum / (sampleRate × frameRateDen))` must use integer rational arithmetic. A subtle complication: at **48kHz / 29.97fps**, samples per frame is **1601.6** — a non-integer. The pattern repeats every 5 frames: 1602, 1601, 1602, 1601, 1602 (totaling 8008 samples per 5 frames, per SMPTE EG-40). This means frame boundaries don't align with sample boundaries, and sub-frame tracking is necessary.

The **`vtc` crate** (by Open Cinema Collective) is the most comprehensive Rust implementation, using `num::Rational64` for all internal calculations. It supports all standard rates, drop-frame, Premiere Pro ticks, and feet+frames conversion. For internal DAW timekeeping, the **superclock** approach (used by Ardour at 508,032,000 per second, or Meadowlark at 282,240,000) provides a sample-rate-independent base unit divisible by all common sample rates, making sample-rate changes lossless.

The three time domains in a DAW — audio/sample time (linear), SMPTE time (linear, derived from sample time), and musical/beat time (tempo-dependent) — have a crucial property: **SMPTE and sample time are always in fixed linear relationship** (`smpte_seconds = sample_position / sample_rate`). Tempo changes only affect the mapping between beat time and sample/SMPTE time. This is why SMPTE-locked markers stay fixed when you edit the tempo map.

---

#### Video processing in Rust: ffmpeg-next or rsmpeg for the full pipeline

No pure-Rust crate handles the complete video pipeline. H.264 and H.265 decoding have no mature pure-Rust implementations, making FFmpeg bindings effectively mandatory for video frame decoding.

**`rsmpeg`** (maintained by ByteDance/Lark) is the strongest choice for new projects — actively maintained with corporate backing, closely mirrors the FFmpeg C API, and supports FFmpeg 6.x–7.x with good static linking via `rusty_ffmpeg`. **`ffmpeg-next`** has the largest community and most examples but is in maintenance-only mode (bug fixes and FFmpeg version bumps, no new features). Both provide identical capabilities: full demuxing, decoding, encoding, muxing, seeking, resampling, and scaling.

The three pipeline stages:

**Import (extract audio):** Open the video container with `format::input()`, find the audio stream, decode with the appropriate codec decoder, and resample to your project format (typically f32/48kHz/stereo) via `swresample`. This yields raw PCM that the DAW treats as a normal audio clip.

**Playback (decode frames for display):** For the recommended browser-native approach, simply serve the video file via Tauri's `asset:` protocol or `convertFileSrc()` — the `<video>` element handles decoding with hardware acceleration. If you need Rust-side frame access (for thumbnail generation or scrub preview), seek to the nearest keyframe via `ictx.seek()`, flush the decoder, then decode forward until reaching the target PTS. For H.264 with a typical GOP size of 30, worst-case seek requires decoding ~30 frames.

**Export (mux bounced audio back):** The equivalent of `ffmpeg -i video.mp4 -i mix.wav -c:v copy -c:a aac -map 0:v -map 1:a output.mp4`. Open the original video as input, create an output container, stream-copy all video packets (no re-encoding), encode the new audio from your DAW's mix buffer to AAC, and interleave the packets. This preserves the original video stream perfectly while replacing the audio.

For distribution with Tauri, **static linking** is recommended for release builds — it produces a single binary with FFmpeg embedded (~15–40MB overhead) and zero runtime dependencies. Use `ffmpeg-sys-next` with `static` + `build` features. GStreamer's distribution complexity (requiring many shared libraries and platform-specific plugin bundles) makes it a poor fit for desktop app distribution compared to FFmpeg.

---

#### The complete Tauri v2 architecture for audio-video sync

The architecture spans three tiers: the real-time audio thread, a Rust coordination layer, and the WebView frontend.

**Tier 1 — CPAL audio thread (nanosecond cost):** The audio callback atomically stores the current sample position into an `Arc<AtomicU64>` with `Relaxed` ordering. This is a single atomic store instruction — the lightest possible operation, with no locks, allocations, or I/O that would violate real-time constraints. With one writer (audio thread) and one reader (poller), there are no cache-line contention concerns.

**Tier 2 — Rust poller thread (sub-millisecond cost):** A dedicated `std::thread` polls the `AtomicU64` at **100Hz**, converts the sample position to seconds and frame number, and pushes updates via `tauri::ipc::Channel`. Tauri's documentation explicitly states that Events "are not designed for low latency or high throughput" and recommends Channels for streaming data. Channel delivery latency is approximately **0.5ms** for small JSON payloads. For richer data (metering, waveform chunks), the `rtrb` crate provides a purpose-built real-time SPSC ring buffer.

**Tier 3 — WebView frontend:** A Web Worker receives Channel messages and writes the playhead position into a `SharedArrayBuffer` (enabled in Tauri v2 via COOP/COEP headers). The main thread's `requestVideoFrameCallback` reads the latest position via `Atomics.load` — zero-copy, zero-postMessage for the hot path. This offloads the sync computation from the main thread, preventing UI jank from 100Hz updates.

A critical finding: Tauri **does not support shared memory between Rust and the WebView process**. A core maintainer confirmed that `SharedArrayBuffer` only enables memory sharing between JavaScript contexts (main thread ↔ Workers), not between the Rust backend and WebView. All data must cross the IPC bridge via Commands, Events, or Channels.

The total pipeline latency breaks down as:

| Component                                | Latency      |
| ---------------------------------------- | ------------ |
| AtomicU64 store (audio thread)           | <0.001ms     |
| Poller read + compute                    | <0.1ms       |
| Polling interval (configurable)          | 8–16ms       |
| Tauri Channel delivery                   | ~0.5ms       |
| Worker → SharedArrayBuffer → main thread | <0.1ms       |
| Video sync correction (next vsync)       | 0–16ms       |
| **Total**                                | **~10–34ms** |

This fits comfortably within the ±1 frame budget at any standard frame rate (33–42ms). Even at 30fps, the pipeline's worst-case 34ms latency leaves headroom.

For transport commands (play/pause/seek), the frontend calls `invoke('transport_play')` which starts the CPAL stream in Rust, then the frontend calls `videoElement.play()`. The Command round-trip is ~0.5–1ms. Seek commands simultaneously set the audio playhead and issue `video.currentTime = targetTime`, with the PLL handling convergence.

**Video decoding must happen in the browser**, not Rust. At 1920×1080 RGBA @ 24fps, decoded frame data totals ~150MB/s. Tauri's binary IPC benchmarks show 5ms per 10MB on macOS and ~200ms on Windows (a known WebView2 performance issue) — far too slow for real-time frame delivery. The browser's native `<video>` element provides hardware-accelerated GPU decoding with zero IPC overhead, full codec support, and battle-tested reliability.

---

#### Conclusion

Building video sync for a Tauri v2 DAW is tractable because the problem decomposes cleanly: audio is the master clock, video is the slave, and the tolerance budget (±1 frame = 33–42ms) is generous relative to the IPC latency (~10–34ms end-to-end). The `requestVideoFrameCallback` API — providing per-frame `mediaTime` ground truth — transforms what was previously a guessing game into a measurable, correctable control loop. The PLL approach (proportional + integral correction on `playbackRate`, with hard seeks as a fallback) is proven by the MediaSync library across far more hostile environments than a single desktop machine.

The architectural insight that matters most: **never send decoded video frames across the IPC bridge.** Let the browser do what it's excellent at (hardware video decoding) and let Rust do what it's excellent at (real-time audio processing, lock-free concurrency, rational timecode math). The `AtomicU64` → poller thread → Tauri Channel → SharedArrayBuffer → `requestVideoFrameCallback` pipeline respects every thread's constraints: zero-cost in the RT audio callback, sub-millisecond IPC, and main-thread-jank-free sync in the frontend.

For SMPTE math, the non-negotiable rule is rational arithmetic everywhere — `Rational64` via the `vtc` crate or equivalent. Drop-frame is purely a display-layer concern; internally, always work with linear frame numbers. And for the video file pipeline, FFmpeg (via `rsmpeg` or `ffmpeg-next`) is the only realistic choice — statically linked for zero-dependency distribution, handling import (audio extraction), thumbnail generation, and export (stream-copy video + encode new audio) in a single, well-understood dependency.
