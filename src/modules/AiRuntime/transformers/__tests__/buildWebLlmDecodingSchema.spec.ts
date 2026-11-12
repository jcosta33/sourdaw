import { describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';

import { createAnswerInterpretationToolSchema } from '../../models/AnswerInterpretation';
import { type ToolSchema } from '../../models/ToolDefinitions';
import { buildAgentContext } from '../../useCases/buildAgentContext';
import { createPlanningInterpretationToolSchema } from '../../useCases/createPlanningInterpretationToolSchema';
import { getPlanningProviderToolSchemas } from '../../useCases/getPlanningProviderToolSchemas';
import { getProjectContext } from '../../useCases/getProjectContext';
import { prepareAnswerInterpretationCatalog } from '../../useCases/prepareAnswerInterpretationCatalog';
import { prepareCreativeInterpretationCatalog } from '../../useCases/prepareCreativeInterpretationCatalog';
import { matchesJsonSchema } from '../../validators/matchesJsonSchema';
import { buildWebLlmDecodingSchema } from '../buildWebLlmDecodingSchema';

registerDeviceEnginePorts();

type Tool = {
    type: 'function';
    function: { name: string; description?: string; parameters?: Record<string, unknown> };
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const GAIN_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'setTrackGain',
        parameters: {
            type: 'object',
            properties: {
                trackId: { type: 'string' },
                gainDb: { type: 'number', minimum: -60, maximum: 6 },
                options: { type: 'object', properties: { ramp: { type: 'boolean' } } },
                strict: { type: 'object', properties: { only: { type: 'string' } }, additionalProperties: false },
            },
            required: ['trackId', 'gainDb'],
        },
    },
};

const MUTE_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'muteTrack',
        parameters: { type: 'object', properties: { trackId: { type: 'string' } }, required: ['trackId'] },
    },
};

function decodingSchema(tools: readonly Tool[]): Record<string, unknown> {
    const parsed: unknown = JSON.parse(buildWebLlmDecodingSchema(tools));
    if (!isRecord(parsed)) {
        throw new TypeError('decoding schema is not an object');
    }
    return parsed;
}

function branchesOf(schema: Record<string, unknown>): Record<string, unknown>[] {
    const items = schema.items;
    if (!isRecord(items) || !Array.isArray(items.anyOf)) {
        throw new TypeError('decoding schema has no per-tool branches');
    }
    return items.anyOf.filter(isRecord);
}

function allPlanningTools(): ToolSchema[] {
    const context = getProjectContext();
    const prompt = 'Describe the project';
    const projectRevision = 'revision';
    const answerCatalog = prepareAnswerInterpretationCatalog({ prompt, context, projectRevision });
    return [
        ...getPlanningProviderToolSchemas(),
        createPlanningInterpretationToolSchema({
            creative: prepareCreativeInterpretationCatalog({ prompt, context, projectRevision }),
            answer: answerCatalog,
            binding: buildAgentContext({ fixedPolicy: 'policy', prompt, context, projectRevision }).planningBinding,
        }),
        createAnswerInterpretationToolSchema(answerCatalog),
    ];
}

describe('buildWebLlmDecodingSchema', () => {
    it('is an array of calls with one branch per offered tool, named by a const', () => {
        const schema = decodingSchema([GAIN_TOOL, MUTE_TOOL]);

        expect(schema.type).toBe('array');
        expect(schema).not.toHaveProperty('minItems');
        const branches = branchesOf(schema);
        expect(branches.map((branch) => (branch.properties as { name: unknown }).name)).toEqual([
            { const: 'setTrackGain' },
            { const: 'muteTrack' },
        ]);
        for (const branch of branches) {
            expect(branch).toMatchObject({
                type: 'object',
                required: ['id', 'name', 'arguments'],
                additionalProperties: false,
            });
        }
    });

    it("carries each tool's full parameters schema as its arguments", () => {
        const [gain] = branchesOf(decodingSchema([GAIN_TOOL]));
        const args = (gain?.properties as { arguments: Record<string, unknown> }).arguments;

        expect(args.required).toEqual(['trackId', 'gainDb']);
        expect(args.properties).toMatchObject({ gainDb: { type: 'number', minimum: -60, maximum: 6 } });
    });

    // Red when the strict-mode trap is not handled: web-llm's strict compile refuses an unlisted key
    // under any object node that does not state additionalProperties.
    it('states additionalProperties: true on every silent object node and keeps an explicit value', () => {
        const [gain] = branchesOf(decodingSchema([GAIN_TOOL]));
        const args = (gain?.properties as { arguments: Record<string, unknown> }).arguments;
        const properties = args.properties as Record<string, Record<string, unknown>>;

        expect(args.additionalProperties).toBe(true);
        expect(properties.options?.additionalProperties).toBe(true);
        expect(properties.strict?.additionalProperties).toBe(false);
        expect(properties.trackId).not.toHaveProperty('additionalProperties');
    });

    it('fills silent object nodes inside items and combinators', () => {
        const tool: Tool = {
            type: 'function',
            function: {
                name: 'nested',
                parameters: {
                    type: 'object',
                    properties: {
                        list: { type: 'array', items: { type: 'object', properties: { a: { type: 'string' } } } },
                        pick: {
                            anyOf: [{ type: 'object', properties: { b: { type: 'string' } } }, { type: 'string' }],
                        },
                    },
                },
            },
        };
        const text = JSON.stringify(branchesOf(decodingSchema([tool])));

        expect(text).toContain(
            '"items":{"type":"object","properties":{"a":{"type":"string"}},"additionalProperties":true}'
        );
        expect(text).toContain('{"type":"object","properties":{"b":{"type":"string"}},"additionalProperties":true}');
    });

    it('does not mutate the tools it reads', () => {
        const before = JSON.stringify([GAIN_TOOL, MUTE_TOOL]);
        buildWebLlmDecodingSchema([GAIN_TOOL, MUTE_TOOL]);

        expect(JSON.stringify([GAIN_TOOL, MUTE_TOOL])).toBe(before);
    });

    it('admits a batch of valid calls for two tools and refuses what the offered tools do not allow', () => {
        const schema = decodingSchema([GAIN_TOOL, MUTE_TOOL]);
        const valid = [
            { id: 'a', name: 'setTrackGain', arguments: { trackId: 't1', gainDb: -3 } },
            { id: 'b', name: 'muteTrack', arguments: { trackId: 't2' } },
        ];

        expect(matchesJsonSchema(valid, schema)).toBe(true);
        expect(matchesJsonSchema([], schema)).toBe(true);
        expect(matchesJsonSchema([{ id: 'a', name: 'deleteTrack', arguments: {} }], schema)).toBe(false);
        expect(matchesJsonSchema([{ ...valid[0], extra: 1 }], schema)).toBe(false);
        expect(matchesJsonSchema([{ id: '', name: 'muteTrack', arguments: { trackId: 't' } }], schema)).toBe(false);
        expect(matchesJsonSchema([{ id: 'a', name: 'setTrackGain', arguments: { trackId: 't1' } }], schema)).toBe(
            false
        );
        expect(
            matchesJsonSchema([{ id: 'a', name: 'muteTrack', arguments: { trackId: 't', gainDb: 1 } }], schema)
        ).toBe(true);
    });

    it('constrains an empty tool list to an empty batch', () => {
        expect(decodingSchema([])).toEqual({ type: 'array', maxItems: 0 });
    });

    // Nesting a full schema under items.anyOf[i].properties.arguments breaks root-relative
    // references, so no schema the planner can offer may carry one.
    it('finds no $ref in the full schema of any planning tool', () => {
        const withRef: string[] = [];
        function walk(node: unknown, tool: string): void {
            if (Array.isArray(node)) {
                for (const child of node) {
                    walk(child, tool);
                }
            } else if (isRecord(node)) {
                if (Object.hasOwn(node, '$ref')) {
                    withRef.push(tool);
                }
                for (const child of Object.values(node)) {
                    walk(child, tool);
                }
            }
        }
        const tools = allPlanningTools();
        for (const tool of tools) {
            walk(tool.function.parameters, tool.function.name);
        }

        expect(tools.length).toBeGreaterThan(10);
        expect(withRef).toEqual([]);
    });
});
