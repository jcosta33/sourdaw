# Per-quantum device cost — every device, native and wasm

**AC-2 of `SPEC-render-parity-instrumentation`.** What one AudioWorklet render quantum of each
device costs, measured natively and — the leg that answers the question — as the committed wasm
build inside a real `AudioWorkletGlobalScope`.

## The budget, and why it is that number

**2.667 ms.** An `AudioWorkletProcessor` renders 128 frames per call, fixed by the Web Audio
specification, and the project runs at 48 kHz: 128 / 48 000 = 2.6667 ms of wall clock per call. It is
the sample rate and the spec, not a policy anyone can revisit. Exceeding it does not degrade quality,
it drops audio.

The whole budget belongs to the **sum** of everything on the audio thread. A row at 40% is not
comfortable.

## The machine and the browser

A number without its machine is not a measurement.

| | |
| --- | --- |
| Machine | Apple M4 Pro (`Mac16,11`), 8 performance + 4 efficiency cores, 24 GB |
| OS | macOS 26.6 (25G72), arm64 |
| Browser | **Google Chrome 150.0.7871.187**, stable channel, headless, driven by Playwright |
| User agent | `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/150.0.0.0 Safari/537.36` |
| Rust | `nightly-2026-04-14`, release profile with `CARGO_PROFILE_BENCH_LTO=false` |
| **`main` SHA** | **`8a96bdafd6605daa098c2851bdfab2fdeb8a1db3`** |
| Date | 2026-08-02 |
| Machine load | 1-minute average 2.30 → 3.43 (native), 3.41 → 3.86 (wasm), against a ceiling of 6.0 |

The SHA matters more than usual here. PRs #925, #946, #825 and #947 are changing Grand Boule, Levain
and Grinder DSP right now, so this is a baseline of a moving target — deliberately. A baseline taken
now becomes the gate those PRs must not regress; a baseline taken after them measures their result
rather than gating it.

## Method

Both legs run the same recipes, the same excitation and the same statistics, so the columns are
comparable line for line.

- **Warm-up:** 4000 quanta per device, discarded. The warm-up runs the *identical* loop body to the
  timed pass, clock reads included. An earlier version warmed up through a cheaper untimed loop and
  every row's first 500 timed samples came out 20–60% above its own median — the DSP was hot and the
  timed loop was not. Each row reports its first-500 vs last-500 mean so a run that was still
  settling is visible rather than averaged away.
- **Samples:** 20 000 timed quanta per device — 53.3 s of that device's rendered audio.
- **`black_box` / sink:** every render's return value is consumed, natively via `std::hint::black_box`
  and in wasm via an accumulator posted back with the results, so nothing can be optimised away.
- **Occupancy, verified in-run:** each row is verified *after* the timed pass, through the device's
  own `active_voices()` export where it has one and output RMS where it does not. A row that fails
  its check fails the run instead of printing a number.
- **The clock, in wasm:** **Chrome exposes no `performance` inside an `AudioWorkletGlobalScope`.**
  Probed on Chrome 150: the only clock-shaped globals are `Date` (1 ms) and `currentTime` (the audio
  clock, which advances by exactly one quantum per render call however long that call took). Neither
  can resolve a 20 µs device. `SharedArrayBuffer` and `Atomics` *are* exposed, so a spinning worker
  writes a counter into shared memory and the worklet reads it either side of each render. Calibrated
  against the page's own `performance.now()` before and after the run: **191 669 → 193 454 ticks/ms,
  +0.93% drift, 1 tick = 5.2 ns.** The measured harness floor — two clock reads with no render — is
  below one tick at the median.
- **Cross-check:** each wasm row's summed compute is asserted to be less than its own elapsed wall
  clock, measured independently by `Date.now()` in the worklet and `performance.now()` on the main
  thread. All thirteen hold.
- **Machine-load gate:** the run refuses to publish if the 1-minute load average exceeds half the
  logical cores. This is not decoration — the first full run of this table was taken while another
  agent worktree ran the whole vitest suite at load 25, and Grand Boule's p99 came out at 17.9 ms
  against a 1.1 ms median. A later re-take tripped the guard for real and exited 101.

**The wasm host is an `OfflineAudioContext`, one per device.** Two consequences, stated rather than
buried: an offline render has no deadline, so this measures **cost** and cannot observe a dropout
(that is AC-3's job — *"its compute exceeds the budget"* and *"it misses the deadline"* are different
claims); and one device per context is the *favourable* case for cache residency, so a full mix's
per-device cost is at least this.

## The table

Per quantum, as a percentage of the 2.667 ms budget. n = 20 000 per row.

### wasm — Chrome 150, inside a real `AudioWorkletGlobalScope`

**This is the column that answers the question.** Production compiles this DSP to wasm and runs it
in a browser worklet.

| Device | median | p95 | p99 | median % | p95 % | p99 % |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **Grand Boule** — 64 voices, re-struck 1/s | 1774.9 µs | 2571.2 µs | 2659.3 µs | **66.6%** | **96.4%** | **99.7%** |
| **Crumbs** — 32 sounding voices | 311.0 µs | 339.9 µs | 367.7 µs | **11.7%** | 12.7% | 13.8% |
| **Grinder** — Crunch JCM, lead ch, gain 8.2 | 119.1 µs | 147.3 µs | 183.5 µs | 4.5% | 5.5% | 6.9% |
| **Toaster** — 16 pads, re-struck 1/s | 104.6 µs | 123.4 µs | 133.4 µs | 3.9% | 4.6% | 5.0% |
| **Proof** — limiter engaged | 61.9 µs | 66.7 µs | 77.0 µs | 2.3% | 2.5% | 2.9% |
| **Fermenter** — 16 sounding voices, 1 layer | 33.3 µs | 34.6 µs | 40.8 µs | 1.2% | 1.3% | 1.5% |
| **ProofChamber** — FDN-16, heaviest selectable | 22.6 µs | 23.5 µs | 28.6 µs | 0.8% | 0.9% | 1.1% |
| **Levain** — 32 sounding voices | 19.8 µs | 20.7 µs | 24.6 µs | 0.7% | 0.8% | 0.9% |
| **Bacteria** — 3 bands, mix 1.0 | 15.5 µs | 16.8 µs | 18.4 µs | 0.6% | 0.6% | 0.7% |
| **ProofChamber** — Plate, shipped default | 6.2 µs | 6.4 µs | 7.0 µs | 0.2% | 0.2% | 0.3% |
| **Gluten** — 4:1, −24 dB, compressing | 5.6 µs | 6.3 µs | 6.5 µs | 0.2% | 0.2% | 0.2% |
| **Knead** — +4 semitones, PSOLA engaged | 0.5 µs | **1016.0 µs** | **1079.7 µs** | 0.0% | **38.1%** | **40.5%** |
| **Scoring / Tuner** — pitch detection running | 1.0 µs | 213.3 µs | 227.0 µs | 0.0% | 8.0% | 8.5% |
| *(harness floor — two clock reads, no render)* | 0.0 µs | 0.0 µs | 0.0 µs | 0.00% | 0.00% | 0.00% |

### native — aarch64, same recipes

A lower bound, not the answer. Kept because a native/wasm ratio per device is useful and because it
is the leg CI could plausibly run.

| Device | median | p95 | p99 | median % | wasm ÷ native (median) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Grand Boule — 64 voices | 1082.6 µs | 1113.2 µs | 1161.1 µs | 40.6% | **1.64×** |
| Crumbs — 32 voices | 174.8 µs | 181.6 µs | 201.5 µs | 6.6% | **1.78×** |
| Toaster — 16 pads | 128.6 µs | 146.6 µs | 154.5 µs | 4.8% | 0.81× |
| Grinder — Crunch JCM | 94.2 µs | 102.4 µs | 107.5 µs | 3.5% | 1.26× |
| Proof — limiter engaged | 43.3 µs | 47.8 µs | 103.2 µs | 1.6% | 1.43× |
| Fermenter — 16 voices | 37.7 µs | 38.0 µs | 43.5 µs | 1.4% | 0.88× |
| ProofChamber — FDN-16 | 14.9 µs | 16.0 µs | 23.6 µs | 0.6% | 1.52× |
| Levain — 32 voices | 20.8 µs | 21.3 µs | 26.8 µs | 0.8% | 0.95× |
| Bacteria — 3 bands | 10.7 µs | 10.8 µs | 10.9 µs | 0.4% | 1.45× |
| ProofChamber — Plate | 4.7 µs | 6.1 µs | 11.8 µs | 0.2% | 1.32× |
| Gluten — 4:1 | 4.2 µs | 4.6 µs | 4.7 µs | 0.2% | 1.33× |
| Knead — +4 semitones | 0.5 µs | 719.8 µs | 801.4 µs | 0.0% | 1.41× (at p95) |
| Scoring / Tuner | 0.8 µs | 186.1 µs | 198.6 µs | 0.0% | 1.15× (at p95) |
| *(timer floor — `Instant::now()` twice)* | 0.000 µs | 0.042 µs | 0.042 µs | 0.0016% | — |

ProofChamber and Scoring native figures come from
`crates/proof-chamber/tests/quantum_cost.rs` and `crates/scoring/tests/quantum_cost.rs`; the rest
from `crates/daw-dsp/benches/quantum.rs`. The reason for the split is in those files' headers:
making them rows of `daw-dsp`'s bench would pull their sources into `daw-dsp`'s wasm crate-source
hash, so editing a reverb would invalidate the DSP crate's committed artifacts.

The remaining ProofChamber algorithms, native: FDN-8 9.0 µs (0.34%), Spring 13.0 µs (0.49%), Reverse
0.2 µs (0.01%). Convolution and Hybrid are not measured — `set_param` falls both through to Plate
because no impulse response ships and `load_ir` has no caller, so measuring them would benchmark
Plate under another name.

**The wasm/native ratio is not a constant.** It ranges from 0.81× (Toaster is *faster* in wasm) to
1.78× (Crumbs). The 2.17× the original bench reported for Grand Boule is not a figure that can be
applied to another device. Anything that needs a wasm number has to measure a wasm number.

## The reference project

**Nothing in the repository defines "the reference project."** `SPEC-render-parity-instrumentation`
AC-2 and `SPEC-browser-dsp-offload` AC-002 both argue from it and neither says what it contains.
Rather than quietly pick numbers, this is the composition, so a later reader can dispute the mix
instead of the arithmetic — a plausible six-track session with an ordinary effect load:

| Count | Device |
| ---: | --- |
| 1 | Grand Boule (piano, 64 voices) |
| 1 | Fermenter (16 voices) |
| 1 | Levain (32 voices) |
| 1 | Toaster (16 pads) |
| 1 | Crumbs (32 voices) |
| 1 | Grinder (guitar) |
| 1 | Knead (tuned vocal) |
| 1 | Bacteria (creative send) |
| 1 | ProofChamber, Plate (reverb send) |
| 3 | Gluten (two track bus compressors, one on the master) |
| 1 | Proof (master bus) |

Scoring is excluded: the tuner renders only while its surface is open.

### Total, in wasm

| | ms | % of the 2.667 ms budget |
| --- | ---: | ---: |
| **Summed median** | **2.464 ms** | **92.4%** |
| Summed p95 | 4.362 ms | 163.6% |
| Summed p99 | 4.611 ms | 172.9% |
| Median without Grand Boule | 0.689 ms | 25.8% |
| p99 without Grand Boule | 1.952 ms | 73.2% |

The summed p95/p99 are pessimistic by construction: they assume every device hits its own tail in
the same quantum. The median row is the honest steady-state figure, and it is 92.4%.

Native, same mix minus ProofChamber (sibling crate, not in that bench's table): summed median
1.606 ms = 60.2%, summed p99 2.625 ms = 98.4%. Those two are summed by hand from the per-device
medians and p99s published above, because the run they come from predates adding Proof to
`REFERENCE_PROJECT`; the bench prints its own total on the next run.

Grand Boule is called out separately because it is the one device that does *not* render in the
worklet — `grandBouleEngineWorker.ts` puts it on a dedicated Web Worker behind a SharedArrayBuffer
ring. That moves it off the audio thread; it does not make it free, and on a 4-core machine it is
competing for the same silicon.

## What this reorders — survey stop condition 6

**Reported, not acted on.** Per the spec: *"This table reorders the programme … Report that rather
than silently reordering."*

**The reference project sits at 92.4% of the worklet budget at the median before any optimisation
work exists.** Three findings follow, in order of how much they should move the programme:

1. **Grand Boule alone is 66.6% of budget at the median and 99.7% at p99, in wasm.** The claim in
   `grandBouleEngineWorker.ts` that it cannot meet the worklet deadline is now measured and correct.
   But it is worse than the Worker offload makes it look: 99.7% at p99 means one quantum in a
   hundred consumes essentially the entire real-time budget of a whole core. Moving it to a Worker
   moves the *deadline*, not the *cost*.
2. **Knead is bimodal and nobody would see it in a mean.** Median 0.5 µs, p95 1016 µs — 38% of
   budget. PSOLA does nothing for most quanta and then does everything at a hop boundary. A device
   whose *average* cost is ~65 µs (2.4% of budget) spikes to 40% of budget on roughly one quantum in
   twenty. Scoring has the same shape (median 1.0 µs, p95 213 µs). **This is the argument for
   reporting a distribution.** Two devices in the table would have been reported as trivially cheap
   by any mean-only bench, and both are among the largest single contributors to the p95 sum.
3. **Crumbs at 11.7% is higher than a sampler ought to be** and is the largest wasm/native
   penalty in the table (1.78×).

If the CPU findings were scheduled as hygiene behind the parity work, that ordering is wrong: the
reference project does not fit today. Whether to re-order is the owner's call, not this table's.

## Caveats, in full

- **The far tail is not DSP cost.** Both legs run on normal-priority threads, not the realtime
  priority a browser gives its audio thread. A p99.9 or max in the tens of milliseconds is the OS
  descheduling mid-render, plus V8 GC in the wasm leg. Read median through p99 as the device.
- **The max is not a worst case.** 20 000 samples is 53 s of one device's audio; a session renders on
  the order of 1.7M quanta an hour. The tail is understated, not bounded.
- **Two rows drifted more than the rest during the wasm run** and are reported rather than smoothed:
  Grinder −30.9% first-500 to last-500 (still tiering up, or the amp's sag and model compressor still
  settling — its *median* is the reliable figure), and Crumbs +45.4% (rising; the timed figure is
  therefore closer to a lower bound than a middle). Every other row drifted under 4%.
- **One device per context** is the best case for cache residency. A real mix has a dozen competing
  for L2.
- **Crust, Yeast and CvGate are absent** because they have no Rust engine at all. Their cost is
  JavaScript, which this instrument does not measure and does not claim to.
- **Two constructed voice counts cannot be reached**, and both are load-bearing for reading the
  table:
  - **Fermenter** is constructed with 32 voices (`fermenterProcessor.ts:164`) and tops out at 16.
    `MasterSynth::new` discards its `max_voices` argument and a `Layer` owns a fixed 16-voice pool,
    so the shipped single-layer patch cannot exceed 16.
  - **Levain** is constructed with 64 (`levainProcessor.ts:149`, also `MAX_VOICES_WASM`) and settles
    at 32. Legato ships enabled and `LegatoEngine::note_on` returns `SyntheticGlide` for any note
    within 12 semitones of a held one, reusing the held voice; 64 notes across 88 keys are ~1.4
    semitones apart, so every other one glides. The row is reported at the 32 it reaches, not at a 64
    obtained by switching off a shipped default.
- **Two devices fall silent if held and forgotten**, which the first draft of this table did and
  which its own header warned against. Over 53 s a struck Grand Boule voice decays to an output RMS
  of 1e−9 and 16 struck Toaster pads decay to *exact zero* — while still paying full price, because
  the quality demotion reads the release envelope, pinned at 1.0 with the key down. Both now
  re-strike once a second, which is what a pedalled piano and a drum machine do anyway. Crumbs needed
  its zone looped for the same reason: a one-shot voice pitched 48 semitones above the root plays a
  one-second sample in 62 ms, and unlooped the pool drained from 32 voices to 12 during the *warm-up*.

## Reproducing

```text
# native — daw-dsp devices, plus the cross-check criterion groups
CARGO_PROFILE_BENCH_LTO=false cargo bench -p daw-dsp --bench quantum

# native — the two sibling crates
CARGO_PROFILE_RELEASE_LTO=false \
  cargo test -p proof-chamber --release --test quantum_cost -- --ignored --nocapture
CARGO_PROFILE_RELEASE_LTO=false \
  cargo test -p scoring --release --test quantum_cost -- --ignored --nocapture

# wasm — Chrome, in a real AudioWorkletGlobalScope
node crates/daw-dsp/benches/wasm/run.mjs --json /tmp/wasm-cost.json
```

`CARGO_PROFILE_BENCH_LTO=false` is required, not tidiness: the workspace release profile sets
`lto = true`, which conflicts with the `-C embed-bitcode=no` criterion's build passes. **Do not fix
that by editing `[profile.release]`** — that profile is hashed into all four wasm crate-source
fingerprints, and editing it invalidates every committed wasm artifact.

`--test quantum_cost` is also required: those two crates' *unit* tests do not build in release,
because `assert_no_alloc`'s `disable_release` feature configures `AllocDisabler` out and their
`src/lib.rs` imports it. Naming the integration-test target skips that. (`cargo test -p daw-dsp
--release` fails for the separate pre-existing `-C embed-bitcode=no` / `lto` reason, reproducible on
a pristine `origin/main`.)

Nothing here rebuilds wasm. The browser leg loads the **committed** `public/wasm/*_bg.wasm` binaries
and the committed polyfilled glue under `src/modules/AudioEngine/wasm/`, so it measures the artifact
production ships. `pnpm wasm:verify` passes unchanged and `daw_dsp_bg.wasm` is byte-identical to
`origin/main`.
