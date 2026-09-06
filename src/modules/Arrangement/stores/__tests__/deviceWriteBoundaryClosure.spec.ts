import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
    type ArrowFunction,
    type CallExpression,
    type Expression,
    type FunctionDeclaration,
    type FunctionExpression,
    type Node,
    LanguageVariant,
    NodeFlags,
    ScriptKind,
    ScriptTarget,
    SyntaxKind,
    createScanner,
    createPrinter,
    createSourceFile,
    forEachChild,
    isArrayLiteralExpression,
    isArrowFunction,
    isAsExpression,
    isBlock,
    isCallExpression,
    isComputedPropertyName,
    isConditionalExpression,
    isFunctionDeclaration,
    isFunctionExpression,
    isIdentifier,
    isNonNullExpression,
    isObjectLiteralExpression,
    isParenthesizedExpression,
    isPropertyAccessExpression,
    isPropertyAssignment,
    isReturnStatement,
    isSatisfiesExpression,
    isShorthandPropertyAssignment,
    isStringLiteral,
    isVariableDeclaration,
    isVariableDeclarationList,
} from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

type CountByPath = Readonly<Record<string, number>>;
type SourceText = { path: string; source: string };
// The census counts writes in code, not prose: `code` carries the file text
// with comments removed, and every registered count is measured against it.
type ProductionSource = { path: string; source: string; code: string };
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
        // Count provenance: 0 in code, was 1 lexical — the single mention was a
        // doc-comment note in `quantiseDeviceParameterValue` explaining why
        // quantisation is applied at delivery instead of inside
        // `clampDeviceParameterValue`. Pure model, reaches no sink; row removed
        // rather than zeroed, since this census only records files that match.
        // 'src/modules/Arrangement/models/DeviceParameterLaw.ts': removed (0),
        // Count provenance: 0 in code, was 1 lexical — the single mention was a
        // doc-comment note on the Grinder gate rows explaining that `addDevice`
        // writes every `param.value` through `updateDeviceParam` while
        // `syncGrinderPatchToAudio` runs only on preset load and recall. Pure
        // descriptor table, reaches no sink.
        // 'src/modules/Arrangement/models/PluginDescriptors/GrinderDescriptor.ts': removed (0),
        // Count provenance: 0 in code, was 1 lexical — the single mention was a
        // doc-comment note on the Dutch Oven `damping` row (#1546) recording
        // that the descriptor is the leg that had to move because `addDevice`
        // pushes `param.value` through `updateDeviceParam` at add time. Pure
        // descriptor table, reaches no sink.
        // 'src/modules/Arrangement/models/PluginDescriptors/NativeDspDescriptors.ts': removed (0),
        'src/modules/Arrangement/stores/index.ts': 2,
        // Count provenance: 0 in code, was 3 lexical — all three were
        // doc-comment mentions (`clampDeviceParamWrite`'s header naming
        // `updateDeviceParam` and `persistDeviceParam`, the device-type index
        // citing `persistDeviceParam` as the replace-don't-mutate writer). The
        // file holds no write at all.
        // 'src/modules/Arrangement/stores/clampDeviceParamWrite.ts': removed (0),
        'src/modules/Arrangement/stores/persistDeviceParam.ts': 1,
        // Count provenance: measured 2 — import + one afterCommit loop pushing
        // committed parameterValues through AudioEngine `updateDeviceParam`.
        // Project truth is written first via `writeDeviceToProject`; this is the
        // engine half of add-device, not a foreign store write.
        'src/modules/Arrangement/handlers/device/handleAddDevice.ts': 2,
        // Count provenance: measured 2 — import + one afterCommit loop. Topology
        // is applied through the device-chain runtime delta; parameter controls
        // run only after that delta is accepted.
        'src/modules/Arrangement/handlers/preset/handleLoadPreset.ts': 2,
        'src/modules/Arrangement/useCases/device/setDeviceParameter/persistDevicePatch.ts': 1,
        'src/modules/Arrangement/useCases/device/setDeviceParameter/setDeviceParameter.ts': 2,
        'src/modules/Arrangement/useCases/index.ts': 2,
        'src/modules/Arrangement/useCases/projectTrackToLiveStrip.ts': 2,
        'src/modules/Arrangement/useCases/setTrackGainPan/helpers.ts': 4,
        // Count provenance: measured 0 with `grep -o` over the four sink
        // identifiers — row removed rather than zeroed, since this census only
        // records files that match. #2458 removed the Toaster pad gain mirror
        // (the pad output feeds the child strip, so the mirror applied every
        // fader move twice); the fader now drives only the strip gain and this
        // file names no sink.
        // 'src/modules/Arrangement/useCases/setTrackGainPan/setTrackGain.ts': removed (0),
        'src/modules/Arrangement/useCases/setTrackGainPan/setTrackPan.ts': 2,
        'src/modules/AudioEngine/models/AudioEngineState.ts': 2,
        'src/modules/AudioEngine/repositories/createWebAudioEngine.ts': 2,
        // Count provenance: 0 in code, was 2 lexical — both were doc-comment
        // mentions of `updateDeviceParam` explaining why the offline scheduler
        // passes the quantiser as `quantiseEmit` rather than folding it into
        // `clampStep`, naming the live `applyAutomation` delivery this offline
        // path mirrors. The repository schedules AudioParams and worklet
        // segments; it holds no device write of its own.
        // 'src/modules/AudioEngine/repositories/offlineScheduler/automationScheduling.ts': removed (0),
        // Count provenance: 0 in code, was 1 lexical — a doc-comment mention of
        // `updateDeviceParam` on the `quantiseEmit` option, naming the live call
        // the option replicates. The file compiles automation points into timed
        // events and writes nothing.
        // 'src/modules/AudioEngine/repositories/offlineScheduler/compileAutomationEvents.ts': removed (0),
        // Count provenance: new file, measured 1 — the single
        // `audioEngine.updateDeviceParam` call. Web Audio half of the door for a
        // built-in the native session carries, reached only from the guard-listed
        // automation tick path. Engine-only, reaches no document (#3893).
        'src/modules/AudioEngine/useCases/deviceControls/holdWebFallbackDeviceParam.ts': 1,
        // Count provenance: measured 2 in code — the function declaration plus
        // its one `audioEngine.updateDeviceParam` call, the single door every
        // device-param write reaches the DSP through, where the declared-range
        // law binds.
        'src/modules/AudioEngine/useCases/deviceControls/updateDeviceParam.ts': 2,
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
        'src/modules/Bacteria/useCases/bacteriaParamBridge/bacteriaParamBridgeDependencies.ts': 4,
        'src/modules/Bacteria/useCases/bacteriaParamBridge/helpers.ts': 4,
        'src/modules/Bacteria/useCases/bacteriaParamBridge/loadBacteriaPatchWithAudio.ts': 2,
        'src/modules/Bacteria/useCases/bacteriaParamBridge/setBacteriaBandParamWithAudio.ts': 2,
        'src/modules/Bacteria/useCases/bacteriaParamBridge/setBacteriaParamWithAudio.ts': 2,
        // Count provenance: measured 2 in code, both `updateDeviceParam` — the
        // import and a single call on the transient branch. The **commit**
        // branch reaches no sink here at all; it dispatches
        // `setDeviceParameter` through `executeAppAction`, so project truth and
        // the engine are both written behind the action. Crumbs knob values were
        // previously persisted nowhere and its only engine write went to the
        // *native* instance, which is not the one that renders.
        'src/modules/Crumbs/useCases/setCrumbsParamWithAudio.ts': 2,
        // Count provenance: 0 in code, was 1 lexical — a doc-comment mention of
        // `updateDeviceParam` naming the route the three voice-stack ids take.
        // The file delegates every field to `setCrumbsParamWithAudio`, which is
        // where the sink is counted; it used to call
        // `setCrumbsParamThrottled` only, which is the native instance and not
        // a sink in this family at all — the reason a census that counts sinks
        // could not see the defect.
        // 'src/modules/Crumbs/useCases/voiceStacking.ts': removed (0),
        'src/modules/Crust/useCases/crustParamBridge/createFlushHandlers.ts': 4,
        'src/modules/Crust/useCases/crustParamBridge/helpers.ts': 8,
        // Count provenance: new file entry, measured 2 — the `updateDeviceParam`
        // import and its single call site. The panel's true-peak reset has to
        // reach the engine as well as the store: Crust's engine holds the
        // session true-peak maximum, so a store-only reset is undone by the
        // next meter poll.
        'src/modules/Crust/useCases/resetCrustTruePeakIndicator.ts': 2,
        // Count provenance: measured 4 in code — the four declared DI
        // signatures, one per identifier. This file is a type declaration plus
        // the holder — it performs no write. The `clampDeviceParameterValue`
        // port's doc comment explains why the range has to be resolved before
        // Fermenter's camelCase key is mapped to its snake_case DSP key:
        // `updateDeviceParam`'s own clamp looks the parameter up on the
        // descriptor and the DSP key matches no entry there.
        'src/modules/Fermenter/useCases/fermenterDependencies.ts': 4,
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
        // Count provenance: 0 in code, was 2 lexical — both matches were
        // doc-comment prose in the header explaining why a drag is one edit
        // rather than ninety: it names `persistDeviceParam` as what the
        // transient half no longer calls and `updateDeviceParam` as what
        // `setDeviceParameter` calls on its behalf. The commit goes through
        // `executeAppAction`, so this file performs no write.
        // 'src/modules/Gluten/useCases/glutenParamBridge/setGlutenParamWithAudio.ts': removed (0),
        // Count provenance: 0 in code, was 1 lexical — a doc-comment mention
        // recording why the commit branch does *not* also push at the Grand
        // Boule engine handle: `setDeviceParameter` already reaches the same
        // worklet controls through `updateDeviceParam`. The transient branch
        // writes the engine through `GrandBouleEngineHandle.setParam`, which is
        // the `direct-built-in` family, not this one.
        // 'src/modules/GrandBoule/useCases/grandBouleParamBridge/helpers.ts': removed (0),
        'src/modules/Grinder/useCases/grinderParamBridge/grinderParamBridgeDependencies.ts': 6,
        'src/modules/Grinder/useCases/grinderParamBridge/helpers.ts': 4,
        'src/modules/Grinder/useCases/grinderParamBridge/loadGrinderPatchWithAudio.ts': 3,
        'src/modules/Grinder/useCases/grinderParamBridge/moveGrinderPedalInChainWithAudio.ts': 2,
        'src/modules/Grinder/useCases/grinderParamBridge/recallGrinderSnapshotWithAudio.ts': 3,
        'src/modules/Grinder/useCases/grinderParamBridge/setGrinderMicParamWithAudio.ts': 2,
        'src/modules/Grinder/useCases/grinderParamBridge/setGrinderParamWithAudio.ts': 2,
        'src/modules/Grinder/useCases/grinderParamBridge/setGrinderPedalParamWithAudio.ts': 2,
        // Count provenance: 0 in code, was 1 lexical — a doc-comment mention of
        // `persistDevicePatch` as the reason this codec for Levain's
        // `Device.deviceState` chunk exists: it keeps only finite numbers, so
        // the instrument id and articulation it drops are the two fields this
        // codec carries instead. The write itself is `commitLevainDeviceState`,
        // which goes through `executeAppAction`.
        // 'src/modules/Levain/models/LevainDeviceState.ts': removed (0),
        // Count provenance: measured 4 in code — the `persistDeviceParam`
        // import, the DI type field and its `typeof` twin, and the one
        // committing call in `flushParam`.
        'src/modules/Levain/useCases/levainParamBridge/helpers.ts': 4,
        'src/modules/Levain/useCases/levainParamBridge/levainBridgeDependencies.ts': 2,
        'src/modules/Proof/useCases/proofParamBridge/loadProofPatchWithAudio.ts': 2,
        'src/modules/Proof/useCases/proofParamBridge/setProofParam.ts': 2,
        'src/modules/Proof/useCases/proofParamBridge/setProofParamWithPatch.ts': 3,
        'src/modules/Proof/useCases/proofParamBridge/setProofTarget.ts': 2,
        // Count provenance: measured 2 in code — the `updateDeviceParam`
        // import plus the single canonical call on the tick path (#746/#760
        // slew snap + a-rate gain/pan scheduling restructured around it); the
        // reviewed live write path stays singular.
        'src/modules/Transport/useCases/scheduling/applyAutomation/applyAutomation.ts': 2,
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
        // Count provenance: measured 2 in code — the `updateDeviceParam`
        // import and its single call site, both on the transient preview
        // branch.
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
        'src/modules/Tuner/useCases/setA4Reference.ts': 2,
    },
    'strip-add': {
        // Count provenance: measured 4 — the identifier now lives only as the
        // engine repository's internal primitive plus the test-harness override.
        // Production add/reorder/preset paths compile a runtime graph delta and
        // no longer name `addDeviceToStrip`.
        'src/modules/AudioEngine/repositories/createWebAudioEngine.ts': 4,
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
        // The runtime projection owns the one direct engine parameter write;
        // settled edits route through the undoable command instead.
        'src/modules/GrandBoule/useCases/applyGrandBouleMorphState.ts': 1,
        // Count provenance: 0 in code, was 1 lexical — a doc-comment mention of
        // `CrumbsNode.setParam` naming the worklet the commit now reaches
        // through `setDeviceParameter`. The Crumbs bridge calls
        // `setCrumbsParam`, which does not match this family's pattern.
        // 'src/modules/Crumbs/useCases/setCrumbsParamWithAudio.ts': removed (0),
        'src/modules/GrandBoule/useCases/calibrateGrandBouleMidi/syncMidiCalibrationToEngine.ts': 2,
        // Count provenance: measured 2 in code — the transient preview and
        // rejected-commit reconciliation each call `engine.setParam`. This is
        // the write the three Mix setters used to each hold one of:
        // `setGrandBouleMasterGain.ts`, `setGrandBouleSoundboardSend.ts` and
        // `setGrandBouleSympatheticSend.ts` each scored 1 and now score 0, so
        // they leave this table. They clamp to their declared range and
        // delegate; nothing else changed about them.
        'src/modules/GrandBoule/useCases/grandBouleParamBridge/helpers.ts': 2,
        'src/modules/GrandBoule/useCases/loadGrandBoulePreset.ts': 4,
        // Count provenance: measured 2 in code — the `setParam` handle on the
        // returned engine and the `controls.setParam` call it forwards to. The
        // node selector scopes on `candidateNode.deviceId === input.deviceId`;
        // the handle-member prose that used to add a third match sits in a
        // doc comment and no longer counts.
        'src/modules/GrandBoule/useCases/resolveGrandBouleEngine.ts': 2,
        'src/modules/GrandBoule/useCases/setGrandBouleAttackBite.ts': 1,
        // Count provenance: 0 in code, was 1 lexical — the file delegates to
        // the command/runtime split, and its remaining match was the
        // explanatory `setParam` doc comment.
        // 'src/modules/GrandBoule/useCases/setGrandBouleMorphPosition.ts': removed (0),
        'src/modules/GrandBoule/useCases/setGrandBoulePerNoteParam/resetGrandBoulePerNoteParams.ts': 1,
        'src/modules/GrandBoule/useCases/setGrandBoulePerNoteParam/setGrandBoulePerNoteParam.ts': 1,
        'src/modules/GrandBoule/useCases/setGrandBouleStretchAmount.ts': 1,
        'src/modules/GrandBoule/useCases/setGrandBouleVelocityCurve.ts': 1,
        // Count provenance: measured 8 in code. Registration no longer routes
        // patch initialization through the rAF write batcher: it applies the
        // complete runtime patch synchronously before sample loading and performs
        // no project persistence. The retired match was that registration-time
        // `queueParam` path; explicit user edits remain the only persisted sinks.
        'src/modules/Levain/useCases/levainParamBridge/helpers.ts': 8,
        // Count provenance: 0 in code, was 1 lexical — a doc-comment mention of
        // `setParam`. The file reads the persisted chain order off the project
        // and posts one `reorder` message to the offline worklet port; the
        // comment names `setParam` because it has to explain why the offline
        // param replay does *not* deliver order (the worklet's `set_param`
        // matches no `chain_order_` prefix and drops all five values).
        // 'src/modules/Proof/useCases/prepareOfflineProof.ts': removed (0),
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
        'src/modules/Toaster/useCases/setPadParamImmediate.ts': 1,
        // Count provenance: 0 in code, was 3 lexical — all three matches were
        // doc-comment mentions (`setPadParam` 2, `setParam` 1). The file holds
        // no write; it is the readiness gate for the three pad-param paths, and
        // its comment names both identifiers to record why readiness is *not*
        // shared with the kit path: a loading device's placeholder
        // `setPadParam` is an empty function that drops the write, while its
        // `setParam` buffers into `pendingParams` and is replayed on load.
        // 'src/modules/Toaster/useCases/toasterParamBridge/findReadyToasterControlsOnStrip.ts': removed (0),
        // findToasterNodeOnStrip.ts is absent on purpose: measured 0. It is the
        // id-scoping half, shared by every caller, and names neither sink.
        'src/modules/Toaster/useCases/toasterParamBridge/setPadEngineImmediate.ts': 1,
        // Count provenance: measured 1 in code — the single `setParam` call on
        // the flush path, unchanged. The flush scopes by `deviceId` but
        // deliberately does *not* gate on `ready`: the placeholder controller
        // for a loading Toaster buffers `setParam` into `pendingParams` and the
        // loader replays it, so skipping a not-ready node here would discard kit
        // edits made during load instead of deferring them.
        'src/modules/Toaster/useCases/toasterParamBridge/setToasterKitParam.ts': 1,
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
        // Count provenance: 0 in code, was 1 lexical — a doc-comment
        // cross-reference to `compileAutomationEvents`, naming the second of the
        // two callers that feed `clampDeviceParameterValue`'s result back in as
        // the state of a one-pole IIR slew. That is why
        // `quantiseDeviceParameterValue` is a separate function: rounding inside
        // the clamp would dead-zone both recurrences. The model holds no write.
        // 'src/modules/Arrangement/models/DeviceParameterLaw.ts': removed (0),
        // Count provenance: the versioned-command preview compiler and its two
        // chat-planning call sites create immutable Command envelopes only; they
        // neither hydrate a device nor write engine state.
        'src/modules/AiRuntime/useCases/compilePendingActionCommandEnvelopes.ts': 1,
        // Count provenance: the batch compiler, public barrel, and Workspace
        // caller compile immutable Command metadata only. The seven compiler-file
        // hits include preview/compiler references, batch-envelope references,
        // and the exported function declaration; none hydrates or
        // writes a device.
        'src/modules/AiRuntime/useCases/compilePlannedActionCommandBatch.ts': 7,
        // Count provenance: AC-013 compiles immutable approval and execution
        // metadata. These references are imports, declarations, calls, and
        // ReturnType projections around Command envelope compilers; none loads,
        // hydrates, or writes a device or AudioEngine node.
        'src/modules/AiRuntime/useCases/compileAgentActionExecution.ts': 10,
        'src/modules/AiRuntime/useCases/compileAgentRiskApproval.ts': 1,
        // Count provenance: 0 in code, was 3 — confirmation admission moved to
        // agentRequestOrchestration/resolveConfirmationAdmission (#3048), taking
        // every `compileAgentRiskApproval` reference with it; censused below.
        // 'src/modules/AiRuntime/useCases/confirmPendingChatActions.ts': removed (0),
        'src/modules/AiRuntime/useCases/describeAgentRiskApproval.ts': 3,
        // Pending-effect continuation records keep only command-envelope types;
        // their two matches are type imports and type projections, never device IO.
        'src/modules/AiRuntime/useCases/createAgentRunPendingEffectContinuation.ts': 2,
        'src/modules/AiRuntime/useCases/issueAgentCommandApprovalBinding.ts': 3,
        'src/modules/AiRuntime/useCases/validateAgentRiskApproval.ts': 7,
        'src/modules/AiRuntime/useCases/prepareAgentRunPendingEffectContinuation.ts': 2,
        'src/modules/AiRuntime/useCases/recordAgentRunPendingEffectContinuation.ts': 2,
        // Count provenance: 0 in code, was 2 — pure receipt projection moved to
        // projectAgentRunReceiptSaga (#3052), taking every
        // `compileVersionedCommandBatchEnvelope` type reference with it;
        // censused below. The wrapper delegates to agentRunLifecycle only.
        // 'src/modules/AiRuntime/useCases/recordAgentRunReceiptSaga.ts': removed (0),
        // Count provenance: new file entry, measured 2 — the
        // `compileVersionedCommandBatchEnvelope` type import and one ReturnType
        // projection, extracted from recordAgentRunReceiptSaga (#3052). Pure
        // receipt projection; no device hydration or write.
        'src/modules/AiRuntime/useCases/projectAgentRunReceiptSaga.ts': 2,
        // Count provenance: 0 in code, was 5 — prompt plan materialization and
        // explain-response streaming were extracted to agentRequestOrchestration
        // (#2973, #2975), taking every `compileAgentActionExecution` and
        // `providerProtocol.compileRequest` reference with them; those files
        // are censused below.
        // 'src/modules/AiRuntime/useCases/sendChatMessage.ts': removed (0),
        // Prompt admission owns immutable action-execution compilation; the import,
        // module path, and call are metadata construction, not hydration.
        'src/modules/AiRuntime/useCases/submitAdmittedPromptRequest.ts': 3,
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
        'src/modules/Command/useCases/getCommandDivergenceTargetIds.ts': 2,
        'src/modules/Command/useCases/index.ts': 4,
        'src/modules/Command/useCases/parseVersionedCommandEnvelope.ts': 2,
        'src/modules/Command/useCases/refreshVersionedCommandBatchForApproval.ts': 3,
        'src/modules/Command/useCases/resolveVersionedCommandBatchBindings.ts': 2,
        // Count provenance: 0 in code, was 1 lexical — a doc-comment
        // cross-reference to `compileAutomationEvents` in the editor-readout
        // evaluator's AU-1 delegation note (#747). The transformer computes
        // curve values only, holds no device writes.
        // 'src/modules/Arrangement/transformers/automationTransformers.ts': removed (0),
        // Count provenance: 0 in code, was 1 lexical — a doc-comment
        // cross-reference to `compileAutomationEvents` in the live evaluator's
        // AU-1 delegation note (#747) — not a sink.
        // 'src/modules/Automation/services/automationPointAlgorithms.ts': removed (0),
        'src/modules/AudioEngine/repositories/faustDeviceFactory.ts': 3,
        // Count provenance: the offline automation compilers
        // (compileAutomationEvents/compileAutomationSegments and their callers)
        // are pure point-list → scheduling-event transforms introduced with the
        // offline automation region/curve work; they hold no device writes.
        // Counts are bare `compile[A-Z]…` identifier references (import + call
        // sites), censused so any future real sink added to these files still
        // trips the closure.
        // The shared offline scheduler names its pure compilers four times in
        // code; it schedules runtime events but does not write project device
        // state.
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
        'src/modules/AudioEngine/useCases/index.ts': 4,
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
        // Count provenance: 0 in code, was 1 lexical — a doc-comment reference
        // to the sibling loadFermenterPatchWithAudio path in `flushMorph` (the
        // engine write now goes through the same mapFermenterPatchToDspPatch
        // DSP-id mapping — #548). That write class stays censused under
        // 'persistence-runtime' at count 6.
        // 'src/modules/Fermenter/useCases/presetMorph/applyMorphedPatch.ts': removed (0),
        'src/modules/Fermenter/presentations/views/FermenterPanel.tsx': 7,
        'src/modules/Gluten/useCases/glutenParamBridge/loadGlutenPatchWithAudio.ts': 2,
        'src/modules/Gluten/presentations/views/GlutenPanel.tsx': 3,
        'src/modules/GrandBoule/presentations/components/PianoModel3D.tsx': 4,
        // Event contract and subscription project serialized state to the ready
        // Grand Boule engine; neither writes project truth.
        'src/modules/GrandBoule/useCases/grandBouleSubscriber.ts': 2,
        'src/modules/Grinder/useCases/grinderParamBridge/loadGrinderPatchWithAudio.ts': 2,
        'src/modules/Grinder/useCases/index.ts': 1,
        'src/modules/Grinder/presentations/views/GrinderPanel.tsx': 3,
        'src/modules/Levain/useCases/levainParamBridge/helpers.ts': 3,
        'src/modules/Levain/useCases/levainParamBridge/loadSamplesForInstrument.ts': 2,
        'src/modules/Levain/useCases/loadPreset.ts': 4,
        'src/modules/Levain/presentations/views/LevainPanel.tsx': 2,
        'src/modules/PluginHost/useCases/faustEngine/compileFaustDSP.ts': 1,
        'src/modules/PluginHost/useCases/index.ts': 2,
        'src/modules/Proof/useCases/proofParamBridge/loadProofPatchWithAudio.ts': 1,
        'src/modules/Proof/presentations/views/ProofPanel.tsx': 3,
        // Count provenance: 0 in code, was 1 lexical — a doc-comment mention of
        // `setPadParamImmediate` naming one of the two pad-param entry points
        // that call this transform. `toPadStoreUpdate` is a pure function from
        // (key, numeric value) to the `Partial<PadState>` its callers write: it
        // holds no store write, no engine write, and no import beyond the
        // `PadState` type.
        // 'src/modules/Toaster/models/PadStoreUpdate.ts': removed (0),
        // Count provenance: 0 in code, was 1 lexical — `audioDevice.loaded` in
        // the doc comment on the pending-kit-update queue, naming the event
        // whose handler creates the store record the queued writes wait for.
        // The file's executable writes are register/unregister/loadKit/updateKit
        // store writes, none of which is a load/compile/hydration sink.
        // 'src/modules/Toaster/stores/toasterStore.ts': removed (0),
        'src/modules/Toaster/useCases/loadToasterKit.ts': 1,
        // Count provenance: 0 in code, was 1 lexical — `audioDevice.loaded` in
        // the doc comment explaining why an offline path is needed: that event
        // never fires offline, so the live subscriber never runs. No load or
        // hydration sink in the file.
        // 'src/modules/Toaster/useCases/prepareOfflineToaster.ts': removed (0),
        'src/modules/Toaster/useCases/setPadParamImmediate.ts': 1,
        'src/modules/Toaster/useCases/toasterParamBridge/setPadEngineImmediate.ts': 1,
        'src/modules/Toaster/useCases/toasterSubscriber.ts': 2,
        'src/modules/Toaster/useCases/trigger16Level.ts': 5,
        // Count provenance (#3471, #3476): measured 7 — 2 from `loadToasterKitPreset`
        // (import and preset load call) plus 5 from `setPadParamImmediate`
        // (2 lexical from import identifier and module path, 3 runtime immediate
        // parameter writes for 16-levels note repeat auditioning on tune, decay,
        // and filterCutoff).
        'src/modules/Toaster/presentations/views/ToasterPanel.tsx': 7,
        // Count provenance: 0 in code, was 1 lexical — a doc-comment
        // cross-reference to the sibling offline compiler
        // `compileAutomationEvents` from the AU-1 shared curve kernel (#747) —
        // a pure curve-math utility, not a device-write sink.
        // 'src/utils/automationCurve.ts': removed (0),
        // Count provenance: 0 in code, was 1 lexical — a doc-comment mention of
        // `compileAutomationEvents` naming the offline compile path that
        // evaluates this shared lane bound per segment. The kernel is pure
        // clamp arithmetic over an interpolated value; it holds no write.
        // 'src/utils/automationLaneBound.ts': removed (0),
        // Count provenance (#1994): lexical compile* matches after the
        // runtime-graph-delta split. None is a new raw store write.
        // AiRuntime: compileRequest / command-envelope compilers (not device
        // hydration). sendChatMessage 3→5 is the same family, documented above.
        'src/modules/AiRuntime/models/ModelProviderProtocol.ts': 1,
        'src/modules/AiRuntime/repositories/cloudLlm/setCloudProviderConfig.ts': 2,
        'src/modules/AiRuntime/repositories/providerAdapterRegistry.ts': 3,
        'src/modules/AiRuntime/useCases/agentReference/bridgeGroundedLlmToolCalls.ts': 1,
        // Count provenance: new file entry, measured 1 — the module path in a
        // type-only import of `ArbitraryCommandListEvidence` (the family
        // pattern matches inside the string). The composer projects immutable
        // agent-run scope metadata; it holds no device write.
        'src/modules/AiRuntime/useCases/agentReference/composeVerifiedProviderProposalScope.ts': 1,
        // Count provenance: new file entry, measured 4 — prompt plan
        // materialization moved out of sendChatMessage (#2973): the
        // `compileAgentActionExecution` named import, its module path in that
        // same import line, one ReturnType projection, and the one call.
        // Immutable Command-envelope compilation; no device hydration or write.
        'src/modules/AiRuntime/useCases/agentRequestOrchestration/materializePromptCommandPlan.ts': 4,
        // Count provenance: new file entry, measured 2 — the
        // `compileVersionedCommandBatchEnvelope` type import and one ReturnType
        // projection in the manual-repair missing-effects branch (#2988). Agent-run
        // persistence only; no device hydration or write.
        'src/modules/AiRuntime/useCases/agentRequestOrchestration/requireSectionRenderManualRepair.ts': 2,
        // Count provenance: new file entry, measured 3 — the `compileAgentRiskApproval`
        // import, its module path in that same import, and the one call in the
        // in-flight gate, extracted from confirmPendingChatActions (#3048). Immutable
        // approval metadata only; no device hydration or write.
        'src/modules/AiRuntime/useCases/agentRequestOrchestration/resolveConfirmationAdmission.ts': 3,
        // Count provenance: new file entry, measured 2 — the
        // `compileVersionedCommandBatchEnvelope` type import and one ReturnType
        // projection in section-render command-id resolution, extracted from
        // confirmPendingChatActions (#3147). Command settlement only; no device
        // hydration or write.
        'src/modules/AiRuntime/useCases/agentRequestOrchestration/settleConfirmedCommandExecution.ts': 2,
        // Count provenance: new file entry, measured 1 — the single
        // `providerProtocol.compileRequest` call, extracted from
        // sendChatMessage (#2975). Provider-request compilation only.
        'src/modules/AiRuntime/useCases/agentRequestOrchestration/streamExplainChatResponse.ts': 1,
        'src/modules/AiRuntime/useCases/aiRuntimeQueries/runLocalModelTextCompletion.ts': 1,
        // Count provenance: measured 3 — the exported batch compiler's
        // declaration, plus the declaration and one call of
        // `compileMidiTransformItem`, which expands a MIDI transform into
        // immutable `addNotes` command metadata. Nothing here hydrates or
        // writes a device.
        'src/modules/AiRuntime/useCases/compileArbitraryCommandList.ts': 3,
        'src/modules/AiRuntime/useCases/llmOrchestration/inference.ts': 1,
        'src/modules/AiRuntime/useCases/modelProviderProtocol.ts': 3,
        'src/modules/AiRuntime/useCases/parsePromptToActions.ts': 3,
        'src/modules/AiRuntime/useCases/streamHostedModelText.ts': 1,
        'src/modules/AiRuntime/useCases/validateArbitraryCommandListEvidence.ts': 1,
        // Arrangement: compileAddDeviceAction / compileReorderDevicesAction /
        // compileLoadPresetActions / compileTrackStripInitializationSnapshot.
        // Compilers, barrel re-exports, the loadPreset handler, and
        // projectTrackToLiveStrip all name those compilers; they do not write
        // stores. Handlers commit through executeAppAction.
        'src/modules/Arrangement/handlers/preset/handleLoadPreset.ts': 3,
        // Count provenance: 0 in code, was 3 — the plugin-drop branch now
        // dispatches through `executeAddDeviceAction`, which owns the compile
        // step; the hook no longer names a compiler.
        // 'src/modules/Arrangement/presentations/hooks/useTimelineFileDrop.ts': removed (0),
        'src/modules/Arrangement/useCases/compileTrackStripInitializationSnapshot.ts': 1,
        'src/modules/Arrangement/useCases/device/compileAddDeviceAction.ts': 1,
        'src/modules/Arrangement/useCases/device/compileReorderDevicesAction.ts': 1,
        // Count provenance: new file entry, measured 3 — the
        // `compileAddDeviceAction` named import, its module path in that same
        // import line (the family pattern matches inside the string), and the
        // one compile call in the dispatch door. The compiled action commits
        // through `executeAppAction`; the file holds no store or engine write.
        'src/modules/Arrangement/useCases/device/executeAddDeviceAction.ts': 3,
        // Count provenance: was 6, measured 4 — the `compileAddDeviceAction`
        // re-export left the barrel with the dispatch-door rewire (#2980);
        // the compileReorderDevicesAction and compileLoadPresetActions
        // re-exports remain (identifier + module path each).
        'src/modules/Arrangement/useCases/index.ts': 4,
        'src/modules/Arrangement/useCases/preset/compileLoadPresetActions.ts': 1,
        'src/modules/Arrangement/useCases/projectTrackToLiveStrip.ts': 3,
        // AudioEngine: compileRuntimeDeviceControl / compileRuntimeGraphDelta /
        // compileRuntimeGrinderNeuralPatch. Node apply sites plus the pure
        // delta compiler; createWebAudioEngine applies accepted deltas.
        'src/modules/AudioEngine/engine/BacteriaNode.ts': 3,
        'src/modules/AudioEngine/engine/CrustNode.ts': 3,
        'src/modules/AudioEngine/engine/GlutenNode.ts': 3,
        'src/modules/AudioEngine/engine/GrinderNode.ts': 6,
        // Count provenance: new file entry, measured 3 with `grep -oE` over the
        // family pattern — all three are `compileRuntimeDeviceControl`
        // (`compileRuntimeGraphDelta` 0, `compileRuntimeGrinderNeuralPatch` 0),
        // and the other three sink families score 0 here: `setParam` appears but
        // `direct-built-in` only includes `*/useCases/` paths, and this file is
        // under `engine/`. The 3 are the named import, the module path in that
        // same import line (the family pattern matches inside the string too),
        // and the single call in `postControl`.
        //
        // Introduced by #2240 ("harden Proof runtime controls and faults"),
        // which added the sink and did not update this census — the same
        // worklet-control hardening #2151/#2152/#2153 applied to Bacteria,
        // Crust and Gluten, whose nodes sit directly above at the identical
        // count of 3 for the identical identifier.
        //
        // Same family and same semantics as those three siblings.
        // `compileRuntimeDeviceControl` is a pure validator: its only import is
        // the `RuntimeDeviceControlCompilation` type, and it returns either
        // `{ status: 'invalid', reason }` or a frozen control envelope. It
        // touches no store, no Automerge document, and no `executeAppAction`
        // path, so this row is the hydration-shaped compile step in front of a
        // MessagePort post — `node.port.postMessage(compilation.control)` — and
        // not a project-truth write. Proof's persistence continues to run
        // through `proofParamBridge`, which is censused separately under
        // 'persistence-runtime' and guard-listed below.
        'src/modules/AudioEngine/engine/ProofNode.ts': 3,
        'src/modules/AudioEngine/repositories/createWebAudioEngine.ts': 4,
        'src/modules/AudioEngine/services/compileRuntimeDeviceControl.ts': 1,
        'src/modules/AudioEngine/services/compileRuntimeGraphDelta.ts': 20,
        'src/modules/AudioEngine/services/compileRuntimeGrinderNeuralPatch.ts': 3,
        'src/modules/AudioEngine/useCases/compileRuntimeGraphDelta.ts': 2,
        // UI: compileLoadPresetActions / compileReorderDevicesAction /
        // compileToasterTrackStackActions in browser, mixer, and inspector.
        // They compile then dispatch; they do not name loadInstrument. Device
        // adds compile inside `executeAddDeviceAction` (censused above), so
        // add-device UI no longer names a compiler.
        // Count provenance: was 4, measured 2 — the compileAddDeviceAction
        // import and call moved into the dispatch door (#2980); the
        // compileLoadPresetActions import + call remain.
        'src/modules/ContentBrowser/presentations/views/Sidebar/EffectsTab.tsx': 2,
        'src/modules/ContentBrowser/presentations/views/Sidebar/InstrumentsTab.tsx': 4,
        // Count provenance: 0 in code, was 2 — addDeviceThroughAction now
        // delegates to `executeAddDeviceAction`; no compiler named.
        // 'src/modules/ContentBrowser/presentations/views/Sidebar/effectsTabHelpers.tsx': removed (0),
        'src/modules/MixerConsole/presentations/views/Mixer/DeviceChainSection.tsx': 2,
        // Count provenance: 0 in code, was 2 — the Enable Pitch Editor button
        // now dispatches through `executeAddDeviceAction`; no compiler named.
        // 'src/modules/TimelineEditor/presentations/views/ClipView/KneadEditor.tsx': removed (0),
        'src/modules/TimelineEditor/presentations/views/Inspector/TrackDevicesSection.tsx': 2,
        'src/modules/Toaster/useCases/compileToasterTrackStackActions.ts': 3,
        'src/modules/Toaster/useCases/index.ts': 2,
    },
};

const DEVICE_DATA_COUNTS = {
    executable: {
        // Guarded clip-state restoration rebuilds the stored device chain inside
        // the registered action transaction.
        'src/modules/Arrangement/handlers/clip/handleRestoreTrackClipStates.ts': 3,
        // Count provenance: measured 1 — `devices:` on the after-track snapshot
        // the Arrangement handler commits through executeAppAction. Project
        // writer is `writeDeviceToProject`; this is the handler's topology
        // result, not a foreign store write.
        'src/modules/Arrangement/handlers/device/handleAddDevice.ts': 1,
        // Count provenance: measured 1 — `devices:` on the after-track snapshot
        // for the registered load-external-plugin handler.
        'src/modules/Arrangement/handlers/device/handleLoadExternalPlugin.ts': 1,
        // Count provenance: measured 10 — lexical `devices:` / `parameterValues:`
        // in payload types, Device reconstruction, and replacement topology.
        // Writes go through the registered loadPreset handler after
        // executeAppAction, not a raw store write from a foreign module.
        'src/modules/Arrangement/handlers/preset/handleLoadPreset.ts': 10,
        'src/modules/Arrangement/handlers/preset/handleSavePreset.ts': 2,
        // Count provenance: was 1 in `static`, measured 2 — the row moves buckets
        // rather than just incrementing. #2347 rewrote the template validator's
        // `parameterValues,` shorthand — which this census's `\s*:` pattern
        // cannot see — into
        // `parameterValues: migrateStoredDeviceParameterValues(value.type, …)`,
        // so the file now holds one executable device-data construction
        // alongside the pre-existing static `const devices: Device[] = [];`
        // accumulator. A path may carry only one classification, and recording a
        // runtime construction under `static` would understate it, so it sits
        // here with its twin `hydrateArrangementTracks.ts`.
        //
        // Read direction only. This is the repository half of template load:
        // `validateStoredDevice` validates untrusted JSON off disk and returns a
        // `Device`. It reaches no store, no Automerge document, and no
        // `executeAppAction` — the migration it calls is a pure function that
        // returns its input untouched when nothing applies.
        'src/modules/Arrangement/repositories/trackTemplate/loadTrackTemplates.ts': 2,
        'src/modules/Arrangement/services/computeTrackHash.ts': 1,
        'src/modules/Arrangement/services/createTrackFreezeSourceSignature.ts': 2,
        // The explicit parameter map and shorthand returned device chain are both
        // part of the owning store write.
        'src/modules/Arrangement/stores/persistDeviceParam.ts': 2,
        'src/modules/Arrangement/stores/resolveEligibleDeviceWriteTarget.ts': 1,
        'src/modules/Arrangement/stores/trackStore.ts': 2,
        // Snapshot capture reads serializable device topology for a later command.
        'src/modules/Arrangement/useCases/captureTrackClipStates.ts': 1,
        'src/modules/Arrangement/useCases/device/addDevice.ts': 2,
        'src/modules/Arrangement/useCases/device/addExternalDevice.ts': 2,
        'src/modules/Arrangement/useCases/device/addMidiFx.ts': 1,
        'src/modules/Arrangement/useCases/device/bypassDevice.ts': 1,
        // Count provenance: measured 2 — `devices:` on the after-track snapshot
        // and on the live-strip projection. `removeDevice.ts` no longer exists;
        // prepareRemoveDevice is the Arrangement-owned compiler for the
        // registered remove handler.
        'src/modules/Arrangement/useCases/device/prepareRemoveDevice.ts': 2,
        // Count provenance: new file entry, measured 1 — the shorthand
        // `devices` on the updater's returned track, counted by the AST half
        // (no lexical `devices:` match). #2942 narrowed the reorder write to
        // `{ ...current, devices }`; the handler-private project write behind
        // the registered reorderDevices action.
        'src/modules/Arrangement/useCases/device/reorderDevices.ts': 1,
        // Device reconstruction and the shorthand chain replacement are the
        // registered restore action's complete project write.
        'src/modules/Arrangement/useCases/device/restoreDevice.ts': 2,
        // Each parameter mutation returns its updated shorthand map alongside the
        // explicit device-chain replacement.
        'src/modules/Arrangement/useCases/device/setDeviceParameter/persistDevicePatch.ts': 2,
        'src/modules/Arrangement/useCases/device/setDeviceParameter/setDeviceParameter.ts': 2,
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
        // Count provenance: measured 3 — `devices:` in the LoadPresetAction
        // payload type, the action constructor, and a placeholder topology
        // snapshot. Compiler only; the handler commits.
        'src/modules/Arrangement/useCases/preset/compileLoadPresetActions.ts': 3,
        'src/modules/Arrangement/useCases/preset/presetStorage/saveCurrentAsPreset.ts': 3,
        'src/modules/Arrangement/useCases/preset/presetStorage/saveUserPreset.ts': 2,
        'src/modules/Arrangement/useCases/saveTrackAsTemplate.ts': 1,
        // Count provenance: measured 2 — type field plus a read-only Yeast-stripped
        // projection for the runtime graph. No store write.
        'src/modules/Arrangement/useCases/runtimeGraphTopology.ts': 2,
        'src/modules/Project/stores/arrangementStore.ts': 3,
        'src/modules/Project/useCases/demoProjects/demoUtils/applyPreset.ts': 4,
        // Count provenance: measured 7 in code — the `parameterValues:` patch
        // literals. A header-comment mention of `devices: []` on the child MIDI
        // tracks no longer counts.
        'src/modules/Project/useCases/demoProjects/nebulaDrift/createNebulaDriftDemo.ts': 7,
        // Immutable agent-facing project projection; it performs no write.
        'src/modules/Project/useCases/getAgentProjectModelContract.ts': 1,
        'src/modules/Project/useCases/projectPersistence/fileIO/hydrateArrangementTracks.ts': 1,
        'src/modules/Project/useCases/projectPersistence/helpers/migrateLegacyVcaGroups.ts': 1,
        'src/modules/Project/useCases/projectTemplates/templateHelpers/addDeviceChain.ts': 1,
        'src/modules/Project/useCases/projectTemplates/templateHelpers/attachSidechainCompressor.ts': 1,
        'src/modules/Project/useCases/projectTemplates/templateHelpers/buildDevice.ts': 1,
        'src/modules/Project/useCases/projectTemplates/templateHelpers/createBus.ts': 1,
    },
    static: {
        'src/modules/Arrangement/models/SoundPreset.ts': 2,
        // Count provenance: new file entry from #2347 ("migrate stored device
        // parameters before preset load"), measured 1 — the `parameterValues:
        // Record<string, number>` parameter type on
        // `migrateStoredDeviceParameterValues`. Type-only device-data shape, the
        // same class as `trackEligibility.ts` below: a static declaration, not
        // an executable access. The module imports nothing, holds no store or
        // CRDT write, and returns its input untouched when no migration applies.
        'src/modules/Arrangement/models/StoredDeviceParameterMigration.ts': 1,
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
        // Count provenance: measured 1 — parameter type `devices:` on a catalog
        // equality predicate. No write.
        'src/modules/Arrangement/useCases/preset/matchesMaterializedPresetDevices.ts': 1,
        // Count provenance: measured 1 — parameter type `devices:` on the
        // compensation-omit helper (#3047). Read-only input; no store write.
        'src/modules/Arrangement/useCases/freezeBounce/freezeCompensationOmitTypes.ts': 1,
        // Count provenance: measured 10 — factory sidebar preset literals
        // (`devices:` + empty `parameterValues:` per instrument). Catalog data,
        // same class as factoryPresets.ts.
        'src/modules/Arrangement/useCases/preset/sidebarInstrumentPresets.ts': 10,
        // Type-only device-data shape: LiveStripTrack declares `devices` so
        // shouldCreateLiveTrackStrip can read device types for folder-strip
        // eligibility (#584) — a static declaration, not an executable access.
        'src/modules/Arrangement/stores/trackEligibility.ts': 1,
        'src/modules/Project/models/AgentProjectModelContract.ts': 1,
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

// Raw-source tokens for every census the closure runs: sink regex families,
// device-data property names and AST entry points, and the executable guard.
// Files whose raw text contains none of these cannot contribute a match, so
// they skip code preparation entirely. Comment-free censused files use raw
// source as code and skip stripping. Sources with comment introducers still
// require a scan so comment text is stripped before counting.
const CENSUS_TOKENS = [
    'persistDeviceParam',
    'persistDevicePatch',
    'updateDeviceParam',
    'updateDevicePatch',
    'addDeviceToStrip',
    'setParam',
    'setPadParam',
    'loadToasterKitPreset',
    'loadSamplesForInstrument',
    'loadInstrument',
    'audioDevice.loaded',
    'compile',
    'PatchWithAudio',
    'Immediate',
    'devices',
    'parameterValues',
    'updateTrack',
    'trackStore',
    'resolveEligibleDeviceWriteTarget',
] as const;

function rawSourceContainsCensusToken(source: string): boolean {
    for (const token of CENSUS_TOKENS) {
        if (source.includes(token)) {
            return true;
        }
    }
    return false;
}

function rawSourceContainsCommentIntroducer(source: string): boolean {
    return source.includes('//') || source.includes('/*');
}

// Scanner comment removal, not a parse+print and not a regex stripper: censused
// sources carry comment-like text inside string literals (`'audio/*,.wav'`
// accept filters) and regex bodies (`/a\/*b/`). The TypeScript scanner keeps
// those intact while skipping comment trivia, provided a `/` in regex position
// is re-scanned as one token — otherwise `/*` or `//` inside the body is trivia.
const commentScanner = createScanner(ScriptTarget.Latest, false);

function isIgnorableTrivia(kind: SyntaxKind): boolean {
    return (
        kind === SyntaxKind.WhitespaceTrivia ||
        kind === SyntaxKind.NewLineTrivia ||
        kind === SyntaxKind.ShebangTrivia ||
        kind === SyntaxKind.ConflictMarkerTrivia ||
        kind === SyntaxKind.NonTextFileMarkerTrivia
    );
}

type BraceContext = 'expression' | 'statement';

// `/` after `}` is regex only when that brace closed a statement block.
// Object literals (and nested objects) close expressions, so the same `/` is
// division — putting CloseBraceToken on the always-division list would turn
// `} /re/` into division.
function contextOpenedByBrace(previousKind: SyntaxKind | undefined, enclosing: BraceContext | undefined): BraceContext {
    switch (previousKind) {
        case SyntaxKind.EqualsToken:
        case SyntaxKind.OpenParenToken:
        case SyntaxKind.OpenBracketToken:
        case SyntaxKind.CommaToken:
        case SyntaxKind.ColonToken:
            return 'expression';
        case SyntaxKind.OpenBraceToken:
            return enclosing ?? 'statement';
        default:
            return 'statement';
    }
}

function slashStartsRegularExpression(
    previousKind: SyntaxKind | undefined,
    lastCloseBraceContext: BraceContext | undefined
): boolean {
    if (previousKind === undefined) {
        return true;
    }
    if (previousKind === SyntaxKind.CloseBraceToken) {
        return lastCloseBraceContext !== 'expression';
    }
    switch (previousKind) {
        case SyntaxKind.Identifier:
        case SyntaxKind.PrivateIdentifier:
        case SyntaxKind.StringLiteral:
        case SyntaxKind.NumericLiteral:
        case SyntaxKind.BigIntLiteral:
        case SyntaxKind.RegularExpressionLiteral:
        case SyntaxKind.ThisKeyword:
        case SyntaxKind.TrueKeyword:
        case SyntaxKind.FalseKeyword:
        case SyntaxKind.NullKeyword:
        case SyntaxKind.SuperKeyword:
        case SyntaxKind.CloseParenToken:
        case SyntaxKind.CloseBracketToken:
        case SyntaxKind.GreaterThanToken:
        case SyntaxKind.PlusPlusToken:
        case SyntaxKind.MinusMinusToken:
        case SyntaxKind.NoSubstitutionTemplateLiteral:
        case SyntaxKind.TemplateTail:
            return false;
        default:
            return true;
    }
}

function stripComments(path: string, source: string): string {
    if (path.endsWith('.tsx')) {
        const sourceFile = createSourceFile(path, source, ScriptTarget.Latest, false, ScriptKind.TSX);
        return createPrinter({ removeComments: true }).printFile(sourceFile);
    }

    commentScanner.setLanguageVariant(LanguageVariant.Standard);
    commentScanner.setScriptKind(ScriptKind.TS);
    commentScanner.setText(source);

    const parts: string[] = [];
    const templates: Array<{ braceDepth: number }> = [];
    const braces: BraceContext[] = [];
    let copyFrom = 0;
    let previousKind: SyntaxKind | undefined;
    let lastCloseBraceContext: BraceContext | undefined;

    try {
        while (true) {
            let kind = commentScanner.scan();
            if (kind === SyntaxKind.EndOfFileToken) {
                parts.push(source.slice(copyFrom));
                break;
            }

            if (
                (kind === SyntaxKind.SlashToken || kind === SyntaxKind.SlashEqualsToken) &&
                slashStartsRegularExpression(previousKind, lastCloseBraceContext)
            ) {
                kind = commentScanner.reScanSlashToken();
            }

            if (kind === SyntaxKind.SingleLineCommentTrivia || kind === SyntaxKind.MultiLineCommentTrivia) {
                parts.push(source.slice(copyFrom, commentScanner.getTokenStart()));
                copyFrom = commentScanner.getTokenEnd();
                continue;
            }

            if (!isIgnorableTrivia(kind)) {
                if (kind === SyntaxKind.OpenBraceToken) {
                    braces.push(contextOpenedByBrace(previousKind, braces.at(-1)));
                } else if (kind === SyntaxKind.CloseBraceToken) {
                    const template = templates.at(-1);
                    const closesInterpolation = template !== undefined && template.braceDepth === 0;
                    if (!closesInterpolation) {
                        lastCloseBraceContext = braces.pop() ?? 'statement';
                    }
                }
                previousKind = kind;
            }

            if (kind === SyntaxKind.TemplateHead) {
                templates.push({ braceDepth: 0 });
                continue;
            }

            const template = templates.at(-1);
            if (template === undefined) {
                continue;
            }

            if (kind === SyntaxKind.OpenBraceToken) {
                template.braceDepth += 1;
                continue;
            }
            if (kind !== SyntaxKind.CloseBraceToken) {
                continue;
            }
            if (template.braceDepth > 0) {
                template.braceDepth -= 1;
                continue;
            }

            kind = commentScanner.reScanTemplateToken(false);
            previousKind = kind;
            if (kind === SyntaxKind.TemplateTail) {
                templates.pop();
            }
        }

        return parts.join('');
    } finally {
        commentScanner.setText(undefined);
    }
}

function productionSource(path: string, source: string): ProductionSource {
    let code = '';
    if (rawSourceContainsCensusToken(source)) {
        code = rawSourceContainsCommentIntroducer(source) ? stripComments(path, source) : source;
    }
    return {
        path,
        source,
        code,
    };
}

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
            files.push(productionSource(relative(root, absolutePath), readFileSync(absolutePath, 'utf8')));
        }
    }
    visit(join(root, 'src'));
    return files;
}

/**
 * One sweep of `src/`, shared by every case below. Walking the tree and
 * stripping comments still costs real time; doing it once per case put every
 * case in this file over its timeout. The working tree cannot change mid-run,
 * so one sweep is the same evidence as fourteen, and each case still composes
 * its own synthetic file onto a copy.
 */
const productionSourcesByRoot = new Map<string, ProductionSource[]>();

function readProductionSources(root: string): ProductionSource[] {
    const cached = productionSourcesByRoot.get(root);
    if (cached) {
        return cached;
    }
    const files = productionSources(root);
    productionSourcesByRoot.set(root, files);
    return files;
}

function countByPath(files: ReadonlyArray<ProductionSource>, definition: SinkDefinition): Record<string, number> {
    const result: Record<string, number> = {};
    for (const file of files) {
        if (!definition.includes(file.path)) {
            continue;
        }
        const matches = file.code.match(definition.pattern);
        if (matches && matches.length > 0) {
            result[file.path] = matches.length;
        }
    }
    return result;
}

const DEVICE_DATA_PROPERTIES = new Set(['devices', 'parameterValues']);

type LocalUpdater = ArrowFunction | FunctionDeclaration | FunctionExpression;
type LocalBinding =
    | { readonly kind: 'expression'; readonly expression: Expression }
    | { readonly kind: 'parameter' }
    | { readonly kind: 'unclassifiable' }
    | { readonly kind: 'updater'; readonly updater: LocalUpdater };
type LexicalScope = {
    readonly parent: LexicalScope | null;
    readonly bindings: Map<string, LocalBinding>;
};

function addLocalBinding(scope: LexicalScope, name: string, binding: LocalBinding): void {
    scope.bindings.set(name, scope.bindings.has(name) ? { kind: 'unclassifiable' } : binding);
}

function isConstVariableDeclaration(node: Node): boolean {
    return (
        isVariableDeclaration(node) &&
        isVariableDeclarationList(node.parent) &&
        (node.parent.flags & NodeFlags.Const) > 0
    );
}

function indexLocalUpdaters(sourceFile: Node): ReadonlyMap<Node, LexicalScope> {
    const scopeByNode = new Map<Node, LexicalScope>();
    const rootScope: LexicalScope = { parent: null, bindings: new Map() };
    const visit = (node: Node, scope: LexicalScope): void => {
        scopeByNode.set(node, scope);
        if (isFunctionDeclaration(node) && node.name) {
            addLocalBinding(scope, node.name.text, { kind: 'updater', updater: node });
        }
        if (isVariableDeclaration(node) && isIdentifier(node.name)) {
            const initializer = node.initializer;
            const updater =
                initializer && (isArrowFunction(initializer) || isFunctionExpression(initializer)) ? initializer : null;
            if (updater) {
                addLocalBinding(scope, node.name.text, { kind: 'updater', updater });
            } else if (initializer && isConstVariableDeclaration(node)) {
                addLocalBinding(scope, node.name.text, { kind: 'expression', expression: initializer });
            } else {
                addLocalBinding(scope, node.name.text, { kind: 'unclassifiable' });
            }
        }

        let childScope = scope;
        if (isArrowFunction(node) || isFunctionExpression(node) || isFunctionDeclaration(node)) {
            childScope = { parent: scope, bindings: new Map() };
            for (const parameter of node.parameters) {
                if (isIdentifier(parameter.name)) {
                    addLocalBinding(childScope, parameter.name.text, { kind: 'parameter' });
                }
            }
        } else if (isBlock(node)) {
            childScope = { parent: scope, bindings: new Map() };
        }
        forEachChild(node, (child) => visit(child, childScope));
    };
    visit(sourceFile, rootScope);
    return scopeByNode;
}

function resolveLocalBinding(name: string, scope: LexicalScope | undefined): LocalBinding | undefined {
    for (let current: LexicalScope | null | undefined = scope; current; current = current.parent) {
        const binding = current.bindings.get(name);
        if (binding) {
            return binding;
        }
    }
    return undefined;
}

function resolveLocalUpdater(name: string, scope: LexicalScope | undefined): LocalUpdater | null {
    const binding = resolveLocalBinding(name, scope);
    return binding?.kind === 'updater' ? binding.updater : null;
}

function isUpdateTrackCall(node: Node): node is CallExpression {
    return isCallExpression(node) && isIdentifier(node.expression) && node.expression.text === 'updateTrack';
}

function isTrackStoreSetCall(node: Node): node is CallExpression {
    return (
        isCallExpression(node) &&
        isPropertyAccessExpression(node.expression) &&
        isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'trackStore' &&
        node.expression.name.text === 'set'
    );
}

function unwrapStateExpression(expression: Expression): Expression {
    if (
        isParenthesizedExpression(expression) ||
        isAsExpression(expression) ||
        isSatisfiesExpression(expression) ||
        isNonNullExpression(expression)
    ) {
        return unwrapStateExpression(expression.expression);
    }
    return expression;
}

function returnedStateExpressions(updater: LocalUpdater): Expression[] {
    const body = updater.body;
    if (!body) {
        return [];
    }
    if (!isBlock(body)) {
        return [body];
    }

    const expressions: Expression[] = [];
    const visit = (node: Node): void => {
        if (node !== body && (isArrowFunction(node) || isFunctionExpression(node) || isFunctionDeclaration(node))) {
            return;
        }
        if (isReturnStatement(node)) {
            if (node.expression) {
                expressions.push(node.expression);
            }
            return;
        }
        forEachChild(node, visit);
    };
    visit(body);
    return expressions;
}

function countDeviceDataAstWrites(file: SourceText): number {
    const sourceFile = createSourceFile(
        file.path,
        file.source,
        ScriptTarget.Latest,
        true,
        file.path.endsWith('.tsx') ? ScriptKind.TSX : ScriptKind.TS
    );
    const scopeByNode = indexLocalUpdaters(sourceFile);
    const writes = new Set<Node>();
    const visiting = new Set<Expression>();
    const seen = new Set<Expression>();

    // Bindings stand for a returned state expression, not nested data: resolving a
    // device variable inside that state would double-count its construction.
    // A returned identifier may pass as "no change" only when it resolves to a
    // proven binding; a missing binding means the state shape is unsupported and
    // must reject the audit rather than silently clear the census.
    const collectStateExpression = (candidate: Expression, resolveBinding = true): void => {
        const expression = unwrapStateExpression(candidate);
        if (visiting.has(expression)) {
            throw new Error('cyclic local state binding');
        }
        if (seen.has(expression)) {
            return;
        }
        visiting.add(expression);
        try {
            if (isObjectLiteralExpression(expression)) {
                for (const property of expression.properties) {
                    if (isShorthandPropertyAssignment(property) && DEVICE_DATA_PROPERTIES.has(property.name.text)) {
                        writes.add(property);
                        continue;
                    }
                    if (!isPropertyAssignment(property)) {
                        continue;
                    }
                    if (
                        isComputedPropertyName(property.name) &&
                        isStringLiteral(property.name.expression) &&
                        DEVICE_DATA_PROPERTIES.has(property.name.expression.text)
                    ) {
                        writes.add(property);
                    }
                    collectStateExpression(property.initializer, false);
                }
                return;
            }
            if (isArrayLiteralExpression(expression)) {
                for (const element of expression.elements) {
                    collectStateExpression(element, false);
                }
                return;
            }
            if (isConditionalExpression(expression)) {
                collectStateExpression(expression.whenTrue);
                collectStateExpression(expression.whenFalse);
                return;
            }
            if (resolveBinding && isIdentifier(expression)) {
                const binding = resolveLocalBinding(expression.text, scopeByNode.get(expression));
                if (!binding) {
                    throw new Error(`unresolved local state binding: ${expression.text}`);
                }
                if (binding.kind === 'parameter') {
                    return;
                }
                if (binding.kind !== 'expression') {
                    throw new Error(`unclassifiable local state binding: ${expression.text}`);
                }
                collectStateExpression(binding.expression);
                return;
            }
            if (isCallExpression(expression)) {
                for (const argument of expression.arguments) {
                    if (isArrowFunction(argument) || isFunctionExpression(argument)) {
                        for (const returned of returnedStateExpressions(argument)) {
                            collectStateExpression(returned);
                        }
                    }
                }
            }
        } finally {
            visiting.delete(expression);
            seen.add(expression);
        }
    };

    const collectUpdater = (updater: LocalUpdater): void => {
        for (const expression of returnedStateExpressions(updater)) {
            collectStateExpression(expression);
        }
    };

    const visit = (node: Node): void => {
        if (isUpdateTrackCall(node)) {
            const updaterArgument = node.arguments[1];
            if (updaterArgument && (isArrowFunction(updaterArgument) || isFunctionExpression(updaterArgument))) {
                collectUpdater(updaterArgument);
            } else if (updaterArgument && isIdentifier(updaterArgument)) {
                const updater = resolveLocalUpdater(updaterArgument.text, scopeByNode.get(node));
                if (updater) {
                    collectUpdater(updater);
                }
            }
        } else if (isTrackStoreSetCall(node)) {
            const stateArgument = node.arguments[0];
            if (stateArgument) {
                collectStateExpression(stateArgument);
            }
        }
        forEachChild(node, visit);
    };
    visit(sourceFile);
    return writes.size;
}

// AST census walks updateTrack and trackStore.set; property-syntax
// devices:/parameterValues: hits are regex-owned and must not parse here.
function codeMayContainDeviceDataAstWrites(code: string): boolean {
    if (code.length === 0) {
        return false;
    }
    return code.includes('updateTrack') || code.includes('trackStore');
}

function countDeviceDataByPath(files: ReadonlyArray<ProductionSource>): CountByPath {
    const result = countByPath(files, {
        pattern: /\b(?:parameterValues|devices)\s*:/g,
        includes: includeAllPaths,
    });
    for (const file of files) {
        if (!codeMayContainDeviceDataAstWrites(file.code)) {
            continue;
        }
        const astWrites = countDeviceDataAstWrites(file);
        if (astWrites > 0) {
            result[file.path] = (result[file.path] ?? 0) + astWrites;
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
    assertCounts('device-data', countDeviceDataByPath(projectDataFiles), classifiedDeviceDataCounts());

    // The guard must appear in code: a doc-comment mention names the guard, it
    // does not apply it.
    const codeByPath = new Map(files.map((file) => [file.path, file.code]));
    for (const path of GUARDED_EXECUTABLE_PATHS) {
        const code = codeByPath.get(path);
        if (!code?.includes('resolveEligibleDeviceWriteTarget')) {
            throw new Error(`guard missing from executable path: ${path}`);
        }
    }
}

describe('device write boundary closure', () => {
    let productionFiles: ProductionSource[];

    beforeAll(() => {
        productionFiles = readProductionSources(process.cwd());
    });

    it('classifies every production sink by family, path, and exact count', () => {
        expect(() => assertProductionClosure(productionFiles)).not.toThrow();
    });

    it('skips comment stripping when raw source has no census tokens', () => {
        const skipped = productionSource('src/modules/Arrangement/tokenless.ts', 'export const value = 1;');
        expect(skipped.code).toBe('');
        const sinkCounts = countByPath([skipped], SINK_DEFINITIONS['persistence-runtime']);
        expect(sinkCounts['src/modules/Arrangement/tokenless.ts']).toBeUndefined();
        const deviceDataCounts = countDeviceDataByPath([skipped]);
        expect(deviceDataCounts['src/modules/Arrangement/tokenless.ts']).toBeUndefined();
    });

    it('uses raw source as code when a census token appears without comment introducers', () => {
        const source = 'const devices: string[] = [];\nexport const count = devices.length;';
        const parsed = productionSource('src/modules/Arrangement/tokenNoComments.ts', source);
        expect(parsed.code).toBe(source);
        const counts = countDeviceDataByPath([parsed]);
        expect(counts['src/modules/Arrangement/tokenNoComments.ts']).toBe(1);
    });

    it('still strips comments when a census token appears only in a comment', () => {
        const parsed = productionSource(
            'src/modules/Arrangement/commentToken.ts',
            '// persistDeviceParam is documented here\nexport const value = 1;'
        );
        expect(parsed.code).not.toContain('persistDeviceParam');
        expect(parsed.code).toContain('export const value = 1;');
        const counts = countByPath([parsed], SINK_DEFINITIONS['persistence-runtime']);
        expect(counts['src/modules/Arrangement/commentToken.ts']).toBeUndefined();
    });

    it('does not count device-data properties quoted in comments', () => {
        const counts = countDeviceDataByPath([
            productionSource(
                'src/modules/Arrangement/proseDeviceData.ts',
                [
                    '// devices: [] was the chain this handler replaced',
                    '/* parameterValues: { gain: 1 } is rebuilt by the owner */',
                    'export const unchanged = true;',
                ].join('\n')
            ),
        ]);
        expect(counts['src/modules/Arrangement/proseDeviceData.ts']).toBeUndefined();
    });

    it('does not count sink identifiers quoted in comments', () => {
        const counts = countByPath(
            [
                productionSource(
                    'src/modules/Arrangement/proseSink.ts',
                    '// persistDeviceParam owns project truth; updateDeviceParam reaches the engine.'
                ),
            ],
            SINK_DEFINITIONS['persistence-runtime']
        );
        expect(counts['src/modules/Arrangement/proseSink.ts']).toBeUndefined();
    });

    it('does not treat comment-like text inside string literals as comments', () => {
        const parsed = productionSource(
            'src/modules/Arrangement/stringLiteralCommentText.ts',
            [
                'const accept = "audio/*,.wav,.flac";',
                'const docs = "https://sourdaw.dev/panels";',
                'const devices: string[] = [];',
            ].join('\n')
        );
        expect(parsed.code).toContain('"audio/*,.wav,.flac"');
        expect(parsed.code).toContain('"https://sourdaw.dev/panels"');
        const counts = countDeviceDataByPath([parsed]);
        expect(counts['src/modules/Arrangement/stringLiteralCommentText.ts']).toBe(1);
    });

    it('does not treat regex-literal bodies as comments', () => {
        const nestedBlock = productionSource(
            'src/modules/Arrangement/regexComment.ts',
            'const re = /a\\/*b/;\nexport const x = persistDeviceParam;\n'
        );
        expect(nestedBlock.code).toContain('persistDeviceParam');
        expect(
            countByPath([nestedBlock], SINK_DEFINITIONS['persistence-runtime'])[
                'src/modules/Arrangement/regexComment.ts'
            ]
        ).toBe(1);

        const escapedSlashes = productionSource(
            'src/modules/Arrangement/regexLineComment.ts',
            'const re = /\\/\\//; const x = persistDeviceParam;'
        );
        expect(escapedSlashes.code).toContain('persistDeviceParam');
        expect(
            countByPath([escapedSlashes], SINK_DEFINITIONS['persistence-runtime'])[
                'src/modules/Arrangement/regexLineComment.ts'
            ]
        ).toBe(1);

        const afterDivision = productionSource(
            'src/modules/Arrangement/divisionLineComment.ts',
            'const x = a / b; // persistDeviceParam'
        );
        expect(afterDivision.code).not.toContain('persistDeviceParam');
        expect(
            countByPath([afterDivision], SINK_DEFINITIONS['persistence-runtime'])[
                'src/modules/Arrangement/divisionLineComment.ts'
            ]
        ).toBeUndefined();

        const genericDiv = productionSource(
            'src/modules/Arrangement/genericDiv.ts',
            'const x = Array<number>/2; // persistDeviceParam\nexport const y = persistDeviceParam;\n'
        );
        expect(genericDiv.code).not.toContain('// persistDeviceParam');
        expect(genericDiv.code).toContain('export const y = persistDeviceParam;');
        expect(
            countByPath([genericDiv], SINK_DEFINITIONS['persistence-runtime'])['src/modules/Arrangement/genericDiv.ts']
        ).toBe(1);

        const genericDivSpaced = productionSource(
            'src/modules/Arrangement/genericDivSpaced.ts',
            'const x = Array<number> / 2; // persistDeviceParam\nexport const y = persistDeviceParam;\n'
        );
        expect(genericDivSpaced.code).not.toContain('// persistDeviceParam');
        expect(genericDivSpaced.code).toContain('export const y = persistDeviceParam;');
        expect(
            countByPath([genericDivSpaced], SINK_DEFINITIONS['persistence-runtime'])[
                'src/modules/Arrangement/genericDivSpaced.ts'
            ]
        ).toBe(1);

        const braceRegex = productionSource(
            'src/modules/Arrangement/braceRegex.ts',
            'if (x) { return 1; } /a\\/*b/; export const z = persistDeviceParam;\n'
        );
        expect(braceRegex.code).toContain('/a\\/*b/');
        expect(braceRegex.code).toContain('persistDeviceParam');
        expect(
            countByPath([braceRegex], SINK_DEFINITIONS['persistence-runtime'])['src/modules/Arrangement/braceRegex.ts']
        ).toBe(1);

        const objectLiteralDiv = productionSource(
            'src/modules/Arrangement/objectLiteralDiv.ts',
            'const x = { n: 1 }/2; // persistDeviceParam\nexport const y = persistDeviceParam;\n'
        );
        expect(objectLiteralDiv.code).not.toContain('// persistDeviceParam');
        expect(objectLiteralDiv.code).toContain('export const y = persistDeviceParam;');
        expect(
            countByPath([objectLiteralDiv], SINK_DEFINITIONS['persistence-runtime'])[
                'src/modules/Arrangement/objectLiteralDiv.ts'
            ]
        ).toBe(1);

        const objectLiteralDivSpaced = productionSource(
            'src/modules/Arrangement/objectLiteralDivSpaced.ts',
            'const x = { n: 1 } / 2; // persistDeviceParam\nexport const y = persistDeviceParam;\n'
        );
        expect(objectLiteralDivSpaced.code).not.toContain('// persistDeviceParam');
        expect(objectLiteralDivSpaced.code).toContain('export const y = persistDeviceParam;');
        expect(
            countByPath([objectLiteralDivSpaced], SINK_DEFINITIONS['persistence-runtime'])[
                'src/modules/Arrangement/objectLiteralDivSpaced.ts'
            ]
        ).toBe(1);
    });

    it('does not treat http:// in JSX text as a line comment', () => {
        const parsed = productionSource(
            'src/modules/Arrangement/jsxHttpText.tsx',
            'export const C = () => <div>http://x.com</div>; const x = persistDeviceParam;\n'
        );
        expect(parsed.code).toContain('persistDeviceParam');
        const counts = countByPath([parsed], SINK_DEFINITIONS['persistence-runtime']);
        expect(counts['src/modules/Arrangement/jsxHttpText.tsx']).toBe(1);
    });

    it('still counts code occurrences after comment stripping', () => {
        const deviceData = countDeviceDataByPath([
            productionSource(
                'src/modules/Arrangement/codeDeviceData.ts',
                'const before = { devices: [], parameterValues: {} }; // devices: [] replaced'
            ),
        ]);
        expect(deviceData['src/modules/Arrangement/codeDeviceData.ts']).toBe(2);
        const sinks = countByPath(
            [
                productionSource(
                    'src/modules/Arrangement/codeSink.ts',
                    'updateDeviceParam("track", "device", "gain", 1); // updateDeviceParam again'
                ),
            ],
            SINK_DEFINITIONS['persistence-runtime']
        );
        expect(sinks['src/modules/Arrangement/codeSink.ts']).toBe(1);
    });

    it('does not classify read-only destructuring or projection as a shorthand write', () => {
        expect(
            countDeviceDataAstWrites({
                path: 'src/modules/Arrangement/readDeviceData.ts',
                source: 'const { devices, parameterValues } = track; const snapshot = { devices, parameterValues };',
            })
        ).toBe(0);
    });

    it('does not classify a discarded projection inside an updater as a device-data write', () => {
        expect(
            countDeviceDataAstWrites({
                path: 'src/modules/Arrangement/discardedDeviceProjection.ts',
                source: 'const devices = []; const parameterValues = {}; updateTrack("track", (current) => { const snapshot = { devices, parameterValues }; void snapshot; return current; });',
            })
        ).toBe(0);
    });

    it('does not classify a discarded projection inside trackStore.set as a device-data write', () => {
        expect(
            countDeviceDataAstWrites({
                path: 'src/modules/Arrangement/discardedSetProjection.ts',
                source: 'trackStore.set({ ...state, tracks: state.tracks.map((track) => { const devices = track.devices; const parameterValues = devices[0]?.parameterValues; const snapshot = { devices, parameterValues }; void snapshot; return track; }) });',
            })
        ).toBe(0);
    });

    it('counts shorthand devices in trackStore.set when .set is split across a line break', () => {
        const source = 'const state = {}; const devices = []; trackStore.\nset({ ...state, devices });';
        const parsed = productionSource('src/modules/Arrangement/splitTrackStoreSet.ts', source);
        expect(countDeviceDataAstWrites({ path: parsed.path, source: parsed.source })).toBe(1);
        const counts = countDeviceDataByPath([parsed]);
        expect(counts['src/modules/Arrangement/splitTrackStoreSet.ts']).toBe(1);
    });

    it('resolves only the nearest local updater declaration', () => {
        expect(
            countDeviceDataAstWrites({
                path: 'src/modules/Arrangement/localUpdater.ts',
                source: 'const devices = []; function replace(current) { return { ...current, devices }; } updateTrack("track", replace);',
            })
        ).toBe(1);
        expect(
            countDeviceDataAstWrites({
                path: 'src/modules/Arrangement/shadowedUpdater.ts',
                source: 'const devices = []; const replace = (current) => ({ ...current, devices }); { const replace = (current) => ({ ...current }); updateTrack("track", replace); }',
            })
        ).toBe(0);
    });

    it('detects a local state expression returned from an updater', () => {
        expect(
            countDeviceDataAstWrites({
                path: 'src/modules/Arrangement/localStateExpression.ts',
                source: 'const devices = []; updateTrack("track", (current) => { const next = { ...current, devices }; return next; });',
            })
        ).toBe(1);
    });

    it('accepts a no-change updater return and resolves only its legitimate nearest shadow', () => {
        expect(
            countDeviceDataAstWrites({
                path: 'src/modules/Arrangement/noChangeUpdater.ts',
                source: 'updateTrack("track", (current) => current);',
            })
        ).toBe(0);
        expect(
            countDeviceDataAstWrites({
                path: 'src/modules/Arrangement/shadowedStateExpression.ts',
                source: 'const devices = []; updateTrack("track", (current) => { const next = { ...current, devices }; { const next = current; return next; } });',
            })
        ).toBe(0);
    });

    it('rejects mutable, ambiguous, or cyclic returned local state expressions', () => {
        expect(() =>
            countDeviceDataAstWrites({
                path: 'src/modules/Arrangement/mutableStateExpression.ts',
                source: 'const devices = []; updateTrack("track", (current) => { let next = { ...current, devices }; return next; });',
            })
        ).toThrow(/unclassifiable local state binding/);
        expect(() =>
            countDeviceDataAstWrites({
                path: 'src/modules/Arrangement/ambiguousStateExpression.ts',
                source: 'const devices = []; updateTrack("track", (current) => { const next = { ...current, devices }; const next = current; return next; });',
            })
        ).toThrow(/unclassifiable local state binding/);
        expect(() =>
            countDeviceDataAstWrites({
                path: 'src/modules/Arrangement/cyclicStateExpression.ts',
                source: 'const first = second; const second = first; updateTrack("track", () => first);',
            })
        ).toThrow(/cyclic local state binding/);
    });

    it('rejects a returned local whose binding cannot be resolved', () => {
        expect(() =>
            countDeviceDataAstWrites({
                path: 'src/modules/Arrangement/blockScopedStateExpression.ts',
                source: 'const devices = []; updateTrack("track", (current) => { { var next = { ...current, devices }; } return next; });',
            })
        ).toThrow(/unresolved local state binding/);
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
            source: 'const devices = []; updateTrack("track", (current) => ({ ...current, devices }));',
        },
        {
            name: 'an extracted direct devices writer',
            path: 'src/modules/Arrangement/newExtractedDeviceWriter.ts',
            source: 'const devices = []; const replace = (current) => ({ ...current, devices }); updateTrack("track", replace);',
        },
        {
            name: 'a direct trackStore.set shorthand writer',
            path: 'src/modules/Arrangement/newSetDeviceWriter.ts',
            source: 'const devices = []; trackStore.set({ ...state, devices });',
        },
        {
            name: 'a computed devices writer',
            path: 'src/modules/Arrangement/newComputedDeviceWriter.ts',
            source: 'const devices = []; updateTrack("track", (current) => ({ ...current, ["devices"]: devices }));',
        },
        {
            name: 'a direct parameterValues writer',
            path: 'src/modules/Project/newParameterWriter.ts',
            source: 'const parameterValues = {}; updateTrack("track", (current) => ({ ...current, parameterValues }));',
        },
    ])('rejects $name through the production closure assertion', ({ path, source }) => {
        const files = readProductionSources(process.cwd());
        expect(() => assertProductionClosure([...files, productionSource(path, source)])).toThrow(
            /sink census changed/
        );
    });
});
