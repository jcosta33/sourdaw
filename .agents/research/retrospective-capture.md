# Retrospective capture architecture for a Rust + Tauri DAW

**Continuously buffering MIDI and audio so users can retroactively "capture" what they just played is achievable with a strict, allocation-free architecture built on lock-free SPSC ring buffers, a dedicated disk-writer thread, and pre-allocated memory pools.** This approach eliminates the "psychological tax of recording" — the creative inhibition that comes from needing to arm a track and press Record before playing. Ableton Live's Capture MIDI remains the gold standard for UX, pairing always-on buffering with automatic tempo detection and loop boundary inference. The architecture described here adapts those principles to a Rust/CPAL/Tauri v2 stack, following the cardinal rules of real-time audio programming: no allocation, no locks, no I/O, no blocking syscalls on the audio thread.

---

## How major DAWs implement retrospective capture

The DAW landscape reveals two tiers of sophistication: Ableton Live and MOTU Digital Performer perform intelligent analysis (tempo detection, loop boundaries) on captured material, while all other DAWs simply dump raw MIDI against the existing timeline.

**Ableton Live's Capture MIDI** (introduced in Live 10, 2018) sets the benchmark. Live continuously buffers MIDI on all armed/monitored tracks with a rolling FIFO of **16,384 events** — when this limit is reached, the **oldest 1,024 events are batch-evicted**. The feature's intelligence depends on context. When the transport is stopped and no clips exist, Capture MIDI analyzes inter-onset intervals (IOIs) to detect tempo, constraining results to the **80–160 BPM range** to avoid octave ambiguities (e.g., confusing 70 BPM quarter notes with 140 BPM eighth notes). It then sets loop boundaries at power-of-two bar counts (1, 2, 4, or 8 bars), with overflow material placed before the clip start marker. Ableton recommends "ending on the first beat of the next bar" to help the algorithm detect phrase boundaries — strongly suggesting it searches for a repeated downbeat pattern. When the transport is running or clips already exist, Capture MIDI preserves the existing tempo and instead detects "a meaningful musical phrase" for looping. It never auto-quantizes notes.

**Logic Pro's Flashback Capture** (renamed in Logic Pro 11.2, 2025) takes a simpler approach. It buffers MIDI continuously on focused software instrument tracks, with a **20-second idle timeout** that discards older events after a pause. Logic added audio capture in version 11.2 — up to **1 minute of audio** — but requires the transport to be running. Critically, Logic performs **no tempo detection** on captured material. Events are placed against the existing project timeline, and a 1.5-bar gap rule hides older material that preceded a pause.

**FL Studio's Dump Score Log** is one of the earliest implementations, always running in the background with no option to disable. The buffer holds **3–30 minutes** of MIDI (expanded over time). It performs no tempo or phrase analysis — raw events are dumped into the Piano Roll of the selected pattern, requiring manual cleanup.

**Cubase's Retrospective Record** offers a configurable buffer up to **100,000 MIDI events** (approximately 2.5 minutes at moderate density, or just 20 seconds with expressive MPE controllers like ROLI Seaboard). It must be explicitly enabled in Preferences and has known reliability quirks — hitting Stop before triggering the feature can cause data loss, and some users report a ~30ms timing offset.

**MOTU Digital Performer** stands out as the only DAW besides Ableton to offer tempo intelligence on stopped performances. DP can "tempo-analyze the performance and conform it to the project tempo." It also supports **audio retrospective capture** with a default **5-minute buffer** consuming **1 GB of RAM**.

**Studio One** (v5.1+) and **REAPER** (v6.67+) provide per-track MIDI buffers with timeline-referenced placement but no tempo or loop detection. Bitwig Studio has no native feature — a notable gap that community scripts and third-party plugins attempt to fill.

| DAW               | Tempo detection | Audio capture | Buffer size       | Loop detection |
| ----------------- | :-------------: | :-----------: | ----------------- | :------------: |
| Ableton Live      |  ✅ 80–160 BPM  |      ❌       | 16,384 events     |       ✅       |
| Logic Pro         |       ❌        |   ✅ 1 min    | 20s idle timeout  |       ❌       |
| FL Studio         |       ❌        |      ❌       | 3–30 min          |       ❌       |
| Cubase            |       ❌        |      ❌       | Up to 100K events |       ❌       |
| Digital Performer |       ✅        |   ✅ 5 min    | 1 GB RAM          |       ❌       |
| Studio One        |       ❌        |      ❌       | Per-track         |       ❌       |
| REAPER            |       ❌        |      ❌       | Configurable      |       ❌       |

---

## The real-time audio thread contract and what it forbids

Ross Bencina's seminal article "Real-Time Audio Programming 101: Time Waits for Nothing" (2011) establishes the cardinal rule: **"If you don't know how long it will take, don't do it."** At 48 kHz with a 256-sample buffer, the audio callback must complete within **~5.3 ms**. At 64 samples, the deadline shrinks to **~1.3 ms**. Any operation with unpredictable worst-case latency will eventually cause an audible glitch.

The forbidden operations on the real-time audio thread form a strict hierarchy. **Memory allocation and deallocation** are banned because allocators use internal locks, may request OS memory (triggering page faults), and have unpredictable timing. **Mutex acquisition** is banned because of priority inversion — a low-priority GUI thread holding a lock can block the high-priority audio thread indefinitely if preempted by a medium-priority thread. **File and disk I/O** is banned because disk seeks average ~8 ms on consumer drives, exceeding many buffer periods. **Any blocking system call** — `sleep`, `wait`, `poll`, `select`, `pthread_cond_wait` — is banned. On Apple platforms, even Objective-C message dispatch is unsafe because the runtime uses internal locks.

The recommended architecture uses **three threads** communicating via lock-free FIFO queues:

- **RT audio thread** (CPAL callback): Processes audio, reads/writes ring buffers. Zero allocation, zero locks, zero I/O.
- **UI thread** (Tauri/React): Handles user interaction, issues commands to the RT thread via lock-free queue, receives state updates back.
- **Disk/worker thread**: Performs file I/O, memory allocation, and any other blocking work. Communicates with the RT thread via SPSC queues.

This architecture is validated by every major open-source audio engine. **Ardour** uses a dedicated "Butler" thread that drains per-track ring buffers to disk files, woken by a cross-thread signal. **JACK's `capture_client.c`** demonstrates the canonical pattern: the RT callback writes to a `jack_ringbuffer_t`, then uses `pthread_mutex_trylock` (non-blocking) to signal the disk thread. Bencina's own 2014 paper "Interfacing Real-Time Audio and File I/O" formalizes this with pre-allocated buffer pools shuttled between threads via lock-free queues.

---

## Lock-free audio ring buffer architecture in Rust

The core data structure for continuous audio capture is an **overwriting SPSC ring buffer** — the producer (RT thread) writes continuously, and old data is silently overwritten when the buffer wraps. This differs from a standard SPSC queue where the producer fails when full.

**Memory budget calculation** drives buffer sizing. At stereo 48 kHz with 32-bit floats: **~22 MB per minute**, **~110 MB for 5 minutes**, **~220 MB for 10 minutes**. For 8 channels at 48 kHz, 10 minutes requires **~880 MB**. A practical default is **5–10 minutes of stereo audio within a 500 MB cap**.

The recommended Rust crate stack:

- **`rtrb`** (v0.3.3) — The top recommendation for the SPSC channel between the CPAL callback and the background thread. Designed explicitly for real-time audio by Matthias Geier of the Rust Audio community. It is **wait-free** (stronger than lock-free), allocates only on construction, supports `#![no_std]`, and provides a chunk API (`write_chunk_uninit`, `read_chunk`) for efficient batch transfers matching audio callback buffer sizes. It originated from a well-reviewed crossbeam PR that was never merged.
- **`basedrop`** — Provides `Owned<T>` and `Shared<T>` smart pointers that defer deallocation to a non-RT `Collector` thread, preventing `free()` from ever executing on the audio thread. The companion **`rtrb_basedrop`** fork ensures the ring buffer's own backing memory is also safely deallocated.
- **`assert_no_alloc`** — A custom global allocator that **aborts or warns** if any allocation occurs within a marked zone. Invaluable for catching hidden allocations from formatting, Vec resizing, or Drop implementations during development.
- **`ringbuf`** — An alternative offering `StaticRb` (const-generic, zero-heap, `#![no_std]` + `#![no_alloc]`) and overwrite mode, though overwrite mode requires exclusive access. Used in CPAL's official `feedback.rs` example.

The architecture separates the continuously-writing ring buffer from the SPSC transport channel:

```
CPAL Input Callback (RT Thread)
    │
    ├──→ [Overwriting Ring Buffer]  ←── Pre-allocated at init
    │     Monotonic write_position       (e.g., 10 min stereo = 220 MB)
    │     capacity = next_power_of_2(frames_needed)
    │     index = write_position % capacity
    │
    └──→ [rtrb SPSC Channel]  ──→  Background Worker Thread
          For commands/metadata           │
          (not bulk audio data)           ├── Maintains rolling buffer copy
                                          ├── Handles capture snapshots
                                          └── Writes WAV files to disk
```

The overwriting ring buffer uses a **monotonically increasing `AtomicU64` write position** rather than a wrapping index. The actual buffer index is `write_position % capacity` (or `write_position & mask` with power-of-two sizing). A 64-bit counter at 48 kHz would overflow after **~12 million years**. The RT thread stores each incoming frame with a relaxed atomic store on the data, then publishes the new write position with a **release** store. Any consumer reads the position with an **acquire** load, establishing the necessary happens-before relationship.

**Pre-allocation and page-locking** are essential. All ring buffers must be allocated at application startup, every page must be touched (pre-faulted) to ensure physical memory mapping, and the memory must be locked with `mlock()` (POSIX) or `VirtualLock()` (Windows) to prevent the OS from swapping it out. In Rust:

```rust
// At initialization — before audio starts
let mut buffer = vec![0.0f32; capacity];
// Touch every page to trigger physical allocation
for i in (0..buffer.len()).step_by(4096 / std::mem::size_of::<f32>()) {
    buffer[i] = 0.0;
}
// Pin in physical RAM (platform-specific)
unsafe { libc::mlock(buffer.as_ptr() as *const _, capacity * 4); }
```

---

## The capture moment — snapshotting without disrupting the RT thread

When the user clicks "Capture," the system must extract the last N seconds/minutes from the ring buffer, write it to a persistent file, and present it as a clip — all without touching the RT thread. The entire operation is orchestrated by the UI thread and executed by the worker thread.

**Step 1: Atomic snapshot.** The UI thread reads `write_position` with an acquire load. It computes `start_position = write_position - desired_capture_frames`. These two values define the capture region. The UI thread does not modify any shared state — it only reads.

**Step 2: Dispatch to worker thread.** The UI thread sends a `CaptureRequest { start_position, end_position, destination_buffer_id }` via a lock-free queue to the worker thread. Destination buffers are drawn from a **pre-allocated pool** of linear buffers sized for the maximum capture duration.

**Step 3: Copy and verify.** The worker thread copies the ring buffer region into the linear destination buffer using modular indexing. After copying, it re-reads `write_position` and verifies that `current_write_position - start_position < capacity`. If this check fails, the RT thread has overwritten part of the captured region — the worker marks the capture as partial and truncates to the valid portion. The safety margin should be **2–3 seconds** less than the full buffer capacity.

**Step 4: Write to disk.** The worker thread writes the linear buffer as a WAV file using a library like `hound` or `symphonia`. It then creates clip metadata (file path, sample rate, channel count, duration, position on timeline) and sends it back to the UI thread via another lock-free queue or Tauri event.

**Step 5: Present in UI.** The UI thread receives clip metadata and emits a Tauri event to the React frontend, which renders the new clip on the timeline. The entire flow never interrupts the audio callback.

For the Tauri v2 integration, audio threads must be standard OS threads (`std::thread::spawn`), not Tokio tasks. Communication to the React frontend uses Tauri's event system (`app_handle.emit("capture-complete", metadata)`), and large binary transfers should use `tauri::ipc::Response` for optimized binary serialization rather than JSON.

---

## MIDI event buffering with sample-accurate timestamps

The MIDI ring buffer uses a **fixed-size array of MIDI event structs** with absolute audio frame timestamps. The recommended struct is compact:

```rust
#[repr(C)]
#[derive(Copy, Clone)]
struct MidiEvent {
    timestamp: i64,  // Absolute audio frame count
    status: u8,      // Status byte (0x80–0xEF)
    channel: u8,     // 0–15
    data1: u8,       // Note number or CC number
    data2: u8,       // Velocity or CC value
}
// 12 bytes with natural alignment
```

**Absolute audio frame count** is the correct timestamping mechanism. It provides sample-accuracy by definition, requires no conversion for audio timeline alignment, and can be derived from the monotonically increasing frame counter maintained by the audio callback. At 96 kHz, an `i64` represents over 3 million years. This timestamp converts to wall-clock time via `frame_count / sample_rate` and to musical time via a tempo map lookup.

**Buffer sizing** should be generous. A buffer of **65,536 events** (power-of-two for bitmask wrapping) consumes roughly **768 KB** — negligible. At moderate playing density (~200 events/minute for simple piano), this provides ~80 minutes of capture. At high MPE density (~5,000 events/minute), it provides ~13 minutes. Ableton's 16,384-event buffer with batch eviction of 1,024 events is a proven alternative that slightly reduces memory but limits capture duration with expressive controllers.

**Orphaned notes** at ring buffer boundaries are the most critical edge case. When the buffer wraps and overwrites a Note-On, the corresponding Note-Off becomes orphaned. When a note is still held at capture time, there's a Note-On with no Note-Off. The solution is a **128×16 active note tracking table** maintained alongside the ring buffer:

```rust
struct ActiveNote {
    is_active: bool,
    velocity: u8,
    timestamp: i64,
}
// 128 notes × 16 channels = 2,048 entries × 10 bytes ≈ 20 KB
let active_notes: [[ActiveNote; 128]; 16];
```

On every Note-On, the table records `{true, velocity, timestamp}`. On every Note-Off, it clears the entry. At capture time, the system scans the table and injects **synthetic Note-Ons** at the buffer start for any note whose original Note-On was overwritten, and **synthetic Note-Offs** at the capture end for any note still held. Sustain pedal state (CC #64) must also be tracked — if the pedal is down at capture, inject the pedal-on event at the capture start.

---

## Tempo detection and loop boundary inference from free-played MIDI

Tempo detection from unquantized MIDI input is significantly simpler than audio-based beat tracking because note onsets are known exactly — no onset detection is needed. The core algorithm operates on **inter-onset intervals (IOIs)** between consecutive Note-On timestamps.

The recommended approach combines three techniques:

**IOI histogram analysis** forms the foundation. Compute all IOIs from consecutive note-on events, bin them at ~1 ms resolution, and build a histogram. Peaks in the histogram correspond to common rhythmic subdivisions (sixteenth notes, eighth notes, quarter notes). The peak matching a quarter-note duration yields the tempo estimate. **Constraining the valid range to 80–160 BPM** (Ableton's approach) elegantly resolves octave ambiguity — a performance at 70 BPM is reported as 140 BPM, and one at 200 BPM is reported as 100 BPM.

**Autocorrelation refinement** sharpens the estimate. Create an onset function (impulses at each note-on time), compute autocorrelation for lag values corresponding to 60–200 BPM (300 ms to 1 s), and find the peak. A **log-Gaussian weighting** centered around ~120 BPM (used by the Beat-and-Tempo-Tracking library) biases toward moderate tempos, matching human musical expectations.

**Velocity weighting** breaks ties. Louder notes (higher velocity) are more likely to fall on strong beats. Weighting IOI contributions by velocity improves downbeat detection, which is harder than tempo detection.

For **loop boundary detection**, the system should snap captured material to the nearest **power-of-two bar count** (1, 2, 4, 8, 16 bars) at the detected tempo. Material before the detected phrase start goes before the clip start marker (accessible but not looping). The algorithm should search for the longest phrase that fits a power-of-two bar count, anchored to the most likely downbeat. Ableton's recommendation to "end on the first beat of the next bar" suggests the algorithm uses the final note-on as a downbeat anchor and works backward.

**Time signature detection** remains an unsolved problem — no DAW auto-detects time signatures from captured MIDI. The practical approach is to **default to 4/4** and allow easy post-capture adjustment.

---

## Asynchronous disk flushing and the worker thread

The disk-writing architecture follows Bencina's 2014 pattern of **pre-allocated buffer pools shuttled between threads via lock-free queues**. The worker thread serves three roles: draining the SPSC transport channel, maintaining a rolling copy of recent audio for fast capture, and writing capture files to disk.

**For continuous audio buffering**, the worker thread runs a poll loop (sleeping ~10 ms between iterations) that drains the `rtrb` consumer into its own rolling circular buffer. This secondary buffer on the worker thread is the authoritative capture source — the RT thread's ring buffer exists only as a transport mechanism. This two-stage design means the capture snapshot operation operates entirely on the worker thread's data, with zero contention against the RT thread.

**For capture-to-disk**, the worker thread receives a `CaptureRequest`, extracts the relevant portion of its rolling buffer into a pre-allocated linear buffer, and writes a WAV file using the `hound` crate. File handles are opened and closed exclusively on this thread — never on the RT thread.

**Pre-allocated buffer pools** eliminate allocation during capture. At initialization, allocate a pool of N linear buffers (e.g., 4 buffers each sized for the maximum capture duration). The worker thread acquires a buffer from the pool, fills it, writes it to disk, then returns it. If the pool is exhausted (unlikely — captures are infrequent), the capture request is queued until a buffer is freed.

The **Creek** crate (from the Meadowlark DAW project) demonstrates this pattern in production Rust code: it implements realtime-safe disk streaming with cache buffers, look-ahead buffers, and an IO server thread, all communicating via message passing.

---

## Memory management — pre-allocation, caps, and garbage collection

All memory used by the retrospective capture system must be allocated at initialization and never freed during audio processing. The allocation budget should be user-configurable with a sensible default:

- **Audio ring buffer**: 220 MB for 10 minutes stereo at 48 kHz (or proportionally less for shorter durations / more for multi-channel)
- **MIDI event buffer**: ~1 MB for 65,536 events
- **Active note table**: ~20 KB
- **Capture snapshot pool**: 4 × maximum capture duration (e.g., 4 × 220 MB = 880 MB if full-buffer captures are allowed, or 4 × 22 MB = 88 MB for 1-minute captures)
- **SPSC command queues**: ~64 KB each
- **Total default budget**: ~300–500 MB depending on configuration

The `basedrop` crate handles the deferred-deallocation problem. When `Arc<T>` or `Box<T>` is dropped on the audio thread, `free()` would execute — a blocking operation. Basedrop's `Owned<T>` and `Shared<T>` replace standard smart pointers, deferring all deallocation to a background `Collector` thread via a wait-free MPSC queue. The `SharedCell<T>` provides atomic publish/observe semantics for sharing immutable data between the RT and non-RT threads.

**Ring buffer wrap-around** is transparent. The monotonically increasing `write_position` never wraps (64-bit). The actual storage index wraps via `write_position & mask`. Old data is silently overwritten. The only concern is ensuring that a capture snapshot completes before the RT thread overwrites the start of the captured region — enforced by the safety margin check described earlier.

**The `assert_no_alloc` crate** should be enabled in debug builds as the final line of defense. It replaces the global allocator with one that panics on any allocation within a marked zone, catching hidden allocations from string formatting, Vec resizing, iterator collection, or implicit Drop implementations.

---

## Conclusion: key architectural decisions

The research converges on a clear set of design choices. Use **`rtrb`** as the primary SPSC channel, with an overwriting ring buffer for the actual audio storage and `basedrop` for deferred deallocation. Timestamp all MIDI events with **absolute audio frame counts** and maintain a 128×16 active note tracking table for orphaned note recovery. Implement **IOI histogram analysis constrained to 80–160 BPM** for tempo detection, with autocorrelation refinement and velocity weighting. Snap loop boundaries to **power-of-two bar counts** in 4/4 time.

The most significant architectural insight is the **two-stage buffer design**: the RT thread writes into a lock-free ring buffer that serves purely as a transport pipe, while the worker thread maintains its own rolling copy as the authoritative capture source. This completely decouples the capture operation from the audio thread — the user can click "Capture" without any risk of glitches.

The gap in the market is notable. Only Ableton and Digital Performer offer tempo-intelligent capture. Implementing tempo detection with loop boundary inference in a Rust DAW would immediately match or exceed the capture UX of every other DAW. The combination of Ableton-style MIDI intelligence with Digital Performer-style audio capture (5+ minutes in RAM) would be genuinely best-in-class.
