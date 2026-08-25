# Automation module — Agent Guidelines

Owns parameter automation lanes, breakpoint envelope curves, live automation recording (touch/latch/write), gesture thinning, and parameter modulation mappings/LFOs; does not own device parameter laws or track lifecycle (Arrangement) or audio DSP evaluation (AudioEngine).

## Public Contract Surface

- `stores/`: `automationStore` (`AutomationLane`, `AutomationCurveType`, `AutomationStoreState`), `modulationStore`, `modulationRuntimeStore` (`ModulationStoreState`).
- `useCases/`: Lane & point CRUD (`addAutomationLane`, `removeAutomationLane`, `addAutomationPoint`, `batchAddAutomationPoints`, `updateAutomationPoint`, `setAutomationPointCurve`, `removeAutomationPoint`, `replaceAutomationLanePoints`, `restoreAutomationLanePoints`), transforms (`scaleAutomation`, `stretchAutomation`, `invertAutomation`, `reverseAutomation`, `thinAutomation`, `quantizeAutomation`, `shiftClipAutomation`, `deleteAutomationTimeRange`, `duplicateClipAutomation`), recording (`startAutomationRecording`, `stopAutomationRecording`, `recordAutomationValue`, `releaseTouchAutomation`, `resolveAutoMatchValue`), drawing sessions (`beginDrawSession`, `paintDrawPoint`, `endDrawSession`), modulation (`addModulator`, `removeModulator`, `updateModulator`, `addMapping`, `removeMapping`, `applyModulationToEngine`), query helpers (`getAutomationValueAtBeat`, `getAutomationLaneCeiling`, `isRecordingAutomation`).
- `events/`: No public domain event payloads exported.
- `presentations/views/`: `ModulationMatrix`.
- Handlers: `getAutomationHandlers()`.

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

## Verification

```bash
pnpm vitest run src/modules/Automation
pnpm deps:validate
```
