import { type ToolSchema } from './Types';

type CreateAddNotesToolSchemaInput = {
    allowNegativeStartBeat?: boolean;
    expectedClipId?: string;
};

export function createAddNotesToolSchema(input: CreateAddNotesToolSchemaInput = {}): ToolSchema {
    const startBeatSchema: Record<string, unknown> = {
        type: 'number',
        description: 'Start position in beats within the clip',
    };
    if (!input.allowNegativeStartBeat) {
        startBeatSchema.minimum = 0;
    }
    const clipIdSchema: Record<string, unknown> = {
        type: 'string',
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
                required: ['clipId', 'notes'],
                properties: {
                    clipId: clipIdSchema,
                    notes: {
                        type: 'array',
                        minItems: 1,
                        description: 'Array of notes to write',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['pitch', 'startBeat', 'duration'],
                            properties: {
                                pitch: {
                                    type: 'number',
                                    minimum: 0,
                                    maximum: 127,
                                    description: 'MIDI note number (60=C4, 64=E4, 67=G4)',
                                },
                                startBeat: startBeatSchema,
                                duration: {
                                    type: 'number',
                                    exclusiveMinimum: 0,
                                    description: 'Note length in beats (0.25=16th, 0.5=8th, 1=quarter)',
                                },
                                velocity: {
                                    type: 'number',
                                    minimum: 1,
                                    maximum: 127,
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
