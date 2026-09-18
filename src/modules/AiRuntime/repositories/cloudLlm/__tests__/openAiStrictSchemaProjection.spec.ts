import { describe, expect, it } from 'vitest';

import { type ToolSchema } from '../../../models/Tools/Types';
import { getPlanningProviderToolSchemas } from '../../../useCases/getPlanningProviderToolSchemas';
import { projectOpenAiStrictToolSchema } from '../cloudInference/projectOpenAiStrictToolSchema';
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

/** Recursively asserts every object node in the projected schema is strict: additionalProperties: false, every property key present in required. */
function assertEveryObjectNodeIsAllRequired(node: unknown): void {
    if (Array.isArray(node)) {
        for (const entry of node) {
            assertEveryObjectNodeIsAllRequired(entry);
        }
        return;
    }
    if (typeof node !== 'object' || node === null) {
        return;
    }
    const record = node as Record<string, unknown>;
    if (record.type === 'object' || typeof record.properties === 'object') {
        expect(record.additionalProperties).toBe(false);
        const properties = record.properties as Record<string, unknown> | undefined;
        const required = record.required as string[] | undefined;
        expect(new Set(required)).toEqual(new Set(Object.keys(properties ?? {})));
    }
    for (const value of Object.values(record)) {
        assertEveryObjectNodeIsAllRequired(value);
    }
}

describe('projectOpenAiStrictToolSchema', () => {
    it('strips a numeric range into the description and off the schema', () => {
        const schema = tool({
            type: 'object',
            properties: { bpm: { type: 'number', minimum: 20, maximum: 300, description: 'Beats per minute.' } },
            required: ['bpm'],
            additionalProperties: false,
        });

        const projected = projectOpenAiStrictToolSchema(schema);
        const bpmProperty = (projected.function.parameters.properties as { bpm: Record<string, unknown> }).bpm;

        expect(bpmProperty).not.toHaveProperty('minimum');
        expect(bpmProperty).not.toHaveProperty('maximum');
        expect(bpmProperty.description).toBe('Beats per minute. Range: 20 to 300.');
    });

    it('forces every property into required, making an optional one nullable', () => {
        const schema = tool({
            type: 'object',
            properties: { bpm: { type: 'number' }, label: { type: 'string' } },
            required: ['bpm'],
            additionalProperties: false,
        });

        const projected = projectOpenAiStrictToolSchema(schema);
        const labelProperty = (projected.function.parameters.properties as { label: { type: string[] | string } })
            .label;

        expect(projected.function.parameters.required).toEqual(expect.arrayContaining(['bpm', 'label']));
        expect(projected.function.parameters.required).toHaveLength(2);
        expect(labelProperty.type).toEqual(expect.arrayContaining(['string', 'null']));
    });

    it('does not widen a property that was already required', () => {
        const schema = tool({
            type: 'object',
            properties: { bpm: { type: 'number' } },
            required: ['bpm'],
            additionalProperties: false,
        });

        const projected = projectOpenAiStrictToolSchema(schema);
        const bpmProperty = (projected.function.parameters.properties as { bpm: { type: string } }).bpm;

        expect(bpmProperty.type).toBe('number');
    });

    it('sets additionalProperties: false and full required on every nested object node', () => {
        const schema = tool({
            type: 'object',
            properties: {
                device: {
                    type: 'object',
                    properties: { id: { type: 'string', pattern: '^[a-z]+$' }, label: { type: 'string' } },
                    required: ['id'],
                },
            },
            required: ['device'],
        });

        const projected = projectOpenAiStrictToolSchema(schema);

        assertEveryObjectNodeIsAllRequired(projected.function.parameters);
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

        const projected = projectOpenAiStrictToolSchema(schema);
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

        expect(() => projectOpenAiStrictToolSchema(schema)).toThrowError();
        try {
            projectOpenAiStrictToolSchema(schema);
        } catch (error) {
            expect(isToolSchemaProjectionError(error)).toBe(true);
        }
    });

    it('projects the full production planning catalog without throwing or leaving a bound keyword', () => {
        const catalog = getPlanningProviderToolSchemas();
        expect(catalog.length).toBeGreaterThan(0);

        for (const schema of catalog) {
            const projected = projectOpenAiStrictToolSchema(schema);
            expect(findBoundKeywords(projected.function.parameters)).toEqual([]);
            assertEveryObjectNodeIsAllRequired(projected.function.parameters);
        }
    });
});
