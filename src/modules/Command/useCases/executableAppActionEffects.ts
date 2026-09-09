import { type ExecutableAppActionType, isExecutableAppActionType } from './executableAppActionRegistry';

// Command-owned effect metadata: `dimensions` names what the production handler and its writer
// actually mutate, traced through that handler, not what the request implies. `scope` names how far
// the write or audible change reaches beyond the named target. `conditional` entries name writes that
// depend on live runtime state at execution time and therefore need an execution-time policy, not a request-time check.

export type ExecutableAppActionEffectDimension =
    | 'processing'
    | 'midi-content'
    | 'clip-audio'
    | 'arrangement'
    | 'routing'
    | 'project-timing'
    | 'transport'
    | 'master'
    | 'monitoring'
    | 'automation'
    | 'external'
    | 'branching'
    | 'cosmetic'
    | 'protection';

export type ExecutableAppActionEffectCondition =
    | 'transport-playing-in-recording-mode'
    | 'folder-strip-activation'
    | 'midi-clip'
    | 'midi-track-kind'
    | 'recording-in-progress'
    | 'repitch-stretch-mode';

export type ExecutableAppActionEffectScope = 'target' | 'descendants' | 'siblings' | 'dependents' | 'project';

export type ExecutableAppActionEffectObject =
    | 'track'
    | 'bus'
    | 'clip'
    | 'notes'
    | 'device'
    | 'send'
    | 'sidechain-route'
    | 'automation-lane'
    | 'automation-point'
    | 'adjustment-region'
    | 'marker'
    | 'section'
    | 'vca-group'
    | 'branch'
    | 'render-artifact';

export type ExecutableAppActionNoteField = 'pitch' | 'startBeat' | 'duration' | 'velocity' | 'articulation';

export type ExecutableAppActionEffect = {
    dimensions: readonly ExecutableAppActionEffectDimension[];
    conditional?: readonly {
        dimension: ExecutableAppActionEffectDimension;
        when: ExecutableAppActionEffectCondition;
    }[];
    scope: ExecutableAppActionEffectScope;
    creates?: readonly ExecutableAppActionEffectObject[];
    removes?: readonly ExecutableAppActionEffectObject[];
    noteFields?: readonly ExecutableAppActionNoteField[];
};

export const executableAppActionEffectsByType = {
    importStemSet: {
        dimensions: ['arrangement', 'clip-audio', 'processing', 'external'],
        scope: 'target',
        creates: ['track', 'clip'],
    },
    addTrack: {
        dimensions: ['arrangement'],
        conditional: [{ dimension: 'processing', when: 'midi-track-kind' }],
        scope: 'target',
        creates: ['track'],
    },
    createBus: {
        dimensions: ['arrangement', 'routing'],
        scope: 'target',
        creates: ['bus'],
    },
    removeTrack: {
        dimensions: ['arrangement', 'routing', 'processing', 'clip-audio', 'midi-content', 'automation'],
        scope: 'dependents',
        removes: ['track', 'clip', 'notes', 'device', 'send', 'automation-lane', 'sidechain-route'],
    },
    addClip: {
        dimensions: ['arrangement'],
        scope: 'target',
        creates: ['clip'],
    },
    duplicateClip: {
        dimensions: ['arrangement', 'clip-audio', 'automation'],
        conditional: [{ dimension: 'midi-content', when: 'midi-clip' }],
        scope: 'target',
        creates: ['clip', 'notes', 'automation-lane'],
    },
    duplicateClipToNextBar: {
        dimensions: ['arrangement', 'clip-audio', 'automation'],
        conditional: [{ dimension: 'midi-content', when: 'midi-clip' }],
        scope: 'target',
        creates: ['clip', 'notes', 'automation-lane'],
    },
    // Ripple delete shifts sibling clips on the same track to close the gap the removal leaves.
    removeClip: {
        dimensions: ['arrangement', 'clip-audio', 'automation'],
        conditional: [{ dimension: 'midi-content', when: 'midi-clip' }],
        scope: 'siblings',
        removes: ['clip', 'notes', 'automation-lane'],
    },
    moveClip: {
        dimensions: ['arrangement', 'automation'],
        scope: 'target',
    },
    splitClip: {
        dimensions: ['arrangement', 'clip-audio', 'automation'],
        conditional: [{ dimension: 'midi-content', when: 'midi-clip' }],
        scope: 'target',
        creates: ['clip'],
    },
    renameClip: {
        dimensions: ['arrangement'],
        scope: 'target',
    },
    trimClipStart: {
        dimensions: ['arrangement', 'clip-audio'],
        scope: 'target',
    },
    trimClipEnd: {
        dimensions: ['arrangement'],
        scope: 'target',
    },
    nudgeClip: {
        dimensions: ['arrangement', 'automation'],
        scope: 'target',
    },
    slipClipContent: {
        dimensions: ['clip-audio'],
        conditional: [{ dimension: 'midi-content', when: 'midi-clip' }],
        scope: 'target',
    },
    drawClip: {
        dimensions: ['arrangement'],
        scope: 'siblings',
        creates: ['clip'],
    },
    duplicateClipAt: {
        dimensions: ['arrangement', 'clip-audio', 'automation'],
        conditional: [{ dimension: 'midi-content', when: 'midi-clip' }],
        scope: 'target',
        creates: ['clip', 'notes', 'automation-lane'],
    },
    moveClips: {
        dimensions: ['arrangement', 'automation'],
        scope: 'siblings',
    },
    setClipGain: {
        dimensions: ['clip-audio'],
        scope: 'target',
    },
    muteClip: {
        dimensions: ['monitoring'],
        scope: 'target',
    },
    setClipColor: {
        dimensions: ['cosmetic'],
        scope: 'target',
    },
    setClipFade: {
        dimensions: ['clip-audio'],
        scope: 'target',
    },
    glueClips: {
        dimensions: ['midi-content', 'arrangement', 'automation'],
        scope: 'target',
        creates: ['clip'],
        removes: ['clip'],
        noteFields: ['startBeat'],
    },
    crossfadeClips: {
        dimensions: ['clip-audio', 'arrangement'],
        scope: 'target',
    },
    lockClip: {
        dimensions: ['protection'],
        scope: 'target',
    },
    setClipLoop: {
        dimensions: ['arrangement'],
        scope: 'target',
    },
    setClipLoopLength: {
        dimensions: ['arrangement'],
        scope: 'target',
    },
    normalizeClip: {
        dimensions: ['clip-audio'],
        scope: 'target',
    },
    setClipStretchMode: {
        dimensions: ['clip-audio'],
        scope: 'target',
    },
    setClipStretchRatio: {
        dimensions: ['clip-audio'],
        conditional: [{ dimension: 'arrangement', when: 'repitch-stretch-mode' }],
        scope: 'target',
    },
    fitClipToBeats: {
        dimensions: ['clip-audio', 'arrangement'],
        scope: 'target',
    },
    addNotes: {
        dimensions: ['midi-content'],
        scope: 'target',
        creates: ['notes'],
    },
    quantizeNotes: {
        dimensions: ['midi-content'],
        scope: 'target',
        noteFields: ['startBeat'],
    },
    removeShortMidiOverlaps: {
        dimensions: ['midi-content'],
        scope: 'target',
        noteFields: ['duration'],
    },
    arpeggiate: {
        dimensions: ['midi-content'],
        scope: 'target',
        creates: ['notes'],
        removes: ['notes'],
        noteFields: ['pitch', 'startBeat', 'duration', 'velocity'],
    },
    createDrumPreviewBranches: {
        dimensions: ['branching'],
        scope: 'target',
        creates: ['branch'],
    },
    copyMidiArticulations: {
        dimensions: ['midi-content'],
        scope: 'target',
        noteFields: ['articulation'],
    },
    transposeNotes: {
        dimensions: ['midi-content'],
        scope: 'target',
        noteFields: ['pitch'],
    },
    invertNotes: {
        dimensions: ['midi-content'],
        scope: 'target',
        noteFields: ['pitch'],
    },
    retrogradeNotes: {
        dimensions: ['midi-content'],
        scope: 'target',
        noteFields: ['startBeat'],
    },
    quantizeNoteLengths: {
        dimensions: ['midi-content'],
        scope: 'target',
        noteFields: ['duration'],
    },
    scaleAllVelocities: {
        dimensions: ['midi-content'],
        scope: 'target',
        noteFields: ['velocity'],
    },
    setAllVelocities: {
        dimensions: ['midi-content'],
        scope: 'target',
        noteFields: ['velocity'],
    },
    renameTrack: {
        dimensions: ['arrangement'],
        scope: 'target',
    },
    muteTrack: {
        dimensions: ['monitoring'],
        scope: 'target',
    },
    soloTrack: {
        dimensions: ['monitoring'],
        scope: 'project',
    },
    selectTake: {
        dimensions: ['arrangement'],
        scope: 'target',
    },
    setSoloSafe: {
        dimensions: ['monitoring'],
        scope: 'target',
    },
    clearSolos: {
        dimensions: ['monitoring'],
        scope: 'project',
    },
    armTrack: {
        dimensions: ['monitoring'],
        conditional: [{ dimension: 'routing', when: 'midi-track-kind' }],
        scope: 'dependents',
    },
    duplicateTrack: {
        dimensions: ['arrangement', 'routing', 'processing', 'clip-audio', 'midi-content', 'automation'],
        scope: 'target',
        creates: ['track', 'device', 'clip', 'notes', 'automation-lane'],
    },
    setTrackGain: {
        dimensions: ['processing'],
        conditional: [{ dimension: 'automation', when: 'transport-playing-in-recording-mode' }],
        scope: 'target',
    },
    setTrackPan: {
        dimensions: ['processing'],
        conditional: [{ dimension: 'automation', when: 'transport-playing-in-recording-mode' }],
        scope: 'target',
    },
    setTrackColor: {
        dimensions: ['cosmetic'],
        scope: 'target',
    },
    reorderTrack: {
        dimensions: ['arrangement'],
        scope: 'target',
    },
    setTempo: {
        dimensions: ['project-timing'],
        scope: 'project',
    },
    setTimeSignature: {
        dimensions: ['project-timing'],
        scope: 'project',
    },
    setPlayback: {
        dimensions: ['transport'],
        conditional: [
            { dimension: 'clip-audio', when: 'recording-in-progress' },
            { dimension: 'midi-content', when: 'recording-in-progress' },
        ],
        scope: 'project',
    },
    stopPlayback: {
        dimensions: ['transport'],
        conditional: [
            { dimension: 'clip-audio', when: 'recording-in-progress' },
            { dimension: 'midi-content', when: 'recording-in-progress' },
        ],
        scope: 'project',
    },
    seekPlayhead: {
        dimensions: ['transport'],
        conditional: [
            { dimension: 'clip-audio', when: 'recording-in-progress' },
            { dimension: 'midi-content', when: 'recording-in-progress' },
        ],
        scope: 'project',
    },
    addMarker: {
        dimensions: ['arrangement'],
        scope: 'target',
        creates: ['marker'],
    },
    removeMarker: {
        dimensions: ['arrangement'],
        scope: 'target',
        removes: ['marker'],
    },
    setMarkerColor: {
        dimensions: ['cosmetic'],
        scope: 'target',
    },
    addSection: {
        dimensions: ['arrangement'],
        scope: 'target',
        creates: ['section'],
    },
    removeSection: {
        dimensions: ['arrangement'],
        scope: 'target',
        removes: ['section'],
    },
    renameSection: {
        dimensions: ['arrangement'],
        scope: 'target',
    },
    setLoopEnabled: {
        dimensions: ['transport'],
        scope: 'project',
    },
    setLoopRegion: {
        dimensions: ['project-timing'],
        scope: 'project',
    },
    setPunchIn: {
        dimensions: ['project-timing'],
        scope: 'project',
    },
    setPunchOut: {
        dimensions: ['project-timing'],
        scope: 'project',
    },
    setPunchEnabled: {
        dimensions: ['transport'],
        scope: 'project',
    },
    setMetronomeEnabled: {
        dimensions: ['monitoring'],
        scope: 'project',
    },
    setMetronomeVolume: {
        dimensions: ['monitoring'],
        scope: 'project',
    },
    setMasterGain: {
        dimensions: ['master'],
        scope: 'project',
    },
    setVcaGain: {
        dimensions: ['processing'],
        scope: 'descendants',
    },
    createVcaGroup: {
        dimensions: ['routing'],
        scope: 'dependents',
        creates: ['vca-group'],
    },
    assignToVca: {
        dimensions: ['routing'],
        scope: 'dependents',
    },
    removeFromVca: {
        dimensions: ['routing'],
        scope: 'target',
    },
    // A device that makes a dormant folder track live also spins up live strips for its descendant tracks.
    addDevice: {
        dimensions: ['processing'],
        conditional: [{ dimension: 'external', when: 'folder-strip-activation' }],
        scope: 'descendants',
        creates: ['device'],
    },
    removeDevice: {
        dimensions: ['processing'],
        conditional: [{ dimension: 'external', when: 'folder-strip-activation' }],
        scope: 'siblings',
        removes: ['device'],
    },
    setDeviceParameter: {
        dimensions: ['processing'],
        conditional: [{ dimension: 'automation', when: 'transport-playing-in-recording-mode' }],
        scope: 'target',
    },
    // The writer maps every track's device list to find the target device; only that device's bypass flag changes.
    bypassDevice: {
        dimensions: ['processing'],
        scope: 'target',
    },
    addSend: {
        dimensions: ['routing'],
        scope: 'target',
        creates: ['send'],
    },
    setSend: {
        dimensions: ['routing'],
        scope: 'target',
    },
    removeSend: {
        dimensions: ['routing'],
        scope: 'target',
        removes: ['send'],
    },
    setTrackOutput: {
        dimensions: ['routing'],
        scope: 'dependents',
    },
    addSidechainRoute: {
        dimensions: ['routing', 'processing'],
        scope: 'target',
        creates: ['sidechain-route'],
    },
    removeSidechainRoute: {
        dimensions: ['routing', 'processing'],
        scope: 'target',
        removes: ['sidechain-route'],
    },
    addAdjustmentRegion: {
        dimensions: ['processing'],
        scope: 'descendants',
        creates: ['adjustment-region'],
    },
    automateSendRange: {
        dimensions: ['automation'],
        scope: 'target',
        creates: ['automation-lane', 'automation-point'],
    },
    automateTrackGainRange: {
        dimensions: ['automation'],
        scope: 'target',
        creates: ['automation-lane', 'automation-point'],
    },
    automateSendRanges: {
        dimensions: ['automation'],
        scope: 'target',
        creates: ['automation-lane', 'automation-point'],
    },
    renderProjectSections: {
        dimensions: ['external'],
        scope: 'target',
        creates: ['render-artifact'],
    },
    addAutomationLane: {
        dimensions: ['automation'],
        scope: 'target',
        creates: ['automation-lane'],
    },
    addAutomationPoint: {
        dimensions: ['automation'],
        scope: 'target',
        creates: ['automation-point'],
    },
    setAutomationLaneEnabled: {
        dimensions: ['automation'],
        scope: 'target',
    },
    setAutomationMode: {
        dimensions: ['automation'],
        scope: 'target',
    },
    scaleAutomation: {
        dimensions: ['automation'],
        scope: 'dependents',
    },
    stretchAutomation: {
        dimensions: ['automation'],
        scope: 'dependents',
    },
    invertAutomation: {
        dimensions: ['automation'],
        scope: 'dependents',
    },
    reverseAutomation: {
        dimensions: ['automation'],
        scope: 'dependents',
    },
    thinAutomation: {
        dimensions: ['automation'],
        scope: 'dependents',
        removes: ['automation-point'],
    },
    quantizeAutomation: {
        dimensions: ['automation'],
        scope: 'dependents',
        removes: ['automation-point'],
    },
} as const satisfies Record<ExecutableAppActionType, ExecutableAppActionEffect>;

export function getExecutableAppActionEffect(actionType: string): ExecutableAppActionEffect | null {
    if (!isExecutableAppActionType(actionType)) {
        return null;
    }
    return executableAppActionEffectsByType[actionType];
}
