import { type ToolCallResult } from '../../models/ToolCallResult';
import { type ToolSchema } from '../../models/ToolDefinitions';

type AdvertisedSchema = { name: string; description: string; parameters: Record<string, unknown> };
function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function advertisedAnswerSchema(value: unknown): AdvertisedSchema {
    function visit(node: unknown): AdvertisedSchema | null {
        if (typeof node === 'string') {
            for (const name of ['selectCreativeInterpretation', 'selectAnswerInterpretation']) {
                const line = node.split('\n').find((entry) => entry.startsWith(`- ${name}:`));
                if (line === undefined) {
                    continue;
                }
                const index = line.lastIndexOf(' {"type":"object"');
                if (index >= 0) {
                    return {
                        name,
                        description: line.slice(name.length + 4, index),
                        parameters: JSON.parse(line.slice(index + 1)),
                    };
                }
            }
            return null;
        }
        if (Array.isArray(node)) {
            for (const item of node) {
                const found = visit(item);
                if (found !== null) {
                    return found;
                }
            }
        } else if (isRecord(node)) {
            if (
                ['selectCreativeInterpretation', 'selectAnswerInterpretation'].includes(String(node.name)) &&
                isRecord(node.parameters) &&
                typeof node.description === 'string'
            ) {
                return { name: String(node.name), description: node.description, parameters: node.parameters };
            }
            for (const item of Object.values(node)) {
                const found = visit(item);
                if (found !== null) {
                    return found;
                }
            }
        }
        return null;
    }
    const schema = visit(value);
    if (schema === null) {
        throw new Error('Missing actual answer interpretation schema.');
    }
    return schema;
}
export function advertisedAnswerIntake(value: unknown, selection: Record<string, unknown> = {}): ToolCallResult {
    const schema = advertisedAnswerSchema(value);
    const properties = schema.parameters.properties as Record<string, { const?: string }>;
    const answer = {
        kind: 'project-facts',
        topicIds: [],
        scopeCandidateIds: [],
        rangeCandidateId: null,
        uncertainty: 'none',
        ...selection,
    };
    return {
        id: 'intake',
        name: schema.name,
        arguments:
            schema.name === 'selectCreativeInterpretation'
                ? {
                      catalogId: properties.catalogId!.const,
                      modeId: 'read-only',
                      targetCandidateIds: [],
                      editDimensionCandidateIds: [],
                      constraintCandidateIds: [],
                      creationSlotIds: [],
                      uncertainty: 'none',
                      answer,
                  }
                : { catalogId: properties.catalogId!.const, ...answer },
    };
}
/** Read the dynamic catalog actually advertised to the controlled provider. */
export function answerIntakeFromTools(
    tools: readonly ToolSchema[],
    options: Record<string, unknown> = {}
): ToolCallResult {
    return advertisedAnswerIntake(tools, options);
}
export function advertisedAnswerCatalogId(value: unknown): string {
    const properties = advertisedAnswerSchema(value).parameters.properties as Record<string, { const: string }>;
    return properties.catalogId!.const;
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
    const schema = advertisedAnswerSchema(value);
    if (schema.name === 'selectCreativeInterpretation') {
        const view = JSON.parse(schema.description.slice(schema.description.indexOf('View: {') + 6)) as {
            scopes: Array<[string, string[], string[]?]>;
            ranges: Array<string | [string, number, number]>;
            fallback: Array<[string, string, string, string | null, number | null, number | null]>;
        };
        function projectData(node: unknown): Record<string, unknown> | null {
            if (typeof node === 'string') {
                const text = node.split('untrusted_project_data:\n')[1]?.split('\n')[0];
                return text === undefined ? null : JSON.parse(text).data;
            }
            let children: unknown[] = [];
            if (Array.isArray(node)) {
                children = node;
            } else if (isRecord(node)) {
                children = Object.values(node);
            }
            for (const child of children) {
                const found = projectData(child);
                if (found !== null) {
                    return found;
                }
            }
            return null;
        }
        const data = projectData(value);
        const targets = (data?.selectableTargets ?? []) as Array<{ id: string; clips: { id: string }[] }>;
        const sections = (data?.sections ?? []) as Array<{ name: { value: string } }>;
        function matches(reference: string): boolean {
            if (reference === 'master') {
                return objectId === 'master';
            }
            if (reference.startsWith('f')) {
                return view.fallback[Number(reference.slice(1))]?.[1] === objectId;
            }
            if (reference.startsWith('t')) {
                return targets[Number(reference.slice(1))]?.id === objectId;
            }
            const [track, clip] = reference.slice(1).split('.').map(Number);
            return targets[track!]?.clips[clip!]?.id === objectId;
        }
        const index =
            family === 'scopes'
                ? view.scopes.findIndex((row) => row[1].some(matches))
                : view.ranges.findIndex(
                      (row) =>
                          (typeof row === 'string'
                              ? sections[Number(row.slice(1))]?.name.value
                              : row[0]
                          )?.toLowerCase() === objectId.toLowerCase()
                  );
        const properties = schema.parameters.properties as {
            answer: {
                anyOf: Array<{
                    properties?: Record<string, { items?: { enum: string[] }; enum?: Array<string | null> }>;
                }>;
            };
        };
        const answerProperties = properties.answer.anyOf.find((branch) => branch.properties !== undefined)!.properties!;
        const ids =
            family === 'scopes'
                ? answerProperties.scopeCandidateIds!.items!.enum
                : answerProperties.rangeCandidateId!.enum!.filter((id) => id !== null);
        const id = ids[index];
        if (index < 0 || typeof id !== 'string') {
            throw new Error('Missing joint candidate for ' + objectId);
        }
        return id;
    }
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
                        ranges: Array<[string, string, number, number]>;
                    };
                    return family === 'scopes'
                        ? (catalog.scopes.find((row) => row[2].includes(objectId))?.[0] ?? null)
                        : (catalog.ranges.find((row) => row[1].toLowerCase() === objectId.toLowerCase())?.[0] ?? null);
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
