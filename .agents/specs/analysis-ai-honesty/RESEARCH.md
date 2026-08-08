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

### Verified against the published recommendation

Text extracted directly from ITU-R BS.1770-5 (11/2023),
`https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1770-5-202311-I!!PDF-E.pdf`:

- **Gating**: "gating of 400 ms blocks (overlapping by 75%), where two thresholds are used"
  — confirming the block length and overlap the repo already implements.
- **Loudness formula**: `L_K = -0.691 + 10 log10 Σ G_i …` LKFS, "where G_i are the weighting
  coefficients for the individual channels". Surround channels carry larger weights; **the
  LFE channel is excluded from the measurement**.
- **True peak** (Annex 2), five stages: attenuate 12.04 dB (2-bit shift), 4× over-sampling,
  low-pass filter, absolute value, convert to dB TP. The 12.04 dB attenuation "is not
  necessary if the calculations are performed in floating point" — so our f32/f64 path may
  skip it.
- **True peak is a guideline, not a fixed factor**: the recommendation says a true-peak method
  "should be based on the guidelines shown in Annex 2, **or on a method that gives similar or
  superior results**", and Annex 2 states "**Higher sampling rates and over-sampling ratios
  are preferred**". The illustrated 4× raises 48 kHz to 192 kHz.

**Recommendation on oversampling: 4× is the floor at 48 kHz, and is not sufficient at
44.1 kHz.** 4× at 44.1 kHz reaches only 176.4 kHz, below the 192 kHz the recommendation
illustrates. Since export defaults to 44.1 kHz, specify the oversampling factor as *the
smallest power of two whose product with the source rate is ≥ 192 kHz* — 4× at 48 kHz, 8× at
44.1 kHz. This tracks the standard's stated preference instead of hard-coding the number the
example happens to use. The existing Rust implementation
(`crates/daw-dsp/src/proof/metering.rs:542-581`) hard-codes 4×.

**Revision: stay on BS.1770-4.** BS.1770-5 adds Annex 3 (advanced/immersive loudspeaker
configurations) and Annex 4 (object-based audio); the core K-weighting, gating and true-peak
algorithm this phase uses are unchanged. Nothing in Phase 8 measures immersive or
object-based audio, so the in-repo BS.1770-4 pin stays correct and no coefficient changes.
Revisit if Atmos work (`.agents/specs/atmos/`) lands.

Note: the PDF's numeric glyphs for the two gate thresholds did not survive text extraction.
The values used (−70 LUFS absolute, −10 LU relative) are corroborated by the in-repo
implementation and by EBU R 128, which specifies the relative gate at −10 LU. They are not
quoted here from the primary source.

### RESOLVED, and it constrains the phase — the EBU test set cannot be used

The EBU loudness test set is 70 files / 87.4 MB. Its terms
(`use of EBU AUDIO test sequences.pdf`, July 2019, v1.0) are decisive and quoted verbatim:

> EBU Test Sequences are made available for the sole purposes to assess the performance of
> audio equipment and systems within the frame of internal Research and Development
> operations.

> You may not use any EBU Test Sequences for business, commercial or for-profit activities.

> You may not copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
> the EBU Test Sequences.

The EBU may also "revoke the authorization granted hereunder at any time without notice".

**Two independent blockers**: redistribution is forbidden, so the files cannot be committed
or vendored; and commercial use is forbidden, which this project is (`audioFeatures.ts:8`
records the Meyda licence specifically as "MIT (safe for commercial use)"). This is a real
constraint on the phase, not a procurement delay.

**Recommendation: regenerate the test cases rather than acquire the files.** EBU Tech 3341 is
a freely readable public specification — it *describes* each compliance case and its expected
reading (e.g. a 1 kHz stereo sine at −18 dBFS peak must read −18.0 LUFS; the −23 LUFS and
−33 LUFS cases; the gating cases). Implementing generators from those published descriptions
reproduces the conformance check without copying EBU's audio, so nothing restricted enters
the repository. What is used is the *specification*, which is publishable knowledge, not the
*recordings*, which are licensed.

**Tolerance: ±0.1 LU** for the Tech 3341 minimum-requirement cases. (EBU R 128's programme
delivery tolerance of ±0.5 LU is a *delivery* target, not a meter-accuracy figure — do not
conflate them.)

Analytic anchors, independent of any external material: a 1 kHz sine's exact LUFS is
computable in closed form from the K-weighting gain at 1 kHz, and gating is provable with
constructed block sequences — a below −70 LUFS segment that must be excluded, and a case
sitting on the −10 LU relative boundary. These test the arithmetic rather than the
implementation against itself.

### Still UNVERIFIED

- **Which document defines which measure.** Momentary and short-term window lengths and LRA
  belong to the EBU Tech 3341/3342 layer rather than BS.1770 itself. The exact split was not
  confirmed in this pass and must be stated before the spec claims conformance to either.
  This does not block any criterion below — Phase 8 specifies only *integrated* loudness and
  true peak, both of which are BS.1770's own.

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

### Key detection — MIREX partial credit (confirmed)

From the MIREX Audio Key Detection task definition
(`https://music-ir.org/mirex/wiki/2025:Audio_Key_Detection`):

| Relation to correct key | Points |
| - | - |
| Same | 1.0 |
| Perfect fifth | 0.5 |
| Relative major/minor | 0.3 |
| Parallel major/minor | 0.2 |
| Other | 0.0 |

The task defines closeness as "distance of perfect fifth, relative major and minor, and
parallel major and minor".

**One detail is genuinely ambiguous in the primary source and is being decided here, not
discovered.** The current wiki says "distance of perfect fifth" without stating direction;
the 2005 task page words it as a key "a perfect fifth too high or low". **Decision: credit a
fifth in either direction (dominant and subdominant), same mode only.** Rationale: the
symmetric reading is the one the 2005 wording states explicitly and the one implemented by
the common evaluation libraries; an asymmetric rule would also score G major differently from
F major relative to C major, which has no musical justification. Record this as a stated
choice in the harness, not as a fact read off the standard — if a later comparison against
published MIREX numbers disagrees, this is the assumption to revisit first.

### Tempo — two conventions, both reported (confirmed)

There are **two** established conventions and they use different tolerances. Reporting only
one invites a comparison against published numbers that were computed the other way.

- **MIREX P-score**, Moelants & McKinney, as used in MIREX Audio Tempo Extraction and
  analysed in McKinney, Moelants, Davies & Klapuri, *Evaluation of Audio Beat Tracking and
  Music Tempo Extraction Algorithms*, JNMR 36(1), 2007. Algorithms return two tempi T1 and
  T2 (T1 the slower); the score combines `ST1` (relative perceptual strength of T1) with the
  ability to identify T1 and T2 **to within 8%**.
- **Accuracy 1 / Accuracy 2**, the de facto implementation (madmom `evaluation/tempo`):
  `TOLERANCE = 0.04` — **4%**. Accuracy 1 scores the strongest tempo against the first
  annotation. Accuracy 2 additionally admits octave-related answers, with `DOUBLE = True`
  and `TRIPLE = True` expanding the annotation set by `×2, ÷2, ×3, ÷3`.

**Recommendation: pin all three — P-score at 8%, Accuracy 1 at 4%, Accuracy 2 at 4% with the
{2, 1/2, 3, 1/3} ratio set — and report them separately.** Accuracy 2 minus Accuracy 1 is
precisely the octave-error rate, which is the number that tells us whether the fold policy in
AC-012 is doing harm. Collapsing them hides exactly the failure this phase is about.

### Corpora — GiantSteps (confirmed), and what may be committed

GiantSteps Key and GiantSteps Tempo (Knees et al., ISMIR 2015), ~600+ tracks each, mostly
electronic. **Annotations are licensed CC BY-SA 4.0** and are redistributable with
attribution. **Audio is not redistributed by the dataset itself** — the upstream repository
(`github.com/GiantSteps/giantsteps-tempo-dataset`) ships "the annotations and download
scripts for the audio files", which is the same shape this spec specifies.

This confirms RM-3 as written: **annotations committed (with CC BY-SA 4.0 attribution), audio
fetched by script, scored accuracy as an opt-in target rather than part of the default
suite.** No licence change to the repository is implied, since CC BY-SA applies to the
annotation files, not to code that reads them.

Genre caveat worth stating in the implementing PR: GiantSteps is predominantly EDM, so a
score against it is not evidence of general-purpose accuracy. It is a floor, not a
certificate.

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
