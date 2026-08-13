import { type AppActionType } from '#/utils/handlerContract';

import { isExecutableAppActionType } from './executableAppActionRegistry';
import { getExecutableCommandRegistration } from './getExecutableCommandRegistration';

type AppActionRisk =
    | 'read-only'
    | 'bounded-reversible'
    | 'broad-reversible'
    | 'destructive-reversible'
    | 'authority-sensitive'
    | 'external-effect'
    | 'unclassified';

type AppActionExecutionPolicy = {
    classification: 'explicit' | 'default';
    risk: AppActionRisk;
    requiresConfirmation: boolean;
    reason: string | null;
};

const readOnlyPolicy: AppActionExecutionPolicy = {
    classification: 'explicit',
    risk: 'read-only',
    requiresConfirmation: false,
    reason: null,
};

const boundedPolicy: AppActionExecutionPolicy = {
    classification: 'explicit',
    risk: 'bounded-reversible',
    requiresConfirmation: false,
    reason: null,
};

const broadPolicy: AppActionExecutionPolicy = {
    classification: 'explicit',
    risk: 'broad-reversible',
    requiresConfirmation: true,
    reason: 'This action can change a broad section of the project.',
};

const destructivePolicy: AppActionExecutionPolicy = {
    classification: 'explicit',
    risk: 'destructive-reversible',
    requiresConfirmation: true,
    reason: 'This action removes or replaces project content.',
};

const authoritySensitivePolicy: AppActionExecutionPolicy = {
    classification: 'explicit',
    risk: 'authority-sensitive',
    requiresConfirmation: true,
    reason: 'This action changes project-wide timing, gain, recording, or signal routing.',
};

const externalEffectPolicy: AppActionExecutionPolicy = {
    classification: 'explicit',
    risk: 'external-effect',
    requiresConfirmation: true,
    reason: 'This action affects resources or sessions outside the current project.',
};

const defaultPolicy: AppActionExecutionPolicy = {
    classification: 'default',
    risk: 'unclassified',
    requiresConfirmation: true,
    reason: 'This action has no explicit execution policy and must be reviewed.',
};

const executionPolicies = {
    analyzeMix: readOnlyPolicy,
    copyClip: readOnlyPolicy,
    detectKey: readOnlyPolicy,
    detectTempo: readOnlyPolicy,
    getLatencyReport: readOnlyPolicy,

    addAutomationLane: boundedPolicy,
    addDevice: boundedPolicy,
    applyGroove: boundedPolicy,
    arpeggiate: boundedPolicy,
    closeMixer: boundedPolicy,
    copyMidiArticulations: broadPolicy,
    removeShortMidiOverlaps: broadPolicy,
    createFolder: boundedPolicy,
    disableMpe: boundedPolicy,
    disableTrack: boundedPolicy,
    duplicateClip: boundedPolicy,
    duplicateClipToNextBar: boundedPolicy,
    enableMpe: boundedPolicy,
    extractGroove: boundedPolicy,
    fitClipToBeats: boundedPolicy,
    foldTrack: boundedPolicy,
    hideTrack: boundedPolicy,
    humanizeNotes: boundedPolicy,
    invertNotes: boundedPolicy,
    lockClip: boundedPolicy,
    muteClip: boundedPolicy,
    nudgeClip: boundedPolicy,
    openMixer: boundedPolicy,
    openPreferencesDialog: boundedPolicy,
    pasteClip: boundedPolicy,
    quantizeNoteLengths: boundedPolicy,
    quantizeNotes: boundedPolicy,
    renameClip: boundedPolicy,
    retrogradeNotes: boundedPolicy,
    scaleVelocities: boundedPolicy,
    setAllVelocities: boundedPolicy,
    setClipLoop: boundedPolicy,
    setClipLoopLength: boundedPolicy,
    setClipStretchMode: boundedPolicy,
    setClipStretchRatio: boundedPolicy,
    setSoloSafe: boundedPolicy,
    setWorkspaceMode: boundedPolicy,
    stopPlayback: boundedPolicy,
    toggleChatPanel: boundedPolicy,
    toggleCountIn: boundedPolicy,
    toggleInspector: boundedPolicy,
    toggleLoop: boundedPolicy,
    toggleMetronome: boundedPolicy,
    togglePlayback: boundedPolicy,
    togglePreRoll: boundedPolicy,
    togglePunch: boundedPolicy,
    toggleSidebar: boundedPolicy,
    toggleSoloSafe: boundedPolicy,
    transposeNotes: boundedPolicy,
    zoomToFit: boundedPolicy,
    zoomToSelection: boundedPolicy,

    audioToMidi: broadPolicy,
    autoFixMix: broadPolicy,
    bounceToNewTrack: broadPolicy,
    clearSolos: broadPolicy,
    restoreSoloSafe: broadPolicy,
    restoreTrackSoloStates: broadPolicy,
    consolidateAllTracks: broadPolicy,
    freezeTrack: broadPolicy,
    generateChordProgression: broadPolicy,
    generateDrumPattern: broadPolicy,
    generateMelody: broadPolicy,
    redo: broadPolicy,
    undo: broadPolicy,
    unfreezeTrack: broadPolicy,

    bounceInPlace: destructivePolicy,
    cutClip: destructivePolicy,
    normalizeClip: destructivePolicy,
    removeAllTracks: destructivePolicy,
    removeClip: destructivePolicy,
    removeDevice: destructivePolicy,
    removeTrack: destructivePolicy,
    reverseClip: destructivePolicy,
    stripSilence: destructivePolicy,

    armTrack: authoritySensitivePolicy,
    setMasterGain: authoritySensitivePolicy,
    toggleRecording: authoritySensitivePolicy,

    createCollabSession: externalEffectPolicy,
    joinCollabSession: externalEffectPolicy,
    scanPlugins: externalEffectPolicy,
} satisfies Partial<Record<AppActionType, AppActionExecutionPolicy>>;
const executionPolicyByActionType: Partial<Record<string, AppActionExecutionPolicy>> = executionPolicies;

export function getAppActionExecutionPolicy(actionType: string): AppActionExecutionPolicy {
    if (isExecutableAppActionType(actionType)) {
        const registration = getExecutableCommandRegistration(actionType);
        return {
            classification: 'explicit',
            risk: registration.risk,
            requiresConfirmation: registration.confirmation.required,
            reason: registration.confirmation.reason,
        };
    }
    return executionPolicyByActionType[actionType] ?? defaultPolicy;
}
