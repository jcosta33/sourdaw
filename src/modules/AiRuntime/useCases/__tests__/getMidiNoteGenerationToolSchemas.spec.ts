import { describe, expect, it } from 'vitest';

import { getMidiNoteGenerationToolSchemas } from '../getMidiNoteGenerationToolSchemas';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('getMidiNoteGenerationToolSchemas', () => {
    it('exposes one addNotes schema matching the nonnegative runtime contract', () => {
        expect(getMidiNoteGenerationToolSchemas({ expectedClipId: 'clip-1' })).toMatchObject([
            {
                function: {
                    name: 'addNotes',
                    parameters: {
                        additionalProperties: false,
                        required: ['clipId', 'notes'],
                        properties: {
                            clipId: { type: 'string', minLength: 1, pattern: '\\S', enum: ['clip-1'] },
                            notes: {
                                type: 'array',
                                minItems: 1,
                                items: {
                                    type: 'object',
                                    additionalProperties: false,
                                    required: ['pitch', 'startBeat', 'duration'],
                                    properties: {
                                        pitch: { type: 'number', minimum: 0, maximum: 127 },
                                        startBeat: { type: 'number', minimum: 0 },
                                        duration: { type: 'number', exclusiveMinimum: 0 },
                                        velocity: { type: 'number', minimum: 1, maximum: 127 },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        ]);
    });

    it('removes only the start-beat minimum for backward completion', () => {
        expect(
            getMidiNoteGenerationToolSchemas({ expectedClipId: 'clip-1', allowNegativeStartBeat: true })
        ).toMatchObject([
            {
                function: {
                    parameters: {
                        properties: {
                            notes: {
                                items: {
                                    properties: {
                                        startBeat: { type: 'number' },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        ]);
        const properties = getMidiNoteGenerationToolSchemas({
            expectedClipId: 'clip-1',
            allowNegativeStartBeat: true,
        })[0]?.function.parameters.properties;
        const notes = properties?.notes;
        if (!isRecord(notes) || !isRecord(notes.items) || !isRecord(notes.items.properties)) {
            throw new Error('Expected nested addNotes note properties');
        }
        const startBeat = notes.items.properties.startBeat;
        if (!isRecord(startBeat)) {
            throw new Error('Expected a startBeat schema');
        }

        expect(Object.hasOwn(startBeat, 'minimum')).toBe(false);
    });
});
