---
type: audit
id: AUDIT-automation
scope: src/modules/Automation, live apply path (Transport playheadScheduler → applyAutomation),
  offline path (AudioEngine offlineScheduler), device targeting (utils/automationDeviceTarget)
baseline_sha: 6e9cf66612bd5699c41709fb306ff982e2a4f8a3
method: sus-audit (observe, prove, prescribe nothing)
---

# Automation audit

Audit-only. No fixes. Every observation is anchored to `file:line` at baseline SHA
`6e9cf66612bd5699c41709fb306ff982e2a4f8a3`. Findings measure the present implementation against a
first-class-DAW golden standard; remediation sizing (S/M/L) is descriptive, not a prescription.

## Golden standard (citations)

1. **Automation recording modes — Write / Touch / Latch / Trim, and AutoMatch release ramp.** Pro
   Tools: Write overwrites all enabled params from playback start; Touch writes while the control is
   held and *returns to previously written levels via AutoMatch* on release; Latch writes from first
   touch until stop or manual AutoMatch; Trim writes a *separate relative lane* that combines with the
   underlying automation; on release the control "returns to previously written levels at a rate
   determined by the AutoMatch preference." — Sound On Sound, *Automation Facilities In Pro Tools*
   (https://www.soundonsound.com/techniques/automation-facilities-pro-tools); MusicTech, *Learn to use
   the Automation modes in Pro Tools 2020*
   (https://musictech.com/tutorials/pro-tools/learn-to-use-the-automation-modes-in-pro-tools-2020/).

2. **Stable, canonical parameter identity across reorder.** CLAP: the parameter `clap_id id` "must
   never change" and uniquely identifies a parameter across instances; UI/layout reordering must not
   change the id; the `cookie` is only a lookup accelerator and is invalidated by a full rescan — it
   is never the identity. — free-audio/clap `ext/params.h`
   (https://github.com/free-audio/clap/blob/main/include/clap/ext/params.h); DeepWiki, *Parameter
   Management* (https://deepwiki.com/free-audio/clap/5.1-parameter-management).

3. **Zipper noise & the smoothing boundary.** Zipper noise is the audible discontinuity from a series
   of near-instantaneous step gain changes; it is "discernible if you update parameters at block
   rate." The fix is per-sample (or ramped) interpolation between control values at the DSP boundary
   (`rampsmooth~` / `slide~`, `setTargetAtTime`-style ramps). — Cycling '74 forum, *How to avoid
   "zipper noise"* (https://cycling74.com/forums/how-to-avoid-%22zipper-noise%22-when-use-sliders-as-control-signals);
   US Patent 8,258,870, *Digital control of amplifier gain with reduced zipper noise*
   (https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8258870).

4. **Interpolation fidelity & offline↔realtime parity.** DAWs interpolate automation (linear /
   polynomial / bezier); historically automation is updated periodically then smoothed, so "having the
   automation rate too high for rendering might cause artefacts or step changes to surface that did not
   occur in real-time playback." Offline render and realtime playback must evaluate the *same* curve to
   stay in parity. — AdmiralBumblebee, *DAW v DAW Part 5: Plugin Automation*
   (https://www.admiralbumblebee.com/music/2019/06/22/Daw-V-Daw-Automation-Part-4.html); KVR, *Automation
   with handles or bezier curves?* (https://www.kvraudio.com/forum/viewtopic.php?t=339910).

## Current-state map

### Data model
- `AutomationPoint` / `AutomationLane` / curve union — `src/modules/Automation/models/Automation.ts:1-50`.
  Curves: `linear | exponential | step | s-curve | stairs | smooth | bezier`. Lane carries
  `linkedLaneId`, `linkScale`, `virginTerritory`, `enabled`, `trimPoints?`, `clipId?`, per-lane
  `minValue/maxValue`.
- **Duplicate** point/curve model for the engine side —
  `src/modules/AudioEngine/models/AutomationViewTypes.ts:6-26` (module-isolation policy; independent copy).

### Reference interpolation (live)
- `interpolateAutomationPointValue` — `src/modules/Automation/services/automationPointAlgorithms.ts:89-178`.
  Handles step/stairs/exponential/s-curve/smooth(Catmull-Rom)/bezier(Newton x-solve)/linear.
- `simplifyAutomationPoints` (Douglas–Peucker) — same file `:29-54`.
- Live lookup `getAutomationValueAtBeat` — `src/modules/Automation/useCases/automation/getAutomationValueAtBeat.ts:15-99`.
  Lane-by-id cache, binary search for the bracketing segment, linked-lane resolution with cycle guard.

### Live application path
- `startPlayheadScheduler` worker tick — `src/modules/Transport/useCases/playheadScheduler/startPlayheadScheduler.ts:96-328`.
  Default grain `scheduleGrainMs: 10` (100 Hz) — `src/modules/Transport/models/TransportState.ts:38`. Per
  tick, at `:321-325`, calls `applyVcaGains`, `applyAutomation`, `applyModulation`, `applyModulationToEngine`.
- `applyAutomation` — `src/modules/Transport/useCases/scheduling/applyAutomation/applyAutomation.ts:40-152`.
  gain/pan → `engineSetTrackGain/Pan`; device params → per-`lane→device` exponential slew (`SLEW_ALPHA=0.4`,
  `SLEW_EPSILON=5e-5`, `:21-23`, `:110-124`) then `updateDeviceParam` / `setFermenterMappedParam`.
- Engine gain/pan smoothing — `TrackNode.setGain/setPan` use `setTargetAtTime(..., 0.01)` —
  `src/modules/AudioEngine/engine/TrackNode.ts:166-176`.
- Device target resolution (canonical `deviceId:paramId`, legacy type-id fallback) —
  `src/utils/automationDeviceTarget.ts:24-72`.

### Offline path
- `scheduleTrackAutomation` — `src/modules/AudioEngine/repositories/offlineScheduler/automationScheduling.ts:33-121`.
  Filters `trackId && !clipId` (`:47`); gain/pan/device via `scheduleAutomationOnParam` /
  `compileAutomationSegments` (worklet strategy) with `compensationDelaySec` (#616 latency comp).
- `compileAutomationEvents` — `.../offlineScheduler/compileAutomationEvents.ts:121-240`. Re-samples
  non-linear curves at `AUTOMATION_SAMPLE_INTERVAL_SEC = 0.01` (`:6`) into piecewise-`linear` events;
  region crop + initial-value carry (`:139-157`); own copy of the curve math `interpolateValue` (`:18-79`).
- `compileAutomationSegments` — frame-quantized segments for worklet devices — `.../compileAutomationSegments.ts:12-51`.

### Recording
- `startAutomationRecording` (seed at playhead) — `src/modules/Automation/useCases/automationRecording/startAutomationRecording.ts:9-46`.
- `recordAutomationValue` (buffers raw points, latency-compensated beat, tempo captured once) —
  `.../recordAutomationValue.ts:11-80`.
- `RECORDING_MODES = {write, touch, latch}`, `AutomationMode = read|write|touch|latch|off` —
  `.../recordingSessionState.ts:16,32`.
- `releaseTouchAutomation` — `.../releaseTouchAutomation.ts:5-18`. `stopAutomationRecording` (write/latch
  span clear, one scoped undo entry) — `.../stopAutomationRecording.ts:38-113`; called from transport stop
  (`stopPlayheadScheduler.ts:12`) and `seekPlayhead.ts:39`.
- Recorded-value feeders: fader/pan (`Arrangement/.../setTrackGainPan/maybeRecordAutomation.ts:32`), device
  params (`setDeviceParameter.ts:54`), MIDI learn (`ControlSurface/.../handleMidiMessage.ts:66`), touch release
  from the mixer strip (`MixerConsole/.../useChannelStripActions.ts:84,89`).

### Modulation subsystem
- `applyModulationToEngine` — `src/modules/Automation/useCases/modulation/applyModulationToEngine.ts:170-234`.
  Recomputes an automated base per device/param (`indexAutomatedBases`, `:125-156`) then adds the modulation
  delta on top, own slew (`SLEW_ALPHA=0.4`, `:15`, `:220-232`). `resetModulationSlew` exists at
  `.../resetModulationSlew.ts:9`.

## Findings

Severity: **blocker** (silent corruption/loss on a common path) / **major** (wrong render or audible
artifact under a normal feature) / **minor** (edge case, papercut, latent). Remediation: S/M/L.

### AU-1 — Two hand-maintained curve implementations with no cross-conformance test; already drifting — **major**, M

Status: FIXED in #747 — collapsed the two AU-1-audited runtimes (live apply path + offline compile path) onto one shared kernel (`src/utils/automationCurve.ts`, `evaluateAutomationCurve`); the live copy adopted the offline-aligned `stairs` clamp [2,32] + fraction clamp, the offline copy adopted the absent-tension default; a permanent cross-conformance gate (live-side + offline-side `automationCurveConformance` specs, sharing one case table) now guards re-divergence. Behavioral caveat: a project whose points carry out-of-range `stairSteps` (0 / negative / fractional / >32) now clamps in **live playback** too — previously live played those unclamped (0 → `NaN`, >32 → finer steps), disagreeing with the bounce; live now matches the bounce. Residual (not this PR): two non-playback evaluators still hold their own curve math — Arrangement's `interpolateAutomationValue` (editor playhead readout) and TimelineEditor's `buildCurvePath` (SVG rendering); route them to the kernel as a follow-up.
Live `interpolateAutomationPointValue`
(`services/automationPointAlgorithms.ts:89-178`) and offline `interpolateValue`
(`offlineScheduler/compileAutomationEvents.ts:18-79`) are independent copies of the same seven-curve
math. No spec exercises both: `automationPointAlgorithms.spec.ts` and `compileAutomationEvents`'s only
callers (`automationScheduling.spec.ts`, `scheduleAutomationOnParam.spec.ts`) never assert equality
across the two. PR #616's reconciliation deleted the curve-conformance spec and none replaced it.
**Observed drift:** `stairs` steps — live reads `firstPoint.stairSteps ?? 4` with no clamp and no
`trunc` (`:107-109`); offline clamps `Math.min(32, Math.max(2, Math.trunc(...)))` (`:29-31, :199`). A
lane with `stairSteps` = 0, negative, or fractional produces different stepping live vs bounce.
Failure mode: the two paths diverge silently on any future curve edit; no gate catches it. Firing
condition: any point whose curve params exit the values both copies happen to agree on. Blast radius:
every automated parameter's rendered vs monitored value.

### AU-2 — Live plugin-param slew has no offline counterpart; live monitoring ≠ bounce — **major**, M
`applyAutomation` runs every automated *device* param through a first-order IIR slew
(`alpha 0.4` per 100 Hz tick, `applyAutomation.ts:110-124`) before writing. The offline path
(`compileAutomationEvents` / `scheduleAutomationOnParam`) schedules the **exact** curve with no such
slew. Consequence: for device automation, realtime playback lags and low-passes the curve while the
offline bounce does not — the mix you monitor is not the mix you render (violates parity standard §4).
The slew is also a systematic error even live: the applied value never reaches a fast target (it always
trails), so sharp automation moves are rounded off only during playback. (gain/pan are exempt — they
bypass the slew and are smoothed in-engine by `setTargetAtTime`, `TrackNode.ts:166-176`.)

### AU-3 — Offline render ignores linked lanes — **major**, M
Live `getAutomationValueAtBeat` follows `linkedLaneId` with `linkScale` and treats the source as
authoritative (`getAutomationValueAtBeat.ts:41-57`). Offline `scheduleTrackAutomation` reads raw
`lane.points` only (`automationScheduling.ts:47-49, :104-108`) — it never consults `linkedLaneId`. A
lane whose value comes entirely from a link (empty local `points`) is skipped by the `points.length === 0`
guard (`:50`) and renders **silent** in the bounce while playing correctly live. Blast radius: any
project using F3.3 linked/inverted automation.

### AU-4 — `pluginParamSlew` is never reset on transport discontinuity — **major**, S
**Status: FIXED in #746.**
The device-param slew map (`applyAutomation.ts:33,87,107,139`) has no reset path — grep finds no clear
on seek, loop-wrap, or follow-action jump, and no `resetAutomationSlew` exists. On a loop wrap or seek
the next `applyAutomation` seeds `prev` from the stale smoothed value and glides toward the new target
over ~9 ticks (~90 ms), so every automated device param audibly *slides* into place at each loop
boundary and after every locate. (The scheduler does advance a discontinuity epoch at these points —
`startPlayheadScheduler.ts:184,209` — but `applyAutomation` never reads it.) Note the modulation analog
`resetModulationSlew` (`resetModulationSlew.ts:9`) also has **zero call sites**, so modulation carries
the same latent glide.

### AU-5 — Recorded gestures are never thinned; two RDP implementations — **major**, M
**Status: FIXED in #746.**
`recordAutomationValue` pushes one raw `AutomationPoint` per incoming UI/MIDI event
(`recordAutomationValue.ts:66-74`); `flushPendingPoints` → `batchAddAutomationPoints` with **no**
decimation (`flushPendingPoints.ts:6-19`). `thinAutomationPoints` / `simplifyAutomationPoints` run only
on an explicit user `handleThinAutomation` AppAction (`handlers/automation/handleThinAutomation.ts:9`),
never automatically on record-flush. Standard practice thins recorded automation on write; here a fader
ride persists at full input resolution into the Automerge doc and the undo entry, inflating CRDT
history and every subsequent lookup. Compounding: a **second** Douglas–Peucker exists at
`Arrangement/transformers/automationTransformers` (`rdpSimplify`, re-exported via
`Arrangement/useCases/automationQueries/rdpSimplify.ts`) alongside the Automation-module copy —
duplicated thinning logic.

### AU-6 — No touch/latch release ramp (AutoMatch) — **minor**, M
`releaseTouchAutomation` clears the touch flag, flushes points, and nulls `lastValue`
(`releaseTouchAutomation.ts:5-17`). Nothing ramps the parameter back to the underlying automation on
release; the very next `applyAutomation` reads existing points at the current beat and the value can
snap. The golden standard (§1) requires AutoMatch: on release the control glides back to previously
written levels at a configured rate. No AutoMatch preference or ramp exists.

### AU-7 — `automationMode: 'off'` does not restore the manual/base value — **minor**, S/M
`applyAutomation` skips a lane when `track.automationMode === 'off'` (`applyAutomation.ts:61`) and
`applyModulationToEngine` likewise (`applyModulationToEngine.ts:107`). Skipping only *stops writing* —
it leaves the engine param frozen at the last automated value. Standard 'off' semantics play the
static/manual value; here toggling a mid-ride lane to 'off' strands the parameter wherever the ride
left it, with no revert-to-base.

### AU-8 — `virginTerritory` is not honored during playback — **minor**, M
The lane flag is documented "when true, gaps between points defer to manual control"
(`Automation.ts:44`). Neither apply path consults it: `getAutomationValueAtBeat` interpolates straight
through (`getAutomationValueAtBeat.ts`, no reference) and offline `scheduleTrackAutomation` compiles all
points regardless. The flag is UI-only; playback always interpolates across gaps, so "virgin territory"
has no acoustic effect.

### AU-9 — `lane.enabled` is not enforced in either apply path — **minor**, S
`AutomationLane.enabled` (`Automation.ts:38`) is checked by neither `applyAutomation`
(filters on `points.length` + `automationMode`, `applyAutomation.ts:55-74`) nor
`scheduleTrackAutomation` (filters `trackId && !clipId` + `points.length`, `automationScheduling.ts:47-52`).
A lane the UI marks disabled still drives the engine live and offline.

### AU-10 — Gain automation is silently clamped to unity — **minor**, S (confirm intent)
`applyAutomation` maps a dB lane to linear `10 ** (value / 20)` (`applyAutomation.ts:82`) then calls
`setTrackGain`, which clamps to `[0,1]` (`TrackNode.ts:167`). Any gain-automation point above 0 dBFS is
capped at unity — automation cannot boost above the fader's 0 dB. If a >0 dB range is intended (fader
default is 0.8), this is a silent loss; if the fader ceiling is by design, it is a documentation gap.

### AU-11 — Automation vs modulation use inconsistent bases for a shared param — **minor**, S
When a device param is both automated and modulated, `applyAutomation` writes the **slewed** automation
value (`applyAutomation.ts:110-124`) while `applyModulationToEngine` recomputes the **raw** (unslewed)
automation value as its base (`indexAutomatedBases` → `getAutomationValueAtBeat`,
`applyModulationToEngine.ts:150-153, :205`). Both fire each tick on the same param with different
smoothing; modulation runs last and wins (`startPlayheadScheduler.ts:322-324`), so the earlier
automation-only write is wasted and the two can momentarily disagree.

### AU-12 — Offline may drop clip-scoped automation — **minor / open**, M
`scheduleTrackAutomation` filters `!length.clipId` (`automationScheduling.ts:47`), so clip-level lanes
are excluded from this path; live `applyAutomation` *does* handle `clipId` lanes with clip-bounds gating
(`applyAutomation.ts:65-70`). If no separate offline path schedules clip automation, clip-scoped rides
are absent from the bounce. Unverified whether such a path exists — see Open Questions.

### Control-rate / zipper assessment (observation)
`applyAutomation` applies at `scheduleGrainMs = 10` ms (100 Hz). Gain/pan are smoothed in-engine by
`setTargetAtTime(..., 0.01)` (no zipper). Device/worklet params are updated at 100 Hz through the
control-rate slew, not per-sample/block ramps at the DSP boundary; whether residual zipper is audible on
fast moves depends on each DSP's internal smoothing and cannot be proven by static reading. Flagged for a
runtime measurement rather than asserted as a defect.

## Remediation roadmap (sizing only — no prescription)

| ID | Severity | Size | Theme |
| --- | --- | --- | --- |
| AU-1 | major | M | Single source of curve truth / conformance gate |
| AU-2 | major | M | Live↔offline parity for device-param smoothing |
| AU-3 | major | M | Linked lanes in offline render |
| AU-4 | major | S | Reset automation slew on discontinuity |
| AU-5 | major | M | Thin recorded gestures; dedupe RDP |
| AU-6 | minor | M | Touch/latch AutoMatch release ramp |
| AU-7 | minor | S/M | 'off' restore-to-base semantics |
| AU-8 | minor | M | Honor virginTerritory in playback |
| AU-9 | minor | S | Enforce lane.enabled |
| AU-10 | minor | S | Gain clamp intent / range |
| AU-11 | minor | S | Unify automation/modulation base |
| AU-12 | minor/open | M | Clip automation in offline render |

## Proposed regression tests (throwaway repros not committed)
- Cross-conformance: sample every curve type (incl. boundary `stairSteps`, tensions, bezier cp) at
  N beats through both `interpolateAutomationPointValue` and offline `interpolateValue`; assert
  within tolerance (guards AU-1).
- Linked-lane offline: lane with empty `points` + `linkedLaneId` to a populated source; assert
  `scheduleTrackAutomation` emits the source curve (guards AU-3).
- Slew reset: drive `applyAutomation` across a simulated loop-wrap; assert the first post-wrap device
  write equals the target, not a glide from the pre-wrap value (guards AU-4).
- Record-thinning: feed a dense ramp through `recordAutomationValue` + `stopAutomationRecording`;
  assert flushed lane point count is decimated (guards AU-5).

## Open questions
1. Is there an offline scheduling path for **clip-scoped** automation lanes, or are they intentionally
   excluded from bounce (AU-12)?
2. Is the fader/gain ceiling of 0 dBFS a product decision, making AU-10 a doc gap rather than a bug?
3. Was the exponential device-param slew (AU-2) deliberately live-only, accepting the monitor≠bounce
   divergence, or is offline meant to mirror it?
4. Is `resetModulationSlew` dead code (no call sites) or an unwired intended reset (relates AU-4)?
5. Are `virginTerritory`/`lane.enabled` intended as UI-only affordances (AU-8/AU-9), or should they
   gate playback?

## Unverified areas
- No audio was rendered; zipper audibility, slew timbre, and loop-boundary glide are reasoned from code,
  not measured.
- CRDT persistence shape of lanes/points was not opened beyond the store read contract.
- TimelineEditor draw-session UI (`beginDrawSession`/`paintDrawPoint`/`endDrawSession`) was inventoried
  by name only, not audited for point density at draw time.
