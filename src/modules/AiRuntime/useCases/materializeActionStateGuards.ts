import { type AppAction } from '#/utils/handlerContract';

import { type MaterializableRuntimeAction } from '../models/ExecutableRuntimeAction';
import { type RuntimeActionType } from '../models/RuntimeAction';

import { guardTrackAction } from './actionStateGuards/guardTrackAction';
import {
    type MaterializationState,
    type MaterializationStep,
    type MaterializeActionStateGuardsOptions,
} from './actionStateGuards/MaterializationState';
import { materializeAddedDevice } from './actionStateGuards/materializeAddedDevice';
import { materializeAddedSend } from './actionStateGuards/materializeAddedSend';
import { materializeAddedTrack } from './actionStateGuards/materializeAddedTrack';
import { materializeAdjustmentRegion } from './actionStateGuards/materializeAdjustmentRegion';
import { materializeArpeggio } from './actionStateGuards/materializeArpeggio';
import { materializeCopyMidiArticulations } from './actionStateGuards/materializeCopyMidiArticulations';
import { materializeCreatedBus } from './actionStateGuards/materializeCreatedBus';
import { materializeDeviceParameter } from './actionStateGuards/materializeDeviceParameter';
import { materializeDrumPreviewBranches } from './actionStateGuards/materializeDrumPreviewBranches';
import { materializeFreezeChange } from './actionStateGuards/materializeFreezeChange';
import { materializeParameterRange } from './actionStateGuards/materializeParameterRange';
import { materializeRemovedDevice } from './actionStateGuards/materializeRemovedDevice';
import { materializeSectionRenders } from './actionStateGuards/materializeSectionRenders';
import { materializeSendRange } from './actionStateGuards/materializeSendRange';
import { materializeSendRanges } from './actionStateGuards/materializeSendRanges';
import { materializeShortMidiOverlaps } from './actionStateGuards/materializeShortMidiOverlaps';
import { materializeTrackGainRange } from './actionStateGuards/materializeTrackGainRange';
import { type ProjectContext, type ProjectContextAdjustmentLayer } from './getProjectContext';
import { stampProcessingOnlyParameterPolicy } from './stampProcessingOnlyParameterPolicy';

type MaterializeActionStateGuardsResult = MaterializationStep;

type ActionOf<Type extends RuntimeActionType> = Extract<MaterializableRuntimeAction, { type: Type }>;

type ActionMaterializer<Type extends RuntimeActionType> = (
    action: ActionOf<Type>,
    state: MaterializationState
) => MaterializationStep;

/** An action no guard pins: it joins the batch as it was proposed. */
function passThrough(action: AppAction): MaterializationStep {
    return { status: 'accepted', actions: [action] };
}

function rejectStemImport(): MaterializationStep {
    return { status: 'rejected', reason: 'Stem imports require application-owned file materialization' };
}

// Every runtime action type states how its state guards are pinned: a new action does not compile until it does.
const materializerByActionType: { readonly [Type in RuntimeActionType]: ActionMaterializer<Type> } = {
    importStemSet: rejectStemImport,
    addTrack: materializeAddedTrack,
    removeTrack: passThrough,
    renameTrack: passThrough,
    createTrackAlternative: passThrough,
    switchTrackAlternative: passThrough,
    renameTrackAlternative: passThrough,
    deleteTrackAlternative: passThrough,
    selectTrack: passThrough,
    muteTrack: (action, state) =>
        guardTrackAction(state, action.payload.trackId, (track) => ({
            type: 'muteTrack',
            payload: { ...action.payload, expectedMuted: track.muted },
        })),
    soloTrack: (action, state) =>
        guardTrackAction(state, action.payload.trackId, (track) => ({
            type: 'soloTrack',
            payload: { ...action.payload, expectedSoloed: track.soloed },
        })),
    selectTake: passThrough,
    setSoloSafe: passThrough,
    armTrack: passThrough,
    freezeTrack: materializeFreezeChange,
    unfreezeTrack: materializeFreezeChange,
    flattenTrack: passThrough,
    reorderTrack: passThrough,
    setTempo: passThrough,
    setTimeSignature: passThrough,
    setPlayback: passThrough,
    togglePlayback: passThrough,
    stopPlayback: passThrough,
    toggleRecording: passThrough,
    setMasterGain: passThrough,
    setMetronomeVolume: passThrough,
    setLoopRegion: passThrough,
    setLoopEnabled: passThrough,
    setMetronomeEnabled: passThrough,
    addClip: passThrough,
    moveClip: passThrough,
    duplicateClip: passThrough,
    duplicateClipToNextBar: passThrough,
    duplicateTrack: passThrough,
    removeClip: passThrough,
    renameClip: passThrough,
    splitClip: passThrough,
    trimClipStart: passThrough,
    trimClipEnd: passThrough,
    slipClipContent: passThrough,
    drawClip: passThrough,
    duplicateClipAt: passThrough,
    moveClips: passThrough,
    addDevice: materializeAddedDevice,
    bypassDevice: passThrough,
    removeDevice: materializeRemovedDevice,
    setDeviceParameter: materializeDeviceParameter,
    createBus: materializeCreatedBus,
    createFolder: passThrough,
    setSend: passThrough,
    setWorkspaceMode: passThrough,
    openPreferencesDialog: passThrough,
    openMixer: passThrough,
    closeMixer: passThrough,
    toggleSidebar: passThrough,
    toggleInspector: passThrough,
    toggleChatPanel: passThrough,
    setEditingTool: passThrough,
    setMarqueeSelection: passThrough,
    addMarker: passThrough,
    removeMarker: passThrough,
    setMarkerColor: passThrough,
    addSection: passThrough,
    removeSection: passThrough,
    renameSection: passThrough,
    addAutomationLane: passThrough,
    automateSendRange: materializeSendRange,
    automateSendRanges: materializeSendRanges,
    renderProjectSections: materializeSectionRenders,
    automateTrackGainRange: materializeTrackGainRange,
    automateParameterRange: materializeParameterRange,
    setAutomationLaneEnabled: passThrough,
    addAutomationPoint: passThrough,
    quantizeNotes: passThrough,
    removeShortMidiOverlaps: materializeShortMidiOverlaps,
    createDrumPreviewBranches: materializeDrumPreviewBranches,
    copyMidiArticulations: materializeCopyMidiArticulations,
    quantizeNoteLengths: passThrough,
    transposeNotes: passThrough,
    humanizeNotes: passThrough,
    invertNotes: passThrough,
    retrogradeNotes: passThrough,
    scaleVelocities: passThrough,
    scaleAllVelocities: passThrough,
    setAllVelocities: passThrough,
    setTrackGain: (action, state) =>
        guardTrackAction(state, action.payload.trackId, (track) => ({
            type: 'setTrackGain',
            payload: { ...action.payload, expectedGain: track.gain },
        })),
    setTrackPan: (action, state) =>
        guardTrackAction(state, action.payload.trackId, (track) => ({
            type: 'setTrackPan',
            payload: { ...action.payload, expectedPan: track.pan },
        })),
    setTrackColor: passThrough,
    setClipFade: passThrough,
    normalizeClip: passThrough,
    reverseClip: passThrough,
    glueClips: passThrough,
    nudgeClip: passThrough,
    crossfadeClips: passThrough,
    setClipGain: passThrough,
    setClipColor: passThrough,
    lockClip: passThrough,
    seekPlayhead: passThrough,
    setPunchIn: passThrough,
    setPunchOut: passThrough,
    setPunchEnabled: passThrough,
    toggleCountIn: passThrough,
    setCountInBars: passThrough,
    togglePreRoll: passThrough,
    setPreRollBars: passThrough,
    addTimeSignatureChange: passThrough,
    removeTimeSignatureChange: passThrough,
    setTrackOutput: passThrough,
    addSend: materializeAddedSend,
    removeSend: passThrough,
    setAutomationMode: passThrough,
    hideTrack: passThrough,
    disableTrack: passThrough,
    setTrackHeight: passThrough,
    setSnapValue: passThrough,
    zoomToFit: passThrough,
    zoomToSelection: passThrough,
    exportProject: passThrough,
    saveProject: passThrough,
    newProject: passThrough,
    exportMidi: passThrough,
    foldTrack: passThrough,
    groupTracks: passThrough,
    ungroupTracks: passThrough,
    scaleAutomation: passThrough,
    stretchAutomation: passThrough,
    invertAutomation: passThrough,
    reverseAutomation: passThrough,
    thinAutomation: passThrough,
    quantizeAutomation: passThrough,
    savePreset: passThrough,
    setClipLoop: passThrough,
    setClipLoopLength: passThrough,
    extractGroove: passThrough,
    applyGroove: passThrough,
    setClipStretchMode: passThrough,
    setClipStretchRatio: passThrough,
    fitClipToBeats: passThrough,
    analyzeMix: passThrough,
    enableMpe: passThrough,
    disableMpe: passThrough,
    getLatencyReport: passThrough,
    createCollabSession: passThrough,
    joinCollabSession: passThrough,
    leaveCollabSession: passThrough,
    scanPlugins: passThrough,
    muteClip: passThrough,
    clearSolos: passThrough,
    setTrackNotes: passThrough,
    deleteTime: passThrough,
    insertTime: passThrough,
    duplicateTimeRange: passThrough,
    stripSilence: passThrough,
    detectTempo: passThrough,
    detectKey: passThrough,
    arpeggiate: materializeArpeggio,
    addSidechainRoute: passThrough,
    removeSidechainRoute: passThrough,
    saveTrackTemplate: passThrough,
    deleteTrackTemplate: passThrough,
    setProductionBrief: passThrough,
    createVcaGroup: passThrough,
    assignToVca: passThrough,
    removeFromVca: passThrough,
    setVcaGain: passThrough,
    setMidiOutput: passThrough,
    clearMidiOutput: passThrough,
    addNotes: passThrough,
    addChordEvent: passThrough,
    removeChordEvent: passThrough,
    toggleChordTrack: passThrough,
    clearChordTrack: passThrough,
    toggleScratchPad: passThrough,
    createPatternInstance: passThrough,
    detachPatternInstance: passThrough,
    startMacroRecording: passThrough,
    stopMacroRecording: passThrough,
    playMacro: passThrough,
    deleteMacro: passThrough,
    undo: passThrough,
    redo: passThrough,
    toggleUndoTree: passThrough,
    labelUndoBranch: passThrough,
    toggleControlRoomMono: passThrough,
    toggleControlRoomDim: passThrough,
    switchMonitor: passThrough,
    createCompGroup: passThrough,
    togglePunchRecording: passThrough,
    toggleLoopRecord: passThrough,
    triggerScene: passThrough,
    nextSetlistItem: passThrough,
    previousSetlistItem: passThrough,
    createAdjustmentLayer: passThrough,
    addAdjustmentRegion: materializeAdjustmentRegion,
    quantizeTransients: passThrough,
    toggleNodeView: passThrough,
    setControlSurface: passThrough,
    connectPush: passThrough,
    disconnectPush: passThrough,
    exportDawProject: passThrough,
    setYeastProcessorParam: passThrough,
    setYeastArpPattern: passThrough,
    setYeastProcessorBypass: passThrough,
    addYeastProcessor: passThrough,
    removeYeastProcessor: passThrough,
    reorderYeastProcessor: passThrough,
};

function materialize<Type extends RuntimeActionType>(
    action: ActionOf<Type>,
    state: MaterializationState
): MaterializationStep {
    return materializerByActionType[action.type](action, state);
}

export function materializeActionStateGuards(
    actions: readonly MaterializableRuntimeAction[],
    context: ProjectContext,
    options: MaterializeActionStateGuardsOptions = {}
): MaterializeActionStateGuardsResult {
    const tracksById = new Map(context.tracks.map((track) => [track.id, track]));
    const frozenByTrack = new Map(context.tracks.map((track) => [track.id, track.frozen] as const));
    const reservedDeviceIds = new Set(context.tracks.flatMap((track) => track.devices.map((device) => device.id)));
    const reservedAdjustmentRegionIds = new Set(
        (context.adjustmentLayers ?? []).flatMap((layer) => layer.regions.map((region) => region.id))
    );
    const projectedAdjustmentLayers = new Map<string, ProjectContextAdjustmentLayer>(
        (context.adjustmentLayers ?? []).map((layer) => [layer.id, structuredClone(layer)])
    );
    const deviceIdsByTrack = new Map(
        context.tracks.map((track) => [track.id, track.devices.map((device) => device.id)] as const)
    );
    const state: MaterializationState = {
        context,
        options,
        tracksById,
        frozenByTrack,
        reservedDeviceIds,
        reservedAdjustmentRegionIds,
        projectedAdjustmentLayers,
        deviceIdsByTrack,
    };
    const materialized: AppAction[] = [];

    for (const action of actions) {
        const step = materialize(action, state);
        if (step.status === 'rejected') {
            return step;
        }
        materialized.push(...step.actions);
    }

    return { status: 'accepted', actions: stampProcessingOnlyParameterPolicy(materialized) };
}
