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
 * Walks the source schema and its projected counterpart together and asserts that
 * every node the source carries a bound on projects a non-empty restated
 * description. A projection that strips a bound without restating it (69 of 75
 * bounded catalog nodes carry no description of their own) stays undetected by a
 * check that only asserts the bound keyword's absence. Anthropic's projection never
 * wraps a node (only OpenAI's forced-nullable pattern does), so no unwrap is needed
 * before descending into `properties`/`items`/`anyOf`/`allOf`.
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
    if (isRecord(source.properties)) {
        let projectedProperties: Record<string, unknown> = {};
        if (isRecord(projectedNode.properties)) {
            projectedProperties = projectedNode.properties;
        }
        for (const [key, propertySchema] of Object.entries(source.properties)) {
            assertBoundsRestated(propertySchema, projectedProperties[key]);
        }
    }
    if (source.items !== undefined) {
        assertBoundsRestated(source.items, projectedNode.items);
    }
    if (Array.isArray(source.anyOf)) {
        assertBoundsRestated(source.anyOf, projectedNode.anyOf);
    }
    if (Array.isArray(source.oneOf)) {
        // The source's `oneOf` branches land on the projected `anyOf` (`walkSchemaNode`
        // rewrites `oneOf` onto `anyOf`), in the same order.
        assertBoundsRestated(source.oneOf, projectedNode.anyOf);
    }
    if (Array.isArray(source.allOf)) {
        assertBoundsRestated(source.allOf, projectedNode.allOf);
    }
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

    it.each(['not', 'dependentRequired', 'if'] as const)(
        'rejects a nested "%s" keyword the strict wire schema cannot forward',
        (unsupportedKeyword) => {
            const schema = tool({
                type: 'object',
                properties: {
                    value: { type: 'string', [unsupportedKeyword]: { type: 'string' } },
                },
                required: ['value'],
            });

            expect(() => projectAnthropicStrictToolSchema(schema)).toThrowError();
            try {
                projectAnthropicStrictToolSchema(schema);
            } catch (error) {
                expect(isToolSchemaProjectionError(error)).toBe(true);
            }
        }
    );

    it('projects the full production planning catalog without throwing or leaving a bound keyword', () => {
        const catalog = getPlanningProviderToolSchemas();
        expect(catalog.length).toBeGreaterThan(0);

        for (const schema of catalog) {
            const projected = projectAnthropicStrictToolSchema(schema);
            expect(findBoundKeywords(projected.function.parameters)).toEqual([]);
            assertBoundsRestated(schema.function.parameters, projected.function.parameters);
        }
    });
});
