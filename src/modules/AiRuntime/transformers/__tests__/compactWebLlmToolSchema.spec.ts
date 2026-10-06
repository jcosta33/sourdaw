import { describe, expect, it } from 'vitest';

import { ANALYSIS_MEASURE_MAX_TARGETS } from '../../models/AnalysisMeasureLimits';
import { COMMAND_BATCH_DECLINE_MAX_QUESTIONS } from '../../models/CommandBatchDecline';
import { type ToolSchema } from '../../models/ToolDefinitions';
import { getPlanningProviderToolSchemas } from '../../useCases/getPlanningProviderToolSchemas';
import { matchesJsonSchema } from '../../validators/matchesJsonSchema';
import { compactWebLlmToolSchema } from '../compactWebLlmToolSchema';

type SchemaPath = readonly (string | number)[];

type Fact = {
    keyword: string;
    path: SchemaPath;
    value: unknown;
};

/**
 * Every keyword the compaction must keep: those that decide which values a schema admits and the
 * `description` that tells the model a unit, a range or an "exactly one of" rule. `type` is walked
 * apart from these, because a sibling keyword may imply it (see `isImpliedType`).
 */
const FACT_KEYWORDS = [
    'description',
    'additionalProperties',
    'minItems',
    'maxItems',
    'minLength',
    'maxLength',
    'uniqueItems',
    'pattern',
    'format',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf',
    'enum',
    'const',
    'required',
] as const;

const COMBINATORS = ['anyOf', 'oneOf', 'allOf'] as const;

const SELECTOR_PATH = ['properties', 'list', 'properties', 'items', 'items', 'properties', 'selector'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function planningTool(name: string): ToolSchema {
    const tool = getPlanningProviderToolSchemas().find((schema) => schema.function.name === name);
    if (tool === undefined) {
        throw new Error(`${name} is not a planning tool`);
    }
    return tool;
}

function compactedParameters(name: string): Record<string, unknown> {
    const parameters = compactWebLlmToolSchema(planningTool(name)).function.parameters;
    if (parameters === undefined) {
        throw new Error(`${name} has no parameters`);
    }
    return parameters;
}

/** A node the prompt replaced with `{ "$ref": "#/$defs/dN" }` stands for the definition it names. */
function dereference(node: unknown, root: unknown): unknown {
    if (!isRecord(node) || typeof node.$ref !== 'string' || !isRecord(root) || !isRecord(root.$defs)) {
        return node;
    }
    return dereference(root.$defs[node.$ref.split('/').at(-1) ?? ''], root);
}

function at(root: unknown, path: SchemaPath): unknown {
    let current = dereference(root, root);
    for (const step of path) {
        if (Array.isArray(current) && typeof step === 'number') {
            current = dereference(current[step], root);
        } else if (isRecord(current) && typeof step === 'string') {
            current = dereference(current[step], root);
        } else {
            return undefined;
        }
    }
    return current;
}

/** The prompt text with each reference replaced by its definition, the schema a reader of the prompt holds. */
function inlineDefinitions(node: unknown, root: unknown): unknown {
    if (Array.isArray(node)) {
        return node.map((child) => inlineDefinitions(child, root));
    }
    if (!isRecord(node)) {
        return node;
    }
    if (typeof node.$ref === 'string') {
        return inlineDefinitions(dereference(node, root), root);
    }
    return Object.fromEntries(
        Object.entries(node)
            .filter(([keyword]) => keyword !== '$defs')
            .map(([keyword, child]) => [keyword, inlineDefinitions(child, root)])
    );
}

/**
 * A nested node's `type` the compaction may drop because a sibling keyword says it: an object that lists
 * properties, an array that lists items, a string whose enum is all strings. The root keeps its type.
 * Any other `type` (number, integer, boolean, a bare object or array) decides what validates and stays.
 */
function isImpliedType(node: Record<string, unknown>, path: SchemaPath): boolean {
    if (path.length === 0) {
        return false;
    }
    if (node.type === 'object') {
        return isRecord(node.properties);
    }
    if (node.type === 'array') {
        return isRecord(node.items);
    }
    return node.type === 'string' && Array.isArray(node.enum) && node.enum.every((value) => typeof value === 'string');
}

/** Every description, validity keyword, type and combinator of a full schema, with where it sits. */
function collectFacts(node: unknown, path: SchemaPath): Fact[] {
    if (!isRecord(node)) {
        return [];
    }
    const facts: Fact[] = [];
    for (const keyword of FACT_KEYWORDS) {
        if (Object.hasOwn(node, keyword)) {
            facts.push({ keyword, path, value: node[keyword] });
        }
    }
    if (Object.hasOwn(node, 'type') && !isImpliedType(node, path)) {
        facts.push({ keyword: 'type', path, value: node.type });
    }
    for (const combinator of COMBINATORS) {
        const branches = node[combinator];
        if (Array.isArray(branches)) {
            facts.push({ keyword: combinator, path, value: branches.length });
            for (const [index, branch] of branches.entries()) {
                facts.push(...collectFacts(branch, [...path, combinator, index]));
            }
        }
    }
    if (isRecord(node.properties)) {
        for (const [name, property] of Object.entries(node.properties)) {
            facts.push(...collectFacts(property, [...path, 'properties', name]));
        }
    }
    facts.push(...collectFacts(node.items, [...path, 'items']));
    return facts;
}

function survives(compacted: unknown, fact: Fact): boolean {
    const node = at(compacted, fact.path);
    if (!isRecord(node)) {
        return false;
    }
    if ((COMBINATORS as readonly string[]).includes(fact.keyword)) {
        const branches = node[fact.keyword];
        return Array.isArray(branches) && branches.length === fact.value;
    }
    if (JSON.stringify(node[fact.keyword]) !== JSON.stringify(fact.value)) {
        return false;
    }
    if (fact.keyword !== 'required') {
        return true;
    }
    const names = Array.isArray(fact.value) ? fact.value : [];
    return names.every((name) => at(compacted, [...fact.path, 'properties', String(name)]) !== undefined);
}

function maxItemsOf(toolName: string, property: string): number {
    const maxItems = at(planningTool(toolName).function.parameters, ['properties', property, 'maxItems']);
    if (typeof maxItems !== 'number') {
        throw new TypeError(`${toolName}.${property} has no maxItems`);
    }
    return maxItems;
}

function strings(count: number): string[] {
    return Array.from({ length: count }, (_, index) => `item-${String(index)}`);
}

function projectQueryType(): string {
    const type = at(planningTool('project.query').function.parameters, ['properties', 'type', 'enum', 0]);
    if (typeof type !== 'string') {
        throw new TypeError('project.query has no query type');
    }
    return type;
}

describe('compactWebLlmToolSchema', () => {
    it('keeps a tool description word for word, however long', () => {
        const description = `${'A long sentence about one thing. '.repeat(20)}And the rule that matters last.`;
        const compacted = compactWebLlmToolSchema({
            type: 'function',
            function: { name: 'demo', description, parameters: {} },
        });

        expect(compacted.function.description).toBe(description);
    });

    // Red when any tool description is dropped or shortened: a description holds rules the schema
    // cannot state, such as "return this call alone" and "pass the returned callId in compiledCallIds".
    it('keeps the whole description of every planning tool', () => {
        for (const tool of getPlanningProviderToolSchemas()) {
            expect(
                compactWebLlmToolSchema(tool).function.description,
                `${tool.function.name} keeps its description`
            ).toBe(tool.function.description);
        }
        expect(compactWebLlmToolSchema(planningTool('command.batch.decline')).function.description).toContain(
            'Return this call alone in its turn.'
        );
        expect(compactWebLlmToolSchema(planningTool('recipe.expand')).function.description).toContain(
            'compiledCallIds'
        );
    });

    it('keeps names, enums, required, descriptions and every validity keyword, and drops annotations and implied types', () => {
        const compacted = compactWebLlmToolSchema({
            type: 'function',
            function: {
                name: 'demo',
                parameters: {
                    type: 'object',
                    properties: {
                        mode: { type: 'string', enum: ['a', 'b'], description: 'Which one.', maxLength: 8 },
                        gainDb: { type: 'number', minimum: -60, maximum: 6, multipleOf: 0.5, default: 0 },
                        ids: {
                            type: 'array',
                            minItems: 1,
                            maxItems: 4,
                            uniqueItems: true,
                            description: 'Track ids.',
                            items: { type: 'string', minLength: 1, pattern: '^[a-z]+$', title: 'An id' },
                        },
                    },
                    required: ['mode'],
                    additionalProperties: false,
                },
            },
        });

        expect(compacted.function.parameters).toEqual({
            type: 'object',
            properties: {
                mode: { enum: ['a', 'b'], description: 'Which one.', maxLength: 8 },
                gainDb: { type: 'number', minimum: -60, maximum: 6, multipleOf: 0.5 },
                ids: {
                    minItems: 1,
                    maxItems: 4,
                    uniqueItems: true,
                    description: 'Track ids.',
                    items: { type: 'string', minLength: 1, pattern: '^[a-z]+$' },
                },
            },
            required: ['mode'],
            additionalProperties: false,
        });
    });

    it('collapses a node nested past the prompt depth to its type, enum and description', () => {
        let nested: Record<string, unknown> = { type: 'object', properties: { leaf: { type: 'string' } } };
        for (let level = 0; level < 12; level += 1) {
            nested = { type: 'object', description: 'A level.', properties: { next: nested } };
        }
        const compacted = compactWebLlmToolSchema({
            type: 'function',
            function: { name: 'demo', parameters: nested },
        });

        const text = JSON.stringify(compacted.function.parameters);
        expect(text).not.toContain('leaf');
        expect(text).toContain('{"type":"object","description":"A level."}');
    });

    // Red when any description or validity keyword is dropped, or the prompt depth falls short of the
    // deepest required shape: the reply is checked against the full schema, so a call the compacted
    // text admits fails the whole provider attempt, and a unit or range the text omits is a silently
    // wrong edit.
    it('keeps every description, validity keyword, required list, enum, const and combinator of every planning tool', () => {
        const dropped: string[] = [];
        let checked = 0;
        for (const tool of getPlanningProviderToolSchemas()) {
            const compacted = compactWebLlmToolSchema(tool).function.parameters;
            for (const fact of collectFacts(tool.function.parameters, [])) {
                checked += 1;
                if (!survives(compacted, fact)) {
                    dropped.push(`${tool.function.name}: ${fact.keyword} at ${fact.path.join('.')}`);
                }
            }
        }

        expect(checked).toBeGreaterThan(450);
        expect(dropped).toEqual([]);
    });

    it('keeps the unit and range text a pan and a gain handler rely on', () => {
        const pan = JSON.stringify(compactWebLlmToolSchema(planningTool('setTrackPan')));
        const gain = JSON.stringify(compactWebLlmToolSchema(planningTool('setTrackGain')));

        expect(pan).toContain('-50');
        expect(pan).toContain('hard left');
        expect(gain).toContain('dB');
    });

    it('defines a repeated sub-schema once and shows a reference at each use', () => {
        const compacted = compactedParameters('command.batch.propose');
        const text = JSON.stringify(compacted);

        expect(compacted).toHaveProperty(['$defs']);
        expect(text).toContain('"$ref":"#/$defs/');
        // The predicate sits under both `all` and `any` in the full schema and is spelled once here.
        expect(text.split('"hasDeviceType"')).toHaveLength(2);
    });

    it('keeps the selector quantity unit that a proposal list item is refused without', () => {
        expect(
            at(compactedParameters('command.batch.propose'), [...SELECTOR_PATH, 'properties', 'quantity'])
        ).toMatchObject({ properties: { unit: { enum: ['targets'] } }, required: ['unit'] });
    });

    it('keeps the exactly-one rules the list description states for a quantity and a predicate', () => {
        const description = at(compactedParameters('command.batch.propose'), ['properties', 'list', 'description']);

        expect(description).toContain('exactly one of an exact count or a maximum');
        expect(description).toContain('exactly one of role');
    });

    describe('refuses what the full schema refuses', () => {
        const declineQuestions = COMMAND_BATCH_DECLINE_MAX_QUESTIONS;
        const cases = [
            {
                label: 'recipe.discover with one descriptor more than it takes',
                tool: 'recipe.discover',
                refused: { descriptors: strings(maxItemsOf('recipe.discover', 'descriptors') + 1) },
                admitted: { descriptors: strings(maxItemsOf('recipe.discover', 'descriptors')) },
            },
            {
                label: 'project.query with a filter it does not list',
                tool: 'project.query',
                refused: { type: projectQueryType(), filters: { exactName: 'Kick' } },
                admitted: { type: projectQueryType(), filters: {} },
            },
            {
                label: 'command.batch.decline clarify with one question more than it takes',
                tool: 'command.batch.decline',
                refused: { kind: 'clarify', reason: 'Which kick?', questions: strings(declineQuestions + 1) },
                admitted: { kind: 'clarify', reason: 'Which kick?', questions: strings(declineQuestions) },
            },
            {
                label: 'device.factory-manifest.read with one type more than it takes',
                tool: 'device.factory-manifest.read',
                refused: { types: strings(maxItemsOf('device.factory-manifest.read', 'types') + 1) },
                admitted: { types: strings(maxItemsOf('device.factory-manifest.read', 'types')) },
            },
            {
                label: 'device.factory-manifest.read with no types listed',
                tool: 'device.factory-manifest.read',
                refused: { types: [] },
                admitted: {},
            },
            {
                label: 'analysis.measure with one scope id more than it takes',
                tool: 'analysis.measure',
                refused: {
                    scope: { kind: 'tracks', ids: strings(ANALYSIS_MEASURE_MAX_TARGETS + 1) },
                    range: { startBeat: 0, endBeat: 4 },
                },
                admitted: {
                    scope: { kind: 'tracks', ids: strings(ANALYSIS_MEASURE_MAX_TARGETS) },
                    range: { startBeat: 0, endBeat: 4 },
                },
            },
        ];

        it.each(cases)('$label', ({ tool, refused, admitted }) => {
            const full = planningTool(tool).function.parameters;
            const compacted = compactedParameters(tool);
            const compactedSchema = inlineDefinitions(compacted, compacted);

            expect(matchesJsonSchema(refused, full)).toBe(false);
            expect(matchesJsonSchema(refused, compactedSchema)).toBe(false);
            expect(matchesJsonSchema(admitted, full)).toBe(true);
            expect(matchesJsonSchema(admitted, compactedSchema)).toBe(true);
        });
    });

    it('does not mutate the schema the provider request validates against', () => {
        const proposal = planningTool('command.batch.propose');
        const before = JSON.stringify(proposal);

        compactWebLlmToolSchema(proposal);

        expect(JSON.stringify(proposal)).toBe(before);
    });

    it('keeps the sentence that says a manifest call without types lists every device type', () => {
        const compacted = compactWebLlmToolSchema(planningTool('device.factory-manifest.read'));

        expect(compacted.function.description).toContain('Call with no arguments to list every available device type');
    });

    it('keeps the transform grammar its document description carries, worked example and limits included', () => {
        const compactedText = JSON.stringify(compactedParameters('transform.compile'));

        expect(compactedText).toContain('Required document keys');
        expect(compactedText).toContain('Step:');
        expect(compactedText).toContain('Limits:');
        expect(compactedText).toContain('Valid complete document JSON text');
    });
});
