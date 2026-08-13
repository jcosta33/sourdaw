---
type: architecture-decision-record
status: accepted
date: 2026-08-12
---

# 0024 — Warp modes are named by material, over three closed executors

**Accepted 2026-08-12.** Resolved from primary sources under the owner's standing direction that decision gates are research tasks. Resolves the algorithm-family and naming questions in both
`SPEC-time-stretch-engine` artifacts, and decides the fate of `crumbs/warp/granular.rs`.

## Context

Three parallel stretch vocabularies exist in the tree today:

| Where | Values | Persisted? |
| --- | --- | --- |
| `Arrangement/models/Track.ts:98` `Clip.stretchMode` | `off \| repitch \| timestretch` | **yes, CRDT** — and the only one live playback reads |
| `Arrangement/models/WarpMarker.ts:20` `WarpState.stretchMode` | `repitch \| complex \| texture \| beats` | in-memory |
| `ElasticAudio/stores/audioWarp.ts:20-26` `WarpAlgorithm` | `repitch \| phase-vocoder \| wsola` | in-memory |

Two of the three carry an availability gate because their executors do not exist yet.

## What the industry does

Six vendors, and they agree completely on one thing:

| DAW | User-facing mode names |
| --- | --- |
| Ableton Live 12 | Beats, Tones, Texture, Re-Pitch, Complex, Complex Pro |
| Logic Pro | Slicing, Rhythmic, Monophonic, Polyphonic, Speed |
| Cubase Pro | élastique Time/Pitch/Tape; Standard presets Drums, Plucked, Pads, Vocals, Mix, Solo |
| Pro Tools | Polyphonic, Rhythmic, Monophonic, Varispeed, X-Form |
| Studio One | Drums, Sound, Solo, Tape |
| REAPER | engine names surfaced (the sole exception) |

**Six of six name user-facing modes by material or musical intent. Zero name them by algorithm.**
Nobody ships a mode called "WSOLA" or "phase vocoder" — Logic describes Polyphonic as working "based
on a process called phase vocoding" in prose, but the *name* is the material.

Apple names no vendor at all: `grep -ci "elastique"` over the 70,126-line official Logic guide returns
zero.

**And nobody ships a granular family member.** Ableton's own Audio Fact Sheet puts Texture on the
granular side and Complex on the other — "The algorithms used in the Complex and Complex Pro Warp
Modes use an entirely different technology from the algorithms behind Beats, Tones, Texture, and
Re-Pitch modes" — so Texture is a granular *parameterisation of the same family*, not a separate
engine. Cubase exposes the granular mechanism as parameters (Grain Size, Overlap, Variance) without
naming the technique.

## Decision

**Keep the executor set closed at three — repitch, phase vocoder, WSOLA — and name the user surface by
material over them.**

Delete `crates/daw-dsp/src/crumbs/warp/granular.rs`. It has zero callers anywhere in `crates/` or
`src-tauri/`, and no surveyed vendor ships a distinctly named granular member. Fermenter and Bacteria
have their own live granular engines; this one is dead code.

Retire the algorithm names from the UI and collapse the second and third vocabularies into one
material-named surface. `Clip.stretchMode` stays the persisted truth, untouched. Neither in-memory
vocabulary is a wire format, so this costs no migration.

Mapping: `repitch → repitch`, `beats → wsola`, `complex → phase-vocoder`. **Texture is dropped rather
than aliased** — Ableton's own split places it on the granular side, so shipping it as a synonym for
Complex would be a name promising a technique we do not run.

## On publishing quality and CPU metadata

Related, and settled by the same survey: every vendor ships an **ordinal** tier with prose guidance —
Logic "the most processor intensive of all the flex algorithms", Cubase "quite CPU-intensive" and
"requires less computing power, but has a lower audio quality", Ableton "may be more CPU-intensive
than the other Warp Modes". **Not one publishes a measured per-algorithm quality or CPU figure.**

So restore `bestFor` (material) and a two-value cost tier to `getAlgorithmInfo`, and nothing more.
Those fields were deleted in #709 because they were unmeasured claims attached to third-party engine
names — a tier with a hardware-labelled characterization behind it is a different object. That
characterization must build in release first (#1629), or the tier would rest on debug numbers.

## Consequences

The user picks a mode by describing their material, which is what every DAW they have used has taught
them to do.

Three vocabularies become one surface plus one persisted field.

## Sources

- Ableton Live 12 §9.3 and Audio Fact Sheet §38.3.1: https://www.ableton.com/en/live-manual/12/audio-clips-tempo-and-warping/ · /audio-fact-sheet/
- Logic Pro 12.3 Flex Time algorithms: https://support.apple.com/guide/logicpro/flex-time-algorithms-and-parameters-lgcpa77a4a3f/mac
- Cubase Pro 15: https://www.steinberg.help/r/cubase-pro/15.0/en/cubase_nuendo/topics/time_stretch_and_pitch_shift_algorithms/
- Pro Tools Elastic Audio: https://www.avid.com/pro-tools/user-guide/elastic-audio
- Studio One / Fender Studio Pro: https://fenderstudiopromanual.fender.com/en/Content/Editing_Topics/Timestretching.htm
- REAPER 7.78 user guide §10.2

**Unverified:** Live 10 and earlier warp wording; the fuller Pro Tools reference text on X-Form being
render-only (Avid's help URLs for it now 404 — only the eight-word user-guide line is citable).
