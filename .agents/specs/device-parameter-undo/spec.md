---
type: spec
id: SPEC-device-parameter-undo
title: Device parameter changes are undoable
status: draft
owner: The Sourdaw team
sources:
    - .agents/specs/device-parameter-undo/
---

# Device parameter changes are undoable

## Intent

Turning a control on a built-in device must produce exactly one undo step, and
pressing undo must put the control back where it was. Today almost none of them
do.

## Verified current state

Measured against `main` at `e103a29db`.

`executeAppAction` is the only route to the undo stack: `commitUndoEntry` is
reached from `executeAppAction.ts:234`, `executeAppActionBatch.ts:255` and
`pushUndoEntry.ts:29` and nowhere else. Undo is not a document rewind — it
dispatches the handler's `inverseAction` as a forward action
(`undo.ts:54-57`), and that inverse is snapshotted by `describe()`, which runs
*before* the write (`executeAppAction.ts:90-92`).

Only **two** source files dispatch `setDeviceParameter` from a device surface:

- `ProofChamber/presentations/views/ProofChamberPanel.tsx:224, 234, 249, 254,
  320, 417, 733`
- `Tuner/useCases/setA4Reference.ts:59`

Everything else reaches project truth by a route with no undo entry at all.

| Device | Route to project truth | Undo entry today |
| --- | --- | --- |
| Fermenter | `fermenterParamBridge` → `persistDeviceParam` (`trackStore.set`) | none |
| Levain | `levainParamBridge/helpers.ts:74` → `persistDeviceParam` | none |
| Grinder | `grinderParamBridge/createFlushParam.ts:28` → `persistDeviceParam` | none |
| Gluten | `glutenParamBridge` → `persistDeviceParam` | none |
| Crust | `crustParamBridge` → `persistDeviceParam` | none |
| Bacteria | `bacteriaParamBridge/createFlushParam.ts:20` → `persistDeviceParam` | none |
| Proof | `proofParamBridge/setProofParam.ts:18` → `persistDeviceParam` | none |
| Toaster | store subscriber → `setDeviceState` action | none — `handleSetDeviceState.ts:36` is `undoable: false` |
| Yeast | own CRDT slot via `commitYeastProjection.ts:32` | none |
| CvGate | own CRDT slot via `cvOutputOperations/*` | none |
| Knead | own CRDT slot; pitch edits do go through `commitPitchEdit` | partial |
| GrandBoule | `grandBouleStore` only — **not a CRDT slot** | none, and not persisted at all |
| Crumbs | knob values go to Tauri IPC only; the CRDT chunk carries `mode` + `activeSample` | none, and not persisted at all |
| ProofChamber | `executeAppAction({setDeviceParameter})` | **yes — but one per parameter** |
| Tuner | `executeAppAction({setDeviceParameter})`, gesture-split | yes, one per gesture |

`handleSetDeviceState.ts:9-18` states in a comment that device edits have no
undo of their own and that giving them one "means routing the edits themselves
through actions, which is a larger change than making them survive a reload and
is deliberately not attempted here". That is the change this spec governs.

Two devices cannot be made undoable at all until they are made to persist:
**GrandBoule** (nine engine-affecting surfaces, known-wrong at
`src/app/prepareOfflineDeviceSetup.ts:88-99`) and **Crumbs** knob values.

## What one undo step is

**A gesture is one entry. A preset load is one entry. Different parameters are
different entries.**

Concretely, the shape already established by `Tuner/useCases/setA4Reference.ts`:

- Transient half (pointer-move): drive the engine only. No project-truth write,
  no action, no history.
- Commit half (pointer-up, keyboard step, click, double-click reset): one
  `executeAppAction({ type: 'setDeviceParameter' })`.
- Bulk change (preset, patch recall): one `executeAppActionBatch` with one
  `groupId`, which `undo` pops as a unit (`undo.ts:85-141`).

### Why this shape, and what the sources actually say

The research does **not** support the common claim that "drag equals one undo
entry" is a documented DAW convention. It is not stated in any manual reviewed
(Ableton Live 12, Logic Pro, Cubase/Nuendo, Pro Tools, Bitwig, REAPER). What
the sources do settle:

- The gesture primitive in every plugin standard is documented as an
  **automation** mechanism, not an undo mechanism. VST3's `beginEdit`/`endEdit`
  exist so "automation recording cannot work correctly" otherwise
  ([VST3 dev portal](https://steinbergmedia.github.io/vst3_dev_portal/pages/Technical+Documentation/Parameters+Automation/Index.html));
  CLAP says gestures improve "the user experience a lot when recording
  automation" ([clap/events.h](https://github.com/free-audio/clap/blob/main/include/clap/events.h));
  Apple TN2104 frames gestures around automation overwrite.
- The one **spec-level** statement that a bracketed change is one undo step is
  CLAP's undo extension, which is deliberately a *separate* extension from
  gestures: the host will "create a single undo step that will merge all the
  changes"
  ([clap/ext/draft/undo.h](https://raw.githubusercontent.com/free-audio/clap/main/include/clap/ext/draft/undo.h)).
  That is the mechanism this spec adopts — an explicit commit boundary, not an
  inferred one.
- Merge-by-identity — coalesce edits to the same target, never across different
  targets — is the documented editor pattern: Qt's `QUndoStack` "will only try
  to merge two commands if they have the same ID"
  ([Qt docs](https://doc.qt.io/qt-6/qundostack.html)). CodeMirror 6 and
  ProseMirror both publish a 500 ms `newGroupDelay` *and* require adjacency.
- Automation playback must not generate undo entries. Cubase states it:
  "read automation actions are not part of the MixConsole history"
  ([Steinberg](https://archive.steinberg.help/cubase_pro/v11/en/cubase_nuendo/topics/mixconsole/mixconsole_undo_redo_parameter_c.html)).
- Whether a preset load is one entry or N is **not settled** by any DAW manual.
  CLAP's undo extension exists precisely to make it one; that is the tie-break
  used here.

### Rejected alternative: time-window coalescing at the undo layer

Merging consecutive `setDeviceParameter` entries that share
`(deviceId, paramId)` inside a ~500 ms window would need no per-device work.
It is rejected because it does not fix the underlying cost: the bridges would
still write project truth once per animation frame, so the CRDT op log stays
flooded even though the undo stack looks clean. An explicit commit boundary
fixes both. It would also be a second, competing mechanism next to the
transient/commit split the Tuner already ships.

### Open question for the owner — not blocking

Logic Pro and Cubase both keep device/mixer parameter history in a **separate**
lane from project edits (Logic's Undo History has Mixer and Plug-In tabs and an
opt-in "Include Plug-In Undo Steps in Project Undo History"; Cubase has a
distinct MixConsole History). Sourdaw has one history, and ProofChamber and the
Tuner already put device parameters in it. **Recommendation: keep one history.**
A second stack would need its own persistence, its own CRDT story and its own
panel, and the sole documented benefit — keeping a knob tweak from burying a
timeline edit — is already bought by gesture coalescing. Revisit only if users
report history churn after this lands.

## Cost per gesture

| | Actions | Automerge transactions | Undo entries | Project-truth writes during drag |
| --- | --- | --- | --- | --- |
| Today (bridge device) | 0 | 0 (bare `trackStore.set`) | 0 | ~1 per animation frame |
| Today (ProofChamber knob) | 1 per pointer-move | 1 per pointer-move | 1 per pointer-move | 1 per pointer-move |
| Today (ProofChamber preset) | ~20 | ~20 | ~20 | ~20 |
| Under this spec | 1 | 1 | 1 | 0 |

Gesture coalescing strictly *reduces* CRDT write volume for the bridge devices;
it is not a trade of history size against document size.

## Requirements

### AC-001 — Undo restores a device parameter to its prior value

For every device with a parameter surface, changing a parameter and calling
`undo()` must leave the stored parameter at the value it held before the
change. The observable is `Device.parameterValues` (or the device's own CRDT
slot), not a handler call count.

Verify with: `pnpm test:run --dir src <device>ParameterUndo.integration.spec.ts`

### AC-002 — A drag is exactly one undo entry

Driving N intermediate values followed by one commit must add exactly one entry
to `undoStore.past`. Intermediate values must reach the engine and must not
reach project truth.

Verify with: the same integration spec, asserting `undoStore.past.length`
before and after, and asserting each interior value in the engine-write log.

### AC-003 — Different parameters are different entries

Two commits to two parameters must produce two entries; the first undo must
restore only the second parameter.

### AC-004 — A preset or patch load is one undo step

A preset load must dispatch `executeAppActionBatch` with a single `groupId`, so
one `undo()` restores every parameter the preset moved.

### AC-005 — Automation playback produces no undo entries

Values delivered by `applyAutomation` must not reach `executeAppAction`.
`ExecuteOptions.source` is `'manual' | 'prompt' | 'voice' | 'ai'` today
(`handlerContract.ts:1147`); automation is absent because automation must not
dispatch at all rather than dispatch with a distinguishing source.

### AC-006 — GrandBoule and Crumbs persist before they undo

`grandBouleStore` must become a CRDT slot and Crumbs' knob values must reach
`Device.parameterValues`, before AC-001 can be stated for either. These are
prerequisite persistence changes, not undo changes.

## Delivered so far

- **Gluten** — full conversion. `setGlutenParamWithAudio` takes `isTransient`;
  `GlutenCurve` gained a gesture boundary; the commit dispatches
  `setDeviceParameter`. Guards: AC-001, AC-002, AC-003.
- **ProofChamber** — AC-004 only. `selectSpace` is one batch with one
  `groupId`. Its per-knob drags still commit on every pointer-move; the panel
  has no transient path and `chamberStore` has no engine subscriber, so a
  transient branch there needs its own `updateDeviceParam` call.

## Remaining

Fermenter, Toaster, Levain, GrandBoule, Grinder, Crust, Bacteria, Proof,
Yeast, Crumbs, CvGate, Knead, and ProofChamber's knobs. The seven
`persistDeviceParam` bridges (Fermenter, Levain, Grinder, Crust, Bacteria,
Proof, and Gluten which is done) share the Gluten shape exactly. Toaster,
Yeast, CvGate and Knead each need their own decision because they persist
through `setDeviceState` or their own CRDT slot rather than
`Device.parameterValues`.
