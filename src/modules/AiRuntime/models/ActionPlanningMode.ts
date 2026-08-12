import { type ToolSchema } from './ToolDefinitions';

export const ACTION_PLANNING_MODE_TOOL_NAME = 'selectActionPlanningMode';

export type ActionPlanningMode = 'execute' | 'preview';

const AFFIRMATIVE_PREVIEW_REQUESTS = [
    /(^|[.!?;]\s*)((?:please\s+)?preview\s+)(?=\S)/iu,
    /(^|[.!?;]\s*)((?:please\s+)?(?:show|give)\s+(?:me\s+)?(?:an?\s+)?preview\s+of\s+)(?=\S)/iu,
    /(^|[.!?;]\s*)((?:can|could|would|will)\s+you\s+preview\s+)(?=\S)/iu,
    /(^|[.!?;]\s*)(i\s+(?:want|need|would\s+like)\s+(?:an?\s+)?preview\s+of\s+)(?=\S)/iu,
];

type PreviewCarrierMatch = {
    start: number;
    end: number;
};

function isWordCharacter(value: string | undefined): boolean {
    return value !== undefined && /[\p{L}\p{N}_]/u.test(value);
}

function isWhitespace(value: string | undefined): boolean {
    return value !== undefined && /\s/u.test(value);
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
            visible[index] = ' '.repeat(character?.length ?? 0);
            const closesStraightSingleQuote =
                closingQuote === "'" &&
                character === "'" &&
                characters[index - 1] !== undefined &&
                !isWhitespace(characters[index - 1]) &&
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
            characters[index + 1] !== undefined &&
            !isWhitespace(characters[index + 1])
        ) {
            closingQuote = "'";
        }

        if (closingQuote !== null) {
            visible[index] = ' '.repeat(character?.length ?? 0);
        }
    }

    return visible.join('');
}

function findAffirmativePreviewCarrier(prompt: string): PreviewCarrierMatch | null {
    const withoutQuotedValues = maskQuotedValues(prompt);
    let firstMatch: PreviewCarrierMatch | null = null;

    for (const pattern of AFFIRMATIVE_PREVIEW_REQUESTS) {
        const match = pattern.exec(withoutQuotedValues);
        const boundary = match?.[1];
        const carrier = match?.[2];
        if (match?.index === undefined || boundary === undefined || carrier === undefined) {
            continue;
        }
        const candidate = {
            start: match.index + boundary.length,
            end: match.index + boundary.length + carrier.length,
        };
        if (firstMatch === null || candidate.start < firstMatch.start) {
            firstMatch = candidate;
        }
    }

    return firstMatch;
}

export function getRequestedActionPlanningMode(prompt: string): ActionPlanningMode {
    const normalized = prompt.normalize('NFKC');
    return findAffirmativePreviewCarrier(normalized) === null ? 'execute' : 'preview';
}

export function stripRequestedActionPlanningModeCarrier(prompt: string): string {
    const normalized = prompt.normalize('NFKC');
    const carrier = findAffirmativePreviewCarrier(normalized);
    if (carrier === null) {
        return prompt;
    }
    return `${normalized.slice(0, carrier.start)}${normalized.slice(carrier.end)}`;
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
