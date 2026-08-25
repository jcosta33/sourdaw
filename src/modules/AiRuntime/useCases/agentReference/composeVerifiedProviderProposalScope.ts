import { type AppAction } from '#/utils/handlerContract';

import { type AgentRunScope } from '../../models/AgentRun';
import { type ProjectContext } from '../../models/ProjectContext';
import { type WorkflowCapabilityId } from '../../models/WorkflowCapability';
import { type ArbitraryCommandListEvidence } from '../compileArbitraryCommandList';

import { getApplicationProtectedObjects } from './getApplicationProtectedObjects';
import { getBulkDeviceInsertionTrackScope } from './getBulkDeviceInsertionTrackScope';
import { getMutedEmptyTrackDeletionScope } from './getMutedEmptyTrackDeletionScope';
import { getSidechainRoutingPromptScope } from './getSidechainRoutingPromptScope';

function uniqueIds(ids: readonly string[]): string[] {
    return [...new Set(ids)];
}

function addProtectedTargetIds(scope: AgentRunScope, protectedTargetIds: readonly string[]): void {
    scope.protectedTargetIds = uniqueIds([...scope.protectedTargetIds, ...protectedTargetIds]);
}

/** Builds scope only from application-resolved command and workflow evidence. */
export function composeVerifiedProviderProposalScope(input: {
    actions: readonly AppAction[];
    compilerEvidence: ArbitraryCommandListEvidence | undefined;
    context: ProjectContext;
    prompt: string;
    workflowCapabilityId: WorkflowCapabilityId | undefined;
    workflowScope: AgentRunScope | undefined;
}): AgentRunScope | undefined {
    const applicationProtectedTargetIds = getApplicationProtectedObjects({
        actions: input.actions,
        context: input.context,
        prompt: input.prompt,
        workflowCapabilityId: input.workflowCapabilityId,
    }).map((object) => object.id);
    if (input.workflowScope !== undefined) {
        const scope = structuredClone(input.workflowScope);
        scope.protectedTargetIds = uniqueIds([...applicationProtectedTargetIds, ...scope.protectedTargetIds]);
        return scope;
    }
    const resolvedTargetIds = input.compilerEvidence?.providerKnownTargetIds;
    if (resolvedTargetIds === undefined) {
        return undefined;
    }

    const scope: AgentRunScope = {
        targetIds: [...resolvedTargetIds],
        targetRanges: [],
        protectedTargetIds: applicationProtectedTargetIds,
        protectedRanges: [],
    };
    const mutedDeletionScope = getMutedEmptyTrackDeletionScope(input.prompt, input.context);
    if (mutedDeletionScope !== null) {
        scope.targetIds = mutedDeletionScope.targetIds;
        addProtectedTargetIds(scope, mutedDeletionScope.protectedTrackIds);
        return scope;
    }
    const bulkInsertionScope = getBulkDeviceInsertionTrackScope(input.prompt, input.context);
    if (bulkInsertionScope !== null) {
        addProtectedTargetIds(scope, bulkInsertionScope.excludedFrozenTrackIds);
        return scope;
    }
    const sidechainScope = getSidechainRoutingPromptScope(input.prompt, input.context);
    if (sidechainScope.status === 'request') {
        scope.targetIds = uniqueIds(
            sidechainScope.routes.flatMap((route) => [route.targetTrackId, route.sourceTrackId, route.targetDeviceId])
        );
        addProtectedTargetIds(
            scope,
            sidechainScope.protectedTargets.map((target) => target.id)
        );
    }
    return scope;
}
