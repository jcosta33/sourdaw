import { getExecutableAppActionToolSchemas } from '#/modules/Command/useCases';

import { ANALYSIS_COMPARE_REFERENCE_TOOL_NAME, BRIEF_COMPILE_TOOL_NAME } from '../models/AgentToolCatalogNames';
import { type PlanningProfile, READONLY_ANSWER_TOOL_NAMES } from '../models/PlanningProfile';
import { type ToolSchema } from '../models/ToolDefinitions';
import { WORKFLOW_ACTION_TOOL_NAMES } from '../models/WorkflowCapability';
import { readAgentReference } from '../stores/agentReferenceStore';

import { getPlanningProviderSchemaContract } from './planningProviderSchema';
import { projectReadonlyAnswerMeasurementToolSchema } from './projectReadonlyAnswerMeasurementToolSchema';

/**
 * The provider-visible planning list uses Command's published workflow schemas, including their
 * bounds and visibility. An operation its owner stops publishing must disappear here too.
 *
 * `analysis.compareReference` is offered only while the user has a reference loaded. The schema
 * contract the decision-resume identity reads still lists it, so loading or clearing a reference
 * never invalidates a decision that is waiting.
 *
 * `brief.compile` follows the same rule: it is in the contract, and offered only when the caller
 * says the request may write the brief (a hosted chat request that is not a decision resume).
 */
export function getPlanningProviderToolSchemas(
    profile?: PlanningProfile,
    { offersBrief = false }: { offersBrief?: boolean } = {}
): readonly ToolSchema[] {
    if (profile === 'readonly-answer') {
        return getPlanningProviderSchemaContract()
            .schemas.filter((schema) => READONLY_ANSWER_TOOL_NAMES.has(schema.function.name))
            .map((schema) => {
                if (schema.function.name === 'analysis.measure') {
                    return projectReadonlyAnswerMeasurementToolSchema(schema);
                }
                return schema;
            });
    }
    const workflowToolSchemas = getExecutableAppActionToolSchemas().filter((tool) =>
        WORKFLOW_ACTION_TOOL_NAMES.has(tool.function.name)
    );
    const referenceLoaded = readAgentReference() !== null;
    const offeredSchemas = getPlanningProviderSchemaContract().schemas.filter(
        (schema) =>
            (referenceLoaded || schema.function.name !== ANALYSIS_COMPARE_REFERENCE_TOOL_NAME) &&
            (offersBrief || schema.function.name !== BRIEF_COMPILE_TOOL_NAME)
    );
    return [...offeredSchemas, ...workflowToolSchemas];
}
