import { getExecutableAppActionToolSchemas } from '#/modules/Command/useCases';

import { ANALYSIS_COMPARE_REFERENCE_TOOL_NAME } from '../models/AgentToolCatalogNames';
import { type ToolSchema } from '../models/ToolDefinitions';
import { WORKFLOW_ACTION_TOOL_NAMES } from '../models/WorkflowCapability';
import { readAgentReference } from '../stores/agentReferenceStore';

import { getPlanningProviderSchemaContract } from './planningProviderSchema';

/**
 * The provider-visible planning list uses Command's published workflow schemas, including their
 * bounds and visibility. An operation its owner stops publishing must disappear here too.
 *
 * `analysis.compareReference` is offered only while the user has a reference loaded. The schema
 * contract the decision-resume identity reads still lists it, so loading or clearing a reference
 * never invalidates a decision that is waiting.
 */
export function getPlanningProviderToolSchemas(): readonly ToolSchema[] {
    const workflowToolSchemas = getExecutableAppActionToolSchemas().filter((tool) =>
        WORKFLOW_ACTION_TOOL_NAMES.has(tool.function.name)
    );
    const referenceLoaded = readAgentReference() !== null;
    const offeredSchemas = getPlanningProviderSchemaContract().schemas.filter(
        (schema) => referenceLoaded || schema.function.name !== ANALYSIS_COMPARE_REFERENCE_TOOL_NAME
    );
    return [...offeredSchemas, ...workflowToolSchemas];
}
