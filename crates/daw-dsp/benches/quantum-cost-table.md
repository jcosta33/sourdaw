# Per-quantum device cost — distributed browser WASM

**AC-2 of `SPEC-render-parity-instrumentation`.** What one AudioWorklet render quantum of each
released device costs as the committed WASM build inside a real `AudioWorkletGlobalScope`. The
native Criterion leg remains separate.

The marked generated region is rendered by `benches/wasm/renderTable.mjs` from
`benches/quantum-cost-table.json`, which the run emits and this branch commits. Historical
measurements and method examples outside that region are identified separately. An earlier version
transcribed every figure from console output that was never committed, which meant two later questions about the data could not be settled from the
artifact at all, only re-litigated by re-running.

## The budget, and why it is that number

**2.667 ms.** An `AudioWorkletProcessor` renders 128 frames per call, fixed by the Web Audio
specification, and the project runs at 48 kHz: 128 / 48 000 = 2.6667 ms of wall clock per call. It is
the sample rate and the spec, not a policy anyone can revisit. Exceeding it does not degrade quality,
it drops audio.

The budget belongs to the **sum of everything on the audio thread** — which is why the rest of this
document is careful about what is actually on it.

## Read this before quoting any number

### Grand Boule has two cost sites

The browser harness measures the Grand Boule DSP kernel in its worklet timing realm and assigns that
row to the production Worker cost site. It measures `grand_boule_ring_consumer` separately on the
audio thread. The generated provenance identifies the measured source for the committed record.

### Two devices are duty cycles, and their p95 is not a tail

Knead buffers to `yin_cfg.frame_size` = 2048 frames before running an analysis — one expensive
quantum in 16, 6.25%, forced unconditionally whenever `shift_semitones != 0`. Scoring analyses every
`hop = sample_rate / 30` = 1600 frames — two expensive quanta in 25, 8.0%.

Both straddle the 5% line, so **p95 and p99 land in the expensive mode by construction**. Had
`frame_size` been 4096, Knead's p95 would read ~0.5 µs instead of ~1000 µs with no change whatever to
the device. They are reported below as period, tick cost and amortised mean.

This also fixes the arithmetic. Summing every row's p99 assumes every device hits its own tail in the
same quantum, and for these two it assumes something that is not a tail at all. **The table estimates a
worst quantum as every device at its median plus the single largest duty-cycle spike.** A
previously circulated audio-thread figure of **73.2%** was a summed p99 and is superseded by the
worst-quantum row in the table below.

### Two significant figures, and why not more

Chrome exposes no `performance` inside an `AudioWorkletGlobalScope` — probed on Chrome 150, the only
clock-shaped globals are `Date` (1 ms) and `currentTime` (the audio clock, which advances by exactly
one quantum per render call however long that call took). The worklet therefore reads a
shared-memory tick counter driven by a spinning worker.

That mechanism was reproduced in Node — same V8, same scheduler, where `performance.now()` exists to
check against. It holds the median to roughly ±10% across three orders of magnitude, and **inflates
the p95 by +4% to +31% on constant work**. A before/after calibration pair is not a measure of that
error: the reproduction reported +0.59% drift on a run whose median was off +8.6% and p95 off +12.4%,
and +14.10% drift on a run at a load below the ceiling.

Two consequences, both applied: the rate is calibrated **inside each row's own timed window** in ~1 s
segments, with each sample converted using the rate of its own segment and the per-row spread
published; and everything is reported to **two significant figures**. Read a trustworthy median as the device; a row with calibration spread above 25% has an unreliable median.
Treat p95 and p99 as indicative.

## Method

- **Warm-up:** discarded quanta running the _identical_ loop body to the timed pass, clock reads
  included. Warming through a cheaper loop warms the DSP but not the loop — that mistake put every
  row's first 500 timed samples 20–60% above its own median.
- **`black_box` / sink:** every render's return value is consumed, natively via
  `std::hint::black_box` and in wasm via an accumulator posted back with the results.
- **Occupancy, verified after the timed run.** Devices with an `active_voices()` export are checked
  against it exactly. Toaster has no such export, so it is checked by **level scaling against an
  identically-driven solo voice**: independent voices sum incoherently, so N voices must land in a
  two-sided band around √N × one voice.
- **Gates run before anything is printed.** Occupancy, the wall-clock bound, the calibration spread
  and the zero-tick fraction are evaluated first. The hard calibration limit refuses the run; the
  softer 25% median-trust threshold marks a row unreliable without refusing it.
- **The wall-clock bound is independent.** Each row's total compute must fit inside a
  `performance.now()` span measured on the _main thread_, which the worklet's clock cannot influence.
  The bound this replaces compared a 20 000-sample sum against a 24 000-quantum span, so it tolerated
  a ~20% overstatement and bounded understatement not at all.
- **Machine load is recorded per row, not gated.** An earlier version refused to publish above half
  the logical cores, which on this machine meant refusing to publish at all. What is gated instead is
  the clock: the per-row rate spread, the zero-tick fraction, and an independent main-thread
  wall-clock bound. Load does not decide whether the clock is trustworthy.

**The wasm host is an `OfflineAudioContext`, one per device.** An offline render has no deadline, so
this measures **cost** and cannot observe a dropout — that is AC-3's job, and _"its compute exceeds
the budget"_ and _"it misses the deadline"_ are different claims. One device per context is also the
_favourable_ case for cache residency, so a full mix's per-device cost is at least this.

## The measurement is a pair of bounds, not a point

**This machine cannot be relied on to be quiet.** The desktop it runs on has sustained a 1-minute
load average between 20 and 180 from ordinary applications — Claude, Codex, WindowServer, Kimi — and
an earlier version of this harness gated on load and therefore produced no table at all.

The generated Provenance block records the sampled load, and every row carries its own.
That is a measurement, not a promise about the next run. The bounds below depend on each
row meeting the stated clock conditions.

The way out is one-directional, and it is what makes the result sound: **contention only ever adds
time to a sample, it never removes it.** So from a single contended run:

- the **floor** (1st percentile) is a genuine **lower bound** on what the device costs;
- the **median taken under load** is a genuine **upper bound** on what it would cost on a quiet
  machine, provided its calibration is trustworthy.

When calibration is trustworthy, both are valid measurements taken on a busy machine, and they bracket the truth. That makes the
_upper_ bound the decisive one here: if the contaminated total already fits the budget, the true
total certainly fits, and no quieter machine is needed to establish it.

**One mechanism can make a sample read short**, and it is counted rather than assumed away. The
wasm clock is a counter another thread increments, so a render that lands entirely inside a stall of
that thread reads zero. Measured here, the zero-tick fraction tracks render length — the shorter the
render, the likelier it falls inside a stall. Rows over the threshold therefore report **no floor**;
their median can still be an upper bound if its calibration is trustworthy. The
published floor is the 1st percentile rather than the raw minimum for the same reason.

The native leg is the control for this. `Instant` has no stall mode, and there the floor and the
median nearly coincide even at load 144 — ProofChamber Plate reads 4.7 µs against 4.8 µs. That is
the floor doctrine working: on a clock that cannot stall, contention leaves the low end alone.

### What these bounds can and cannot decide

- **If the floor exceeds budget, that is decisive.** The device cannot fit and no quieter machine
  will change it.
- **If a trustworthy upper bound fits, that is also decisive** — for compute.
- **Neither bounds the deadline.** They bound how long the DSP takes, not whether a quantum is
  delivered on time. The instrument for that is AC-3's dropout observation, which reads genuine
  underruns from `AudioContext.playbackStats` on a live context and is hardware-independent enough
  to run contended. The two answer different questions and neither substitutes for the other.

<!-- generated:begin -->
<!-- Generated by benches/wasm/renderTable.mjs from benches/quantum-cost-table.json.
     Do not hand-edit anything between these markers. -->

### Provenance

| | |
| --- | --- |
| Machine | Apple M4 Pro (`Mac16,11`), 8P + 4E, 24 GB |
| OS | macOS 27.2.1 (26B131), arm64 |
| Browser | **157.0.8103.78** (Google Chrome stable, headless) |
| User agent | `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/157.0.0.0 Safari/537.36` |
| **Commit measured** | **`eb5d20645e18ee1ae556804c6f2d8284ed446078`** |
| Base it sits on | `b950382aecb8e1481b3be5d21e91362b8bc5a96a` |
| Working tree | clean |
| Taken | 2026-11-15T18:02:36.011Z |
| Machine load | 12.23 before, 30.94 after — **recorded, not gated** |
| Warm-up / samples | 4000 discarded, 20000 timed quanta per row |
| Budget | 2.6667 ms = 128 frames ÷ 48 kHz |

Measured-source digests:

- `crates/daw-dsp/Cargo.toml`: `sha256:30ea4878106741e1b371229b8efb23c99c8fcd91c2123c2125e84536ca4e56cb`
- `crates/daw-dsp/benches/quantum.rs`: `sha256:fa649833acf2b5b61e6674fd1ed767f1702a952053d8918c2dcb4a2736bc5404`
- `crates/daw-dsp/benches/wasm/deviceRecipes.js`: `sha256:0dc6c36d99ec511d69cee086d049f45d70fc235e46af556f12a6639d7a4405de`
- `crates/daw-dsp/benches/wasm/quantumCostProcessor.js`: `sha256:d45a7f9b3d159725f9b8d565451f9f03fa8aae90da3a4a5029f13a4153fa8e2c`
- `crates/daw-dsp/src/grand_boule/coupled_strings.rs`: `sha256:74de8a02d5e4771e1dfc489ffcde8ba1d66cd53a08d0bbf71204800358405a21`
- `crates/daw-dsp/src/grand_boule/duplex.rs`: `sha256:4d59df85c4535bc7b68d405f143c11c023361ba4ef0c3bda3fd1b11ef145dbb6`
- `crates/daw-dsp/src/grand_boule/engine.rs`: `sha256:a485fb2984fc42475d4af2f6359e5539e16f6ef73a5574e235fe07443f11f419`
- `crates/daw-dsp/src/grand_boule/hammer.rs`: `sha256:402a1fb17d538118dced171267a9f3b251535a3faa6bab49f2b134bd3b64da15`
- `crates/daw-dsp/src/grand_boule/longitudinal.rs`: `sha256:bb43dba551a417d60568ac61ef86c0fac334724ca35a601902dd6b3a6080b5d0`
- `crates/daw-dsp/src/grand_boule/mechanical_noise.rs`: `sha256:44b06829b6d1f8290593a1f55c3fd8ee375a4063756c14110780128ad0ec3347`
- `crates/daw-dsp/src/grand_boule/midi2.rs`: `sha256:b8aba64b0e1c4c0bc8ca01b288ce9965bf0680b43e643cc07a131d23079d6b49`
- `crates/daw-dsp/src/grand_boule/mod.rs`: `sha256:3c3f7491a09643573559e7a9f8efe3229df358572a8b04ed17d27519d75c14e6`
- `crates/daw-dsp/src/grand_boule/parameters.rs`: `sha256:4bcdbdcd0753cd0056099dc5765cbe051e7540410af082b53c5e9885fe68d2ab`
- `crates/daw-dsp/src/grand_boule/pedals.rs`: `sha256:636d35fabdd69e030f2aef7883d2db6a1dc56f6e6bdf081fffc9afffb0b428c0`
- `crates/daw-dsp/src/grand_boule/radiation.rs`: `sha256:459a804db95e5a11362f38a95950963a816323f488128afcbf2104d1a7fb0e2b`
- `crates/daw-dsp/src/grand_boule/soundboard.rs`: `sha256:fc4051f5820449070caf9f9f44e0736b1b2ec0e5203e9861bd7e7ac3c94e3f1a`
- `crates/daw-dsp/src/grand_boule/string.rs`: `sha256:be562440b9c8575a9e718b78d4fd774443a3d97fe4be0308ad6c8574f81e8b39`
- `crates/daw-dsp/src/grand_boule/sympathetic.rs`: `sha256:4ccc3bec11654bde1ae712a00b6ce98cd33a4d7956f9051201a4716585a53e22`
- `crates/daw-dsp/src/grand_boule/voice.rs`: `sha256:d8ee938de8d7acc064ea393a137130c6f27e5f58d3730f6d1d9daa49fadbbb44`
- `crates/daw-dsp/src/lib.rs`: `sha256:a3e22a9b0282ce1177375575f0a2f8a8b68473513087cf5091585b4a3e5bd260`
- `crates/daw-dsp/src/primitives/alias_probe.rs`: `sha256:6759a28cd2abba94c5f4c83ceb63e7c9222ee6d5f5d6ad4846495ac9fbf36d67`
- `crates/daw-dsp/src/primitives/cutoff.rs`: `sha256:66270d6cac0ead74da7c3fd2a865aa352d8e82b8989963f16b007a89ea69e5e3`
- `crates/daw-dsp/src/primitives/db.rs`: `sha256:9430f173e7778c0f33ba2d29f6f1533a76d46a1137f87692522b4cc54b802e76`
- `crates/daw-dsp/src/primitives/denormal.rs`: `sha256:230692410860a25f76ba5ece1f6c57c2541884de1c89e1e126151a1cde9f4b8a`
- `crates/daw-dsp/src/primitives/lifecycle.rs`: `sha256:45bb2e4a2a1f7c5de824fd001650f2c3f68d4ee664a2a551bcdaa4e343404f6c`
- `crates/daw-dsp/src/primitives/mod.rs`: `sha256:feefbacaaee1d13b89ba2b872c260a3212665c31de910323adadf950cfa0f771`
- `crates/daw-dsp/src/primitives/one_pole.rs`: `sha256:cfccdbb26796971d9056cf9497ae1a04b09c8a475e3069c1efc21a7c2eb319a7`
- `crates/daw-dsp/src/primitives/oversample.rs`: `sha256:41af464d21797cdc16f256a7fff18c3aa19491ed70cf7a7d10f8bc8321bfb400`
- `crates/daw-dsp/src/primitives/pitch/mod.rs`: `sha256:d4de97ed5eff367d21fa5f29a727de58a28d1e046cb397ca21ad4f96062adbea`
- `crates/daw-dsp/src/primitives/pitch/mpm.rs`: `sha256:bcb7e1920786be77053de067c9c32ea1c36bf69bdb10f473f604b84228b27ca5`
- `crates/daw-dsp/src/primitives/pitch/overlap.rs`: `sha256:a49586dfe65ae3125119533b7243d2e446357a9bac17f16254a29d2565027b9e`
- `crates/daw-dsp/src/primitives/pitch/pipeline.rs`: `sha256:526e17f5d8deba346df54f41499ffdb1b3022ae115ae3bdca89e7e67e2870057`
- `crates/daw-dsp/src/primitives/pitch/pipeline_tests.rs`: `sha256:3eccbbdd4496dd033f0699582c42d86ab405d10d5dfd7021bb2902604a5fa4d8`
- `crates/daw-dsp/src/primitives/pitch/scoring.rs`: `sha256:25f1fc5778ac24ec6e8294af9f630f7fd4ccdf507888bfa4ff9ccb13a3eeb7df`
- `crates/daw-dsp/src/primitives/resonance.rs`: `sha256:e7b5b8a65eef506f77b1b7a91a50a923158bf9f22b10bc89b9f23c3ebd5bc572`
- `crates/daw-dsp/src/primitives/sanitize.rs`: `sha256:1839c77063e1becadb5b21114bc74e21710f82f45baaf9b24bfc31a61c8996eb`
- `crates/daw-dsp/src/primitives/time_stretch/contract.rs`: `sha256:a46de7085f640a8fbb4aa7a835986d5bbf529029f88e12ffaf9be52b962e242e`
- `crates/daw-dsp/src/primitives/time_stretch/mod.rs`: `sha256:4f3c10e72ee4c7e3d9e8b17153d20dce1a28c89c49978b4a7fce635cd4b530a0`
- `crates/daw-dsp/src/primitives/time_stretch/ratio.rs`: `sha256:4796871f652824d6df239ac9ca5e34c1a1488968274e963aa4fe8f63a137c1fa`
- `rust-toolchain.toml`: `sha256:d13306be0ecda81ce779baa290ffb417380d525928477f16200884b5169cca33`
- `scripts/quantumMeasurementCalibration.ts`: `sha256:f855e16346df2fa52abe8bad69bf73f70eba80b45a3b520559484986a2015bc3`
- `scripts/wasmToolchainPins.ts`: `sha256:c54eec5a9e399a15e8288bf6b94bc72473354d2102fa2a99baed199d71cb3d13`

### On the audio thread — these share the one 2.667 ms deadline

`≥ floor` is a lower bound. A median marked unreliable is not an upper bound; the trust flag is false or missing.
A dash means the clock stalled too often on that row for a floor to mean anything.

| Device | ≥ floor | median | median as % of budget | load | clock stalls | steady? |
| --- | ---: | ---: | ---: | ---: | ---: | :---: |
| Crumbs (32 sounding voices, in-memory pool) | 310 µs | **650 µs** | **24%** | 27 | 0.3% | **no** |
| Grinder (Crunch JCM, ch 1, gain 5 — shipped patch) | 93 µs | **130 µs** | **5%** | 12 | 0.1% | yes |
| Toaster (16 pads, re-struck 1/s) | — | **120 µs** | **4.7%** | 17 | 2.1% | yes |
| Fermenter + 1050 automated params (16 sounding voices, 1 layer) | 85 µs | **100 µs** | **3.8%** | 12 | 0.0% | yes |
| Fermenter (32 sounding voices, 1 layer) | 71 µs | **100 µs** | **3.8%** | 12 | 0.0% | yes |
| Fermenter + 90 automated params (16 sounding voices, 1 layer) | 33 µs | **77 µs** | **2.9%** | 12 | 0.4% | yes |
| Fermenter + 16 automated params (16 sounding voices, 1 layer) | 38 µs | **76 µs** | **2.9%** | 12 | 0.2% | yes |
| Fermenter + 105 automated params (16 sounding voices, 1 layer) | 63 µs | **75 µs** | **2.8%** | 12 | 0.0% | yes |
| Proof (limiter engaged) | 44 µs | **64 µs** | **2.4%** | 12 | 0.0% | yes |
| Levain (32 sounding voices, looped zone) | — | **51 µs** | **1.9%** | 17 | 1.7% | **no** |
| ProofChamber (FDN-16 — heaviest selectable) | 25 µs | **35 µs** | **1.3%** | 29 | 0.1% | yes |
| Bacteria (3 bands, distortion on, Smudge/STFT) | 11 µs | **23 µs** (unreliable median) | **0.85%** (unreliable median) | 12 | 0.5% | yes |
| Crust (true-peak limiting, 4x OS) | 5.5 µs | **19 µs** | **0.7%** | 31 | 0.6% | yes |
| Bacteria (3 bands, mix 1.0, all stages off) | 10 µs | **11 µs** | **0.41%** | 31 | 0.0% | yes |
| ProofChamber (Plate — shipped default) | 1.4 µs | **8.8 µs** | **0.33%** | 31 | 0.3% | yes |
| Gluten (4:1, -24 dB, compressing) | 0.79 µs | **7.7 µs** | **0.29%** | 12 | 0.5% | yes |
| Scoring / Tuner (pitch detection running) | — | **0.97 µs** | **0.036%** | 29 | 2.1% | yes |
| Knead (+4 semitones, PSOLA engaged) | — | **0.6 µs** | **0.023%** | 12 | 2.8% | yes |
| Grand Boule ring consumer | — | **0.24 µs** | **0.0091%** | 31 | 3.9% | **no** |

### Production cost is not on the audio thread — measured kernel cost, separate budget

| Device | ≥ floor | median | median as % of budget | load | clock stalls | steady? |
| --- | ---: | ---: | ---: | ---: | ---: | :---: |
| Grand Boule (64 voices, re-struck 1/s) — production Worker cost site | 1300 µs | **2300 µs** (unreliable median) | **87%** (unreliable median) | 12 | 0.1% | yes |


### Duty cycles, not tails

| Device | period | duty | cost in the tick | cost otherwise | amortised mean | period comes from |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| bacteria_smudge (unreliable calibration) | every 4 quanta | 25% | 1100 µs (42%) | 22 µs | **300 µs (11%)** | `stft.rs:11-12,164 — fft 2048, hop = fft/4 = 512 frames / 128 = 4 quanta` |
| knead | every 16 quanta | 6.3% | 1100 µs (41%) | 0.58 µs | **68 µs (2.6%)** | `yin_cfg.frame_size = 2048 frames / 128 = 16 quanta` |
| scoring | every 12.5 quanta | 8% | 230 µs (8.5%) | 0.94 µs | **19 µs (0.71%)** | `hop = sample_rate / 30 = 1600 frames / 128 = 12.5 quanta` |

### The reference project

Audio thread: 1 × grand_boule_ring_consumer, 1 × fermenter, 1 × levain, 1 × toaster, 1 × crumbs, 1 × grinder, 1 × knead, 1 × bacteria, 1 × proof, 3 × gluten, 1 × proof_chamber_plate.

Worker: 1 × grand_boule.

Measured at a mean 1-minute load average of **19** on 12 logical
cores. Floors remain valid under that load; medians marked unreliable are not upper bounds.

| | ms | % of 2.667 ms | |
| --- | ---: | ---: | --- |
| Audio thread, lower bound | 0.53 | 20% | partial — no floor from 4 rows, counted as zero |
| **Audio thread, upper bound** | **1.2** | **46%** | **the decisive figure** |
| Audio thread, worst quantum, upper bound | 2.3 | 87% | + the largest single duty spike |
| Worker — Grand Boule DSP | 1.3 – 2.3 | 49% – 87% | separate thread and ring; median is unreliable, not an upper bound |

**DECIDED: the upper bound already fits.**
Even measured under a load average of 19, the reference project's audio thread does not approach the deadline on compute, and a quieter machine can only lower these numbers. Compute is not the obstacle. Whether quanta are actually missed is a different question, and AC-3 owns it.

### Occupancy, verified after each timed run

- **bacteria** — after warmup: output RMS 2.908e-1; after the timed run: output RMS 2.795e-1
- **bacteria_smudge** — after warmup: output RMS 2.545e-1; after the timed run: output RMS 2.662e-1
- **crust** — after warmup: output RMS 4.844e-1; after the timed run: output RMS 2.506e-1
- **gluten** — after warmup: output RMS 2.200e-1; after the timed run: output RMS 2.133e-1
- **proof** — after warmup: output RMS 2.082e-1, limiter gain reduction -1.57 dB (required below -1 dB); after the timed run: output RMS 4.474e-1, limiter gain reduction -1.14 dB (required below -1 dB)
- **knead** — after warmup: output RMS 2.233e-1; after the timed run: output RMS 1.413e-1
- **grinder** — after warmup: engine output -4.77 dBFS; after the timed run: engine output -4.93 dBFS
- **fermenter** — after warmup: active_voices() = 32, expected 32 from 32 note-ons, output RMS 5.749e-1; after the timed run: active_voices() = 32, expected 32 from 32 note-ons, output RMS 5.208e-1
- **fermenter_automation_16** — after warmup: active_voices() = 16, expected 16 from 16 note-ons, output RMS 5.917e-1, 64000/64000 schedule visits wrote through set_param_by_id (100.0%), 0/16 schedules exhausted their segments, timeline covers 25000 quanta; after the timed run: active_voices() = 16, expected 16 from 16 note-ons, output RMS 5.462e-1, 384000/384000 schedule visits wrote through set_param_by_id (100.0%), 0/16 schedules exhausted their segments, timeline covers 25000 quanta
- **fermenter_automation_90** — after warmup: active_voices() = 16, expected 16 from 16 note-ons, output RMS 9.209e-1, 360000/360000 schedule visits wrote through set_param_by_id (100.0%), 0/90 schedules exhausted their segments, timeline covers 25000 quanta; after the timed run: active_voices() = 16, expected 16 from 16 note-ons, output RMS 5.157e-1, 2160000/2160000 schedule visits wrote through set_param_by_id (100.0%), 0/90 schedules exhausted their segments, timeline covers 25000 quanta
- **fermenter_automation_105** — after warmup: active_voices() = 16, expected 16 from 16 note-ons, output RMS 6.279e-1, 420000/420000 schedule visits wrote through set_param_by_id (100.0%), 0/105 schedules exhausted their segments, timeline covers 25000 quanta; after the timed run: active_voices() = 16, expected 16 from 16 note-ons, output RMS 5.028e-1, 2520000/2520000 schedule visits wrote through set_param_by_id (100.0%), 0/105 schedules exhausted their segments, timeline covers 25000 quanta
- **fermenter_automation_1050** — after warmup: active_voices() = 16, expected 16 from 16 note-ons, output RMS 8.936e-1, 4200000/4200000 schedule visits wrote through set_param_by_id (100.0%), 0/1050 schedules exhausted their segments, timeline covers 25000 quanta; after the timed run: active_voices() = 16, expected 16 from 16 note-ons, output RMS 9.861e-1, 25200000/25200000 schedule visits wrote through set_param_by_id (100.0%), 0/1050 schedules exhausted their segments, timeline covers 25000 quanta
- **grand_boule** — after warmup: active_voices() = 64, expected 64 from 64 note-ons, output RMS 2.401e-1; after the timed run: active_voices() = 64, expected 64 from 64 note-ons, output RMS 5.704e-2
- **grand_boule_ring_consumer** — after warmup: 4000 quanta consumed, 0 underruns (must be 0 — an underrun takes the cheap silence branch), 4000 render requests, output RMS 3.767e-1; after the timed run: 24000 quanta consumed, 0 underruns (must be 0 — an underrun takes the cheap silence branch), 24000 render requests, output RMS 3.278e-1
- **toaster** — after warmup: 16 notes, no active-voice export: output RMS 8.213e-2 is 2.3x one identically-driven voice (3.562e-2), band 1.8-8.8x around sqrt(16) = 4.0x; after the timed run: 16 notes, no active-voice export: output RMS 4.944e-2 is 3.4x one identically-driven voice (1.471e-2), band 1.8-8.8x around sqrt(16) = 4.0x
- **levain** — after warmup: active_voices() = 32, expected 32 from 64 note-ons, output RMS 1.427e+0; after the timed run: active_voices() = 32, expected 32 from 64 note-ons, output RMS 8.047e-1
- **crumbs** — after warmup: active_voices() = 32, expected 32 from 32 note-ons, output RMS 1.072e+0; after the timed run: active_voices() = 32, expected 32 from 32 note-ons, output RMS 1.734e+0
- **proof_chamber_plate** — after warmup: output RMS 2.435e-1; after the timed run: output RMS 1.919e-1
- **proof_chamber_fdn16** — after warmup: output RMS 2.451e-1; after the timed run: output RMS 1.937e-1
- **scoring** — after warmup: output RMS 2.908e-1, detected 110.1 Hz (stimulus fundamental 110 Hz); after the timed run: output RMS 2.795e-1, detected 110.1 Hz (stimulus fundamental 110 Hz)

### Clock, per row

| Device | segments | ticks/ms (median) | rate spread | compute ÷ wall | raw min | floor (p1) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| bacteria | 1 | 200000 | 0.0% | 70% | 0 µs | 10 µs |
| bacteria_smudge | 6 | 150000 | 41.6% | 101% | 0 µs | 11 µs |
| crust | 1 | 130000 | 0.0% | 80% | 0 µs | 5.5 µs |
| gluten | 1 | 130000 | 0.0% | 63% | 0 µs | 0.79 µs |
| proof | 1 | 130000 | 0.0% | 93% | 0 µs | 44 µs |
| knead | 1 | 130000 | 0.0% | 94% | 0 µs | withheld |
| grinder | 2 | 130000 | 2.5% | 96% | 0 µs | 93 µs |
| fermenter | 1 | 130000 | 0.0% | 94% | 0 µs | 71 µs |
| fermenter_automation_16 | 1 | 130000 | 0.0% | 92% | 0 µs | 38 µs |
| fermenter_automation_90 | 1 | 130000 | 0.0% | 92% | 0 µs | 33 µs |
| fermenter_automation_105 | 1 | 190000 | 0.0% | 91% | 29 µs | 63 µs |
| fermenter_automation_1050 | 2 | 190000 | 2.2% | 93% | 0 µs | 85 µs |
| grand_boule | 46 | 130000 | 62.0% | 105% | 0 µs | 1300 µs |
| grand_boule_ring_consumer | 1 | 180000 | 0.0% | 24% | 0 µs | withheld |
| toaster | 2 | 190000 | 0.7% | 84% | 0 µs | withheld |
| levain | 1 | 190000 | 0.0% | 96% | 0 µs | withheld |
| crumbs | 12 | 130000 | 10.7% | 107% | 0 µs | 310 µs |
| proof_chamber_plate | 1 | 130000 | 0.0% | 66% | 0 µs | 1.4 µs |
| proof_chamber_fdn16 | 1 | 130000 | 0.0% | 88% | 0 µs | 25 µs |
| scoring | 1 | 130000 | 0.0% | 81% | 0 µs | withheld |

<!-- generated:end -->

## Fermenter under parameter automation — what growing the binding table costs

**Question.** Fermenter declares ~105 automatable parameters and binds 16 of them for offline
automation. The objection standing in the way of binding the other 89 was that
`fermenterProcessor.ts` holds its schedules in a growing `Array` (`_paramAutomation`) and walks the
whole of it once per `process()` call, and that 90 concurrent schedules per device had never been
measured.

**The scan is on the audio thread.** `_applyParamAutomation` is called from `process()`
(`fermenterProcessor.ts:527`), inside the render callback of an `AudioWorkletProcessor`. It is not
on the scheduler's worker and it does not dissolve.

**What the per-quantum work actually is**, read before it was measured: the loop is **per schedule,
not per scheduled event**. `_handleMessage` replaces an existing entry with the same `paramId`
rather than appending, so the array length is bounded by the distinct-ordinal count — 16 today, ~105
if the table is grown — however many automation _events_ the timeline carries. Per entry the loop
does a forward-only segment-cursor advance, one linear interpolation, and — only when the value
moved — one `set_param_by_id` call across the wasm-bindgen boundary into a string-matched
`MasterSynth::set_param` cascade. That call, not the array walk, is where any cost would live. The
`findIndex` linear scan is in message handling, not in `process()`.

### Measured, wasm leg, same instrument as the table above

The historical run below used rows `fermenter_automation_{16,90,105,1050}` in
`deviceRecipes.js`. Each drove the same 16-voice Fermenter as that run's plain row, ran a
transcription of the shipped `_applyParamAutomation` over N schedules, then `process(128)`.
Ordinals cycled `paramId % 16` because only 16 existed at the time, so the
**set of parameters actually moved is identical in every row** — the DSP consequence of automation
is held constant and the difference between rows is the schedule count and nothing else.

| Row                                                                        | ≥ floor | ≤ upper bound | upper as % of budget |
| -------------------------------------------------------------------------- | ------: | ------------: | -------------------: |
| Fermenter, no automation                                                   |   43 µs |     **46 µs** |             **1.7%** |
| Fermenter + 16 automated params (today's ceiling)                          |   62 µs |     **68 µs** |             **2.6%** |
| Fermenter + 90 automated params                                            |   67 µs |     **71 µs** |             **2.7%** |
| Fermenter + 105 automated params                                           |   61 µs |     **71 µs** |             **2.7%** |
| Fermenter + 1050 automated params (amplifier, not a product configuration) |   85 µs |     **96 µs** |             **3.6%** |

Provenance: Apple M4 Pro (`Mac16,11`), macOS 26.6, Chrome **151.0.7922.76** headless, commit
`132fa4970` (base `e8eb38075`; working tree dirty — this branch adds the rows), 4000 warm-up +
20 000 timed quanta per row, load average 2.26 → 2.22, **zero clock stalls and no non-stationary row
in this run**, every automation row verifying a 100% write ratio with no schedule exhausted. An
immediately preceding run reproduced every row within 1 µs. Reproduce with
`pnpm guard --profile broad --max-rss-mib 8192 -- node crates/daw-dsp/benches/wasm/run.mjs --devices fermenter,fermenter_automation_16,fermenter_automation_90,fermenter_automation_105,fermenter_automation_1050`.

### Why there is a 1050 row

The first run of 16 / 90 / 105 came back **flat** — all three within a microsecond of each other.
Flat is consistent with a marginal per-schedule cost of zero _and_ with one of tens of nanoseconds
that 89 extra schedules cannot lift above a clock good to about ±10% on a 70 µs row. Publishing "no
measurable difference" without separating those would have been the argue-from-shape mistake this
table exists to stop. The 1050 row is 10× the target so the marginal cost clears the noise, and it
is read as `(1050 row − 105 row) / 945`.

That derived figure is an **upper bound** on the marginal cost at 105, not an estimate of it: 1050
schedules and their live segment objects are a working set past L1, where 105 of them fit, so
per-schedule cost there can only be dearer than in the configuration being decided about.

- amplifier, the figure this rests on: (96 − 71) µs ÷ 945 = **26 ns per schedule per quantum**,
  and 28 ns on the preceding run
- the direct 16 → 105 arithmetic agrees — 34 ns on both runs — but it is **not a second independent
  derivation** and should not be read as one. It divides a 3 µs numerator by 89 on rows this same
  page calls flat under a clock worth about ±7 µs at 70 µs. It is a consistency check that failed to
  contradict the amplifier, which is all it can be.

**Roughly 27 ns per schedule per quantum**, carried by the amplifier. That figure includes the
harness's own per-write counter, which sits inside the timed loop — see `automatedFermenter` — so it
is biased high, in the direction that makes the verdict safe rather than flattering.

### The answer, narrowed to what was measured

**Dispatch cost.** Walking 89 more schedules costs **89 × ~27 ns ≈ 2.4 µs per quantum**, which is
**≈ 0.09% of the 2.667 ms budget**.

**Verdict: safe to grow, on the dispatch question.** The `Array` shape does not need replacing with
a map, a sorted structure, or a per-parameter slot array. At the sizes in question the walk is not
where Fermenter's time goes — and no container choice would help anyway, because the cost that does
exist is per-call work on the far side of the wasm boundary, not the search that finds the entry.

### The proxy is the cheap end of the distribution, and that is a real limit

The rows cycle the 16 live ordinals. Those 16 are not a sample of Fermenter's parameters — **they
are the cheap tail of it**, and the bias has a direction:

- All 16 land on cheap arms. In `layer.rs:627+` thirteen are plain field stores; `cutoff`,
  `resonance` and `lfo_rate` are `SmoothedParam::set`. **None of the 16 recomputes a coefficient
  inside `set_param`, and none loops the voice array.**
- The unbound 89 include arms that do both. `FermenterDescriptor.ts:149-157` declares nine EQ
  parameters whose arms call `self.eq.set_band(...)` in `synth.rs` — a biquad recompute per call —
  and `drift` / `additive_partials` iterate all 32 voices in `layer.rs:691-702`.

So the per-parameter DSP cost of the 89 is **unmeasured here and skews expensive**. That does not
touch the dispatch verdict — no container change fixes a per-call `set_band`, so the 25 ns figure
stands on its own — but it is the number to take before automating the EQ band or `drift`.

**What these rows therefore cannot say:** the table shows a **+22 µs step** (46 → 68 µs) between no automation
and any automation. Cycling `paramId % 16` holds the set of moved parameters constant by
construction, so these rows contain **no information** about how that step scales with distinct
parameters. +22 µs is what 16 _distinct_ cheap parameters cost. Whether 105 distinct parameters —
nine of them recomputing biquads — cost 22 µs or considerably more is a separate measurement that
has not been taken. Do not read the step as already paid.

### Other limits

- **Cost, not deadline.** The host is an `OfflineAudioContext`, which has no deadline. AC-3's
  dropout observation owns that question, as everywhere else in this document.
- **One device in an empty worklet.** Same favourable-cache caveat as every other row here.

## The native leg

A lower bound, not the answer, and kept for two reasons: a per-device WASM ÷ native ratio is useful
for devices present in both targets,
and it is the leg CI could plausibly run. **The ratio is not a constant** — it ranged from 0.81× to
1.78× across the previous run of this table, so a wasm figure cannot be inferred from a native one
for any device. Native
numbers print from `cargo bench`; they are deliberately not duplicated into this document, because
a hand-copied second table is exactly the transcription problem the generated region above exists
to avoid.

ProofChamber and Scoring are measured natively by `crates/proof-chamber/tests/quantum_cost.rs` and
`crates/scoring/tests/quantum_cost.rs` rather than as rows of `daw-dsp`'s bench: making them rows
would pull their sources into `daw-dsp`'s wasm crate-source hash, so editing a reverb would
invalidate the DSP crate's committed artifacts.

## What survives, and should stay prominent

- **The reference audio-thread compute verdict depends on trustworthy contributing medians.**
  The generated reference section states whether the retained record supports that verdict;
  offline compute measurements do not establish deadline behavior.
- **Grand Boule has separate Worker-DSP and audio-thread transport rows.** Read their provenance
  and calibration qualifications before comparing them.
- **Two devices are bimodal**, and a mean-only bench would report both as trivially cheap.
- **The wasm/native ratio is not a constant**, so wasm must be measured rather than extrapolated.
- **Voice occupancy is part of the measurement.** The generated Fermenter row records 32 sounding
  voices; the historical automation run above used 16. Levain is constructed with 64
  (`levainProcessor.ts:155`, `MAX_VOICES_WASM`) and settles at 32, because shipped legato returns
  `SyntheticGlide` for any note within 12 semitones of a held one and reuses that voice.

## Caveats, in full

- **The far tail is not DSP cost.** Both legs run on normal-priority threads, not the realtime
  priority a browser gives its audio thread. A max in the tens of milliseconds is the OS
  descheduling mid-render, plus V8 GC in the wasm leg.
- **The max is not a worst case.** 20 000 samples is 53 s of one device's audio; a session renders on
  the order of 1.7M quanta an hour.
- **A row marked "no" in the steady column is not stationary**: its first-500 and last-500 means
  differ by more than 10%. Under a load average of 180 that is usually the machine rather than the
  device, which is another reason the floor is the more trustworthy column.
- **One device per context** is the best case for cache residency. A real mix has a dozen competing
  for L2.
- **The ring-consumer row drives the steady consuming path deliberately.** An underrun takes a
  cheaper branch — fill silence and return — so a row that underran would understate the cost. The
  row asserts zero underruns.
- **Yeast and CvGate are absent** because they have no Rust engine at all. Their cost is
  JavaScript, which this instrument does not measure and does not claim to.
- **Crust was absent on those grounds, wrongly, and now has a row.** This document and both bench
  legs asserted that Crust "[has] no Rust engine at all" while `crates/daw-dsp/src/crust/` shipped a
  `#[wasm_bindgen]` `CrustInstance` with a `process` export, and the committed `daw_dsp_bg.wasm`
  exported it. `crates/daw-dsp/tests/quantum_bench_census.rs` keeps native coverage independent and
  separately rejects Grand Boule from the browser-WASM import, recipe, runner, and census surfaces.
- **Bacteria has two rows, and the difference is the point.** `BacteriaEngine::new` ships every
  creative stage disabled (`bacteria/engine.rs:220`), and neither `bandCount` nor `mix` switches one
  on — so the row that stood alone here for the life of this document measured the crossover, the
  alignment delays and the band sum, and nothing a user opens Bacteria for. The generated Smudge
  duty-cycle row carries its own calibration qualification. A row measures the configuration it
  is set to, and occupancy proves only that something was running, not what.
- **Toaster falls silent if held and forgotten.** Over 53 s its 16 struck pads decay to _exact zero_
  while still paying full price, because the quality demotion reads the release envelope, pinned at
  1.0 with the key down. It re-strikes once a second. Crumbs needed its zone looped for the same reason: a one-shot voice
  pitched 48 semitones above the root plays a one-second sample in 62 ms, and unlooped the pool
  drained from 32 voices to 12 during the _warm-up_.
- **Grinder is measured at the shipped patch** — `ampModel: 'crunch-jcm'`, `channel: 1`, `gain: 5`
  (`GrinderPatch.ts:299-301`), two triode stages. An earlier version used channel 2 at gain 8.2,
  which is the lead channel at high gain and three stages, so it measured a heavier circuit than the
  reference project instantiates.

## Reproducing

```text
# wasm — Chrome, in a real AudioWorkletGlobalScope; writes the primary record
pnpm guard --profile broad --max-rss-mib 8192 -- node crates/daw-dsp/benches/wasm/run.mjs --json crates/daw-dsp/benches/quantum-cost-table.json
node crates/daw-dsp/benches/wasm/renderTable.mjs

# native — daw-dsp devices, plus the cross-check criterion groups
pnpm guard --profile extended --max-rss-mib 5632 -- env CARGO_PROFILE_BENCH_LTO=false cargo bench -p daw-dsp --bench quantum

# native — the two sibling crates
pnpm guard --profile broad --max-rss-mib 5632 -- env CARGO_PROFILE_RELEASE_LTO=false \
  cargo test -p proof-chamber --release --test quantum_cost -- --ignored --nocapture
pnpm guard --profile broad --max-rss-mib 5632 -- env CARGO_PROFILE_RELEASE_LTO=false \
  cargo test -p scoring --release --test quantum_cost -- --ignored --nocapture
```

`CARGO_PROFILE_BENCH_LTO=false` is required, not tidiness: the workspace release profile sets
`lto = true`, which conflicts with the `-C embed-bitcode=no` criterion's build passes. **Do not fix
that by editing `[profile.release]`** — that profile is hashed into all four wasm crate-source
fingerprints, and editing it invalidates every committed wasm artifact.

`--test quantum_cost` is also required: those two crates' _unit_ tests do not build in release,
because `assert_no_alloc`'s `disable_release` feature configures `AllocDisabler` out and their
`src/lib.rs` imports it. (`cargo test -p daw-dsp --release` fails for the separate pre-existing
`-C embed-bitcode=no` / `lto` reason, reproducible on a pristine `origin/main`.)

Nothing here rebuilds wasm. The browser leg loads the **committed** `public/wasm/*_bg.wasm` binaries
and the committed polyfilled glue under `src/modules/AudioEngine/wasm/`, so it measures the artifact
production ships. `pnpm wasm:verify` proves those committed pairs and their manifest remain coherent.
