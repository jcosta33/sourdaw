import { type ToolSchema } from '../../models/ToolDefinitions';
import { type ToolCallResult } from '../../models/ToolCallResult';

/** Read the dynamic catalog actually advertised to the controlled provider. */
export function answerIntakeFromTools(
    tools: readonly ToolSchema[],
    options: {
        kind?: string;
        topicIds?: string[];
        scopeCandidateIds?: string[];
        rangeCandidateId?: string | null;
    } = {}
): ToolCallResult {
    const schema = tools.find((tool) => tool.function.name === 'selectAnswerInterpretation');
    const catalog = schema?.function.parameters.properties.catalogId;
    if (typeof catalog !== 'object' || catalog === null || !('const' in catalog) || typeof catalog.const !== 'string') {
        throw new Error('Missing actual answer interpretation schema.');
    }
    return {
        id: 'intake',
        name: 'selectAnswerInterpretation',
        arguments: {
            catalogId: catalog.const,
            kind: options.kind ?? 'project-facts',
            topicIds: options.topicIds ?? [],
            scopeCandidateIds: options.scopeCandidateIds ?? [],
            rangeCandidateId: options.rangeCandidateId ?? null,
            uncertainty: 'none',
        },
    };
}
export function advertisedAnswerCatalogId(value: unknown): string {
    const match = /answer-[a-f0-9-]{36}/.exec(JSON.stringify(value));
    if (match === null) {
        throw new Error('The provider request did not advertise answer intake.');
    }
    return match[0];
}
export const structuralAnswerArguments = {
    intakeCallId: 'intake',
    statements: [{ kind: 'project-fact', fact: 'summary' }],
};

export function advertisedAnswerCandidateId(
    value: unknown,
    objectId: string,
    family: 'scopes' | 'ranges' = 'scopes'
): string {
    function find(node: unknown): string | null {
        if (typeof node === 'string') {
            const marker = node.indexOf('Candidates: ');
            if (marker < 0) {
                return null;
            }
            const content = node.slice(marker + 'Candidates: '.length);
            let depth = 0;
            let quoted = false;
            let escaped = false;
            for (let index = 0; index < content.length; index++) {
                const character = content[index];
                if (quoted) {
                    if (escaped) {
                        escaped = false;
                    } else if (character === '\\') {
                        escaped = true;
                    } else if (character === '"') {
                        quoted = false;
                    }
                    continue;
                }
                if (character === '"') {
                    quoted = true;
                }
                if (character === '{') {
                    depth++;
                }
                if (character === '}' && --depth === 0) {
                    const catalog = JSON.parse(content.slice(0, index + 1)) as {
                        scopes: Array<[string, string, string[], string[]]>;
                        ranges: Array<[string, string, number, number, string | null]>;
                    };
                    return family === 'scopes'
                        ? (catalog.scopes.find((row) => row[2].includes(objectId))?.[0] ?? null)
                        : (catalog.ranges.find((row) => row[4] === objectId)?.[0] ?? null);
                }
            }
            return null;
        }
        if (Array.isArray(node)) {
            for (const child of node) {
                const id = find(child);
                if (id !== null) {
                    return id;
                }
            }
        }
        if (node !== null && typeof node === 'object') {
            for (const child of Object.values(node)) {
                const id = find(child);
                if (id !== null) {
                    return id;
                }
            }
        }
        return null;
    }
    const id = find(value);
    if (id === null) {
        throw new Error('Missing advertised answer candidate for ' + objectId);
    }
    return id;
}
