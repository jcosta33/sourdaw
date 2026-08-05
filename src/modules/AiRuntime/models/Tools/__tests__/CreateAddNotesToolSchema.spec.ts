import { describe, expect, it } from 'vitest';

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
    it('locks startBeat to non-negative by default and omits minimum when negative allowed', () => {
        const locked = createAddNotesToolSchema();
        const lockedStartBeat = noteItemProperties(locked).startBeat!;
        expect(lockedStartBeat.minimum).toBe(0);

        const open = createAddNotesToolSchema({ allowNegativeStartBeat: true });
        const openStartBeat = noteItemProperties(open).startBeat!;
        expect(openStartBeat.minimum).toBeUndefined();
        // Both branches keep the shared description and type.
        expect(openStartBeat.type).toBe('number');
    });

    it('constrains clipId to an enum when expectedClipId is supplied, free-form otherwise', () => {
        const free = createAddNotesToolSchema();
        const clipIdFree = free.function.parameters.properties.clipId as Record<string, unknown>;
        expect(clipIdFree.enum).toBeUndefined();
        expect(clipIdFree.minLength).toBe(1);
        expect(clipIdFree.pattern).toBe('\\S');

        const pinned = createAddNotesToolSchema({ expectedClipId: 'clip-abc' });
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
            const schema = createAddNotesToolSchema(input);
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
});
