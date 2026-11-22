import { resolveSendLevelFields, SEND_LEVEL_LAW, toLevelDb } from '#/utils/audioLevelLaw';

import { type ProjectContext } from '../models/ProjectContext';
import { type RuntimeAction, type RuntimeActionType } from '../models/RuntimeAction';

import { findDeviceTarget, findSupportedSidechainDevices, findTrack } from './llmActionStrategies/bridgeArgumentGuards';

type ActionOf<Type extends RuntimeActionType> = Extract<RuntimeAction, { type: Type }>;
type RoutingProjectionLookup = {
    readonly [Type in RuntimeActionType]: (context: ProjectContext, action: ActionOf<Type>) => ProjectContext;
};

function unchangedContext(context: ProjectContext): ProjectContext {
    return context;
}

function projectAddSidechainRoute(context: ProjectContext, action: ActionOf<'addSidechainRoute'>): ProjectContext {
    const target = findTrack(context, action.payload.targetTrackId);
    if (!target) {
        return context;
    }
    const targetDevice = findSupportedSidechainDevices(target).find(
        (device) => action.payload.targetDeviceId === undefined || device.id === action.payload.targetDeviceId
    );
    if (!targetDevice) {
        return context;
    }
    const existingRoutes = context.sidechainRoutes ?? [];
    return {
        ...context,
        sidechainRoutes: [
            ...existingRoutes,
            {
                id: `provider-batch:${action.payload.sourceTrackId}:${targetDevice.id}`,
                sourceTrackId: action.payload.sourceTrackId,
                targetTrackId: action.payload.targetTrackId,
                targetDeviceId: targetDevice.id,
                targetParameterId: 'threshold',
                gain: 1,
            },
        ],
    };
}

function projectRemoveSidechainRoute(
    context: ProjectContext,
    action: ActionOf<'removeSidechainRoute'>
): ProjectContext {
    return {
        ...context,
        sidechainRoutes: (context.sidechainRoutes ?? []).filter(
            (route) =>
                route.sourceTrackId !== action.payload.sourceTrackId ||
                route.targetTrackId !== action.payload.targetTrackId
        ),
    };
}

function projectSetTrackOutput(context: ProjectContext, action: ActionOf<'setTrackOutput'>): ProjectContext {
    return {
        ...context,
        tracks: context.tracks.map((track) => {
            if (track.id !== action.payload.trackId) {
                return track;
            }
            return { ...track, outputId: action.payload.outputId };
        }),
    };
}

function projectAddSend(context: ProjectContext, action: ActionOf<'addSend'>): ProjectContext {
    // A send being created has no level to measure a relative request
    // from, so it is measured from the full copy of the signal it taps,
    // exactly as the handler measures it. A request the send law refuses
    // never lands, so the projection leaves the context alone rather than
    // showing a send that cannot exist.
    const level = resolveSendLevelFields(action.payload, SEND_LEVEL_LAW.unity);
    if (!level.ok) {
        return context;
    }
    return {
        ...context,
        tracks: context.tracks.map((track) => {
            if (track.id !== action.payload.trackId) {
                return track;
            }
            const existingSends = track.sends ?? [];
            return {
                ...track,
                sends: [
                    ...existingSends,
                    {
                        busId: action.payload.busId,
                        level: level.linear,
                        levelDb: toLevelDb(level.linear),
                        preFader: false,
                    },
                ],
            };
        }),
    };
}

function projectRemoveSend(context: ProjectContext, action: ActionOf<'removeSend'>): ProjectContext {
    return {
        ...context,
        tracks: context.tracks.map((track) => {
            if (track.id !== action.payload.trackId) {
                return track;
            }
            return {
                ...track,
                sends: (track.sends ?? []).filter((send) => send.busId !== action.payload.busId),
            };
        }),
    };
}

function projectRemoveDevice(context: ProjectContext, action: ActionOf<'removeDevice'>): ProjectContext {
    const target = findDeviceTarget(context, action.payload.deviceId);
    if (!target) {
        return context;
    }
    return {
        ...context,
        tracks: context.tracks.map((track) => {
            if (track.id !== target.track.id) {
                return track;
            }
            const devices = track.devices.filter((device) => device.id !== action.payload.deviceId);
            return { ...track, devices, deviceCount: devices.length };
        }),
        sidechainRoutes: (context.sidechainRoutes ?? []).filter(
            (route) => route.targetDeviceId !== action.payload.deviceId
        ),
    };
}

function projectRemoveTrack(context: ProjectContext, action: ActionOf<'removeTrack'>): ProjectContext {
    return {
        ...context,
        tracks: context.tracks.filter((track) => track.id !== action.payload.trackId),
        sidechainRoutes: (context.sidechainRoutes ?? []).filter(
            (route) => route.sourceTrackId !== action.payload.trackId && route.targetTrackId !== action.payload.trackId
        ),
    };
}

const routingProjectionByActionType: RoutingProjectionLookup = {
    importStemSet: unchangedContext,
    addTrack: unchangedContext,
    removeTrack: projectRemoveTrack,
    renameTrack: unchangedContext,
    selectTrack: unchangedContext,
    muteTrack: unchangedContext,
    soloTrack: unchangedContext,
    selectTake: unchangedContext,
    setSoloSafe: unchangedContext,
    armTrack: unchangedContext,
    freezeTrack: unchangedContext,
    unfreezeTrack: unchangedContext,
    flattenTrack: unchangedContext,
    bounceInPlace: unchangedContext,
    duplicateTrack: unchangedContext,
    reorderTrack: unchangedContext,
    setTrackGain: unchangedContext,
    setTrackPan: unchangedContext,
    setTrackColor: unchangedContext,
    setTempo: unchangedContext,
    setTimeSignature: unchangedContext,
    setProductionBrief: unchangedContext,
    setPlayback: unchangedContext,
    togglePlayback: unchangedContext,
    stopPlayback: unchangedContext,
    toggleRecording: unchangedContext,
    setMasterGain: unchangedContext,
    setMetronomeVolume: unchangedContext,
    setLoopRegion: unchangedContext,
    setLoopEnabled: unchangedContext,
    setMetronomeEnabled: unchangedContext,
    addClip: unchangedContext,
    drawClip: unchangedContext,
    duplicateClipAt: unchangedContext,
    moveClips: unchangedContext,
    moveClip: unchangedContext,
    duplicateClip: unchangedContext,
    duplicateClipToNextBar: unchangedContext,
    removeClip: unchangedContext,
    splitClip: unchangedContext,
    trimClipStart: unchangedContext,
    trimClipEnd: unchangedContext,
    setClipFade: unchangedContext,
    addDevice: unchangedContext,
    bypassDevice: unchangedContext,
    removeDevice: projectRemoveDevice,
    setDeviceParameter: unchangedContext,
    createBus: unchangedContext,
    createFolder: unchangedContext,
    setSend: unchangedContext,
    setWorkspaceMode: unchangedContext,
    openPreferencesDialog: unchangedContext,
    openMixer: unchangedContext,
    closeMixer: unchangedContext,
    toggleSidebar: unchangedContext,
    toggleInspector: unchangedContext,
    toggleChatPanel: unchangedContext,
    setEditingTool: unchangedContext,
    setMarqueeSelection: unchangedContext,
    addMarker: unchangedContext,
    removeMarker: unchangedContext,
    setMarkerColor: unchangedContext,
    addSection: unchangedContext,
    removeSection: unchangedContext,
    renameSection: unchangedContext,
    addAutomationLane: unchangedContext,
    automateSendRange: unchangedContext,
    automateSendRanges: unchangedContext,
    automateTrackGainRange: unchangedContext,
    automateParameterRange: unchangedContext,
    renderProjectSections: unchangedContext,
    addAutomationPoint: unchangedContext,
    setAutomationLaneEnabled: unchangedContext,
    quantizeNotes: unchangedContext,
    removeShortMidiOverlaps: unchangedContext,
    createDrumPreviewBranches: unchangedContext,
    copyMidiArticulations: unchangedContext,
    quantizeNoteLengths: unchangedContext,
    transposeNotes: unchangedContext,
    humanizeNotes: unchangedContext,
    invertNotes: unchangedContext,
    retrogradeNotes: unchangedContext,
    scaleVelocities: unchangedContext,
    scaleAllVelocities: unchangedContext,
    setAllVelocities: unchangedContext,
    normalizeClip: unchangedContext,
    reverseClip: unchangedContext,
    glueClips: unchangedContext,
    nudgeClip: unchangedContext,
    slipClipContent: unchangedContext,
    crossfadeClips: unchangedContext,
    setClipGain: unchangedContext,
    setClipColor: unchangedContext,
    lockClip: unchangedContext,
    renameClip: unchangedContext,
    consolidateSelection: unchangedContext,
    bounceSelection: unchangedContext,
    seekPlayhead: unchangedContext,
    setPunchIn: unchangedContext,
    setPunchOut: unchangedContext,
    setPunchEnabled: unchangedContext,
    toggleCountIn: unchangedContext,
    setCountInBars: unchangedContext,
    togglePreRoll: unchangedContext,
    setPreRollBars: unchangedContext,
    addTimeSignatureChange: unchangedContext,
    removeTimeSignatureChange: unchangedContext,
    setTrackOutput: projectSetTrackOutput,
    addSend: projectAddSend,
    removeSend: projectRemoveSend,
    setAutomationMode: unchangedContext,
    hideTrack: unchangedContext,
    disableTrack: unchangedContext,
    setTrackHeight: unchangedContext,
    setSnapValue: unchangedContext,
    zoomToFit: unchangedContext,
    zoomToSelection: unchangedContext,
    exportProject: unchangedContext,
    saveProject: unchangedContext,
    newProject: unchangedContext,
    exportMidi: unchangedContext,
    foldTrack: unchangedContext,
    groupTracks: unchangedContext,
    ungroupTracks: unchangedContext,
    scaleAutomation: unchangedContext,
    stretchAutomation: unchangedContext,
    invertAutomation: unchangedContext,
    reverseAutomation: unchangedContext,
    thinAutomation: unchangedContext,
    quantizeAutomation: unchangedContext,
    savePreset: unchangedContext,
    generateDrumPattern: unchangedContext,
    generateMelody: unchangedContext,
    generateChordProgression: unchangedContext,
    setClipLoop: unchangedContext,
    setClipLoopLength: unchangedContext,
    extractGroove: unchangedContext,
    applyGroove: unchangedContext,
    setClipStretchMode: unchangedContext,
    setClipStretchRatio: unchangedContext,
    fitClipToBeats: unchangedContext,
    analyzeMix: unchangedContext,
    enableMpe: unchangedContext,
    disableMpe: unchangedContext,
    getLatencyReport: unchangedContext,
    createCollabSession: unchangedContext,
    joinCollabSession: unchangedContext,
    leaveCollabSession: unchangedContext,
    scanPlugins: unchangedContext,
    muteClip: unchangedContext,
    clearSolos: unchangedContext,
    setTrackNotes: unchangedContext,
    zoomTracksVertical: unchangedContext,
    deleteTime: unchangedContext,
    insertTime: unchangedContext,
    duplicateTimeRange: unchangedContext,
    stripSilence: unchangedContext,
    detectTempo: unchangedContext,
    detectKey: unchangedContext,
    consolidateAllTracks: unchangedContext,
    arpeggiate: unchangedContext,
    addSidechainRoute: projectAddSidechainRoute,
    removeSidechainRoute: projectRemoveSidechainRoute,
    bounceToNewTrack: unchangedContext,
    createTrackAlternative: unchangedContext,
    switchTrackAlternative: unchangedContext,
    renameTrackAlternative: unchangedContext,
    deleteTrackAlternative: unchangedContext,
    addChordEvent: unchangedContext,
    addNotes: unchangedContext,
    addYeastProcessor: unchangedContext,
    assignToVca: unchangedContext,
    clearChordTrack: unchangedContext,
    clearMidiOutput: unchangedContext,
    connectPush: unchangedContext,
    createAdjustmentLayer: unchangedContext,
    addAdjustmentRegion: unchangedContext,
    createCompGroup: unchangedContext,
    createPatternInstance: unchangedContext,
    createVcaGroup: unchangedContext,
    deleteMacro: unchangedContext,
    deleteTrackTemplate: unchangedContext,
    detachPatternInstance: unchangedContext,
    disconnectPush: unchangedContext,
    exportDawProject: unchangedContext,
    labelUndoBranch: unchangedContext,
    loadTrackTemplate: unchangedContext,
    nextSetlistItem: unchangedContext,
    playMacro: unchangedContext,
    previousSetlistItem: unchangedContext,
    quantizeTransients: unchangedContext,
    redo: unchangedContext,
    removeChordEvent: unchangedContext,
    removeFromVca: unchangedContext,
    removeYeastProcessor: unchangedContext,
    reorderYeastProcessor: unchangedContext,
    saveTrackTemplate: unchangedContext,
    setControlSurface: unchangedContext,
    setMidiOutput: unchangedContext,
    setVcaGain: unchangedContext,
    setYeastArpPattern: unchangedContext,
    setYeastProcessorBypass: unchangedContext,
    setYeastProcessorParam: unchangedContext,
    startMacroRecording: unchangedContext,
    stopMacroRecording: unchangedContext,
    switchMonitor: unchangedContext,
    toggleChordTrack: unchangedContext,
    toggleControlRoomDim: unchangedContext,
    toggleControlRoomMono: unchangedContext,
    toggleLoopRecord: unchangedContext,
    toggleNodeView: unchangedContext,
    togglePunchRecording: unchangedContext,
    toggleScratchPad: unchangedContext,
    toggleUndoTree: unchangedContext,
    triggerScene: unchangedContext,
    undo: unchangedContext,
};

function lookupRoutingProjection<Type extends RuntimeActionType>(
    context: ProjectContext,
    action: ActionOf<Type>
): ProjectContext {
    if (!Object.hasOwn(routingProjectionByActionType, action.type)) {
        return unchangedContext(context);
    }
    return routingProjectionByActionType[action.type](context, action);
}

export function applyAcceptedRoutingAction(context: ProjectContext, action: RuntimeAction): ProjectContext {
    return lookupRoutingProjection(context, action);
}
