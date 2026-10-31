import { type ToolSchema } from '../models/ToolDefinitions';
import { createWorkflowCapabilityToolSchema, WORKFLOW_CAPABILITY_TOOL_NAME } from '../models/WorkflowCapability';

import { createMetricIntentSelectionSchema } from './createMetricIntentSelectionSchema';
import { type MetricIntentCatalog } from './prepareMetricIntentCatalog';
import { type prepareWorkflowMetricScopes } from './prepareWorkflowMetricScopes';
import { type WholeRequestIntakePhase } from './projectPlanningProviderToolSchemas';

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
