import { type WorkflowCapabilityId } from '../models/WorkflowCapability';

import { type getSidechainRoutingPromptScope } from './agentReference/getSidechainRoutingPromptScope';
import { type getWholeProjectVibeMixScope } from './agentReference/getWholeProjectVibeMixScope';

export function prepareWorkflowMetricScopes(input: {
    sidechain: ReturnType<typeof getSidechainRoutingPromptScope> | null;
    wholeProject: ReturnType<typeof getWholeProjectVibeMixScope>;
}) {
    const scopes: Array<{ capabilityId: WorkflowCapabilityId; targetIds: string[]; protectedTargetIds: string[] }> = [];
    if (input.sidechain?.status === 'request') {
        scopes.push({
            capabilityId: 'sidechain-routing',
            targetIds: [
                ...new Set(input.sidechain.routes.flatMap((route) => [route.sourceTrackId, route.targetTrackId])),
            ],
            protectedTargetIds: input.sidechain.protectedTargets.map((target) => target.id),
        });
    }
    if (input.wholeProject !== null) {
        scopes.push({
            capabilityId: 'whole-project-vibe-mix',
            targetIds: [...input.wholeProject.targetIds],
            protectedTargetIds: input.wholeProject.protectedObjects.map((target) => target.id),
        });
    }
    return scopes;
}
