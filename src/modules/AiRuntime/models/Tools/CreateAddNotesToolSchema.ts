import { type ToolSchema } from './Types';

type CreateAddNotesToolSchemaInput = {
    allowNegativeStartBeat?: boolean;
    expectedClipId?: string;
    providerSchema: {
        readonly properties: Record<string, unknown>;
        readonly required: readonly string[];
    };
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function propertyOf(record: Record<string, unknown>, key: string): unknown {
    return record[key];
}

function getCanonicalAddNotesSchema(providerSchema: CreateAddNotesToolSchemaInput['providerSchema']) {
    const properties = structuredClone(providerSchema.properties);
    const clipId = propertyOf(properties, 'clipId');
    const notes = propertyOf(properties, 'notes');
    if (!isRecord(clipId) || !isRecord(notes)) {
        throw new Error('Canonical addNotes provider schema is invalid.');
    }
    const noteItems = propertyOf(notes, 'items');
    if (!isRecord(noteItems)) {
        throw new Error('Canonical addNotes provider schema is invalid.');
    }
    const noteProperties = propertyOf(noteItems, 'properties');
    if (!isRecord(noteProperties)) {
        throw new Error('Canonical addNotes provider schema is invalid.');
    }
    const pitch = propertyOf(noteProperties, 'pitch');
    const startBeat = propertyOf(noteProperties, 'startBeat');
    const duration = propertyOf(noteProperties, 'duration');
    const velocity = propertyOf(noteProperties, 'velocity');
    const required = propertyOf(noteItems, 'required');
    if (
        !isRecord(pitch) ||
        !isRecord(startBeat) ||
        !isRecord(duration) ||
        !isRecord(velocity) ||
        !isStringArray(required)
    ) {
        throw new Error('Canonical addNotes note schema is invalid.');
    }
    return {
        clipId,
        notes,
        noteItems,
        noteProperties,
        pitch,
        startBeat,
        duration,
        velocity,
        required,
    };
}

export function createAddNotesToolSchema(input: CreateAddNotesToolSchemaInput): ToolSchema {
    const { clipId, notes, noteItems, noteProperties, pitch, startBeat, duration, velocity, required } =
        getCanonicalAddNotesSchema(input.providerSchema);
    const startBeatSchema: Record<string, unknown> = {
        ...startBeat,
        description: 'Start position in beats within the clip',
    };
    if (input.allowNegativeStartBeat) {
        delete startBeatSchema.minimum;
    }
    const clipIdSchema: Record<string, unknown> = {
        ...clipId,
        minLength: 1,
        pattern: '\\S',
        description: 'Target clip ID',
    };
    if (input.expectedClipId) {
        clipIdSchema.enum = [input.expectedClipId];
    }

    return {
        type: 'function',
        function: {
            name: 'addNotes',
            description:
                'Write MIDI notes directly to a clip. Use this for any custom note content — melodies, chords, basslines, rhythms.',
            parameters: {
                type: 'object',
                additionalProperties: false,
                required: [...input.providerSchema.required],
                properties: {
                    clipId: clipIdSchema,
                    notes: {
                        ...notes,
                        type: 'array',
                        description: 'Array of notes to write',
                        items: {
                            ...noteItems,
                            type: 'object',
                            additionalProperties: false,
                            required: [...required],
                            properties: {
                                ...noteProperties,
                                pitch: {
                                    ...pitch,
                                    description: 'MIDI note number (60=C4, 64=E4, 67=G4)',
                                },
                                startBeat: startBeatSchema,
                                duration: {
                                    ...duration,
                                    description: 'Note length in beats (0.25=16th, 0.5=8th, 1=quarter)',
                                },
                                velocity: {
                                    ...velocity,
                                    description: '1-127, default 100',
                                },
                            },
                        },
                    },
                },
            },
        },
    };
}
