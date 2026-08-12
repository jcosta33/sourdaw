import { type ToolSchema } from './ToolDefinitions';

export const ACTION_PLANNING_MODE_TOOL_NAME = 'selectActionPlanningMode';

export type ActionPlanningMode = 'execute' | 'preview';

export function createActionPlanningModeToolSchema(): ToolSchema {
    return {
        type: 'function',
        function: {
            name: ACTION_PLANNING_MODE_TOOL_NAME,
            description:
                'Select preview only when the user asks to inspect a proposed action before deciding whether to confirm it. Call this before executable action tools. Omit it for ordinary execution requests.',
            parameters: {
                type: 'object',
                properties: {
                    mode: {
                        type: 'string',
                        const: 'preview',
                        description: 'Propose the action as an explicit preview that still requires confirmation.',
                    },
                },
                required: ['mode'],
                additionalProperties: false,
            },
        },
    };
}
