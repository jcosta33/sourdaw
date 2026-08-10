import { getAppActionExecutionPolicy } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../models/ProjectContext';
import { type WholeProjectVibeMixPlan } from '../models/WholeProjectVibeMixPlan';

import { getBulkDeviceInsertionTrackScope } from './agentReference/getBulkDeviceInsertionTrackScope';
import { getDeviceParameterPromptScope } from './agentReference/getDeviceParameterPromptScope';
import { getMutedEmptyTrackDeletionScope } from './agentReference/getMutedEmptyTrackDeletionScope';
import { describePlannedAction } from './describePlannedAction';
import { getPlannedActionAffectedIds } from './getPlannedActionAffectedIds';

type DescribePendingActionConfirmationInput = {
    actions: readonly AppAction[];
    context: ProjectContext;
    prompt: string;
    wholeProjectVibeMixPlan?: WholeProjectVibeMixPlan;
};

const riskRank = {
    'read-only': 0,
    'bounded-reversible': 1,
    'broad-reversible': 2,
    'destructive-reversible': 3,
    'authority-sensitive': 4,
    'external-effect': 5,
    unclassified: 6,
} as const;

function normalizeText(value: string): string {
    return value
        .toLocaleLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function formatParameterValue(value: number, unit: string): string {
    if (unit === ':1') {
        return `${String(value)}:1`;
    }
    if (unit) {
        return `${String(value)} ${unit}`;
    }
    return String(value);
}

function describeDeviceParameterAction(
    action: Extract<AppAction, { type: 'setDeviceParameter' }>,
    context: ProjectContext
): string | null {
    const matchingTracks = context.tracks.filter((track) =>
        track.devices.some((device) => device.id === action.payload.deviceId)
    );
    let owner = matchingTracks.length === 1 ? matchingTracks[0] : undefined;
    if (action.payload.expectedTrackId !== undefined) {
        owner = matchingTracks.find((candidate) => candidate.id === action.payload.expectedTrackId);
    }
    const device = owner?.devices.find((candidate) => candidate.id === action.payload.deviceId);
    const parameter = device?.parameters?.find((candidate) => candidate.id === action.payload.paramId);
    const previousValue = action.payload.expectedValue ?? parameter?.value;
    if (!owner || !device || !parameter || previousValue === undefined) {
        return null;
    }
    const deviceName = device.name ?? device.type;
    return `Set "${owner.name}" (${owner.id}) device "${deviceName}" (${device.id}, ${device.type}) parameter "${parameter.name}" (${parameter.id}) from ${formatParameterValue(previousValue, parameter.unit)} to ${formatParameterValue(action.payload.value, parameter.unit)}`;
}

function getProtectedUnchangedTracks(
    prompt: string,
    context: ProjectContext,
    wholeProjectVibeMixPlan?: WholeProjectVibeMixPlan
): Array<{ id: string; name: string }> {
    const protectedScopes = [
        ...prompt.matchAll(/\b(?:leave|leaving|keep|keeping|preserve|preserving)\s+(.+?)\s+unchanged\b/giu),
    ].flatMap((match) => (match[1] ? [normalizeText(match[1])] : []));
    const excludedFrozenTrackIds = new Set(
        getBulkDeviceInsertionTrackScope(prompt, context)?.excludedFrozenTrackIds ?? []
    );
    const structurallyProtectedTrackIds = new Set(
        getMutedEmptyTrackDeletionScope(prompt, context)?.protectedTrackIds ?? []
    );
    const protectedTracks = context.tracks.filter((track) => {
        const normalizedName = normalizeText(track.name);
        return (
            excludedFrozenTrackIds.has(track.id) ||
            structurallyProtectedTrackIds.has(track.id) ||
            protectedScopes.some((scope) => ` ${scope} `.includes(` ${normalizedName} `))
        );
    });
    const deviceParameterScope = getDeviceParameterPromptScope(prompt, context);
    let protectedParameters: Array<{ id: string; name: string }> = [];
    if (deviceParameterScope) {
        const deviceName = deviceParameterScope.device.name ?? deviceParameterScope.device.type;
        protectedParameters = deviceParameterScope.protectedParameters.map((parameter) => ({
            id: `${deviceParameterScope.device.id}:${parameter.id}`,
            name: `${deviceParameterScope.track.name} ${deviceName} ${parameter.name} = ${String(parameter.value)}${parameter.unit === ':1' ? ':1' : ` ${parameter.unit}`}`,
        }));
    }
    const planProtections = wholeProjectVibeMixPlan?.globalConstraints.map(({ id, name }) => ({ id, name })) ?? [];
    const protections = [
        ...protectedTracks.map(({ id, name }) => ({ id, name })),
        ...protectedParameters,
        ...planProtections,
    ];
    return [...new Map(protections.map((protection) => [protection.id, protection])).values()];
}

function describeWholeProjectVibeMixPlan(plan: WholeProjectVibeMixPlan): string {
    let previous = 'none';
    if (plan.sectionMap.previous) {
        previous = `"${plan.sectionMap.previous.name}" (${plan.sectionMap.previous.id})`;
    }
    let next = 'none';
    if (plan.sectionMap.next) {
        next = `"${plan.sectionMap.next.name}" (${plan.sectionMap.next.id})`;
    }
    const roles = plan.trackRoles.map((track) => `- ${track.role}: "${track.trackName}" (${track.trackId})`).join('\n');
    const decisions = plan.acceptedDecisions.map((decision) => `- ${decision}`).join('\n');
    return `Whole-project plan (schema ${String(plan.schemaVersion)}, revision ${plan.baseRevision}):\n\nProduction vision: ${plan.productionVision}\n\nSection map: target "${plan.sectionMap.target.name}" (${plan.sectionMap.target.id}) beats ${String(plan.sectionMap.target.startBeat)}–${String(plan.sectionMap.target.endBeat)}; previous ${previous}; next ${next}.\n\nTrack roles:\n${roles}\n\nDynamic trajectory: preserve before beat ${String(plan.dynamicTrajectory.startBeat)}, lift impact buses by ${String(plan.dynamicTrajectory.gainDb)} dB through beat ${String(plan.dynamicTrajectory.endBeat)}, then restore current gain.\n\nMix strategy: routing ${plan.strategy.routing}; devices ${plan.strategy.devices}; automation ${plan.strategy.automation}\n\nAccepted decisions:\n${decisions}`;
}

function describeExactAction(action: AppAction, actions: readonly AppAction[], context: ProjectContext): string {
    if (action.type === 'createBus' && action.payload.busId) {
        return `Create bus "${action.payload.name}" (${action.payload.busId})`;
    }
    if (action.type === 'setTrackOutput') {
        const source = context.tracks.find((track) => track.id === action.payload.trackId);
        const existingTarget = context.tracks.find((track) => track.id === action.payload.outputId);
        const createdTarget = actions.find(
            (candidate) => candidate.type === 'createBus' && candidate.payload.busId === action.payload.outputId
        );
        const targetName =
            existingTarget?.name ?? (createdTarget?.type === 'createBus' ? createdTarget.payload.name : null);
        if (source && targetName) {
            const previousOutput = action.payload.expectedOutputId ?? source.outputId ?? 'master';
            return `Route "${source.name}" (${source.id}) from ${previousOutput} to "${targetName}" (${action.payload.outputId})`;
        }
    }
    if (action.type === 'setDeviceParameter') {
        const description = describeDeviceParameterAction(action, context);
        if (description) {
            return description;
        }
    }
    if (action.type === 'automateTrackGainRange' && action.payload.expectedTracks) {
        const targets = action.payload.expectedTracks
            .map(
                (track) =>
                    `"${track.trackName}" (${track.trackId}) ${String(track.gain)}→${String(track.gain * 10 ** (action.payload.gainDb / 20))}`
            )
            .join(', ');
        return `Lift ${targets} by ${String(action.payload.gainDb)} dB only in ${action.payload.sectionName} beats ${String(action.payload.startBeat)}–${String(action.payload.endBeat)}`;
    }
    return describePlannedAction({ action, context });
}

export function describePendingActionConfirmation({
    actions,
    context,
    prompt,
    wholeProjectVibeMixPlan,
}: DescribePendingActionConfirmationInput) {
    const actionLabels = actions.map((action) => describeExactAction(action, actions, context));
    const affectedIds = [...new Set(actions.flatMap((action) => getPlannedActionAffectedIds(action)))];
    const policies = actions.map((action) => getAppActionExecutionPolicy(action.type));
    const riskPolicy = policies.reduce((highest, policy) =>
        riskRank[policy.risk] > riskRank[highest.risk] ? policy : highest
    );
    let risk = {
        level: riskPolicy.risk,
        reason: riskPolicy.reason,
    };
    if (
        actions.length > 1 &&
        actions.every((action) => action.type === 'addDevice') &&
        riskPolicy.risk === 'bounded-reversible'
    ) {
        risk = {
            level: 'broad-reversible',
            reason: 'This applies the same change to multiple project targets.',
        };
    }
    const protectedUnchanged = getProtectedUnchangedTracks(prompt, context, wholeProjectVibeMixPlan);
    const intendedChanges = actions
        .map((action, index) => `- **${action.type}**: ${actionLabels[index] ?? action.type}`)
        .join('\n');
    const protectedSummary = protectedUnchanged.map((target) => `"${target.name}" (${target.id})`).join(', ');
    const affectedSummary = affectedIds.join(', ');
    const riskReason = risk.reason ? ` — ${risk.reason}` : '';
    const protectedLine = protectedSummary ? `\n\nProtected unchanged: ${protectedSummary}` : '';
    let planSummary = '';
    if (wholeProjectVibeMixPlan) {
        planSummary = `${describeWholeProjectVibeMixPlan(wholeProjectVibeMixPlan)}\n\n`;
    }
    const content = `${planSummary}This prompt requires confirmation before execution.\n\nRisk: ${risk.level}${riskReason}\n\nIntended changes:\n${intendedChanges}\n\nAffected IDs: ${affectedSummary}${protectedLine}`;
    return { actionLabels, affectedIds, risk, protectedUnchanged, content };
}
