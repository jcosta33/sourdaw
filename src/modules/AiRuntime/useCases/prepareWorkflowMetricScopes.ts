import { type WorkflowCapabilityId } from '../models/WorkflowCapability';

import { type getSidechainRoutingPromptScope } from './agentReference/getSidechainRoutingPromptScope';

export function prepareWorkflowMetricScopes(input: {
    sidechain: ReturnType<typeof getSidechainRoutingPromptScope> | null;
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
    return scopes;
}
