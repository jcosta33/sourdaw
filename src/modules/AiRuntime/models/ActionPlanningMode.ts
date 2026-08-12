import { type ToolSchema } from './ToolDefinitions';

export const ACTION_PLANNING_MODE_TOOL_NAME = 'selectActionPlanningMode';

export type ActionPlanningMode = 'execute' | 'preview';

const AFFIRMATIVE_PREVIEW_REQUESTS = [
    /(?:^|[.!?;]\s*)(?:please\s+)?preview\s+\S/u,
    /(?:^|[.!?;]\s*)(?:please\s+)?(?:show|give)\s+(?:me\s+)?(?:an?\s+)?preview\s+of\s+\S/u,
    /(?:^|[.!?;]\s*)(?:can|could|would|will)\s+you\s+preview\s+\S/u,
    /(?:^|[.!?;]\s*)i\s+(?:want|need|would\s+like)\s+(?:an?\s+)?preview\s+of\s+\S/u,
];

export function getRequestedActionPlanningMode(prompt: string): ActionPlanningMode {
    const normalized = prompt.normalize('NFKC').toLocaleLowerCase();
    return AFFIRMATIVE_PREVIEW_REQUESTS.some((pattern) => pattern.test(normalized)) ? 'preview' : 'execute';
}

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
