import { getExecutableAppActionToolSchemas } from '#/modules/Command/useCases';

import { ANALYSIS_COMPARE_REFERENCE_TOOL_NAME } from '../models/AgentToolCatalogNames';
import { DAW_TOOL_SCHEMAS, type ToolSchema } from '../models/ToolDefinitions';
import { WORKFLOW_ACTION_TOOL_NAMES } from '../models/WorkflowCapability';
import { readAgentReference } from '../stores/agentReferenceStore';

import { getPlanningProviderSchemaContract } from './planningProviderSchema';

/**
 * The provider-visible planning tool list parsePromptToActions sends to the backend. The WebLLM
 * narrowing in inference.ts caps what it advertises at 30, so the production-shape case in
 * inference.spec.ts reads this list to pin which tools survive that cap.
 *
 * Every workflow tool here resolves from a single source: the registry schemas carry the bounds
 * the application enforces (ADR 0042), so no parallel unbounded copy may shadow them in the
 * name-keyed dedup below.
 *
 * `analysis.compareReference` is offered only while the user has a reference loaded. The schema
 * contract the decision-resume identity reads still lists it, so loading or clearing a reference
 * never invalidates a decision that is waiting.
 */
export function getPlanningProviderToolSchemas(): readonly ToolSchema[] {
    const executableAppActionToolSchemas = getExecutableAppActionToolSchemas();
    const workflowToolSchemas = [
        ...DAW_TOOL_SCHEMAS.filter((tool) => WORKFLOW_ACTION_TOOL_NAMES.has(tool.function.name)),
        ...executableAppActionToolSchemas.filter((tool) => WORKFLOW_ACTION_TOOL_NAMES.has(tool.function.name)),
    ];
    const uniqueWorkflowToolSchemas = Array.from(
        new Map(workflowToolSchemas.map((tool) => [tool.function.name, tool])).values()
    );
    const referenceLoaded = readAgentReference() !== null;
    const offeredSchemas = getPlanningProviderSchemaContract().schemas.filter(
        (schema) => referenceLoaded || schema.function.name !== ANALYSIS_COMPARE_REFERENCE_TOOL_NAME
    );
    return [...offeredSchemas, ...uniqueWorkflowToolSchemas];
}
