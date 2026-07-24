---
type: audit
id: AUDIT-offline-export
scope: Offline export & rendering (mixdown, stems, encoders, native write, freeze/bounce shared paths)
repo: sourdaw
branch: audit/offline-export
base: origin/main @ 3a99a84974543dffa87df3a0c7d71b2ece67baa0
date: 2026-07-23
method: sus-audit (observe, prove, prescribe nothing — remediation sketches are non-binding)
---

# Offline Export & Rendering — Audit

AUDIT ONLY. Findings are evidence-anchored to `file:line` on the branch base SHA above. No production
code was changed. Remediation sketches are sized S/M/L and are directional, not prescriptive.

---

## 1. Golden Standard (first-class DAW offline export)

Grounding references (external, authoritative):

1. **EBU R 128 / ITU-R BS.1770** — loudness (LUFS) is measured per BS.1770; R128 targets −23 LUFS and
   caps true peak at **−1 dBTP**. True-peak (inter-sample) measurement, not sample-peak, is the
   standard clip guard. EBU R 128 spec: <https://tech.ebu.ch/docs/r/r128.pdf>; overview:
   <https://www.forasoft.com/learn/audio-for-video/articles-audio/loudness-normalization-ebu-r128-bs1770-atsc-a85>
2. **Dithering & noise shaping** — dither is applied **once, at final export, only when reducing bit
   depth** (e.g. float→16-bit). TPDF is the safe default; noise-shaping is only appropriate when no
   further DSP/SRC/lossy-encode follows. Do not dither float or when handing full-resolution files to
   a downstream stage. iZotope: <https://www.izotope.com/en/learn/what-is-dithering-in-audio.html>;
   LANDR: <https://blog.landr.com/what-is-dither-when-to-use/>
3. **Stem export conventions** — stems must extend length to **capture reverb/delay tails**
   ("Include Tail" / "Extend File Length"), preserve routing (sends to the same stem bus), and use
   **collision-free per-stem filenames**. Pre/post-fader and mute/solo semantics must be explicit and
   consistent with what the engineer monitors. Logic guide:
   <https://musictech.com/tutorials/logic-stem-mixing/>; all-DAW guide:
   <https://www.mixedbyma.com/post/the-ultimate-guide-to-exporting-stems>
4. **Offline render determinism / live↔offline parity** — `OfflineAudioContext` renders faster than
   real time to an `AudioBuffer`; the offline graph must reproduce the live graph (routing, automation,
   device params, mute/solo) so "export = what you hear." `suspend()` quantizes to the render-quantum
   boundary; **no two suspends may target the same quantized frame**; there is **no cancellation API**
   for an in-flight render. MDN:
   <https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext>,
   <https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext/suspend>

Distilled acceptance bar used for grading below:

- **Format parity**: WAV/FLAC/MP3 of the same mix are the same level and clip/quantize identically
  (dither on bit-depth reduction; no arbitrary per-format normalization divergence).
- **Graph parity**: offline reproduces live routing, automation of *every* automatable parameter,
  and mute/solo state.
- **Tails**: reverb/delay/instrument-release tails captured, not truncated.
- **Robustness**: cancellation actually reclaims work; large/long sessions do not OOM; deterministic
  where the pipeline allows.

---

## 2. Current-State Map

Mixdown orchestrator: `src/modules/AudioEngine/useCases/renderOffline.ts` (1 `OfflineAudioContext`,
builds strips for all renderable tracks, schedules only audible/non-muted source tracks, wires
sidechain + toaster-pad routes, eased simulated progress, `renderWithTimeout`).

Stems orchestrator: `src/modules/AudioEngine/useCases/exportStems.ts` (one `OfflineAudioContext`
**per stem**, concurrency pool clamped to `min(hardwareConcurrency, 8)`; groups Toaster parent+pads;
`honorMuted:false` so stems carry muted content; keyed by `track.id`).

Offline strip / graph: `offlineRender/createOfflineTrackStrip.ts`, `buildDeviceChain.ts`
(applies static `device.parameterValues` on create via `deviceStrategy/*`),
`offlineRender/scheduleTrackClips.ts`, `offlineRender/wireOfflineSidechainRoutes.ts`,
`offlineRender/getAutoDetectedTailSeconds.ts` → `services/estimateRenderTailSeconds.ts`,
`offlineRender/renderWithTimeout.ts`, `offlineRender/{acquireRenderLock,checkCancel,exportCancellation}.ts`.

Offline automation: `repositories/offlineScheduler/automationScheduling.ts` (gain/pan → AudioParam;
device params via `services/deviceResolution.ts::resolveDeviceParamTargets` hardcoded map **or**
`strategy.scheduleParam`), `compileAutomationEvents.ts`, `scheduleAutomationOnParam.ts`.

Encoders: `AudioRendering/repositories/audioEncoders/{wavEncoder,flacEncoder,mp3Encoder}.ts` behind
use cases `audioBufferTo{Wav,Flac,Mp3}.ts`.

UI + native write: `AudioRendering/presentations/views/ExportDialog.tsx`
(`handleExport`/`serializeAudio`, stem-name derivation ~L440), native writes
`repositories/audioExport/writeNativeAudio{Stem,Mixdown}File.ts` → Tauri `write_audio_file`.

Solo (live): `Arrangement/useCases/toggleTrackState/applySoloLogic.ts` →
`AudioEngine/useCases/trackAudioControls/setTrackMute.ts` (engine node only, not the project store).

### 2a. Verified parity — the master-track device chain (Proof/Crust) IS applied offline

Resolved empirically at the coordinator's request. The first pass raised this as an open question on a
**false premise** — that tracks default to `hw_out` / a bare master gain. They do not. Non-master tracks
default to `outputId: 'master'` and route **through the master strip** in both runtimes, so the master
track's device chain processes the summed mix live **and** offline. **Verdict: no master-chain parity
gap, not a blocker; no cross-reference to the RT-core audit is warranted.**

Evidence:
- Master track id is the literal `'master'`; non-master tracks default `outputId: 'master'` — only the
  master track itself outputs to `hw_out` — `Arrangement/models/Track.ts:179`, `:200`, `:251`.
- **Live**: `TrackNode.getDefaultDestination` resolves `outputId==='master'` to
  `getTrackGainNode('master')` (**not** the raw `masterGainNode`) — `engine/TrackNode.ts:205-212`,
  `repositories/createWebAudioEngine.ts:485` (`trackNodes.get(id)?.strip.gainNode`). The master strip's
  `gainNode` is the **device-chain input**: `let prevs = [s.gainNode]` → device chain → `preFaderTap` →
  `faderNode` — `engine/TrackNode.ts:294,300-315`. Incoming track audio therefore passes **through** the
  master devices before `preFaderTap`, then master output → `hw_out` → `masterGainNode` → meter →
  destination (`createWebAudioEngine.ts:186-187,291-293`).
- **Offline**: a regular track with `outputId==='master'` is not a bus, so it resolves to
  `trackStripsById.get('master')` and connects to the master strip's **inputNode** —
  `renderOffline.ts:158-163`. The offline master strip is `inputNode →
  buildDeviceChain(...,inputNode,preFaderTap) → preFaderTap → faderNode → postFaderGain → panNode →
  outputNode` — `offlineRender/createOfflineTrackStrip.ts:29,49-54`. Incoming audio passes **through**
  the master devices, then master output (`outputId==='hw_out'`) → `masterGain` —
  `renderOffline.ts:155-156`.

Both paths route the sum through the master device chain. (Static graph-topology proof; not a
decoded-audio A/B of live vs offline master output — see §6.)

---

## 3. Findings (severity-ranked)

### OE-1 — Encoders diverge: WAV normalizes + dithers; FLAC/MP3 hard-clip, no dither, no normalize — **Major**
**Evidence.**
- WAV: peak-normalization scan then scale (`gain = peak > 1 ? 1/peak : 1`) and **TPDF dither only at
  16-bit** — `wavEncoder.ts:80-92` and `:106-110` (`sample + tpdfDither()/0x8000`).
- FLAC: `toInt16Channel` **hard-clamps** float to `[-1,1]` and quantizes with **no dither, no
  normalization** — `flacEncoder.ts:253-268`; PCM MD5 likewise clamps (`:98-100`).
- MP3: `Math.max(-32768, Math.min(32767, round(x*32767)))` — **hard-clamp, no dither, no
  normalization** — `mp3Encoder.ts:20-23`.

**Why it violates the standard.** The same mixdown produces a **different level and different clipping
behavior** depending on chosen format (golden standard #1, #2): a hot mix that WAV rescales to full
scale is hard-clipped in FLAC/MP3, and FLAC's float→16-bit reduction is undithered (quantization
distortion) while WAV 16-bit is dithered. Format choice silently changes the master.

**Remediation sketch (M).** Centralize a single float→PCM stage (shared gain/normalization policy +
TPDF dither on any bit-depth reduction) that all three encoders consume, so per-format output differs
only in container/codec, not in level or quantization treatment.

---

### OE-2 — Stem filename collisions overwrite stems (native dir + web zip) — **Major**
**Status:** FIXED in #731
**Evidence.** `ExportDialog.tsx:440` `safeTName = (track?.name || trackId).replaceAll(/[^a-zA-Z0-9_\- ]/g,'_')`;
written as `${name}.${freq}` to a native directory (`writeNativeAudioStemFile.ts:16-18`, `join(dir,fileName)`)
or into the web zip map `zipDirectory[finalFileName]` (`ExportDialog.tsx` `serializeAudio`). No
per-stem uniqueness/index. Two tracks named "Bass" (duplicated tracks are common) both yield `Bass.wav`;
names differing only in stripped characters collide after sanitization (`Lead/Rhythm` and `Lead_Rhythm`
→ `Lead_Rhythm`).

**Why it violates the standard.** Collision-free per-stem naming is a hard stem-export requirement
(golden standard #3). The second write **silently overwrites** the first — a stem is lost with no error.

**Remediation sketch (S).** Derive stem names from a collision-resolving pass (append track index / de-dup
suffix; keyed by the already-unique `track.id`) before writing to disk or the zip map.

---

### OE-3 — Offline automation dropped for any device outside the hardcoded param map or the 3 scheduleParam nodes — **Major**
**Evidence.** Offline device-param automation resolves only via
`deviceResolution.ts::resolveDeviceParamTargets` — a **hardcoded `paramTargetMap` of built-in Web-Audio
devices** (`deviceResolution.ts:38-90`) — or, failing that, `candidate.strategy.scheduleParam`
(`automationScheduling.ts:88-103`). Only **FermenterNode, ToasterNode, ProofChamberNode** implement
`scheduleParam`/`acceptsScheduledParam` (grep: `engine/{Fermenter,Toaster,ProofChamber}Node.ts`).
`FaustDeviceStrategy` exposes only `setParam`/`setParamValue` — **no `scheduleParam`**
(`FaustDeviceStrategy.ts:9,23-25`; the live-only `scheduleParam(name,value,time)` in
`faustDeviceFactory.ts:79` is never surfaced to the offline scheduler). Faust params are not in
`paramTargetMap`. Net: **Faust devices, and any native-DSP worklet device other than
Fermenter/Toaster/ProofChamber, have their parameter automation silently frozen at the create-time
snapshot** offline while live plays them back.

**Why it violates the standard.** Breaks graph parity (golden standard #4): automated filter sweeps /
device moves render as flat values offline, diverging audibly from live.

**Remediation sketch (M/L).** Route offline device-param automation through a single capability
(worklet `AudioParam` map or `scheduleParam`) that every automatable device implements, rather than a
hardcoded allow-list plus three opt-in nodes. Add a coverage assertion that every automatable device
param resolves an offline target.

*Suggested regression test (not committed):* enumerate all device types with automatable params; assert
each resolves either an `AudioParam` target or `acceptsScheduledParam===true` offline.

---

### OE-4 — Solo is ignored by offline export (live↔offline parity break) — **Major**
**Evidence.** Solo-in-place applies through `applySoloLogic.ts:45-55` → `setTrackGain`/`setTrackMute`,
and `setTrackMute.ts:3-5` calls **`audioEngine.setTrackMute` only** — it does **not** write
`track.muted` in the project store. Offline reads project-store state: mixdown filters
`sourceTracks = allRenderableTracks.filter(t => !t.muted)` (`renderOffline.ts:99`); stems use
`honorMuted:false` (`exportStems.ts:145`). Neither path reads `soloed`
(grep for `solo` in `useCases/renderOffline.ts`, `exportStems.ts`, `offlineRender/*` → none). Thus a
session with an active solo exports **every non-muted track**, including ones silent during monitoring.

**Root cause — the store-vs-engine solo-state split.** Solo state lives in two places that only the live
path reconciles. `track.soloed` is written to the **project store** (`trackStore`) by
`toggleTrackState/soloTrack.ts` / `soloTrackExclusive.ts`. But the *audible consequence* of solo —
muting/attenuating the non-soloed tracks — is computed by `applySoloLogic.ts:38-55` and applied **only to
the live engine nodes**: it emits `setGain`/`setMute` actions, and `setTrackMute.ts:3-5` forwards to
`audioEngine.setTrackMute(...)` (an engine-node write) with **no `updateTrack` / project-store write**.
Consequently `track.muted` in the project store stays `false` for solo-muted tracks. The offline paths
read that store (`renderOffline.ts:99` `!t.muted`; stems `honorMuted:false`), so the engine-only solo
attenuation is **structurally invisible to export**. Solo is thus derived, engine-resident state that the
project-store-driven export pipeline never sees.

**Why it violates the standard.** "Export = what you hear" is violated when solo is engaged (golden
standard #3/#4). (Note: some DAWs deliberately ignore solo on bounce; the defect here is the *silent
mismatch* between live monitoring and export, driven by solo state living only on engine nodes.)

**Remediation sketch (M).** Compute effective audibility (mute ∪ solo, honoring workspace `soloMode`)
from `trackStore` + `workspaceStore` at export time and apply it to offline source-track selection, OR
persist solo-implied muting into a project-store read model that both `applySoloLogic` (live) and the
offline paths consume — i.e. close the store-vs-engine split rather than duplicate the solo math offline.

---

### OE-5 — `Array.from(bytes)` inflates every native write to a JSON number array (memory/throughput) — **Major**
**Evidence.** `writeNativeAudioStemFile.ts:18` and `writeNativeAudioMixdownFile.ts:17`:
`invoke('write_audio_file', { path, data: Array.from(bytes) })`. `Array.from` converts the `Uint8Array`
to a **boxed JS `number[]`**, which the Tauri IPC bridge JSON-serializes. For a multi-minute stereo WAV
(tens of MB) this is a large transient array plus a serialized-string copy — several × the byte payload,
per file, ×N stems.

**Why it violates the standard.** Long-session memory strategy (golden standard #4): large/many exports
risk OOM and stalls on the write path that a raw byte transfer would avoid.

**Remediation sketch (S/M).** Pass bytes as a tauri byte channel / `ipc::Response`/`tauri::ipc::Request`
raw-body path (or `postMessage` transfer) so the `Uint8Array` crosses without `Array.from` + JSON.
Matches known register row **M-109**.

---

### OE-6 — Cancellation and timeout cannot abort an in-flight render — **Major**
**Evidence.** `renderWithTimeout.ts:1-10` documents it: the timeout **rejects the promise but does not
cancel** — `startRendering()` "keeps running to completion in the background and its CPU is only
reclaimed when that resolves." `checkCancel()` is only invoked *between* scheduling steps
(`renderOffline.ts:137,194,238`); once `startRendering()` begins there is no cancel check. In stems, the
pool's `isCancelRequested()` guard (`exportStems.ts:226-229`) only blocks *starting new* tasks;
in-flight `OfflineAudioContext`s run to completion.

**Why it violates the standard.** Render cancellation should reclaim work (golden standard #4). Here
"Cancel" frees the lock/UI but a long render keeps burning CPU (up to 8 concurrent for stems). This is a
Web-Audio API limitation, but the UX presents cancel as immediate.

**Remediation sketch (M).** Render in bounded segments via `suspend()` and check the cancel flag at each
boundary so an abort stops scheduling further quanta; surface honest "finishing current block" state.

---

### OE-7 — No loudness/true-peak normalization; only sample-peak clip guard, and WAV-only — **Minor**
**Evidence.** The only level control is WAV's sample-peak rescale (`wavEncoder.ts:80-92`); FLAC/MP3 have
none (OE-1). No LUFS/R128 measurement or true-peak (inter-sample) limiting exists anywhere in the export
path (grep: no `LUFS`/`dBTP`/`truePeak` in `AudioRendering`/offline export).

**Why it violates the standard.** Golden standard #1: sample-peak ≤ 1 does not bound inter-sample peaks;
MP3/FLAC decoders can reconstruct >0 dBFS and clip. No optional loudness target for delivery.

**Remediation sketch (M).** Offer an optional R128/true-peak normalization stage (measure → gain →
true-peak ceiling at −1 dBTP) applied uniformly pre-encode across formats.

---

### OE-8 — FLAC is hardcoded 16-bit and ignores the user's bit-depth selection — **Minor**
**Evidence.** `flacEncoder.ts:186` `const BITS_PER_SAMPLE = 16`; `audioBufferToFlac(buffer, onProgress)`
takes **no bit-depth** (`:531`, use case `audioBufferToFlac.ts:9`). The export dialog exposes 16/24/32
bit depth, but selecting FLAC silently emits 16-bit regardless.

**Why it violates the standard.** Bit-depth/format handling should honor the requested depth; a lossless
format silently downgrading resolution is surprising and undithered (compounds OE-1).

**Remediation sketch (M).** Support 24-bit FLAC subframes and thread `bitDepth` through
`audioBufferToFlac`; until then, hide/disable depth for FLAC in the dialog.

---

### OE-9 — Tail auto-detect covers only built-in reverb/delay, capped 30 s; misses ProofChamber, plugins, instrument release — **Minor**
**Evidence.** `estimateRenderTailSeconds.ts:25-46` inspects only `builtin-reverb` (`rev-decay`) and
`builtin-delay` (feedback decay), `Math.min(30, …)`. It ignores the ProofChamber algorithmic reverb
("Dutch Oven"), Faust/native/plugin reverbs, and instrument amp-envelope release tails. Default export
`tailSeconds` is `0` unless the user opts into auto-detect (`renderOffline.ts:55`).

**Why it violates the standard.** Tails must be captured (golden standard #3). ProofChamber and long
plugin tails are truncated even with auto-detect on; the 30 s cap clips long reverbs.

**Remediation sketch (S/M).** Query each device for a declared tail length (add a `tailSeconds`
capability to the device contract) rather than a hardcoded two-type switch; raise/remove the cap or make
it configurable.

---

### OE-10 — 16-bit WAV dither is unseeded (`Math.random`) → non-reproducible bytes — **Minor**
**Evidence.** `wavEncoder.ts:50-52` `tpdfDither() = Math.random() - Math.random()`. Re-exporting an
identical project yields byte-different 16-bit WAVs.

**Why it violates the standard.** Determinism is expected where the pipeline allows; dither noise is
inherently random, but there is no seeded/repeatable option for reproducible/testable exports, and no way
to disable dither for bit-exact bounces.

**Remediation sketch (S).** Optional seeded PRNG for dither (repeatable exports) and a "no dither"
path for full-resolution/bit-exact bounces.

---

### OE-11 — Simulated progress + silent frame clamp on very long exports — **Polish**
**Evidence.** Progress during `startRendering()` is an eased `setInterval` simulation, not real progress
(`renderOffline.ts:248-253`, `exportStems.ts:201-206`). `frameCount = Math.min(ceil(durationSeconds *
sampleRate), MAX_OFFLINE_FRAMES)` with `MAX_OFFLINE_FRAMES = 2**30` (`renderOffline.ts:87`,
`exportStems.ts:116`, `constants.ts:18`) **silently truncates** audio beyond ~6.2 h @ 48 kHz with no
warning.

**Remediation sketch (S).** Warn (or split) when a requested render exceeds `MAX_OFFLINE_FRAMES`; drive
progress from `suspend()` checkpoints instead of a timer.

---

## 4. Remediation Roadmap (sequenced)

Findings total: **5 Major, 5 Minor, 1 Polish** (OE-1…OE-11). The master-chain question is resolved as
**no gap** (§2a) and adds no finding.

1. **Correctness of the master file first** — OE-1 (shared float→PCM/dither/normalize stage) and OE-8
   (FLAC depth), since they change the delivered bytes for every export.
2. **Silent data loss** — OE-2 (stem name collisions): small, high-value.
3. **Parity** — OE-4 (solo — close the store-vs-engine split) then OE-3 (device-automation coverage):
   both make "export = what you hear" true; OE-3 is the larger contract change.
4. **Robustness** — OE-5 (IPC bytes), OE-6 (segmented cancel/progress, which also unlocks OE-11 real
   progress).
5. **Delivery polish** — OE-7 (optional R128/true-peak), OE-9 (device-declared tails), OE-10 (seeded/
   no-dither), OE-11 (long-render warning).

---

## 5. Open Questions

- **Native-DSP device automatable-param inventory.** OE-3's blast radius depends on which non-
  Fermenter/Toaster/ProofChamber native devices (Grinder, Gluten, Bacteria, Levain, GrandBoule, Knead,
  Crumbs, Crust) actually expose automatable params live; each such param that lacks an offline target is
  an additional dropped-automation case.
- **Stem mute/solo policy intent.** `exportStems` deliberately exports muted-track content
  (`honorMuted:false`, `createOfflineTrackStrip.ts:13-21`); is the *desired* stem policy "always all
  content" or "reflect audible state"? Determines whether OE-4 extends to stems.
- **True-peak/loudness scope.** Is delivery-loudness normalization in scope for this app, or intentionally
  left to a mastering device (Proof)? Affects whether OE-7 is a gap or a non-goal.

*Resolved and removed from this list:* master-track device chain in the mix path — verified applied in
**both** live and offline (§2a).

---

## 6. Unverified / not covered

- No dynamic run of a full browser export was performed (static + targeted read only); timing/OOM claims
  (OE-5) are argued from the serialization shape, not measured. §2a is a static graph-topology proof, not
  a decoded-audio A/B of live vs offline master output.
- Freeze/bounce (`Arrangement/useCases/freezeBounce/*`) shares the offline strip/scheduler code but its
  file-writing and cleanup paths were not independently audited here.
- Correctness of the FLAC bitstream/CRC and the LAME MP3 wrapper was not validated against a reference
  decoder.
