import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

type CountByPath = Readonly<Record<string, number>>;
type ProductionSource = { path: string; source: string };
type SinkFamily = 'persistence-runtime' | 'strip-add' | 'direct-built-in' | 'load-compile-hydration';

type SinkDefinition = {
    pattern: RegExp;
    includes: (path: string) => boolean;
};

function includeAllPaths(): boolean {
    return true;
}
const BUILT_IN_USE_CASE_ROOTS = [
    'src/modules/Bacteria/useCases/',
    'src/modules/Crumbs/useCases/',
    'src/modules/Crust/useCases/',
    'src/modules/Fermenter/useCases/',
    'src/modules/Gluten/useCases/',
    'src/modules/GrandBoule/useCases/',
    'src/modules/Grinder/useCases/',
    'src/modules/Levain/useCases/',
    'src/modules/Proof/useCases/',
    'src/modules/Toaster/useCases/',
] as const;

const SINK_DEFINITIONS: Record<SinkFamily, SinkDefinition> = {
    'persistence-runtime': {
        // Bare identifiers intentionally catch imports, property aliases, and calls.
        pattern: /\b(?:persistDeviceParam|persistDevicePatch|updateDeviceParam|updateDevicePatch)\b/g,
        includes: includeAllPaths,
    },
    'strip-add': {
        pattern: /\baddDeviceToStrip\b/g,
        includes: includeAllPaths,
    },
    'direct-built-in': {
        // Bare identifiers catch `const { setParam: write } = controls` as well as direct calls.
        pattern: /\b(?:setParam|setPadParam)\b/g,
        includes: (path) => BUILT_IN_USE_CASE_ROOTS.some((root) => path.startsWith(root)),
    },
    'load-compile-hydration': {
        pattern:
            /\b(?:compile[A-Z][A-Za-z]*|load[A-Z][A-Za-z]*PatchWithAudio|loadToasterKitPreset|loadSamplesForInstrument|loadInstrument|set[A-Z][A-Za-z]*Immediate|audioDevice\.loaded)\b/g,
        includes: includeAllPaths,
    },
};

const EXPECTED_SINK_COUNTS: Record<SinkFamily, CountByPath> = {
    'persistence-runtime': {
        'src/app/bootstrap.ts': 9,
        // Count provenance: new file entry, measured 2 — the import and one
        // direct engine restoration used only by Command abort cleanup. The
        // Automerge transaction restores project truth separately; this sink
        // returns the already-applied runtime parameter to its pre-batch value.
        'src/modules/Arrangement/handlers/device/handleSetDeviceParameter.ts': 2,
        // Count provenance: new file entry, measured 1 — a single doc-comment
        // mention of `persistDeviceParam`, and no write. Measured with `grep -o`
        // over the four sink identifiers: persistDeviceParam 1, the other three
        // 0. `quantiseDeviceParameterValue` explains why quantisation is applied
        // at delivery instead of inside `clampDeviceParameterValue`, and half
        // that reason is which callers of the clamp persist: rounding on the
        // persistence path would silently rewrite stored project data for every
        // stepped parameter. The file is a pure model and reaches no sink.
        'src/modules/Arrangement/models/DeviceParameterLaw.ts': 1,
        // Count provenance: new file entry, measured 1 — a single doc-comment
        // mention of `updateDeviceParam`, and no write. Measured with `grep -o`
        // over the four sink identifiers: updateDeviceParam 1, the other three
        // 0. The Grinder descriptor's gate rows carry a note explaining that
        // this table, not the module's `DEFAULT_PATCH`, is what a freshly added
        // device sends to the engine — `addDevice` writes every `param.value`
        // through `updateDeviceParam`, while `syncGrinderPatchToAudio` runs only
        // on preset load and snapshot recall. Naming the sink is the point of
        // the note; the file is a pure descriptor table and reaches no sink.
        'src/modules/Arrangement/models/PluginDescriptors/GrinderDescriptor.ts': 1,
        // Count provenance: new file entry, measured 1 — a single doc-comment
        // mention of `updateDeviceParam`, and no write. Measured with `grep -o`
        // over the four sink identifiers: updateDeviceParam 1, the other three
        // 0. The Dutch Oven's `damping` row carries a note recording why it
        // ships at 0.3 rather than Dattorro's 0.0005 (#1546), and the reason the
        // descriptor is the leg that had to move is precisely that `addDevice`
        // pushes `param.value` through `updateDeviceParam` at add time. Naming
        // the sink is the point of the note; the file is a pure descriptor
        // table and reaches no sink.
        'src/modules/Arrangement/models/PluginDescriptors/NativeDspDescriptors.ts': 1,
        'src/modules/Arrangement/stores/index.ts': 2,
        // Count provenance: measured 3, all three doc-comment mentions — this
        // file holds no write at all. `clampDeviceParamWrite` resolves a device
        // type from the store and returns the value the declared range allows.
        // Its header names `updateDeviceParam` (the caller the law binds at) and
        // `persistDeviceParam` (the store-side twin it explains itself against),
        // and the device-type index cites `persistDeviceParam` again as the
        // writer that establishes the replace-don't-mutate invariant the index
        // keys on. Neither identifier is called here.
        'src/modules/Arrangement/stores/clampDeviceParamWrite.ts': 3,
        'src/modules/Arrangement/stores/persistDeviceParam.ts': 1,
        'src/modules/Arrangement/useCases/device/addDevice.ts': 2,
        'src/modules/Arrangement/useCases/device/setDeviceParameter/persistDevicePatch.ts': 1,
        'src/modules/Arrangement/useCases/device/setDeviceParameter/setDeviceParameter.ts': 2,
        'src/modules/Arrangement/useCases/index.ts': 2,
        'src/modules/Arrangement/useCases/preset/presetLoading.ts': 3,
        'src/modules/Arrangement/useCases/projectTrackToLiveStrip.ts': 2,
        'src/modules/Arrangement/useCases/setTrackGainPan/helpers.ts': 4,
        // Count provenance: was 2, measured 4 — the two unchanged mentions
        // (import and the `{ updateDeviceParam, getAllTracks }` dependency
        // literal handed to `syncToasterPadParam`) plus two new doc-comment
        // mentions, and no new write. Measured with `grep -o` over the four sink
        // identifiers: updateDeviceParam 3, persistDeviceParam 1, the other two
        // 0. The header now explains why the Toaster pad mirror sits above the
        // `isTransient` persistence guard rather than inside it: it names
        // `updateDeviceParam` as the door the mirror reaches the DSP through and
        // `persistDeviceParam` as the store-side twin it is *not*. The sink is
        // still reached exactly once, through `syncToasterPadParam`.
        'src/modules/Arrangement/useCases/setTrackGainPan/setTrackGain.ts': 4,
        'src/modules/Arrangement/useCases/setTrackGainPan/setTrackPan.ts': 2,
        'src/modules/AudioEngine/models/AudioEngineState.ts': 2,
        'src/modules/AudioEngine/repositories/createWebAudioEngine.ts': 2,
        // Count provenance: new file entry, measured 2 — both doc-comment
        // mentions of `updateDeviceParam`, and no write. Measured with `grep -o`
        // over the four sink identifiers: updateDeviceParam 2, the other three
        // 0. Both name the live delivery this offline path is being made to
        // match: `applyAutomation` filters continuously and calls
        // `updateDeviceParam(quantise(smoothed))`, and the two comments say why
        // the quantiser is passed as `quantiseEmit` (emitted value only) rather
        // than folded into `clampStep` (the recurrence's feedback). This is a
        // repository scheduling AudioParams and worklet segments; it holds no
        // device write of its own.
        'src/modules/AudioEngine/repositories/offlineScheduler/automationScheduling.ts': 2,
        // Count provenance: new file entry, measured 1 — one doc-comment mention
        // of `updateDeviceParam` on the `quantiseEmit` option, naming the live
        // call the option replicates. The other three sink identifiers score 0.
        // The file compiles automation points into timed events and writes
        // nothing.
        'src/modules/AudioEngine/repositories/offlineScheduler/compileAutomationEvents.ts': 1,
        // Count provenance: measured 3, was 2. The declared-range law now binds
        // at this use case — the single door every device-param write reaches
        // the DSP through — so the file gained a doc-comment mention of the
        // store-side twin `persistDeviceParam`. The executable surface is
        // unchanged and still singular: the function declaration plus its one
        // `audioEngine.updateDeviceParam` call.
        'src/modules/AudioEngine/useCases/deviceControls/updateDeviceParam.ts': 3,
        'src/modules/AudioEngine/useCases/deviceControls/updateDevicePatch.ts': 2,
        'src/modules/AudioEngine/useCases/index.ts': 4,
        // Count provenance: pre-#597 this file scored 2 — a doc-comment mention
        // plus the single canonical updateDeviceParam call site. #597
        // (canonicalize device targets) rewrote the doc comment, and #609
        // (preserve later-lane precedence) kept the same single call site
        // (its specs pin exactly one write per change), so the live write path
        // is unchanged and singular — only the lexical count dropped.
        'src/modules/Automation/useCases/modulation/applyModulationToEngine.ts': 1,
        'src/modules/Automation/useCases/modulation/modulationDependencies.ts': 1,
        'src/modules/Automation/useCases/modulation/revertMappingsToBase.ts': 1,
        'src/modules/Bacteria/models/BacteriaPatch.ts': 1,
        'src/modules/Bacteria/useCases/bacteriaParamBridge/bacteriaParamBridgeDependencies.ts': 4,
        'src/modules/Bacteria/useCases/bacteriaParamBridge/helpers.ts': 4,
        'src/modules/Bacteria/useCases/bacteriaParamBridge/loadBacteriaPatchWithAudio.ts': 2,
        'src/modules/Bacteria/useCases/bacteriaParamBridge/setBacteriaBandParamWithAudio.ts': 2,
        'src/modules/Bacteria/useCases/bacteriaParamBridge/setBacteriaParamWithAudio.ts': 2,
        // Count provenance: new file entry, measured 3 — all `updateDeviceParam`
        // (persistDeviceParam 0, persistDevicePatch 0, updateDevicePatch 0): the
        // import, one doc-comment mention naming the route to the worklet, and a
        // single call on the transient branch. The **commit** branch reaches no
        // sink here at all; it dispatches `setDeviceParameter` through
        // `executeAppAction`, so project truth and the engine are both written
        // behind the action. Crumbs knob values were previously persisted nowhere
        // and its only engine write went to the *native* instance, which is not
        // the one that renders.
        'src/modules/Crumbs/useCases/setCrumbsParamWithAudio.ts': 3,
        // Count provenance: new file entry, measured 1 — a single doc-comment
        // mention of `updateDeviceParam` naming the route the three voice-stack
        // ids now take, and no write of its own. The file delegates every field
        // to `setCrumbsParamWithAudio`, which is where the sink is counted; it
        // used to call `setCrumbsParamThrottled` only, which is the native
        // instance and not a sink in this family at all — the reason a census
        // that counts sinks could not see the defect.
        'src/modules/Crumbs/useCases/voiceStacking.ts': 1,
        'src/modules/Crust/useCases/crustParamBridge/createFlushHandlers.ts': 4,
        'src/modules/Crust/useCases/crustParamBridge/helpers.ts': 8,
        // Count provenance: new file entry, measured 2 — the `updateDeviceParam`
        // import and its single call site. The panel's true-peak reset has to
        // reach the engine as well as the store: Crust's engine holds the
        // session true-peak maximum, so a store-only reset is undone by the
        // next meter poll.
        'src/modules/Crust/useCases/resetCrustTruePeakIndicator.ts': 2,
        // Count provenance: measured 5, was 4. This file is a type declaration
        // plus the holder — it performs no write, and all five matches are the
        // declared DI signatures and prose about them. The new one is a
        // doc-comment mention of `updateDeviceParam` on the added
        // `clampDeviceParameterValue` port, explaining why the range has to be
        // resolved before Fermenter's camelCase key is mapped to its snake_case
        // DSP key: `updateDeviceParam`'s own clamp looks the parameter up on
        // the descriptor and the DSP key matches no entry there. Measured with
        // `grep -o` over the four sink identifiers: persistDeviceParam 1,
        // persistDevicePatch 1, updateDevicePatch 1, updateDeviceParam 2.
        'src/modules/Fermenter/useCases/fermenterDependencies.ts': 5,
        // Runtime automation maps and clamps Fermenter's descriptor key before
        // one engine-only write. The two matches are the destructured
        // updateDeviceParam dependency and its single guarded call; this path
        // intentionally contains no persistence identifier.
        'src/modules/Fermenter/useCases/applyFermenterRuntimeParam.ts': 2,
        'src/modules/Fermenter/useCases/fermenterParamBridge/helpers.ts': 2,
        'src/modules/Fermenter/useCases/fermenterParamBridge/loadFermenterPatchWithAudio.ts': 6,
        'src/modules/Fermenter/useCases/fermenterParamBridge/setFermenterParamWithAudio.ts': 4,
        'src/modules/Fermenter/useCases/presetMorph/applyMorphedPatch.ts': 6,
        // Count provenance: measured 5, was 4. #1437 added `previewParam`, the
        // transient half of a knob gesture — it drives the engine and writes
        // nothing to project truth, so it contributes one `updateDeviceParam`
        // and no persistence identifier. The committing paths are unchanged:
        // `flushParam` and `pushParamImmediately` each still pair one
        // `updateDeviceParam` with one `persistDeviceParam`. Measured with
        // `grep -o` over the four sink identifiers: updateDeviceParam 3,
        // persistDeviceParam 2, persistDevicePatch 0, updateDevicePatch 0.
        'src/modules/Gluten/useCases/glutenParamBridge/createFlushHandlers.ts': 5,
        'src/modules/Gluten/useCases/glutenParamBridge/helpers.ts': 8,
        // Count provenance: new entry, measured 2, and **both matches are
        // doc-comment prose — this file performs no write**. #1437 rewrote the
        // header to explain why a drag is one edit rather than ninety: it names
        // `persistDeviceParam` as what the transient half no longer calls, and
        // `updateDeviceParam` as what `setDeviceParameter` calls on its behalf.
        // The commit now goes through `executeAppAction`, so the sink
        // identifiers appear here only as references to the path that was left
        // behind and the one that replaced it. Measured with `grep -o` over the
        // four sink identifiers: persistDeviceParam 1, updateDeviceParam 1,
        // persistDevicePatch 0, updateDevicePatch 0.
        'src/modules/Gluten/useCases/glutenParamBridge/setGlutenParamWithAudio.ts': 2,
        // Count provenance: new file entry, measured 1, and **the single match is
        // doc-comment prose — this file performs no `updateDeviceParam` write**.
        // The comment records why the commit branch does *not* also push at the
        // Grand Boule engine handle: `setDeviceParameter` already reaches the same
        // worklet controls through `updateDeviceParam`, so a second direct push
        // would be a redundant message per gesture and a second place that could
        // disagree about the clamped value. The transient branch writes the engine
        // through `GrandBouleEngineHandle.setParam`, which is the `direct-built-in`
        // family, not this one.
        'src/modules/GrandBoule/useCases/grandBouleParamBridge/helpers.ts': 1,
        'src/modules/Grinder/useCases/grinderParamBridge/grinderParamBridgeDependencies.ts': 6,
        'src/modules/Grinder/useCases/grinderParamBridge/helpers.ts': 4,
        'src/modules/Grinder/useCases/grinderParamBridge/loadGrinderPatchWithAudio.ts': 3,
        'src/modules/Grinder/useCases/grinderParamBridge/moveGrinderPedalInChainWithAudio.ts': 2,
        'src/modules/Grinder/useCases/grinderParamBridge/recallGrinderSnapshotWithAudio.ts': 3,
        'src/modules/Grinder/useCases/grinderParamBridge/setGrinderMicParamWithAudio.ts': 2,
        'src/modules/Grinder/useCases/grinderParamBridge/setGrinderParamWithAudio.ts': 2,
        'src/modules/Grinder/useCases/grinderParamBridge/setGrinderPedalParamWithAudio.ts': 2,
        // Count provenance: measured 1, a single doc-comment mention. This model
        // is the codec for Levain's `Device.deviceState` chunk and performs no
        // write of any kind — the mention is `persistDevicePatch` named as the
        // reason the chunk exists at all: it keeps only finite numbers, so the
        // instrument id and articulation it drops are the two fields this codec
        // carries instead. The write itself is `commitLevainDeviceState`, which
        // goes through `executeAppAction`.
        'src/modules/Levain/models/LevainDeviceState.ts': 1,
        'src/modules/Levain/useCases/levainParamBridge/helpers.ts': 6,
        'src/modules/Levain/useCases/levainParamBridge/levainBridge.ts': 1,
        'src/modules/Levain/useCases/levainParamBridge/levainBridgeDependencies.ts': 2,
        'src/modules/Project/useCases/demoProjects/nebulaDrift/createNebulaDriftDemo.ts': 2,
        'src/modules/Proof/useCases/proofParamBridge/loadProofPatchWithAudio.ts': 2,
        'src/modules/Proof/useCases/proofParamBridge/setProofParam.ts': 2,
        'src/modules/Proof/useCases/proofParamBridge/setProofParamWithPatch.ts': 3,
        'src/modules/Proof/useCases/proofParamBridge/setProofTarget.ts': 2,
        // Count provenance: pre-#746 this file scored 2 (import + the single
        // canonical updateDeviceParam call). #746/#760 (slew snap + a-rate
        // gain/pan scheduling) restructured the tick path and added one
        // doc-comment mention; the reviewed live write path stays singular.
        'src/modules/Transport/useCases/scheduling/applyAutomation/applyAutomation.ts': 3,
        // Count provenance: #807 added the lane-stop base restore, split out of
        // the drive path above. The 2 are the `updateDeviceParam` import plus its
        // single call site.
        //
        // Read the family name carefully: 'persistence-runtime' is a *combined*
        // family. Its pattern counts both the CRDT persistence identifiers
        // (`persistDeviceParam`, `persistDevicePatch`) and the runtime engine ones
        // (`updateDeviceParam`, `updateDevicePatch`). A hit in this family
        // therefore does NOT by itself mean a write reached the document — check
        // which identifier matched before reading it as one.
        //
        // These two are engine-only: `updateDeviceParam` bottoms out at
        // `TrackNode.updateParam` (worklet MessagePort) and never reaches the CRDT
        // document. Restoring a lane's manual value on the tick it stops driving
        // mutates no project truth — the base is *read* from the device's own
        // `parameterValues`, which already holds it, so routing this through
        // `executeAppAction` would manufacture an undo/history entry and peer-sync
        // churn for a value that did not change. Same class and same
        // `resolveEligibleDeviceWriteTarget` ownership guard as the sibling drive
        // path above and as the modulation twin `revertMappingsToBase`, both of
        // which are censused here and guard-listed below.
        'src/modules/Transport/useCases/scheduling/applyAutomation/restoreAutomationBaseValue.ts': 2,
        // Count provenance: new file entry, measured 4 with `grep -o` over the
        // four sink identifiers — updateDeviceParam 4, the other three 0. The 4
        // are the import, one call site, and two doc-comment mentions (one
        // naming the route the transient preview takes, one recording that the
        // committing branch reaches the same identifier behind
        // `setDeviceParameter`).
        //
        // Engine-only, and deliberately so. The tuner's concert-A reference knob
        // used to write `tunerStore` and stop, so the panel readout moved and
        // `TuningSystem::a4_hz` did not. It is now split the way `setTrackPan`
        // is: a pointer-move previews through this engine-only sink and persists
        // nothing, and release dispatches one `setDeviceParameter` action. Read
        // the family name carefully — this row is the *runtime* half of the
        // combined family, not a CRDT write. Committing every move instead would
        // put an Automerge transaction and an undo entry on each of the ~90
        // steps the 400..490 Hz sweep crosses.
        //
        // Guard-listed below: the transient branch addresses the engine directly
        // and carries the same `resolveEligibleDeviceWriteTarget` ownership gate
        // as every other device bridge.
        'src/modules/Tuner/useCases/setA4Reference.ts': 4,
    },
    'strip-add': {
        'src/modules/Arrangement/useCases/device/addDevice.ts': 2,
        'src/modules/Arrangement/useCases/device/addExternalDevice.ts': 2,
        'src/modules/Arrangement/useCases/preset/presetLoading.ts': 2,
        'src/modules/Arrangement/useCases/projectTrackToLiveStrip.ts': 2,
        'src/modules/AudioEngine/models/AudioEngineState.ts': 1,
        'src/modules/AudioEngine/repositories/createWebAudioEngine.ts': 1,
        'src/modules/AudioEngine/useCases/deviceControls/addDeviceToStrip.ts': 2,
        'src/modules/AudioEngine/useCases/index.ts': 2,
        'src/modules/GrandBoule/useCases/createGrandBouleTrack.ts': 3,
        'src/modules/Project/useCases/demoProjects/nebulaDrift/createNebulaDriftDemo.ts': 3,
        'src/modules/Toaster/useCases/createDrumTrackStack.ts': 2,
    },
    'direct-built-in': {
        // Count provenance: new file entry, measured 2 with `grep -o` — both
        // executable, no comment mentions. The Grand Boule "Sus Thresh" and
        // "CC Smooth" knobs were store-only writes; their values are the lower
        // edge of the DSP half-pedal damper curve and the time constant
        // smoothing CC64 into it, so both now reach the engine. Every writer of
        // the two (the knobs, the reset chip, and the panel's engine-ready
        // effect) funnels through this one file, so `setSustainThreshold.ts`,
        // `setCcSmoothingMs.ts` and `resetMidiCalibration.ts` score 0 and stay
        // out of this table. No persistence sink here — MIDI calibration is not
        // written to `Device.parameterValues`. That used to be true of *all* of
        // Grand Boule's state; the three Mix knobs now persist through
        // `grandBouleParamBridge/helpers.ts`, and calibration remains the
        // exception rather than the rule.
        // Count provenance: new file entry, measured 1 — a single doc-comment
        // mention of `CrumbsNode.setParam`, naming the worklet the commit now
        // reaches through `setDeviceParameter`. No executable `setParam` here:
        // the Crumbs bridge calls `setCrumbsParam`, which does not match this
        // family's pattern.
        'src/modules/Crumbs/useCases/setCrumbsParamWithAudio.ts': 1,
        'src/modules/GrandBoule/useCases/calibrateGrandBouleMidi/syncMidiCalibrationToEngine.ts': 2,
        // Count provenance: measured 3 — the transient preview and rejected-
        // commit reconciliation each call `engine.setParam`, plus one doc-comment
        // mention recording why a successful commit does not also push at the
        // handle (`setDeviceParameter` reaches the same worklet controls through
        // `updateDeviceParam`). This is the write the three Mix setters used to
        // each hold one of: `setGrandBouleMasterGain.ts`,
        // `setGrandBouleSoundboardSend.ts` and `setGrandBouleSympatheticSend.ts`
        // each scored 1 and now score 0, so they leave this table. They clamp to
        // their declared range and delegate; nothing else changed about them.
        'src/modules/GrandBoule/useCases/grandBouleParamBridge/helpers.ts': 3,
        'src/modules/GrandBoule/useCases/loadGrandBoulePreset.ts': 4,
        // Count provenance: measured 3 with `grep -o`, was 2. The two
        // executable hits are unchanged — the `setParam` handle on the returned
        // engine and the `controls.setParam` call it forwards to. The new one
        // is a comment mention: the node selector now scopes on
        // `candidateNode.deviceId === input.deviceId`, and the comment names
        // the handle members (`setParam` among them) that all drove the *first*
        // GrandBoule on a track hosting two before the scope was added.
        'src/modules/GrandBoule/useCases/resolveGrandBouleEngine.ts': 3,
        'src/modules/GrandBoule/useCases/setGrandBouleAttackBite.ts': 1,
        'src/modules/GrandBoule/useCases/setGrandBouleMorphPosition.ts': 7,
        'src/modules/GrandBoule/useCases/setGrandBoulePerNoteParam/resetGrandBoulePerNoteParams.ts': 1,
        'src/modules/GrandBoule/useCases/setGrandBoulePerNoteParam/setGrandBoulePerNoteParam.ts': 1,
        'src/modules/GrandBoule/useCases/setGrandBouleStretchAmount.ts': 1,
        'src/modules/GrandBoule/useCases/setGrandBouleVelocityCurve.ts': 1,
        // Count provenance: measured 10, was 11. Registration no longer routes
        // patch initialization through the rAF write batcher: it applies the
        // complete runtime patch synchronously before sample loading and performs
        // no project persistence. The retired match was that registration-time
        // `queueParam` path; explicit user edits remain the only persisted sinks.
        'src/modules/Levain/useCases/levainParamBridge/helpers.ts': 10,
        // Count provenance: measured 1, was 0 (new file). The single match is a
        // doc-comment mention of `setParam` — this file holds no device write at
        // all. It reads the persisted chain order off the project and posts one
        // `reorder` message to the offline worklet port; the comment names
        // `setParam` because it has to explain why the offline param replay does
        // *not* deliver order (the worklet's `set_param` matches no
        // `chain_order_` prefix and drops all five values). Deleting the word
        // would drop this row to 0, so a future real sink added here still trips
        // the closure.
        'src/modules/Proof/useCases/prepareOfflineProof.ts': 1,
        'src/modules/Proof/useCases/proofParamBridge/helpers.ts': 1,
        'src/modules/Proof/useCases/proofParamBridge/setProofParam.ts': 1,
        'src/modules/Proof/useCases/proofParamBridge/setProofParamWithPatch.ts': 2,
        'src/modules/Proof/useCases/proofParamBridge/syncDynBands.ts': 9,
        'src/modules/Proof/useCases/proofParamBridge/syncEqBands.ts': 6,
        'src/modules/Proof/useCases/proofParamBridge/syncExciter.ts': 4,
        'src/modules/Proof/useCases/proofParamBridge/syncFullPatch.ts': 13,
        'src/modules/Proof/useCases/proofParamBridge/syncImager.ts': 3,
        // Count provenance: measured 0 with `grep -o`, was 2 — row removed
        // rather than zeroed, since this census only records files that match.
        // Both hits were the `setPadParam`/`setParam` fields of a hand-written
        // `GetToasterControlsOutput`, never calls. The file now returns
        // `ReturnType<typeof findReadyToasterControlsOnStrip>` and delegates
        // the strip-level selection to that helper, so the structural
        // re-declaration — and with it the drift between three call sites
        // holding two return shapes — is gone. The owner lookup in front of it
        // (`findDeviceRef`, no eligibility gate) is still deliberately its own.
        // No device write left this file before or after.
        // 'src/modules/Toaster/useCases/getToasterControls.ts': removed (0),
        // Count provenance: the kit projection was three hand-maintained copies —
        // 23 sinks in the preset loader and 22 in the live subscriber, each
        // enumerating the same pad fields. They now delegate to one shared
        // projection. The preset loader has exactly two executable sinks: one
        // setParam call and one setPadParam call. Its former third sink was a
        // separate engineParams loop; engine-specific values now travel through
        // the shared ordered projection so live reload and offline render cannot
        // omit them. A row moving *down* here is a copy retiring; measured with
        // the census pattern, not estimated.
        'src/modules/Toaster/useCases/loadToasterKit.ts': 2,
        'src/modules/Toaster/useCases/projectToasterKitToEngineMessages.ts': 4,
        'src/modules/Toaster/useCases/setPadParamImmediate.ts': 1,
        // Count provenance: measured 3 with `grep -o` (setPadParam 2, setParam
        // 1), was 1. All three are doc-comment mentions — this file holds no
        // write and no longer re-declares a controls type either; it derives
        // the real one from the strip. It is the readiness gate for the three
        // pad-param paths, and its comment has to name both identifiers to
        // record why readiness is *not* shared with the kit path: a loading
        // device's placeholder `setPadParam` is an empty function that drops
        // the write, while its `setParam` buffers into `pendingParams` and is
        // replayed on load. Deleting the explanation would drop this row toward
        // 0, so a real sink added here still trips the closure.
        'src/modules/Toaster/useCases/toasterParamBridge/findReadyToasterControlsOnStrip.ts': 3,
        // findToasterNodeOnStrip.ts is absent on purpose: measured 0. It is the
        // id-scoping half, shared by every caller, and names neither sink.
        'src/modules/Toaster/useCases/toasterParamBridge/setPadEngineImmediate.ts': 1,
        // Count provenance: measured 2 with `grep -o`, was 1. The single
        // executable sink is unchanged — one `setParam` call on the flush path.
        // The added hit is a comment mention explaining why this flush scopes
        // by `deviceId` but deliberately does *not* gate on `ready`: the
        // placeholder controller for a loading Toaster buffers `setParam` into
        // `pendingParams` and the loader replays it, so skipping a not-ready
        // node here would discard kit edits made during load instead of
        // deferring them.
        'src/modules/Toaster/useCases/toasterParamBridge/setToasterKitParam.ts': 2,
        'src/modules/Toaster/useCases/toasterParamBridge/setToasterPadParam.ts': 1,
        'src/modules/Toaster/useCases/toasterSubscriber.ts': 2,
    },
    'load-compile-hydration': {
        'src/app/bootstrap.ts': 1,
        // Count provenance: the AC-011 preflight calls the pure topology
        // compiler for the live and isolated project projections. These three
        // references are one import and two calls; the file holds no device or
        // AudioEngine write.
        'src/app/captureCommandBatchPreflightState.ts': 3,
        'src/app/registerDependencies.ts': 1,
        // Count provenance: new file entry, measured 1 — a doc-comment
        // cross-reference to `compileAutomationEvents`, naming the second of the
        // two callers that feed `clampDeviceParameterValue`'s result back in as
        // the state of a one-pole IIR slew. That is why
        // `quantiseDeviceParameterValue` is a separate function: rounding inside
        // the clamp would dead-zone both recurrences. The model holds no write.
        'src/modules/Arrangement/models/DeviceParameterLaw.ts': 1,
        // Count provenance: the versioned-command preview compiler and its two
        // chat-planning call sites create immutable Command envelopes only; they
        // neither hydrate a device nor write engine state.
        'src/modules/AiRuntime/useCases/compilePendingActionCommandEnvelopes.ts': 1,
        // Count provenance: the batch compiler, public barrel, and Workspace
        // caller compile immutable Command metadata only. The six compiler-file
        // hits are three preview-compiler references, two batch-envelope compiler
        // references, and the exported function declaration; none hydrates or
        // writes a device.
        'src/modules/AiRuntime/useCases/compilePlannedActionCommandBatch.ts': 6,
        // Count provenance: AC-013 compiles immutable approval and execution
        // metadata. These references are imports, declarations, calls, and
        // ReturnType projections around Command envelope compilers; none loads,
        // hydrates, or writes a device or AudioEngine node.
        'src/modules/AiRuntime/useCases/compileAgentActionExecution.ts': 10,
        'src/modules/AiRuntime/useCases/compileAgentRiskApproval.ts': 1,
        'src/modules/AiRuntime/useCases/describeAgentRiskApproval.ts': 3,
        'src/modules/AiRuntime/useCases/validateAgentRiskApproval.ts': 7,
        'src/modules/AiRuntime/useCases/index.ts': 2,
        'src/modules/AiRuntime/useCases/sendChatMessage.ts': 3,
        // Count provenance: the versioned-command argument compiler and its two
        // callers only project immutable envelope metadata. These are bare
        // `compileCommandArgumentMetadata` references, not device compilation,
        // hydration, or engine writes.
        'src/modules/Command/useCases/commandArgumentMetadata.ts': 1,
        // Count provenance: partial acceptance calls the canonical batch compiler;
        // all four compile* references are import, declaration, and call metadata.
        // It neither hydrates devices nor writes project or engine state.
        'src/modules/Command/useCases/compilePartialCommandBatchAcceptance.ts': 4,
        'src/modules/Command/useCases/compileVersionedCommandBatchEnvelope.ts': 1,
        'src/modules/Command/useCases/createExecutionCommandEnvelope.ts': 2,
        'src/modules/Command/useCases/index.ts': 4,
        'src/modules/Command/useCases/parseVersionedCommandEnvelope.ts': 2,
        'src/modules/Command/useCases/resolveVersionedCommandBatchBindings.ts': 2,
        // Count provenance: doc-comment cross-reference to `compileAutomationEvents`
        // in the editor-readout evaluator's AU-1 delegation note (#747) — the
        // transformer computes curve values only, holds no device writes.
        'src/modules/Arrangement/transformers/automationTransformers.ts': 1,
        'src/modules/Arrangement/useCases/device/addDevice.ts': 2,
        'src/modules/Arrangement/useCases/preset/presetLoading.ts': 2,
        // Count provenance: doc-comment cross-reference to `compileAutomationEvents`
        // in the live evaluator's AU-1 delegation note (#747) — not a sink.
        'src/modules/Automation/services/automationPointAlgorithms.ts': 1,
        'src/modules/AudioEngine/engine/LevainNode.ts': 1,
        'src/modules/AudioEngine/engine/wasmDeviceRegistry.ts': 1,
        'src/modules/AudioEngine/repositories/faustDeviceFactory.ts': 3,
        // Count provenance: the offline automation compilers
        // (compileAutomationEvents/compileAutomationSegments and their callers)
        // are pure point-list → scheduling-event transforms introduced with the
        // offline automation region/curve work; they hold no device writes.
        // Counts are bare `compile[A-Z]…` identifier references (import + call
        // sites), censused so any future real sink added to these files still
        // trips the closure.
        // Count provenance: 4 = the compileAutomationSegments import line
        // (matched twice: named import + module path), its single call site,
        // and one doc-comment mention added by the AU-3 affine-scale fix
        // (#765). The executable call surface is unchanged and singular.
        'src/modules/AudioEngine/repositories/offlineScheduler/automationScheduling.ts': 4,
        'src/modules/AudioEngine/repositories/offlineScheduler/compileAutomationEvents.ts': 1,
        'src/modules/AudioEngine/repositories/offlineScheduler/compileAutomationSegments.ts': 4,
        'src/modules/AudioEngine/repositories/offlineScheduler/scheduleAutomationOnParam.ts': 3,
        'src/modules/AudioEngine/useCases/buildDeviceChain.ts': 2,
        // Count provenance: the AC-011 topology compiler only validates and
        // projects immutable node IDs/edge counts. The implementation hit is
        // its declaration; the barrel hits are its export name and module path.
        'src/modules/AudioEngine/useCases/compileAudioGraphTopology.ts': 1,
        'src/modules/AudioEngine/useCases/deviceResolvers/createFaustDeviceNode.ts': 2,
        'src/modules/AudioEngine/useCases/index.ts': 2,
        'src/modules/Bacteria/models/BacteriaPatch.ts': 3,
        'src/modules/Bacteria/presentations/views/BacteriaPanel.tsx': 3,
        'src/modules/Bacteria/useCases/bacteriaParamBridge/loadBacteriaPatchWithAudio.ts': 2,
        'src/modules/Crumbs/useCases/crumbsParamBridge/setCrumbsParamImmediate.ts': 1,
        // Count provenance: new file entry, measured 3, all `setCrumbsParamImmediate`
        // and all one write: the imported identifier, the module path in that same
        // import (the family pattern matches inside the string too), and the single
        // call. It runs on the commit branch only, pushing the settled value at the
        // *native* Crumbs instance — the sample-acquisition and disk-streaming
        // engine, which is not the worklet that renders. The commit reaches the
        // worklet, and project truth, through `setDeviceParameter`.
        'src/modules/Crumbs/useCases/setCrumbsParamWithAudio.ts': 3,
        'src/modules/Crust/useCases/crustParamBridge/loadCrustPatchWithAudio.ts': 1,
        'src/modules/Crust/presentations/views/CrustPanel.tsx': 3,
        'src/modules/Fermenter/useCases/fermenterParamBridge/loadFermenterPatchWithAudio.ts': 1,
        // Count provenance: applyMorphedPatch's flushMorph references the sibling
        // loadFermenterPatchWithAudio path (its engine write now goes through the
        // same mapFermenterPatchToDspPatch DSP-id mapping — #548). The write is the
        // same class as the sibling's rAF-batched full-patch engine write; its
        // updateDevicePatch/persistDevicePatch sinks stay censused under
        // 'persistence-runtime' at count 6.
        'src/modules/Fermenter/useCases/presetMorph/applyMorphedPatch.ts': 1,
        'src/modules/Fermenter/presentations/views/FermenterPanel.tsx': 7,
        'src/modules/Gluten/useCases/glutenParamBridge/loadGlutenPatchWithAudio.ts': 2,
        'src/modules/Gluten/useCases/index.ts': 1,
        'src/modules/Gluten/presentations/views/GlutenPanel.tsx': 3,
        'src/modules/GrandBoule/presentations/components/PianoModel3D.tsx': 4,
        'src/modules/Grinder/useCases/grinderParamBridge/loadGrinderPatchWithAudio.ts': 2,
        'src/modules/Grinder/useCases/grinderParamBridge/syncGrinderPatchToAudio.ts': 1,
        'src/modules/Grinder/useCases/index.ts': 1,
        'src/modules/Grinder/presentations/views/GrinderPanel.tsx': 3,
        'src/modules/Levain/useCases/levainParamBridge/helpers.ts': 3,
        'src/modules/Levain/useCases/levainParamBridge/loadSamplesForInstrument.ts': 2,
        'src/modules/Levain/useCases/loadPreset.ts': 4,
        'src/modules/Levain/presentations/views/LevainPanel.tsx': 2,
        'src/modules/PluginHost/useCases/faustEngine/compileAllFaustModules.ts': 4,
        'src/modules/PluginHost/useCases/faustEngine/compileFaustDSP.ts': 1,
        'src/modules/PluginHost/useCases/faustEngine/registerFaustPluginLoader.ts': 3,
        'src/modules/PluginHost/useCases/index.ts': 2,
        'src/modules/Proof/useCases/proofParamBridge/loadProofPatchWithAudio.ts': 1,
        'src/modules/Proof/presentations/views/ProofPanel.tsx': 3,
        // Count provenance: new file entry, measured 1 with `grep -oE` over the
        // family pattern — a single doc-comment mention of `setPadParamImmediate`,
        // naming one of the two pad-param entry points that call this transform.
        // The other sink families score 0. `toPadStoreUpdate` is a pure function
        // from (key, numeric value) to the `Partial<PadState>` its callers write:
        // it holds no store write, no engine write, and no import beyond the
        // `PadState` type.
        'src/modules/Toaster/models/PadStoreUpdate.ts': 1,
        'src/modules/Toaster/useCases/loadToasterKit.ts': 1,
        // Count provenance: one hit, `audioDevice.loaded` in the doc comment
        // explaining why an offline path is needed — that event never fires
        // offline, so the live subscriber never runs. No load or hydration sink
        // in the file. Kept rather than reworded: the sentence is the reason.
        'src/modules/Toaster/useCases/prepareOfflineToaster.ts': 1,
        'src/modules/Toaster/useCases/setPadParamImmediate.ts': 1,
        'src/modules/Toaster/useCases/toasterParamBridge/setPadEngineImmediate.ts': 1,
        'src/modules/Toaster/useCases/toasterSubscriber.ts': 2,
        'src/modules/Toaster/useCases/trigger16Level.ts': 5,
        'src/modules/Toaster/presentations/views/ToasterPanel.tsx': 2,
        'src/modules/WorkspaceShell/presentations/hooks/usePromptExecution.ts': 2,
        // Count provenance: doc-comment cross-reference to the sibling offline
        // compiler `compileAutomationEvents` from the AU-1 shared curve kernel
        // (#747) — a pure curve-math utility, not a device-write sink.
        'src/utils/automationCurve.ts': 1,
    },
};

const DEVICE_DATA_COUNTS = {
    executable: {
        'src/modules/Arrangement/handlers/preset/handleSavePreset.ts': 2,
        'src/modules/Arrangement/services/computeTrackHash.ts': 1,
        'src/modules/Arrangement/services/createTrackFreezeSourceSignature.ts': 2,
        'src/modules/Arrangement/stores/persistDeviceParam.ts': 1,
        'src/modules/Arrangement/stores/resolveEligibleDeviceWriteTarget.ts': 1,
        'src/modules/Arrangement/stores/trackStore.ts': 2,
        'src/modules/Arrangement/useCases/device/addDevice.ts': 2,
        'src/modules/Arrangement/useCases/device/addExternalDevice.ts': 2,
        'src/modules/Arrangement/useCases/device/addMidiFx.ts': 1,
        'src/modules/Arrangement/useCases/device/bypassDevice.ts': 1,
        'src/modules/Arrangement/useCases/device/removeDevice.ts': 1,
        // Count provenance: 0 -> 1, measured. New sink from `c7d271e15`
        // ("make device lifecycle executable"), which added `restoreDevice` as
        // the compensating action for `removeDevice`'s undo and did not update
        // this census. The single hit is `parameterValues: { ...snapshot }` — it
        // rebuilds a Device from a DeviceSnapshot and writes through
        // `updateTrack` inside a handler, i.e. inside an executeAppAction
        // transaction, the same shape as `addDevice` and `removeDevice` above.
        // Not a param-write path, so correctly absent from GUARDED_EXECUTABLE_PATHS
        // as its siblings are; not in RUNTIME_ACTION_TYPES, so not AI-reachable.
        //
        // The file's actual store write is `return { ...current, devices };` —
        // shorthand, no colon — which this census's pattern cannot see, so the
        // measured 1 undercounts the writes in this file by one. Recorded as the
        // measurement it is rather than rounded up to what the file does.
        //
        // Which means this census did not really catch `restoreDevice`: it caught
        // the unrelated `parameterValues:` on line 37. A file that writes devices
        // only in shorthand scores 0 and is never asked for. One already exists —
        // `useCases/device/reorderDevices.ts` writes `return { ...time, devices };`
        // and appears nowhere in this census, unclassified and fully live. Widening
        // the pattern would surface that file and about nine more that are
        // undercounted the same way, each needing a human verdict, so it is not
        // being done in a commit whose job is getting main green. Written down here
        // rather than left to be rediscovered.
        'src/modules/Arrangement/useCases/device/restoreDevice.ts': 1,
        'src/modules/Arrangement/useCases/device/setDeviceParameter/persistDevicePatch.ts': 1,
        // Count provenance: measured 1 after presence-aware deletion introduced
        // a local `parameterValues` copy and returned it with property shorthand.
        // The remaining `devices:` hit is the same guarded CRDT-backed write;
        // shorthand is outside this census pattern, as documented above.
        'src/modules/Arrangement/useCases/device/setDeviceParameter/setDeviceParameter.ts': 1,
        // Count provenance: PH-3 (#730) — setExternalPluginState maps track
        // devices to store the captured native-plugin state chunk; the single
        // `devices:` is the reviewed CRDT-backed write through executeAppAction.
        'src/modules/Arrangement/useCases/device/setExternalPluginState.ts': 1,
        // Count provenance: 0 -> 1, measured. New sink. `setDeviceState` maps
        // track devices to store a built-in device's own versioned state chunk —
        // the non-numeric half of device state that `parameterValues` cannot
        // hold. The single `devices:` is the reviewed CRDT-backed write through
        // executeAppAction, the same shape as setExternalPluginState above.
        'src/modules/Arrangement/useCases/device/setDeviceState.ts': 1,
        'src/modules/Arrangement/useCases/device/updateMidiFxParam.ts': 1,
        'src/modules/Arrangement/useCases/duplicateTrack.ts': 1,
        'src/modules/Arrangement/useCases/freezeBounce/bounceTrack.ts': 2,
        'src/modules/Arrangement/useCases/freezeBounce/flattenTrack.ts': 1,
        // Count provenance: 0 -> 1. Freeze now sizes its tail from the device
        // tail declarations instead of a substring test on the device type, so
        // it passes `devices: track.devices` to `getDeviceChainTailSeconds` — a
        // pure calculator that returns a number of seconds. This does not undo
        // the retirement noted below: freeze still does not build its own
        // device chain from `track.devices`, it only measures how long that
        // chain rings. Read, not write; no live device is touched.
        'src/modules/Arrangement/useCases/freezeBounce/freezeTrack.ts': 1,
        // MD-4 (#716) retired the two sinks this file used to carry: the freeze/
        // bounce renderer no longer reads `track.devices` to build its own device
        // chain — it hands the render subgraph to the AudioEngine offline graph,
        // which owns device instantiation.
        'src/modules/Arrangement/useCases/loadTrackTemplate.ts': 1,
        'src/modules/Arrangement/useCases/preset/presetLoading.ts': 3,
        'src/modules/Arrangement/useCases/preset/presetStorage/saveCurrentAsPreset.ts': 3,
        'src/modules/Arrangement/useCases/preset/presetStorage/saveUserPreset.ts': 2,
        'src/modules/Arrangement/useCases/saveTrackAsTemplate.ts': 1,
        'src/modules/Project/stores/arrangementStore.ts': 3,
        'src/modules/Project/useCases/demoProjects/demoUtils/applyPreset.ts': 4,
        'src/modules/Project/useCases/demoProjects/nebulaDrift/createNebulaDriftDemo.ts': 8,
        'src/modules/Project/useCases/projectPersistence/fileIO/hydrateArrangementTracks.ts': 1,
        'src/modules/Project/useCases/projectPersistence/helpers/migrateLegacyVcaGroups.ts': 1,
        'src/modules/Project/useCases/projectTemplates/templateHelpers/addDeviceChain.ts': 1,
        'src/modules/Project/useCases/projectTemplates/templateHelpers/attachSidechainCompressor.ts': 1,
        'src/modules/Project/useCases/projectTemplates/templateHelpers/buildDevice.ts': 1,
        'src/modules/Project/useCases/projectTemplates/templateHelpers/createBus.ts': 1,
    },
    static: {
        'src/modules/Arrangement/models/SoundPreset.ts': 2,
        'src/modules/Arrangement/models/Track.ts': 7,
        'src/modules/Arrangement/models/TrackTemplate.ts': 1,
        'src/modules/Arrangement/repositories/presets/bassPresets.ts': 7,
        'src/modules/Arrangement/repositories/presets/expandedPresets.ts': 60,
        'src/modules/Arrangement/repositories/presets/factoryPresets.ts': 8,
        'src/modules/Arrangement/repositories/presets/faustEffectPresets.ts': 10,
        'src/modules/Arrangement/repositories/presets/faustInstrumentPresets.ts': 48,
        'src/modules/Arrangement/repositories/presets/keysPresets.ts': 4,
        'src/modules/Arrangement/repositories/presets/leadPresets.ts': 8,
        'src/modules/Arrangement/repositories/presets/padPresets.ts': 6,
        'src/modules/Arrangement/repositories/presets/presetHelpers/autopan.ts': 1,
        'src/modules/Arrangement/repositories/presets/presetHelpers/bitcrusher.ts': 1,
        'src/modules/Arrangement/repositories/presets/presetHelpers/chorus.ts': 1,
        'src/modules/Arrangement/repositories/presets/presetHelpers/comp.ts': 1,
        'src/modules/Arrangement/repositories/presets/presetHelpers/convReverb.ts': 1,
        'src/modules/Arrangement/repositories/presets/presetHelpers/delay.ts': 1,
        'src/modules/Arrangement/repositories/presets/presetHelpers/distortion.ts': 1,
        'src/modules/Arrangement/repositories/presets/presetHelpers/eq.ts': 1,
        'src/modules/Arrangement/repositories/presets/presetHelpers/filter.ts': 1,
        'src/modules/Arrangement/repositories/presets/presetHelpers/flanger.ts': 1,
        'src/modules/Arrangement/repositories/presets/presetHelpers/limiter.ts': 1,
        'src/modules/Arrangement/repositories/presets/presetHelpers/phaser.ts': 1,
        'src/modules/Arrangement/repositories/presets/presetHelpers/reverb.ts': 1,
        'src/modules/Arrangement/repositories/presets/presetHelpers/synth.ts': 1,
        'src/modules/Arrangement/repositories/presets/presetHelpers/tremolo.ts': 1,
        'src/modules/Arrangement/repositories/presets/stringsPresets.ts': 6,
        'src/modules/Arrangement/repositories/trackTemplate/loadTrackTemplates.ts': 1,
        // Type-only device-data shape: LiveStripTrack declares `devices` so
        // shouldCreateLiveTrackStrip can read device types for folder-strip
        // eligibility (#584) — a static declaration, not an executable access.
        'src/modules/Arrangement/stores/trackEligibility.ts': 1,
        'src/modules/Project/models/ProjectData.ts': 4,
        'src/modules/Project/models/VcaTrackMigration.ts': 1,
        'src/modules/Project/useCases/projectTemplates/templateFiles/ambient.ts': 3,
        'src/modules/Project/useCases/projectTemplates/templateFiles/cinematic.ts': 3,
        'src/modules/Project/useCases/projectTemplates/templateFiles/edm.ts': 4,
        'src/modules/Project/useCases/projectTemplates/templateFiles/hipHopTrap.ts': 4,
        'src/modules/Project/useCases/projectTemplates/templateFiles/lofi.ts': 3,
        'src/modules/Project/useCases/projectTemplates/templateFiles/podcast.ts': 5,
        'src/modules/Project/useCases/projectTemplates/templateFiles/popSong.ts': 5,
        'src/modules/Project/useCases/projectTemplates/templateFiles/rockBand.ts': 11,
        'src/modules/Project/useCases/projectTemplates/templateFiles/singerSongwriter.ts': 4,
    },
} satisfies Record<'executable' | 'static', CountByPath>;

const GUARDED_EXECUTABLE_PATHS = [
    'src/modules/Arrangement/stores/persistDeviceParam.ts',
    'src/modules/Arrangement/useCases/device/setDeviceParameter/persistDevicePatch.ts',
    'src/modules/Arrangement/useCases/device/setDeviceParameter/setDeviceParameter.ts',
    'src/modules/Arrangement/useCases/projectTrackToLiveStrip.ts',
    'src/modules/Arrangement/useCases/setTrackGainPan/helpers.ts',
    'src/modules/Automation/useCases/modulation/applyModulationToEngine.ts',
    'src/modules/Automation/useCases/modulation/revertMappingsToBase.ts',
    'src/modules/Bacteria/useCases/bacteriaParamBridge/createFlushParam.ts',
    'src/modules/Bacteria/useCases/bacteriaParamBridge/loadBacteriaPatchWithAudio.ts',
    'src/modules/Bacteria/useCases/bacteriaParamBridge/setBacteriaBandParamWithAudio.ts',
    'src/modules/Bacteria/useCases/bacteriaParamBridge/setBacteriaParamWithAudio.ts',
    'src/modules/Crust/useCases/crustParamBridge/createFlushHandlers.ts',
    'src/modules/Crust/useCases/crustParamBridge/loadCrustPatchWithAudio.ts',
    'src/modules/Crust/useCases/crustParamBridge/setCrustParamWithAudio.ts',
    'src/modules/Fermenter/useCases/applyFermenterRuntimeParam.ts',
    'src/modules/Fermenter/useCases/fermenterParamBridge/loadFermenterPatchWithAudio.ts',
    'src/modules/Fermenter/useCases/fermenterParamBridge/setFermenterParamWithAudio.ts',
    'src/modules/Fermenter/useCases/presetMorph/applyMorphedPatch.ts',
    'src/modules/Gluten/useCases/glutenParamBridge/createFlushHandlers.ts',
    'src/modules/Gluten/useCases/glutenParamBridge/loadGlutenPatchWithAudio.ts',
    'src/modules/Gluten/useCases/glutenParamBridge/setGlutenParamWithAudio.ts',
    'src/modules/Grinder/useCases/grinderParamBridge/createFlushParam.ts',
    'src/modules/Grinder/useCases/grinderParamBridge/loadGrinderPatchWithAudio.ts',
    'src/modules/Grinder/useCases/grinderParamBridge/moveGrinderPedalInChainWithAudio.ts',
    'src/modules/Grinder/useCases/grinderParamBridge/recallGrinderSnapshotWithAudio.ts',
    'src/modules/Grinder/useCases/grinderParamBridge/setGrinderMicParamWithAudio.ts',
    'src/modules/Grinder/useCases/grinderParamBridge/setGrinderParamWithAudio.ts',
    'src/modules/Grinder/useCases/grinderParamBridge/setGrinderPedalParamWithAudio.ts',
    'src/modules/Grinder/useCases/grinderParamBridge/syncGrinderPatchToAudio.ts',
    'src/modules/Levain/useCases/levainParamBridge/helpers.ts',
    'src/modules/Levain/useCases/loadPreset.ts',
    'src/modules/Proof/useCases/proofParamBridge/loadProofPatchWithAudio.ts',
    'src/modules/Proof/useCases/proofParamBridge/setProofParam.ts',
    'src/modules/Proof/useCases/proofParamBridge/setProofParamWithPatch.ts',
    'src/modules/Proof/useCases/proofParamBridge/setProofTarget.ts',
    'src/modules/Proof/useCases/proofParamBridge/syncFullPatch.ts',
    'src/modules/Toaster/useCases/setPadParamImmediate.ts',
    'src/modules/Toaster/useCases/loadToasterKit.ts',
    'src/modules/Toaster/useCases/toasterSubscriber.ts',
    'src/modules/Toaster/useCases/toasterParamBridge/setPadEngineImmediate.ts',
    'src/modules/Toaster/useCases/toasterParamBridge/setToasterKitParam.ts',
    'src/modules/Toaster/useCases/toasterParamBridge/setToasterPadParam.ts',
    'src/modules/Transport/useCases/scheduling/applyAutomation/applyAutomation.ts',
    'src/modules/Transport/useCases/scheduling/applyAutomation/restoreAutomationBaseValue.ts',
    'src/modules/Tuner/useCases/setA4Reference.ts',
] as const;

function productionSources(root: string): ProductionSource[] {
    const files: ProductionSource[] = [];
    function visit(directory: string): void {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const absolutePath = join(directory, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== '__tests__') {
                    visit(absolutePath);
                }
                continue;
            }
            if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith('.spec.ts') || entry.name.endsWith('.spec.tsx')) {
                continue;
            }
            files.push({ path: relative(root, absolutePath), source: readFileSync(absolutePath, 'utf8') });
        }
    }
    visit(join(root, 'src'));
    return files;
}

function countByPath(files: ReadonlyArray<ProductionSource>, definition: SinkDefinition): Record<string, number> {
    const result: Record<string, number> = {};
    for (const file of files) {
        if (!definition.includes(file.path)) {
            continue;
        }
        const matches = file.source.match(definition.pattern);
        if (matches && matches.length > 0) {
            result[file.path] = matches.length;
        }
    }
    return result;
}

function sortedEntries(counts: CountByPath): Array<[string, number]> {
    return Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
}

function assertCounts(family: string, actual: CountByPath, expected: CountByPath): void {
    if (JSON.stringify(sortedEntries(actual)) === JSON.stringify(sortedEntries(expected))) {
        return;
    }

    const changedPaths = new Set([...Object.keys(actual), ...Object.keys(expected)]);
    const changes = [...changedPaths]
        .sort((left, right) => left.localeCompare(right))
        .filter((path) => actual[path] !== expected[path])
        .map((path) => `${path}: expected ${expected[path] ?? 0}, received ${actual[path] ?? 0}`);
    throw new Error(`${family} sink census changed: ${changes.join('; ')}`);
}

function classifiedDeviceDataCounts(): CountByPath {
    const counts: Record<string, number> = {};
    for (const classification of Object.values(DEVICE_DATA_COUNTS)) {
        for (const [path, count] of Object.entries(classification)) {
            if (path in counts) {
                throw new Error(`device-data path has multiple classifications: ${path}`);
            }
            counts[path] = count;
        }
    }
    return counts;
}

function assertProductionClosure(files: ReadonlyArray<ProductionSource>): void {
    for (const family of Object.keys(SINK_DEFINITIONS) as SinkFamily[]) {
        assertCounts(family, countByPath(files, SINK_DEFINITIONS[family]), EXPECTED_SINK_COUNTS[family]);
    }

    const projectDataFiles = files.filter(
        (file) => file.path.startsWith('src/modules/Arrangement/') || file.path.startsWith('src/modules/Project/')
    );
    assertCounts(
        'device-data',
        countByPath(projectDataFiles, {
            pattern: /\b(?:parameterValues|devices)\s*:/g,
            includes: includeAllPaths,
        }),
        classifiedDeviceDataCounts()
    );

    const sourceByPath = new Map(files.map((file) => [file.path, file.source]));
    for (const path of GUARDED_EXECUTABLE_PATHS) {
        const source = sourceByPath.get(path);
        if (!source?.includes('resolveEligibleDeviceWriteTarget')) {
            throw new Error(`guard missing from executable path: ${path}`);
        }
    }
}

describe('device write boundary closure', () => {
    it('classifies every production sink by family, path, and exact count', () => {
        const files = productionSources(process.cwd());
        expect(() => assertProductionClosure(files)).not.toThrow();
    });

    it.each([
        {
            name: 'an aliased persistence/runtime writer',
            path: 'src/modules/Unexpected/newRuntimeWriter.ts',
            source: 'const { updateDeviceParam: write } = dependencies; write("t", "d", "p", 1);',
        },
        {
            name: 'a strip-add writer',
            path: 'src/modules/Unexpected/newStripWriter.ts',
            source: 'addDeviceToStrip("track", device);',
        },
        {
            name: 'an aliased direct built-in writer',
            path: 'src/modules/Toaster/useCases/newBuiltInWriter.ts',
            source: 'const { setParam: write } = controls; write("gain", 1);',
        },
        {
            name: 'a compile caller',
            path: 'src/modules/Unexpected/newCompileWriter.ts',
            source: 'compileFaustDSP("device");',
        },
        {
            name: 'a patch-load caller',
            path: 'src/modules/Unexpected/newLoadWriter.ts',
            source: 'loadUnexpectedPatchWithAudio("device", patch);',
        },
        {
            name: 'an immediate caller',
            path: 'src/modules/Unexpected/newImmediateWriter.ts',
            source: 'setUnexpectedParamImmediate("device", "gain", 1);',
        },
        {
            name: 'an audioDevice.loaded hydration path',
            path: 'src/modules/Unexpected/newHydrationWriter.ts',
            source: 'eventBus.on("audioDevice.loaded", hydrate);',
        },
        {
            name: 'a direct devices writer',
            path: 'src/modules/Arrangement/newDeviceWriter.ts',
            source: 'const next = { devices: [] };',
        },
        {
            name: 'a direct parameterValues writer',
            path: 'src/modules/Project/newParameterWriter.ts',
            source: 'const next = { parameterValues: {} };',
        },
    ])('rejects $name through the production closure assertion', ({ path, source }) => {
        const files = productionSources(process.cwd());
        expect(() => assertProductionClosure([...files, { path, source }])).toThrow(/sink census changed/);
    });
});
