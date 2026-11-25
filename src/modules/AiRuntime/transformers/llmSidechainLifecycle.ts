import { type ProjectContext } from '../models/ProjectContext';
import { type RuntimeAction, type RuntimeActionType } from '../models/RuntimeAction';

import { findDeviceTarget } from './llmActionStrategies/bridgeArgumentGuards';

type ActionOf<Type extends RuntimeActionType> = Extract<RuntimeAction, { type: Type }>;
type AddSidechainRuntimeAction = ActionOf<'addSidechainRoute'>;
type SidechainPlan = {
    acceptsSidechainInput: (deviceType: string) => boolean;
    allSidechainAdds: readonly AddSidechainRuntimeAction[];
    context: ProjectContext;
    plannedSidechainAdds: readonly AddSidechainRuntimeAction[];
};
type SidechainInvalidationLookup = {
    readonly [Type in RuntimeActionType]: (action: ActionOf<Type>, plan: SidechainPlan) => boolean;
};

function isAddSidechainRuntimeAction(action: RuntimeAction): action is AddSidechainRuntimeAction {
    return action.type === 'addSidechainRoute';
}

function neverInvalidates(): boolean {
    return false;
}

function addDeviceInvalidatesSidechain(action: ActionOf<'addDevice'>, plan: SidechainPlan): boolean {
    return (
        plan.acceptsSidechainInput(action.payload.deviceType) &&
        plan.allSidechainAdds.some(
            (sidechainAction) => sidechainAction.payload.targetTrackId === action.payload.trackId
        )
    );
}

function removeTrackInvalidatesSidechain(action: ActionOf<'removeTrack'>, plan: SidechainPlan): boolean {
    return plan.plannedSidechainAdds.some(
        (sidechainAction) =>
            sidechainAction.payload.sourceTrackId === action.payload.trackId ||
            sidechainAction.payload.targetTrackId === action.payload.trackId
    );
}

function removeDeviceInvalidatesSidechain(action: ActionOf<'removeDevice'>, plan: SidechainPlan): boolean {
    const target = findDeviceTarget(plan.context, action.payload.deviceId);
    return (
        target !== undefined &&
        plan.acceptsSidechainInput(target.device.type) &&
        plan.plannedSidechainAdds.some((sidechainAction) => sidechainAction.payload.targetTrackId === target.track.id)
    );
}

const sidechainInvalidationByActionType: SidechainInvalidationLookup = {
    importStemSet: neverInvalidates,
    addTrack: neverInvalidates,
    removeTrack: removeTrackInvalidatesSidechain,
    renameTrack: neverInvalidates,
    selectTrack: neverInvalidates,
    muteTrack: neverInvalidates,
    soloTrack: neverInvalidates,
    selectTake: neverInvalidates,
    setSoloSafe: neverInvalidates,
    armTrack: neverInvalidates,
    freezeTrack: neverInvalidates,
    unfreezeTrack: neverInvalidates,
    flattenTrack: neverInvalidates,
    bounceInPlace: neverInvalidates,
    duplicateTrack: neverInvalidates,
    reorderTrack: neverInvalidates,
    setTrackGain: neverInvalidates,
    setTrackPan: neverInvalidates,
    setTrackColor: neverInvalidates,
    setTempo: neverInvalidates,
    setTimeSignature: neverInvalidates,
    setProductionBrief: neverInvalidates,
    setPlayback: neverInvalidates,
    togglePlayback: neverInvalidates,
    stopPlayback: neverInvalidates,
    toggleRecording: neverInvalidates,
    setMasterGain: neverInvalidates,
    setMetronomeVolume: neverInvalidates,
    setLoopRegion: neverInvalidates,
    setLoopEnabled: neverInvalidates,
    setMetronomeEnabled: neverInvalidates,
    addClip: neverInvalidates,
    drawClip: neverInvalidates,
    duplicateClipAt: neverInvalidates,
    moveClips: neverInvalidates,
    moveClip: neverInvalidates,
    duplicateClip: neverInvalidates,
    duplicateClipToNextBar: neverInvalidates,
    removeClip: neverInvalidates,
    splitClip: neverInvalidates,
    trimClipStart: neverInvalidates,
    trimClipEnd: neverInvalidates,
    setClipFade: neverInvalidates,
    addDevice: addDeviceInvalidatesSidechain,
    bypassDevice: neverInvalidates,
    removeDevice: removeDeviceInvalidatesSidechain,
    setDeviceParameter: neverInvalidates,
    createBus: neverInvalidates,
    createFolder: neverInvalidates,
    setSend: neverInvalidates,
    setWorkspaceMode: neverInvalidates,
    openPreferencesDialog: neverInvalidates,
    openMixer: neverInvalidates,
    closeMixer: neverInvalidates,
    toggleSidebar: neverInvalidates,
    toggleInspector: neverInvalidates,
    toggleChatPanel: neverInvalidates,
    setEditingTool: neverInvalidates,
    setMarqueeSelection: neverInvalidates,
    addMarker: neverInvalidates,
    removeMarker: neverInvalidates,
    setMarkerColor: neverInvalidates,
    addSection: neverInvalidates,
    removeSection: neverInvalidates,
    renameSection: neverInvalidates,
    addAutomationLane: neverInvalidates,
    automateSendRange: neverInvalidates,
    automateSendRanges: neverInvalidates,
    automateTrackGainRange: neverInvalidates,
    automateParameterRange: neverInvalidates,
    renderProjectSections: neverInvalidates,
    addAutomationPoint: neverInvalidates,
    setAutomationLaneEnabled: neverInvalidates,
    quantizeNotes: neverInvalidates,
    editMidiNotes: neverInvalidates,
    removeShortMidiOverlaps: neverInvalidates,
    createDrumPreviewBranches: neverInvalidates,
    copyMidiArticulations: neverInvalidates,
    quantizeNoteLengths: neverInvalidates,
    transposeNotes: neverInvalidates,
    humanizeNotes: neverInvalidates,
    invertNotes: neverInvalidates,
    retrogradeNotes: neverInvalidates,
    scaleVelocities: neverInvalidates,
    scaleAllVelocities: neverInvalidates,
    setAllVelocities: neverInvalidates,
    normalizeClip: neverInvalidates,
    reverseClip: neverInvalidates,
    glueClips: neverInvalidates,
    nudgeClip: neverInvalidates,
    slipClipContent: neverInvalidates,
    crossfadeClips: neverInvalidates,
    setClipGain: neverInvalidates,
    setClipColor: neverInvalidates,
    lockClip: neverInvalidates,
    renameClip: neverInvalidates,
    consolidateSelection: neverInvalidates,
    bounceSelection: neverInvalidates,
    seekPlayhead: neverInvalidates,
    setPunchIn: neverInvalidates,
    setPunchOut: neverInvalidates,
    setPunchEnabled: neverInvalidates,
    toggleCountIn: neverInvalidates,
    setCountInBars: neverInvalidates,
    togglePreRoll: neverInvalidates,
    setPreRollBars: neverInvalidates,
    addTimeSignatureChange: neverInvalidates,
    removeTimeSignatureChange: neverInvalidates,
    setTrackOutput: neverInvalidates,
    addSend: neverInvalidates,
    removeSend: neverInvalidates,
    setAutomationMode: neverInvalidates,
    hideTrack: neverInvalidates,
    disableTrack: neverInvalidates,
    setTrackHeight: neverInvalidates,
    setSnapValue: neverInvalidates,
    zoomToFit: neverInvalidates,
    zoomToSelection: neverInvalidates,
    exportProject: neverInvalidates,
    saveProject: neverInvalidates,
    newProject: neverInvalidates,
    exportMidi: neverInvalidates,
    foldTrack: neverInvalidates,
    groupTracks: neverInvalidates,
    ungroupTracks: neverInvalidates,
    scaleAutomation: neverInvalidates,
    stretchAutomation: neverInvalidates,
    invertAutomation: neverInvalidates,
    reverseAutomation: neverInvalidates,
    thinAutomation: neverInvalidates,
    quantizeAutomation: neverInvalidates,
    savePreset: neverInvalidates,
    generateDrumPattern: neverInvalidates,
    generateMelody: neverInvalidates,
    generateChordProgression: neverInvalidates,
    setClipLoop: neverInvalidates,
    setClipLoopLength: neverInvalidates,
    extractGroove: neverInvalidates,
    applyGroove: neverInvalidates,
    setClipStretchMode: neverInvalidates,
    setClipStretchRatio: neverInvalidates,
    fitClipToBeats: neverInvalidates,
    analyzeMix: neverInvalidates,
    enableMpe: neverInvalidates,
    disableMpe: neverInvalidates,
    getLatencyReport: neverInvalidates,
    createCollabSession: neverInvalidates,
    joinCollabSession: neverInvalidates,
    leaveCollabSession: neverInvalidates,
    scanPlugins: neverInvalidates,
    muteClip: neverInvalidates,
    clearSolos: neverInvalidates,
    setTrackNotes: neverInvalidates,
    zoomTracksVertical: neverInvalidates,
    deleteTime: neverInvalidates,
    insertTime: neverInvalidates,
    duplicateTimeRange: neverInvalidates,
    stripSilence: neverInvalidates,
    detectTempo: neverInvalidates,
    detectKey: neverInvalidates,
    consolidateAllTracks: neverInvalidates,
    arpeggiate: neverInvalidates,
    addSidechainRoute: neverInvalidates,
    removeSidechainRoute: neverInvalidates,
    bounceToNewTrack: neverInvalidates,
    createTrackAlternative: neverInvalidates,
    switchTrackAlternative: neverInvalidates,
    renameTrackAlternative: neverInvalidates,
    deleteTrackAlternative: neverInvalidates,
    addChordEvent: neverInvalidates,
    addNotes: neverInvalidates,
    addYeastProcessor: neverInvalidates,
    assignToVca: neverInvalidates,
    clearChordTrack: neverInvalidates,
    clearMidiOutput: neverInvalidates,
    connectPush: neverInvalidates,
    createAdjustmentLayer: neverInvalidates,
    addAdjustmentRegion: neverInvalidates,
    createCompGroup: neverInvalidates,
    createPatternInstance: neverInvalidates,
    createVcaGroup: neverInvalidates,
    deleteMacro: neverInvalidates,
    deleteTrackTemplate: neverInvalidates,
    detachPatternInstance: neverInvalidates,
    disconnectPush: neverInvalidates,
    exportDawProject: neverInvalidates,
    labelUndoBranch: neverInvalidates,
    loadTrackTemplate: neverInvalidates,
    nextSetlistItem: neverInvalidates,
    playMacro: neverInvalidates,
    previousSetlistItem: neverInvalidates,
    quantizeTransients: neverInvalidates,
    redo: neverInvalidates,
    removeChordEvent: neverInvalidates,
    removeFromVca: neverInvalidates,
    removeYeastProcessor: neverInvalidates,
    reorderYeastProcessor: neverInvalidates,
    saveTrackTemplate: neverInvalidates,
    setControlSurface: neverInvalidates,
    setMidiOutput: neverInvalidates,
    setVcaGain: neverInvalidates,
    setYeastArpPattern: neverInvalidates,
    setYeastProcessorBypass: neverInvalidates,
    setYeastProcessorParam: neverInvalidates,
    startMacroRecording: neverInvalidates,
    stopMacroRecording: neverInvalidates,
    switchMonitor: neverInvalidates,
    toggleChordTrack: neverInvalidates,
    toggleControlRoomDim: neverInvalidates,
    toggleControlRoomMono: neverInvalidates,
    toggleLoopRecord: neverInvalidates,
    toggleNodeView: neverInvalidates,
    togglePunchRecording: neverInvalidates,
    toggleScratchPad: neverInvalidates,
    toggleUndoTree: neverInvalidates,
    triggerScene: neverInvalidates,
    undo: neverInvalidates,
};

function lookupSidechainInvalidation<Type extends RuntimeActionType>(
    action: ActionOf<Type>,
    plan: SidechainPlan
): boolean {
    if (!Object.hasOwn(sidechainInvalidationByActionType, action.type)) {
        return neverInvalidates();
    }
    return sidechainInvalidationByActionType[action.type](action, plan);
}

export function hasInvalidatingSidechainLifecycleMutation(
    actions: readonly RuntimeAction[],
    context: ProjectContext,
    acceptsSidechainInput: (deviceType: string) => boolean
): boolean {
    const allSidechainAdds = actions.filter(isAddSidechainRuntimeAction);
    const plannedSidechainAdds: AddSidechainRuntimeAction[] = [];

    for (const action of actions) {
        if (isAddSidechainRuntimeAction(action)) {
            plannedSidechainAdds.push(action);
            continue;
        }
        if (
            lookupSidechainInvalidation(action, {
                acceptsSidechainInput,
                allSidechainAdds,
                context,
                plannedSidechainAdds,
            })
        ) {
            return true;
        }
    }
    return false;
}
