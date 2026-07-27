# Mycelium Ascendant — originality review

Review captured: 2026-07-27 04:06 CEST
Project fingerprint: `6a446b6627bc3dfeeb6a0b4c2dadca8bb32bd5be055665d97ba8d5f2b928e856`
Source receipt: revision `bf4a2be71ddb315aee04bfc2e7cbf21223d74925`; scoped tree `6e1d4df627945ebf6662dfa3cb1c8abb8ea9a5aa31271848348db79d0c8192a2`; receipt `25d0052c9f75a4dd6c55276ba9d0cfe6897f008ddfc0bc400ba9a07dcd90545f`
Stereo artifact: `249b186c425fc21417494c0eae30f9fd538c860e318061f9e39e8bcf3bc089bc`
Review basis: decoded 24-bit/44.1 kHz stereo export metrics and hash, normalized MIDI-note and motif-event reports, automation report, and five 44.1 kHz stereo stem windows. The WAV was attached only to the local Playwright result and is not a persistent PR artifact.

## Scope and verdict

The track uses Astrix, Infected Mushroom, and Shpongle only as high-level genre references: psychedelic trance pacing, rolling low-end, organic/electronic contrast, spatial effects, and large-form tension/release. Repository inspection establishes that the deterministic project imports no reference recording, external sample, audio buffer, or attributed catalog asset; all sound is generated from Sourdaw instruments, devices, MIDI, routing, and automation. The score documents purpose-built melodic, harmonic, rhythmic, timbral, and arrangement material, but repository evidence cannot establish catalog-wide non-infringement.

Verdict: the specification's source/asset originality boundary passes. Subjective originality listening remains unsupported, and no external music-catalog fingerprint comparison was performed.

## Timestamped encoded creative-intent conformance

| Time                | Section                 | Original musical identity and transformation evidence                                                                                                                                                  | Result |
| ------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 00:00.000–00:26.667 | Sporefall               | Harmonic Mist, Levain Call, Grand Boule Ritual, Root Drone, Granular Voices, and Glitch Spirits establish an organic fungal sound world without a full kick/bass groove.                               | Pass   |
| 00:26.667–00:53.333 | First Germination       | Eight-beat kick teasers introduce the pulse while Triplet Helix, Psy Pluck, Levain Answer, and granular material reveal the first electronic motif vocabulary.                                         | Pass   |
| 00:53.333–01:20.000 | Pressure Bloom          | Four-on-the-floor pressure, a three-note rolling colony, filter opening, rising FX, and the 01:18.333 vacuum create a purpose-built first crescendo.                                                   | Pass   |
| 01:20.000–02:00.000 | Drop I — Hyphal Drive   | The full rhythmic engine supports alternating Main Vision/Counter Vision blocks, Psy Pluck/FM mutations, organic call-and-answer, and glitch flourishes.                                               | Pass   |
| 02:00.000–02:26.667 | Psilocybin Chapel       | A genuine 7/8 ritual from beats 288–316 replaces the main kick grid with alternating Levain call/answer, piano ritual, drone, granular voices, and spatial FX before the grid returns at 02:11.667.    | Pass   |
| 02:26.667–02:53.150 | Singularity Build       | Triplet and FM layers, accelerating roll density, riser/impact fields, widening modulation, and the 02:51.505 vacuum form a second, distinct crescendo.                                                | Pass   |
| 02:53.150–03:45.753 | Drop II — Fractal Bloom | The second drop combines transformed/displaced lead cells, broader voice density, all 16 drum pads, organic punctuations, and a four-beat false floor at 03:19.451 before the 03:21.095 return strike. | Pass   |
| 03:45.753–03:58.994 | Dissolution             | Rhythm and bass thin while Main Vision, Harmonic Mist, Levain Call, Grand Boule Ritual, Root Drone, and Granular Voices carry the final signal into a controlled decay.                                | Pass   |

## Rhythm and performance originality checks

- Generated score: 119 clips and 3,818 notes across 43 tracks; 39 tracks carry 115 automation lanes and 1,583 points.
- Voice material spans 103 semitones and contains six distinct first-four-note interval signatures, including the opposed cells `3,4,-5` and `-3,-4,5`.
- Voice attacks use multiple straight, triplet, and displaced subdivisions rather than one repeated grid.
- The 7/8 chapel alternates call and answer bars and removes the normal kick/rolling-bass grid through beat 316.
- Drop voices alternate in eight-beat blocks; Drop II adds transformed/displaced material rather than copying Drop I verbatim.
- Cadence fills, two pre-drop vacuums, the false floor, return strike, late organic re-entry, and diminishing outro are encoded as separate performance events.
- No audio clips reference `bufferId`; no network request, external file, microphone, MIDI device, or plugin asset is required to launch or export the track.

## Evidence links

- `render-evidence.json` — mastered stereo render identity and measured delivery metrics; the E2E run emits `mycelium-stereo-wav` only as a local test attachment.
- `note-event-report.json` — complete section/track note counts.
- `motif-event-report.json` — normalized section-relative beat, pitch, duration, velocity, and interval signatures for lead, Levain, and Grand Boule comparisons.
- `automation-stem-evidence.json` — real offline stem signals for every required automation audition window.
- `listening-conformance.md` — timestamped eight-section/cue render-and-score conformance sheet.
- `launch-integrity.md` and `desktop-runtime-evidence.json` — browser and Tauri-v2 webview-contract launch scope, dependency proof, and runtime logs.
