import { captureProjectIdentity, captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { getCreativeSelectionSnapshot } from '../models/CreativeInterpretation';
import { type ToolCallResult } from '../models/ToolCallResult';
import { type ToolSchema } from '../models/ToolDefinitions';
import {
    createWorkflowCapabilityToolSchema,
    WORKFLOW_CAPABILITY_TOOL_NAME,
    type WorkflowCapabilityId,
} from '../models/WorkflowCapability';

import { admitMetricIntent } from './admitMetricIntent';
import { type getSidechainRoutingPromptScope } from './agentReference/getSidechainRoutingPromptScope';
import { type getWholeProjectVibeMixScope } from './agentReference/getWholeProjectVibeMixScope';
import { createMetricIntentSelectionSchema } from './createPlanningInterpretationToolSchema';
import { getProjectContext } from './getProjectContext';
import { type MetricIntentCatalog } from './prepareMetricIntentCatalog';
import { type WholeRequestIntakePhase } from './projectPlanningProviderToolSchemas';

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

export function projectWorkflowMetricToolSchemas(input: {
    schemas: readonly ToolSchema[];
    phase: WholeRequestIntakePhase | undefined;
    catalog: MetricIntentCatalog;
    scopes: ReturnType<typeof prepareWorkflowMetricScopes>;
}): ToolSchema[] {
    return input.schemas.flatMap((schema) => {
        if (schema.function.name !== WORKFLOW_CAPABILITY_TOOL_NAME || input.phase !== 'pending') {
            return [schema];
        }
        if (input.scopes.length === 0) {
            return [];
        }
        return [
            createWorkflowCapabilityToolSchema(
                input.scopes.map((scope) => scope.capabilityId),
                {
                    catalogId: { const: input.catalog.catalogId },
                    metricIntent: createMetricIntentSelectionSchema(input.catalog),
                }
            ),
        ];
    });
}

/** A selected finite workflow supplies subjects, never an acoustic exemption or a command permit. */
export function admitWorkflowMetricIntake(input: {
    call: ToolCallResult;
    turn: number;
    catalog: MetricIntentCatalog;
    scopes: ReturnType<typeof prepareWorkflowMetricScopes>;
}) {
    const args = input.call.arguments;
    const scope = input.scopes.find((candidate) => candidate.capabilityId === args.capabilityId);
    if (
        Object.keys(args).length !== 3 ||
        !['capabilityId', 'catalogId', 'metricIntent'].every((key) => Object.hasOwn(args, key)) ||
        args.catalogId !== input.catalog.catalogId ||
        scope === undefined ||
        !input.call.id ||
        input.turn < 1
    ) {
        return {
            status: 'rejected' as const,
            reason: 'Workflow metric intake does not match a published finite scope.',
        };
    }
    if (
        captureProjectIdentity() !== input.catalog.projectId ||
        captureProjectRevision() !== input.catalog.revision ||
        JSON.stringify(getCreativeSelectionSnapshot(getProjectContext())) !== JSON.stringify(input.catalog.selection)
    ) {
        return { status: 'rejected' as const, reason: 'Workflow metric intake belongs to a stale project snapshot.' };
    }
    const admitted = admitMetricIntent({
        catalog: input.catalog,
        value: args.metricIntent,
        creativeAuthority: null,
        workflowTargetIds: scope.targetIds,
        callId: input.call.id,
        turn: input.turn,
    });
    if (admitted.status !== 'admitted') {
        return admitted;
    }
    if (admitted.authority.kind !== 'perceptual' && admitted.authority.kind !== 'comparative') {
        return {
            status: 'rejected' as const,
            reason: 'Workflow metric intake requires a positive acoustic objective.',
        };
    }
    return { ...admitted, scope };
}
