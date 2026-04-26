---
name: faust-polyphony
description: Faust instruments are monophonic — users can't play chords. Param routing works via suffix fallback but is fragile.
type: audit
status: open
last_verified: '2026-04-20'
---

# Faust Instrument Polyphony & Parameter Routing

## Scope

Faust instrument compilation, node creation, parameter routing, and note scheduling. Covers N-36, N-37, N-48 from the original consolidated audit. N-24 retracted (not a real race).

## Goal

Faust instruments should support polyphonic playback (chords) and all knob changes should reach the DSP.

## Relevant code paths

- `src/modules/Plugin/useCases/faustEngine/compilerEngine.ts` — compilation + node creation
- `src/modules/Synth/useCases/faustInstrumentScheduler/startFaustNote.ts` — realtime note trigger
- `src/modules/Synth/useCases/faustInstrumentScheduler/scheduleFaustNote.ts` — clip playback note trigger
- `src/modules/AudioEngine/repositories/faustDeviceFactory.ts` — param bridge (setParam, scheduleParam)
- `src/modules/AudioEngine/engine/TrackNode.ts:481-499` — scheduleParam Faust branch
- `node_modules/@grame/faustwasm/src/FaustDspGenerator.ts` — Mono vs Poly generator API
- Faust DSP files in `src/modules/Plugin/useCases/faustEngine/dsp/*.dsp`

## Current behavior

**Monophonic only.** `compilerEngine.ts:143` uses `FaustMonoDspGenerator` for every Faust module. A single WASM DSP instance handles one `freq`/`gain`/`gate` triplet. Playing a second note while the first is sounding interrupts the first note's envelope — users cannot play chords on Rhodes, Hammond B3, FM Synth, or any Faust instrument.

**Param routing.** `faustDeviceFactory.ts` has `setParam` (line 46) which uses `node.setParamValue(name, value)` — the `@grame/faustwasm` API. This API's internal param map is keyed by full addresses like `/FM_Synth/algorithm`. Passing bare names like `algorithm` would fail silently since `fParamAliases[path] || path` falls back to the bare name which doesn't exist in the DSP's param map.

`scheduleParam` (line 55-72) has a suffix fallback that iterates `audioNode.parameters` looking for `key.endsWith('/' + name)`. This works but is O(N) per param set.

## Findings

- `FaustPolyDspGenerator` exists in `@grame/faustwasm` but is never imported or used anywhere in the codebase (verified via grep).
- The poly generator requires a `voices` count and a `mixerModule` (WASM voice mixer). The Faust compiler produces the mixer automatically for DSP files using standard `freq`/`gain`/`gate` convention.
- **6 of 7 Faust DSP files** use the full `freq`/`gain`/`gate` convention: `fm-synth.dsp`, `rhodes.dsp`, `hammond-b3.dsp`, `minimoog-lead.dsp`, `acid-bass-303.dsp`, `morphing-synth.dsp`. The 7th (`additive-synth.dsp`) has `freq` and `gate` but no `gain` param — would need a gain param added for poly compatibility.
- Note scheduling (`startFaustNote.ts` lines 13-15, `scheduleFaustNote.ts` lines 15-18) sets `freq`/`gain`/`gate` as raw AudioParam values via `scheduleDeviceParam`. For poly, `@grame/faustwasm`'s poly node accepts MIDI-style `keyOn(channel, pitch, velocity)` / `keyOff()` calls instead.
- ~~N-24 race condition~~ **RETRACTED** — `compilerEngine.ts:222` `resolveReg!()` is safe because Promise executors run synchronously per ECMAScript spec; `resolveReg` is always assigned before line 222 executes.

## Open issues

### 1. All Faust instruments are monophonic (N-37)

**Problem:** `compilerEngine.ts:143` — `new FaustMonoDspGenerator()`. One DSP instance, one voice.

**Needed:**

1. Switch to `FaustPolyDspGenerator` for instrument-type modules (effects stay mono).
2. Pass `voices: 8` (or configurable) and the mixer module to `createNode()`.
3. Replace `scheduleDeviceParam('freq'/'gain'/'gate')` with `keyOn(channel, pitch, velocity)` / `keyOff()` calls on the poly node.
4. Update `startFaustNote.ts` and `scheduleFaustNote.ts` to use the poly API.
5. Add `gain` param to `additive-synth.dsp` or mark it as special-case mono.

### 2. Faust param routing fragile (N-36 / N-48)

**Problem:** `setParam` (partially fixed 2026-04-19) now uses the suffix fallback for bare names, but the fallback is O(N) per param set. If a DSP has 30 params and you batch 10 changes, that's 300 iterations per block.

**Needed:** Build a `Map<bareName, fullAddress>` once at node creation time, use O(1) lookup.

## Suggested approaches

1. **Instrument vs effect detection:** Check if the DSP file declares `freq`/`gain`/`gate` params. If yes, compile as poly; if no, compile as mono. The Faust compiler metadata (`declare options "[nvoices:8]"`) can signal this.
2. **Voice count:** Default to 8 voices. Make configurable per-instrument preset if needed.
3. **Param map cache:** After `createFaustNode()`, iterate `audioNode.parameters` once, build `Map<bareName, fullAddress>`, store on the device node for O(1) lookups.

## Recommendation

Fix N-37 first — monophonic instruments are the most user-visible limitation. The param routing fix (N-36) is already partially done (suffix fallback works); the O(1) cache is an optimization.
