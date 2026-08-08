# Analysis and AI honesty — research record

Numbers the spec defers to. Each entry states its source and its confidence. **Entries marked
`UNVERIFIED` must be settled before the acceptance criterion that depends on them is
implemented** — they are not defaults to code against.

## 1. Loudness — which revision, and what is already pinned

**Revision: ITU-R BS.1770-4.** This is not a fresh choice; it is what the repository already
implements and tests against, and Phase 8 consolidates onto it rather than re-picking.

In-repo source of truth, verified by reading:

| Quantity | Value | Where it is pinned |
| - | - | - |
| Shelf stage `f0` | 1681.974450955533 Hz | `src/modules/AudioRendering/repositories/audioEncoders/createKWeightingFilters.ts:20` |
| Shelf gain | 3.999843853973347 dB | `createKWeightingFilters.ts:21` |
| Shelf Q | 0.7071752369554196 | `createKWeightingFilters.ts:22` |
| RLB high-pass `f0` | 38.13547087602444 Hz | `createKWeightingFilters.ts:29` |
| RLB high-pass Q | 0.5003270373238773 | `createKWeightingFilters.ts:30` |
| Published 48 kHz coefficients | asserted to 6 decimal places | `__tests__/createKWeightingFilters.spec.ts:26-45` |
| Block length | 400 ms | `measureIntegratedLoudness.ts:39` |
| Block step | 100 ms (75% overlap) | `measureIntegratedLoudness.ts:41` |
| Loudness offset | −0.691 | `measureIntegratedLoudness.ts:42` |
| Absolute gate | −70 LUFS | `measureIntegratedLoudness.ts:43` |
| Relative gate | −10 LU below the absolute-gated mean | `measureIntegratedLoudness.ts:44` |
| Channel weights | 1.0 for L/R/C, 1.41 for surround | `measureIntegratedLoudness.ts:32-37` |

**Why this implementation and not the Rust one.** `crates/daw-dsp/src/proof/metering.rs`
also implements BS.1770, but adapts to non-48 kHz rates by scaling coefficients by
`48000.0 / sr` rather than redesigning the biquads. The TypeScript implementation derives
the biquads from the recommendation's parameters at the actual sample rate, and its spec
explicitly guards the 48 kHz-reuse mistake (`createKWeightingFilters.ts:13-17`). Since
export runs at 44.1 kHz by default, the TypeScript path is the more correct one and is the
one Phase 8 promotes.

**Recommendation.** Promote `measureIntegratedLoudness` + `createKWeightingFilters` to a
shared pure helper (they are arithmetic over `Float32Array` with no I/O) and make it the
single loudness implementation. Delete `computeMomentaryLUFS`
(`src/modules/AudioEngine/useCases/advancedMetering/lufs/computeMomentaryLUFS.ts`), whose
one-pole `state - 0.85 * prevSample` is not K-weighting yet still applies the standard's
−0.691 offset, and delete the fader-derived `lufs = rmsDb - 3`
(`referenceMixComparison/analyzeMix/analyzeMix.ts:75`). Rationale: three implementations of
one measurement is how a wrong number reaches a user while a right one sits unused ten files
away — which is the present state.

### UNVERIFIED — must be settled before AC-020 and AC-017 targets are fixed

- **True-peak oversampling factor and tolerance.** The Rust implementation uses 4×
  (`crates/daw-dsp/src/proof/metering.rs:542-581`); the recommendation's normative minimum
  and the associated tolerance have not been confirmed against the published text in this
  pass. Do not assume 4× is conforming because the repo does it.
- **EBU Tech 3341 conformance test set** — case list, expected LUFS per case, the stated
  tolerance a conforming meter must hit, licence, size, and whether it may be committed to
  this repository. Until this is settled, AC-020's reference material is unacquired, which
  is why AC-020 is written to fail in that state.
- **Which document defines which measure.** Momentary/short-term window lengths and LRA are
  defined in the EBU Tech 3341/3342 layer rather than BS.1770 itself; the exact split has not
  been confirmed here and must be stated before the spec claims conformance to either.

Analytic fallback, valid regardless of the above: a 1 kHz sine's exact LUFS is computable in
closed form from the K-weighting gain at 1 kHz, and gating is provable with constructed block
sequences (a below −70 LUFS segment that must be excluded, and a case sitting on the −10 LU
relative boundary). These test the arithmetic rather than the implementation against itself,
and they are available without any downloaded material.

## 2. Spectral resolution — the number and the reason

Computed for this spec at 48 kHz against the band table in
`src/modules/AudioAnalysis/services/mixAnalysisHelpers.ts:51-58`. The binding constraint is
the narrowest declared band, `sub` (20–60 Hz, 40 Hz wide).

| N | Bin width | Window | Bins in `sub` | Meets ≥10 bins |
| - | - | - | - | - |
| 256 (current) | 187.50 Hz | 5 ms | 0.2 | no |
| 2048 | 23.44 Hz | 43 ms | 1.7 | no |
| 4096 | 11.72 Hz | 85 ms | 3.4 | no |
| 8192 | 5.86 Hz | 171 ms | 6.8 | no |
| **16384** | **2.93 Hz** | **341 ms** | **13.7** | **yes** |
| 32768 | 1.46 Hz | 683 ms | 27.3 | yes |

**Recommendation: N = 16384, Hann window, 50% overlap.** It is the smallest power of two
that resolves the narrowest declared band, which is the actual requirement — not a round
number. The 341 ms window is affordable precisely *because* the analysis moves offline; it
is unavailable to the live 256-point analyser, and that is the concrete payoff of AC-015.

At the current 256, `sub` and `bass` share a single bin, so every "muddy mix" verdict at
`mixAnalysisHelpers.ts:142-150` is derived from one number that spans both bands it claims
to compare.

**Why Hann, not Blackman–Harris.** Hann's main lobe is 4 bins null-to-null with a first
sidelobe near −31 dB; a 4-term Blackman–Harris reaches roughly −92 dB sidelobes but at an
8-bin main lobe. Band-energy summation over ≥13 bins does not need −92 dB sidelobe
rejection, and doubling the main lobe would smear the 40 Hz-wide `sub` band across its own
boundary — the one thing this analysis must not do. Blackman–Harris is the right choice when
resolving a low-level tone adjacent to a loud one; that is not this measurement. (The exact
main-lobe and sidelobe figures should be cited to Harris 1978 in the implementing PR;
the ordering — Hann narrower main lobe, higher sidelobes — is not in doubt.)

Note that the *live* `AnalyserNode` path applies a Blackman window internally per the Web
Audio specification, which is one more reason the offline path must own its own windowing
rather than inheriting the browser's choice.

## 3. Chroma resolution — why a single FFT length cannot work

Computed for this spec at 48 kHz. To separate adjacent semitones, the analysis window must
be long enough that the semitone spacing at that frequency exceeds the resolution.

| Note | Frequency | Semitone spacing | N (rectangular) | N (Hann) | N (constant-Q, Q = 16.82) |
| - | - | - | - | - | - |
| C2 | 65.41 Hz | 3.89 Hz | 12341 | 24682 | 12341 (257 ms) |
| C3 | 130.81 Hz | 7.78 Hz | 6171 | 12342 | 6171 (129 ms) |
| C4 | 261.63 Hz | 15.56 Hz | 3086 | 6171 | 3086 (64 ms) |
| C7 | 2093.0 Hz | 124.46 Hz | 386 | 772 | 386 (8 ms) |

The requirement spans a factor of 32 across the range the detector claims to analyse
(octaves 2–7, `keyDetection.ts:24`). **No single FFT length serves both ends**: 4096 — the
current value — is 3× too short at C2 and 10× longer than necessary at C7. This is the
standard argument for a constant-Q transform, where the window length scales as
`Q · fs / f` with `Q = 1 / (2^(1/12) − 1) ≈ 16.82` for one-semitone resolution.

**Recommendation: constant-Q chroma.** Two acceptable implementations, in preference order:

1. **Constant-Q with per-note window lengths** as tabulated above, folded to 12 chroma bins.
   Correct across the whole range and the conventional approach for chroma.
2. **Generalised Goertzel at non-integer `k`** as a minimal repair. The current code rounds
   `k` to an integer bin (`keyDetection.ts:26`), which is what causes octave-2/3 pitch
   classes to collide; Goertzel does not require integer `k`, and using the exact real-valued
   `k = f · N / fs` together with a per-note window length removes the collision without
   restructuring the analysis.

Either satisfies AC-005. Option 1 is preferred; option 2 is the smaller diff if the phase
runs long. The CQT literature should be cited to Brown 1991 in the implementing PR.

## 4. Detector evaluation methodology

The spec requires that accuracy be *scored*, not merely asserted, because a detector graded
on exact match alone is tuned toward the wrong objective — exact-match scoring cannot
distinguish a detector that confuses relative majors (a near-miss a musician would forgive)
from one returning noise.

### UNVERIFIED — must be settled before AC-006 and AC-011 are implemented

- **MIREX audio key detection partial-credit weights.** The widely-repeated set is 1.0
  exact, 0.5 perfect fifth, 0.3 relative major/minor, 0.2 parallel major/minor, 0.0
  otherwise — **but this has not been confirmed against a primary source in this pass, and
  the direction of the fifth (dominant only, or both dominant and subdominant) is exactly
  the kind of detail that gets copied wrong.** Confirm against the MIREX task definition
  before pinning. Do not implement from the numbers in this paragraph.
- **MIREX tempo evaluation.** The P-score, and the Accuracy 1 / Accuracy 2 convention
  (Accuracy 2 admitting octave-related answers), together with the percentage tolerance
  window around the annotated tempo and the exact set of admitted ratios
  (1/3, 1/2, 2, 3), must be confirmed before AC-011's harness pins them.
- **Corpora for RM-3.** Candidate annotated datasets and, critically, whether *audio* is
  redistributable or only annotations. The working assumption in the spec — annotations
  checked in, audio fetched by script, scored accuracy as an opt-in target — is the safe
  shape under either answer, but the specific datasets and licences are unconfirmed.

A research pass covering these was commissioned alongside this spec and had not returned
when the spec was committed. **Nothing in the spec depends on a guessed value**: AC-006 and
AC-011 require the weights and tolerances to be "recorded in `RESEARCH.md` and pinned by the
harness", so they cannot be implemented against blanks, and their target numbers are
deliberately deferred to a measured baseline (see the spec's third open question) rather
than invented.

## 5. Model integrity — the mechanism to copy

Not a research question; a precedent already in the tree, verified by reading:

- Generator/verifier pair: `pnpm wasm:manifest` → `scripts/gen-wasm-manifest.ts`;
  `pnpm wasm:verify` → `scripts/verify-wasm-artifacts.ts`.
- Digest store: `public/wasm/manifest.json`, committed, `sha256:` prefixed.
- The comparison to imitate: `scripts/verify-wasm-artifacts.ts:126-140` — recompute from
  bytes on disk, compare against the recorded value, fail on drift, exit 1.
- Gate wiring: `scripts/health-gates-web.sh:37`.

The native model path is already correct and is the behavioural reference:
`src-tauri/src/commands/model_download.rs:186-206` verifies size and SHA-256 on download and
on every cache hit, restricts the host to `huggingface.co` over HTTPS, requires a 64-char hex
digest in the spec itself, and never renames the `.tmp` over the model path on mismatch.

**Recommendation: make the browser path match the native path, not the other way round.**
Digest required rather than optional, URLs pinned to immutable revisions rather than
`resolve/main`, verification on the streamed path that real models actually take, and
re-verification on cache hits. The present browser code has all the vocabulary of integrity —
a `sha256?` field, a comparison block, a test named for a mismatch — and none of the effect,
because `mustBuffer` (`modelDownloadManager.ts:147`) routes every shipped `.onnx` around the
check and no caller supplies a digest anyway.
