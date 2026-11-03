import { captureProjectIdentity, captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { getCreativeSelectionSnapshot } from '../models/CreativeInterpretation';
import { type ToolCallResult } from '../models/ToolCallResult';

import { admitMetricIntent } from './admitMetricIntent';
import { getProjectContext } from './getProjectContext';
import { type MetricIntentCatalog } from './prepareMetricIntentCatalog';
import { type prepareWorkflowMetricScopes } from './prepareWorkflowMetricScopes';

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
