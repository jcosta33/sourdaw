import { describe, expect, it } from 'vitest';

import { getExecutableAppActionProviderSchema } from '#/modules/Command/useCases';
import { ADD_NOTES_MAX_NOTES_PER_COMMAND, MIDI_NOTE_MIN_DURATION_BEATS } from '#/utils/midiNoteBatchLimits';

import { getMidiNoteGenerationToolSchemas } from '../getMidiNoteGenerationToolSchemas';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function noteProperty(
    schemas: ReturnType<typeof getMidiNoteGenerationToolSchemas>,
    name: string
): Record<string, unknown> {
    const notes = schemas[0]?.function.parameters.properties.notes;
    if (!isRecord(notes) || !isRecord(notes.items) || !isRecord(notes.items.properties)) {
        throw new Error('Expected nested addNotes note properties');
    }
    const property = notes.items.properties[name];
    if (!isRecord(property)) {
        throw new Error(`Expected a ${name} note schema`);
    }
    return property;
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
                                maxItems: ADD_NOTES_MAX_NOTES_PER_COMMAND,
                                items: {
                                    type: 'object',
                                    additionalProperties: false,
                                    required: ['pitch', 'startBeat', 'duration'],
                                    properties: {
                                        pitch: { type: 'number', minimum: 0, maximum: 127 },
                                        startBeat: { type: 'number', minimum: 0 },
                                        duration: { type: 'number', minimum: MIDI_NOTE_MIN_DURATION_BEATS },
                                        velocity: { type: 'number', minimum: 1, maximum: 127 },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        ]);

        // toMatchObject ignores extra keys, so the retired bound needs its own assertion: a schema
        // still carrying exclusiveMinimum would admit a note shorter than the bridge accepts.
        const duration = noteProperty(getMidiNoteGenerationToolSchemas({ expectedClipId: 'clip-1' }), 'duration');
        expect(Object.hasOwn(duration, 'exclusiveMinimum')).toBe(false);
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

    it('derives every note constraint from the canonical addNotes provider schema', () => {
        const canonical = getExecutableAppActionProviderSchema('addNotes');
        const canonicalNotes = canonical.properties.notes;
        const generatedNotes = getMidiNoteGenerationToolSchemas({ expectedClipId: 'clip-1' })[0]?.function.parameters
            .properties.notes;
        if (
            !isRecord(canonicalNotes) ||
            !isRecord(canonicalNotes.items) ||
            !isRecord(canonicalNotes.items.properties) ||
            !isRecord(generatedNotes) ||
            !isRecord(generatedNotes.items) ||
            !isRecord(generatedNotes.items.properties)
        ) {
            throw new Error('Expected canonical and generated addNotes note schemas');
        }

        expect(generatedNotes.minItems).toBe(canonicalNotes.minItems);
        expect(generatedNotes.items.additionalProperties).toBe(canonicalNotes.items.additionalProperties);
        expect(generatedNotes.items.required).toEqual(canonicalNotes.items.required);
        for (const key of ['pitch', 'startBeat', 'duration', 'velocity']) {
            const canonicalProperty = canonicalNotes.items.properties[key];
            const generatedProperty = generatedNotes.items.properties[key];
            if (!isRecord(canonicalProperty) || !isRecord(generatedProperty)) {
                throw new Error(`Expected ${key} note constraints`);
            }
            expect(generatedProperty).toMatchObject(canonicalProperty);
        }
    });
});
