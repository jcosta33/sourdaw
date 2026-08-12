import { type ToolSchema } from './ToolDefinitions';

export const ACTION_PLANNING_MODE_TOOL_NAME = 'selectActionPlanningMode';

export type ActionPlanningMode = 'execute' | 'preview';

const AFFIRMATIVE_PREVIEW_REQUESTS = [
    /(?:^|[.!?;]\s*)(?:please\s+)?preview\s+\S/u,
    /(?:^|[.!?;]\s*)(?:please\s+)?(?:show|give)\s+(?:me\s+)?(?:an?\s+)?preview\s+of\s+\S/u,
    /(?:^|[.!?;]\s*)(?:can|could|would|will)\s+you\s+preview\s+\S/u,
    /(?:^|[.!?;]\s*)i\s+(?:want|need|would\s+like)\s+(?:an?\s+)?preview\s+of\s+\S/u,
];

function isWordCharacter(value: string | undefined): boolean {
    return value !== undefined && /[\p{L}\p{N}_]/u.test(value);
}

function isEscaped(characters: string[], index: number): boolean {
    let slashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && characters[cursor] === '\\'; cursor -= 1) {
        slashCount += 1;
    }
    return slashCount % 2 === 1;
}

function maskQuotedValues(value: string): string {
    const characters = [...value];
    const visible = [...characters];
    let closingQuote: '"' | '”' | '’' | "'" | null = null;

    for (let index = 0; index < characters.length; index += 1) {
        const character = characters[index];
        if (closingQuote !== null) {
            visible[index] = ' ';
            const closesStraightSingleQuote =
                closingQuote === "'" &&
                character === "'" &&
                isWordCharacter(characters[index - 1]) &&
                !isWordCharacter(characters[index + 1]);
            const closesOtherQuote =
                closingQuote !== "'" && character === closingQuote && !isEscaped(characters, index);
            if (closesStraightSingleQuote || closesOtherQuote) {
                closingQuote = null;
            }
            continue;
        }

        if (character === '"' && !isEscaped(characters, index)) {
            closingQuote = '"';
        } else if (character === '“') {
            closingQuote = '”';
        } else if (character === '‘') {
            closingQuote = '’';
        } else if (
            character === "'" &&
            !isWordCharacter(characters[index - 1]) &&
            isWordCharacter(characters[index + 1])
        ) {
            closingQuote = "'";
        }

        if (closingQuote !== null) {
            visible[index] = ' ';
        }
    }

    return visible.join('');
}

export function getRequestedActionPlanningMode(prompt: string): ActionPlanningMode {
    const normalized = prompt.normalize('NFKC').toLocaleLowerCase();
    const withoutQuotedValues = maskQuotedValues(normalized);
    return AFFIRMATIVE_PREVIEW_REQUESTS.some((pattern) => pattern.test(withoutQuotedValues)) ? 'preview' : 'execute';
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
