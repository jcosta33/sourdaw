---
type: spec
id: SPEC-analysis-ai-honesty
title: Analysis and AI honesty — Phase 8
status: draft
owner: The Sourdaw team
sources:
    - .agents/decisions/0015-a-guard-must-be-able-to-fail.md
    - .agents/decisions/open-decision-docket.md
    - .agents/specs/loudness-metering-ebur128/spec.md
    - .agents/specs/rave-timbre-transfer/spec.md
---

# Analysis and AI honesty — Phase 8

Every number this application shows about a user's audio is a claim. This phase is about
whether those claims are true, and — where they cannot be made true — whether they are
allowed to keep pretending.

The phase covers five items: one tempo detector and one key detector with the Pearson
fix; mix analysis rebuilt on an offline render with BS.1770 loudness and a real FFT
length; analysis DSP off the main thread; model digests pinned; and the consolidation
work that "one detector" implies.

## Verified current state

Everything in this section was read on this branch. Line numbers are from the tree at
branch point. **The survey claim that motivated this phase was half right, and the half
it got wrong changes the work** — see item 1.

### The measurements that are wrong

| # | Claim shown to the user | Where it comes from | What is actually true |
| - | - | - | - |
| 1 | `Detected key: <key> <mode> (<n>% confidence)` | `src/modules/Arrangement/presentations/views/ClipContextMenu.tsx:117-121` | Un-centred dot product. Confidence is anti-correlated with tonality — see below |
| 2 | `LUFS` in reference-mix comparison and mentor lessons | `src/modules/AudioAnalysis/useCases/referenceMixComparison/analyzeMix/analyzeMix.ts:75` | `const lufs = rmsDb - 3;` derived from fader positions. No audio is read |
| 3 | Master/track peak and RMS in the mix report | `src/modules/AudioAnalysis/services/mixAnalysisHelpers.ts:18-20` | Measured over 128 samples (2.67 ms at 48 kHz) because of a sizing bug |
| 4 | Six-band frequency balance, "muddy mix" verdicts | `src/modules/AudioAnalysis/services/mixAnalysisHelpers.ts:51-58,142-150` | `fftSize = 256` → 187.5 Hz bins. The `sub` and `bass` bands resolve to the same bin |
| 5 | LUFS meter readout | `src/modules/AudioEngine/useCases/advancedMetering/lufs/computeMomentaryLUFS.ts:22-36` | One-pole `state - 0.85 * prevSample` wearing BS.1770's `-0.691` offset. Not K-weighting, not gated |
| 6 | Model integrity | `src/modules/BrowserAi/repositories/modelDownloadManager.ts:230-240` | The verification block is unreachable in production |

### Item 1 — key detection: the survey was half right

There are **two** key detectors, and they differ exactly on the centring.

`src/modules/Arrangement/useCases/audioAnalysis/detectKey.ts:16-34` implements a correct
mean-centred Pearson correlation. **It is dead code.** Its only reachable importer is
`src/modules/Arrangement/useCases/__tests__/audioAnalysis.spec.ts:8`; the folder's barrel
(`src/modules/Arrangement/useCases/audioAnalysis/index.ts`) is a comment and exports
nothing, and `src/modules/Arrangement/useCases/index.ts` does not re-export it. It also
returns `'C Major'` as a silent fallback when feature extraction fails
(`detectKey.ts:56`).

`src/modules/AudioAnalysis/useCases/keyDetection.ts:62-80` is the **live** path — reached
from the clip context menu, the `detectKey` AppAction
(`src/modules/AudioAnalysis/handlers/analysis/handleDetectKey.ts:16`) and the LLM tool
definition (`src/modules/AiRuntime/models/Tools/GenerationAndView.ts:48`). It correlates
with a raw, un-centred dot product:

```ts
corrMajor += ci * MAJOR_PROFILE[index]!;
corrMinor += ci * MINOR_PROFILE[index]!;
```

So the defect is real, but it is in the *other* file from the one that carries a
`pearsonCorrelation` helper. A repair that "adds Pearson to the key detector" and lands in
`Arrangement` would change nothing a user can observe.

**Measured consequence.** The Krumhansl–Schmuckler minor profile sums to 44.51 against the
major profile's 41.79. An un-centred dot product therefore carries a constant +6.5% bias
toward minor that has nothing to do with the signal. Running the production arithmetic
(`keyDetection.ts:14-83`, ported verbatim, no stub) over synthesised signals at 44.1 kHz:

| Input | Live detector (un-centred) | Mean-centred Pearson |
| - | - | - |
| 220 Hz sine (A3) | **A minor**, 25% confidence | A minor, r = 0.662 |
| C4/E4/G4 triad | C major, 50% confidence | C major, r = 0.865 |
| A3/C4/E4 triad | A minor, 50% confidence | A minor, r = 0.849 |
| White noise | **D minor, 100% confidence** | F major, r = 0.544 |

Two things fall out, and both must shape the acceptance criteria.

**The reported confidence is anti-correlated with tonality.** `keyDetection.ts:82` computes
`Math.min(1, bestCorr / 30)` over an unnormalised dot product. Broadband material drives
every chroma bin toward 1, which drives the dot product toward the profile sum (≈44.5) and
saturates the readout at 100%. A pure tone — the most unambiguous input possible — reports
25%. **White noise is the input for which this application expresses maximum confidence.**

**Sparse inputs do not expose the bias.** Both triads resolve correctly even un-centred,
because a three-hot chroma vector is dominated by profile *shape*. The bias bites on dense
chroma, which is what real full-mix material produces: over 20,000 pseudo-random chroma
vectors the un-centred correlator returns minor **98.6%** of the time, against 59.4% for the
centred one. A test built only from clean triads is green on the broken code. This is the
"interior points" failure shape — and the existing spec walks straight into it:
`src/modules/AudioAnalysis/useCases/__tests__/keyDetection.spec.ts:63` asserts
`result?.key` is `'A'` and **never asserts the mode**, so the run that returns *A minor*
for a pure A3 tone passes today.

**Chroma resolution is separately broken.** `keyDetection.ts:26` snaps each note to an
integer bin: `Math.round((freq * fftSize) / sampleRate)`. At `fftSize = 4096` and 44.1 kHz
the bin spacing is 10.77 Hz, while a semitone at C2 spans 3.89 Hz. Bin spacing exceeds
semitone spacing below ≈181 Hz (F#3), so **every pitch class in octaves 2 and 3 collides
into shared bins** and contributes to the wrong chroma bucket. Fixing the correlation
without fixing the chroma repairs the second half of a two-stage error.

### Item 2 — mix analysis

There are three unrelated things called mix analysis, and a fourth implementation that is
correct and unused.

- **`analyzeMix`** (`src/modules/AudioAnalysis/useCases/analyzeMix.ts:37-40`) reads live
  `AnalyserNode` taps on the running graph. It is a single instantaneous snapshot at
  button-press time (`analyzeMix.ts:78`), so it reports silence when the transport is
  stopped, and `handleAutoFixMix` sleeps 250 ms to let the smoothed analysers settle
  (`src/modules/AudioAnalysis/handlers/analysis/handleAutoFixMix.ts:16-27`). The analyser is
  created at `fftSize = 256`, `smoothingTimeConstant = 0.8`
  (`src/modules/AudioEngine/repositories/createWebAudioEngine.ts:346-347`).
- **`referenceMixComparison/analyzeMix`** reads no audio at all — it estimates from
  `trackStore` gain and pan, and manufactures a LUFS number at line 75. This is already on
  the ledger as an open decision ("Mix analysis is synthetic, not measured",
  `.agents/decisions/open-decision-docket.md`, *Blocks code: yes*). This spec closes it.
- **`measureIntegratedLoudness`**
  (`src/modules/AudioRendering/repositories/audioEncoders/measureIntegratedLoudness.ts:39-44`)
  is **a correct BS.1770 gated integrated-loudness implementation** — 400 ms blocks, 100 ms
  step (75% overlap), `-0.691` offset, absolute gate at −70 LUFS, relative gate at −10 LU,
  Table 4 channel weights. Its K-weighting
  (`src/modules/AudioRendering/repositories/audioEncoders/createKWeightingFilters.ts:10-33`)
  derives the biquads from the recommendation's parameters at the **actual** sample rate,
  and its spec pins reproduction of the published 48 kHz coefficients. It is reachable only
  from export normalization (`applyExportNormalization.ts:45`).

So the correct implementation already exists, ten files away from the UI that shows users a
fabricated one. **The work is consolidation and wiring, not a green-field BS.1770 build.**
`crates/daw-dsp/src/proof/metering.rs` holds a second real implementation, scoped to the
Proof device, whose non-48 kHz path scales coefficients by `48000.0 / sr` rather than
redesigning the filters — the TypeScript one is more correct off 48 kHz.

The `readLevels` sizing bug is load-bearing and one line:

```ts
const data = new Float32Array(analyser.frequencyBinCount);   // 128, not fftSize (256)
analyser.getFloatTimeDomainData(data);
```

`getFloatTimeDomainData` copies `min(fftSize, array.length)`, so every peak and RMS figure
in the mix report is measured over 2.67 ms of audio. `TrackNode.ts:119` sizes the
equivalent buffer correctly, which is how we know this is a slip and not a convention.

### Item 3 — threading

No Worker and no AudioWorklet performs analysis. `analyzeMix` is `async` in signature only —
the body is synchronous and the file says so
(`src/modules/AudioAnalysis/useCases/analyzeMix.ts:36`). `summarizeFeatures` runs a Meyda
2048-point FFT across the whole buffer synchronously
(`src/modules/AudioAnalysis/useCases/audioFeatures.ts:103-119`) and is called from a React
click handler
(`src/modules/TimelineEditor/presentations/views/Inspector/ClipAudioAiSection.tsx:70`) and in
a loop over every track in the project
(`src/modules/AiRuntime/useCases/mixHealthAnalysis.ts:38`). Key and tempo detection run
inside `onClick` (`ClipContextMenu.tsx:102,117`).

Worker precedent exists and should be matched rather than invented:
`src/modules/Transport/workers/schedulerWorker.ts`,
`src/modules/BrowserAi/workers/onnxInferenceWorker.ts`,
`src/modules/AudioEngine/workers/grandBouleEngineWorker.ts`.

### Item 4 — model digests

Two paths, opposite postures.

**Native is correct.** `src-tauri/src/commands/model_download.rs:186-206` compares size and
SHA-256 against a pinned `expected_sha256`, on download *and* on every cache hit; a
post-download mismatch leaves the `.tmp` unrenamed, so poisoned bytes are never promoted.
Source URLs are pinned to immutable commit revisions (`native_llm.rs:97`,
`ai_audio.rs:75-76`, `speech.rs:74-75`).

**Browser is decoration.** The verification block at
`src/modules/BrowserAi/repositories/modelDownloadManager.ts:230-240` cannot execute in
production, for two independent reasons:

1. No call site supplies `sha256`. It is optional on the schema
   (`src/modules/BrowserAi/models/BrowserModel.ts:35-36`) and no catalog entry sets it —
   not `KOKORO_MODEL_ENTRY`, not `NSF_HIFIGAN_VOCODER`, not `DDSP_INSTRUMENT_CATALOG`. So
   `if (sha256)` is always false.
2. Control never reaches it. `modelDownloadManager.ts:147` sets
   `const mustBuffer = isContainer || Boolean(sha256);` and both shipped model URLs end in
   `.onnx`, so the streamed branch runs and returns at line 208.

This is precisely ADR 0015's subject: a check whose only reachable verdict is the one it
already has. It is worse than absent, because a `sha256?` field on the model type and a
passing test named *"retries and ultimately fails when the sha256 does not match"* make the
browser path look covered.

Compounding it, both browser model URLs resolve a **mutable ref** —
`huggingface.co/.../resolve/main/...`
(`src/modules/BrowserAi/models/DdspInstrumentCatalog.ts:24-25,34-35`). Kokoro voice
embeddings are fetched from `main` at render time and never stored or hashed
(`src/modules/BrowserAi/useCases/renderKokoroTts.ts:37,55`).

`ModelInfo` (`src/modules/AiRuntime/models/ModelInfo.ts:5-16`) is presentation metadata —
`downloadSize` is the human string `'~2.5 GB'`, and there is no URL, digest, or revision
field. It is not an integrity-bearing type today.

The mechanism to copy already exists and is CI-gated: `pnpm wasm:manifest` writes
`public/wasm/manifest.json`, `pnpm wasm:verify` (`scripts/verify-wasm-artifacts.ts:126-140`)
recomputes and compares, and `scripts/health-gates-web.sh:37` runs it.

### Item 5 — how many detectors exist, and who loses what

**Key — two implementations, one live.** Consolidation costs nothing observable, because the
loser (`Arrangement/useCases/audioAnalysis/detectKey.ts`) has no production consumer. No
owner decision is required.

**Tempo — three implementations, two live, serving genuinely different contracts.**

| Implementation | Output | Range | Rounding | Consumers |
| - | - | - | - | - |
| `AudioAnalysis/useCases/tempoDetection.ts` | scalar BPM | folded to 60–200 (`:81-86`) | integer (`:88`) | `ClipContextMenu.tsx:102`, `handleDetectTempo.ts:14`, LLM `detectTempo` tool |
| `Transport/.../detectTempoFromOnsets.ts` | `TempoMapResult` — time-varying points + confidence | 30–400 (`:28`) | 0.1 BPM (`:86`) | `detectProjectTempo.ts:12` → `handleDetectTempo.ts:23` |
| `Arrangement/useCases/audioAnalysis/detectTempo.ts` | scalar BPM | clamped 40–300 (`:44`) | integer | **none** — dead, reachable only from its own spec |

The two live ones are not redundant: one answers "what is this clip's tempo", the other
"how does tempo vary across the project", and `detectProjectTempo.ts:14-16` additionally
*writes* a tempo map when confidence exceeds 0.5. Collapsing them into a single function
would remove a capability.

**Therefore "one detector" is specified here as one *estimator* with two output adapters** —
a single onset detector and a single period estimator, exposed as a scalar-BPM adapter and a
tempo-map adapter. That satisfies the consolidation intent (one place where tempo arithmetic
lives, one place to fix) without deleting a contract. It is not an owner decision under this
framing; the field standard is unambiguous that beat tracking and tempo estimation share a
front end, and the repo already separates the two output shapes.

The one **user-visible behaviour change** consolidation forces is the octave policy: today a
clip at a genuine 50 BPM is reported as 100 and a clip at 210 as 105, silently, by
`tempoDetection.ts:81-86`, while the Transport path does not fold at all. AC-012 makes the
fold explicit and reportable rather than removing it.

## Non-goals

- The EBU R 128 **realtime metering UI and Rust `ebur128` crate integration** — that is
  `SPEC-loudness-metering-ebur128`, still `draft` and unimplemented (no `ebur128` dependency
  exists in any `Cargo.toml`). This phase consumes offline loudness, and must not
  pre-empt that spec's meter.
- The wider AI surface: trust modes (`SPEC-ai-trust-modes`), the runtime strip
  (`SPEC-runtime-transparency`), provenance marking, prompt design, and the mentor lesson
  content itself. This phase fixes the *numbers those features are given*.
- RAVE model ingress (`SPEC-rave-timbre-transfer` AC-028/AC-038/AC-039 already specify
  `modelDigest`); Phase 8 supplies the shared digest mechanism that spec can bind to.
- Replacing the LLM in `mixHealthAnalysis`. Only its input changes.

## Reference material

A detector's acceptance criteria are worthless unless the correct answer is known
independently of this codebase. Three classes, with different acquisition stories.

### RM-1 — Synthesised signals (checked in as generators, not audio)

Deterministic generators committed as TypeScript/Rust fixtures under the owning
`__tests__` / `testdata` directories, producing:

- Pure tones and triads at stated frequencies (known pitch class by construction).
- **Dense harmonic material with a known key**: a four-voice chorale rendered from a
  committed MIDI-like note list through additive synthesis with a stated harmonic series.
  This is the case that separates centred from un-centred correlation; triads do not.
- Click trains and drum-like impulse trains at exact BPMs, including non-integer (e.g.
  128.5) and octave-ambiguous (e.g. 70, folding to 140) cases.
- White and pink noise at fixed PRNG seeds — the **negative** controls, for which the
  correct output is "no confident answer", not a key.

Generators rather than WAVs: they are diffable, they carry their ground truth in the code
that makes them, and they keep the repo small. **A generator must not be the same code path
as the analyser** — the expected value must come from the construction parameter (the
frequency asked for), never from a second run of the thing under test.

### RM-2 — BS.1770 / EBU conformance signals

The EBU Tech 3341 compliance material is the only way to claim a conforming meter. Its
acquisition, licence, and redistributability are recorded in
`RESEARCH.md` alongside this spec. **Acquiring and checking in (or scripting the download
of) this material is part of this phase, not a prerequisite** — see AC-020, which fails
until it is present.

Where the material cannot be redistributed, the fallback is generated signals whose exact
LUFS is analytically known: a −23 LUFS 1 kHz sine at 0 dB FS reference is computable in
closed form from the K-weighting gain at 1 kHz, and the gating behaviour is provable with
constructed block sequences (e.g. a −70 LUFS segment that must be gated out, and a −11 LU
relative-gate boundary case). These test the implementation against arithmetic, not against
itself.

### RM-3 — Annotated corpora for accuracy scoring

Public key/tempo-annotated datasets are used for the **scored accuracy** criteria
(AC-006, AC-013). Annotations are redistributable for the datasets selected; audio in
general is not. The phase therefore checks in **annotations and a fetch script**, and the
scored-accuracy criteria run as an opt-in target, not in the default suite. Dataset
selection, licences, and redistributability are recorded in `RESEARCH.md`.

## Verification hygiene

Two rules govern every `Verify with:` line below, both learned from a spec that shipped a
verification command which could not run.

1. **The command must exist today.** Every script named below is present in `package.json`
   or is a real cargo invocation against a crate that exists. The *test* the command selects
   is created by this phase; the *command* is not.
2. **A selector that matches nothing must fail, not pass.** `pnpm test:run --dir src <path>`
   exits non-zero when the path matches no spec file, so vitest criteria are safe.
   `cargo test -p <crate> <filter>` **exits 0 when the filter matches nothing** — a silent
   vacuous pass, which is the exact defect this phase exists to remove. Rust criteria below
   therefore use the guarded form:

   ```
   cargo test -p daw-dsp -- --list | grep -q '<filter>' && cargo test -p daw-dsp <filter>
   ```

   AC-026 pins this rule so it cannot be quietly dropped.

`--dir src` is mandatory on every vitest invocation: a bare path is a glob that also matches
every copy under `.agents/worktrees/*`.

## Acceptance criteria

Each criterion states the observation that violates it. Criteria marked **[ears]** cannot be
settled by a machine and require a listening check recorded in the PR; all others are
machine-verifiable.

### Item 1 — one key detector

#### AC-001 — Key correlation is mean-centred Pearson

The surviving key detector must correlate mean-centred chroma against mean-centred
Krumhansl–Schmuckler profiles and return Pearson's *r*. Adding a constant to every chroma
bin must not change the returned key, mode, or *r* by more than 1e-9.

*Violated by:* a chroma vector and that same vector plus 0.5 returning different modes.

Verify with: `pnpm test:run --dir src src/modules/AudioAnalysis/useCases/__tests__/keyDetection.spec.ts`

#### AC-002 — Flat chroma yields no key

A perfectly flat chroma vector carries no key information. The detector must return no key
(not "C minor"), and must do so through the correlation stage rather than an early guard —
the test must assert the correlator ran.

*Violated by:* any key returned for a constant chroma vector; also by a `null` produced by an
input-validation guard before the correlation executes.

Verify with: `pnpm test:run --dir src src/modules/AudioAnalysis/useCases/__tests__/keyDetection.spec.ts`

#### AC-003 — The minor bias is gone, measured on dense material

Over a fixed-seed population of at least 10,000 pseudo-random chroma vectors, the share of
minor verdicts must fall within 50 ± 5%. The current implementation scores 98.6%.

This criterion exists because sparse fixtures cannot see the defect: both a C major and an A
minor triad resolve correctly under the broken code.

*Violated by:* a minor share outside 45–55%.

Verify with: `pnpm test:run --dir src src/modules/AudioAnalysis/useCases/__tests__/keyDetection.spec.ts`

#### AC-004 — Confidence is monotonic in tonality

Reported confidence must be higher for a pure tone than for white noise, and higher for a
triad than for a pure tone. Confidence must be the correlation coefficient in [−1, 1], not a
magnitude divided by a constant.

*Violated by:* white noise reporting confidence ≥ a triad's — the current behaviour, where
noise reports 100% and a pure tone reports 25%.

Verify with: `pnpm test:run --dir src src/modules/AudioAnalysis/useCases/__tests__/keyDetection.spec.ts`

#### AC-005 — Chroma resolves semitones across the analysed range

No two pitch classes may share an analysis bin at any note in the detector's declared range.
The test must enumerate every (pitch class, octave) pair the detector analyses — derived
from the detector's own range constant, not a copied list — and assert distinct bin
assignment.

*Violated by:* any two notes in range mapping to the same bin. The current
`Math.round((freq * fftSize) / sampleRate)` collides throughout octaves 2–3.

Verify with: `pnpm test:run --dir src src/modules/AudioAnalysis/useCases/__tests__/keyDetection.spec.ts`

#### AC-006 — Key accuracy is scored with partial credit, not exact match

Accuracy must be reported using the MIREX-style weighted score (exact / perfect fifth /
relative / parallel / other), against the corpus in RM-3. Exact-match-only scoring is
forbidden: it cannot distinguish a detector that confuses relative majors from one that
returns noise, and tuning against it optimises the wrong thing.

The scoring weights, their source, and the target score are recorded in `RESEARCH.md` and
pinned by the harness.

*Violated by:* a harness reporting a single exact-match percentage, or a weighted score
below the pinned target.

Verify with: `pnpm test:run --dir src src/modules/AudioAnalysis/useCases/__tests__/keyAccuracy.spec.ts`

#### AC-007 — Exactly one key detector exists, and it never guesses

Exactly one key-detection implementation exists under `src/`. The test enumerates candidates
by searching the module tree for Krumhansl–Schmuckler profile constants — not by checking a
hand-written list — and asserts a count of one, so a reintroduced second copy reds it.
`src/modules/Arrangement/useCases/audioAnalysis/detectKey.ts` and its spec are deleted. Its
`'C Major'` silent fallback must not reappear: the surviving detector returns absence, never
a guess.

*Violated by:* the enumeration finding two implementations, or any detector returning a
hard-coded key on an analysis failure.

Verify with: `pnpm test:run --dir src src/modules/AudioAnalysis/useCases/__tests__/keyDetection.spec.ts`

#### AC-008 — Absence is representable end to end

The clip context menu and the `detectKey` AppAction must render "no confident key" as a
distinct outcome from a detected key, and the LLM tool result must carry the same
distinction rather than an empty string or a default.

*Violated by:* a UI or tool payload in which "no key" and "C major" are indistinguishable.

Verify with: `pnpm test:run --dir src src/modules/Arrangement/presentations/views/__tests__/ClipContextMenu.spec.tsx`

### Item 1b / Item 5 — one tempo estimator

#### AC-009 — One onset detector, one period estimator

Exactly one onset-detection function and one period-estimation function exist under `src/`.
The scalar-BPM and tempo-map contracts are adapters over them. The test must enumerate
candidates by searching the module tree, not by checking a hand-written list.

*Violated by:* a second independent onset or period implementation appearing anywhere under
`src/modules/`.

Verify with: `pnpm test:run --dir src src/modules/AudioAnalysis/useCases/__tests__/tempoDetection.spec.ts`

#### AC-010 — Both existing output contracts survive

The scalar BPM contract (`detectTempo`) and the `TempoMapResult` contract
(`detectProjectTempo`) both remain, with their current shapes and consumers intact.

*Violated by:* either consumer losing its output shape — specifically
`handleDetectTempo.ts` losing either branch.

Verify with: `pnpm test:run --dir src src/modules/AudioAnalysis/handlers/analysis/__tests__/handleDetectTempo.spec.ts`

#### AC-011 — Tempo accuracy is scored with octave tolerance

Accuracy is reported as both a strict metric and an octave-tolerant metric (the MIREX
Accuracy 1 / Accuracy 2 convention), with the percentage tolerance window and the admitted
octave ratios pinned by the harness. Their definitions and sources are in `RESEARCH.md`.

*Violated by:* a harness reporting one number, or scoring a half-tempo answer as simply
wrong without recording it as an octave error.

Verify with: `pnpm test:run --dir src src/modules/AudioAnalysis/useCases/__tests__/tempoAccuracy.spec.ts`

#### AC-012 — The octave fold is reported, not silent

When the estimator folds a detected period into the display range, the result must carry
both the folded BPM and the fold factor, and the UI must show that a fold occurred. A
70 BPM click train must not be reported as an unqualified 140.

*Violated by:* a 70 BPM input yielding a result indistinguishable from a genuine 140 BPM
input.

Verify with: `pnpm test:run --dir src src/modules/AudioAnalysis/useCases/__tests__/tempoDetection.spec.ts`

#### AC-013 — Non-integer tempo survives the scalar path

A click train at 128.5 BPM must be reported as 128.5, not 128 or 129. The current scalar
path rounds to integer at `tempoDetection.ts:88`.

*Violated by:* any integer-only scalar BPM output.

Verify with: `pnpm test:run --dir src src/modules/AudioAnalysis/useCases/__tests__/tempoDetection.spec.ts`

#### AC-014 — Noise yields no tempo

Fixed-seed white noise must produce no confident tempo. The current
`Arrangement` implementation returns a hard-coded 120 on failure
(`detectTempo.ts:32`); that file is deleted, and no replacement may guess.

*Violated by:* any BPM returned for the noise fixture.

Verify with: `pnpm test:run --dir src src/modules/AudioAnalysis/useCases/__tests__/tempoDetection.spec.ts`

### Item 2 — mix analysis on an offline render

#### AC-015 — Mix analysis reads a rendered buffer, not a live tap

The mix report must be computed from an `OfflineAudioContext` render of the project through
the real signal chain — post-fader, post-pan, post-device, post-automation — not from
`AnalyserNode` taps. Analysing with the transport stopped must produce the same report as
analysing during playback.

*Violated by:* a report that differs between stopped and playing transport, or that is
unchanged when a track's fader or an inserted device is changed.

Verify with: `pnpm test:run --dir src src/modules/AudioAnalysis/useCases/__tests__/analyzeMix.spec.ts`

#### AC-016 — Loudness is BS.1770 gated integrated loudness, from the existing implementation

Reported loudness must come from `measureIntegratedLoudness` — the existing correct
implementation — not a reimplementation. The revision, K-weighting stage coefficients,
block length and overlap, absolute and relative gate values, and channel weights are pinned
in `RESEARCH.md` and asserted against published values.

*Violated by:* a second loudness implementation appearing, or any coefficient diverging from
the published table.

Verify with: `pnpm test:run --dir src src/modules/AudioRendering/repositories/audioEncoders/__tests__/createKWeightingFilters.spec.ts`

#### AC-017 — Gating demonstrably changes the answer

A fixture containing loud programme followed by a long segment below the absolute gate must
produce a different integrated loudness with gating than without, and the gated value must
match the analytically computed loudness of the loud segment alone.

This criterion exists because a gate that is implemented but never exercised by a fixture
that crosses it is untested. A second fixture must sit on the relative-gate boundary.

*Violated by:* gated and ungated values agreeing on the fixture, or the boundary fixture
being absent.

Verify with: `pnpm test:run --dir src src/modules/AudioRendering/repositories/audioEncoders/__tests__/measureIntegratedLoudness.spec.ts`

#### AC-018 — The fabricated LUFS is gone

`referenceMixComparison/analyzeMix` must not derive loudness, RMS, or peak from fader
positions. `const lufs = rmsDb - 3;` and its siblings are deleted, and `compareToReference`
and `generateLessons` consume measured values or explicitly report that no measurement is
available.

*Violated by:* any loudness figure reaching the UI or an LLM prompt that was computed from
`track.gain` rather than from audio.

Verify with: `pnpm test:run --dir src src/modules/AudioAnalysis/useCases/referenceMixComparison`

#### AC-019 — Peak and RMS are measured over the whole render

Level figures must be computed across the full rendered buffer, not a 128-sample window. A
fixture whose peak occurs only outside the first 128 samples must have that peak reported.

*Violated by:* the `readLevels` sizing bug surviving — a fixture with a late peak reporting
the early level.

Verify with: `pnpm test:run --dir src src/modules/AudioAnalysis/services/__tests__/mixAnalysisHelpers.spec.ts`

#### AC-020 — True peak is measured with oversampling, against reference material

Inter-sample peaks must be detected by an oversampled true-peak meter at the factor pinned
in `RESEARCH.md`, verified against the conformance material described in RM-2. A signal
whose sample peak is below 0 dBFS but whose true peak exceeds it must be flagged.

This criterion **fails until the reference material is present**, by design. Acquiring it is
in scope.

*Violated by:* the sample-peak threshold at `analyzeMix.ts:65` surviving as the clip
detector, or a conforming test signal reading outside the pinned tolerance.

Verify with: `pnpm test:run --dir src src/modules/AudioRendering/repositories/audioEncoders/__tests__/measureTruePeak.spec.ts`

#### AC-021 — The analysis FFT resolves the declared bands

The spectral analysis window must be long enough that the narrowest declared band contains
at least ten bins and no two declared band boundaries fall in the same bin. At 48 kHz the
narrowest band is `sub` (20–60 Hz), which at the current `fftSize = 256` (187.5 Hz bins)
occupies one bin shared with `bass`.

The window length, its arithmetic, and the window function with its main-lobe width and
sidelobe attenuation are recorded in `RESEARCH.md`. The test derives bin counts from the
band table used in production, not from a copy.

*Violated by:* any declared band resolving to fewer than ten bins, or two boundaries sharing
a bin.

Verify with: `pnpm test:run --dir src src/modules/AudioAnalysis/services/__tests__/mixAnalysisHelpers.spec.ts`

#### AC-022 — A window function is applied, and it is not rectangular

The offline spectral analysis must apply the window function named in `RESEARCH.md`. The
test must assert the window's effect on a known input — a tone at a bin centre versus a tone
half a bin off centre — not merely that a window array exists.

*Violated by:* a test that checks only for the presence of a coefficient array; that test
stays green if the window is never applied.

Verify with: `pnpm test:run --dir src src/modules/AudioAnalysis/services/__tests__/mixAnalysisHelpers.spec.ts`

#### AC-023 — **[ears]** The report matches what the mix sounds like

On at least three real projects spanning different genres, an engineer confirms that the
loudness, band-balance, and clipping verdicts correspond to what is audible, and that no
verdict contradicts the audio. Recorded in the PR with the projects named.

*Violated by:* a report calling a mix "muddy" that is not, or reporting no clipping on
audibly clipped material. No machine check substitutes for this.

Verify with: listening pass, recorded in the PR body.

### Item 3 — analysis off the main thread

#### AC-024 — Analysis DSP runs in a Worker

Key detection, tempo detection, feature extraction, and mix analysis execute in a Worker.
Each of the four entry points must return a pending result and post to the worker; none may
compute its DSP inline. The test asserts the worker received the request and that the entry
point returned before the DSP completed — an ordering observation, not a mock-called check.

A boundary rule additionally confines the analysis DSP module so that the worker is its only
importer, which is what `deps:validate` can see; the ordering test is what proves the
runtime behaviour.

*Violated by:* an entry point whose result is available synchronously on return — the
current behaviour, where `analyzeMix` is `async` in signature only
(`src/modules/AudioAnalysis/useCases/analyzeMix.ts:36`).

Verify with: `pnpm test:run --dir src src/modules/AudioAnalysis/useCases/__tests__/analysisWorkerResponsiveness.spec.ts`

#### AC-025 — Main-thread responsiveness is measured by an independent observer

While a full-project analysis runs, a main-thread heartbeat must record a maximum gap below
the pinned budget. The observer must be independent of the code under test: it must not
re-base its interval on its own last observation, and it must not derive its budget from the
measurement.

**The harness must ship with proof it can fail**: a control run that deliberately blocks the
main thread for 200 ms of every 400 ms must red the criterion. A harness that has only ever
been green is untested measurement equipment.

*Violated by:* the deliberately-blocked control run passing. This is the criterion's primary
observation — a responsiveness metric that cannot report a stall is the failure shape this
repo has already shipped once.

Verify with: `pnpm test:run --dir src src/modules/AudioAnalysis/useCases/__tests__/analysisWorkerResponsiveness.spec.ts`

#### AC-026 — Verification selectors cannot pass vacuously

Every `Verify with:` command in this spec must fail when its selected test is absent. A
check enumerates the commands in this file and asserts that each resolves to at least one
existing test, using the guarded cargo form for Rust criteria.

*Violated by:* deleting any test named by a criterion above and having its command still
exit 0.

Verify with: `pnpm test:health-gates`

### Item 4 — model digests pinned

#### AC-027 — Every browser model carries a digest and a pinned revision

Every entry in the browser model catalogues declares a non-optional `sha256` and a URL
pinned to an immutable revision. `sha256` becomes required on the model type; `resolve/main`
is forbidden.

*Violated by:* any catalogue entry without a digest, or any model URL containing
`/resolve/main/`.

Verify with: `pnpm test:run --dir src src/modules/BrowserAi/models/__tests__/BrowserModel.spec.ts`

#### AC-028 — The digest is compared on the path production actually takes

Verification must run on the **streamed** path, not only the buffered one, and must not be
gated behind `Boolean(sha256)`. A downloaded model whose bytes do not match its digest is
rejected before anything is written to OPFS.

The test must exercise the streamed `.onnx` path — the one every shipped model takes — and a
mutation that removes the comparison must red it.

*Violated by:* a `mustBuffer`-style condition that routes real models around the check, or a
test that only covers the buffered branch. Both are true today.

Verify with: `pnpm test:run --dir src src/modules/BrowserAi/repositories/__tests__/modelDownloadManager.spec.ts`

#### AC-029 — Cached models are re-verified before use

A model already in OPFS is verified against its digest before being handed to the inference
runtime, matching the native path's cache-hit re-verification
(`model_download.rs:30`). Corrupting a cached file must cause rejection and re-download, not
a load.

*Violated by:* a corrupted OPFS file reaching `InferenceSession.create`. Today
`readModel.ts` and `checkModelCached.ts` perform no check at all — the latter probes only
for existence.

Verify with: `pnpm test:run --dir src src/modules/BrowserAi/repositories/__tests__/readModel.spec.ts`

#### AC-030 — Mismatch fails closed and says why

On digest mismatch: nothing is written to OPFS, nothing poisoned is promoted, the retry loop
does not re-fetch the same bad bytes indefinitely, and the user sees a message naming the
model and stating that integrity verification failed. Silent fallback to a degraded path is
forbidden.

*Violated by:* a mismatch that results in inference proceeding, or an error message that does
not distinguish integrity failure from a network failure.

Verify with: `pnpm test:run --dir src src/modules/BrowserAi/repositories/__tests__/modelDownloadManager.spec.ts`

#### AC-031 — Digests are recorded in one committed manifest with a generator and a verifier

Model digests live in a committed manifest with a `gen`/`verify` script pair matching the
`pnpm wasm:manifest` / `pnpm wasm:verify` precedent
(`scripts/verify-wasm-artifacts.ts:126-140`), and the verifier joins the web health gates.

Per ADR 0015 rule 3, the verifier must compare **two independently-sourced values**: the
manifest digest against a digest recomputed from the bytes. A verifier that compares the
manifest against the constant that generated it is a tautology.

*Violated by:* a verifier that passes when a manifest entry is edited by hand, or a manifest
with no verifier in the gate list.

Verify with: `pnpm test:health-gates`

#### AC-032 — Kokoro voice embeddings are covered

Voice embeddings fetched at render time
(`src/modules/BrowserAi/useCases/renderKokoroTts.ts:37,55`) are either pinned and verified
like models, or explicitly excluded in the manifest with a stated reason. Silence is not an
option.

*Violated by:* an unpinned, unhashed fetch reaching inference with no recorded exclusion.

Verify with: `pnpm test:run --dir src src/modules/BrowserAi/useCases/__tests__/renderKokoroTts.spec.ts`

#### AC-033 — **[ears]** No model swap changes output undetected

After the manifest lands, substituting a different model for a pinned one must be caught
before audio is produced. Confirmed once by hand per model family, recorded in the PR.

*Violated by:* a substituted model rendering audio without an integrity error.

Verify with: manual substitution pass, recorded in the PR body.

### Cross-cutting

#### AC-034 — No analysis result is presented with unearned certainty

Every analysis figure surfaced to a user or to an LLM prompt carries either a calibrated
confidence or an explicit "not measured" marker. No prompt may contain a number derived from
project metadata phrased as a measurement.

*Violated by:* any string in `mixHealthAnalysis` or `generateLessons` that presents a
non-measured value in the same form as a measured one.

Verify with: `pnpm test:run --dir src src/modules/AiRuntime/useCases/__tests__/mixHealthAnalysis.spec.ts`

#### AC-035 — Boundaries hold

No new cross-module deep imports; analysis DSP does not reach `presentations/`; the worker
stays isolated from app/helpers/Tauri per the worklet/worker rule.

*Violated by:* a new **error** edge or a stale baseline row.

Verify with: `pnpm deps:validate`

#### AC-036 — Types and lint stay clean

*Violated by:* a non-zero error count from either checker.

Verify with: `pnpm typecheck && pnpm typecheck:test && pnpm lint --quiet`

## Criteria summary

| Class | Count | Ids |
| - | - | - |
| Machine-verifiable | 34 | AC-001 … AC-022, AC-024 … AC-032, AC-034 … AC-036 |
| Ears required | 2 | AC-023, AC-033 |

## Open questions

- [ ] (non-blocking) Where the shared loudness implementation lives once mix analysis and
  export both consume it. It sits in `AudioRendering/repositories/audioEncoders/` today, and
  repositories are not cross-module importable. Default: promote to a pure helper under
  `src/helpers/` (it has no I/O — it is arithmetic over `Float32Array`), leaving the export
  repository as a caller.
- [ ] (non-blocking) Whether the Rust `crates/daw-dsp/src/proof/metering.rs` K-weighting
  adopts the TypeScript rate-correct derivation, or stays as-is scoped to Proof. Default:
  file separately; out of scope here.
- [ ] (blocking AC-006/AC-011/AC-013 target numbers only) The pinned accuracy targets. Set
  from the baseline the fixed detector actually achieves on RM-3, measured once and then
  pinned as a floor — not guessed in advance.

## Affected areas

- `src/modules/AudioAnalysis/` — `useCases/keyDetection.ts`, `useCases/tempoDetection.ts`,
  `useCases/analyzeMix.ts`, `useCases/referenceMixComparison/`, `services/mixAnalysisHelpers.ts`
- `src/modules/Arrangement/useCases/audioAnalysis/` — deletions (`detectKey.ts`, `detectTempo.ts`)
- `src/modules/Transport/useCases/tempoMapping/operations/` — adapter over the shared estimator
- `src/modules/AudioRendering/repositories/audioEncoders/` — loudness promotion
- `src/modules/BrowserAi/` — model catalogue, download manager, read/cache path
- New analysis Worker, alongside `src/modules/Transport/workers/`
- `scripts/` + `scripts/health-gates-web.sh` — model manifest generator and verifier
