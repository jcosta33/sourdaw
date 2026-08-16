import { type ToolSchema } from '../models/ToolDefinitions';
import { createWorkflowCapabilityToolSchema, WORKFLOW_CAPABILITY_IDS } from '../models/WorkflowCapability';

import { APPLICATION_OWNED_TOOL_SCHEMAS } from './applicationOwnedToolLoop';

/** Exact provider-visible planning schema contract used for decision resume admission. */
export function getPlanningProviderSchemaContract(): { schemas: readonly ToolSchema[]; identity: string } {
    const schemas = [...APPLICATION_OWNED_TOOL_SCHEMAS, createWorkflowCapabilityToolSchema(WORKFLOW_CAPABILITY_IDS)];
    return {
        schemas,
        identity: JSON.stringify(
            schemas.map((schema) => ({
                name: schema.function.name,
                parameters: schema.function.parameters,
            }))
        ),
    };
}
