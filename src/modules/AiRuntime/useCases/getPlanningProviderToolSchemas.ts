import { getExecutableAppActionToolSchemas } from '#/modules/Command/useCases';

import { DAW_TOOL_SCHEMAS, type ToolSchema } from '../models/ToolDefinitions';
import { WORKFLOW_ACTION_TOOL_NAMES } from '../models/WorkflowCapability';

import { getPlanningProviderSchemaContract } from './planningProviderSchema';

const SPECIALIZED_WORKFLOW_TOOL_SCHEMAS: readonly ToolSchema[] = [
    {
        type: 'function',
        function: {
            name: 'automateTrackGainRange',
            description: 'Automate track gain over a named section range',
            parameters: {
                type: 'object',
                properties: {
                    trackIds: { type: 'array', items: { type: 'string' } },
                    sectionName: { type: 'string' },
                    gainDb: { type: 'number' },
                },
                required: ['trackIds', 'sectionName', 'gainDb'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'automateSendRange',
            description: 'Automate send reduction over a named section range',
            parameters: {
                type: 'object',
                properties: {
                    trackIds: { type: 'array', items: { type: 'string' } },
                    busId: { type: 'string' },
                    sectionName: { type: 'string' },
                    reductionDb: { type: 'number' },
                },
                required: ['trackIds', 'busId', 'sectionName', 'reductionDb'],
            },
        },
    },
];

/**
 * The provider-visible planning tool list parsePromptToActions sends to the backend. The WebLLM
 * narrowing in inference.ts caps what it advertises at 30, so the production-shape case in
 * inference.spec.ts reads this list to pin which tools survive that cap.
 */
export function getPlanningProviderToolSchemas(): readonly ToolSchema[] {
    const executableAppActionToolSchemas = getExecutableAppActionToolSchemas();
    const workflowToolSchemas = [
        ...DAW_TOOL_SCHEMAS.filter((tool) => WORKFLOW_ACTION_TOOL_NAMES.has(tool.function.name)),
        ...executableAppActionToolSchemas.filter((tool) => WORKFLOW_ACTION_TOOL_NAMES.has(tool.function.name)),
        ...SPECIALIZED_WORKFLOW_TOOL_SCHEMAS,
    ];
    const uniqueWorkflowToolSchemas = Array.from(
        new Map(workflowToolSchemas.map((tool) => [tool.function.name, tool])).values()
    );
    return [...getPlanningProviderSchemaContract().schemas, ...uniqueWorkflowToolSchemas];
}
