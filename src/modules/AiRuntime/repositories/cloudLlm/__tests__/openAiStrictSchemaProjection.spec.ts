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
    'uniqueItems',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
        if (key === 'oneOf') {
            // `oneOf` is not itself a bound keyword, but neither dialect supports it: a
            // projection that failed to rewrite it onto `anyOf` must still be caught here.
            found.push('oneOf');
            findBoundKeywords(value, found);
            continue;
        }
        if (key === 'items' || key === 'anyOf' || key === 'allOf') {
            findBoundKeywords(value, found);
        }
    }
    return found;
}

const BOUND_PRESENCE_KEYWORDS = [
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

function nodeCarriesBound(node: Record<string, unknown>): boolean {
    if (BOUND_PRESENCE_KEYWORDS.some((key) => key in node)) {
        return true;
    }
    if (node.uniqueItems === true) {
        return true;
    }
    return typeof node.minItems === 'number' && node.minItems > 1;
}

/**
 * Unwraps the OpenAI nullable wrapper `makeNullable` builds around a non-plain-type
 * child (`{ anyOf: [child, { type: 'null' }], description }`), so a parallel walk can
 * keep descending into the child's own `properties`/`items`/`anyOf` alongside the
 * matching source node. A schema without that exact two-branch, null-terminated shape
 * passes through unchanged.
 */
function unwrapNullableWrapper(node: Record<string, unknown>): Record<string, unknown> {
    if (!Array.isArray(node.anyOf) || node.anyOf.length !== 2) {
        return node;
    }
    const [first, second] = node.anyOf as unknown[];
    if (isRecord(first) && isRecord(second) && second.type === 'null') {
        return first;
    }
    return node;
}

/**
 * Walks the source schema and its projected counterpart together and asserts that
 * every node the source carries a bound on projects a non-empty restated
 * description. A projection that strips a bound without restating it (69 of 75
 * bounded catalog nodes carry no description of their own) stays undetected by a
 * check that only asserts the bound keyword's absence.
 */
function assertBoundsRestated(source: unknown, projected: unknown): void {
    if (Array.isArray(source)) {
        const projectedEntries = Array.isArray(projected) ? projected : [];
        for (const [index, entry] of source.entries()) {
            assertBoundsRestated(entry, projectedEntries[index]);
        }
        return;
    }
    if (!isRecord(source)) {
        return;
    }
    const projectedNode = isRecord(projected) ? projected : {};
    if (nodeCarriesBound(source)) {
        expect(typeof projectedNode.description).toBe('string');
        expect((projectedNode.description as string).length).toBeGreaterThan(0);
    }
    const effectiveProjected = unwrapNullableWrapper(projectedNode);
    if (isRecord(source.properties)) {
        let projectedProperties: Record<string, unknown> = {};
        if (isRecord(effectiveProjected.properties)) {
            projectedProperties = effectiveProjected.properties;
        }
        for (const [key, propertySchema] of Object.entries(source.properties)) {
            assertBoundsRestated(propertySchema, projectedProperties[key]);
        }
    }
    if (source.items !== undefined) {
        assertBoundsRestated(source.items, effectiveProjected.items);
    }
    if (Array.isArray(source.anyOf)) {
        assertBoundsRestated(source.anyOf, effectiveProjected.anyOf);
    }
    if (Array.isArray(source.oneOf)) {
        // The source's `oneOf` branches land on the projected `anyOf` (`walkSchemaNode`
        // rewrites `oneOf` onto `anyOf`), in the same order.
        assertBoundsRestated(source.oneOf, effectiveProjected.anyOf);
    }
    if (Array.isArray(source.allOf)) {
        assertBoundsRestated(source.allOf, effectiveProjected.allOf);
    }
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
            assertBoundsRestated(schema.function.parameters, projected.function.parameters);
        }
    });

    it('wraps an optional enum property in anyOf with a null branch, keeping the enum', () => {
        const schema = tool({
            type: 'object',
            properties: {
                bpm: { type: 'number' },
                unit: { enum: ['beats', 'bars'], description: 'Unit for the value.' },
            },
            required: ['bpm'],
            additionalProperties: false,
        });

        const projected = projectOpenAiStrictToolSchema(schema);
        const unitProperty = (projected.function.parameters.properties as { unit: Record<string, unknown> }).unit;

        expect(unitProperty).not.toHaveProperty('enum');
        expect(Array.isArray(unitProperty.anyOf)).toBe(true);
        const branches = unitProperty.anyOf as Record<string, unknown>[];
        expect(branches).toHaveLength(2);
        expect(branches[0]?.enum).toEqual(['beats', 'bars']);
        expect(branches[1]?.type).toBe('null');
        expect(unitProperty.description).toBe('Unit for the value. Null when not applicable.');
    });
});
