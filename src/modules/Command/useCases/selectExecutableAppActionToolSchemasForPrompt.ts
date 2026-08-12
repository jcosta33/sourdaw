import { isExecutableAppActionType } from './executableAppActionRegistry';
import { getExecutableCommandRegistration } from './getExecutableCommandRegistration';

const MAX_WEB_LLM_TOOLS = 30;
const ignoredSelectionTerms: ReadonlySet<string> = new Set([
    'and',
    'for',
    'from',
    'into',
    'new',
    'off',
    'the',
    'this',
    'through',
    'track',
    'with',
]);

type NamedToolSchema = {
    function: {
        name: string;
        description?: string;
    };
};

type SelectExecutableAppActionToolSchemasForPromptInput<TToolSchema extends NamedToolSchema> = {
    toolSchemas: readonly TToolSchema[];
    prompt: string;
};

function normalizeSelectionTerm(term: string): string {
    if (term.length > 4 && term.endsWith('s')) {
        return term.slice(0, -1);
    }
    return term;
}

function selectionTerms(value: string): Set<string> {
    const separatedValue = value.replaceAll(/([\p{Ll}\p{N}])([\p{Lu}])/gu, '$1 $2');
    const terms = separatedValue.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    return new Set(
        terms.map(normalizeSelectionTerm).filter((term) => term.length >= 3 && !ignoredSelectionTerms.has(term))
    );
}

function scoreToolForPrompt(
    toolSchema: NamedToolSchema,
    normalizedPrompt: string,
    promptTerms: ReadonlySet<string>
): number {
    let score = 0;
    const normalizedToolName = toolSchema.function.name.toLowerCase();
    if (normalizedPrompt.includes(normalizedToolName)) {
        score += 2_000 + normalizedToolName.length;
    }

    for (const term of selectionTerms(toolSchema.function.name)) {
        if (promptTerms.has(term)) {
            score += 100;
        }
    }

    for (const term of selectionTerms(toolSchema.function.description ?? '')) {
        if (promptTerms.has(term)) {
            score += 1;
        }
    }

    if (!isExecutableAppActionType(toolSchema.function.name)) {
        return score;
    }
    const registration = getExecutableCommandRegistration(toolSchema.function.name);

    const matchedIntentTerms = new Set<string>();
    for (const phrase of [...registration.intentPhrases, ...registration.selectionPhrases]) {
        const normalizedPhrase = phrase.toLowerCase();
        if (normalizedPrompt.includes(normalizedPhrase)) {
            score = Math.max(score, 1_000 + normalizedPhrase.length);
        }

        for (const term of selectionTerms(phrase)) {
            if (promptTerms.has(term)) {
                matchedIntentTerms.add(term);
            }
        }
    }
    score += matchedIntentTerms.size * 10;

    for (const term of selectionTerms(registration.toolDescription)) {
        if (promptTerms.has(term)) {
            score += 1;
        }
    }

    return score;
}

export function selectExecutableAppActionToolSchemasForPrompt<TToolSchema extends NamedToolSchema>(
    input: SelectExecutableAppActionToolSchemasForPromptInput<TToolSchema>
): TToolSchema[] {
    if (input.toolSchemas.length <= MAX_WEB_LLM_TOOLS) {
        return [...input.toolSchemas];
    }

    const normalizedPrompt = input.prompt.toLowerCase();
    const promptTerms = selectionTerms(input.prompt);

    return input.toolSchemas
        .map((toolSchema, index) => ({
            toolSchema,
            index,
            score: scoreToolForPrompt(toolSchema, normalizedPrompt, promptTerms),
        }))
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .slice(0, MAX_WEB_LLM_TOOLS)
        .map(({ toolSchema }) => toolSchema);
}
