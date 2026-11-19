import { MIDI_NOTE_EDIT_MAX_OPERATIONS, MIDI_NOTE_MIN_DURATION_BEATS } from '#/utils/midiNoteBatchLimits';

const midiNoteEditFields = {
    pitch: { type: 'integer', minimum: 0, maximum: 127 },
    startBeat: { type: 'number', minimum: 0 },
    duration: { type: 'number', minimum: MIDI_NOTE_MIN_DURATION_BEATS },
    velocity: { type: 'integer', minimum: 1, maximum: 127 },
} as const;

export const editMidiNotesCommand = {
    actionType: 'editMidiNotes',
    risk: 'destructive-reversible',
    description:
        'Edit selected stored notes in one MIDI clip after reading the required musical-content pages. Submit one structured list item with clip-relative beats and the read notes’ stable IDs for patch or delete. Inserts carry only musical values.',
    intentPhrases: ['edit midi notes', 'rewrite midi phrase', 'reshape midi phrase'],
    targetRules: [{ argument: 'clipId', capability: 'writable-midi-clip', allowBatchLocal: false }],
    materializedArgumentsValidation: 'owner-required',
    parameters: {
        properties: {
            clipId: { type: 'string' },
            operations: {
                type: 'array',
                minItems: 1,
                maxItems: MIDI_NOTE_EDIT_MAX_OPERATIONS,
                items: {
                    anyOf: [
                        {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                type: { type: 'string', enum: ['patch'] },
                                noteId: { type: 'string' },
                                patch: {
                                    type: 'object',
                                    additionalProperties: false,
                                    properties: midiNoteEditFields,
                                    minProperties: 1,
                                },
                            },
                            required: ['type', 'noteId', 'patch'],
                        },
                        {
                            type: 'object',
                            additionalProperties: false,
                            properties: { type: { type: 'string', enum: ['delete'] }, noteId: { type: 'string' } },
                            required: ['type', 'noteId'],
                        },
                        {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                type: { type: 'string', enum: ['insert'] },
                                note: {
                                    type: 'object',
                                    additionalProperties: false,
                                    properties: midiNoteEditFields,
                                    required: ['pitch', 'startBeat', 'duration'],
                                },
                            },
                            required: ['type', 'note'],
                        },
                    ],
                },
            },
        },
        required: ['clipId', 'operations'],
    },
} as const;
