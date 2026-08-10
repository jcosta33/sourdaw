import { getAppActionExecutionPolicy } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../models/ProjectContext';

import { getBulkDeviceInsertionTrackScope } from './agentReference/getBulkDeviceInsertionTrackScope';
import { describePlannedAction } from './describePlannedAction';
import { getPlannedActionAffectedIds } from './getPlannedActionAffectedIds';

type DescribePendingActionConfirmationInput = {
    actions: readonly AppAction[];
    context: ProjectContext;
    prompt: string;
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

function getProtectedUnchangedTracks(prompt: string, context: ProjectContext): Array<{ id: string; name: string }> {
    const protectedScopes = [
        ...prompt.matchAll(/\b(?:leave|leaving|keep|keeping|preserve|preserving)\s+(.+?)\s+unchanged\b/giu),
    ].flatMap((match) => (match[1] ? [normalizeText(match[1])] : []));
    const excludedFrozenTrackIds = new Set(
        getBulkDeviceInsertionTrackScope(prompt, context)?.excludedFrozenTrackIds ?? []
    );
    const protectedTracks = context.tracks.filter((track) => {
        const normalizedName = normalizeText(track.name);
        return (
            excludedFrozenTrackIds.has(track.id) ||
            protectedScopes.some((scope) => ` ${scope} `.includes(` ${normalizedName} `))
        );
    });
    return protectedTracks.map(({ id, name }) => ({ id, name }));
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
    return describePlannedAction({ action, context });
}

export function describePendingActionConfirmation({
    actions,
    context,
    prompt,
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
    const protectedUnchanged = getProtectedUnchangedTracks(prompt, context);
    const intendedChanges = actions
        .map((action, index) => `- **${action.type}**: ${actionLabels[index] ?? action.type}`)
        .join('\n');
    const protectedSummary = protectedUnchanged.map((target) => `"${target.name}" (${target.id})`).join(', ');
    const affectedSummary = affectedIds.join(', ');
    const riskReason = risk.reason ? ` — ${risk.reason}` : '';
    const protectedLine = protectedSummary ? `\n\nProtected unchanged: ${protectedSummary}` : '';
    const content = `This prompt requires confirmation before execution.\n\nRisk: ${risk.level}${riskReason}\n\nIntended changes:\n${intendedChanges}\n\nAffected IDs: ${affectedSummary}${protectedLine}`;
    return { actionLabels, affectedIds, risk, protectedUnchanged, content };
}
