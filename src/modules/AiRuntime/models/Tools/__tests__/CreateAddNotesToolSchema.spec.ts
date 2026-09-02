import { describe, expect, it } from 'vitest';

import { getExecutableAppActionProviderSchema } from '#/modules/Command/useCases';

import { createAddNotesToolSchema } from '../CreateAddNotesToolSchema';
import { type ToolSchema } from '../Types';

function noteItems(schema: ToolSchema): Record<string, unknown> {
    const notes = schema.function.parameters.properties.notes as Record<string, unknown>;
    return notes.items as Record<string, unknown>;
}

function noteItemProperties(schema: ToolSchema): Record<string, Record<string, unknown>> {
    return noteItems(schema).properties as Record<string, Record<string, unknown>>;
}

describe('createAddNotesToolSchema', () => {
    const createSchema = (input: { allowNegativeStartBeat?: boolean; expectedClipId?: string } = {}) =>
        createAddNotesToolSchema({
            ...input,
            providerSchema: getExecutableAppActionProviderSchema('addNotes'),
        });

    it('locks startBeat to non-negative by default and omits minimum when negative allowed', () => {
        const locked = createSchema();
        const lockedStartBeat = noteItemProperties(locked).startBeat!;
        expect(lockedStartBeat.minimum).toBe(0);

        const open = createSchema({ allowNegativeStartBeat: true });
        const openStartBeat = noteItemProperties(open).startBeat!;
        expect(openStartBeat.minimum).toBeUndefined();
        // Both branches keep the shared description and type.
        expect(openStartBeat.type).toBe('number');
    });

    it('constrains clipId to an enum when expectedClipId is supplied, free-form otherwise', () => {
        const free = createSchema();
        const clipIdFree = free.function.parameters.properties.clipId as Record<string, unknown>;
        expect(clipIdFree.enum).toBeUndefined();
        expect(clipIdFree.minLength).toBe(1);
        expect(clipIdFree.pattern).toBe('\\S');

        const pinned = createSchema({ expectedClipId: 'clip-abc' });
        const clipIdPinned = pinned.function.parameters.properties.clipId as Record<string, unknown>;
        expect(clipIdPinned.enum).toEqual(['clip-abc']);
        // The free-form constraints remain even when enum is added.
        expect(clipIdPinned.minLength).toBe(1);
    });

    it('declares the function metadata, required fields, and note schema invariants across all branches', () => {
        for (const input of [
            {},
            { allowNegativeStartBeat: true },
            { expectedClipId: 'clip-x' },
            { allowNegativeStartBeat: true, expectedClipId: 'clip-y' },
        ]) {
            const schema = createSchema(input);
            expect(schema.type).toBe('function');
            expect(schema.function.name).toBe('addNotes');
            expect(schema.function.parameters.type).toBe('object');
            expect(schema.function.parameters.additionalProperties).toBe(false);
            expect(schema.function.parameters.required).toEqual(['clipId', 'notes']);

            const notes = schema.function.parameters.properties.notes as Record<string, unknown>;
            expect(notes.type).toBe('array');
            expect(notes.minItems).toBe(1);

            const props = noteItemProperties(schema);
            expect(noteItems(schema).required).toEqual(['pitch', 'startBeat', 'duration']);
            expect(props.pitch!.minimum).toBe(0);
            expect(props.pitch!.maximum).toBe(127);
            expect(props.duration!.exclusiveMinimum).toBe(0);
            expect(props.velocity!.minimum).toBe(1);
            expect(props.velocity!.maximum).toBe(127);
        }
    });

    it('derives from a varied canonical provider schema without owning note constraints', () => {
        const providerSchema = {
            properties: {
                clipId: { type: 'string', title: 'Canonical clip' },
                humanization: { type: 'number', minimum: 0, maximum: 1 },
                notes: {
                    type: 'array',
                    minItems: 2,
                    maxItems: 24,
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['velocity', 'duration', 'pitch'],
                        properties: {
                            pitch: { type: 'number', minimum: 0, maximum: 127, multipleOf: 0.5 },
                            startBeat: { type: 'number', minimum: 0, maximum: 64, multipleOf: 0.25 },
                            duration: { type: 'number', exclusiveMinimum: 0, maximum: 8 },
                            velocity: { type: 'number', minimum: 1, maximum: 127, multipleOf: 0.5 },
                        },
                    },
                },
            },
            required: ['notes', 'humanization'],
        };

        const schema = createAddNotesToolSchema({
            allowNegativeStartBeat: true,
            expectedClipId: 'clip-pinned',
            providerSchema,
        });
        const properties = schema.function.parameters.properties as Record<string, Record<string, unknown>>;
        const notes = properties.notes!;
        const items = notes.items as Record<string, unknown>;
        const noteProperties = items.properties as Record<string, Record<string, unknown>>;

        expect(schema.function.parameters.required).toEqual(['notes', 'humanization']);
        expect(properties.humanization).toEqual({ type: 'number', minimum: 0, maximum: 1 });
        expect(properties.clipId).toEqual({
            type: 'string',
            title: 'Canonical clip',
            minLength: 1,
            pattern: '\\S',
            description: 'Target clip ID',
            enum: ['clip-pinned'],
        });
        expect(notes).toMatchObject({ type: 'array', minItems: 2, maxItems: 24 });
        expect(items.required).toEqual(['velocity', 'duration', 'pitch']);
        expect(noteProperties.pitch).toEqual({
            type: 'number',
            minimum: 0,
            maximum: 127,
            multipleOf: 0.5,
            description: 'MIDI note number (60=C4, 64=E4, 67=G4)',
        });
        expect(noteProperties.startBeat).toEqual({
            type: 'number',
            maximum: 64,
            multipleOf: 0.25,
            description: 'Start position in beats within the clip',
        });
        expect(noteProperties.duration).toEqual({
            type: 'number',
            exclusiveMinimum: 0,
            maximum: 8,
            description: 'Note length in beats (0.25=16th, 0.5=8th, 1=quarter)',
        });
        expect(noteProperties.velocity).toEqual({
            type: 'number',
            minimum: 1,
            maximum: 127,
            multipleOf: 0.5,
            description: '1-127, default 100',
        });
    });
});
