import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseSemanticProjectQueryInput } from '#/modules/Project/useCases';

import { type ToolSchema } from '../../../../models/ToolDefinitions';
import { getAgentToolCatalogSchemas } from '../../../../useCases/agentToolCatalog';
import { getPlanningProviderToolSchemas } from '../../../../useCases/getPlanningProviderToolSchemas';
import { matchesJsonSchema } from '../../../../validators/matchesJsonSchema';
import { type OpenAiCompatibleCloudRuntime } from '../../cloudSession';
import { generateOpenAiCompatibleToolCalls } from '../generateOpenAiCompatibleToolCalls';
import { AUTO_TOOL_CHOICE } from '../hostedToolPlan';
import { projectOpenAiStrictToolSchema } from '../projectOpenAiStrictToolSchema';
import { readStrictCallsAsSourceArguments } from '../readStrictCallsAsSourceArguments';

const FILTER_KEYS = [
    'stableId',
    'exactName',
    'fuzzyName',
    'kind',
    'tag',
    'role',
    'parentId',
    'sectionId',
    'deviceType',
    'deviceCategory',
    'routeFromId',
    'routeToId',
    'assetType',
    'selected',
    'locked',
    'muted',
    'soloed',
    'hasAutomation',
    'startBeat',
    'endBeat',
    'minInferredConfidence',
    'contentType',
];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findTool(name: string): ToolSchema {
    const found = [...getAgentToolCatalogSchemas(), ...getPlanningProviderToolSchemas()].find(
        (schema) => schema.function.name === name
    );
    if (found === undefined) {
        throw new Error(`${name} is not published`);
    }
    return found;
}

function isNullable(node: Record<string, unknown>): boolean {
    return Array.isArray(node.type) && node.type.includes('null');
}

/** The call a strict model makes when it sets only what the projected schema forces and leaves every optional unset. */
function unsetCallFor(projected: Record<string, unknown>): Record<string, unknown> {
    const properties = isRecord(projected.properties) ? projected.properties : {};
    const call: Record<string, unknown> = {};
    for (const [key, property] of Object.entries(properties)) {
        if (!isRecord(property)) {
            continue;
        }
        if (isNullable(property)) {
            call[key] = null;
        } else if (Array.isArray(property.enum)) {
            call[key] = property.enum[0];
        } else if (property.type === 'object') {
            call[key] = unsetCallFor(property);
        } else {
            call[key] = 'x';
        }
    }
    return call;
}

function readUnsetOptionalsAsAbsent(value: Record<string, unknown>, parameters: Record<string, unknown>): unknown {
    return readStrictCallsAsSourceArguments(
        [{ name: 'probe', arguments: value }],
        [{ function: { name: 'probe', parameters } }]
    )[0]?.arguments;
}

describe('reading unset optionals back as absent', () => {
    const schema = {
        type: 'object',
        properties: {
            name: { type: 'string' },
            note: { type: 'string' },
            nullableNote: { type: ['string', 'null'] },
            nested: {
                type: 'object',
                properties: { id: { type: 'string' }, tag: { type: 'string' } },
                required: ['id'],
            },
            list: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: { a: { type: 'string' }, b: { type: 'string' } },
                    required: ['a'],
                },
            },
        },
        required: ['name'],
    };

    it('drops a null for an optional property whose source type is not nullable, at every depth', () => {
        expect(
            readUnsetOptionalsAsAbsent(
                { name: 'n', note: null, nested: { id: 'i', tag: null }, list: [{ a: 'a', b: null }] },
                schema
            )
        ).toEqual({ name: 'n', nested: { id: 'i' }, list: [{ a: 'a' }] });
    });

    it('keeps a null the source schema requires or itself admits', () => {
        expect(readUnsetOptionalsAsAbsent({ name: null, nullableNote: null, nested: { id: null } }, schema)).toEqual({
            name: null,
            nullableNote: null,
            nested: { id: null },
        });
    });

    it('keeps a wrong-typed non-null value for validation to refuse', () => {
        expect(readUnsetOptionalsAsAbsent({ name: 'n', note: 4 }, schema)).toEqual({ name: 'n', note: 4 });
    });

    it('reads an anyOf member against the branch that declares every key it carries', () => {
        const composed = {
            anyOf: [
                { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
                { type: 'object', properties: { b: { type: 'string' }, c: { type: 'string' } }, required: ['b'] },
            ],
        };
        expect(readUnsetOptionalsAsAbsent({ b: 'b', c: null }, composed)).toEqual({ b: 'b' });
    });
});

describe('a strict OpenAI project.query call', () => {
    const projectQuery = findTool('project.query');
    const allFiltersUnset = Object.fromEntries(FILTER_KEYS.map((key) => [key, null]));

    it('reaches the application as the arguments the source schema describes, and parses', () => {
        const [call] = readStrictCallsAsSourceArguments(
            [
                {
                    name: 'project.query',
                    arguments: {
                        type: 'object',
                        filters: { ...allFiltersUnset, exactName: 'Lead Vocal' },
                        page: null,
                        sinceRevision: null,
                    },
                },
            ],
            [projectQuery]
        );

        expect(call?.arguments).toEqual({ type: 'object', filters: { exactName: 'Lead Vocal' } });
        expect(parseSemanticProjectQueryInput(call?.arguments)).toMatchObject({ status: 'valid' });
    });

    it('round-trips the projected schema with every optional unset to an admitted value', () => {
        const projected = projectOpenAiStrictToolSchema(projectQuery).function.parameters;
        const unset = unsetCallFor(projected);
        expect(unset).toMatchObject({ page: null, sinceRevision: null });

        const [call] = readStrictCallsAsSourceArguments([{ name: 'project.query', arguments: unset }], [projectQuery]);

        expect(call?.arguments).toEqual({ type: 'project-summary' });
        expect(parseSemanticProjectQueryInput(call?.arguments)).toMatchObject({ status: 'valid' });
    });

    it('still refuses a null for a required property and a wrong-typed filter value', () => {
        const [nullType, wrongType] = readStrictCallsAsSourceArguments(
            [
                { name: 'project.query', arguments: { type: null, filters: null } },
                { name: 'project.query', arguments: { type: 'object', filters: { startBeat: '4' } } },
            ],
            [projectQuery]
        );

        expect(nullType?.arguments).toEqual({ type: null });
        expect(matchesJsonSchema(nullType?.arguments, projectQuery.function.parameters)).toBe(false);
        expect(parseSemanticProjectQueryInput(nullType?.arguments)).toMatchObject({ status: 'invalid' });
        expect(parseSemanticProjectQueryInput(wrongType?.arguments)).toMatchObject({
            status: 'invalid',
            reason: 'filters',
        });
    });
});

describe('a strict OpenAI analysis.measure call', () => {
    it('round-trips every optional unset, nested ones included, to an admitted value', () => {
        const measure = findTool('analysis.measure');
        const projected = projectOpenAiStrictToolSchema(measure).function.parameters;
        const unset = unsetCallFor(projected);

        const [call] = readStrictCallsAsSourceArguments([{ name: 'analysis.measure', arguments: unset }], [measure]);

        expect(JSON.stringify(call?.arguments)).not.toContain('null');
        expect(matchesJsonSchema(call?.arguments, measure.function.parameters)).toBe(true);
    });
});

describe('the OpenAI generators', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const projectQuery = findTool('project.query');
    const nullPadded = JSON.stringify({
        type: 'object',
        filters: { exactName: 'Lead Vocal', muted: null },
        page: null,
        sinceRevision: null,
    });

    function stubFetch(payload: unknown): void {
        vi.stubGlobal(
            'fetch',
            vi.fn<typeof fetch>().mockResolvedValue(
                new Response(JSON.stringify(payload), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                })
            )
        );
    }

    const compatibleRuntime = (strict: boolean): OpenAiCompatibleCloudRuntime => ({
        provider: 'openai-compatible',
        authentication: 'none',
        session_id: null,
        model: 'gpt-5.2',
        base_url: 'http://localhost:1234/v1',
        strict_tool_schemas: strict,
    });

    async function compatibleCalls(strict: boolean) {
        stubFetch({
            choices: [
                {
                    finish_reason: 'tool_calls',
                    message: {
                        tool_calls: [{ id: 'c1', function: { name: 'project_query', arguments: nullPadded } }],
                    },
                },
            ],
        });
        return generateOpenAiCompatibleToolCalls({
            runtime: compatibleRuntime(strict),
            systemPrompt: 'system',
            userMessage: 'find',
            toolSchemas: [projectQuery],
            maxOutputTokens: 8192,
            directive: AUTO_TOOL_CHOICE,
        });
    }

    it('reads the nulls a strict compatible call sends as absent', async () => {
        const plan = await compatibleCalls(true);
        expect(plan.calls[0]?.arguments).toEqual({ type: 'object', filters: { exactName: 'Lead Vocal' } });
    });

    it('leaves a non-strict compatible call exactly as the model sent it', async () => {
        const plan = await compatibleCalls(false);
        expect(plan.calls[0]?.arguments).toEqual({
            type: 'object',
            filters: { exactName: 'Lead Vocal', muted: null },
            page: null,
            sinceRevision: null,
        });
    });
});
