import { type WorkflowCapabilityId } from '../../models/WorkflowCapability';

type ProviderPlanCall = { name: string; arguments: Record<string, unknown> };

export function withWorkflowCapabilitySelection(
    capabilityId: WorkflowCapabilityId,
    plan: readonly ProviderPlanCall[]
): ProviderPlanCall[] {
    return [
        { name: 'selectWorkflowCapability', arguments: { capabilityId } },
        ...plan.map((call) => ({ name: call.name, arguments: call.arguments })),
    ];
}
