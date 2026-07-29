import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { trackStore, vcaGroupStore } from '#/modules/Arrangement/stores';

import { type RuntimeAction, type RuntimeActionType } from '../models/RuntimeAction';

import { PAYLOAD_VALIDATORS, type PayloadValidator } from './validateActionPayload';

// `satisfies Record<RuntimeActionType, true>` below forces the compiler to
// verify this list contains every RuntimeActionType — if a new action is
// added to RuntimeAction without adding it here, the type check fails.
// This replaces the hand-maintained list that silently diverged (§91.2).
const KNOWN_ACTION_TYPES_MAP = {
    addTrack: true,
    removeTrack: true,
    removeAllTracks: true,
    renameTrack: true,
    selectTrack: true,
    muteTrack: true,
    soloTrack: true,
    toggleSoloSafe: true,
    armTrack: true,
    freezeTrack: true,
    unfreezeTrack: true,
    flattenTrack: true,
    bounceInPlace: true,
    duplicateTrack: true,
    reorderTrack: true,
    setTrackGain: true,
    setTrackPan: true,
    setTrackColor: true,
    setTempo: true,
    setTimeSignature: true,
    togglePlayback: true,
    stopPlayback: true,
    toggleRecording: true,
    setMasterGain: true,
    toggleLoop: true,
    toggleMetronome: true,
    setMetronomeVolume: true,
    setLoopRegion: true,
    addClip: true,
    moveClip: true,
    duplicateClip: true,
    duplicateClipToNextBar: true,
    removeClip: true,
    splitClip: true,
    trimClipStart: true,
    trimClipEnd: true,
    setClipFade: true,
    copyClip: true,
    cutClip: true,
    pasteClip: true,
    addDevice: true,
    bypassDevice: true,
    removeDevice: true,
    setDeviceParameter: true,
    createBus: true,
    createFolder: true,
    setSend: true,
    setWorkspaceMode: true,
    openPreferencesDialog: true,
    openMixer: true,
    closeMixer: true,
    toggleSidebar: true,
    toggleInspector: true,
    toggleChatPanel: true,
    setEditingTool: true,
    setMarqueeSelection: true,
    addMarker: true,
    removeMarker: true,
    setMarkerColor: true,
    addSection: true,
    removeSection: true,
    renameSection: true,
    addAutomationLane: true,
    addAutomationPoint: true,
    quantizeNotes: true,
    quantizeNoteLengths: true,
    transposeNotes: true,
    humanizeNotes: true,
    invertNotes: true,
    retrogradeNotes: true,
    scaleVelocities: true,
    scaleAllVelocities: true,
    setAllVelocities: true,
    importMidiFile: true,
    normalizeClip: true,
    reverseClip: true,
    glueClips: true,
    nudgeClip: true,
    crossfadeClips: true,
    setClipGain: true,
    setClipColor: true,
    lockClip: true,
    renameClip: true,
    consolidateSelection: true,
    bounceSelection: true,
    seekPlayhead: true,
    setPunchIn: true,
    setPunchOut: true,
    togglePunch: true,
    toggleCountIn: true,
    setCountInBars: true,
    togglePreRoll: true,
    setPreRollBars: true,
    addTimeSignatureChange: true,
    removeTimeSignatureChange: true,
    setTrackOutput: true,
    addSend: true,
    removeSend: true,
    removeAutomationPoint: true,
    setAutomationMode: true,
    hideTrack: true,
    disableTrack: true,
    setTrackHeight: true,
    setSnapValue: true,
    zoomToFit: true,
    zoomToSelection: true,
    exportProject: true,
    saveProject: true,
    newProject: true,
    importAudioFile: true,
    exportMidi: true,
    foldTrack: true,
    groupTracks: true,
    ungroupTracks: true,
    scaleAutomation: true,
    stretchAutomation: true,
    invertAutomation: true,
    reverseAutomation: true,
    thinAutomation: true,
    quantizeAutomation: true,
    loadPreset: true,
    savePreset: true,
    generateDrumPattern: true,
    generateMelody: true,
    generateChordProgression: true,
    setClipLoop: true,
    setClipLoopLength: true,
    extractGroove: true,
    applyGroove: true,
    setClipStretchMode: true,
    setClipStretchRatio: true,
    fitClipToBeats: true,
    analyzeMix: true,
    autoFixMix: true,
    enableMpe: true,
    disableMpe: true,
    getLatencyReport: true,
    createCollabSession: true,
    joinCollabSession: true,
    leaveCollabSession: true,
    scanPlugins: true,
    loadExternalPlugin: true,
    audioToMidi: true,
    muteClip: true,
    clearSolos: true,
    setTrackNotes: true,
    setTrackInput: true,
    zoomTracksVertical: true,
    deleteTime: true,
    insertTime: true,
    duplicateTimeRange: true,
    stripSilence: true,
    detectTempo: true,
    detectKey: true,
    consolidateAllTracks: true,
    arpeggiate: true,
    addSidechainRoute: true,
    removeSidechainRoute: true,
    bounceToNewTrack: true,
    createTrackAlternative: true,
    switchTrackAlternative: true,
    renameTrackAlternative: true,
    deleteTrackAlternative: true,
    addChordEvent: true,
    addCvOutput: true,
    addNotes: true,
    assignToVca: true,
    autoOrganizeProject: true,
    captureScratchPad: true,
    clearAllMidiMappings: true,
    clearChordTrack: true,
    clearMidiOutput: true,
    clearScratchPad: true,
    commitScratchPad: true,
    compareToReference: true,
    completeMidi: true,
    connectPush: true,
    createAdjustmentLayer: true,
    createCompGroup: true,
    createPatternInstance: true,
    createProjectVersion: true,
    createVcaGroup: true,
    createVersionBranch: true,
    deleteMacro: true,
    deleteTrackTemplate: true,
    detachPatternInstance: true,
    detectSongStructure: true,
    detectTransients: true,
    disconnectPush: true,
    enableWarping: true,
    exportDawProject: true,
    generateAllTransitions: true,
    generateAudio: true,
    generateBassline: true,
    generateFill: true,
    getMentorTips: true,
    labelUndoBranch: true,
    loadRaveModel: true,
    loadTrackTemplate: true,
    nextSetlistItem: true,
    playMacro: true,
    previousSetlistItem: true,
    quantizeTransients: true,
    redo: true,
    removeChordEvent: true,
    removeFromVca: true,
    restoreAutomationLanePoints: true,
    restoreClip: true,
    restoreDsoSnapshot: true,
    restoreProjectVersion: true,
    restoreTrack: true,
    saveTrackTemplate: true,
    searchSamples: true,
    setControlSurface: true,
    setMidiOutput: true,
    setRaveBlend: true,
    setVcaGain: true,
    setWarpAlgorithm: true,
    setWarpPitchShift: true,
    startMacroRecording: true,
    stemSeparate: true,
    stopMacroRecording: true,
    switchMonitor: true,
    toggleChordTrack: true,
    toggleControlRoomDim: true,
    toggleControlRoomMono: true,
    toggleLoopRecord: true,
    toggleNodeView: true,
    togglePunchRecording: true,
    toggleScratchPad: true,
    toggleUndoTree: true,
    triggerScene: true,
    undo: true,
    variationMidi: true,
} as const satisfies Record<RuntimeActionType, true>;

const KNOWN_ACTION_TYPES: ReadonlySet<RuntimeActionType> = new Set(
    Object.keys(KNOWN_ACTION_TYPES_MAP) as RuntimeActionType[]
);

const UNAWAITED_AI_ACTION_TYPES: ReadonlySet<RuntimeActionType> = new Set([
    'exportProject',
    'importAudioFile',
    'importMidiFile',
    'leaveCollabSession',
    'newProject',
    'saveProject',
]);

function hasAvailableVcaTargets(action: RuntimeAction): boolean {
    const tracks = trackStore.value?.tracks ?? [];
    const groups = vcaGroupStore.value?.groups ?? [];

    if (action.type === 'createVcaGroup') {
        return action.payload.trackIds.every((trackId) => tracks.some((track) => track.id === trackId));
    }

    if (action.type === 'assignToVca') {
        const trackExists = tracks.some((track) => track.id === action.payload.trackId);
        const groupExists = groups.some((group) => group.id === action.payload.vcaGroupId);
        return trackExists && groupExists;
    }

    if (action.type === 'removeFromVca') {
        return tracks.some((track) => track.id === action.payload.trackId);
    }

    if (action.type === 'setVcaGain') {
        return groups.some((group) => group.id === action.payload.vcaGroupId);
    }

    return true;
}

export const validateActions = inject({ logger })(
    ({ logger }) =>
        function validateActions(actions: RuntimeAction[]): RuntimeAction[] {
            return actions.filter((action) => {
                if (!KNOWN_ACTION_TYPES.has(action.type)) {
                    logger.warn(`Unknown action type rejected: ${action.type}`);
                    return false;
                }

                if (UNAWAITED_AI_ACTION_TYPES.has(action.type)) {
                    logger.warn(`Unawaited AI action rejected: ${action.type}`);
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

                return true;
            });
        }
);
