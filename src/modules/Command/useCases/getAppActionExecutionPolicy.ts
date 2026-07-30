import { type AppActionType } from '#/utils/handlerContract';

type AppActionRisk = 'bounded-reversible' | 'broad-reversible' | 'destructive-reversible' | 'authority-sensitive';

type AppActionExecutionPolicy = {
    classification: 'explicit' | 'default';
    risk: AppActionRisk;
    requiresConfirmation: boolean;
    reason: string | null;
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
    reason: 'This action changes project-wide timing, gain, or signal routing.',
};

const defaultPolicy: AppActionExecutionPolicy = {
    classification: 'default',
    risk: 'bounded-reversible',
    requiresConfirmation: false,
    reason: null,
};

const executionPolicies = {
    addTrack: boundedPolicy,
    renameTrack: boundedPolicy,
    muteTrack: boundedPolicy,
    soloTrack: boundedPolicy,
    duplicateTrack: broadPolicy,
    setTrackGain: boundedPolicy,
    setTrackPan: boundedPolicy,
    setTrackColor: boundedPolicy,
    reorderTrack: boundedPolicy,
    setTrackOutput: authoritySensitivePolicy,
    setTempo: authoritySensitivePolicy,
    setDeviceParameter: boundedPolicy,
    bypassDevice: boundedPolicy,
    setSend: authoritySensitivePolicy,
    addSend: authoritySensitivePolicy,
    removeSend: authoritySensitivePolicy,
    setMasterGain: authoritySensitivePolicy,
    removeTrack: destructivePolicy,
    removeAllTracks: destructivePolicy,
    removeClip: destructivePolicy,
    removeDevice: destructivePolicy,
    bounceInPlace: destructivePolicy,
} satisfies Partial<Record<AppActionType, AppActionExecutionPolicy>>;
const executionPolicyByActionType: Partial<Record<string, AppActionExecutionPolicy>> = executionPolicies;

export function getAppActionExecutionPolicy(actionType: string): AppActionExecutionPolicy {
    return executionPolicyByActionType[actionType] ?? defaultPolicy;
}
