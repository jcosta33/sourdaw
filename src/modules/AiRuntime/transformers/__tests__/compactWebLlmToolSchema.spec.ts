import { describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';

import { ANALYSIS_MEASURE_MAX_TARGETS } from '../../models/AnalysisMeasureLimits';
import { createAnswerInterpretationToolSchema } from '../../models/AnswerInterpretation';
import { COMMAND_BATCH_DECLINE_MAX_QUESTIONS } from '../../models/CommandBatchDecline';
import { type ToolSchema } from '../../models/ToolDefinitions';
import { buildAgentContext } from '../../useCases/buildAgentContext';
import { createPlanningInterpretationToolSchema } from '../../useCases/createPlanningInterpretationToolSchema';
import { getPlanningProviderToolSchemas } from '../../useCases/getPlanningProviderToolSchemas';
import { getProjectContext } from '../../useCases/getProjectContext';
import { prepareAnswerInterpretationCatalog } from '../../useCases/prepareAnswerInterpretationCatalog';
import { prepareCreativeInterpretationCatalog } from '../../useCases/prepareCreativeInterpretationCatalog';
import { matchesJsonSchema } from '../../validators/matchesJsonSchema';
import { compactWebLlmToolSchema, compactWebLlmToolSchemas } from '../compactWebLlmToolSchema';
import { serializeWebLlmToolPlanningPrompt } from '../serializeWebLlmToolPlanningPrompt';

registerDeviceEnginePorts();

function jointInterpretationSchema(): ToolSchema {
    const context = getProjectContext();
    const prompt = 'Describe the project';
    const projectRevision = 'revision';
    return createPlanningInterpretationToolSchema({
        creative: prepareCreativeInterpretationCatalog({ prompt, context, projectRevision }),
        answer: prepareAnswerInterpretationCatalog({ prompt, context, projectRevision }),
        binding: buildAgentContext({ fixedPolicy: 'policy', prompt, context, projectRevision }).planningBinding,
    });
}

type SchemaPath = readonly (string | number)[];

type Fact = {
    keyword: string;
    path: SchemaPath;
    value: unknown;
};

/**
 * Every keyword the compaction must keep: those that decide which values a schema admits and the
 * `description` that tells the model a unit, a range or an "exactly one of" rule. `type` is walked
 * apart from these, because one case is exempt (see `collectFacts`).
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

function compactedParametersOf(tool: ToolSchema): { properties: Record<string, unknown> } & Record<string, unknown> {
    const parameters = compactWebLlmToolSchema(tool).function.parameters;
    if (parameters === undefined || !isRecord(parameters.properties)) {
        throw new Error(`${tool.function.name} has no parameters`);
    }
    return { ...parameters, properties: parameters.properties };
}

function compactedParameters(name: string): Record<string, unknown> {
    const parameters = compactWebLlmToolSchema(planningTool(name)).function.parameters;
    if (parameters === undefined) {
        throw new Error(`${name} has no parameters`);
    }
    return parameters;
}

/**
 * Every planning tool compacted together, as one prompt spells them, each read with the shared
 * definitions merged into its own `$defs`: the schema a reader of that prompt holds for the tool.
 */
function sharedCompactedTools(tools: readonly ToolSchema[] = allPlanningTools()): Map<string, Record<string, unknown>> {
    const { sharedDefinitions, tools: compacted } = compactWebLlmToolSchemas(tools);
    return new Map(
        compacted.map((tool) => {
            const parameters = tool.function.parameters ?? {};
            const ownDefinitions = isRecord(parameters.$defs) ? parameters.$defs : {};
            return [tool.function.name, { ...parameters, $defs: { ...ownDefinitions, ...sharedDefinitions } }];
        })
    );
}

function sharedCompactedParameters(name: string): Record<string, unknown> {
    const parameters = sharedCompactedTools().get(name);
    if (parameters === undefined) {
        throw new Error(`${name} is not a planning tool`);
    }
    return parameters;
}

function allPlanningTools(): ToolSchema[] {
    return [
        ...getPlanningProviderToolSchemas(),
        jointInterpretationSchema(),
        createAnswerInterpretationToolSchema(
            prepareAnswerInterpretationCatalog({
                prompt: 'Describe the project',
                context: getProjectContext(),
                projectRevision: 'revision',
            })
        ),
    ];
}

function occurrences(text: string, fragment: string): number {
    return text.split(fragment).length - 1;
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
    // Every `type` must survive, with one exception written out here and nowhere shared with the
    // compactor: a "string" type on a node whose enum lists only strings. That enum already refuses
    // every value that is not one of its strings, so the type adds nothing. An object or array type
    // is never exempt, because `properties` and `items` are ignored for any other kind of value.
    const isStringEnum =
        node.type === 'string' && Array.isArray(node.enum) && node.enum.every((value) => typeof value === 'string');
    if (Object.hasOwn(node, 'type') && !isStringEnum) {
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
    return names.every((name) => {
        let objectPath = fact.path;
        while (at(compacted, [...objectPath, 'properties', String(name)]) === undefined) {
            const combinator = objectPath.at(-2);
            // A combinator constrains the same object as its parent; a property/items step does not.
            if (typeof combinator !== 'string' || !(COMBINATORS as readonly string[]).includes(combinator)) {
                return false;
            }
            objectPath = objectPath.slice(0, -2);
        }
        return true;
    });
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
    it('finds inherited required properties through same-object combinators only', () => {
        const inherited = {
            properties: { intakeCallId: { type: 'string' } },
            anyOf: [{ required: ['intakeCallId'] }],
        };
        expect(survives(inherited, { keyword: 'required', path: ['anyOf', 0], value: ['intakeCallId'] })).toBe(true);
        expect(
            survives({ anyOf: inherited.anyOf }, { keyword: 'required', path: ['anyOf', 0], value: ['intakeCallId'] })
        ).toBe(false);
        const anotherObject = {
            properties: {
                intakeCallId: { type: 'string' },
                nested: { anyOf: inherited.anyOf },
            },
        };
        expect(
            survives(anotherObject, {
                keyword: 'required',
                path: ['properties', 'nested', 'anyOf', 0],
                value: ['intakeCallId'],
            })
        ).toBe(false);
        expect(survives(inherited, { keyword: 'required', path: ['anyOf', 0], value: [] })).toBe(false);
    });

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
        for (const tool of [
            ...getPlanningProviderToolSchemas(),
            jointInterpretationSchema(),
            createAnswerInterpretationToolSchema(
                prepareAnswerInterpretationCatalog({
                    prompt: 'Describe the project',
                    context: getProjectContext(),
                    projectRevision: 'revision',
                })
            ),
        ]) {
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

    it("keeps names, enums, required, descriptions, every validity keyword and every type but an all-string enum's, and drops annotations", () => {
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
                    type: 'array',
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
        for (const tool of [
            ...getPlanningProviderToolSchemas(),
            jointInterpretationSchema(),
            createAnswerInterpretationToolSchema(
                prepareAnswerInterpretationCatalog({
                    prompt: 'Describe the project',
                    context: getProjectContext(),
                    projectRevision: 'revision',
                })
            ),
        ]) {
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

    // Red when the shared definitions lose or merge anything: each tool read with them merged in
    // must keep every fact its full schema states.
    it('keeps every description and validity keyword of every planning tool through the shared definitions', () => {
        const tools = allPlanningTools();
        const shared = sharedCompactedTools(tools);
        const dropped: string[] = [];
        let checked = 0;
        for (const tool of tools) {
            const compacted = shared.get(tool.function.name);
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

    // Red when a sub-schema two tools repeat is spelled in each: the proposal list is the same
    // schema under command.batch.propose and analysis.measure, and the prompt carries it once.
    it('defines a sub-schema two tools repeat once in the shared definitions and references it from both', () => {
        const proposal = planningTool('command.batch.propose');
        const measure = planningTool('analysis.measure');
        const { sharedDefinitions, tools } = compactWebLlmToolSchemas([proposal, measure]);
        const listDescription = 'Version 1 bounded semantic command list.';

        expect(JSON.stringify(proposal)).toContain(listDescription);
        expect(JSON.stringify(measure)).toContain(listDescription);
        expect(occurrences(JSON.stringify(sharedDefinitions), listDescription)).toBe(1);
        for (const tool of tools) {
            const text = JSON.stringify(tool.function.parameters);
            expect(text, `${tool.function.name} refers to the shared list`).toMatch(/"\$ref":"#\/\$defs\/s\d+"/);
            expect(text, `${tool.function.name} no longer spells the list`).not.toContain(listDescription);
        }
        // The predicate group the list repeats inside itself is spelled once there as well.
        expect(occurrences(JSON.stringify(sharedDefinitions), '"hasDeviceType"')).toBe(1);
    });

    it('serializes the shared definitions once, before the tools, with the line saying how tools refer to them', () => {
        const prompt = serializeWebLlmToolPlanningPrompt('system', [
            planningTool('command.batch.propose'),
            planningTool('analysis.measure'),
        ]);
        const [beforeTools, toolLines] = prompt.split('Available tools:\n');

        expect(occurrences(prompt, 'Version 1 bounded semantic command list.')).toBe(1);
        expect(beforeTools).toContain('Version 1 bounded semantic command list.');
        expect(beforeTools).toContain('{"$ref":"#/$defs/<name>"} stands for the definition of that name');
        expect(toolLines).toMatch(/"\$ref":"#\/\$defs\/s\d+"/);
    });

    it('serializes no shared definitions for tools that share nothing', () => {
        const prompt = serializeWebLlmToolPlanningPrompt('system', [planningTool('command.batch.decline')]);

        expect(prompt).not.toContain('Shared schema definitions');
        expect(prompt).toContain(
            `- command.batch.decline: ${planningTool('command.batch.decline').function.description} ${JSON.stringify(compactedParameters('command.batch.decline'))}`
        );
    });

    // Red when sub-schemas that differ anywhere are merged: one word of one description apart, each
    // stays in its own tool.
    it('shares only byte-identical sub-schemas and keeps a shape that differs anywhere per tool', () => {
        function shape(description: string) {
            return {
                type: 'object',
                properties: {
                    limit: { type: 'integer', minimum: 1, maximum: 64, description },
                    cursor: { type: 'string' },
                },
                additionalProperties: false,
            };
        }
        function tool(name: string, description: string): ToolSchema {
            return {
                type: 'function',
                function: {
                    name,
                    description: name,
                    parameters: { type: 'object', properties: { page: shape(description) }, required: [] },
                },
            };
        }

        const differing = compactWebLlmToolSchemas([
            tool('a', 'How many entries one page holds.'),
            tool('b', 'How many entries a page holds.'),
        ]);
        const identical = compactWebLlmToolSchemas([
            tool('a', 'How many entries one page holds.'),
            tool('b', 'How many entries one page holds.'),
        ]);

        expect(differing.sharedDefinitions).toEqual({});
        expect(differing.tools.map((compacted) => compacted.function.parameters)).toEqual([
            compactedParametersOf(tool('a', 'How many entries one page holds.')),
            compactedParametersOf(tool('b', 'How many entries a page holds.')),
        ]);
        expect(Object.values(identical.sharedDefinitions)).toEqual([
            compactedParametersOf(tool('a', 'How many entries one page holds.')).properties.page,
        ]);
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
                refused: { type: projectQueryType(), filters: { unknownFilter: 'Kick' } },
                admitted: { type: projectQueryType(), filters: { exactName: 'Kick' } },
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
                label: 'device.factory-manifest.read with a string where the types array belongs',
                tool: 'device.factory-manifest.read',
                refused: { types: 'eq' },
                admitted: { types: ['eq'] },
            },
            {
                label: 'project.query with a number where the page object belongs',
                tool: 'project.query',
                refused: { type: projectQueryType(), page: 2 },
                admitted: { type: projectQueryType(), page: { limit: 2 } },
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
            const shared = sharedCompactedParameters(tool);
            const sharedSchema = inlineDefinitions(shared, shared);
            expect(matchesJsonSchema(refused, sharedSchema)).toBe(false);
            expect(matchesJsonSchema(admitted, sharedSchema)).toBe(true);
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

        expect(compacted.function.description).toContain('No arguments lists the device types');
    });

    it('keeps the transform grammar its document description carries, worked example and limits included', () => {
        const compactedText = JSON.stringify(compactedParameters('transform.compile'));

        expect(compactedText).toContain('Required document keys');
        expect(compactedText).toContain('Step:');
        expect(compactedText).toContain('Limits:');
        expect(compactedText).toContain('Valid complete document JSON text');
    });
});

describe('recipe preview source in the local prompt', () => {
    it.each(['expand-1', '', 'x'.repeat(257), null, ['expand-1']])(
        'preserves the original admission for recipeCallId=%j',
        (recipeCallId) => {
            const full = planningTool('analysis.measure').function.parameters;
            const compact = inlineDefinitions(
                compactedParameters('analysis.measure'),
                compactedParameters('analysis.measure')
            );
            const args = {
                scope: { kind: 'master' },
                range: { startBeat: 0, endBeat: 8 },
                subject: 'preview',
                recipeCallId,
            };
            const expected = recipeCallId === 'expand-1';
            expect(matchesJsonSchema(args, full)).toBe(expected);
            expect(matchesJsonSchema(args, compact)).toBe(expected);
            const shared = sharedCompactedParameters('analysis.measure');
            expect(matchesJsonSchema(args, inlineDefinitions(shared, shared))).toBe(expected);
        }
    );
});
