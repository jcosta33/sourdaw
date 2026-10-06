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

    it('keeps names, types, enums, required and numeric bounds, and drops annotations and size bounds', () => {
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
                mode: { type: 'string', enum: ['a', 'b'] },
                gainDb: { type: 'number', minimum: -60, maximum: 6 },
                ids: { type: 'array', items: { type: 'string' } },
            },
            required: ['mode'],
        });
    });

    it('collapses a node nested deeper than the prompt spells out to its type and enum', () => {
        const leaf = { type: 'object', properties: { six: { type: 'string' } }, description: 'deep' };
        const compacted = compactWebLlmToolSchema({
            type: 'function',
            function: {
                name: 'demo',
                parameters: {
                    type: 'object',
                    properties: {
                        one: {
                            type: 'object',
                            properties: {
                                two: {
                                    type: 'object',
                                    properties: {
                                        three: {
                                            type: 'object',
                                            properties: { four: { type: 'object', properties: { five: leaf } } },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        expect(compacted.function.parameters).toHaveProperty(
            [
                'properties',
                'one',
                'properties',
                'two',
                'properties',
                'three',
                'properties',
                'four',
                'properties',
                'five',
            ],
            { type: 'object' }
        );
        expect(JSON.stringify(compacted.function.parameters)).not.toContain('six');
    });

    it('does not mutate the schema the provider request validates against', () => {
        const proposal = planningTool('command.batch.propose');
        const before = JSON.stringify(proposal);

        compactWebLlmToolSchema(proposal);

        expect(JSON.stringify(proposal)).toBe(before);
    });

    it('replaces the proposal analysis.measure repeats with a reference to command.batch.propose', () => {
        const compacted = compactWebLlmToolSchema(planningTool('analysis.measure'));

        expect(compacted.function.parameters).toHaveProperty(['properties', 'proposal'], { type: 'object' });
        expect(compacted.function.parameters).toHaveProperty(['properties', 'scope', 'required'], ['kind']);
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
