import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { trackStore, vcaGroupStore } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import { isLinearGainAutomationLane } from '#/modules/Automation/useCases';

import {
    RUNTIME_ACTION_OVERRIDE_PAYLOAD_KEYS,
    RUNTIME_ACTION_OVERRIDE_REQUIRED_PAYLOAD_KEYS,
    RUNTIME_ACTION_TYPES,
    type RuntimeAction,
    type RuntimeActionType,
} from '../models/RuntimeAction';
import { unawaitedAiActionByActionType } from '../models/UnawaitedAiActionByActionType';

import { type BatchLocalActionIdentity } from './agentReference/BatchLocalActionIdentity';
import { PAYLOAD_VALIDATORS, type PayloadValidator } from './validateActionPayload';

const KNOWN_ACTION_TYPES: ReadonlySet<RuntimeActionType> = new Set(RUNTIME_ACTION_TYPES);

type RuntimePayloadOverrideType = keyof typeof RUNTIME_ACTION_OVERRIDE_PAYLOAD_KEYS;

function isRuntimePayloadOverrideType(actionType: RuntimeActionType): actionType is RuntimePayloadOverrideType {
    return actionType in RUNTIME_ACTION_OVERRIDE_PAYLOAD_KEYS;
}

function hasOnlyInitiatingPayloadKeys(action: RuntimeAction): boolean {
    if (!isRuntimePayloadOverrideType(action.type)) {
        return true;
    }

    const payload: unknown = action.payload;
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        return false;
    }

    const requiredKeys: readonly string[] = RUNTIME_ACTION_OVERRIDE_REQUIRED_PAYLOAD_KEYS[action.type];
    if (!requiredKeys.every((key) => Object.hasOwn(payload, key))) {
        return false;
    }

    const allowedKeys: readonly string[] = RUNTIME_ACTION_OVERRIDE_PAYLOAD_KEYS[action.type];
    return Reflect.ownKeys(payload).every((key) => typeof key === 'string' && allowedKeys.includes(key));
}

type BatchCreatedLane = { actionIndex: number; parameterId: string };

/**
 * The lanes the batch itself creates, keyed by the id the plan minted for each. The creating action
 * carries no id until identities are materialized, so the n-th lane identity names the n-th
 * `addAutomationLane` action.
 */
function indexBatchCreatedLanes(
    actions: readonly RuntimeAction[],
    identities: readonly BatchLocalActionIdentity[]
): ReadonlyMap<string, BatchCreatedLane> {
    const laneActionIndexes = actions.flatMap((action, actionIndex) =>
        action.type === 'addAutomationLane' ? [actionIndex] : []
    );
    const lanes = new Map<string, BatchCreatedLane>();
    for (const identity of identities) {
        if (identity.actionType !== 'addAutomationLane') {
            continue;
        }
        const actionIndex = laneActionIndexes[identity.actionOrdinal];
        const action = actionIndex === undefined ? undefined : actions[actionIndex];
        if (actionIndex !== undefined && action?.type === 'addAutomationLane') {
            lanes.set(identity.laneId, { actionIndex, parameterId: action.payload.parameterId });
        }
    }
    return lanes;
}

/**
 * Decibels describe a gain amplitude and nothing else. A lane holding pan
 * positions, a cutoff in hertz, or a time in milliseconds has no decibel
 * reading, and a lane whose gain is *already* stored in decibels would take the
 * conversion twice. Only the payload validator's own view is too narrow to see
 * which of those a `laneId` names, so the lane is resolved here, where the
 * stores are — or, for a lane an earlier action of the same batch creates, from
 * the parameter that action names.
 */
function addressesGainLaneForDecibels(
    action: RuntimeAction,
    actionIndex: number,
    batchCreatedLanes: ReadonlyMap<string, BatchCreatedLane>
): boolean {
    if (action.type !== 'addAutomationPoint') {
        return true;
    }
    if (action.payload.valueDb === undefined && action.payload.deltaDb === undefined) {
        return true;
    }
    const lane = automationStore.value?.lanes.find((candidate) => candidate.id === action.payload.laneId);
    if (lane !== undefined) {
        return isLinearGainAutomationLane(lane);
    }
    const createdLane = batchCreatedLanes.get(action.payload.laneId);
    return createdLane !== undefined && createdLane.actionIndex < actionIndex && createdLane.parameterId === 'gain';
}

type ActionOf<Type extends RuntimeActionType> = Extract<RuntimeAction, { type: Type }>;
type VcaTargetLookup = { readonly [Type in RuntimeActionType]: (action: ActionOf<Type>) => boolean };

function noVcaTargets(): boolean {
    return true;
}

function allTracksExist(action: ActionOf<'createVcaGroup'>): boolean {
    const tracks = trackStore.value?.tracks ?? [];
    return action.payload.trackIds.every((trackId) => tracks.some((track) => track.id === trackId));
}

function trackAndGroupExist(action: ActionOf<'assignToVca'>): boolean {
    const tracks = trackStore.value?.tracks ?? [];
    const groups = vcaGroupStore.value?.groups ?? [];
    const trackExists = tracks.some((track) => track.id === action.payload.trackId);
    const groupExists = groups.some((group) => group.id === action.payload.vcaGroupId);
    return trackExists && groupExists;
}

function trackExists(action: ActionOf<'removeFromVca'>): boolean {
    const tracks = trackStore.value?.tracks ?? [];
    return tracks.some((track) => track.id === action.payload.trackId);
}

function groupExists(action: ActionOf<'setVcaGain'>): boolean {
    const groups = vcaGroupStore.value?.groups ?? [];
    return groups.some((group) => group.id === action.payload.vcaGroupId);
}

/** Every runtime action type answers, so a new action does not compile until its VCA targets are decided. */
const vcaTargetAvailabilityByActionType: VcaTargetLookup = {
    importStemSet: noVcaTargets,
    addTrack: noVcaTargets,
    removeTrack: noVcaTargets,
    removeAllTracks: noVcaTargets,
    renameTrack: noVcaTargets,
    selectTrack: noVcaTargets,
    muteTrack: noVcaTargets,
    soloTrack: noVcaTargets,
    selectTake: noVcaTargets,
    setSoloSafe: noVcaTargets,
    toggleSoloSafe: noVcaTargets,
    armTrack: noVcaTargets,
    freezeTrack: noVcaTargets,
    unfreezeTrack: noVcaTargets,
    flattenTrack: noVcaTargets,
    bounceInPlace: noVcaTargets,
    duplicateTrack: noVcaTargets,
    reorderTrack: noVcaTargets,
    setTrackGain: noVcaTargets,
    setTrackPan: noVcaTargets,
    setTrackColor: noVcaTargets,
    setTempo: noVcaTargets,
    setTimeSignature: noVcaTargets,
    setProductionBrief: noVcaTargets,
    setPlayback: noVcaTargets,
    togglePlayback: noVcaTargets,
    stopPlayback: noVcaTargets,
    toggleRecording: noVcaTargets,
    setMasterGain: noVcaTargets,
    toggleLoop: noVcaTargets,
    toggleMetronome: noVcaTargets,
    setMetronomeVolume: noVcaTargets,
    setLoopRegion: noVcaTargets,
    setLoopEnabled: noVcaTargets,
    setMetronomeEnabled: noVcaTargets,
    restoreLoopRegion: noVcaTargets,
    addClip: noVcaTargets,
    drawClip: noVcaTargets,
    duplicateClipAt: noVcaTargets,
    moveClips: noVcaTargets,
    moveClip: noVcaTargets,
    duplicateClip: noVcaTargets,
    duplicateClipToNextBar: noVcaTargets,
    removeClip: noVcaTargets,
    splitClip: noVcaTargets,
    trimClipStart: noVcaTargets,
    trimClipEnd: noVcaTargets,
    setClipFade: noVcaTargets,
    copyClip: noVcaTargets,
    cutClip: noVcaTargets,
    pasteClip: noVcaTargets,
    addDevice: noVcaTargets,
    bypassDevice: noVcaTargets,
    removeDevice: noVcaTargets,
    setDeviceParameter: noVcaTargets,
    createBus: noVcaTargets,
    createFolder: noVcaTargets,
    setSend: noVcaTargets,
    setWorkspaceMode: noVcaTargets,
    openPreferencesDialog: noVcaTargets,
    openMixer: noVcaTargets,
    closeMixer: noVcaTargets,
    toggleSidebar: noVcaTargets,
    toggleInspector: noVcaTargets,
    toggleChatPanel: noVcaTargets,
    setEditingTool: noVcaTargets,
    setMarqueeSelection: noVcaTargets,
    addMarker: noVcaTargets,
    removeMarker: noVcaTargets,
    setMarkerColor: noVcaTargets,
    addSection: noVcaTargets,
    removeSection: noVcaTargets,
    renameSection: noVcaTargets,
    addAutomationLane: noVcaTargets,
    automateSendRange: noVcaTargets,
    automateSendRanges: noVcaTargets,
    automateTrackGainRange: noVcaTargets,
    automateParameterRange: noVcaTargets,
    renderProjectSections: noVcaTargets,
    addAutomationPoint: noVcaTargets,
    setAutomationLaneEnabled: noVcaTargets,
    quantizeNotes: noVcaTargets,
    removeShortMidiOverlaps: noVcaTargets,
    createDrumPreviewBranches: noVcaTargets,
    copyMidiArticulations: noVcaTargets,
    quantizeNoteLengths: noVcaTargets,
    transposeNotes: noVcaTargets,
    humanizeNotes: noVcaTargets,
    invertNotes: noVcaTargets,
    retrogradeNotes: noVcaTargets,
    scaleVelocities: noVcaTargets,
    scaleAllVelocities: noVcaTargets,
    setAllVelocities: noVcaTargets,
    importMidiFile: noVcaTargets,
    normalizeClip: noVcaTargets,
    reverseClip: noVcaTargets,
    glueClips: noVcaTargets,
    nudgeClip: noVcaTargets,
    slipClipContent: noVcaTargets,
    crossfadeClips: noVcaTargets,
    setClipGain: noVcaTargets,
    setClipColor: noVcaTargets,
    lockClip: noVcaTargets,
    renameClip: noVcaTargets,
    consolidateSelection: noVcaTargets,
    bounceSelection: noVcaTargets,
    seekPlayhead: noVcaTargets,
    setPunchIn: noVcaTargets,
    setPunchOut: noVcaTargets,
    setPunchEnabled: noVcaTargets,
    toggleCountIn: noVcaTargets,
    setCountInBars: noVcaTargets,
    togglePreRoll: noVcaTargets,
    setPreRollBars: noVcaTargets,
    addTimeSignatureChange: noVcaTargets,
    removeTimeSignatureChange: noVcaTargets,
    setTrackOutput: noVcaTargets,
    addSend: noVcaTargets,
    removeSend: noVcaTargets,
    removeAutomationPoint: noVcaTargets,
    setAutomationMode: noVcaTargets,
    hideTrack: noVcaTargets,
    disableTrack: noVcaTargets,
    setTrackHeight: noVcaTargets,
    setSnapValue: noVcaTargets,
    zoomToFit: noVcaTargets,
    zoomToSelection: noVcaTargets,
    exportProject: noVcaTargets,
    saveProject: noVcaTargets,
    newProject: noVcaTargets,
    importAudioFile: noVcaTargets,
    exportMidi: noVcaTargets,
    foldTrack: noVcaTargets,
    groupTracks: noVcaTargets,
    ungroupTracks: noVcaTargets,
    scaleAutomation: noVcaTargets,
    stretchAutomation: noVcaTargets,
    invertAutomation: noVcaTargets,
    reverseAutomation: noVcaTargets,
    thinAutomation: noVcaTargets,
    quantizeAutomation: noVcaTargets,
    loadPreset: noVcaTargets,
    savePreset: noVcaTargets,
    generateDrumPattern: noVcaTargets,
    generateMelody: noVcaTargets,
    generateChordProgression: noVcaTargets,
    setClipLoop: noVcaTargets,
    setClipLoopLength: noVcaTargets,
    extractGroove: noVcaTargets,
    applyGroove: noVcaTargets,
    setClipStretchMode: noVcaTargets,
    setClipStretchRatio: noVcaTargets,
    fitClipToBeats: noVcaTargets,
    analyzeMix: noVcaTargets,
    autoFixMix: noVcaTargets,
    enableMpe: noVcaTargets,
    disableMpe: noVcaTargets,
    getLatencyReport: noVcaTargets,
    createCollabSession: noVcaTargets,
    joinCollabSession: noVcaTargets,
    leaveCollabSession: noVcaTargets,
    scanPlugins: noVcaTargets,
    loadExternalPlugin: noVcaTargets,
    audioToMidi: noVcaTargets,
    muteClip: noVcaTargets,
    clearSolos: noVcaTargets,
    setTrackNotes: noVcaTargets,
    setTrackInput: noVcaTargets,
    zoomTracksVertical: noVcaTargets,
    deleteTime: noVcaTargets,
    insertTime: noVcaTargets,
    duplicateTimeRange: noVcaTargets,
    stripSilence: noVcaTargets,
    detectTempo: noVcaTargets,
    detectKey: noVcaTargets,
    consolidateAllTracks: noVcaTargets,
    arpeggiate: noVcaTargets,
    addSidechainRoute: noVcaTargets,
    removeSidechainRoute: noVcaTargets,
    bounceToNewTrack: noVcaTargets,
    createTrackAlternative: noVcaTargets,
    switchTrackAlternative: noVcaTargets,
    renameTrackAlternative: noVcaTargets,
    deleteTrackAlternative: noVcaTargets,
    addChordEvent: noVcaTargets,
    addCvOutput: noVcaTargets,
    addNotes: noVcaTargets,
    addYeastProcessor: noVcaTargets,
    assignToVca: trackAndGroupExist,
    autoOrganizeProject: noVcaTargets,
    captureScratchPad: noVcaTargets,
    clearAllMidiMappings: noVcaTargets,
    clearChordTrack: noVcaTargets,
    clearMidiOutput: noVcaTargets,
    clearScratchPad: noVcaTargets,
    commitScratchPad: noVcaTargets,
    compareToReference: noVcaTargets,
    completeMidi: noVcaTargets,
    connectPush: noVcaTargets,
    createAdjustmentLayer: noVcaTargets,
    addAdjustmentRegion: noVcaTargets,
    createCompGroup: noVcaTargets,
    createPatternInstance: noVcaTargets,
    createProjectVersion: noVcaTargets,
    createVcaGroup: allTracksExist,
    createVersionBranch: noVcaTargets,
    deleteMacro: noVcaTargets,
    deleteTrackTemplate: noVcaTargets,
    detachPatternInstance: noVcaTargets,
    detectSongStructure: noVcaTargets,
    detectTransients: noVcaTargets,
    disconnectPush: noVcaTargets,
    enableWarping: noVcaTargets,
    exportDawProject: noVcaTargets,
    generateAllTransitions: noVcaTargets,
    generateBassline: noVcaTargets,
    generateFill: noVcaTargets,
    getMentorTips: noVcaTargets,
    labelUndoBranch: noVcaTargets,
    loadRaveModel: noVcaTargets,
    loadTrackTemplate: noVcaTargets,
    nextSetlistItem: noVcaTargets,
    playMacro: noVcaTargets,
    previousSetlistItem: noVcaTargets,
    quantizeTransients: noVcaTargets,
    redo: noVcaTargets,
    removeChordEvent: noVcaTargets,
    removeFromVca: trackExists,
    removeYeastProcessor: noVcaTargets,
    reorderYeastProcessor: noVcaTargets,
    restoreAutomationLanePoints: noVcaTargets,
    restoreClip: noVcaTargets,
    restoreProjectVersion: noVcaTargets,
    restoreTrack: noVcaTargets,
    saveTrackTemplate: noVcaTargets,
    searchSamples: noVcaTargets,
    setControlSurface: noVcaTargets,
    setMidiOutput: noVcaTargets,
    setRaveBlend: noVcaTargets,
    setVcaGain: groupExists,
    setWarpAlgorithm: noVcaTargets,
    setWarpPitchShift: noVcaTargets,
    setYeastArpPattern: noVcaTargets,
    setYeastProcessorBypass: noVcaTargets,
    setYeastProcessorParam: noVcaTargets,
    startMacroRecording: noVcaTargets,
    stopMacroRecording: noVcaTargets,
    switchMonitor: noVcaTargets,
    toggleChordTrack: noVcaTargets,
    toggleControlRoomDim: noVcaTargets,
    toggleControlRoomMono: noVcaTargets,
    toggleLoopRecord: noVcaTargets,
    toggleNodeView: noVcaTargets,
    togglePunchRecording: noVcaTargets,
    toggleScratchPad: noVcaTargets,
    toggleUndoTree: noVcaTargets,
    triggerScene: noVcaTargets,
    undo: noVcaTargets,
    variationMidi: noVcaTargets,
};

function lookupVcaTargetAvailability<Type extends RuntimeActionType>(action: ActionOf<Type>): boolean {
    return vcaTargetAvailabilityByActionType[action.type](action);
}

function hasAvailableVcaTargets(action: RuntimeAction): boolean {
    return lookupVcaTargetAvailability(action);
}

export const validateActions = inject({ logger })(
    ({ logger }) =>
        function validateActions(
            actions: RuntimeAction[],
            batchLocalActionIdentities: readonly BatchLocalActionIdentity[] = []
        ): RuntimeAction[] {
            const batchCreatedLanes = indexBatchCreatedLanes(actions, batchLocalActionIdentities);
            return actions.filter((action, actionIndex) => {
                if (!KNOWN_ACTION_TYPES.has(action.type)) {
                    logger.warn(`Unknown action type rejected: ${action.type}`);
                    return false;
                }

                if (unawaitedAiActionByActionType[action.type]) {
                    logger.warn(`Unawaited AI action rejected: ${action.type}`);
                    return false;
                }

                if (!hasOnlyInitiatingPayloadKeys(action)) {
                    logger.warn(`Command-owned payload fields rejected for action ${action.type}`);
                    return false;
                }

                // §91.1 — Per-action payload validation. PAYLOAD_VALIDATORS
                // is a \`satisfies Record<RuntimeActionType, ...>\` so every
                // action type is either paired with a real runtime guard
                // or explicitly marked 'unchecked'. This replaces the
                // three inline checks that used to cover setTempo,
                // setMasterGain, and setMetronomeVolume — now each of the
                // ~230 action types has an explicit, compile-time-enforced
                // decision about whether its payload is validated.
                const validator = PAYLOAD_VALIDATORS[action.type];
                if (validator !== 'unchecked') {
                    // Keep the type-guard signature so the narrowing isn't
                    // discarded: indexing PAYLOAD_VALIDATORS with the `action.type`
                    // union yields a union of `PayloadValidator<…>`; widen only the
                    // *parameter* to `unknown` (validators accept `unknown` already)
                    // while preserving the `payload is …` predicate. A bare
                    // `(p: unknown) => boolean` cast would throw away the guard.
                    const guard = validator as PayloadValidator<RuntimeActionType>;
                    if (!guard(action.payload)) {
                        logger.warn(`Invalid payload for action ${action.type}`);
                        return false;
                    }
                }

                if (!hasAvailableVcaTargets(action)) {
                    logger.warn(`Unavailable target for action ${action.type}`);
                    return false;
                }

                if (!addressesGainLaneForDecibels(action, actionIndex, batchCreatedLanes)) {
                    logger.warn(`Decibel value rejected for a non-gain automation lane: ${action.type}`);
                    return false;
                }

                return true;
            });
        }
);
