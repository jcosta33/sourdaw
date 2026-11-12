# Automation module — Agent Guidelines

Owns parameter automation lanes, breakpoint envelope curves, live automation recording (touch/latch/write), gesture thinning, and parameter modulation mappings/LFOs; does not own device parameter laws or track lifecycle (Arrangement) or audio DSP evaluation (AudioEngine).

## Public Contract Surface

Public surface: `useCases/index.ts`, `stores/index.ts`, `presentations/views/index.ts`.

## Key Subsystems

- **Automation Store & Envelopes:** Point storage sorted by beat with curve interpolation algorithms (linear, exp, s-curve, step) in `services/automationPointAlgorithms.ts`.
- **Recording Engine:** Real-time parameter capture supporting touch, latch, write modes, auto-match return ramps, and point simplification (`simplifyGesturePoints`).
- **Modulation Matrix:** LFO and modulator routing to target parameters with scalable depths.
- **Time Operations & Clip Automation:** Automation slice/shift transforms across arrangement edits and clip boundaries.

## Invariants & Traps

- **Strictly Ordered Points:** Lane points must always remain strictly sorted by beat; simultaneous points at identical beat offsets are disallowed except for step-transition jumps.
- **Gesture Decimation:** High-frequency live capture points must be thinned with `simplifyGesturePoints` to protect CRDT document size and UI performance.
- **Curve Parity:** Runtime evaluation in `getAutomationValueAtBeat` and UI rendering must share identical curve mathematics.
- **Modulator Cleanup:** Track/device deletions must clean up target modulation mappings via `restoreTrackModulationReferences`.
- **Range Writes Preserve the Outside:** `automateParameterRange` holds one parameter at a target across `[startBeat, endBeat)` and must leave every beat outside it sounding as before. Linear and step segments split exactly at a boundary; a boundary cutting any other curve, or moving a neighbour a `smooth` segment reads, is refused rather than approximated (`services/buildParameterRangePoints.ts`). The range is materialized to beats at admission so lock and scope checks read what the write covers; undo restores the exact prior points, or removes a lane the write created together with exactly its points, and refuses when anything else has touched them. Every member of a batch is described before any runs, so a write plans against what its earlier members will leave only where the planner projects them: an earlier range write on the same lane (its planned points become this write's starting points), and, for a `send:<busId>` target, an earlier `createBus` of that bus and an earlier `addSend`, `setSend` or `removeSend` of exactly this track and bus (`useCases/automation/projectBatchSendState.ts`, shared with `automateSendRanges`). Any other earlier member that writes the same lane, track, or device is refused, because the write would capture an inverse for a project those members are about to change. Undoing such a batch restores the later range writes before it removes the lane the first one created, so `removeAutomationLane` reads the points an earlier restore of the same lane in its batch leaves, and `restoreAutomationLanePoints` that names its expected points is reapplicable inside an atomic batch. An earlier member is also refused when its declared effect can move what the range is read against — the sections and markers a name is matched among, the clips the marker it names reads when that marker runs to the arrangement end, the meter that places bars: the production-brief lock guard admits the batch against the beats resolved at admission, so resolving again at execution would write beats that guard never saw. The ramp beats are clamped into order, so the points the write plans are the points the lane stores, and an empty lane whose parameter plays at a value outside the lane's range — a silent or near-silent fader below a decibel lane's floor — is refused as `no-parameter-value`, because the lane would clamp the points carrying that value and move every beat outside the range.
- **Range Writes Survive a Reload:** a range write, including the retired section tools kept executable for stored commands, keeps its undo entry in the saved session history. Its guarded inverses (`removeAutomationLane`, `restoreAutomationLanePoints`, and the three legacy range removals) are internal session-replay contracts whose payloads are read only in the shape their handlers execute, and the forward write's `validateSessionEntry` keeps an entry only when its undo is the pair it recorded: the removal carrying exactly the materialized legacy write, or, for `automateParameterRange`, removal of the lane its `writeId` created holding exactly the points it wrote, or a restore of another lane whose expected points hold the write's own run of `<writeId>-point-N` points and, while the project holds that lane, is the track's own lane for the written parameter (`handlers/automation/validateRangeWriteSessionEntries.ts`). The run of identity points binds the undo to the lane the write addressed: no other lane can hold them, so a saved restore aimed at another lane is dropped rather than left to overwrite it. An entry the mirror cannot serialize strands every older entry behind it, so a range write without these contracts loses the whole earlier history on reload.

## Verification

PR CI owns broader unit and crate suites. Locally run only the exact changed spec or filtered Rust test.

```bash
pnpm guard --profile focused -- pnpm test:run <changed-spec>
```
