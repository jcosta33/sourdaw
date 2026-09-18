import { describe, expect, it } from 'vitest';

import { type ToolSchema } from '../../../models/Tools/Types';
import { getPlanningProviderToolSchemas } from '../../../useCases/getPlanningProviderToolSchemas';
import { projectAnthropicStrictToolSchema } from '../cloudInference/projectAnthropicStrictToolSchema';
import { isToolSchemaProjectionError } from '../cloudInference/ToolSchemaProjectionError';

const BOUND_KEYWORDS = [
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf',
    'minLength',
    'maxLength',
    'pattern',
    'format',
    'maxItems',
] as const;

function tool(parameters: Record<string, unknown>): ToolSchema {
    return {
        type: 'function',
        function: {
            name: 'setTempo',
            description: 'Set tempo',
            parameters: parameters as unknown as ToolSchema['function']['parameters'],
        },
    };
}

/**
 * Recursively collects every occurrence of a stripped bound keyword still present as a
 * schema node's own keyword. Schema-structure-aware rather than a blind key walk: a tool
 * argument is free to be named "pattern" (an arpeggiator pattern, say), and that property
 * name must never be mistaken for the JSON Schema `pattern` keyword it happens to share a
 * spelling with. Only `properties`, `items`, and the composition keywords carry nested
 * schema nodes; every other key is a schema keyword's own value, never itself a schema.
 */
function findBoundKeywords(node: unknown, found: string[] = []): string[] {
    if (Array.isArray(node)) {
        for (const entry of node) {
            findBoundKeywords(entry, found);
        }
        return found;
    }
    if (typeof node !== 'object' || node === null) {
        return found;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if ((BOUND_KEYWORDS as readonly string[]).includes(key)) {
            found.push(key);
            continue;
        }
        if (key === 'properties' && typeof value === 'object' && value !== null) {
            for (const propertySchema of Object.values(value as Record<string, unknown>)) {
                findBoundKeywords(propertySchema, found);
            }
            continue;
        }
        if (key === 'items' || key === 'anyOf' || key === 'oneOf' || key === 'allOf') {
            findBoundKeywords(value, found);
        }
    }
    return found;
}

describe('projectAnthropicStrictToolSchema', () => {
    it('strips a numeric range into the description and off the schema', () => {
        const schema = tool({
            type: 'object',
            properties: { bpm: { type: 'number', minimum: 20, maximum: 300, description: 'Beats per minute.' } },
            required: ['bpm'],
            additionalProperties: false,
        });

        const projected = projectAnthropicStrictToolSchema(schema);
        const bpmProperty = (projected.function.parameters.properties as { bpm: Record<string, unknown> }).bpm;

        expect(bpmProperty).not.toHaveProperty('minimum');
        expect(bpmProperty).not.toHaveProperty('maximum');
        expect(bpmProperty.description).toBe('Beats per minute. Range: 20 to 300.');
    });

    it('leaves an optional property out of required rather than forcing it', () => {
        const schema = tool({
            type: 'object',
            properties: { bpm: { type: 'number' }, label: { type: 'string' } },
            required: ['bpm'],
            additionalProperties: false,
        });

        const projected = projectAnthropicStrictToolSchema(schema);

        expect(projected.function.parameters.required).toEqual(['bpm']);
        expect(projected.function.parameters.properties).not.toHaveProperty(['label', 'anyOf']);
    });

    it('sets additionalProperties: false on every object node, including nested ones', () => {
        const schema = tool({
            type: 'object',
            properties: {
                device: {
                    type: 'object',
                    properties: { id: { type: 'string', pattern: '^[a-z]+$' } },
                    required: ['id'],
                },
            },
            required: ['device'],
        });

        const projected = projectAnthropicStrictToolSchema(schema);
        const deviceProperty = (projected.function.parameters.properties as { device: Record<string, unknown> }).device;

        expect(projected.function.parameters.additionalProperties).toBe(false);
        expect(deviceProperty.additionalProperties).toBe(false);
        expect((deviceProperty.properties as { id: Record<string, unknown> }).id).not.toHaveProperty('pattern');
    });

    it('recurses through items and clamps minItems above 1 without stripping it', () => {
        const schema = tool({
            type: 'object',
            properties: {
                trackIds: {
                    type: 'array',
                    items: { type: 'string', minLength: 1 },
                    minItems: 3,
                    maxItems: 10,
                },
            },
            required: ['trackIds'],
        });

        const projected = projectAnthropicStrictToolSchema(schema);
        const trackIdsProperty = (projected.function.parameters.properties as { trackIds: Record<string, unknown> })
            .trackIds;

        expect(trackIdsProperty.minItems).toBe(1);
        expect(trackIdsProperty).not.toHaveProperty('maxItems');
        expect(trackIdsProperty.items as Record<string, unknown>).not.toHaveProperty('minLength');
    });

    it('recurses through anyOf/oneOf/allOf branches', () => {
        const schema = tool({
            type: 'object',
            properties: {
                value: {
                    anyOf: [
                        { type: 'number', minimum: 0 },
                        { type: 'string', maxLength: 5 },
                    ],
                },
            },
            required: ['value'],
        });

        const projected = projectAnthropicStrictToolSchema(schema);
        const valueProperty = (
            projected.function.parameters.properties as { value: { anyOf: Record<string, unknown>[] } }
        ).value;

        expect(findBoundKeywords(valueProperty.anyOf)).toEqual([]);
    });

    it('rejects a $ref it cannot resolve', () => {
        const schema = tool({
            type: 'object',
            properties: { value: { $ref: '#/$defs/Thing' } },
            required: ['value'],
        });

        expect(() => projectAnthropicStrictToolSchema(schema)).toThrowError();
        try {
            projectAnthropicStrictToolSchema(schema);
        } catch (error) {
            expect(isToolSchemaProjectionError(error)).toBe(true);
        }
    });

    it('projects the full production planning catalog without throwing or leaving a bound keyword', () => {
        const catalog = getPlanningProviderToolSchemas();
        expect(catalog.length).toBeGreaterThan(0);

        for (const schema of catalog) {
            const projected = projectAnthropicStrictToolSchema(schema);
            expect(findBoundKeywords(projected.function.parameters)).toEqual([]);
        }
    });
});
