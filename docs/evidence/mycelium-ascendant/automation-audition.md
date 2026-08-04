# Mycelium Ascendant — automation render-conformance sheet

Historical stem evidence captured: 2026-07-26 17:23 CEST; routed-mix evidence captured: 2026-07-26 18:03 CEST
Project fingerprint: `1cea829dfa15f1e3ac94e611606cc3ef2ac3c4a2bccdfe1cc5707412565ffd9c`
Renderer fingerprint: `d640394cb3899a812bfbdcbcb2af2ff8a81b94dc90d7c76e2fbda8175f5c8103` (`public/audio/worklets`, `public/wasm`, and `src`)

> Historical only: the canonical score has since changed. Fresh user audition and render capture are required before these measurements can support current acceptance.

After launching and reloading the saved demo, each required window was rendered through the app's real offline stem exporter at 44.1 kHz, stereo, with all 22 eligible track/bus stems. The false floor is additionally checked through a continuous, fully routed mix render against its return strike. Signal metrics are in `automation-stem-evidence.json`; the mastered stereo result is in `render-evidence.json`. Stem peaks are intentionally pre-master and are not delivery-level assertions.

**Historical AC-016 result:** automation topology and routed render behavior passed for the captured blueprint. Current render verification and timestamped human listening are pending fresh capture.

## Historical timestamped render-conformance results

| Window                            | Time                | Automation evidence                                                                                                                                                                                                                                                                 | Stem evidence                                                                                                                                                                         | Result   |
| --------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Beats 128–192 — Pressure Bloom    | 00:53.333–01:20.000 | 115 lanes/357 points. Rolling gain rises 0.52→0.92, cuts to 0 at 191.75, restores at 192. Rolling/riser cutoff 6,288→9,144→4,622 Hz; grain density 44→62→33.5; Dub feedback 0.462→0.606→0.378; chamber decay 0.662→0.806→0.578; width contracts to 0.722 before restoring to 0.914. | 22 stems, 9 audible. Rolling Colony, Acid Tendril, FM Spores, Impact Field, Psy Pluck, Pulse Engine, Fractal Riser, and Granular Voices all carry measured signal.                    | Pass     |
| Beats 288–352 — Psilocybin Chapel | 02:00.000–02:26.667 | 114 lanes/227 points. Rolling gain is removed at 288 and returns only to 0.18 by 352; Root Drone falls 0.76→0.58; grain density 51.5→39.5; Dub feedback 0.522→0.426; chamber decay 0.722→0.626.                                                                                     | 22 stems, 11 audible. Root Drone is strongest; Granular Voices, Glitch Spirits, Psy Pluck, Harmonic Mist, and Grand Boule Ritual remain audible around the 7/8 ritual.                | Pass     |
| Beats 352–416 — Singularity Build | 02:26.667–02:53.150 | 115 lanes/356 points. Rolling gain rises 0.18→0.96, cuts at 415.75, restores at 416. Rolling/riser cutoff 5,574→10,096→5,098 Hz; grain density 39.5→68→36.5; Dub feedback 0.426→0.654→0.402; chamber decay 0.626→0.854→0.602; width contracts to 0.710 then opens to 0.926.         | 22 stems, 9 audible. Rolling Colony, Acid Tendril, Impact Field, FM Spores, Triplet Helix, Pulse Engine, Fractal Riser, and Glitch Spirits carry measured signal.                     | Pass     |
| Beats 480–484 — False Floor       | 03:19.451–03:21.095 | 115 lanes/230 points. Rolling gain steps to 0 and restores to 0.96; cutoff 2,242→8,668 Hz; grain density 18.5→59; Dub feedback 0.258→0.582; chamber decay 0.458→0.782; width 0.770→0.902; drum master 0.626→1.004.                                                                  | Fully routed 416→488 render: floor RMS `0.0000479`/peak `0.000122`; return RMS `0.1554`/peak `0.7651`. Isolated Pulse/Rolling/Sub stems are effectively zero.                         | Verified |
| Beats 544–576 — Dissolution       | 03:45.753–03:58.994 | 115 lanes/267 points. Rolling gain 0.32→0 by beat 560; Root Drone 0.68→0.28 at Last Signal→0; drum master 0.906→0.668; cutoff 7,002→2,956 Hz; grain density 48.5→23; Dub feedback 0.498→0.294; chamber decay 0.698→0.494.                                                           | 22 stems, 11 audible. Rolling/Sub activity halves, Root Drone remains active through almost the full window, and organic/atmospheric stems decay around the final rhythmic fragments. | Pass     |

## Cross-lane automation coverage

The 115-lane project automates track gain and pan; Toaster master, swing, delay and reverb; Fermenter oscillator/filter/LFO/MSEG/FM/granular controls; insert filter, distortion, delay, autopan, phaser, chorus and tremolo controls; bus gain/feedback/decay; and master gain/width. Thirty-nine tracks are automated. No automation lane targets a dormant or nonexistent pattern.

## Runtime integrity

The isolated, non-reusing Playwright run passed after project reload with zero renderer warnings, console errors, page errors, failed requests, external requests, or HTTP errors. The allowlisted Web MIDI permission fallback and upstream WASM `initSync` deprecation notice do not change project state or rendered audio.

Reproduction:

```sh
node_modules/.bin/playwright test tests/e2e/myceliumAutomationStems.spec.ts --config=tests/e2e/playwright.mycelium.config.cjs
```
