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

/** Builds scope only from application-resolved command and workflow evidence. */
export function composeVerifiedProviderProposalScope(input: {
    actions: readonly AppAction[];
    compilerEvidence: ArbitraryCommandListEvidence | undefined;
    context: ProjectContext;
    prompt: string;
    workflowCapabilityId: WorkflowCapabilityId | undefined;
    workflowScope: AgentRunScope | undefined;
}): AgentRunScope | undefined {
    if (input.workflowScope !== undefined) {
        return structuredClone(input.workflowScope);
    }
    const resolvedTargetIds = input.compilerEvidence?.providerKnownTargetIds;
    if (resolvedTargetIds === undefined) {
        return undefined;
    }

    const scope: AgentRunScope = {
        targetIds: [...resolvedTargetIds],
        targetRanges: [],
        protectedTargetIds: getApplicationProtectedObjects({
            actions: input.actions,
            context: input.context,
            prompt: input.prompt,
            workflowCapabilityId: input.workflowCapabilityId,
        }).map((object) => object.id),
        protectedRanges: [],
    };
    const mutedDeletionScope = getMutedEmptyTrackDeletionScope(input.prompt, input.context);
    if (mutedDeletionScope !== null) {
        scope.targetIds = mutedDeletionScope.targetIds;
        scope.protectedTargetIds = mutedDeletionScope.protectedTrackIds;
        return scope;
    }
    const bulkInsertionScope = getBulkDeviceInsertionTrackScope(input.prompt, input.context);
    if (bulkInsertionScope !== null) {
        scope.protectedTargetIds = bulkInsertionScope.excludedFrozenTrackIds;
        return scope;
    }
    const sidechainScope = getSidechainRoutingPromptScope(input.prompt, input.context);
    if (sidechainScope.status === 'request') {
        scope.targetIds = uniqueIds(
            sidechainScope.routes.flatMap((route) => [route.targetTrackId, route.sourceTrackId, route.targetDeviceId])
        );
        scope.protectedTargetIds = sidechainScope.protectedTargets.map((target) => target.id);
    }
    return scope;
}
