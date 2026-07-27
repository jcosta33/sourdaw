# Mycelium Ascendant — render and score conformance sheet

Score/stereo evidence captured: 2026-07-27 06:02 CEST; routed-mix evidence captured: 2026-07-27 05:59 CEST
Project fingerprint: `ba393156719bbefa59aba850d760326099fdbff48ac4a6c294043af1a3bd85e7`
Source receipt: capture HEAD `3398838a221b15438f91fbb879b8805163811061`; tracked-source tree `145d728c59c8fa428106f5de6099941cdc65aebae42b63bb548dba42e0f3396a` (8,845 files; generated evidence excluded); receipt `d9c42366fc254cb0c700167fd4b964b12c445bcfced61a88f004ef38b60c4653`
Stereo artifact: `608a70c0f857e2f92c766c70812423526b4ff3a431e6b19a9508877c43768415`

Reviewer/method: Codex automated render, score, cue, and stem conformance; no loudspeaker/headphone subjective-listening claim is made. A decoded complete stereo export was attached only to the local Playwright run, not persisted in Git because GitHub Actions cannot currently start under the repository billing restriction. The mix is active for 95.85% of measured blocks and ends at 03:58.994 before its two-second export tail.

**AC-001 / AC-006 / AC-016 status: partial / unsupported for subjective audition.** The machine-verifiable score, render, cue, automation, and stem requirements pass; timestamped human listening remains outstanding.

## Eight-section machine conformance

| Section                 |   Beats | Time                | Clips | Notes | Active note tracks | Render/score checkpoint                                                                                                                                                                                                                     | Result |
| ----------------------- | ------: | ------------------- | ----: | ----: | -----------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Sporefall               |    0–64 | 00:00.000–00:26.667 |     6 |   132 |                  6 | Organic mist, piano/orchestral calls, drone, granular and glitch material establish atmosphere before the full rhythm section.                                                                                                              | Pass   |
| First Germination       |  64–128 | 00:26.667–00:53.333 |     7 |   140 |                  7 | Eight kick teasers, shaker shuffle, sub ghosts, triplet figure, pluck and Levain answer introduce pulse in stages.                                                                                                                          | Pass   |
| Pressure Bloom          | 128–192 | 00:53.333–01:20.000 |    16 |   338 |                 16 | Full kick grid, rolling bass, pluck/FM pressure, riser/impact layers, upward automation and first vacuum are present; nine stems measure audible.                                                                                           | Pass   |
| Drop I — Hyphal Drive   | 192–288 | 01:20.000–02:00.000 |    27 |   831 |                 27 | 96 kicks and 288 rolling-bass notes anchor alternating lead blocks, full percussion, acid motion, organic calls, and glitch flourishes; three isolated renders prove dry→wet→dry return blocks with the kick/bass engine active throughout. | Pass   |
| Psilocybin Chapel       | 288–352 | 02:00.000–02:26.667 |    14 |   499 |                 14 | The 7/8 ritual occupies beats 288–316 without the normal kick/rolling grid; call/answer, piano, drone, mist, granular and glitch signals dominate before grid restoration. Eleven stems measure audible.                                    | Pass   |
| Singularity Build       | 352–416 | 02:26.667–02:53.150 |     9 |   445 |                  9 | Triplet/FM layers, 174 escalating tom-roll notes, 32 risers, 32 impacts, widening FX, and the second vacuum create the largest crescendo. Nine stems measure audible.                                                                       | Pass   |
| Drop II — Fractal Bloom | 416–544 | 02:53.150–03:45.753 |    29 | 1,304 |                 29 | 128 kicks, 384 rolling-bass notes, all 16 drum-pad roles, displaced/transformed leads, organic punctuations, automation-muted false floor, and return strike form the densest section.                                                      | Pass   |
| Dissolution             | 544–576 | 03:45.753–03:58.994 |    11 |   129 |                 11 | Main Vision ends by beat 552, drum gain reaches zero at 560, and Rolling Colony remains present until its final fade at 576; drone, granular, mist, Levain, and Grand Boule signals carry the tail. Eleven stems measure audible.           | Pass   |

## Named cue machine conformance

| Cue           | Beat | Time      | Evidence checkpoint                                                                                                                                                                                                      | Result   |
| ------------- | ---: | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Pulse Emerges |   48 | 00:20.000 | Marker begins the final Sporefall lead-in; the following section introduces kick teasers every eight beats and the first sub ghosts.                                                                                     | Pass     |
| Vacuum I      |  188 | 01:18.333 | Pressure automation reaches maximum filter/FX values at beat 188; bass and pad events vacate 191.75–192 before Drop I.                                                                                                   | Pass     |
| Grid Restored |  316 | 02:11.667 | Alternating 7/8 ritual ends and the normal kick/rolling grid resumes for the chapel's final 36 beats.                                                                                                                    | Pass     |
| Vacuum II     |  412 | 02:51.505 | Build automation peaks at beat 412; bass/pad events vacate 415.75–416 before Drop II.                                                                                                                                    | Pass     |
| False Floor   |  480 | 03:19.451 | Fully routed 416→488 render: floor RMS `0.0000479495`/peak `0.000120508`; return RMS `0.135796`/peak `0.764661`. Representative rhythm and voice stems are effectively zero while their Drop II MIDI remains continuous. | Verified |
| Return Strike |  484 | 03:21.095 | Automation restores bass gain, drum master, filters, space and width at the boundary; Drop II events resume from beat 484.                                                                                               | Pass     |
| Last Signal   |  568 | 03:55.667 | Root Drone and late organic voices mark the final eight beats while rhythm/bass and FX automation continue toward zero.                                                                                                  | Pass     |

## Normalized note-event report

Events are converted from clip-relative positions to absolute beats and grouped into half-open section ranges. `note-event-report.json` contains complete section/track counts; `motif-event-report.json` adds section-relative beat, pitch, duration, velocity, and interval signatures for lead, Levain, and Grand Boule comparisons.

| Section           | Total notes | Rhythm/low-end anchors                                     | Voice anchors                                                                                 |
| ----------------- | ----------: | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Sporefall         |         132 | No kick or rolling-bass events                             | Harmonic Mist 32; Levain Call 32; Grand Boule Ritual 32; Root Drone 4; Granular 16; Glitch 16 |
| First Germination |         140 | Kick 8; Shaker 16; Sub 4                                   | Triplet Helix 32; Psy Pluck 32; Levain Answer 32; Granular 16                                 |
| Pressure Bloom    |         338 | Kick 64; Rolling Colony 28; Shaker 32; Closed HH 55        | Psy Pluck 32; FM Spores 32; Riser 16; Impact 16; Granular 16                                  |
| Drop I            |         831 | Kick 96; Rolling Colony 288; Sub 24; broad percussion      | Psy Pluck 48; Main/Counter 24 each; FM 48; organic calls/piano 12 each; Glitch 24             |
| Psilocybin Chapel |         499 | Shaker 56; post-316 Kick/Rolling 18 each; Sub 7            | Psy Pluck/Mist/Glitch 68 each; Call/Answer/Piano 36 each; Root 5; Granular 67                 |
| Singularity Build |         445 | Hi Tom roll 174; Kick/Rolling 16 each                      | Triplet 64; FM 63; Riser/Impact/Glitch 32 each                                                |
| Drop II           |       1,304 | Kick 128; Rolling Colony 384; Sub 32; all percussion roles | Triplet/Pluck/Mist/FM 64 each; Main/Counter 32 each; organic calls/piano 16 each; Glitch 32   |
| Dissolution       |         129 | Kick/Rolling/Sub/Acid/Closed HH 15 each                    | Levain/Piano 16 each; Mist/Granular 8 each; Main 4; Root 2                                    |

## Delivery checks

- Complete export: stereo, 44.1 kHz, 24-bit PCM WAV, 240.994 seconds including two-second tail.
- Integrated loudness: -9.761 LUFS; true peak: -2.212 dBTP; clipped samples: 0.
- DC offsets remain below 0.004; low-frequency mono compatibility is -0.005 dB with positive correlation.
- The stem run reloaded the saved project before offline export; export and stem runs observed no console errors, page errors, failed requests, external requests, HTTP errors, missing assets, or renderer warnings.
