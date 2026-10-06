import { describe, expect, it } from 'vitest';

import { type ToolSchema } from '../../models/ToolDefinitions';
import { getPlanningProviderToolSchemas } from '../../useCases/getPlanningProviderToolSchemas';
import { compactWebLlmToolSchema } from '../compactWebLlmToolSchema';

function planningTool(name: string): ToolSchema {
    const tool = getPlanningProviderToolSchemas().find((schema) => schema.function.name === name);
    if (tool === undefined) {
        throw new Error(`${name} is not a planning tool`);
    }
    return tool;
}

type Essential = {
    keyword: 'required' | 'enum' | 'const' | 'combinator';
    path: readonly (string | number)[];
    value: unknown;
};

const COMBINATORS = ['anyOf', 'oneOf', 'allOf'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function at(root: unknown, path: readonly (string | number)[]): unknown {
    let current = root;
    for (const step of path) {
        if (Array.isArray(current) && typeof step === 'number') {
            current = current[step];
        } else if (isRecord(current) && typeof step === 'string') {
            current = current[step];
        } else {
            return undefined;
        }
    }
    return current;
}

/** The properties the prompt replaces with a pointer to the schema that owns them. */
function isPointedAt(toolName: string, path: readonly (string | number)[]): boolean {
    return toolName === 'analysis.measure' && path[0] === 'properties' && path[1] === 'proposal';
}

/** Every required list, enum, const and combinator in a full schema, with where it sits. */
function collectEssentials(node: unknown, path: (string | number)[], toolName: string): Essential[] {
    if (!isRecord(node) || isPointedAt(toolName, path)) {
        return [];
    }
    const essentials: Essential[] = [];
    if (Array.isArray(node.required)) {
        essentials.push({ keyword: 'required', path, value: node.required });
    }
    if (node.enum !== undefined) {
        essentials.push({ keyword: 'enum', path, value: node.enum });
    }
    if (node.const !== undefined) {
        essentials.push({ keyword: 'const', path, value: node.const });
    }
    for (const combinator of COMBINATORS) {
        const branches = node[combinator];
        if (Array.isArray(branches)) {
            essentials.push({ keyword: 'combinator', path: [...path, combinator], value: branches.length });
            for (const [index, branch] of branches.entries()) {
                essentials.push(...collectEssentials(branch, [...path, combinator, index], toolName));
            }
        }
    }
    if (isRecord(node.properties)) {
        for (const [name, property] of Object.entries(node.properties)) {
            essentials.push(...collectEssentials(property, [...path, 'properties', name], toolName));
        }
    }
    essentials.push(...collectEssentials(node.items, [...path, 'items'], toolName));
    return essentials;
}

function survives(compacted: unknown, essential: Essential): boolean {
    if (essential.keyword === 'combinator') {
        const branches = at(compacted, essential.path);
        return Array.isArray(branches) && branches.length === essential.value;
    }
    const found = at(compacted, [...essential.path, essential.keyword]);
    if (essential.keyword !== 'required') {
        return JSON.stringify(found) === JSON.stringify(essential.value);
    }
    const names = Array.isArray(essential.value) ? essential.value : [];
    return (
        JSON.stringify(found) === JSON.stringify(essential.value) &&
        names.every((name) => at(compacted, [...essential.path, 'properties', String(name)]) !== undefined)
    );
}

describe('compactWebLlmToolSchema', () => {
    it('keeps the first sentence of a tool description and drops the rest', () => {
        const compacted = compactWebLlmToolSchema({
            type: 'function',
            function: {
                name: 'demo',
                description: 'Does one thing. Then explains at length. And again.',
                parameters: {},
            },
        });

        expect(compacted.function.description).toBe('Does one thing.');
    });

    it('keeps names, enums, required and numeric bounds, drops annotations, size bounds and implied types', () => {
        const compacted = compactWebLlmToolSchema({
            type: 'function',
            function: {
                name: 'demo',
                parameters: {
                    type: 'object',
                    properties: {
                        mode: { type: 'string', enum: ['a', 'b'], description: 'Which one.', maxLength: 8 },
                        gainDb: { type: 'number', minimum: -60, maximum: 6 },
                        ids: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', minLength: 1 } },
                    },
                    required: ['mode'],
                    additionalProperties: false,
                },
            },
        });

        expect(compacted.function.parameters).toEqual({
            type: 'object',
            properties: {
                mode: { enum: ['a', 'b'] },
                gainDb: { type: 'number', minimum: -60, maximum: 6 },
                ids: { items: { type: 'string' } },
            },
            required: ['mode'],
        });
    });

    it('collapses a node nested past the prompt depth to its type and enum', () => {
        let nested: Record<string, unknown> = { type: 'object', properties: { leaf: { type: 'string' } } };
        for (let level = 0; level < 12; level += 1) {
            nested = { type: 'object', properties: { next: nested } };
        }
        const compacted = compactWebLlmToolSchema({
            type: 'function',
            function: { name: 'demo', parameters: nested },
        });

        expect(JSON.stringify(compacted.function.parameters)).not.toContain('leaf');
    });

    // Red when the prompt depth falls short of the deepest required shape: the selector then loses
    // `quantity.unit`, and the application refuses a selector written without it.
    it('keeps every required property, required list, enum, const and combinator branch of every planning tool', () => {
        const dropped: string[] = [];
        let checked = 0;
        for (const tool of getPlanningProviderToolSchemas()) {
            const compacted = compactWebLlmToolSchema(tool).function.parameters;
            for (const essential of collectEssentials(tool.function.parameters, [], tool.function.name)) {
                checked += 1;
                if (!survives(compacted, essential)) {
                    dropped.push(`${tool.function.name}: ${essential.keyword} at ${essential.path.join('.')}`);
                }
            }
        }

        expect(checked).toBeGreaterThan(80);
        expect(dropped).toEqual([]);
    });

    it('keeps the selector quantity unit that a proposal list item is refused without', () => {
        const compacted = compactWebLlmToolSchema(planningTool('command.batch.propose'));

        expect(compacted.function.parameters).toHaveProperty(
            [
                'properties',
                'list',
                'properties',
                'items',
                'items',
                'properties',
                'selector',
                'properties',
                'quantity',
                'properties',
                'unit',
                'enum',
            ],
            ['targets']
        );
    });

    it('does not mutate the schema the provider request validates against', () => {
        const proposal = planningTool('command.batch.propose');
        const before = JSON.stringify(proposal);

        compactWebLlmToolSchema(proposal);

        expect(JSON.stringify(proposal)).toBe(before);
    });

    it('points analysis.measure at the list command.batch.propose takes instead of repeating it', () => {
        const compacted = compactWebLlmToolSchema(planningTool('analysis.measure'));

        expect(compacted.function.parameters).toHaveProperty(['properties', 'proposal', 'type'], 'object');
        expect(compacted.function.parameters).toHaveProperty(['properties', 'scope', 'required'], ['kind']);
        const text = JSON.stringify(compacted);
        expect(text).toContain('command.batch.propose');
        expect(text).toContain('list argument');
        expect(text).not.toContain('schemaVersion');
    });

    it('keeps the transform grammar its document description carries, without the worked example', () => {
        const original = planningTool('transform.compile');
        const compacted = compactWebLlmToolSchema(original);

        const originalText = JSON.stringify(original.function.parameters);
        const compactedText = JSON.stringify(compacted.function.parameters);
        expect(originalText).toContain('Valid complete document JSON text');
        expect(compactedText).toContain('Required document keys');
        expect(compactedText).toContain('Step:');
        expect(compactedText).not.toContain('Valid complete document JSON text');
        expect(compactedText.length).toBeLessThan(originalText.length);
    });
});
